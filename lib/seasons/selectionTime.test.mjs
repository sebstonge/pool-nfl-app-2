import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSelectionStats,formatDuration} from './selectionTime.mjs';
import {regularClient} from './regularClient.mjs';
function database(){
 const data={
  users:[{id:'a',real_name:'Alex'},{id:'b',real_name:'Bob'},{id:'outsider'}],
  season_participants:[2026,2027].flatMap(season=>['a','b'].map((user_id,i)=>({season,user_id,initial_order:i+1,confirmed:true}))),
  qb_picks:[
   {season:2026,week:1,user_id:'a',created_at:'2026-09-01T19:35:00'},
   {season:2026,week:1,user_id:'b',created_at:'2026-09-01T20:05:00'},
   {season:2026,week:2,user_id:'b',created_at:'2026-09-08T09:00:00'},
   {season:2026,week:2,user_id:'a',created_at:'2026-09-08T10:00:00'},
   {season:2027,week:1,user_id:'a',created_at:'2027-09-01T19:15:00'},
   {season:2027,week:1,user_id:'b',created_at:'2027-09-01T19:35:00'}],
  weekly_scores:[{season:2026,week:1,user_id:'a',final_score:10},{season:2026,week:1,user_id:'b',final_score:1}],
  qb_selection_weeks:[{season:2026,week:2,started_at:'2026-09-08T07:00:00'}]
 };
 return {data,from(table){const filters=[];return {select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,v){filters.push(r=>v.includes(r[k]));return this;},lt(k,v){filters.push(r=>r[k]<v);return this;},lte(k,v){filters.push(r=>r[k]<=v);return this;},order(){return this;},then(resolve,reject){return Promise.resolve({data:data[table].filter(r=>filters.every(f=>f(r)))}).then(resolve,reject);}};}};
}
test('shared Admin calculation: initial order, prior-score order, opening floor and personal averages',async()=>{
 const db=database(),rows=await loadSelectionStats(regularClient(db,{season:2026}),2);
 assert.equal(rows.find(r=>r.userId==='a').average,45*60000);
 assert.equal(rows.find(r=>r.userId==='b').average,30*60000);
 assert.equal(rows.find(r=>r.userId==='a').samples,2);
 assert.equal(rows.length,2);
});
test('same week numbers in a new season never enter the personal average',async()=>{
 const rows=await loadSelectionStats(regularClient(database(),{season:2027}),1);
 assert.equal(rows.find(r=>r.userId==='a').average,10*60000);
 assert.equal(rows.find(r=>r.userId==='b').average,20*60000);
});
test('missing opening, missing previous pick, negative duration and no history stay empty',async()=>{
 const db=database();db.data.qb_picks=db.data.qb_picks.filter(p=>p.week===2);db.data.qb_selection_weeks=[];
 let rows=await loadSelectionStats(regularClient(db,{season:2026}),2);
 assert.equal(rows.find(r=>r.userId==='b').average,null);
 db.data.qb_picks=db.data.qb_picks.filter(p=>p.user_id==='a');
 rows=await loadSelectionStats(regularClient(db,{season:2026}),2);assert.ok(rows.every(r=>r.average===null));
 db.data.qb_picks.push({season:2026,week:2,user_id:'b',created_at:'2026-09-08T11:00:00'});
 rows=await loadSelectionStats(regularClient(db,{season:2026}),2);assert.equal(rows.find(r=>r.userId==='a').average,null);
});
test('read errors propagate without inventing a duration',async()=>{
 await assert.rejects(loadSelectionStats({from(){return {select:async()=>({error:{message:'denied'}})};}},1),/denied/);
 assert.equal(formatDuration(null),'—');assert.equal(formatDuration(0),'0 min');assert.equal(formatDuration(6120000),'1 h 42');
});
