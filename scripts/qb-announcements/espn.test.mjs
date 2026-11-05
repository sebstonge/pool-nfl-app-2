import assert from 'node:assert/strict';
import test from 'node:test';
import { qbRoster, readWeek, rotateClubs } from './espn.mjs';

const teams = { ARI: { espnId: '22' }, SEA: { espnId: '26' }, BAL: { espnId: '33' }, JAX: { espnId: '30' } };
const season = { year: 2026, type: 2 };
const week = { number: 9 };
const event = (id, date, sides, extra = {}) => ({
  id, date, season, week,
  competitions: [{
    date, status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
    competitors: sides.map(abbr => ({ team: { id: teams[abbr].espnId } })),
    ...extra,
  }],
});
const games = [
  event('401873048', '2026-11-08T21:25:00Z', ['ARI', 'SEA']),
  event('401873037', '2026-11-06T01:15:00Z', ['JAX', 'BAL'], { is_pool_eligible: false }),
];
const mockWeek = events => async url => new Response(JSON.stringify(
  new URL(url).pathname.endsWith('/events')
    ? { count: 2, pageIndex: 1, pageCount: 1, pageSize: 100, items: games.map(game => ({
      $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${game.id}`,
    })) }
    : { season, week, events },
));

test('freeze comes from the complete NFL week, including a non-pool game', async () => {
  const schedule = await readWeek(2026, 9, teams, mockWeek(games));
  assert.equal(schedule.firstKickoffAt, '2026-11-06T01:15:00.000Z');
  assert.equal(schedule.games[0].id, '401873037');
});

test('incomplete calendar or unresolved kickoff cannot authorize evidence', async () => {
  await assert.rejects(readWeek(2026, 9, teams, mockWeek(games.slice(0, 1))), /calendar incomplete/);
  const uncertain = [...games.slice(0, 1),
    event('401873037', '2026-11-06T01:15:00Z', ['JAX', 'BAL'], { timeValid: false })];
  await assert.rejects(readWeek(2026, 9, teams, mockWeek(uncertain)), /kickoff unresolved/);
});

test('roster retains exact QB IDs and keeps Active separate from injury status', () => {
  const payload = {
    team: { id: '26' },
    athletes: [{ items: [
      { id: '3912547', fullName: 'Sam Darnold', position: { abbreviation: 'QB' },
        status: { name: 'Active' }, injuries: [{ status: 'Out', date: '2026-11-04T19:02:00Z' }] },
      { id: '3924327', fullName: 'Drew Lock', position: { abbreviation: 'QB' },
        status: { name: 'Active' }, injuries: [{ status: 'Questionable', date: '2026-11-04T19:03:00Z' }] },
      { id: '123', fullName: 'Other Player', position: { abbreviation: 'RB' } },
    ] }],
  };
  assert.deepEqual(qbRoster(payload, '26', '2026-11-05T15:00:00Z'), [
    { id: '3912547', name: 'Sam Darnold', status: 'Active', availability: 'Out' },
    { id: '3924327', name: 'Drew Lock', status: 'Active', availability: 'Questionable' },
  ]);
  assert.throws(() => qbRoster(payload, '22', '2026-11-05T15:00:00Z'), /another team/);
  payload.athletes[0].items.push(payload.athletes[0].items[0]);
  assert.throws(() => qbRoster(payload, '26', '2026-11-05T15:00:00Z'), /duplicated/);
});

test('rotates a bounded club subset across two-hour cycles and skips bye teams', () => {
  const fixtures = Array.from({ length: 16 }, (_, i) => ({
    teams: [`T${i * 2}`, `T${i * 2 + 1}`],
  }));
  const t = Date.parse('2026-11-05T12:00:00Z');
  const seen = new Set();
  for (let n = 0; n < 8; n++) {
    const clubs = rotateClubs(fixtures, new Date(t + n * 7_200_000).toISOString(), ['BYE']);
    assert.equal(clubs.length, 4);
    clubs.forEach(team => seen.add(team));
  }
  assert.equal(seen.size, 32);
  assert.equal(seen.has('BYE'), false);
  assert.equal(rotateClubs(fixtures, new Date(t).toISOString(), ['T12'])[0], 'T12');
});
