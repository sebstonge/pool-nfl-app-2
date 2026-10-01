import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalytics} from './analyticsData.mjs';

const make=()=>({season:2026,userId:'u',
 rounds:[{id:1,season:2026,round_key:'wild_card',round_order:1},{id:2,season:2026,round_key:'divisional',round_order:2}],
 games:[{id:10,round_id:1,external_game_id:'TEST-WC',game_status:'post',home_team:'A',away_team:'B',home_score:21,away_score:14}],
 players:[{id:'u',display_name:'Alice',real_name:'Alice Real'},{id:'v',display_name:'Bob'}],
 picks:[{id:100,user_id:'u',game_id:10,picked_team:'A',predicted_spread:7}],
 qbPicks:[{user_id:'u',round_id:1,qb_id:'selected',qbs:{name:'Starter',team:'A',espn_athlete_id:'10'}}],
 processed:{runs:[],results:[]},
});
function publish(d,{user='u',round=1,points=2,score=2.4,rating=120}={}) {
 if(!d.processed.runs.some(r=>r.round_id===round))d.processed.runs.push({round_id:round,processed_at:'2027-01-15T00:00:00Z',standings:[]});
 const pick=d.picks.find(p=>p.user_id===user);
 d.processed.results.push({round_id:round,round_order:round,user_id:user,final_score:score,selected_qb_id:'selected',
  pick_results:pick?[{game_id:pick.game_id,pick_id:pick.id,points,multiplier:4,adjusted_points:points*4}]:[],
  qb_result:{selected_qb_id:'selected',actual_espn_athlete_id:'20',actual_qb_name:'Backup',team:'A',game_id:10,passer_rating:rating,dnp:true,consumed:false},
 });return d;
}
function assertEmpty(s) {
 assert.equal(s.totalPicks,0);assert.equal(s.consensusPct,null);assert.equal(s.myTotalScore,null);
 for(const key of ['bestRound','worstRound','bestQb','worstQb','myBestRound','myWorstRound'])assert.equal(s[key],null);
 for(const key of ['topExact','topCorrect','myRoundRows'])assert.deepEqual(s[key],[]);
}
test('no publication: FINAL games and selections never create outcome statistics',()=>{
 const d=make();d.live={passer_rating:158.3};d.qb_ratings=[{passer_rating:158.3}];
 assertEmpty(buildAnalytics(d));assert.equal(buildAnalytics(d).myQbPicks[0].rating,null);
});
test('orphan results and run without processed_at stay empty',()=>{
 const d=publish(make());d.processed.runs=[];assertEmpty(buildAnalytics(d));
 d.processed.runs=[{round_id:1,processed_at:null}];assertEmpty(buildAnalytics(d));
});
test('publication fills records, counts, rankings, consensus and personal rows',()=>{
 const d=publish(make());const before=JSON.stringify(d),s=buildAnalytics(d);
 assert.equal(s.totalPicks,1);assert.equal(s.totalExact,1);assert.equal(s.totalCorrect,1);
 assert.equal(s.topExact[0].value,1);assert.equal(s.topCorrect[0].detail,'100 % de bons gagnants');
 assert.equal(s.bestRound.score,2.4);assert.equal(s.worstRound.name,'Alice');
 assert.equal(s.myTotalScore,2.4);assert.equal(s.myRoundRows[0].round,'Wild Card');
 assert.equal(s.consensusWins,1);assert.equal(s.consensusPct,100);assert.equal(s.bestConsensusRound.round,'Wild Card');
 assert.equal(s.bestQb.rating,120);assert.equal(s.myQbPicks[0].rating,120);assert.equal(JSON.stringify(d),before);
});
test('true score and QB zero remain results rather than missing values',()=>{
 const s=buildAnalytics(publish(make(),{score:0,rating:0,points:0}));
 assert.equal(s.bestRound.score,0);assert.equal(s.worstRound.score,0);assert.equal(s.myTotalScore,0);
 assert.equal(s.bestQb.rating,0);assert.equal(s.worstQb.rating,0);assert.equal(s.myQbPicks[0].rating,0);
 assert.equal(s.totalPicks,1);assert.equal(s.consensusPct,0);assert.equal(s.consensusLosses,1);
});
test('published 0/1/2 points count outcomes without path or final-score multipliers',()=>{
 for(const points of [0,1,2]){
  const d=publish(make(),{points,score:999});const s=buildAnalytics(d);
  assert.equal(s.totalCorrect,Number(points>0));assert.equal(s.totalExact,Number(points===2));
  assert.equal(s.totalPicks,1);
 }
});
test('shared actual QB is one performance, with every selecting player named',()=>{
 const d=make();d.picks.push({id:101,user_id:'v',game_id:10,picked_team:'A'});
 publish(d);publish(d,{user:'v'});const s=buildAnalytics(d);
 assert.equal(s.bestQb.name,'Backup');assert.equal(s.bestQb.selectedBy,'Alice, Bob');
 assert.equal(s.worstQb.selectedBy,'Alice, Bob');assert.equal(s.consensusWins,1);assert.equal(s.totalPicks,2);
});
test('fallback retains selected history and attributes record/rating to actual QB',()=>{
 const s=buildAnalytics(publish(make()));
 assert.equal(s.myQbPicks[0].qbName,'Starter');assert.equal(s.myQbPicks[0].actualQbName,'Backup');
 assert.equal(s.bestQb.name,'Backup');assert.equal(s.bestQb.espn_athlete_id,'20');
});
test('republication replaces previous statistics and zero can replace nonzero',()=>{
 const d=publish(make());assert.equal(buildAnalytics(d).totalExact,1);
 d.processed.results=[];publish(d,{points:0,score:0,rating:0});const s=buildAnalytics(d);
 assert.equal(s.totalPicks,1);assert.equal(s.totalExact,0);assert.equal(s.myTotalScore,0);
 assert.equal(s.bestQb.rating,0);
});
test('TEST publication works independently of present game state or scores',()=>{
 const d=publish(make());const before=buildAnalytics(d);
 d.games[0]={...d.games[0],game_status:'pre',home_score:null,away_score:999};
 assert.deepEqual(buildAnalytics(d),before);
});
test('equal published votes exclude consensus, unpublished picks never sway it',()=>{
 const d=publish(make());d.picks.push({id:101,user_id:'v',game_id:10,picked_team:'B'});
 assert.equal(buildAnalytics(d).consensusPct,100);
 publish(d,{user:'v',points:0});assert.equal(buildAnalytics(d).consensusPct,null);
});
test('missing matching published pick cannot create a partial majority',()=>{
 const d=publish(make());d.picks=[];const s=buildAnalytics(d);
 assert.equal(s.totalPicks,1);assert.equal(s.consensusPct,null);
});
test('several published rounds fill cumulative, average inputs and personal extrema',()=>{
 const d=publish(make());publish(d,{round:2,score:0,rating:0,points:0});const s=buildAnalytics(d);
 assert.equal(s.myRoundRows.length,2);assert.equal(s.myTotalScore/s.myRoundRows.length,1.2);
 assert.equal(s.myBestRound.round,'Wild Card');assert.equal(s.myWorstRound.round,'Divisional');
 assert.equal(s.bestConsensusRound.round,'Wild Card');assert.equal(s.worstConsensusRound.round,'Divisional');
 assert.equal(s.worstQb.rating,0);
});
test('explicit season excludes future published rounds, QB history and records',()=>{
 const d=publish(make());const expected=buildAnalytics(d);
 d.rounds.push({id:99,season:2099,round_key:'wild_card',round_order:1});
 publish(d,{round:99,score:999,rating:158.3});
 d.qbPicks.push({user_id:'u',round_id:99,qb_id:'future'});
 assert.deepEqual(buildAnalytics(d),expected);
});
test('QB history is private and ordered, unprocessed selections stay descriptive',()=>{
 const d=make();d.qbPicks.unshift({user_id:'u',round_id:2,qbs:{name:'QB B'}});
 d.qbPicks.push({user_id:'v',round_id:1,qbs:{name:'Other'}});
 const s=buildAnalytics(d);assert.deepEqual(s.myQbPicks.map(p=>p.round),['Wild Card','Divisional']);
 assert.ok(s.myQbPicks.every(p=>p.rating===null));assert.equal(s.bestQb,null);
});
