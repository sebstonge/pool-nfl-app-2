import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveFinalSignal, isFinalEspnCompetition } from './liveFinalSignal.mjs';

const first = '12345678-1234-1234-1234-123456789001';
const second = '12345678-1234-1234-1234-123456789002';
const session = token => ({ data: { session: token ? { access_token: token } : null } });
const acknowledged = (retryGameIds = []) => ({ ok: true, json: async () => ({ retryGameIds }) });

test('the live hint recognizes only completed ESPN FINAL competitions, including overtime', () => {
  const competition = (state, completed, name) => ({ status: { type: { state, completed, name } } });
  for (const name of ['STATUS_FINAL', 'STATUS_FINAL_OVERTIME', 'STATUS_FINAL_OT', 'STATUS_FINAL_2OT']) {
    assert.equal(isFinalEspnCompetition(competition('post', true, name)), true);
  }
  for (const value of [
    undefined, competition('post', true, 'STATUS_CANCELED'),
    competition('post', false, 'STATUS_FINAL'), competition('in', true, 'STATUS_FINAL'),
    competition('post', 'true', 'STATUS_FINAL'),
  ]) assert.equal(isFinalEspnCompetition(value), false);
});

test('the hint batches only unique game IDs, with the existing session and no result payload', async () => {
  const requests = [];
  let authReads = 0;
  const signal = createLiveFinalSignal({
    getSession: async () => { authReads++; return session('participant-token'); },
  }, async (url, init) => {
    requests.push({ url, init });
    return acknowledged();
  });
  await signal([]);
  assert.equal(authReads, 0);
  await signal([first, 'invalid', second, first]);
  await signal([second, first]);
  assert.equal(authReads, 1);
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, '/api/push/qb-final');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer participant-token');
  assert.deepEqual(JSON.parse(init.body), { gameIds: [first, second] });
});

test('overlapping refreshes never dispatch another in-flight hint', async () => {
  let requests = 0;
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const signal = createLiveFinalSignal({ getSession: async () => session('participant-token') }, () => {
    requests++;
    return result;
  });
  const initial = signal([first]);
  await signal([first]);
  finish(acknowledged());
  await initial;
  await signal([first]);
  assert.equal(requests, 1);
});

test('only matches whose data remain incomplete are retried in the next existing refresh', async () => {
  const batches = [];
  const signal = createLiveFinalSignal({ getSession: async () => session('participant-token') }, async (_url, init) => {
    batches.push(JSON.parse(init.body).gameIds);
    return acknowledged(batches.length === 1 ? [second] : []);
  });
  await signal([first, second]);
  await signal([first, second]);
  await signal([first, second]);
  assert.deepEqual(batches, [[first, second], [second]]);
});

test('network errors and missing sessions leave the hints retryable', async () => {
  let token;
  let requests = 0;
  const signal = createLiveFinalSignal({ getSession: async () => session(token) }, async () => {
    requests++;
    if (requests === 1) throw new Error('unavailable');
    return acknowledged();
  });
  await signal([first]);
  assert.equal(requests, 0);
  token = 'participant-token';
  await signal([first]);
  await signal([first]);
  await signal([first]);
  assert.equal(requests, 2);
});

test('a denied session does not keep making requests with the same token', async () => {
  for (const status of [401, 403]) {
    let token = 'rejected-token';
    const attempts = [];
    const signal = createLiveFinalSignal({ getSession: async () => session(token) }, async (_url, init) => {
      attempts.push(init.headers.Authorization);
      return token === 'rejected-token' ? { ok: false, status } : acknowledged();
    });
    await signal([first]);
    await signal([first]);
    token = 'renewed-token';
    await signal([first]);
    assert.deepEqual(attempts, ['Bearer rejected-token', 'Bearer renewed-token']);
  }
});
