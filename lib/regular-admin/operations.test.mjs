import test from 'node:test';
import assert from 'node:assert/strict';
import {regularOrder} from '../seasons/selectionOrder.mjs';
import {calculateRegularWeek,publishRegularWeek,advanceRegularWeek,syncScheduledRegularWeek} from './operations.mjs';
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
 h.qbReservations=['qb-final-week-7-user-a','qb-final-week-7-user-b'];
 h.plan={games:[],ratings:[],qbStats:[],warnings:[],pending:0};
 h.options={
  now:()=>new Date('2026-10-25T16:00:00Z'),
  prepare:async(source,{mode})=>{assert.equal(source,h.state);h.mode=mode;return h.plan;},
  standings:async()=>({teams:[],warnings:[]}),
 };
 h.client={from(table){
  const q={select(){return q;},eq(){return q;},single:async()=>({data:h.context,error:null}),
   in(column,keys){assert.equal(column,'event_key');return Promise.resolve({data:h.qbReservations
    .filter(key=>keys.includes(key)).map(event_key=>({event_key})),error:null});},
   is(){return q;},not(){return q;},order(){return q;},
   then(resolve){return Promise.resolve({data:[],error:table==='push_notification_events'?h.queueError:null}).then(resolve);}};
  return q;
 },rpc:async(name,args)=>{
  h.calls.push({name,args});
  if(name==='regular_week_ranking_state')return {data:h.state,error:h.readError};
  if(name==='commit_regular_week_results')return {data:{
   updated:2,version:1,changed:true,baseline:false,games_updated:1,ratings_updated:0,teams_updated:0,qb_stats_updated:0,
   advance:{season:2026,week:8,revision:3,started_at:'2026-10-25T16:00:00Z'},
  },error:h.publishError};
  throw Error('Unexpected RPC');
 }};return h;
}
const request={season:2026,week:7,revision:2,actor:'verified-admin'};
test('Admin prepares the ESPN batch and passes canonical rows plus the exact observed source to one RPC',async()=>{
 const h=clientFixture(),r=await publishRegularWeek(h.client,request,()=>{},h.options);
 assert.deepEqual(h.calls.map(c=>c.name),['regular_week_ranking_state','commit_regular_week_results']);
 const p=h.calls[1].args;assert.equal(p.p_actor,'verified-admin');assert.equal(p.p_expected,h.state);
 assert.equal(p.p_mode,'manual');assert.deepEqual(p.p_results,calculateRegularWeek(h.state));
 assert.equal(r.updated,2);assert.equal(r.publication.version,1);
});
test('source read error prevents publication',async()=>{
 const h=clientFixture();h.readError=Error('source offline');
 await assert.rejects(publishRegularWeek(h.client,request,()=>{},h.options),/source offline/);assert.equal(h.calls.length,1);
});
test('stale phase, season, week, revision and pause never reach the publisher',async()=>{
 for(const change of [{phase:'playoffs'},{current_season:2027},{current_week:8},{revision:3},{regular_writes_paused:true}]){
  const h=clientFixture();Object.assign(h.context,change);
  await assert.rejects(publishRegularWeek(h.client,request,()=>{},h.options),/périmé ou fermé/);assert.deepEqual(h.calls,[]);
 }
});
test('rejected commit cannot be followed by an Admin notification attempt',async()=>{
 const h=clientFixture();h.publishError=Error('stale snapshot');let sent=0;
 await assert.rejects(publishRegularWeek(h.client,request,()=>{sent++;},h.options),/stale snapshot/);assert.equal(sent,0);
});
test('notification infrastructure failure preserves successful publication counts',async()=>{
 const h=clientFixture();h.queueError=Error('queue offline');
 const r=await publishRegularWeek(h.client,request,()=>{},h.options);
 assert.equal(r.updated,2);assert.equal(r.notifications.failed,1);
});
test('closing fails without writes when the outgoing ESPN verification fails',async()=>{
 const h=clientFixture();h.options.prepare=async()=>{throw Error('rating final indisponible');};
 await assert.rejects(advanceRegularWeek(h.client,request,h.options),/rating final indisponible/);
 assert.deepEqual(h.calls.map(c=>c.name),['regular_week_ranking_state']);
});
test('closure supplies the corrected score, actual QB and ranking before the one atomic advancement call',async()=>{
 const h=clientFixture();
 h.plan.games=[{id:'g',home_score:27,away_score:20,result_status:'final'}];
 h.plan.ratings=[{game_id:'g',qb_id:'q',actual_qb_name:'ESPN replacement',actual_espn_athlete_id:'333',passer_rating:125}];
 assert.equal((await advanceRegularWeek(h.client,request,h.options)).week,8);
 const commit=h.calls[1].args;
 assert.equal(commit.p_mode,'close');assert.deepEqual(commit.p_games,h.plan.games);assert.deepEqual(commit.p_ratings,h.plan.ratings);
 assert.deepEqual(commit.p_results.map(row=>[row.user_id,row.final_score]),[['a',2.5],['b',0]]);
 const players=[{id:'a',initial_order:1},{id:'b',initial_order:2}];
 assert.deepEqual(regularOrder(players,8,calculateRegularWeek(h.state)).map(p=>p.id),['b','a']);
 // Different corrected rating and tied score can flip the very next selection.
 h.plan.games[0].home_score=20; h.plan.ratings[0].passer_rating=70;
 await advanceRegularWeek(h.client,request,h.options);
 assert.deepEqual(regularOrder(players,8,h.calls.at(-1).args.p_results).map(p=>p.id),['a','b']);
});
test('scheduled flag off preserves the QB check without a ranking calculation or Admin identity',async()=>{
 const h=clientFixture();
 h.plan.games=[{id:'g',home_score:20,away_score:20,external_game_id:'5010',result_status:'final'}];
 h.plan.ratings=[{qb_id:'q',game_id:'g',passer_rating:125,actual_qb_name:'Actual',actual_espn_athlete_id:'4'}];
 const result=await syncScheduledRegularWeek(h.client,{},()=>{},h.options);
 assert.equal(h.mode,'qb-only');assert.equal(h.calls[1].args.p_actor,null);
 assert.deepEqual(h.calls[1].args.p_results,[]);assert.equal(result.notifications,undefined);
});
test('an automatic replay with no new final avoids the ranking transaction and still reads the queue',async()=>{
 const h=clientFixture();
 const completed=await syncScheduledRegularWeek(h.client,{automatic:true},()=>{},h.options);
 assert.equal(completed.status,'no_change');assert.equal(completed.notifications.sent,0);
 assert.deepEqual(h.calls.map(call=>call.name),['regular_week_ranking_state']);
 h.plan.warnings=['Rating final du QB sélectionné indisponible'];
 assert.equal((await syncScheduledRegularWeek(h.client,{automatic:true},()=>{},h.options)).status,'waiting_for_data');
 assert.equal(h.calls.length,2);
});
test('the live request scopes ESPN preparation while sending the full ranking snapshot to the existing RPC',async()=>{
 const h=clientFixture();
 const ready={id:'g',external_game_id:'5010',home_score:20,away_score:20,result_status:'final'};
 const gameIds=['g','partial'];
 h.options.prepare=async(source,options)=>{
  assert.equal(source,h.state);
  assert.equal(options.mode,'automatic');
  assert.deepEqual([...options.gameIds],gameIds);
  return {...h.plan,games:[ready],retryGameIds:['partial'],hasVerifiedGame:true};
 };
 const report=await syncScheduledRegularWeek(h.client,{automatic:true},()=>{},{
  ...h.options,context:h.context,gameIds,
 });
 const commit=h.calls[1].args;
 assert.equal(commit.p_expected,h.state);
 assert.equal(commit.p_actor,null);
 assert.equal(commit.p_mode,'automatic');
 assert.deepEqual(commit.p_games,[ready]);
 assert.deepEqual(report.retryGameIds,['partial']);
 assert.equal(report.notifications.sent,0);
});
test('QB-only identifies the existing rating whose legacy notification key was never reserved',async()=>{
 const h=clientFixture();
 h.qbReservations=['qb-final-week-7-user-b','qb-final-week-6-user-a'];
 h.options.prepare=async(source,{mode,qbNotificationsDue})=>{
  assert.equal(source,h.state);assert.equal(mode,'qb-only');
  assert.deepEqual([...qbNotificationsDue],['q']);
  return {...h.plan,games:[{id:'g',external_game_id:'5010',home_score:20,away_score:20,result_status:'final'}]};
 };
 await syncScheduledRegularWeek(h.client,{},()=>{},h.options);
 assert.equal(h.calls[1].args.p_mode,'qb-only');assert.deepEqual(h.calls[1].args.p_ratings,[]);
});
test('a new QB result outside the pool changes rankings without changing the already stored pool score',async()=>{
 const h=clientFixture();
 h.state.games.push({id:'qb-outside',season:2026,week:7,home_team:'Bears',away_team:'Other',is_pool_eligible:false});
 h.state.qb_picks[0].selected_team='Bears';h.state.qb_ratings.shift();
 h.plan.games=[{id:'qb-outside',home_score:32,away_score:30,result_status:'final'},
  {id:'g',home_score:21,away_score:20,result_status:'final'}];
 h.plan.ratings=[{qb_id:'q',game_id:'qb-outside',passer_rating:125,actual_qb_name:'Actual',actual_espn_athlete_id:'4'}];
 await syncScheduledRegularWeek(h.client,{automatic:true},()=>{},h.options);
 const commit=h.calls[1].args;
 assert.equal(commit.p_mode,'automatic');assert.deepEqual(commit.p_results.map(r=>[r.base_points,r.multiplier]),[[1,1.25],[1,.848]]);
});
