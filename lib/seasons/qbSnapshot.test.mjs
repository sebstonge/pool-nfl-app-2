import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSnapshot,regularQbResult,isQbConsumed,ratingForPick} from './qbSnapshot.mjs';
import {qbHistory} from './qbHistory.mjs';
const snap=(week,name='Jalen Hurts',id='1')=>({id:`pick-${week}`,season:2026,week,qb_id:'reused-row',selected_qb_name:name,selected_espn_athlete_id:id,selected_team:'Eagles'});
const rating=(week,name,id,value=85.9)=>({season:2026,week,qb_id:'reused-row',actual_qb_name:name,actual_espn_athlete_id:id,passer_rating:value});
test('S2 normal, S6 replacement, S7 McKee normal, later Hurts return survive every catalog change',()=>{
 const picks=[snap(2),snap(6),snap(7,'Tanner McKee','2'),snap(9)];
 const ratings=[rating(2,'Jalen Hurts','1'),rating(6,'Tanner McKee','2',104.7),rating(7,'Tanner McKee','2',99.1),rating(9,'Jalen Hurts','1',110)];
 const original=structuredClone({picks,ratings});
 const first=qbHistory(picks,ratings,[{id:'reused-row',name:'Jalen Hurts',espn_athlete_id:'1'}]);
 const later=qbHistory(picks,ratings,[{id:'reused-row',name:'Tanner McKee',espn_athlete_id:'2',active:false}]);
 assert.deepEqual(first,later);assert.deepEqual(later.map(r=>r.replaced),[false,true,false,false]);
 assert.deepEqual(later.map(r=>r.name),['Jalen Hurts','Jalen Hurts','Tanner McKee','Jalen Hurts']);
 assert.equal(later[0].rating,85.9);assert.ok(later[1].details.includes('Remplacement : Tanner McKee'));assert.deepEqual({picks,ratings},original);
});
test('legacy unknown shows recorded actual identity and rating, never infers replacement from catalog',()=>{
 const p={id:'legacy',season:2026,week:2,qb_id:'reused-row',qbs:{name:'Tanner McKee',espn_athlete_id:'2',team:'Eagles'}};
 const r=rating(2,'Jalen Hurts','1');const outcome=regularQbResult(p,r);
 assert.equal(outcome.selected,null);assert.equal(outcome.replacementKnown,false);assert.equal(outcome.replaced,false);
 const row=qbHistory([p],[r],[p.qbs])[0];assert.equal(row.name,'Jalen Hurts');assert.equal(row.espn_athlete_id,'1');assert.equal(row.rating,85.9);assert.match(row.details.join(' '),/à confirmer/);
});
test('legacy missing result stays visible without inventing a catalog identity',()=>{
 const row=qbHistory([{week:1,qb_id:'unknown',qbs:{name:'Current QB'}}],[])[0];
 assert.equal(row.name,'QB historique non identifié');assert.equal(row.rating,null);assert.equal(row.replaced,false);
});
test('incomplete snapshot or missing final identity never proves replacement',()=>{
 assert.equal(selectionSnapshot({...snap(2),selected_espn_athlete_id:null}),null);
 assert.equal(regularQbResult(snap(2),{...rating(2,'Unknown',null)}).replacementKnown,false);
 assert.equal(regularQbResult(snap(2),null).replaced,false);
 assert.equal(regularQbResult(snap(2),{...rating(2,'McKee','2'),passer_rating:null}).replaced,false);
});
test('same QB in another week or season is not the result of this selection',()=>{
 assert.equal(regularQbResult(snap(2),rating(6,'McKee','2')).rating,null);
 assert.equal(regularQbResult(snap(2),{...rating(2,'McKee','2'),season:2027}).rating,null);
 assert.equal(ratingForPick(snap(2),[{...rating(2,'McKee','2'),season:2027},rating(2,'Hurts','1')]).actual_espn_athlete_id,'1');
});
test('consumption uses selected athlete even when its catalog row is now another QB',()=>{
 const picks=[snap(2)],ratings=[rating(2,'Hurts','1')];
 assert.equal(isQbConsumed({id:'reused-row',espn_athlete_id:'2'},picks,ratings),false);
 assert.equal(isQbConsumed({id:'new-row-for-hurts',espn_athlete_id:'1'},picks,ratings),true);
});
test('automatic substitute and selected DNP remain available unless consumed separately',()=>{
 assert.equal(isQbConsumed({id:'x',espn_athlete_id:'1'},[snap(6)],[rating(6,'McKee','2')]),false);
 assert.equal(isQbConsumed({id:'reused-row',espn_athlete_id:'2'},[snap(6)],[rating(6,'McKee','2')]),false);
 assert.equal(isQbConsumed({id:'x',espn_athlete_id:'2'},[snap(6),snap(7,'McKee','2')],[rating(6,'McKee','2'),rating(7,'McKee','2')]),true);
});
test('pending or ambiguous occurrence conserves existing cautious consumption',()=>{
 assert.equal(isQbConsumed({id:'x',espn_athlete_id:'1'},[snap(6)],[]),true);
 const old={qb_id:'reused-row',week:2};assert.equal(isQbConsumed({id:'reused-row',espn_athlete_id:'2'},[old],[rating(2,'Hurts','1')]),true);
});
