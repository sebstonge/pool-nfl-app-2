import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRegularWeek,publishRegularWeek,advanceRegularWeek} from './operations.mjs';
const context=()=>({id:1,current_season:2026,current_week:7,phase:'regular',revision:2,regular_finalized_at:null,playoff_reminders_enabled:false,regular_writes_paused:false});
const state=()=>({settings:context(),games:[{id:'g',season:2026,week:7,home_team:'Giants',away_team:'Commanders',home_score:20,away_score:20,result_status:'final',is_pool_eligible:true}],
 picks:[{user_id:'a',game_id:'g',picked_team:'Giants',predicted_spread:7},{user_id:'b',game_id:'g',picked_team:'Commanders',predicted_spread:0}],
 qb_picks:[{user_id:'a',qb_id:'q',selected_qb_name:'Selected',selected_espn_athlete_id:'1',selected_team:'Giants'},{user_id:'b',qb_id:'r',selected_qb_name:'Selected',selected_espn_athlete_id:'2',selected_team:'Commanders'}],
 qb_ratings:[{qb_id:'q',passer_rating:111.9},{qb_id:'r',passer_rating:84.8}],participants:[{user_id:'a',confirmed:true},{user_id:'b',confirmed:true}]});
test('weekly SQL publication input gives both sides one base point with unchanged QB math',()=>{
 assert.deepEqual(calculateRegularWeek(state()),[{user_id:'a',week:7,base_points:1,multiplier:1.119,final_score:1.119},{user_id:'b',week:7,base_points:1,multiplier:.848,final_score:.848}]);
});
test('live and unconfirmed equal scores create no published results',()=>{
 for(const score of [0,20]){const s=state();Object.assign(s.games[0],{home_score:score,away_score:score,result_status:null,state:'in'});assert.deepEqual(calculateRegularWeek(s),[]);}
});
test('expected final rating missing blocks publication instead of silently using one',()=>{
 const s=state();s.qb_ratings=[];assert.throws(()=>calculateRegularWeek(s),/Rating QB final attendu/);
});
test('QB match normally pending keeps the current interim multiplier without source errors',()=>{
 const s=state();s.qb_ratings=[];
 for(const [i,p] of s.qb_picks.entries()){
  p.selected_team='Pending '+i;
  s.games.push({id:'q'+i,home_team:p.selected_team,away_team:'Opponent '+i,result_status:null,home_score:null,away_score:null,is_pool_eligible:false});
 }
 assert.deepEqual(calculateRegularWeek(s).map(r=>r.multiplier),[1,1]);
});
test('numeric zero QB rating and rounding preserve existing regular rule',()=>{
 const s=state();s.qb_ratings[0].passer_rating=0;s.qb_ratings[1].passer_rating=112.85;
 assert.deepEqual(calculateRegularWeek(s).map(r=>[r.multiplier,r.final_score]),[[1,1],[1.128,1.128]]);
});
function clientFixture(){
 const h={context:context(),state:state(),calls:[],publishError:null,readError:null,queueError:null};
 h.client={from(table){const q={select(){return q;},eq(){return q;},single:async()=>({data:h.context,error:null}),
  is(){return q;},not(){return q;},order(){return q;},then(resolve){return Promise.resolve({data:[],error:h.queueError}).then(resolve);}};return q;},rpc:async(name,args)=>{
  h.calls.push({name,args});
  if(name==='regular_week_ranking_state')return {data:h.state,error:h.readError};
  if(name==='publish_regular_week')return {data:{updated:2,version:1,changed:true,baseline:false},error:h.publishError};
  if(name==='advance_regular_week')return {data:{season:2026,week:8,revision:3,started_at:'2026-10-25T16:00:00Z'}};
  throw Error('Unexpected RPC');
 }};return h;
}
const request={season:2026,week:7,revision:2,actor:'verified-admin'};
test('publication passes canonical rows and exact observed source to one atomic RPC',async()=>{
 const h=clientFixture(),r=await publishRegularWeek(h.client,request,()=>{}, {now:()=>new Date('2026-10-25T16:00:00Z')});
 assert.deepEqual(h.calls.map(c=>c.name),['regular_week_ranking_state','publish_regular_week']);
 const p=h.calls[1].args;assert.equal(p.p_actor,'verified-admin');assert.equal(p.p_expected,h.state);
 assert.deepEqual(p.p_results,calculateRegularWeek(h.state));assert.equal(r.updated,2);assert.equal(r.publication.version,1);
});
test('source read error prevents publication',async()=>{
 const h=clientFixture();h.readError=Error('source offline');await assert.rejects(publishRegularWeek(h.client,request,()=>{}),/source offline/);
 assert.equal(h.calls.length,1);
});
test('stale phase/season/week/revision and pause never reach the publisher',async()=>{
 for(const change of [{phase:'playoffs'},{current_season:2027},{current_week:8},{revision:3},{regular_writes_paused:true}]){
  const h=clientFixture();Object.assign(h.context,change);await assert.rejects(publishRegularWeek(h.client,request,()=>{}),/périmé ou fermé/);assert.deepEqual(h.calls,[]);
 }
});
test('rejected commit cannot be followed by a notification attempt',async()=>{
 const h=clientFixture();h.publishError=Error('stale snapshot');let sent=0;
 await assert.rejects(publishRegularWeek(h.client,request,()=>{sent++;}),/stale snapshot/);assert.equal(sent,0);
});
test('notification infrastructure failure preserves successful publication counts for partial UI',async()=>{
 const h=clientFixture();h.queueError=Error('queue offline');const r=await publishRegularWeek(h.client,request,()=>{});
 assert.equal(r.updated,2);assert.equal(r.notifications.failed,1);assert.equal(r.warnings.length,1);
});
test('week advancement sends fixed caller context to a single RPC without notification or client writes',async()=>{
 const h=clientFixture(),r=await advanceRegularWeek(h.client,request);
 assert.deepEqual(h.calls,[{name:'advance_regular_week',args:{p_season:2026,p_week:7,p_revision:2,p_actor:'verified-admin'}}]);assert.equal(r.week,8);
});
