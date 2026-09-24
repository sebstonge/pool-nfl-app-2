import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consensus, teamPathGroups, initialRound, collectiveRounds, fetchLiveGame, espnSummaryUrl, loadCollectiveData, submissionOrder, playerName } from './collectiveData.mjs';
const game = { id: 'g', round_id: 'wc', away_team: 'A', home_team: 'B' };
const picks = Array.from({ length: 13 }, (_, i) => ({ id: i, user_id: i, game_id: 'g', picked_team: i < 4 ? 'A' : 'B', predicted_spread: i }));

test('consensus is scoped to the game, raw counts only, and input remains unchanged', () => {
  const input = [...picks, { game_id: 'another', picked_team: 'A' }];
  const before = JSON.stringify(input);
  const result = consensus(game, input);
  assert.equal(result.total, 13); assert.equal(result.away.length, 4); assert.equal(result.home.length, 9);
  assert.deepEqual(Object.keys(result).sort(), ['away', 'home', 'total']);
  assert.equal(JSON.stringify(input), before);
});
test('zero, unanimous and tied selections do not produce NaN', () => {
  assert.equal(consensus(game, []).total, 0);
  assert.equal(consensus(game, picks.slice(0, 4)).away.length, 4);
  assert.equal(consensus(game, [picks[0], picks[4]]).home.length, 1);
  assert.equal(consensus(game, [{ game_id: 'g', picked_team: 'invalid' }]).total, 0);
});
test('team paths are scoped by round and preserve stored multipliers', () => {
  const paths = [{ round_id: 'wc', team: 'A', multiplier: 1.5 }, { round_id: 'wc', team: 'A', multiplier: null }, { round_id: 'div', team: 'A', multiplier: 4 }];
  assert.deepEqual(teamPathGroups(paths, 'wc')[0].rows, paths.slice(0, 2));
  assert.deepEqual(teamPathGroups(paths, undefined), []);
});
test('round selection prefers ongoing, then completed, then actual draft games', () => {
  const rounds = [{ id: 'wc', round_key: 'wild_card', round_order: 1, status: 'finalized' }, { id: 'div', round_key: 'divisional', round_order: 2, status: 'open' }, { id: 'sb', round_key: 'super_bowl', round_order: 4, status: 'draft' }];
  assert.equal(initialRound(rounds, []), 'divisional');
  assert.equal(initialRound(rounds.filter(r => r.status !== 'open'), []), 'wild_card');
  assert.equal(initialRound(rounds.map(r => ({...r,status:'draft'})), [{round_id:'div'}]), 'divisional');
  assert.equal(initialRound([], []), 'wild_card');
});
test('four visual rounds do not invent future games', () => {
  const rounds = collectiveRounds([{ id: 'wc', round_key: 'wild_card' }], [game]);
  assert.equal(rounds.length, 4); assert.deepEqual(rounds[0].games, [game]);
  assert.ok(rounds.slice(1).every(round => round.games.length === 0));
});
test('every TEST ID is stopped before fetch, including leading whitespace', async () => {
  let calls = 0;
  for (const id of ['TEST-WC-2026-01', 'TEST-WC-2026-02', 'TEST-WC-2026-03', ' TEST-any', '', null]) {
    assert.equal(espnSummaryUrl({external_game_id:id}), null);
    assert.equal(await fetchLiveGame({external_game_id:id}, () => { calls++; }), null);
  }
  assert.equal(calls, 0);
});
test('live accepts real IDs and preserves zero scores; no scoring calculation', async () => {
  const live = await fetchLiveGame({external_game_id:'123'}, async url => {
    assert.ok(url.endsWith('event=123'));
    return {ok:true,json:async()=>({header:{competitions:[{status:{type:{state:'in'}},competitors:[{homeAway:'away',score:'0'},{homeAway:'home',score:'7'}]}]}})};
  });
  assert.equal(live.awayScore, 0); assert.equal(live.homeScore, 7);
});
test('collective loader uses playoff tables, all participants, and latest season', async () => {
  const calls = [];
  const tables = {
    playoff_rounds: [{id:'wc',season:2026,round_key:'wild_card',round_order:1,status:'open'},{id:'old',season:2025,round_key:'wild_card'}],
    playoff_seeds:[], playoff_games:[game], playoff_picks:picks, playoff_qb_picks:[{id:1,qb_id:'same'},{id:2,qb_id:'same'}], playoff_team_paths:[], users:[], teams:[],
  };
  const client = {auth: {getSession: async () => ({data: {session: {user: {id:'me'}}}})}, from(table) {
    assert.ok(table in tables); calls.push(table);
    const q = {select(){return q;},eq(){return q;},order(){return q;},in(key, ids){assert.ok(!ids.includes('old'));return q;},then(resolve){return Promise.resolve({data:tables[table],error:null}).then(resolve);}};
    return q;
  }};
  const data = await loadCollectiveData(client);
  assert.equal(data.season, 2026); assert.equal(data.picks.length, 13); assert.equal(data.qbPicks.length, 2);
  assert.ok(calls.includes('playoff_team_paths'));
});
test('read failures remain errors, not empty consensus', async () => {
  const client = {auth: {getSession: async () => ({data: {session: {user: {id:'me'}}}})}, from(){const q={select(){return q;},order(){return Promise.resolve({error:new Error('denied')});}};return q;}};
  await assert.rejects(loadCollectiveData(client), /denied/);
});

test('no session stops all table reads rather than pretending playoffs are empty', async () => {
 const client = {auth: {getSession: async () => ({data: {session: null}})}, from(){throw Error('must not query');}};
 assert.deepEqual(await loadCollectiveData(client), {requiresSignIn: true});
});
test('submission list uses created_at, never team or name ordering', () => {
 const rows = [{id:1,created_at:'2026-01-02',picked_team:'A'}, {id:2,created_at:'2026-01-01',picked_team:'B'}];
 assert.deepEqual(submissionOrder(rows).map(r=>r.id), [2,1]);
 assert.equal(rows[0].id,1);
 assert.equal(playerName({display_name:'Club',real_name:'Séb'}), 'Club');
 assert.equal(playerName({real_name:'Séb'}), 'Séb');
});

test('seed migration rollout tolerates only absent table, and wires finalized rows', async () => {
  const seeds = ['AFC','NFC'].flatMap((conference,c)=>Array.from({length:7},(_,i)=>({season:2026,team:`${conference}${i+1}`,espn_team_id:String(c*7+i+1),conference,seed:i+1,finalized_at:'2027-01-10T00:00:00Z'})));
  const client = (error, rows = seeds) => ({auth:{getSession:async()=>({data:{session:{user:{id:'me'}}}})},from(table){
    const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},then(resolve){return Promise.resolve(table==='playoff_seeds'?{data:rows,error}:{data:table==='playoff_rounds'?[{id:'wc',season:2026,round_key:'wild_card'}]:[]}).then(resolve);}};return q;
  }});
  assert.equal((await loadCollectiveData(client(null))).seedSnapshot.frozen,true);
  assert.equal((await loadCollectiveData(client(null,seeds.map(row=>({...row,finalized_at:null}))))).seedSnapshot,undefined);
  assert.equal((await loadCollectiveData(client({code:'PGRST205',message:'absent'}))).seedSnapshot,undefined);
  await assert.rejects(loadCollectiveData(client({code:'42501',message:'denied'})),/playoff_seeds: denied/);
});
