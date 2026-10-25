import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWeeklySummary, acknowledgeWeeklySummary, VIEWS_TABLE} from './operations.mjs';
import {PublicationError} from '../regular-publication/espn.mjs';
import {fixture as publicationFixture, user} from '../regular-publication/fixtures.mjs';
import {REGULAR_TIE_NOTE} from '../seasons/regularResults.mjs';

function fixture() {
  const {state} = publicationFixture();
  state.settings.current_week = 3;
  state.users = [user];
  for (const game of state.games) Object.assign(game, {is_pool_eligible: true, result_status: 'final', home_score: 21, away_score: 14});
  state.picks.forEach((pick, i) => {pick.id = `pick-${i + 1}`;});
  for (const choice of state.qb_picks) choice.season = 2026;
  state.qb_ratings = state.qb_picks.map(choice => ({season: 2026, qb_id: choice.qb_id, week: choice.week,
    passer_rating: 100, actual_qb_name: 'Selected QB', actual_espn_athlete_id: '99'}));
  state.weekly_scores = [1, 2].map(week => ({id: `score-${week}`, season: 2026, user_id: user, week,
    base_points: 2, multiplier: 1, final_score: 2}));
  return state;
}

function harness() {
  const state = fixture();
  const h = {state, settings: structuredClone(state.settings), states: [], scoreStates: [], seen: [], member: true, memberError: null,
    insertError: null, calls: [], writes: [], verifications: 0};
  h.fetcher = async () => {throw new Error('A test must never request the network.');};
  h.verify = async (_state, options) => {
    h.verifications++;
    assert.equal(options.fetcher, h.fetcher);
    return {pointsByPick: {'pick-1': 2, 'pick-2': 2}};
  };
  h.client = {
    from(table) {
      const call = {table, operation: null, filters: []};
      h.calls.push(call);
      const result = single => {
        if (table === 'settings') return {data: structuredClone(h.settings), error: null};
        if (table === VIEWS_TABLE && call.operation === 'insert') return {data: null, error: h.insertError};
        if (table === VIEWS_TABLE) return h.seen.shift() || {data: null, error: null};
        if (table === 'weekly_scores') {
          assert.deepEqual(call.order, ['week', {ascending: true}]);
          const rows = h.scoreStates.shift() || h.lastState?.weekly_scores || h.state.weekly_scores;
          return {data: structuredClone(rows).sort((a, b) => a.week - b.week), error: null};
        }
        if (table === 'season_participants') {
          const scopedUser = call.filters.find(([field]) => field === 'user_id')?.[1];
          const scopedSeason = call.filters.find(([field]) => field === 'season')?.[1];
          assert.equal(scopedUser, user);
          assert.equal(call.filters.find(([field]) => field === 'confirmed')?.[1], true);
          const row = h.member ? {user_id: scopedUser, season: scopedSeason, confirmed: true} : null;
          return {data: single ? row : row ? [row] : [], error: h.memberError};
        }
        throw new Error(`Unexpected table in summary operation: ${table}`);
      };
      const query = {
        select(columns) {call.operation = 'select'; call.columns = columns; return this;},
        eq(field, value) {call.filters.push([field, value]); return this;},
        order(field, options) {call.order = [field, options]; return this;},
        insert(row) {
          assert.equal(table, VIEWS_TABLE, 'Only dismissal tracking may be written.');
          call.operation = 'insert'; call.row = row; h.writes.push({table, row}); return this;
        },
        single: async () => result(true),
        maybeSingle: async () => result(true),
        then(resolve, reject) {return Promise.resolve(result(false)).then(resolve, reject);},
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'regular_publication_state', 'Summary operations must never call a scoring or lifecycle mutation.');
      h.calls.push({rpc: name, args});
      h.lastState = structuredClone(h.states.shift() || h.state);
      return {data: h.lastState, error: null};
    },
  };
  return h;
}
const load = h => loadWeeklySummary(h.client, user, {fetcher: h.fetcher, verify: h.verify});
const ack = (h, value = {season: 2026, week: 2}) => acknowledgeWeeklySummary(h.client, user, value);
const stateReads = h => h.calls.filter(call => call.rpc === 'regular_publication_state').length;

test('GET reads a verified personal summary, rechecks its sources and never writes', async () => {
  const h = harness();
  const summary = await load(h);
  assert.equal(summary.season, 2026);
  assert.equal(summary.week, 2);
  assert.equal(summary.score.points, 2);
  assert.equal(summary.games[0].points, 2);
  assert.equal(stateReads(h), 2);
  assert.equal(h.verifications, 1);
  assert.deepEqual(h.writes, []);
  for (const call of h.calls.filter(call => call.table === VIEWS_TABLE)) {
    assert.ok(call.filters.some(([field, value]) => field === 'user_id' && value === user));
    assert.ok(call.filters.some(([field, value]) => field === 'season' && value === 2026));
    assert.ok(call.filters.some(([field, value]) => field === 'week' && value === 2));
  }
});
test('GET carries FINAL proof to a legacy tied recap without changing historical rows',async()=>{
  const h=harness();
  Object.assign(h.state.games[1],{home_score:14,result_status:null});
  h.state.picks[1].predicted_spread=0;
  h.verify=async state=>({pointsByPick:{'pick-1':2,'pick-2':1},verifiedGames:state.games.map(game=>({...game,state:'post',completed:true,final_status:'STATUS_FINAL'}))});
  const before=structuredClone(h.state),summary=await load(h);
  assert.equal(summary.games[0].points,1);assert.equal(summary.games[0].exceptionalNote,REGULAR_TIE_NOTE);
  assert.deepEqual(h.state,before);assert.deepEqual(h.writes,[]);
});

for (const [name, mutate] of [
  ['before the following week opens', h => {h.settings.current_week = 1;}],
  ['outside regular season', h => {h.settings.phase = 'playoffs';}],
  ['during maintenance', h => {h.settings.regular_writes_paused = true;}],
  ['already acknowledged', h => {h.seen.push({data: {week: 2}, error: null});}],
  ['not a season participant', h => {h.state.users = [];}],
  ['no personal QB participation', h => {h.state.qb_picks = [];}],
  ['stale initial week', h => {h.state.settings.current_week = 4;}],
  ['stale initial phase', h => {h.state.settings.phase = 'offseason';}],
]) test(`GET silently skips ${name}`, async () => {
  const h = harness(); mutate(h);
  assert.equal(await load(h), null);
  assert.equal(h.verifications, 0);
  assert.deepEqual(h.writes, []);
});

test('GET returns no summary while final history is unproven', async () => {
  const h = harness();
  h.verify = async () => {throw new PublicationError('A game is still live.');};
  assert.equal(await load(h), null);
  assert.equal(stateReads(h), 1);
  assert.deepEqual(h.writes, []);
});

test('GET rejects a source change between its RPC snapshot and ordered score read', async () => {
  const h = harness(), changed = structuredClone(h.state.weekly_scores);
  changed[0].final_score = 999;
  h.scoreStates.push(changed);
  assert.equal(await load(h), null);
  assert.equal(h.verifications, 0);
  assert.deepEqual(h.writes, []);
});

test('GET uses the existing standings order for tied ranks instead of the RPC id order', async () => {
  const h = harness(), other = '00000000-0000-0000-0000-000000000003';
  h.state.users.push(other);
  h.state.qb_picks.push(...h.state.qb_picks.map(choice => ({...choice, user_id: other})));
  h.state.picks.push(...h.state.picks.map(pick => ({...pick, id: `other-${pick.id}`, user_id: other})));
  const otherScores = h.state.weekly_scores.map(score => ({...score, id: `other-${score.id}`, user_id: other}));
  h.state.weekly_scores.push(...otherScores);
  // The RPC puts our rows first; the standings query has the other player first
  // within each tied week. Reusing that order keeps the page's ordinal ranks.
  const ordered = [otherScores[0], h.state.weekly_scores[0], otherScores[1], h.state.weekly_scores[1]];
  h.scoreStates.push(ordered, ordered);
  const summary = await load(h);
  assert.equal(summary.score.rank, 2);
  assert.equal(summary.overall.rank, 2);
  assert.equal(summary.overall.previousRank, 2);
  assert.deepEqual(h.writes, []);
});

for (const [name, mutate] of [
  ['score correction', state => {state.weekly_scores[0].final_score = 999;}],
  ['historical pick correction', state => {state.picks[0].predicted_spread = 3;}],
  ['historical QB identity correction', state => {state.qb_picks[0].selected_qb_name = 'Reviewed identity';}],
  ['week advancement', state => {state.settings.current_week = 4;}],
  ['phase transition', state => {state.settings.phase = 'playoffs';}],
]) test(`GET rejects a ${name} between its two reads`, async () => {
  const h = harness(), changed = structuredClone(h.state); mutate(changed);
  h.states.push(h.state, changed);
  assert.equal(await load(h), null);
  assert.equal(stateReads(h), 2);
  assert.deepEqual(h.writes, []);
});

test('GET ignores unrelated current-week choices and current catalogue changes', async () => {
  const h = harness(), changed = structuredClone(h.state);
  changed.qbs[0].name = 'Mutable catalogue';
  changed.qb_picks.push({...changed.qb_picks[0], week: 3, selected_qb_name: 'New selection'});
  h.states.push(h.state, changed);
  assert.equal((await load(h)).week, 2);
  assert.deepEqual(h.writes, []);
});

test('GET suppresses a summary acknowledged by another tab during verification', async () => {
  const h = harness();
  h.seen.push({data: null, error: null}, {data: {week: 2}, error: null});
  assert.equal(await load(h), null);
  assert.equal(stateReads(h), 2);
  assert.deepEqual(h.writes, []);
});

for (const code of ['42P01', 'PGRST205']) test(`GET gracefully skips a missing dismissal migration (${code})`, async () => {
  const h = harness(); h.seen.push({data: null, error: {code}});
  assert.equal(await load(h), null);
  assert.equal(stateReads(h), 0);
  assert.equal(h.verifications, 0);
  assert.deepEqual(h.writes, []);
});

test('GET surfaces unexpected read failures without writing', async () => {
  const h = harness(), error = {code: '42501', message: 'read denied'};
  h.seen.push({data: null, error});
  await assert.rejects(load(h), actual => actual === error);
  assert.deepEqual(h.writes, []);
});

test('POST records only the authenticated account dismissal and no business data', async () => {
  const h = harness();
  await ack(h, {season: 2026, week: 2, user_id: 'forged-owner', final_score: 999});
  assert.deepEqual(h.writes, [{table: VIEWS_TABLE, row: {user_id: user, season: 2026, week: 2}}]);
});

test('POST treats a unique-constraint duplicate as successful acknowledgement', async () => {
  const h = harness(); h.insertError = {code: '23505', message: 'already dismissed'};
  await assert.doesNotReject(ack(h));
  assert.equal(h.writes.length, 1);
});

test('POST surfaces other persistence errors so the dialog can retry', async () => {
  const h = harness(), error = {code: '42P01', message: 'migration absent'};
  h.insertError = error;
  await assert.rejects(ack(h), actual => actual === error);
});

test('POST accepts a historical season only after checking that account membership', async () => {
  const h = harness();
  await ack(h, {season: 2025, week: 18});
  const membership = h.calls.find(call => call.table === 'season_participants');
  assert.deepEqual(membership.filters, [['user_id', user], ['season', 2025], ['confirmed', true]]);
  assert.deepEqual(h.writes, [{table: VIEWS_TABLE, row: {user_id: user, season: 2025, week: 18}}]);
});

test('POST surfaces membership read errors without writing an acknowledgement', async () => {
  const h = harness(), error = {code: '42501', message: 'membership unavailable'};
  h.memberError = error;
  await assert.rejects(ack(h), actual => actual === error);
  assert.deepEqual(h.writes, []);
});

for (const [name, settings] of [
  ['the active week has advanced', {current_week: 4}],
  ['regular maintenance started', {regular_writes_paused: true}],
  ['the phase changed to playoffs', {phase: 'playoffs', regular_finalized_at: '2026-10-23T00:00:00Z'}],
  ['the phase changed to offseason', {phase: 'offseason', regular_finalized_at: '2026-10-23T00:00:00Z'}],
]) test(`POST can dismiss an already displayed historical summary after ${name}`, async () => {
  const h = harness(); Object.assign(h.settings, settings);
  await assert.doesNotReject(ack(h));
  assert.deepEqual(h.writes, [{table: VIEWS_TABLE, row: {user_id: user, season: 2026, week: 2}}]);
});

for (const [name, body, mutate] of [
  ['a future season', {season: 2027, week: 1}, () => {}],
  ['the active week', {season: 2026, week: 3}, () => {}],
  ['a future week', {season: 2026, week: 4}, () => {}],
  ['week zero', {season: 2026, week: 0}, () => {}],
  ['a week beyond the regular season', {season: 2025, week: 19}, () => {}],
  ['a nonparticipant', {season: 2026, week: 2}, h => {h.member = false;}],
]) test(`POST refuses ${name} without writing`, async () => {
  const h = harness(); mutate(h);
  await assert.rejects(ack(h, body));
  assert.deepEqual(h.writes, []);
});
