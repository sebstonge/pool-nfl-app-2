import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHomeSeasonalSchedule } from './homeSchedule.mjs';

function fixture({ settings = { current_season: 2026, current_week: 12, phase: 'regular' }, games = [], settingsError = null, gamesError = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      const query = {
        select(columns) { calls.push(['select', columns]); return query; },
        eq(column, value) { calls.push(['eq', column, value]); return query; },
        single() { calls.push(['single']); return Promise.resolve({ data: settings, error: settingsError }); },
        then(resolve, reject) { return Promise.resolve({ data: games, error: gamesError }).then(resolve, reject); },
      };
      return query;
    },
  };
  return { client, calls };
}

test('home seasonal schedule uses only the explicit current season and active week', async () => {
  const games = [{ season: 2026, week: 12, game_date: '2026-11-26T18:00:00Z', is_pool_eligible: true }];
  const { client, calls } = fixture({ games });
  assert.deepEqual(await loadHomeSeasonalSchedule(client), { games, season: 2026, activeWeek: 12 });
  assert.deepEqual(calls, [
    ['from', 'settings'], ['select', 'current_season,current_week,phase'], ['eq', 'id', 1], ['single'],
    ['from', 'games'], ['select', 'season,week,game_date,is_pool_eligible'],
    ['eq', 'season', 2026], ['eq', 'week', 12], ['eq', 'is_pool_eligible', true],
  ]);
});

test('playoffs, offseason and unknown phase never read the regular schedule', async () => {
  for (const phase of ['playoffs', 'offseason', null]) {
    const { client, calls } = fixture({ settings: { current_season: 2027, current_week: 1, phase } });
    assert.deepEqual(await loadHomeSeasonalSchedule(client), { games: [], season: 2027, activeWeek: 1 });
    assert.equal(calls.some(call => call[0] === 'from' && call[1] === 'games'), false);
  }
});

test('no season max or fallback: a new active season is filtered explicitly', async () => {
  const { client, calls } = fixture({ settings: { current_season: 2027, current_week: 1, phase: 'regular' } });
  assert.deepEqual(await loadHomeSeasonalSchedule(client), { games: [], season: 2027, activeWeek: 1 });
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'season' && call[2] === 2027));
  assert.equal(calls.some(call => call[0] === 'order' || call[0] === 'limit' || call[0] === 'rpc'), false);
});

test('settings read failure is propagated without querying games', async () => {
  const error = new Error('settings unavailable');
  const { client, calls } = fixture({ settingsError: error });
  await assert.rejects(loadHomeSeasonalSchedule(client), value => value === error);
  assert.equal(calls.some(call => call[0] === 'from' && call[1] === 'games'), false);
});

test('missing settings or invalid regular context is rejected instead of guessing', async () => {
  for (const settings of [null, { phase: 'regular', current_season: null, current_week: 12 }, { phase: 'regular', current_season: 2026, current_week: 0 }]) {
    const { client, calls } = fixture({ settings });
    await assert.rejects(loadHomeSeasonalSchedule(client));
    assert.equal(calls.some(call => call[0] === 'from' && call[1] === 'games'), false);
  }
});

test('schedule read errors propagate while an empty result remains harmless', async () => {
  const error = new Error('schedule unavailable');
  const failed = fixture({ gamesError: error });
  await assert.rejects(loadHomeSeasonalSchedule(failed.client), value => value === error);
  const empty = fixture({ games: null });
  assert.deepEqual(await loadHomeSeasonalSchedule(empty.client), { games: [], season: 2026, activeWeek: 12 });
});
