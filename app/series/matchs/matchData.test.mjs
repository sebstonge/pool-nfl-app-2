import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pendingPlayoffPlayers,loadRoundSubmissions,playoffQbAverages} from './matchData.mjs';

const players=[{id:'a',real_name:'Alice'},{id:'b',real_name:'Bob'}];
const game={id:1,round_id:10,home_team:'A',away_team:'B'};
const complete={roundId:10,games:[game],qbPicks:[{user_id:'a',round_id:10,qb_id:'q'}],paths:[{user_id:'a',round_id:10,team:'A'}],picks:[{user_id:'a',game_id:1,picked_team:'A',predicted_spread:0}]};
test('pending submissions require every part of the current round, not regular QB picks',()=>{
 assert.deepEqual(pendingPlayoffPlayers(players,complete).map(p=>p.id),['b']);
 assert.deepEqual(pendingPlayoffPlayers(players,{...complete,picks:[]}).map(p=>p.id),['a','b']);
 assert.deepEqual(pendingPlayoffPlayers(players,{...complete,roundId:11}).map(p=>p.id),['a','b']);
});
test('submission loader only queries the requested playoff round and its games',async()=>{
 const tables={playoff_picks:complete.picks,playoff_qb_picks:complete.qbPicks,playoff_team_paths:complete.paths};
 const client={from(table){assert.ok(table in tables);const q={select(){return q;},eq(key,value){assert.equal(key,'round_id');assert.equal(value,10);return q;},in(key,values){assert.equal(key,'game_id');assert.deepEqual(values,[1]);return q;},then(resolve){return Promise.resolve({data:tables[table]}).then(resolve);}};return q;}};
 const data=await loadRoundSubmissions(client,10,[game,{id:99,round_id:99}]);
 assert.deepEqual(pendingPlayoffPlayers(players,data).map(p=>p.id),['b']);
});
test('QB averages use published actual performances once, keep zero, exclude other seasons',()=>{
 const q={actual_espn_athlete_id:'20',actual_qb_name:'Backup',game_id:1,passer_rating:0};
 const data={season:2026,rounds:[{id:1,season:2026,round_order:1},{id:2,season:2026,round_order:2},{id:3,season:2027}],processed:{
 runs:[1,2,3].map(round_id=>({round_id,processed_at:'published',standings:[]})),
 results:[{round_id:1,user_id:'a',qb_result:q},{round_id:1,user_id:'b',qb_result:q},{round_id:2,user_id:'a',qb_result:{...q,game_id:2,passer_rating:100}},{round_id:3,user_id:'a',qb_result:{...q,passer_rating:158.3}}]}};
 assert.deepEqual(playoffQbAverages(data),{'20':50});
 data.processed.runs=[];assert.deepEqual(playoffQbAverages(data),{});
});
test('match page has no regular week dependencies and retains TEST ESPN protection',()=>{
 const source=readFileSync(new URL('./page.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/current_week|currentWeek|weekly_scores|qb_weekly_stats|\.from\(\s*["']qb_picks["']/);
 assert.match(source,/getPlayoffContext\(\)/);assert.match(source,/startsWith\("TEST-"\)/);
 assert.match(source,/function normalizeName/);assert.match(source,/Moyenne Séries/);
});
