import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotState, confirmationRequest, requestSnapshot } from './snapshotAdmin.mjs';
const capturedAt='2026-09-24T13:38:29.777255+00:00';
const fixture=()=>Array.from({length:14},(_,i)=>({season:2026,conference:i<7?'AFC':'NFC',seed:i%7+1,team:`Team ${i}`,espn_team_id:String(i+1),captured_at:capturedAt,finalized_at:null}));
test('provisional snapshot contains seven ordered seeds in each conference',()=>{
 const state=snapshotState(fixture().reverse(),2026);
 assert.equal(state.finalized,false);assert.equal(state.locked,false);assert.equal(state.canFinalize,true);
 for(const c of state.conferences)assert.deepEqual(c.rows.map(r=>r.seed),[1,2,3,4,5,6,7]);
});
test('finalized snapshot locks all mutations',()=>{
 const state=snapshotState(fixture().map(r=>({...r,finalized_at:'2027-01-10T00:00:00Z'})),2026);
 assert.equal(state.finalized,true);assert.equal(state.canFinalize,false);
 for(const action of ['sync','finalize'])assert.throws(()=>confirmationRequest(action,2026,state,true));
});
test('confirmation required and reviewed timestamp is preserved',()=>{
 const reviewed=snapshotState(fixture(),2026);
 for(const action of ['sync','finalize'])assert.throws(()=>confirmationRequest(action,2026,reviewed,false));
 assert.deepEqual(confirmationRequest('sync',2026,reviewed,true),{action:'sync',season:2026});
 const newer=snapshotState(fixture().map(r=>({...r,captured_at:'2026-09-25T00:00:00Z'})),2026);
 const body=confirmationRequest('finalize',2026,reviewed,true);
 assert.deepEqual(body,{action:'finalize',season:2026,expectedCapturedAt:capturedAt,regularSeasonComplete:true});
 assert.notEqual(body.expectedCapturedAt,newer.capturedAt);
});
test('missing, incomplete, mixed and inconsistent snapshots cannot finalize',()=>{
 const mixed=fixture();mixed[0].finalized_at='2027-01-10T00:00:00Z';
 const inconsistent=fixture();inconsistent[0].captured_at='2026-09-25T00:00:00Z';
 for(const rows of [[],fixture().slice(1),mixed,inconsistent]){
  const state=snapshotState(rows,2026);assert.equal(state.canFinalize,false);
  assert.throws(()=>confirmationRequest('finalize',2026,state,true));
 }
 assert.equal(snapshotState(mixed,2026).locked,true);
});
const client={auth:{getSession:async()=>({data:{session:{access_token:'mock-token'}}})}};
test('read and confirmed operations use existing protected API only (mock)',async()=>{
 for(const action of ['read','sync','finalize']){
  const body=action==='read'?{action,season:2026}:confirmationRequest(action,2026,snapshotState(fixture(),2026),true);
  const rows=await requestSnapshot(client,body,async(url,options)=>{
   assert.equal(url,'/api/admin/playoff-seeds');assert.equal(options.headers.Authorization,'Bearer mock-token');
   assert.deepEqual(JSON.parse(options.body),body);return {ok:true,json:async()=>({rows:fixture()})};
  });assert.equal(rows.length,14);
 }
});
test('backend rejection is surfaced without returning replacement rows',async()=>{
 await assert.rejects(requestSnapshot(client,{action:'finalize'},async()=>({ok:false,json:async()=>({error:'Snapshot périmé'})})),/Snapshot périmé/);
});
test('unauthenticated requests cannot reach backend',async()=>{
 await assert.rejects(requestSnapshot({auth:{getSession:async()=>({data:{session:null}})}},{action:'read'},()=>assert.fail('No fetch allowed')),/Connecte-toi/);
});
