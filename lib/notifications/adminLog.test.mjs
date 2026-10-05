import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {logRows,torontoDate} from './adminLog.mjs';
import {frenchTeam,finalRatingMessage} from './teamFrench.mjs';
import {observeDelivery} from './deliveryLog.mjs';
const date='2026-10-05T14:00:00Z',users=[{id:'u',display_name:'Joueur'}];
const delivery=(extra={})=>({id:'d',event_key:'key',user_id:'u',notification_type:'qb_final',created_at:date,attempted_at:date,completed_at:date,accepted_count:2,failed_count:0,attempted_count:2,...extra});
test('journal empty',()=>assert.deepEqual(logRows([],[],[],'regular'),[]));
test('acceptances count devices, recipient counted once; queue is not double-counted',()=>{
 const rows=logRows([{event_key:'key',user_id:'u',notification_type:'qb_final'}],[delivery()],users,'regular');assert.equal(rows.length,1);assert.equal(rows[0].recipientCount,1);assert.equal(rows[0].accepted,2);assert.equal(rows[0].state,'accepted');
});
test('failed, partial, interrupted, preparing and zero-attempt states are honest',()=>{
 for(const [extra,state] of [[{accepted_count:0,failed_count:2},'failed'],[{accepted_count:1,failed_count:1},'partial'],[{completed_at:null,accepted_count:null,failed_count:null},'unknown'],[{completed_at:null,attempted_at:null},'preparing'],[{accepted_count:0,failed_count:0,attempted_count:0},'not_sent'],[{accepted_count:null,failed_count:null,failure_reason:'internal secret'},'interrupted']]){
  const row=logRows([],[delivery(extra)],users,'regular')[0];assert.equal(row.state,state);if(['unknown','preparing','interrupted'].includes(state))assert.equal(row.accepted,null);
 }
});
test('legacy sent does not invent counts; pending is not success; ambiguous no_subscription is not zero failures',()=>{
 const rows=logRows(['sent','pending','no_subscription'].map((status,i)=>({event_key:String(i),notification_type:'qb_turn',user_id:'u',scheduled_for:date,status})),[],users,'regular');
 assert.deepEqual(rows.map(r=>r.state),['legacy_sent','queued','legacy_not_sent']);assert.ok(rows.every(r=>r.accepted===null&&r.failed===null));
});
test('scope, filters, ordering, bound and distinct retries',()=>{
 const ds=Array.from({length:60},(_,i)=>delivery({id:String(i),created_at:new Date(Date.parse(date)+i*1000).toISOString()}));
 assert.equal(logRows([],ds,users,'regular').length,50);assert.equal(logRows([],ds,users,'regular')[0].id,'delivery:59');assert.equal(logRows([],ds,users,'playoffs').length,0);
 assert.equal(logRows([],[delivery({accepted_count:1,failed_count:1})],users,'regular','failed').length,1);assert.equal(logRows([],[delivery()],users,'regular','failed').length,0);
 assert.equal(logRows([],[delivery({notification_type:'playoff_h24'})],users,'playoffs').length,1);
});
test('explicit API projection excludes secrets and raw provider diagnostics',()=>{
 const text=JSON.stringify(logRows([],[delivery({subscription:{endpoint:'SECRET_ENDPOINT',keys:{auth:'SECRET_AUTH'}},token:'SECRET_TOKEN',failure_reason:'SECRET_RAW_ERROR'})],[{...users[0],email:'SECRET_EMAIL'}],'regular'));
 assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('endpoint'));assert.ok(!text.includes('token'));
});
test('Toronto display uses summer/winter offset and handles missing dates',()=>{
 assert.match(torontoDate('2026-07-05T12:30:00Z'),/08.*30/);assert.match(torontoDate('2026-01-05T12:30:00Z'),/07.*30/);assert.equal(torontoDate(null),'Date indisponible');
});
test('French known short/full/abbreviation names, unknown singular and existing determiner',()=>{
 for(const [value,want] of [['Lions','les Lions'],['Detroit Lions','les Lions'],['DET','les Lions'],['49ers','les 49ers'],['WSH','les Commanders'],['Tampa Bay Buccaneers','les Buccaneers'],['les Bears','les Bears'],['le Rouge et Or','le Rouge et Or'],['Nouvelle équipe','l’équipe « Nouvelle équipe »'],['son adversaire','son adversaire'],['','son adversaire']])assert.equal(frenchTeam(value),want);
 assert.equal(finalRatingMessage('Bryce Young','Lions','110.7'),'Bryce Young a conclu son match contre les Lions avec un passer rating de 110.7.');
});
function telemetryClient(fail=false){const writes=[];return {writes,from(){return {insert(row){writes.push(row);return this;},select(){return this;},single:async()=>fail?{error:{message:'sensitive'}}:{data:{id:'d'}},update(row){writes.push(row);return this;},eq:async()=>({})};}};}
test('telemetry records actual attempt and partial transport result without subscriptions',async()=>{
 const c=telemetryClient(),result={sent:1,total:2,results:[{id:'secret-id',success:true},{id:'other',success:false,statusCode:410}]};
 assert.equal(await observeDelivery(c,{userId:'u',title:'T',body:'B',notificationLog:{type:'qb_final',eventKey:'k'}},async start=>{await start();return result;},{now:()=>date}),result);
 assert.equal(c.writes[1].attempted_at,date);assert.equal(c.writes[2].accepted_count,1);assert.equal(c.writes[2].failed_count,1);assert.ok(!JSON.stringify(c.writes).includes('secret-id'));
});
test('missing telemetry migration never blocks send; interrupted send rethrows original error with unknown counts',async()=>{
 const c=telemetryClient(true),result={sent:0,total:0,results:[]};assert.equal(await observeDelivery(c,{userId:'u',notificationLog:{type:'qb_turn'}},async()=>result),result);
 const good=telemetryClient(),error=new Error('SECRET_ENDPOINT');await assert.rejects(observeDelivery(good,{userId:'u',notificationLog:{type:'qb_turn'}},async start=>{await start();throw error;}),e=>e===error);
 assert.equal(good.writes.at(-1).accepted_count,undefined);assert.ok(!JSON.stringify(good.writes).includes('SECRET_ENDPOINT'));
});
test('real Admin route requires validated user and database admin; ignores client boolean',async()=>{
 const src=(await readFile(new URL('../../app/api/admin/notification-log/route.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export const','const').replace('export async function GET','async function GET');
 let admin=false,user=true,reads=0;
 const client={auth:{getUser:async()=>({data:{user:user?{id:'u'}:null}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_admin:admin}})};}};
 const handler=new Function('createClient','readAdminLog',src+';return GET;')(()=>client,async()=>{reads++;return {rows:[]};});
 const req=(token='Bearer test',q='scope=regular&is_admin=true')=>({headers:{get:()=>token},url:'https://local/api?'+q});
 assert.equal((await handler(req(null))).status,401);assert.equal((await handler(req())).status,403);assert.equal(reads,0);admin=true;user=false;assert.equal((await handler(req())).status,401);user=true;
 const r=await handler(req());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(reads,1);assert.equal((await handler(req('Bearer test','scope=evil'))).status,400);
});
