import { createHmac, timingSafeEqual } from 'node:crypto';
import { sameIds } from '../../lib/regular-publication/espn.mjs';
import { NFLVERSE_ORIGINS, readNflverseWeek } from './nflverse.mjs';
import { collectFreeSources } from './availability.mjs';
import { SLEEPER_URL, validSourceState } from './sleeper.mjs';
import { TEAM_SOURCES } from './sources.mjs';

const MAX_BODY = 128 * 1024;
const MAX_RUNTIME_MS = 45_000;
const SIGNATURE_HEADER = 'X-QB-Observation-Signature';
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ? Date.parse(value) : NaN;
const athleteId = value => typeof value === 'string' && /^\d{1,18}$/.test(value);

export function signObservation(text, secret) {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

function authentic(body, signature, secret) {
  return typeof signature === 'string' && /^[0-9a-f]{64}$/.test(signature) &&
    timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signObservation(body, secret), 'hex'));
}

export async function readObservationBody(request, maxBytes = MAX_BODY) {
  if (Number(request.headers.get('content-length')) > maxBytes || !request.body) throw new Error('Invalid body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Invalid body');
    }
    text += decoder.decode(value, { stream: true });
  }
}

function validRequest(value, now) {
  if (!isObject(value)) return false;
  const { runId, season, week, revision, dispatchedAt, openedAt, firstKickoffAt, eventIds, baseline,
    seenUrls, retryAfterByOrigin = {} } = value;
  const dispatched = instant(dispatchedAt), opening = instant(openedAt), kickoff = instant(firstKickoffAt);
  return typeof runId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId) &&
    Number.isInteger(season) && season >= 2000 && season <= 2100 &&
    Number.isInteger(week) && week >= 1 && week <= 18 &&
    Number.isSafeInteger(revision) && revision >= 0 &&
    dispatched <= now + 30_000 && dispatched >= now - 120_000 && opening < kickoff &&
    Array.isArray(eventIds) && eventIds.length > 0 && eventIds.length <= 32 &&
    eventIds.every(athleteId) && new Set(eventIds).size === eventIds.length &&
    isObject(baseline) && Object.entries(baseline).every(([abbr, qb]) =>
      Object.hasOwn(TEAM_SOURCES, abbr) && isObject(qb) && athleteId(qb.id) &&
      typeof qb.name === 'string' && qb.name.trim() && qb.name.length <= 160 &&
      (qb.publishedAt == null || Number.isFinite(instant(qb.publishedAt)))) &&
    Array.isArray(seenUrls) && seenUrls.length <= 200 &&
    seenUrls.every(url => typeof url === 'string' && url.length <= 500) &&
    isObject(retryAfterByOrigin) && Object.entries(retryAfterByOrigin)
      .every(([origin, until]) => (NFLVERSE_ORIGINS.has(origin) || origin === 'https://api.sleeper.app') && Number.isFinite(instant(until))) &&
    validSourceState(value.sourceState, now);
}

const response = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function createObservationHandler({
  env = process.env, now = Date.now, fetcher = fetch, readSchedule = readNflverseWeek, collect = collectFreeSources,
  maxRuntimeMs = MAX_RUNTIME_MS,
} = {}) {
  return async function observe(request) {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    const secret = env.QB_OBSERVATION_SECRET;
    if (env.QB_OBSERVATION_ENABLED !== 'true' || typeof secret !== 'string' || secret.length < 32 ||
        Object.keys(env).some(key => /^(?:NEXT_PUBLIC_)?SUPABASE_|^POSTGRES_|^DATABASE_URL$/.test(key))) {
      return response({ error: 'observation_disabled_or_database_environment' }, 503);
    }

    let payload;
    try {
      const body = await readObservationBody(request);
      if (!authentic(body, request.headers.get(SIGNATURE_HEADER), secret)) {
        return response({ error: 'invalid_signature' }, 401);
      }
      payload = JSON.parse(body);
    } catch {
      return response({ error: 'invalid_request' }, 400);
    }
    const started = now();
    if (!validRequest(payload, started)) return response({ error: 'invalid_request' }, 400);
    const { runId, season, week, revision, baseline, retryAfterByOrigin = {} } = payload;
    const opening = instant(payload.openedAt);
    let cutoff = instant(payload.firstKickoffAt);
    const httpRequests = { sources: 0 };
    const finish = (status, reason, result = {}) => {
      const observedAt = new Date(now()).toISOString();
      let report = JSON.stringify({
        mode: 'observation', runId, season, week, revision, status, reason,
        firstKickoffAt: new Date(cutoff).toISOString(), observedAt,
        decisions: [], errors: [], ...result, httpRequests,
        ...(result.sourceState ? { sourceState: { ...result.sourceState, observedAt } } : {}),
      });
      let envelope = { report, signature: signObservation(report, secret) };
      if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_BODY) {
        // Match the database/pg_net envelope limit. Never persist a partial
        // source snapshot or truncate an identity/absence to fit the transport.
        report = JSON.stringify({ mode: 'observation', runId, season, week, revision,
          status: 'failed', reason: 'response_too_large', firstKickoffAt: new Date(cutoff).toISOString(),
          observedAt, decisions: [], errors: [], httpRequests });
        envelope = { report, signature: signObservation(report, secret) };
      }
      return response(envelope);
    };
    if (!Object.hasOwn(payload, 'sourceState') || typeof payload.allowSleeperFetch !== 'boolean') {
      return finish('failed', 'source_state_transport_required');
    }
    if (started < opening) return finish('skipped', 'week_not_open');
    if (started >= cutoff) return finish('skipped', 'first_kickoff_reached');

    const deadline = started + maxRuntimeMs;
    const guardedFetch = (value, options = {}) => {
      const url = new URL(value);
      if ((!NFLVERSE_ORIGINS.has(url.origin) && url.href !== SLEEPER_URL) || url.username || url.password || httpRequests.sources >= 7) {
        throw new Error('Observation request outside allowed sources or budget');
      }
      if (instant(retryAfterByOrigin[url.origin]) > now()) throw new Error('Source in HTTP backoff');
      const remaining = Math.min(deadline, cutoff) - now();
      if (remaining <= 0) throw new Error('Observation window elapsed');
      httpRequests.sources++;
      const timeout = AbortSignal.timeout(remaining);
      return fetcher(url.href, {
        ...options, method: 'GET', redirect: options.redirect ?? 'error',
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    };
    try {
      const schedule = await readSchedule(season, week, TEAM_SOURCES, guardedFetch, now);
      const sourceKickoff = instant(schedule.firstKickoffAt);
      if (!Number.isFinite(sourceKickoff)) return finish('failed', 'calendar_invalid');
      cutoff = Math.min(cutoff, sourceKickoff);
      if (now() >= cutoff || schedule.games.some(game => game.phase !== 'pre')) {
        return finish('skipped', 'first_kickoff_reached');
      }
      if (!sameIds(schedule.games.map(game => game.id), payload.eventIds)) {
        return finish('failed', 'calendar_mismatch');
      }
      const result = await collect({
        season, baseline, sourceState: payload.sourceState, openedAt: payload.openedAt,
        allowSleeperFetch: payload.allowSleeperFetch, fetcher: guardedFetch, now,
        schedule: { ...schedule, firstKickoffAt: new Date(cutoff).toISOString() },
      });
      if (now() >= cutoff) return finish('skipped', 'first_kickoff_reached', { errors: result.errors });
      if (now() >= deadline) return finish('failed', 'collection_timeout', { errors: result.errors });
      return finish('completed', null, {
        decisions: result.decisions,
        counts: result.counts, errors: result.errors, ...(result.sourceState ? { sourceState: result.sourceState } : {}),
      });
    } catch (error) {
      if (now() >= cutoff) return finish('skipped', 'first_kickoff_reached');
      return finish('failed', now() >= deadline ? 'collection_timeout' : 'collection_error', {
        errors: [{
          message: String(error?.message || 'Source unavailable').slice(0, 400),
          url: error?.url, status: error?.status, retryAfter: error?.retryAfter,
        }],
      });
    }
  };
}
