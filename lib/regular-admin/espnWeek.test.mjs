import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEspnStandings, prepareEspnWeek } from './espnWeek.mjs';

const season = 2026;
const week = 12;
const teams = [
  { id: 'was', name: 'Washington Commanders', espn_abbr: 'WAS' },
  { id: 'buf', name: 'Buffalo Bills', espn_abbr: 'BUF' },
  { id: 'sea', name: 'Seattle Seahawks', espn_abbr: 'SEA' },
  { id: 'lar', name: 'Los Angeles Rams', espn_abbr: 'LAR' },
];
const game = (id, home, away, props = {}) => ({
  id: `game-${id}`, external_game_id: id, home_team: home.name, away_team: away.name,
  season, week, season_type: 'regular', is_pool_eligible: true, ...props,
});
const eligible = game('501', teams[0], teams[1]);
const qbOnly = game('502', teams[2], teams[3], { is_pool_eligible: false });
const pick = {
  qb_id: 'catalogue-slot', season, week, selected_qb_name: 'Selected QB',
  selected_espn_athlete_id: '111', selected_team: 'Seahawks',
  qbs: { id: 'catalogue-slot', name: 'Current Catalogue QB', espn_athlete_id: '333', team: 'Bills' },
};
const state = (games, qb_picks = [], qb_ratings = []) =>
  ({ settings: { current_season: season, current_week: week }, games, qb_picks, qb_ratings });
const passer = (id, rating, name = `QB ${id}`) => ({ athlete: { id, displayName: name }, stats: [rating] });
const box = (id, abbreviation, athletes) =>
  ({ team: { id, abbreviation }, statistics: [{ name: 'passing', labels: ['RTG'], athletes }] });
function summary(localGame, homeAbbr, awayAbbr, players) {
  return {
    header: {
      id: localGame.external_game_id, season: { year: season, type: 2 }, week: { number: week },
      competitions: [{
        status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
        competitors: [
          { homeAway: 'home', score: '20', team: { id: '1', abbreviation: homeAbbr } },
          { homeAway: 'away', score: '20', team: { id: '2', abbreviation: awayAbbr } },
        ],
      }],
    },
    boxscore: { players: players ?? [box('1', homeAbbr, [passer('111', 100.7)]), box('2', awayAbbr, [passer('222', 71.8)])] },
  };
}

function provider(responses) {
  const calls = [];
  return {
    calls,
    fetcher: async url => {
      const event = new URL(url).searchParams.get('event');
      calls.push(event);
      const body = responses[event];
      if (body instanceof Error) throw body;
      if (!body) return { ok: false, status: 503 };
      return { ok: true, json: async () => structuredClone(body) };
    },
  };
}
const prepare = (input, fixture, mode = 'automatic') => prepareEspnWeek(input, { mode, teams, fetcher: fixture.fetcher });

test('a pool game with no selected QB still publishes a proven tie; the selected QB outside the pool gets a rating', async () => {
  const source = state([eligible, qbOnly, { ...eligible, season: 2025 }, { ...eligible, week: 11 }], [pick]);
  const standard = summary(eligible, 'WSH', 'BUF', [
    box('1', 'WSH', [passer('444', 70.5)]), box('2', 'BUF', [passer('555', 112.7)]),
  ]);
  const nonPool = summary(qbOnly, 'SEA', 'LA', [
    box('1', 'SEA', [passer('333', 92.4, 'Catalogue QB'), passer('111', '0', 'Selected QB')]),
    box('2', 'LA', [passer('222', 71.8)]),
  ]);
  nonPool.header.competitions[0].status.type.name = 'STATUS_FINAL_OVERTIME';
  const fixture = provider({ 501: standard, 502: nonPool });
  const result = await prepare(source, fixture);
  assert.deepEqual(fixture.calls.sort(), ['501', '502']);
  assert.deepEqual(result.games.map(row => [row.id, row.home_score, row.away_score, row.result_status]), [
    [eligible.id, 20, 20, 'final'], [qbOnly.id, 20, 20, 'final'],
  ]);
  assert.deepEqual(result.ratings, [{
    qb_id: 'catalogue-slot', game_id: qbOnly.id, passer_rating: 0,
    actual_qb_name: 'Selected QB', actual_espn_athlete_id: '111',
  }]);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.qbStats.some(row => row.team === teams[3].name && row.passer_rating === 71.8));
});

test('a live hint verifies only relevant requested games and retries only incomplete ones', async () => {
  const irrelevant = game('503', teams[0], teams[1], { is_pool_eligible: false });
  const previousWeek = game('504', teams[1], teams[3], { week: week - 1 });
  const alreadyFinal = game('506', teams[0], teams[3], { result_status: 'final', home_score: 21, away_score: 20 });
  const unrequested = game('507', teams[0], teams[1]);
  const input = state([eligible, qbOnly, irrelevant, previousWeek, alreadyFinal, unrequested], [pick]);
  // The non-pool boxscore lacks the selected QB rating. The pool FINAL is ready independently.
  const fixture = provider({
    501: summary(eligible, 'WAS', 'BUF'),
    502: summary(qbOnly, 'SEA', 'LAR', [box('1', 'SEA', [passer('111', null)])]),
  });
  const result = await prepareEspnWeek(input, { mode: 'automatic', teams, fetcher: fixture.fetcher,
    gameIds: new Set([eligible.id, qbOnly.id, irrelevant.id, previousWeek.id, alreadyFinal.id, 'unknown']),
  });
  assert.deepEqual(fixture.calls.sort(), ['501', '502']);
  assert.deepEqual(result.games.map(row => row.id), [eligible.id]);
  assert.deepEqual(result.retryGameIds, [qbOnly.id]);
  assert.equal(result.hasVerifiedGame, true);

  const noMatch = provider({});
  const ignored = await prepareEspnWeek(input, { mode: 'automatic', teams, fetcher: noMatch.fetcher,
    gameIds: new Set([irrelevant.id, previousWeek.id, 'unknown']),
  });
  assert.deepEqual(noMatch.calls, []);
  assert.equal(ignored.hasVerifiedGame, false);

  const saved = await prepareEspnWeek(input, { mode: 'automatic', teams, fetcher: noMatch.fetcher,
    gameIds: new Set([alreadyFinal.id]),
  });
  assert.deepEqual(noMatch.calls, []);
  assert.equal(saved.hasVerifiedGame, true);
});

test('the existing switch-off path only looks for missing selected-QB ratings and never returns ancillary stats', async () => {
  const fixture = provider({ 502: summary(qbOnly, 'SEA', 'LAR', [
    box('1', 'SEA', [passer('222', '98.4', 'Verified substitute'), passer('333', 105.6)]),
  ]) });
  const result = await prepare(state([eligible, qbOnly], [pick]), fixture, 'qb-only');
  assert.deepEqual(fixture.calls, ['502']);
  assert.deepEqual(result.qbStats, []);
  assert.equal(result.ratings[0].actual_qb_name, 'Verified substitute');
  assert.equal(result.ratings[0].actual_espn_athlete_id, '222');
  assert.equal(result.ratings[0].passer_rating, 98.4);
});

test('score and selected rating freeze separately; close rereads a previously recorded score, actual QB and rating', async () => {
  const stored = { ...qbOnly, home_score: 20, away_score: 20, result_status: 'final' };
  const rating = { qb_id: pick.qb_id, season, week, passer_rating: 80, actual_qb_name: 'Previously credited', actual_espn_athlete_id: '111' };
  const correction = summary(qbOnly, 'SEA', 'LAR', [box('1', 'SEA', [passer('222', 125, 'Corrected ESPN QB')])]);
  correction.header.competitions[0].competitors[0].score = '27';
  const fixture = provider({ 502: correction });
  const replay = await prepare(state([stored], [pick], [rating]), fixture);
  assert.deepEqual(replay.games, []);
  assert.deepEqual(replay.ratings, []);
  assert.deepEqual(fixture.calls, []);
  const previouslyRated = await prepare(state([qbOnly], [pick], [rating]), fixture);
  assert.equal(previouslyRated.games[0].home_score, 27);
  assert.deepEqual(previouslyRated.ratings, []);
  const missingRating = await prepare(state([stored], [pick]), fixture);
  assert.equal(missingRating.ratings[0].actual_espn_athlete_id, '222');
  const close = await prepare(state([stored], [pick], [rating]), fixture, 'close');
  assert.equal(close.games[0].home_score, 27);
  assert.deepEqual(close.ratings[0], {
    qb_id: pick.qb_id, game_id: stored.id, passer_rating: 125,
    actual_qb_name: 'Corrected ESPN QB', actual_espn_athlete_id: '222',
  });
  assert.deepEqual(fixture.calls, ['502', '502', '502']);
});
test('QB-only proofs can recover a missing push reservation without restaging a saved rating', async () => {
  const rating = { qb_id: pick.qb_id, season, week, passer_rating: 80,
    actual_qb_name: 'Previously credited', actual_espn_athlete_id: '111' };
  const fixture = provider({ 502: summary(qbOnly, 'SEA', 'LAR') });
  const result = await prepareEspnWeek(state([qbOnly], [pick], [rating]), {
    mode: 'qb-only', teams, fetcher: fixture.fetcher, qbNotificationsDue: new Set([pick.qb_id]),
  });
  assert.deepEqual(fixture.calls, ['502']);
  assert.equal(result.games[0].id, qbOnly.id);
  assert.deepEqual(result.ratings, []);
  assert.deepEqual(result.qbStats, []);
});

test('concurrent final reads share one summary per event for both selected-QB ratings and NFL stat rows', async () => {
  const away = { ...pick, qb_id: 'away-slot', selected_espn_athlete_id: '222', selected_team: 'Rams' };
  const fixture = provider({ 502: summary(qbOnly, 'SEA', 'LAR') });
  const result = await prepare(state([qbOnly], [pick, away]), fixture, 'manual');
  assert.deepEqual(fixture.calls, ['502']);
  assert.deepEqual(result.ratings.map(row => row.qb_id), [pick.qb_id, away.qb_id]);
  assert.deepEqual(result.qbStats.map(row => row.team), [teams[2].name, teams[3].name]);
});

test('a selected QB with a missing ESPN rating never becomes zero or gets replaced prematurely, and can be retried', async () => {
  for (const missing of [null, '', '  ', '--', 160, -1]) {
    const incomplete = summary(qbOnly, 'SEA', 'LAR', [box('1', 'SEA', [passer('333', 145), passer('111', missing)])]);
    const fixture = provider({ 502: incomplete });
    const input = state([qbOnly], [pick]);
    const attempt = await prepare(input, fixture);
    assert.deepEqual(attempt.games, []);
    assert.deepEqual(attempt.ratings, []);
    assert.match(attempt.warnings[0], /Rating final du QB sélectionné/);
    await assert.rejects(prepare(input, fixture, 'close'), /Rating final du QB sélectionné/);
    const retry = await prepare(input, provider({ 502: summary(qbOnly, 'SEA', 'LAR') }));
    assert.equal(retry.ratings[0].passer_rating, 100.7);
    assert.equal(retry.games.length, 1);
  }
});

test('pre/in are not provider errors but closure must wait; canceled or stale events never produce patches', async () => {
  for (const status of [
    { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' },
    { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' },
    { state: 'post', completed: true, name: 'STATUS_CANCELED' },
    { state: 'post', completed: false, name: 'STATUS_FINAL' },
  ]) {
    const response = summary(eligible, 'WAS', 'BUF');
    response.header.competitions[0].status.type = status;
    const fixture = provider({ 501: response });
    const result = await prepare(state([eligible]), fixture);
    assert.deepEqual(result.games, []);
    assert.equal(result.pending, status.state === 'post' ? 0 : 1);
    assert.equal(result.warnings.length, status.state === 'post' ? 1 : 0);
    await assert.rejects(prepare(state([eligible]), fixture, 'close'), /FINAL/);
  }
});

test('missing score, reordered teams and incorrect provider season leave the game pending for retry', async () => {
  for (const damage of [
    response => { response.header.competitions[0].competitors[0].score = ''; },
    response => { response.header.competitions[0].competitors[0].team.abbreviation = 'BUF'; },
    response => { response.header.season.year = season - 1; },
    response => { response.header.week.number = week - 1; },
    response => { response.header.id = '999'; },
  ]) {
    const response = summary(eligible, 'WAS', 'BUF');
    damage(response);
    const fixture = provider({ 501: response });
    const result = await prepare(state([eligible]), fixture);
    assert.deepEqual(result.games, []);
    assert.equal(result.warnings.length, 1);
    await assert.rejects(prepare(state([eligible]), fixture, 'close'));
  }
});

test('a provider failure does not prevent a different game completing and may be retried', async () => {
  const fixture = provider({ 501: new Error('offline'), 502: summary(qbOnly, 'SEA', 'LAR') });
  const result = await prepare(state([eligible, qbOnly], [pick]), fixture);
  assert.equal(result.games[0].id, qbOnly.id);
  assert.equal(result.ratings.length, 1);
  assert.match(result.warnings[0], /offline/);
});

test('ambiguous public weekly stats do not suppress otherwise valid game scores or the selected-QB result', async () => {
  const fixture = provider({ 501: summary(eligible, 'WAS', 'BUF'), 502: summary(qbOnly, 'SEA', 'LAR') });
  const result = await prepare(state([eligible, qbOnly], [pick]), fixture);
  assert.equal(result.games.length, 2);
  assert.equal(result.ratings.length, 1);
  assert.deepEqual(result.qbStats, []);
  assert.equal(result.warnings.filter(value => value.includes('statistiques ESPN hebdomadaires ambiguës')).length, 2);
});

test('ambiguous game IDs and unmapped snapshots never use the mutable catalogue as a fallback', async () => {
  const invalid = { ...pick, selected_team: undefined };
  const result = await prepare(state([qbOnly, { ...qbOnly, id: 'another', is_pool_eligible: true }], [invalid]), provider({}));
  assert.deepEqual(result.ratings, []);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /identité ou match/);
  assert.match(result.warnings[1], /dupliqué/);
  await assert.rejects(prepare(state([qbOnly], [invalid]), provider({}), 'close'), /identité ou match/);
});

test('standings preserve division order, canonical team mapping and true zero; incomplete rows are not updated', async () => {
  const prefs = {
    season, fetcher: async url => {
      assert.match(url, /season=2026/);
      return { ok: true, json: async () => ({
        season: { year: season },
        children: [{ name: 'National Football Conference - East', standings: { entries: [
          { team: { abbreviation: 'WSH' }, stats: [{ name: 'wins', value: 0 }, { name: 'losses', value: 1 }, { name: 'ties', value: 2 }] },
          { team: { abbreviation: 'BUF' }, stats: [{ name: 'wins', value: null }] },
        ] } }],
      }) };
    },
  };
  const standings = await prepareEspnStandings(teams, prefs);
  assert.deepEqual(standings.teams, [{ id: 'was', wins: 0, losses: 1, ties: 2, division_rank: 1, division_name: 'NFC East' }]);
  assert.equal(standings.warnings.length, 1);
  await assert.rejects(prepareEspnStandings(teams, { ...prefs, fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
});
