import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalytics} from './analyticsData.mjs';
const game={id:1,round_id:1,external_game_id:'123',game_status:'post',home_team:'A',away_team:'B',home_score:21,away_score:14};
const make=()=>({userId:'u',rounds:[{id:1,round_key:'wild_card',round_order:1},{id:2,round_key:'divisional',round_order:2}],games:[game],players:[{id:'u',display_name:'Alice'}],picks:[{user_id:'u',game_id:1,picked_team:'A',predicted_spread:7}],qbPicks:[]});
test('official results feed exact/correct leaderboards and round consensus, never scores',()=>{
 const s=buildAnalytics(make());assert.equal(s.totalExact,1);assert.equal(s.topCorrect[0].value,1);assert.equal(s.consensusPct,100);assert.equal(s.bestConsensusRound.round,'Wild Card');assert.equal(s.myTotalScore,null);assert.equal(s.bestQb,null);assert.deepEqual(s.myRoundRows,[]);
});
test('TEST, LIVE, tied, missing scores and games outside the loaded season do not become outcomes',()=>{
 for(const patch of [{external_game_id:'TEST-1'},{game_status:'in'},{home_score:14},{away_score:null},{round_id:99}]){
  const d=make();d.games=[{...game,...patch}];const s=buildAnalytics(d);assert.equal(s.totalPicks,0);assert.equal(s.consensusPct,null);assert.deepEqual(s.topExact,[]);
 }
});
test('equal selections have no majority, invalid choices do not vote, zero percent remains real',()=>{
 const d=make();d.picks.push({user_id:'v',game_id:1,picked_team:'B',predicted_spread:7});assert.equal(buildAnalytics(d).consensusPct,null);
 d.picks=[{user_id:'u',game_id:1,picked_team:'B',predicted_spread:7},{user_id:'v',game_id:1,picked_team:'unknown'}];const s=buildAnalytics(d);assert.equal(s.consensusPct,0);assert.equal(s.consensusLosses,1);assert.equal(s.totalPicks,1);
});
test('QB history is private, ordered by round, and cannot borrow regular ratings',()=>{
 const d=make();d.qbPicks=[{user_id:'u',round_id:2,qbs:{name:'QB B'}},{user_id:'v',round_id:1,qbs:{name:'Other'}},{user_id:'u',round_id:1,qbs:{name:'QB A'}},{user_id:'u',round_id:99,qbs:{name:'Other season'}}];d.qb_ratings=[{passer_rating:158.3}];
 const before=JSON.stringify(d),s=buildAnalytics(d);assert.deepEqual(s.myQbPicks.map(p=>p.round),['Wild Card','Divisional']);assert.ok(s.myQbPicks.every(p=>p.rating===null));assert.equal(JSON.stringify(d),before);
});
