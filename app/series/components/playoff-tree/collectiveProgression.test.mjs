import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectProgression, finalWinner, validatedSeeds } from './collectiveProgression.mjs';
import { collectiveRounds } from './collectiveData.mjs';
const teams = ['AFC','NFC'].flatMap(conference => Array.from({length:7},(_,i)=>({team:`${conference}${i+1}`,conference,seed:i+1})));
const snapshot={season:2026,frozen:true,teams};
const rows=['wild_card','divisional','conference','super_bowl'].map((round_key,i)=>({id:round_key,round_key,round_order:i+1}));
const game=(round,home,away,id=home)=>({id,round_id:round,home_team:home,away_team:away});
const final=(home=20,away=10)=>({state:'post',homeScore:home,awayScore:away});

test('immutable snapshot requires both complete conferences, unique original seeds and season',()=>{
 assert.equal(validatedSeeds(snapshot,2026).length,14);
 for(const value of [{...snapshot,frozen:false},{...snapshot,season:2025},{...snapshot,teams:teams.slice(1)},{...snapshot,teams:teams.map(t=>({...t,seed:1}))}]) assert.deepEqual(validatedSeeds(value,2026),[]);
});
test('FINAL only identifies winner; scores alone and ties cannot qualify',()=>{
 const g=game('wild_card','AFC2','AFC7');
 assert.equal(finalWinner(g,final()),'AFC2');
 assert.equal(finalWinner(g,{...final(),state:'in'}),null);
 assert.equal(finalWinner(g,final(10,10)),null);
 assert.equal(finalWinner({...g,home_score:0,away_score:7},final()),'AFC7');
});
test('#1 bye is qualified without a game or ESPN event; no multiplier fabricated',()=>{
 const result=projectProgression(collectiveRounds(rows,[]),{},snapshot,2026);
 assert.deepEqual(result[1].qualified.map(t=>t.team),['AFC1','NFC1']);
 assert.equal(result[1].games.length,2);
 assert.ok(result[1].games.every(g=>g.away_team===null && !g.external_game_id));
 assert.ok(result[1].qualified.every(t=>t.bye && !('multiplier' in t)));
});
test('partial finals preserve original seed and conference, without assigning opponents',()=>{
 const g=game('wild_card','AFC3','AFC6');
 const result=projectProgression(collectiveRounds(rows,[g]),{AFC3:final(7,20)},snapshot,2026);
 assert.deepEqual(result[1].qualified.find(t=>t.team==='AFC6'),{team:'AFC6',seed:6,conference:'AFC'});
 assert.ok(result[1].games.every(g=>!g.away_team));
});
for(const survivors of [[2,5,6],[4,6,7]]) test(`reseed AFC #1 with highest numeric survivor: ${survivors}`,()=>{
 const games=[[2,7],[3,6],[4,5]].map(([h,a])=>game('wild_card',`AFC${h}`,`AFC${a}`));
 const live=Object.fromEntries(games.map(g=>[g.id,final(survivors.includes(Number(g.home_team.at(-1)))?20:7,10)]));
 const result=projectProgression(collectiveRounds(rows,games),live,snapshot,2026)[1];
 const ordered=[1,...survivors].sort((a,b)=>a-b);
 assert.deepEqual(result.games.filter(g=>g.conference==='AFC').map(g=>[g.home_seed,g.away_seed]),[[ordered[0],ordered[3]],[ordered[1],ordered[2]]]);
});
test('no seeds: winners can be named but cannot be placed in a guessed matchup',()=>{
 const g=game('wild_card','Bears','Packers');
 const result=projectProgression(collectiveRounds(rows,[g]),{Bears:final()},undefined,2026);
 assert.deepEqual(result[1].qualified,[{team:'Bears'}]);assert.deepEqual(result[1].games,[]);
});
test('official future games take precedence and input remains unchanged',()=>{
 const games=[game('divisional','AFC1','AFC7')];const rounds=collectiveRounds(rows,games);const before=JSON.stringify(rounds);
 assert.deepEqual(projectProgression(rounds,{},snapshot,2026)[1].games,games);
 assert.equal(JSON.stringify(rounds),before);
});
test('Divisional winners meet by original seed, and conference champions reach Super Bowl',()=>{
 const games=[game('divisional','AFC1','AFC6'),game('divisional','AFC2','AFC5')];
 const result=projectProgression(collectiveRounds(rows,games),{AFC1:final(0,7),AFC2:final()},snapshot,2026);
 assert.deepEqual(result[2].games.map(g=>[g.home_team,g.away_team]),[['AFC2','AFC6']]);
 const conf=game('conference','AFC2','AFC6');
 const partial=projectProgression(collectiveRounds(rows,[conf]),{AFC2:final()},snapshot,2026);
 assert.equal(partial[3].games[0].away_team,'AFC2');assert.equal(partial[3].games[0].home_team,null);
});
