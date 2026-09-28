import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedRound,roundData,homeSummary,qbGroups,pickStatistics} from './publicData.mjs';
const game={id:1,round_id:2,external_game_id:'123',home_team:'A',away_team:'B',game_status:'post',home_score:21,away_score:14,game_date:'2030-01-01T00:00:00Z'};
const data=()=>({userId:'u',season:2026,rounds:[{id:1,round_key:'wild_card',round_order:1,status:'finalized'},{id:2,round_key:'divisional',round_order:2,status:'open'}],games:[game],players:[{id:'u',display_name:'Alice'},{id:'v',real_name:'Bob'}],picks:[{user_id:'u',game_id:1,picked_team:'A',predicted_spread:7}],paths:[{user_id:'u',round_id:2,team:'A',multiplier:1}],qbPicks:[{user_id:'u',round_id:2,qb_id:1,qbs:{name:'QB'}},{user_id:'v',round_id:2,qb_id:1,qbs:{name:'QB'}}]});
test('active round is data-driven; future rounds remain empty',()=>{
 const d=data();assert.equal(selectedRound(d).key,'divisional');assert.deepEqual(roundData(d,selectedRound(d,'super_bowl')),{games:[],picks:[],qbPicks:[],paths:[]});
});
test('home uses complete persisted submission and stored multiplier only',()=>{
 const d=data(),summary=homeSummary(d,Date.parse('2029-01-01'));assert.equal(summary.submission,'Soumis');assert.equal(summary.path.multiplier,1);assert.equal(summary.next,undefined);
 d.qbPicks=[];assert.equal(homeSummary(d).submission,'Incomplet');d.userId='other';assert.equal(homeSummary(d).submission,'Non soumis');
});
test('same QB is shown for multiple participants, without selecting an order',()=>{
 const groups=qbGroups(data(),{id:2});assert.equal(groups.length,1);assert.deepEqual(groups[0].players,['Alice','Bob']);
});
test('accuracy uses only official FINAL untied results, never TEST or score-only rows',()=>{
 const pick=data().picks[0];assert.deepEqual(pickStatistics([game],[pick]),{evaluated:1,correct:1,exact:1,accuracy:100});
 for(const patch of [{external_game_id:'TEST-1'},{game_status:null},{game_status:'in'},{away_score:null},{away_score:21}])assert.equal(pickStatistics([{...game,...patch}],[pick]).accuracy,null);
 assert.equal(pickStatistics([game],[{...pick,picked_team:'B'}]).accuracy,0);
 assert.equal(pickStatistics([game],[{...pick,picked_team:'Unknown'}]).evaluated,0);
});
