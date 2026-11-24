import { randomUUID } from 'node:crypto';
import { createObservationHandler, readObservationBody, signObservation } from './observe.mjs';

const endpoint = '/rest/v1/rpc/qb_observer_exchange';
const rpcTimeoutMs = 4_000;
const collectTimeoutMs = 36_000;
const maxRpcBytes = 256 * 1024;
const maxReportBytes = 128 * 1024;
const claimStops = new Set(['inactive', 'outside_window', 'already_dispatched', 'busy', 'replayed']);
const reportStatuses = new Set(['stored', 'already_stored', 'ignored', 'replayed']);
const supabaseEnv = new Set(['QB_OBSERVATION_SUPABASE_URL', 'QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY']);

const failed = reason => ({ status: 'failed', reason });

function configuration(env) {
  const origin = env.QB_OBSERVATION_SUPABASE_URL;
  const apiKey = env.QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY;
  const secret = env.QB_OBSERVATION_SECRET;
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(origin ?? '') ||
      !/^sb_publishable_[A-Za-z0-9_-]{20,128}$/.test(apiKey ?? '') ||
      !/^[0-9a-f]{64}$/.test(secret ?? '') ||
      Object.keys(env).some(key => /^(?:(?:NEXT_PUBLIC_|QB_OBSERVATION_)?SUPABASE_|POSTGRES_|DATABASE_URL$)/.test(key) &&
        !supabaseEnv.has(key))) {
    return null;
  }
  return { url: new URL(endpoint, origin).href, apiKey, secret };
}

function isScheduledTick(event) {
  // The Scheduler invokes the function through a dedicated IAM role. This
  // marker selects the handler contract, and does not confer AWS access.
  return event?.source === 'aws.scheduler' && event['detail-type'] === 'qb-observation' &&
    event.detail?.version === 1 && event.requestContext === undefined && event.rawPath === undefined;
}

export function createScheduledObservationHandler({
  env = process.env, now = Date.now, fetcher = fetch, nonce = randomUUID, readSchedule, collect,
} = {}) {
  return async function observeOnSchedule(event) {
    if (!isScheduledTick(event)) return failed('unsupported_event');
    if (env.QB_OBSERVATION_ENABLED !== 'true') return { status: 'inactive' };
    const config = configuration(env);
    if (!config) return failed('invalid_observation_configuration');

    async function exchange(action, fields = {}) {
      const p_message = JSON.stringify({ action, timestamp: new Date(now()).toISOString(), nonce: nonce(), ...fields });
      const body = JSON.stringify({ p_message, p_signature: signObservation(p_message, config.secret) });
      if (Buffer.byteLength(body) > maxRpcBytes) throw new Error('Observation request too large');

      const response = await fetcher(config.url, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(rpcTimeoutMs), redirect: 'error', body,
      });
      if (!response.ok) throw new Error('Observation RPC unavailable');
      return JSON.parse(await readObservationBody(response, maxRpcBytes));
    }

    let claim;
    try {
      claim = await exchange('claim');
    } catch {
      return failed('claim_failed');
    }
    if (claimStops.has(claim?.status)) return { status: claim.status };
    if (claim?.status !== 'claimed' || !claim.payload || typeof claim.payload !== 'object' ||
        Array.isArray(claim.payload)) return failed('invalid_claim_response');

    // Reuse the existing validated collector in process. The RPC credentials
    // are kept out of its source-request path. Leave time to submit the report
    // within a 50-second Lambda execution.
    const observe = createObservationHandler({
      env: { QB_OBSERVATION_ENABLED: 'true', QB_OBSERVATION_SECRET: config.secret },
      maxRuntimeMs: collectTimeoutMs, now, fetcher, readSchedule, collect,
    });
    const payload = JSON.stringify(claim.payload);
    const response = await observe(new Request('https://observer.invalid/api/cron/qb-observation', {
      method: 'POST', headers: { 'X-QB-Observation-Signature': signObservation(payload, config.secret) }, body: payload,
    }));
    if (!response.ok) return failed('invalid_claim_payload');

    try {
      const { report } = JSON.parse(await readObservationBody(response, maxReportBytes));
      if (typeof report !== 'string') return failed('invalid_collection_response');
      const receipt = await exchange('report', { report });
      if (reportStatuses.has(receipt?.status)) return { status: receipt.status };
      return failed('invalid_report_receipt');
    } catch {
      // A lost response must not trigger an unbounded or duplicate delivery.
      // The database's durable claim remains in force for this collection.
      return failed('report_failed');
    }
  };
}
