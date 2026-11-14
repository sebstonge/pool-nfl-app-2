import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQbWeeklyHistory, compactQbSelections } from './history.mjs';

const qb = (id, name = id) => ({ id: `actual-${id}`, name, espn_athlete_id: id });
const pick = (week, name = 'Jalen Hurts', id = 'hurts', user = 'katy', extra = {}) => ({
  id: `${user}-${week}`, season: 2026, week, qb_id: 'mutable-eagles-slot', user_id: user,
  selected_qb_name: name, selected_espn_athlete_id: id, selected_team: 'Eagles', ...extra,
});
const rating = (week, name = 'Jalen Hurts', id = 'hurts', value = 100, extra = {}) => ({
  season: 2026, week, qb_id: 'mutable-eagles-slot', actual_qb_name: name,
  actual_espn_athlete_id: id, passer_rating: value, ...extra,
});
const stat = (week, id = 'hurts', value = 100, extra = {}) => ({
  season: 2026, week, espn_athlete_id: id, passer_rating: value, ...extra,
});
const users = [{ id: 'katy', display_name: 'Katy', real_name: 'Katherine' },
  { id: 'sam', email: 'sam@example.test' }];
const build = (target, data = {}) => buildQbWeeklyHistory({ qb: target, season: 2026, users, ...data });

test('Hurts W1/W2/W3 remain normal after the catalog slot has become McKee', () => {
  const picks = [3, 1, 2].map(week => pick(week, undefined, undefined, undefined, {
    qbs: { name: 'Tanner McKee', espn_athlete_id: 'mckee', active: false },
  }));
  const result = build(qb('hurts'), { picks, ratings: [1, 2, 3].map(week => rating(week)) });
  assert.deepEqual(result.map(row => row.week), [1, 2, 3]);
  for (const row of result) {
    const participant = row.participants[0];
    assert.equal(participant.selected.name, 'Jalen Hurts');
    assert.equal(participant.actual.name, 'Jalen Hurts');
    assert.equal(participant.replaced, false);
    assert.equal(participant.replacementKnown, true);
    assert.equal(participant.creditedRating, 100);
  }
});

for (const [week, selectedName, selectedId, actualName, actualId] of [
  [2, 'Sam Darnold', 'darnold', 'Drew Lock', 'lock'],
  [2, 'Tua Tagovailoa', 'tua', 'Cooper Rush', 'rush'],
  [6, 'Jalen Hurts', 'hurts', 'Tanner McKee', 'mckee'],
  [6, 'Lamar Jackson', 'lamar', 'Tyler Huntley', 'huntley'],
]) {
  test(`${selectedName} → ${actualName} retains both identities and the actual credited rating`, () => {
    const data = {
      picks: [pick(week, selectedName, selectedId)],
      ratings: [rating(week, actualName, actualId, 104.2)],
      weeklyStats: [stat(week, selectedId, 52), stat(week, actualId, 104.2)],
    };
    for (const target of [selectedId, actualId]) {
      const row = build(qb(target), data)[0];
      assert.equal(row.nflRating, target === selectedId ? 52 : 104.2);
      assert.equal(row.participants.length, 1);
      assert.equal(row.participants[0].selected.name, selectedName);
      assert.equal(row.participants[0].actual.name, actualName);
      assert.equal(row.participants[0].creditedRating, 104.2);
      assert.equal(row.participants[0].replaced, true);
      assert.equal(row.participants[0].displayName, 'Katy');
    }
  });
}

test('all selectors are retained without duplicating a selection present twice in input', () => {
  const first = pick(2);
  const result = build(qb('hurts'), {
    picks: [first, pick(2, undefined, undefined, 'sam'), first], ratings: [rating(2)],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].participants.map(row => row.displayName), ['Katy', 'sam']);
  assert.deepEqual(result[0].participants.map(row => row.realName), ['Katherine', '']);
  assert.deepEqual(result[0].participants.map(row => row.pickId), ['katy-2', 'sam-2']);
});

test('zero is a real NFL and credited rating; pending results stay null', () => {
  const result = build(qb('hurts'), {
    picks: [pick(1), pick(2), pick(3)], ratings: [rating(1, undefined, undefined, 0), rating(2, undefined, undefined, null)],
    weeklyStats: [stat(1, 'hurts', 0), stat(2, 'hurts', null), stat(3, 'hurts', '')],
  });
  assert.deepEqual(result.map(row => [row.nflRating, row.participants[0].creditedRating]), [[0, 0], [null, null], [null, null]]);
  assert.equal(result[1].participants[0].actual, null);
  assert.equal(result[2].participants[0].replaced, false);
});

test('NFL weeks without a pool selector do not invent a participant', () => {
  const result = build(qb('purdy', 'Brock Purdy'), {
    weeklyStats: [stat(6, 'purdy', 111.9), stat(7, 'purdy', null), stat(8, 'other', 90)],
  });
  assert.deepEqual(result, [{ season: 2026, week: 6, nflRating: 111.9, participants: [] }]);
});

test('another season with identical slot, week and athlete IDs cannot leak into the history', () => {
  const result = build(qb('hurts'), {
    picks: [pick(1), pick(1, undefined, undefined, 'sam', { season: 2027, id: 'other-year' })],
    ratings: [rating(1, 'Other season QB', 'other', 158.3, { season: 2027 }), rating(1)],
    weeklyStats: [stat(1, 'hurts', 158.3, { season: 2027 }), stat(1, 'hurts', 100)],
  });
  assert.equal(result[0].season, 2026);
  assert.equal(result[0].nflRating, 100);
  assert.equal(result[0].participants.length, 1);
  assert.equal(result[0].participants[0].actual.name, 'Jalen Hurts');
  assert.equal(result[0].participants[0].creditedRating, 100);
});

test('known actual legacy QB does not invent a selection or replacement from today’s catalog', () => {
  const result = build(qb('hurts'), {
    picks: [pick(1, undefined, undefined, undefined, { selected_espn_athlete_id: null,
      qbs: { name: 'Tanner McKee', espn_athlete_id: 'mckee' } })], ratings: [rating(1)],
  });
  assert.equal(result[0].participants[0].selected, null);
  assert.equal(result[0].participants[0].actual.name, 'Jalen Hurts');
  assert.equal(result[0].participants[0].replaced, false);
  assert.equal(result[0].participants[0].replacementKnown, false);
});

test('legacy unknown card is scoped to its exact historical slot and week', () => {
  const result = build({ id: 'actual-unknown-mutable-eagles-slot-1', espn_athlete_id: null }, {
    picks: [pick(1, undefined, undefined, undefined, { selected_qb_name: null }), pick(2)],
    ratings: [rating(1, null, null, 88.4), rating(2)],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].week, 1);
  assert.equal(result[0].participants[0].selected, null);
  assert.equal(result[0].participants[0].actual.name, 'QB historique non identifié');
  assert.equal(result[0].participants[0].creditedRating, 88.4);
  assert.equal(result[0].participants[0].replaced, false);
});

test('foreign result tuples cannot supply a credited rating to a pending selection', () => {
  const result = build(qb('hurts'), {
    picks: [pick(2)], ratings: [rating(1), rating(2, 'Other QB', 'other', 155, { qb_id: 'other-slot' })],
  });
  assert.equal(result[0].participants[0].creditedRating, null);
  assert.equal(result[0].participants[0].actual, null);
});

test('presentation leaves picks, results, NFL stats and user records unchanged', () => {
  const data = { qb: qb('hurts'), season: 2026, picks: [pick(3), pick(1)],
    ratings: [rating(1), rating(3)], weeklyStats: [stat(3), stat(1)], users };
  const before = structuredClone(data);
  buildQbWeeklyHistory(data);
  assert.deepEqual(data, before);
});

test('empty data or invalid season creates no fabricated weeks', () => {
  assert.deepEqual(build(qb('hurts')), []);
  assert.deepEqual(buildQbWeeklyHistory({ qb: qb('hurts'), season: undefined, picks: [pick(1)] }), []);
});

const selection = (id, value, name = id) => ({ pickId: id, userId: id,
  displayName: name, creditedRating: value, replaced: false });
const historyWeek = (week, participants, season = 2026) => ({ season, week, nflRating: 158.3, participants });

test('compact list contains selections only, sorted by credited rating with zero before pending results', () => {
  const history = [historyWeek(1, []), historyWeek(2, [selection('zero', 0)]),
    historyWeek(8, [selection('high', 153.3)]), historyWeek(9, [selection('mid', 105)]),
    historyWeek(10, [selection('pending', null)])];
  const row = { history };
  const before = structuredClone(row);
  const entries = compactQbSelections(row);
  assert.deepEqual(entries.map(entry => [entry.pickId, entry.creditedRating]),
    [['high', 153.3], ['mid', 105], ['zero', 0], ['pending', null]]);
  assert.deepEqual(row, before);
});

test('only exact summary selections are excluded, never all ties or identical participant names', () => {
  const history = [historyWeek(2, [selection('best', 100, 'Sam'), selection('tied-user', 100, 'Sam')]),
    historyWeek(3, [selection('tied-week', 100, 'Sam')]), historyWeek(4, [selection('worst', 0)])];
  const row = { history,
    best: { selected_pick_id: 'best', season: 2026, week: 2, passer_rating: '100' },
    worst: { selected_pick_id: 'worst', season: 2026, week: 4, passer_rating: 0 } };
  assert.deepEqual(compactQbSelections(row).map(entry => entry.pickId), ['tied-week', 'tied-user']);
});

test('a summary needs matching selection, season, week and credited result before hiding an entry', () => {
  const history = [historyWeek(6, [selection('pick', 77.5)])];
  for (const best of [
    { selected_pick_id: 'other', season: 2026, week: 6, passer_rating: 77.5 },
    { selected_pick_id: 'pick', season: 2027, week: 6, passer_rating: 77.5 },
    { selected_pick_id: 'pick', season: 2026, week: 5, passer_rating: 77.5 },
    { selected_pick_id: 'pick', season: 2026, week: 6, passer_rating: 78 },
    { season: 2026, week: 6, passer_rating: 77.5 },
    { selected_pick_id: 'pick', week: 6, passer_rating: 77.5 },
  ]) assert.equal(compactQbSelections({ history, best }).length, 1);
});

test('one or two fully represented selections yield no duplicate detail, even if both summaries share an entry', () => {
  const best = { selected_pick_id: 'one', season: 2026, week: 1, passer_rating: 100 };
  const worst = { selected_pick_id: 'two', season: 2026, week: 2, passer_rating: 50 };
  assert.deepEqual(compactQbSelections({ history: [historyWeek(1, [selection('one', 100)])], best, worst: best }), []);
  assert.deepEqual(compactQbSelections({ history: [historyWeek(1, [selection('one', 100)]), historyWeek(2, [selection('two', 50)])], best, worst }), []);
});

test('a replacement line retains the actual credited rating instead of the selected QB NFL rating', () => {
  const row = { history: build(qb('hurts'), { picks: [pick(6)], ratings: [rating(6, 'Tanner McKee', 'mckee', 77.5)],
    weeklyStats: [stat(6, 'hurts', 52)] }) };
  const entries = compactQbSelections(row);
  assert.equal(entries[0].creditedRating, 77.5);
  assert.equal(entries[0].replaced, true);
  assert.equal(entries[0].selected.name, 'Jalen Hurts');
  assert.equal(entries[0].actual.name, 'Tanner McKee');
});
