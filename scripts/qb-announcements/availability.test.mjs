import assert from 'node:assert/strict';
import test from 'node:test';
import { collectFreeSources } from './availability.mjs';
import { DAY_MS, emptySourceState, readSleeper, SLEEPER_URL, unavailable, validSourceState } from './sleeper.mjs';

const time = Date.parse('2026-11-17T17:00:00Z');
const mariota = { id: '2576980', name: 'Marcus Mariota' };
const daniels = { id: '4426348', name: 'Jayden Daniels' };
const allen = { id: '3918298', name: 'Josh Allen' };
const schedule = { games: [{ id: '5001', teams: ['WAS', 'BUF'], kickoffAt: '2026-11-20T01:15:00Z', phase: 'pre' }] };
const openedAt = '2026-11-17T13:00:00Z';
const player = (qb, team, injury_status = null, status = 'Active') =>
  ({ full_name: qb.name, espn_id: qb.id, team, position: 'QB', status, injury_status });
const data = (injury = null) => ({ a: player(mariota, 'WAS', injury), b: player(daniels, 'WSH'), c: player(allen, 'BUF') });
const projection = { team: 'WAS', newQB: daniels };
async function run({ players = data(), sourceState, now = time, proposals = [], fetcher } = {}) {
  return collectFreeSources({ season: 2026, schedule, baseline: { WAS: mariota, BUF: allen }, sourceState,
    openedAt, allowSleeperFetch: true, now: () => now, fetcher: fetcher ?? (async url => { assert.equal(url, SLEEPER_URL); return Response.json(players); }),
    projections: async () => ({ decisions: proposals, errors: [] }) });
}

test('unchanged identities are retained without a review for every team; Active is not starter proof', async () => {
  const result = await run();
  assert.equal(result.counts.retained, 2);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.sourceState.absences, []);
  assert.ok(validSourceState(result.sourceState, time));
});

test('a scoped Out excludes a team without automatically promoting its projected backup', async () => {
  const result = await run({ players: data('Out'), proposals: [projection] });
  assert.equal(result.counts.excluded, 1);
  assert.equal(result.decisions[0].reason, 'sleeper_unavailable');
  assert.equal(result.decisions[0].status, 'ambiguous');
  assert.equal(result.decisions[0].newQB.id, daniels.id);
  assert.deepEqual(result.sourceState.absences.map(row => row.id), [mariota.id]);
  assert.equal(result.decisions[0].publishedAt, undefined);
});

test('confirmed absence without any reliable replacement keeps the team without an offer', async () => {
  const result = await run({ players: data('Out') });
  assert.equal(result.counts.excluded, 1);
  assert.equal(result.decisions[0].newQB, null);
  assert.equal(result.decisions[0].espnAthleteId, null);
});

test('projection alone, depth rank and Active can only produce an Admin review', async () => {
  const result = await run({ proposals: [projection] });
  assert.equal(result.decisions[0].reason, 'nflverse_projection');
  assert.equal(result.decisions[0].status, 'ambiguous');
  assert.equal(result.counts.excluded, 0);
  assert.deepEqual(result.sourceState.absences, []);
});

test('a projected player reported Out is contradictory and cannot be promoted', async () => {
  const players = data(); players.b.injury_status = 'Out';
  const result = await run({ players, proposals: [projection] });
  assert.equal(result.decisions[0].reason, 'source_conflict');
  assert.equal(result.decisions[0].newQB, null);
});

test('a cold start reuses the signed daily cache without another Sleeper request', async () => {
  const first = await run();
  const next = await run({ sourceState: structuredClone(first.sourceState), now: time + 2 * 3_600_000,
    fetcher: async () => assert.fail('Second daily GET forbidden') });
  assert.deepEqual(next.sourceState.sleeper, first.sourceState.sleeper);
});

test('daily refresh is permitted after a full 24 hours, not after a calendar date boundary', async () => {
  const first = await run(); let calls = 0;
  const next = await run({ sourceState: first.sourceState, now: time + DAY_MS,
    fetcher: async () => { calls++; return Response.json(data()); } });
  assert.equal(calls, 1);
  assert.equal(Date.parse(next.sourceState.sleeper.fetchedAt), time + DAY_MS);
});

test('HTTP 429 retains Retry-After and records the attempt to prevent automatic repeated daily reads', async () => {
  const first = await run({ fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': '7200' } }) });
  assert.equal(first.errors[0].status, 429);
  assert.equal(first.errors[0].retryAfter, '7200');
  assert.equal(first.sourceState.sleeper.fetchedAt, null);
  const next = await run({ sourceState: first.sourceState, now: time + 3_600_000,
    fetcher: async () => assert.fail('No immediate daily retry') });
  assert.equal(next.counts.excluded, 0);
});

test('removing Out or returning Active never clears an established absence', async () => {
  const first = await run({ players: data('Out') });
  const next = await run({ sourceState: first.sourceState, now: time + DAY_MS, players: data() });
  assert.equal(next.decisions[0].reason, 'sleeper_return_review');
  assert.equal(next.counts.excluded, 1);
  assert.equal(next.sourceState.absences[0].since, first.sourceState.absences[0].since);
});

test('new week and unavailable provider do not reintroduce an absent QB', async () => {
  const first = await run({ players: data('Out') });
  const next = await run({ sourceState: first.sourceState, now: time + 7 * DAY_MS,
    fetcher: async () => { throw new Error('Source unavailable'); } });
  assert.equal(next.counts.excluded, 1);
  assert.equal(next.sourceState.absences[0].id, mariota.id);
  assert.equal(next.sourceState.absences[0].since, first.sourceState.absences[0].since);
});

test('a fresh same absence does not reset since; a new injury after return can reset it', async () => {
  const first = await run({ players: data('Out') });
  const unchanged = await run({ sourceState: first.sourceState, now: time + DAY_MS, players: data('Out') });
  assert.equal(unchanged.sourceState.absences[0].since, first.sourceState.absences[0].since);
  const returned = await run({ sourceState: unchanged.sourceState, now: time + 2 * DAY_MS, players: data() });
  const injured = await run({ sourceState: returned.sourceState, now: time + 3 * DAY_MS, players: data('Out') });
  assert.equal(Date.parse(injured.sourceState.absences[0].since), time + 3 * DAY_MS);
});

test('missing/invalid ESPN ID, mismatched name or different team cannot establish an absence', async () => {
  for (const change of [{ espn_id: '' }, { team: 'BAL' }, { full_name: 'Someone Else' }]) {
    const players = data('Out'); Object.assign(players.a, change);
    const result = await run({ players });
    assert.deepEqual(result.sourceState.absences, []);
  }
});

test('missing/old cache and missing data never create a starter confirmation or erase a last reliable offer', async () => {
  const state = emptySourceState(time - 2 * DAY_MS);
  const result = await run({ sourceState: state, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(result.counts.excluded, 0);
  assert.deepEqual(result.sourceState.absences, []);
  assert.equal(result.counts.retained, 2);
});

test('an Out snapshot from before week opening cannot establish a new match-scoped absence', async () => {
  const state = emptySourceState(time);
  state.sleeper = { attemptedAt: '2026-11-17T12:00:00Z', fetchedAt: '2026-11-17T12:00:00Z', players: [
    { id: mariota.id, name: mariota.name, team: 'WAS', status: 'Active', injuryStatus: 'Out' },
  ] };
  const result = await run({ sourceState: state, fetcher: async () => assert.fail('Cache must be used') });
  assert.deepEqual(result.sourceState.absences, []);
  assert.equal(result.decisions[0].reason, 'source_missing');
  assert.equal(result.counts.excluded, 0);
});

test('inactive, probable and practice status never count as established absence or starter confirmation', () => {
  for (const status of ['Inactive', 'Active', 'Probable', 'Questionable', 'Doubtful', null]) {
    assert.equal(unavailable({ status }), false);
  }
  for (const status of ['Out', 'IR', 'PUP', 'Suspended']) assert.equal(unavailable({ injuryStatus: status }), true);
});

test('source metadata is compact and does not trust undocumented provider timestamps or retain full payloads', async () => {
  const players = data(); players.a.updated_at = '2099-01-01'; players.a.news = 'Do not archive';
  const result = await run({ players });
  assert.ok(!JSON.stringify(result.sourceState).includes('2099-01-01'));
  assert.ok(!JSON.stringify(result.sourceState).includes('Do not archive'));
});

test('source-state boundary refuses future timestamps, duplicate IDs and oversized caches', async () => {
  const result = await run();
  const future = structuredClone(result.sourceState); future.sleeper.fetchedAt = '2099-01-01T00:00:00Z';
  assert.equal(validSourceState(future, time), false);
  const duplicate = structuredClone(result.sourceState); duplicate.sleeper.players.push(duplicate.sleeper.players[0]);
  assert.equal(validSourceState(duplicate, time), false);
  const large = structuredClone(result.sourceState); large.sleeper.players = Array(257).fill(large.sleeper.players[0]);
  assert.equal(validSourceState(large, time), false);
});

test('collector preserves the caller trusted source snapshot for request/retry validation', async () => {
  const state = emptySourceState(time); const saved = structuredClone(state);
  await run({ players: data('Out'), sourceState: state });
  assert.deepEqual(state, saved);
});

test('a lost previous response or exhausted daily claim cannot cause another Sleeper GET', async () => {
  const result = await collectFreeSources({ season: 2026, schedule, baseline: { WAS: mariota, BUF: allen },
    sourceState: null, openedAt, allowSleeperFetch: false, now: () => time,
    fetcher: async () => assert.fail('Durable claim forbids another daily GET'),
    projections: async () => ({ decisions: [], errors: [] }) });
  assert.deepEqual(result.sourceState.absences, []);
  assert.equal(result.sourceState.sleeper.attemptedAt, null);
});
