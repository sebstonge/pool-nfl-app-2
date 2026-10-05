import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdminLog} from './readAdminLog.mjs';
function client({missing=false,settings={phase:'regular',playoff_reminders_enabled:false}}={}){
 const calls=[];return {calls,from(table){let query={table};calls.push(query);const builder={};for(const key of ['select','like','not','is','order','limit','eq','in'])builder[key]=(...args)=>{query[key]=args;return builder;};
 builder.then=(resolve,reject)=>Promise.resolve(table==='push_notification_deliveries'&&missing?{error:{code:'PGRST205',message:'sensitive'}}:{data:[]}).then(resolve,reject);
 builder.single=async()=>({data:settings});return builder;}};
}
test('loader limits queries, separates scopes, reports missing migration without fabricating history',async()=>{
 const c=client({missing:true}),r=await readAdminLog(c,'playoffs','all');assert.deepEqual(r.rows,[]);assert.equal(r.telemetryAvailable,false);assert.equal(r.playoffRemindersEnabled,false);
 assert.ok(c.calls.filter(c=>c.table!=='settings').every(c=>c.limit[0]===50));assert.ok(c.calls.filter(c=>c.table==='push_notification_events').every(c=>c.like[1]==='playoff_%'));
});
test('disabled reminder banner requires BOTH environment flag and lifecycle permission',async()=>{
 for(const phase of ['regular','playoffs'])for(const enabled of [false,true])for(const flag of [false,true]){
  const r=await readAdminLog(client({settings:{phase,playoff_reminders_enabled:enabled}}),'playoffs','all',{remindersFlag:flag});assert.equal(r.playoffRemindersEnabled,phase==='playoffs'&&enabled&&flag);
 }
});
