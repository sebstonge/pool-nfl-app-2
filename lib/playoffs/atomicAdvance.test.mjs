import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceRound} from './atomicAdvance.mjs';
import {roundSummary,expectedMatchups} from './rounds.mjs';
import {fixtureSeeds,fixtureTeams,fixtureSchedule,response} from './roundFixtures.mjs';
function fixture({receipt=null,phase='playoffs',status='scored'}={}){
 const context={id:1,current_season:2099,current_week:18,phase,revision:2,regular_finalized_at:null,playoff_reminders_enabled:false};
 const seeds=fixtureSeeds(),rounds=[{id:1,season:2099,round_key:'wild_card',round_order:1,status}];
 const games=expectedMatchups(seeds,2099,'wild_card',[],[]).map((p,i)=>({...p,id:i+1,round_id:1,external_game_id:String(100+i),game_status:'post',home_score:10,away_score:20}));
 const scoring={rounds,games,seeds,teams:fixtureTeams()},calls=[];
 const client={from(table){return {select(){return this;},eq(){return this;},async single(){return {data:context};},async maybeSingle(){assert.equal(table,'playoff_round_advances');return {data:receipt};}};},async rpc(name,args){calls.push({name,args});return name==='playoff_scoring_state'?{data:scoring}:{data:{}};}};
 return {client,calls,context,scoring};
}
test('PREPARE reuses discovery before single atomic RPC with exact snapshot and actor',async()=>{
 const f=fixture(),expected=expectedMatchups(f.scoring.seeds,2099,'divisional',f.scoring.rounds,f.scoring.games);
 let fetched=false;
 await advanceRound(f.client,{season:2099,roundKey:'wild_card',actor:'admin'},async(...args)=>{
  assert.equal(f.calls.length,1);fetched=true;return response(fixtureSchedule(expected,'divisional'))(...args);
 });
 assert.ok(fetched);assert.equal(f.calls.length,2);const {name,args}=f.calls[1];assert.equal(name,'advance_playoff_round_atomic');
 assert.deepEqual(args.p_expected,{context:f.context,scoring:f.scoring});assert.equal(args.p_actor,'admin');assert.equal(args.p_games.length,4);
 assert.equal(roundSummary({season:2099,...f.scoring}).canAdvance,true);
});
test('ESPN failure causes zero mutating RPCs',async()=>{
 const f=fixture();await assert.rejects(advanceRound(f.client,{season:2099,roundKey:'wild_card'},()=>{throw Error('offline');}),/offline/);
 assert.deepEqual(f.calls.map(c=>c.name),['playoff_scoring_state']);
});
test('recognized retry skips ESPN but still goes through protected atomic RPC',async()=>{
 const f=fixture({receipt:{source_round_id:1},status:'finalized'});
 await advanceRound(f.client,{season:2099,roundKey:'wild_card',actor:'admin'},()=>assert.fail('retry must not fetch'));
 assert.equal(f.calls[1].name,'advance_playoff_round_atomic');assert.deepEqual(f.calls[1].args.p_games,[]);
});
test('wrong phase and Super Bowl refused before preparation; finalized source needs receipt',async()=>{
 for(const opts of [{phase:'regular'},{status:'finalized'}]){
  const f=fixture(opts);await assert.rejects(advanceRound(f.client,{season:2099,roundKey:'wild_card'},()=>assert.fail('no ESPN')));assert.ok(f.calls.every(c=>c.name==='playoff_scoring_state'));
 }
 const f=fixture();await assert.rejects(advanceRound(f.client,{season:2099,roundKey:'super_bowl'}),/Super Bowl/);assert.deepEqual(f.calls,[]);
});
