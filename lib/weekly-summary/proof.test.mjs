import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCompletedHistory} from './proof.mjs';
import {PublicationError} from '../regular-publication/espn.mjs';
import {fixture as publicationFixture, user} from '../regular-publication/fixtures.mjs';

function fixture() {
  const f = publicationFixture();
  f.state.settings.current_week = 3;
  f.state.users = [user];
  for (const game of f.state.games) Object.assign(game, {is_pool_eligible: true, home_score: 21, away_score: 14});
  f.state.picks.forEach((pick, i) => {pick.id = `pick-${i + 1}`;});
  for (const choice of f.state.qb_picks) choice.season = 2026;
  f.state.qb_ratings = f.state.qb_picks.map(choice => ({
    season: 2026, qb_id: choice.qb_id, week: choice.week, passer_rating: 100,
    actual_qb_name: 'Selected QB', actual_espn_athlete_id: '99',
  }));
  f.state.weekly_scores = [1, 2].map(week => ({
    season: 2026, user_id: user, week, base_points: 2, multiplier: 1, final_score: 2,
  }));
  return f;
}
const verify = async f => {
  const {pointsByPick, verifiedGames} = await verifyCompletedHistory(f.state, {fetcher: f.fetcher});
  assert.ok(verifiedGames.every(game => game.state === 'post' && game.completed === true && game.final_status === 'STATUS_FINAL'));
  return {pointsByPick};
};

function outsidePoolQbFixture() {
  const f = fixture();
  f.state.teams.push({name: 'Houston Texans', espn_abbr: 'HOU'}, {name: 'Baltimore Ravens', espn_abbr: 'BAL'});
  for (const [i, qbGame] of [...f.state.games].entries()) {
    Object.assign(qbGame, {is_pool_eligible: false, home_score: null, away_score: null});
    const poolGame = {...qbGame, id: `pool-${i}`, external_game_id: String(201 + i),
      is_pool_eligible: true, home_team: 'Houston Texans', away_team: 'Baltimore Ravens', home_score: 28, away_score: 21};
    f.state.games.push(poolGame);
    Object.assign(f.state.picks[i], {game_id: poolGame.id, picked_team: poolGame.home_team});
    const event = structuredClone(f.events[i]);
    event.id = poolGame.external_game_id;
    Object.assign(event.competitions[0].competitors[0], {team: {id: '3', abbreviation: 'HOU'}, score: '28'});
    Object.assign(event.competitions[0].competitors[1], {team: {id: '4', abbreviation: 'BAL'}, score: '21'});
    f.events.push(event);
  }
  return f;
}

test('accepts a FINAL QB game outside the pool with null local game scores', async () => {
  const f = outsidePoolQbFixture(), before = structuredClone(f.state);
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
  assert.deepEqual(f.state, before);
  assert.equal(f.calls.filter(url => url.includes('/summary')).length, 2);
});

test('ignores stale local scores of a QB game outside the pool', async () => {
  const f = outsidePoolQbFixture();
  for (const game of f.state.games.filter(game => game.is_pool_eligible === false)) {
    Object.assign(game, {home_score: 999, away_score: 0});
  }
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
});

test('refuses a mismatched stored rating for a QB game outside the pool', async () => {
  const f = outsidePoolQbFixture();
  f.state.qb_ratings[0].passer_rating = 125;
  await assert.rejects(verify(f), /Rating ou identité QB stocké différent/);
});

test('still requires the FINAL summary of a QB game outside the pool', async () => {
  const f = outsidePoolQbFixture();
  f.summaries['101'].header.competitions[0].status.type.completed = false;
  await assert.rejects(verify(f), /Résumé QB non FINAL/);
});

test('certifies complete history using stored scores without modifying its sources', async () => {
  const f = fixture(), before = structuredClone(f.state);
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
  assert.deepEqual(f.state, before);
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(url => ['sports.core.api.espn.com', 'site.api.espn.com'].includes(new URL(url).hostname)));
  assert.equal(f.calls.filter(url => url.includes('/summary')).length, 2);
});
test('certifies legacy ties from FINAL ESPN evidence and returns in-memory proof without backfilling',async()=>{
  const f=fixture();
  f.state.games.forEach(game=>{game.home_score=14;});
  f.state.picks[0].predicted_spread=0;f.state.picks[1].picked_team=f.state.games[1].away_team;
  for(const event of f.events){
    event.competitions[0].competitors[0].score='14';
    f.summaries[event.id].header.competitions[0].competitors[0].score='14';
  }
  f.state.weekly_scores.forEach(row=>Object.assign(row,{base_points:1,final_score:1}));
  const before=structuredClone(f.state),proof=await verifyCompletedHistory(f.state,{fetcher:f.fetcher});
  assert.deepEqual(proof.pointsByPick,{'pick-1':1,'pick-2':1});
  assert.ok(proof.verifiedGames.every(game=>game.state==='post'&&game.completed===true&&game.home_score===game.away_score));
  assert.deepEqual(f.state,before);assert.ok(f.state.games.every(game=>game.result_status===undefined));
  f.state.weekly_scores[0].base_points=0;f.state.weekly_scores[0].final_score=0;
  await assert.rejects(verify(f),/différent du calcul canonique/);
});

for (const [name, mutate] of [
  ['first active week', f => {f.state.settings.current_week = 1;}],
  ['closed regular phase', f => {f.state.settings.phase = 'playoffs';}],
  ['finalized regular season', f => {f.state.settings.regular_finalized_at = '2026-10-20T00:00:00Z';}],
  ['TEST eligible game', f => {f.state.games[0].external_game_id = 'TEST-101';}],
  ['TEST QB game', f => {
    const testGame = {...f.state.games[0], id: 'test-qb', external_game_id: 'TEST-QB', is_pool_eligible: false};
    Object.assign(f.state.games[0], {home_team: 'Different team', away_team: 'Other team'});
    f.state.games.push(testGame);
  }],
  ['missing frozen selection', f => {f.state.qb_picks[0].selected_qb_name = null;}],
  ['missing necessary QB choice', f => {f.state.qb_picks.shift();}],
  ['missing stored game score', f => {f.state.games[0].home_score = null;}],
  ['orphan pool pick', f => {f.state.picks[0].game_id = 'absent';}],
]) test(`rejects ${name} before any provider request`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(verify(f), PublicationError);
  assert.equal(f.calls.length, 0);
});

test('ignores future TEST games and current-week provisional scores', async () => {
  const f = fixture();
  f.state.games.push({...f.state.games[0], id: 'future', external_game_id: 'TEST-FUTURE', week: 3, home_score: null, away_score: null});
  f.state.picks.push({...f.state.picks[0], id: 'future-pick', game_id: 'future'});
  f.state.weekly_scores.push({...f.state.weekly_scores[0], week: 3, final_score: 999});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
});

test('ignores unchosen, ineligible TEST games', async () => {
  const f = fixture();
  f.state.games.push({...f.state.games[0], id: 'test', external_game_id: 'TEST-UNUSED', is_pool_eligible: false, home_team: 'Synthetic A', away_team: 'Synthetic B'});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
});

test('refuses QB-only participation instead of silently omitting a participant', async () => {
  const f = fixture(), other = '00000000-0000-0000-0000-000000000003';
  f.state.users.push(other);
  f.state.qb_picks.push({...f.state.qb_picks[0], user_id: other});
  await assert.rejects(verify(f), /Participation hebdomadaire incomplète/);
  assert.equal(f.calls.length, 0);
});

test('refuses a missing eligible-game pick even when its partial stored score matches', async () => {
  const f = fixture();
  f.state.games.push({...f.state.games[0], id: 'unpicked', external_game_id: '103', home_team: 'Houston Texans', away_team: 'Baltimore Ravens'});
  f.state.teams.push({name: 'Houston Texans', espn_abbr: 'HOU'}, {name: 'Baltimore Ravens', espn_abbr: 'BAL'});
  const event = structuredClone(f.events[0]);
  event.id = '103';
  event.competitions[0].competitors[0].team = {id: '3', abbreviation: 'HOU'};
  event.competitions[0].competitors[1].team = {id: '4', abbreviation: 'BAL'};
  f.events.push(event);
  // Existing picks still canonically total 2, matching the stored row, but the
  // newly observed eligible game has no pick from this participating player.
  await assert.rejects(verify(f), /Participation hebdomadaire incomplète/);
  assert.equal(f.calls.length, 0);
});

test('does not require picks during a week without any participation evidence', async () => {
  const f = fixture(), other = '00000000-0000-0000-0000-000000000003';
  f.state.users.push(other);
  f.state.picks.push({...f.state.picks[1], id: 'later-participant', user_id: other});
  f.state.qb_picks.push({...f.state.qb_picks[1], user_id: other});
  f.state.weekly_scores.push({...f.state.weekly_scores[1], user_id: other});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2, 'later-participant': 2}});
});

for (const [name, mutate] of [
  ['unfinished earlier week', f => {f.events[0].status.type.completed = false;}],
  ['live QB summary', f => {f.summaries['101'].header.competitions[0].status.type.state = 'in';}],
  ['mismatched local final score', f => {f.state.games[0].home_score = 24;}],
  ['mismatched local team', f => {f.state.games[0].away_team = 'Different team';}],
  ['mismatched local event', f => {f.state.games[0].external_game_id = '999';}],
  ['different ESPN season', f => {f.events[0].season.year = 2025;}],
  ['incompatible final QB summary score', f => {f.summaries['101'].header.competitions[0].competitors[0].score = '24';}],
  ['empty final rating', f => {f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats = [''];}],
  ['out-of-range final rating', f => {f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats = ['200'];}],
  ['missing stored rating', f => {f.state.qb_ratings.shift();}],
  ['different stored rating', f => {f.state.qb_ratings[0].passer_rating = 125;}],
  ['different actual QB', f => {f.state.qb_ratings[0].actual_espn_athlete_id = '98';}],
  ['missing actual QB identity', f => {f.state.qb_ratings[0].actual_qb_name = null;}],
  ['missing historical weekly score', f => {f.state.weekly_scores.shift();}],
  ['different base points', f => {f.state.weekly_scores[0].base_points = 1;}],
  ['different multiplier', f => {f.state.weekly_scores[0].multiplier = 1.25;}],
  ['different final score', f => {f.state.weekly_scores[0].final_score = 999;}],
  ['duplicate historical weekly score', f => {f.state.weekly_scores.push({...f.state.weekly_scores[0]});}],
  ['orphan historical weekly score', f => {f.state.weekly_scores.push({...f.state.weekly_scores[0], user_id: 'other'});}],
]) test(`refuses ${name}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(verify(f), PublicationError);
});

test('refuses a partial scoreboard against its complete weekly event index', async () => {
  const f = fixture(), original = f.fetcher;
  f.fetcher = async url => {
    const response = await original(url), data = await response.json();
    if (url.includes('/scoreboard')) data.events = [];
    return {...response, json: async () => data};
  };
  await assert.rejects(verify(f), /partiel/);
});

test('cannot omit an earlier week from the provider week index', async () => {
  const f = fixture(), original = f.fetcher;
  f.fetcher = async url => {
    const response = await original(url), data = await response.json();
    if (new URL(url).pathname.endsWith('/weeks')) {
      data.items.shift(); data.count = 1;
    }
    return {...response, json: async () => data};
  };
  await assert.rejects(verify(f), /incomplet/);
});

test('a non-final unchosen event prevents a definitive weekly result', async () => {
  const f = fixture(), event = structuredClone(f.events[0]);
  event.id = '103'; event.status.type.completed = false;
  f.events.push(event);
  await assert.rejects(verify(f), /non FINAL/);
});

test('a provider calendar change during summaries is refused', async () => {
  const f = fixture(), original = f.fetcher;
  let changed = false;
  f.fetcher = async url => {
    const response = await original(url), data = await response.json();
    if (url.includes('/summary')) changed = true;
    if (changed && new URL(url).pathname.endsWith('/weeks/1/events')) {
      data.items[0].$ref = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/999';
    }
    return {...response, json: async () => data};
  };
  await assert.rejects(verify(f), /modifié/);
});

test('uses the frozen selection after a catalogue mutation and validates the actual replacement', async () => {
  const f = fixture();
  Object.assign(f.state.qbs[0], {name: 'Changed catalogue', espn_athlete_id: '777', team: 'Other'});
  f.summaries['101'].boxscore.players[0].statistics[0].athletes = [
    {athlete: {id: '98', displayName: 'Actual replacement'}, stats: ['125.5']},
  ];
  Object.assign(f.state.qb_ratings[0], {passer_rating: 125.5, actual_qb_name: 'Actual replacement', actual_espn_athlete_id: '98'});
  Object.assign(f.state.weekly_scores[0], {multiplier: 1.255, final_score: 2.51});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
});

test('preserves canonical rounding, numeric zero, loss, win and tied-game rules', async () => {
  const f = fixture();
  f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats = ['0'];
  f.state.qb_ratings[0].passer_rating = 0;
  f.state.picks[0].predicted_spread = 3;
  Object.assign(f.state.weekly_scores[0], {base_points: 1, multiplier: 1, final_score: 1});
  f.state.games[1].home_score = 14;
  f.events[1].competitions[0].competitors[0].score = '14';
  f.summaries['102'].header.competitions[0].competitors[0].score = '14';
  Object.assign(f.state.weekly_scores[1], {base_points: 1, final_score: 1});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 1, 'pick-2': 1}});
  f.state.games[1].home_score = 7;
  f.events[1].competitions[0].competitors[0].score = '7';
  f.summaries['102'].header.competitions[0].competitors[0].score = '7';
  Object.assign(f.state.weekly_scores[1], {base_points: 0, final_score: 0});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 1, 'pick-2': 0}});
});

test('uses unrounded canonical QB multiplier when calculating final_score', async () => {
  const f = fixture();
  f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats = ['125.55'];
  f.state.qb_ratings[0].passer_rating = 125.55;
  Object.assign(f.state.weekly_scores[0], {multiplier: 1.256, final_score: 2.511});
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
});

test('accepts stored numeric strings but refuses missing values as numeric zero', async () => {
  const f = fixture();
  for (const row of f.state.weekly_scores) {
    for (const field of ['base_points', 'multiplier', 'final_score']) row[field] = String(row[field]);
  }
  assert.deepEqual(await verify(f), {pointsByPick: {'pick-1': 2, 'pick-2': 2}});
  f.state.weekly_scores[0].base_points = null;
  await assert.rejects(verify(f), PublicationError);
});

test('converts provider failures into a closed PublicationError result', async () => {
  const f = fixture();
  f.fetcher = async () => {throw new Error('Provider unavailable');};
  await assert.rejects(verify(f), PublicationError);
});
