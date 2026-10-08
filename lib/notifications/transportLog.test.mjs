import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observeDelivery} from './deliveryLog.mjs';
test('actual transport retains expired cleanup, counts, lifecycle guard and zero-subscriber behavior',async()=>{
 const src=(await readFile(new URL('../pushNotifications.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
 let subscriptions=[{id:'one',subscription:{endpoint:'ok'}},{id:'two',subscription:{endpoint:'expired'}}],open=true,member=true,sent=[],deleted=[],updates=[];
 const client={from(table){let values;return {select(){return this;},insert(row){values=row;return this;},single:async()=>({data:{id:'log'}}),update(row){updates.push(row);return this;},delete(){this.deleting=true;return this;},eq(k,v){if(this.deleting)deleted.push(v);return this;},maybeSingle:async()=>({data:member?{user_id:'u'}:null}),then(resolve){return Promise.resolve(table==='push_subscriptions'?{data:subscriptions}:{data:null}).then(resolve);}};}};
 const webpush={setVapidDetails(){},async sendNotification(sub){sent.push(sub.endpoint);if(sub.endpoint==='expired')throw Object.assign(new Error('synthetic'),{statusCode:410});}};
 const send=new Function('webpush','createClient','loadLifecycle','regularIsOpen','observeDelivery',src+';return sendRegularPushToUser;')(webpush,()=>client,async()=>({open,current_season:2027}),c=>c.open,observeDelivery);
 const options={season:2027,userId:'u',title:'T',body:'B',notificationLog:{type:'qb_turn'}};
 let result=await send(options);assert.equal(result.sent,1);assert.equal(result.total,2);assert.deepEqual(deleted,['two']);assert.equal(updates.at(-1).failed_count,1);
 open=false;sent=[];result=await send(options);assert.equal(result.sent,0);assert.equal(result.total,0);assert.equal(sent.length,0);assert.equal(updates.at(-1).attempted_count,0);
 open=true;sent=[];result=await send({...options,season:2026});assert.equal(result.sent,0);assert.equal(sent.length,0);
 member=false;result=await send(options);assert.equal(result.sent,0);assert.equal(sent.length,0);
 member=true;subscriptions=[];result=await send(options);assert.deepEqual(result,{success:true,sent:0,total:0,results:[]});
});
