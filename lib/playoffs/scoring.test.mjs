import test from 'node:test';
import assert from 'node:assert/strict';
import {gamePoints,pathContext,adjustedPoints,applyQBRating,availableQBs,calculateRound} from './scoring.mjs';
import {resolveQB,summaryQuarterbacks,passerRating} from './qbResults.mjs';
import {completeUpdate} from './scoringOperations.mjs';
import {processedPlayoffResults} from '../../app/series/components/public-pages/processedResults.mjs';
const game={id:1,round_id:1,external_game_id:'TEST-WC',home_team:'A',away_team:'B',home_score:24,away_score:17,game_status:'post'};
const pick={id:1,user_id:'u',game_id:1,picked_team:'A',predicted_spread:7};
const round={id:1,round_order:1,round_key:'wild_card',status:'locked'};
const qb={id:1,name:'Starter',team:'A',is_active_starter:true,espn_athlete_id:'10'};
const players=[{id:'10',name:'Starter',snaps:40,rating:120,passingOrder:0},{id:'20',name:'Backup',snaps:10,rating:80,passingOrder:1}];
function fixture(){return {round,games:[game],picks:[pick],qbPicks:[{user_id:'u',qb_id:1,round_id:1}],paths:[{user_id:'u',round_id:1,team:'A'}],qbs:[qb],seeds:[],qbResults:{u:resolveQB(qb,players,game)}};}
for(const [name,patch,expected] of [['wrong winner',{picked_team:'B'},0],['right winner wrong spread',{predicted_spread:3},1],['exact',{},2]])test(`game: ${name}`,()=>assert.equal(gamePoints(game,{...pick,...patch}),expected));
for(const status of ['pre','in',null])test(`${status}: scores alone never become FINAL`,()=>assert.equal(gamePoints({...game,game_status:status},pick),null));
for(const n of [1,2,3,4])test(`path x${n} only multiplies its own game`,()=>{
 const path=pathContext({round,games:[game],seeds:[],path:{team:'A'},previous:n===1?null:{path_team:'A',path_alive:true,path_games_played:n-1}});
 const result=adjustedPoints([game,{...game,id:2,home_team:'C',away_team:'D'}],[pick,{...pick,id:2,game_id:2,picked_team:'C',predicted_spread:3}],path);
 assert.equal(result.subtotal,1+2*n);assert.equal(result.path_adjusted_points,2*n);
});
test('loss terminates path; replacement restarts at one; surviving team cannot change',()=>{
 const p=pathContext({round,games:[game],seeds:[],path:{team:'B'},previous:{path_alive:true,path_team:'B',path_games_played:2}});
 assert.equal(p.alive,false);assert.equal(adjustedPoints([game],[{...pick,picked_team:'B'}],p).path_adjusted_points,0);
 assert.equal(pathContext({round,games:[game],seeds:[],path:{team:'A'},previous:{path_alive:false,path_team:'B',path_games_played:3}}).multiplier,1);
 assert.throws(()=>pathContext({round,games:[game],seeds:[],path:{team:'A'},previous:{path_alive:true,path_team:'B',path_games_played:2}}));
});
test('bye has no game, no points, no increment; first real game remains x1',()=>{
 const p=pathContext({round,games:[game],seeds:[{team:'C',seed:1,finalized_at:'date'}],path:{team:'C'}});
 assert.equal(p.played,0);assert.equal(p.multiplier,0);assert.equal(p.game,null);assert.equal(adjustedPoints([game],[pick],p).subtotal,2);
 assert.equal(pathContext({round:{round_key:'divisional'},games:[{...game,home_team:'C'}],seeds:[],path:{team:'C'},previous:{path_alive:true,path_team:'C',path_games_played:0}}).multiplier,1);
 assert.throws(()=>pathContext({round,games:[game],seeds:[{team:'C',seed:1,finalized_at:null}],path:{team:'C'}}));
});
for(const [rating,expected] of [[100,9],[120,10.8],[80,7.2],[112.5,10.125],[0,0]])test(`QB multiplier ${rating}`,()=>assert.equal(applyQBRating(9,rating).final_score,expected));
test('DNP requires zero offensive snaps and consumes neither QB',()=>{
 const result=resolveQB(qb,players.map(p=>p.id==='10'?{...p,snaps:0,rating:null}:p),game);
 assert.equal(result.actual_espn_athlete_id,'20');assert.equal(result.consumed,false);assert.equal(result.dnp,true);
 const available=availableQBs([qb,{...qb,id:2}], [game],[{selected_qb_id:1,qb_consumed:false}]);assert.equal(available.length,2);
});
test('played then replaced keeps own rating and consumes selected QB',()=>{
 const result=resolveQB(qb,players,game);assert.equal(result.passer_rating,120);assert.equal(result.consumed,true);assert.equal(result.actual_espn_athlete_id,'10');
 assert.deepEqual(availableQBs([qb,{...qb,id:2}],[game],[{selected_qb_id:1,qb_consumed:true}]).map(q=>q.id),[2]);
 assert.deepEqual(availableQBs([qb],[game],[{selected_qb_id:1,qb_consumed:true}]).map(q=>q.id),[1]);
});
test('absent passer or unknown snap count never implies DNP; zero rating is valid',()=>{
 assert.throws(()=>resolveQB(qb,players.slice(1),game));
 assert.throws(()=>resolveQB(qb,players.map(p=>({...p,snaps:null})),game));
 assert.equal(resolveQB(qb,[{...players[0],rating:0}],game).passer_rating,0);
});
test('ESPN adapter uses regular RTG/C-ATT convention, explicit snaps and Washington alias',()=>{
 const summary={boxscore:{players:[{team:{abbreviation:'WSH'},statistics:[{name:'passing',labels:['C/ATT','YDS','TD','INT','RTG'],athletes:[{athlete:{id:'10',displayName:'Starter'},stats:['20/30','250','2','1','100.5']}]}]}]}};
 const normalized=summaryQuarterbacks(summary,'WAS');assert.equal(normalized[0].played,true);assert.equal(normalized[0].rating,100.5);
 assert.equal(resolveQB(qb,normalized,game).consumed,true);
 assert.equal(passerRating({attempts:30,completions:20,yards:250,touchdowns:2,interceptions:1}),100.7);
});
test('complete computation is deterministic, rejects finalized/partial submissions',()=>{
 const f=fixture(),a=calculateRound(f);assert.deepEqual(calculateRound(f),a);assert.equal(a.results[0].final_score,2.4);
 assert.equal(calculateRound({...f,qbResults:{u:{...f.qbResults.u,passer_rating:100}}}).results[0].final_score,2);
 assert.throws(()=>calculateRound({...f,round:{...round,status:'finalized'}}));assert.throws(()=>calculateRound({...f,paths:[]}));
});
test('TEST update never fetches, scores explicit FINAL, and non-final does not publish',async()=>{
 const f=fixture();let body;
 const state={rounds:[round],games:[{...game,test_qb_results:players.map(p=>({...p,team:'A'}))}],picks:f.picks,qbPicks:f.qbPicks,paths:f.paths,qbs:f.qbs,seeds:[],results:[],runs:[],teams:[]};
 const client={rpc:async(name,args)=>name==='playoff_scoring_state'?{data:state}:{error:null,...(body=args,{})}};
 await completeUpdate(client,{season:2099,roundKey:'wild_card'},()=>assert.fail('TEST sent to ESPN'));
 assert.equal(body.p_publication.results[0].final_score,2.4);assert.deepEqual(body.p_updates,[]);
 state.games[0].game_status=null;await completeUpdate(client,{season:2099,roundKey:'wild_card'},()=>assert.fail('TEST fetch'));assert.equal(body.p_publication,null);
});
test('four-round local fixture: continuing, bye, eliminated/restarted paths and DNP',()=>{
 const keys=['wild_card','divisional','conference','super_bowl'],history=[],runs=[],rounds=[],results=[];
 for(let i=0;i<4;i++){
  const r={id:i+1,round_key:keys[i],round_order:i+1,status:'locked'};rounds.push(r);
  // A wins all four; C has WC bye, wins DIV then loses CONF; player v restarts A at SB.
  const games=[{...game,id:10+i,round_id:r.id}];
  if(i===1)games.push({...game,id:20+i,round_id:r.id,home_team:'C',away_team:'D'});
  if(i===2)games[0].away_team='C';
  const users=['u','v'];const picks=users.flatMap(user_id=>games.map(g=>({...pick,id:`${i}-${user_id}-${g.id}`,user_id,game_id:g.id,picked_team:user_id==='v'&&i===2?'C':g.home_team})));
  const qbs=[{...qb,id:i+1}];
  const paths=users.map(user_id=>({user_id,round_id:r.id,team:user_id==='u'||i===3?'A':'C'}));
  const qbPicks=users.map(user_id=>({user_id,round_id:r.id,qb_id:i+1}));
  const qbResults=Object.fromEntries(users.map(u=>[u,{...resolveQB(qbs[0],i===1?players.map(p=>p.id==='10'?{...p,snaps:0}:p):players,games[0]),passer_rating:100}]));
  const publication=calculateRound({round:r,games,picks,paths,qbPicks,qbs,seeds:[{team:'C',seed:1,finalized_at:'fixture'}],previousResults:history,qbResults});
  const [u,v]=publication.results;
  assert.equal(u.path_multiplier,i+1);assert.equal(v.path_multiplier,[0,1,2,1][i]);
  assert.equal(v.path_alive,i!==2);if(i===1)assert.equal(u.qb_consumed,false);
  history.push(...publication.results);results.push(...publication.results);runs.push({round_id:r.id,processed_at:'fixture',standings:publication.standings});
  const view=processedPlayoffResults({rounds,players:users.map(id=>({id})),processed:{results,runs}});
  assert.equal(view.progression.rows[0].points.length,i+1);
 }
 assert.equal(history.at(-2).cumulative_score,22);assert.equal(history.at(-1).cumulative_score,8);
});
