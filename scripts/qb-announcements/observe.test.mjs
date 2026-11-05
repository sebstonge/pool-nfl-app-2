import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createObservationHandler, observationClubs, signObservation } from './observe.mjs';
import { packageObserver } from './package-observer.mjs';

const secret = 'fixture-secret-32-bytes-minimum-local-only';
const env = { QB_OBSERVATION_ENABLED: 'true', QB_OBSERVATION_SECRET: secret };
const clock = Date.parse('2026-11-05T16:00:00Z');
const game = { id: '401873048', kickoffAt: '2026-11-08T21:25:00Z', teams: ['ARI', 'SEA'], phase: 'pre' };
const first = { id: '401873037', kickoffAt: '2026-11-06T01:15:00Z', teams: ['BAL', 'JAX'], phase: 'pre' };
const schedule = { season: 2026, week: 9, firstKickoffAt: first.kickoffAt, games: [first, game] };
const context = {
  runId: '19a78a6a-8f3b-4405-9678-5f4f59ee3188', season: 2026, week: 9, revision: 3,
  openedAt: '2026-11-03T15:00:00Z', firstKickoffAt: first.kickoffAt, dispatchedAt: new Date(clock).toISOString(),
  eventIds: [first.id, game.id], baseline: { ARI: { id: '2578570', name: 'Jacoby Brissett' } },
  seenUrls: ['https://www.azcardinals.com/news/already-observed'],
  retryAfterByOrigin: { 'https://www.seahawks.com': '2026-11-05T20:00:00Z' },
};
const noNetwork = () => assert.fail('Unexpected source request');
const make = options => createObservationHandler({ env, now: () => clock, fetcher: noNetwork, ...options });
function request(payload = context, { signature, method = 'POST' } = {}) {
  const body = JSON.stringify(payload);
  return new Request('https://example.test/api/cron/qb-observation', {
    method,
    headers: { 'X-QB-Observation-Signature': signature ?? signObservation(body, secret) },
    ...(method === 'POST' && { body }),
  });
}
async function report(result) {
  assert.equal(result.status, 200);
  const envelope = await result.json();
  assert.equal(envelope.signature, signObservation(envelope.report, secret));
  const value = JSON.parse(envelope.report);
  assert.equal(value.mode, 'observation');
  assert.equal(value.runId, context.runId);
  assert.equal(value.revision, context.revision);
  return value;
}

test('disabled workers, database environments, bad signatures and expired requests cannot call a source', async () => {
  const handler = make({ readSchedule: noNetwork });
  assert.equal((await make({ env: {} })(request())).status, 503);
  assert.equal((await make({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'fixture' } })(request())).status, 503);
  assert.equal((await handler(request(context, { method: 'GET' }))).status, 405);
  assert.equal((await handler(request(context, { signature: '0'.repeat(64) }))).status, 401);
  assert.equal((await handler(request({ ...context, dispatchedAt: '2026-11-05T15:50:00Z' }))).status, 400);
});

test('actual opening and DB cutoff are checked before fetching ESPN', async () => {
  const handler = make({ readSchedule: noNetwork });
  assert.equal((await report(await handler(request({ ...context, openedAt: '2026-11-05T17:00:00Z' })))).reason,
    'week_not_open');
  const kickoff = Date.parse(context.firstKickoffAt);
  const frozen = make({ now: () => kickoff, readSchedule: noNetwork });
  assert.equal((await report(await frozen(request({ ...context, dispatchedAt: context.firstKickoffAt })))).reason,
    'first_kickoff_reached');
});

test('earlier ESPN kickoff, a started game or incomplete event IDs prevent article collection', async () => {
  for (const [espn, reason] of [
    [{ ...schedule, firstKickoffAt: '2026-11-05T16:00:00Z' }, 'first_kickoff_reached'],
    [{ ...schedule, games: [game, { ...first, phase: 'in' }] }, 'first_kickoff_reached'],
    [{ ...schedule, games: [first] }, 'calendar_mismatch'],
  ]) {
    const handler = make({ readSchedule: async () => espn, collect: noNetwork });
    assert.equal((await report(await handler(request()))).reason, reason);
  }
});

test('observation reuses collector context, seen URLs and HTTP backoff, returning a signed proposal and error', async () => {
  const proposed = { team: 'ARI', match: game, newQB: { id: '4038524', name: 'Gardner Minshew II' },
    espnAthleteId: '4038524', status: 'proposed', reason: 'starter_confirmed' };
  const errors = [{ url: 'https://www.nfl.com/news/', message: 'HTTP 429', status: 429, retryAfter: '7200' }];
  const fetches = [];
  const handler = make({
    readSchedule: async () => schedule,
    fetcher: async (url, options) => {
      fetches.push([url, options.method]);
      return new Response('', { status: 429 });
    },
    collect: async args => {
      assert.equal(args.season, context.season);
      assert.deepEqual(args.baseline, context.baseline);
      assert.deepEqual(args.seenUrls, context.seenUrls);
      assert.deepEqual(args.retryAfterByOrigin, context.retryAfterByOrigin);
      assert.equal(args.sourceTeams.length, 4);
      assert.equal(args.sourceTeams.filter(team => schedule.games.some(g => g.teams.includes(team))).length, 3);
      assert.throws(() => args.fetcher('https://pool-db.supabase.co/rest/v1/qbs'), /allowed sources/);
      assert.equal((await args.fetcher('https://www.nfl.com/news/', { method: 'POST' })).status, 429);
      return { decisions: [proposed, { status: 'rejected', reason: 'no_starter_announcement' }],
        errors, counts: { analyzed: 2 }, frozen: false };
    },
  });
  const value = await report(await handler(request()));
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.decisions, [proposed]);
  assert.deepEqual(value.errors, errors);
  assert.deepEqual(fetches, [['https://www.nfl.com/news/', 'GET']]);
  assert.deepEqual(value.httpRequests, { sources: 1, espn: 0 });
});

test('a collection crossing the kickoff cannot return a proposal', async () => {
  let time = clock;
  const handler = make({
    now: () => time, readSchedule: async () => schedule,
    collect: async () => {
      time = Date.parse(first.kickoffAt);
      return { decisions: [{ status: 'proposed', newQB: { id: '4038524' } }], errors: [] };
    },
  });
  const value = await report(await handler(request()));
  assert.equal(value.reason, 'first_kickoff_reached');
  assert.deepEqual(value.decisions, []);
});

test('active teams have priority and remaining teams rotate', () => {
  const playing = new Set(schedule.games.flatMap(g => g.teams));
  const active = new Set(), others = new Set();
  for (let n = 0; n < 28; n++) {
    const clubs = observationClubs(schedule.games, clock + n * 7_200_000);
    assert.equal(clubs.length, 4);
    assert.ok(clubs.slice(0, 3).every(team => playing.has(team)));
    clubs.slice(0, 3).forEach(team => active.add(team));
    others.add(clubs[3]);
  }
  assert.deepEqual(active, playing);
  assert.equal(others.size, 28);
});

test('standalone worker package has no database client, environment files or application routes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'qb-observer-test-'));
  try {
    const bundle = await packageObserver(join(temporary, 'worker'));
    await assert.rejects(packageObserver(bundle), { code: 'EEXIST' });
    assert.deepEqual((await readdir(bundle)).sort(), ['api', 'lib', 'package.json', 'scripts', 'vercel.json']);
    const manifest = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    const { default: endpoint } = await import(pathToFileURL(join(bundle, 'api/cron/qb-observation.mjs')));
    assert.equal(typeof endpoint.fetch, 'function');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
