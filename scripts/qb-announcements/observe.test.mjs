import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createObservationHandler, signObservation } from './observe.mjs';
import { lambdaAdapter } from './lambda.mjs';
import { packageObserver } from './package-observer.mjs';
import { emptySourceState, SLEEPER_URL } from './sleeper.mjs';

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
  sourceState: null, allowSleeperFetch: false,
  retryAfterByOrigin: { 'https://api.github.com': '2026-11-05T20:00:00Z' },
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

test('an old database transport cannot run the new daily collector without a durable cache/quota contract', async () => {
  const legacy = { ...context }; delete legacy.sourceState; delete legacy.allowSleeperFetch;
  const value = await report(await make({ readSchedule: noNetwork })(request(legacy)));
  assert.equal(value.status, 'failed');
  assert.equal(value.reason, 'source_state_transport_required');
});

test('earlier source kickoff, a started game or incomplete event IDs prevent collection', async () => {
  for (const [espn, reason] of [
    [{ ...schedule, firstKickoffAt: '2026-11-05T16:00:00Z' }, 'first_kickoff_reached'],
    [{ ...schedule, games: [game, { ...first, phase: 'in' }] }, 'first_kickoff_reached'],
    [{ ...schedule, games: [first] }, 'calendar_mismatch'],
  ]) {
    const handler = make({ readSchedule: async () => espn, collect: noNetwork });
    assert.equal((await report(await handler(request()))).reason, reason);
  }
});

test('observation signs the source signal, honors backoff and blocks legacy scraping and database traffic', async () => {
  const proposed = { team: 'ARI', match: game, newQB: { id: '4038524', name: 'Gardner Minshew II' },
    espnAthleteId: '4038524', status: 'ambiguous', reason: 'nflverse_projection' };
  const errors = [{ url: 'https://github.com/', message: 'HTTP 429', status: 429, retryAfter: '7200' }];
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
      assert.throws(() => args.fetcher('https://pool-db.supabase.co/rest/v1/qbs'), /allowed sources/);
      assert.throws(() => args.fetcher('https://www.nfl.com/news/'), /allowed sources/);
      assert.throws(() => args.fetcher('https://site.api.espn.com/scoreboard'), /allowed sources/);
      assert.throws(() => args.fetcher('https://api.github.com/repos/nflverse/nflverse-data'), /backoff/);
      assert.equal((await args.fetcher('https://github.com/', { method: 'POST' })).status, 429);
      return { decisions: [proposed], errors, counts: { analyzed: 2 } };
    },
  });
  const value = await report(await handler(request()));
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.decisions, [proposed]);
  assert.deepEqual(value.errors, errors);
  assert.deepEqual(fetches, [['https://github.com/', 'GET']]);
  assert.deepEqual(value.httpRequests, { sources: 1 });
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

test('signed daily state crosses the Lambda boundary, allows one exact Sleeper GET and blocks other paths', async () => {
  const state = emptySourceState(clock);
  let calls = 0;
  const handler = make({ readSchedule: async () => schedule,
    fetcher: async (url, options) => { calls++; assert.equal(url, SLEEPER_URL); assert.equal(options.method, 'GET'); return Response.json({}); },
    collect: async args => {
      assert.deepEqual(args.sourceState, state);
      assert.equal(args.openedAt, context.openedAt);
      assert.throws(() => args.fetcher('https://api.sleeper.app/v1/league/123'), /allowed sources/);
      assert.throws(() => args.fetcher(SLEEPER_URL + '&active=true'), /allowed sources/);
      await args.fetcher(SLEEPER_URL);
      return { decisions: [], errors: [], sourceState: state };
    } });
  const result = await report(await handler(request({ ...context, sourceState: state })));
  assert.deepEqual(result.sourceState, state);
  assert.equal(calls, 1);
  const invalid = structuredClone(state); invalid.sleeper.fetchedAt = '2099-01-01T00:00:00Z';
  assert.equal((await handler(request({ ...context, sourceState: invalid }))).status, 400);
});

test('oversized signed responses fail closed without persisting partial evidence', async () => {
  const handler = make({ readSchedule: async () => schedule,
    collect: async () => ({ decisions: [], errors: [{ message: 'x'.repeat(150_000) }] }) });
  const result = await report(await handler(request()));
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'response_too_large');
  assert.deepEqual(result.decisions, []);
});

test('a moving real clock uses exactly one observation timestamp for the signed report and private state', async () => {
  let time = clock;
  const now = () => ++time;
  const handler = make({ now, readSchedule: async () => schedule,
    collect: async () => ({ decisions: [], errors: [], sourceState: emptySourceState(now()) }) });
  const result = await report(await handler(request()));
  assert.equal(result.sourceState.observedAt, result.observedAt);
});

test('Lambda preserves the exact signed bytes and rejects paths outside the Function URL contract', async () => {
  const handler = lambdaAdapter(make({ readSchedule: async () => schedule,
    collect: async () => ({ decisions: [], errors: [] }) }));
  const body = JSON.stringify(context, null, 1);
  const event = {
    rawPath: '/api/cron/qb-observation', requestContext: { http: { method: 'POST' } },
    headers: { 'X-QB-Observation-Signature': signObservation(body, secret) },
    body: Buffer.from(body).toString('base64'), isBase64Encoded: true,
  };
  const result = await handler(event);
  assert.equal(result.statusCode, 200);
  assert.equal((await report(new Response(result.body))).status, 'completed');
  assert.equal((await handler({ ...event, rawPath: '/invalid' })).statusCode, 404);
});

test('standalone worker package has no database client, environment files or application routes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'qb-observer-test-'));
  try {
    const bundle = await packageObserver(join(temporary, 'worker'));
    await assert.rejects(packageObserver(bundle), { code: 'EEXIST' });
    assert.deepEqual((await readdir(bundle)).sort(), ['index.mjs', 'lib', 'package.json', 'scripts']);
    const manifest = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    const { handler } = await import(pathToFileURL(join(bundle, 'index.mjs')));
    assert.equal(typeof handler, 'function');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
