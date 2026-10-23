import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeeklySummary,summarySource} from './data.mjs';

function fixture(){
  const state={settings:{current_season:2026,current_week:3},users:['a','b'],teams:[],
    games:[{id:'g',season:2026,week:2,is_pool_eligible:true,away_team:'Bears',home_team:'Patriots',away_score:24,home_score:17}],
    picks:[{id:'p',game_id:'g',user_id:'a',picked_team:'Bears',predicted_spread:3}],
    qb_picks:['a','b'].map(user_id=>({season:2026,week:2,user_id,qb_id:user_id,selected_qb_name:user_id==='a'?'Jalen Hurts':'Josh Allen',selected_espn_athlete_id:user_id==='a'?'1':'2',selected_team:'Eagles'})),
    qb_ratings:[{season:2026,week:2,qb_id:'a',passer_rating:118.4,actual_qb_name:'Jalen Hurts',actual_espn_athlete_id:'1'},{season:2026,week:2,qb_id:'b',passer_rating:100,actual_qb_name:'Josh Allen',actual_espn_athlete_id:'2'}],
    weekly_scores:[{season:2026,week:1,user_id:'a',final_score:0},{season:2026,week:1,user_id:'b',final_score:3},{season:2026,week:2,user_id:'a',final_score:5},{season:2026,week:2,user_id:'b',final_score:1}],qbs:[{id:'a',name:'Tanner McKee'}]};
  return state;
}
test('uses the completed week, persisted points and ranks before/after that week only',()=>{
  const state=fixture(),before=structuredClone(state);
  state.weekly_scores.push({season:2026,week:3,user_id:'b',final_score:999},{season:2027,week:2,user_id:'b',final_score:999});
  const result=buildWeeklySummary(state,'a',{p:1});
  assert.deepEqual(result.score,{points:5,rank:1,participants:2});
  assert.deepEqual(result.overall,{rank:1,previousRank:2,movement:1,total:5});
  assert.equal(result.week,2);assert.equal(result.nextWeek,3);
  assert.equal(result.games[0].points,1);assert.equal(result.games[0].resultText,'Bears par 7');
  state.weekly_scores.splice(-2);assert.deepEqual(state,before);
});
test('mutable catalog names never create a replacement or change the historical headshot',()=>{
  const state=fixture(),summary=buildWeeklySummary(state,'a',{p:2});
  assert.equal(summary.qb.selected.name,'Jalen Hurts');assert.equal(summary.qb.actual.name,'Jalen Hurts');
  assert.equal(summary.qb.actual.espn_athlete_id,'1');assert.equal(summary.qb.replaced,false);
});
test('a true replacement uses the shared actual identity and compares actual QBs once',()=>{
  const state=fixture();Object.assign(state.qb_ratings[0],{actual_qb_name:'Tanner McKee',actual_espn_athlete_id:'2',passer_rating:100});
  Object.assign(state.qb_ratings[1],{actual_qb_name:'Tanner McKee',actual_espn_athlete_id:'2'});
  const {qb}=buildWeeklySummary(state,'a',{p:0});
  assert.equal(qb.replaced,true);assert.equal(qb.selected.name,'Jalen Hurts');assert.equal(qb.actual.name,'Tanner McKee');
  assert.equal(qb.count,1);assert.equal(qb.rank,1);assert.equal(qb.rating,100);
});
test('real score/rating zero is shown; week one has no invented previous ranking',()=>{
  const state=fixture();state.settings.current_week=2;
  for(const field of ['games','qb_picks','qb_ratings'])state[field].forEach(row=>row.week=1);
  state.weekly_scores=state.weekly_scores.filter(row=>row.week===1);
  state.qb_ratings[0].passer_rating=0;
  const summary=buildWeeklySummary(state,'a',{p:0});
  assert.equal(summary.score.points,0);assert.equal(summary.qb.rating,0);assert.equal(summary.overall.previousRank,null);assert.equal(summary.overall.movement,null);
});
test('missing personal picks, result identity, or points fail closed',()=>{
  for(const change of [s=>{s.picks=[];},s=>{s.qb_ratings[0].actual_espn_athlete_id=null;},s=>{s.qb_picks[0].selected_qb_name=null;}]){
    const state=fixture();change(state);assert.throws(()=>buildWeeklySummary(state,'a',{p:1}));
  }
  assert.throws(()=>buildWeeklySummary(fixture(),'a',{}));
});
test('source guard ignores current-week choices/catalog edits but detects historical changes',()=>{
  const state=fixture(),original=summarySource(state);
  state.qbs[0].name='Another catalog QB';
  state.qb_picks.push({...state.qb_picks[0],week:3});
  state.weekly_scores.push({...state.weekly_scores[0],week:3});
  assert.equal(summarySource(state),original);
  state.weekly_scores[0].final_score=8;assert.notEqual(summarySource(state),original);
});
