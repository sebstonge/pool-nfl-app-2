import assert from 'node:assert/strict';
import test from 'node:test';
import { handler as deployedHandler } from './lambda.mjs';
import { createScheduledObservationHandler } from './scheduled.mjs';
import { signObservation } from './observe.mjs';
import { SLEEPER_URL } from './sleeper.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const key = 'sb_publishable_' + 's'.repeat(32);
const secret = 'ab'.repeat(32);
const clock = Date.parse('2026-11-05T16:00:00Z');
const game = { id: '401873037', kickoffAt: '2026-11-06T01:15:00Z', teams: ['BAL', 'JAX'], phase: 'pre' };
const gameWeek = {
  season: 2026, week: 9, firstKickoffAt: game.kickoffAt, games: [game],
};
const snapshot = {
  runId: '19a78a6a-8f3b-4405-9678-5f4f59ee3188', season: 2026, week: 9, revision: 3,
  openedAt: '2026-11-03T15:00:00Z', firstKickoffAt: game.kickoffAt, dispatchedAt: new Date(clock).toISOString(),
  eventIds: [game.id], baseline: {}, seenUrls: [], sourceState: null, allowSleeperFetch: true,
};
const env = {
  QB_OBSERVATION_ENABLED: 'true',
  QB_OBSERVATION_SECRET: secret,
  QB_OBSERVATION_SUPABASE_URL: url,
  QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY: key,
};
const event = { source: 'aws.scheduler', 'detail-type': 'qb-observation', detail: { version: 1 } };
const rpcUrl = url + '/rest/v1/rpc/qb_observer_exchange';
const noNetwork = () => assert.fail('Unexpected network operation');

function make(options = {}) {
  return createScheduledObservationHandler({
    env, now: () => clock, fetcher: noNetwork, readSchedule: async () => gameWeek,
    collect: async () => ({ decisions: [], errors: [] }), ...options,
  });
}

function readExchange(destination, options, time = clock) {
  assert.equal(destination, rpcUrl);
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.apikey, key);
  assert.equal(options.headers.Authorization, undefined);
  const transport = JSON.parse(options.body);
  assert.deepEqual(Object.keys(transport), ['p_message', 'p_signature']);
  assert.equal(transport.p_signature, signObservation(transport.p_message, secret));
  const envelope = JSON.parse(transport.p_message);
  assert.match(envelope.nonce, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(envelope.timestamp, new Date(time).toISOString());
  return envelope;
}

test('the Scheduler contract and read-only RPC configuration fail closed before I/O', async () => {
  const http = { rawPath: '/api/cron/qb-observation', requestContext: { http: { method: 'POST' } } };
  assert.deepEqual(await deployedHandler(http), { status: 'failed', reason: 'unsupported_event' });
  assert.deepEqual(await make()({ ...event, ...http }), { status: 'failed', reason: 'unsupported_event' });
  assert.deepEqual(await make()({ ...event, detail: { version: 2 } }), { status: 'failed', reason: 'unsupported_event' });
  assert.deepEqual(await make({ env: { ...env, QB_OBSERVATION_ENABLED: 'false' } })(event), { status: 'inactive' });
  for (const settings of [
    { ...env, QB_OBSERVATION_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co.attacker.invalid' },
    { ...env, QB_OBSERVATION_SUPABASE_URL: url + '/rest/v1' },
    { ...env, QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_' + 's'.repeat(32) },
    { ...env, QB_OBSERVATION_SECRET: 'not-a-hex-key' },
    { ...env, SUPABASE_SERVICE_ROLE_KEY: 'fixture' },
    { ...env, QB_OBSERVATION_SUPABASE_SERVICE_ROLE_KEY: 'fixture' },
    { ...env, DATABASE_URL: 'fixture' },
  ]) {
    assert.deepEqual(await make({ env: settings })(event), { status: 'failed', reason: 'invalid_observation_configuration' });
  }
});

test('collects after a signed claim and re-signs the exact report for the sole database endpoint', async () => {
  const calls = [];
  const fetcher = async (destination, options) => {
    if (destination === SLEEPER_URL) {
      calls.push({ action: 'source' });
      assert.equal(options.method, 'GET');
      assert.equal(options.headers?.apikey, undefined);
      return Response.json({});
    }
    const message = readExchange(destination, options);
    calls.push(message);
    return message.action === 'claim'
      ? Response.json({ status: 'claimed', payload: snapshot })
      : Response.json({ status: 'stored' });
  };
  const worker = make({ fetcher, collect: async inputs => {
    const { baseline, allowSleeperFetch } = inputs;
    assert.equal(allowSleeperFetch, true);
    assert.deepEqual(baseline, snapshot.baseline);
    await inputs.fetcher(SLEEPER_URL);
    return { decisions: [], errors: [] };
  } });
  assert.deepEqual(await worker(event), { status: 'stored' });
  assert.deepEqual(calls.map(entry => entry.action), ['claim', 'source', 'report']);
  assert.notEqual(calls[0].nonce, calls[2].nonce);
  assert.deepEqual(Object.keys(calls[0]), ['action', 'timestamp', 'nonce']);
  assert.deepEqual(Object.keys(calls[2]), ['action', 'timestamp', 'nonce', 'report']);
  const payload = JSON.parse(calls[2].report);
  assert.equal(payload.mode, 'observation');
  assert.equal(payload.status, 'completed');
  assert.equal(payload.runId, snapshot.runId);
  assert.deepEqual(payload.httpRequests, { sources: 1 });
});

test('an unavailable, replayed or already claimed interval never reads a provider', async () => {
  for (const status of ['inactive', 'outside_window', 'already_dispatched', 'busy', 'replayed']) {
    let calls = 0;
    const run = make({
      fetcher: async () => { calls++; return Response.json({ status }); },
      readSchedule: noNetwork,
    });
    assert.deepEqual(await run(event), { status });
    assert.equal(calls, 1);
  }
});

test('the worker checks kickoff independently even when the claim has crossed it', async () => {
  const time = Date.parse(game.kickoffAt);
  const run = make({ now: () => time, readSchedule: noNetwork, fetcher: async (destination, options) => {
    const message = readExchange(destination, options, time);
    if (message.action === 'claim') {
      return Response.json({ status: 'claimed', payload: { ...snapshot, dispatchedAt: game.kickoffAt } });
    }
    const report = JSON.parse(message.report);
    assert.equal(report.status, 'skipped');
    assert.equal(report.reason, 'first_kickoff_reached');
    assert.deepEqual(report.httpRequests, { sources: 0 });
    return Response.json({ status: 'stored' });
  } });
  assert.deepEqual(await run(event), { status: 'stored' });
});

test('RPC failures, redirects and oversized replies are not retried or logged', async () => {
  for (const fetcher of [
    async () => new Response('private error response', { status: 502 }),
    async () => Response.redirect('https://untrusted.invalid'),
    async () => new Response('a'.repeat(256 * 1024 + 1)),
    async () => { throw new Error('private transport error'); },
  ]) {
    let calls = 0;
    const run = make({
      fetcher: async (...args) => { calls++; return fetcher(...args); },
      readSchedule: noNetwork,
    });
    assert.deepEqual(await run(event), { status: 'failed', reason: 'claim_failed' });
    assert.equal(calls, 1);
  }

  let calls = 0;
  const run = make({ fetcher: async (destination, options) => {
    calls++;
    const message = readExchange(destination, options);
    if (message.action === 'claim') return Response.json({ status: 'claimed', payload: snapshot });
    throw new Error('private lost response');
  } });
  assert.deepEqual(await run(event), { status: 'failed', reason: 'report_failed' });
  assert.equal(calls, 2);
});
