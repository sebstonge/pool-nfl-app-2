import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRounds, hasCompleteSubmission, loadPersonalTree } from './treeData.mjs';

const games = [1, 2, 3].map(id => ({ id, round_id: 'wc', external_game_id: `TEST-${id}`, away_team: 'Packers', home_team: 'Bears' }));
const picks = games.map(game => ({ user_id: 'me', game_id: game.id, picked_team: 'Bears', predicted_spread: 7 }));
const paths = [{ user_id: 'me', round_id: 'wc', team: 'Bears', multiplier: 1 }];
const qbPicks = [{ user_id: 'me', round_id: 'wc', qb_id: 'qb' }];
const complete = { userId: 'me', roundId: 'wc', games, picks, paths, qbPicks };

test('only a full persisted submission opens the tree', () => {
  assert.equal(hasCompleteSubmission(complete), true);
  for (const partial of [{ picks: [] }, { picks: picks.slice(0, 1) }, { picks: picks.slice(0, 2) }, { paths: [] }, { qbPicks: [] }, { games: [] }, { userId: 'other' }, { roundId: 'div' }]) {
    assert.equal(hasCompleteSubmission({ ...complete, ...partial }), false);
  }
});
test('invalid choices do not count; zero spread is not treated as missing', () => {
  assert.equal(hasCompleteSubmission({ ...complete, picks: picks.map(p => ({ ...p, predicted_spread: 0 })) }), true);
  assert.equal(hasCompleteSubmission({ ...complete, picks: picks.map(p => ({ ...p, picked_team: 'Unknown' })) }), false);
  assert.equal(hasCompleteSubmission({ ...complete, picks: picks.map(p => ({ ...p, predicted_spread: null })) }), false);
});
test('three TEST games stay visible and future rounds stay empty without inferred paths', () => {
  const result = buildRounds({ rounds: [{ id: 'wc', round_key: 'wild_card' }, { id: 'div', round_key: 'divisional' }], games, picks, paths });
  assert.equal(result.length, 4);
  assert.equal(result[0].games.length, 3);
  assert.equal(result[0].path.multiplier, 1);
  for (const round of result.slice(1)) { assert.deepEqual(round.games, []); assert.equal(round.path, null); }
});
test('later games and persisted multipliers are displayed without extrapolation', () => {
  const result = buildRounds({ rounds: [{ id: 'div', round_key: 'divisional' }], games: [{ id: 4, round_id: 'div' }], picks: [], paths: [{ round_id: 'div', team: 'Bills', multiplier: 1.5 }] });
  assert.equal(result[1].games.length, 1);
  assert.equal(result[1].path.multiplier, 1.5);
  assert.equal(result[2].path, null);
});
test('loader scopes private rows to the viewer and propagates read errors', async () => {
  const calls = [];
  const tables = { playoff_rounds: [{ id: 'wc', season: 2026, round_key: 'wild_card' }], playoff_games: games, playoff_picks: picks, playoff_team_paths: paths, playoff_qb_picks: qbPicks };
  const client = { from(table) {
    const query = { select() { return query; }, eq(key, value) { calls.push([table, key, value]); return query; }, in() { return query; }, order() { return query; }, then(resolve) { return Promise.resolve({ data: tables[table], error: null }).then(resolve); } };
    return query;
  } };
  const result = await loadPersonalTree(client, { season: 2026, roundId: 'wc', userId: 'me' });
  assert.equal(result.complete, true);
  for (const table of ['playoff_picks', 'playoff_team_paths', 'playoff_qb_picks']) assert.ok(calls.some(call => call[0] === table && call[1] === 'user_id' && call[2] === 'me'));
  const broken = { from() { const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ error: new Error('denied') }) }; return q; } };
  await assert.rejects(loadPersonalTree(broken, { season: 2026, roundId: 'wc', userId: 'me' }), /denied/);
});
