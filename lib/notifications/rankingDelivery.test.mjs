import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverRankingEvent,deliverRankingEvents,rankingDeliveryTime} from './rankingDelivery.mjs';

const now=()=>new Date('2026-10-25T16:00:00Z');
const event=()=>({id:'event',event_key:'regular-rankings-2026-week-7-v1-user-a',season:2026,week:7,user_id:'a',
 notification_type:'rankings_updated',status:'pending',sent_at:null,ranking_attempted_at:null,scheduled_for:'2026-10-25T15:00:00Z',
 ranking_payload:{title:'🏆 Classements mis à jour',body:'Version publiée : 3e avec 2.200 pts.',url:'/classements',rank:3,score:2.2,version:1}});
function fixture(events=[event()]){
 const h={events,sends:[],claims:[],failClaim:false,failCompletion:false,failRead:false,throwSend:false,delivered:{sent:1,total:1,results:[{success:true}]}};
 h.client={rpc:async(name,args)=>{
  assert.equal(name,'claim_regular_ranking');h.claims.push(args);
  if(h.failClaim)return {error:Error('reservation offline')};
  const e=events.find(e=>e.event_key===args.p_event_key);
  if(!e||e.ranking_attempted_at||e.status!=='pending')return {data:false};
  e.ranking_attempted_at=now().toISOString();return {data:true};
 },from(table){assert.equal(table,'push_notification_events');const filters=[];let changes;
  const q={select(){return q;},eq(k,v){filters.push(e=>e[k]===v);return q;},is(k,v){filters.push(e=>e[k]===v);return q;},
   not(k,_op,v){filters.push(e=>e[k]!==v);return q;},order(){return q;},update(v){changes=v;return q;},
   then(resolve,reject){return Promise.resolve().then(()=>{
    if(changes&&h.failCompletion)return {error:Error('completion offline')};
    if(!changes&&h.failRead)return {error:Error('read offline')};
    const rows=events.filter(e=>filters.every(f=>f(e)));
    if(changes){for(const e of rows)Object.assign(e,changes);return {error:null};}
    return {data:structuredClone(rows),error:null};
   }).then(resolve,reject);}};return q;
 }};
 h.send=async payload=>{h.sends.push(payload);if(h.throwSend)throw Error('provider outcome unknown');return h.delivered;};
 return h;
}
test('immediate delivery uses immutable payload and durable business identity',async()=>{
 const h=fixture(),report=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 assert.equal(report.sent,1);assert.equal(report.failed,0);assert.equal(h.sends[0].body,event().ranking_payload.body);
 assert.equal(h.sends[0].notificationLog.eventKey,event().event_key);assert.equal(h.sends[0].season,2026);
 assert.equal(h.events[0].status,'sent');assert.equal(h.events[0].sent_at,now().toISOString());
});
test('identical API reruns cannot send an attempted ranking again',async()=>{
 const h=fixture();await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(h.sends.length,1);
});
test('two workers competing for one reservation produce one transport attempt',async()=>{
 const h=fixture(),e=structuredClone(h.events[0]);
 const results=await Promise.all([deliverRankingEvent(h.client,e,h.send,{now}),deliverRankingEvent(h.client,e,h.send,{now})]);
 assert.equal(h.sends.length,1);assert.equal(results.filter(r=>r.status==='skipped').length,1);
});
test('a persisted event survives an interrupted publisher request and is recovered by next call',async()=>{
 const h=fixture(); // Commit exists; the original browser never reached delivery.
 assert.equal(h.sends.length,0);
 assert.equal((await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now})).sent,1);
});
test('claim failure is closed and never falls back to transport or telemetry',async()=>{
 const h=fixture();h.failClaim=true;
 assert.equal((await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now})).failed,1);
 assert.deepEqual(h.sends,[]);assert.equal(h.events[0].ranking_attempted_at,null);
});
test('uncertain external failure remains attempted and cannot be retried',async()=>{
 const h=fixture();h.throwSend=true;
 assert.equal((await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now})).failed,1);
 await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(h.sends.length,1);
 assert.equal(h.events[0].status,'failed');
});
test('acceptance followed by completion write failure cannot cause a duplicate',async()=>{
 const h=fixture();h.failCompletion=true;
 const first=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 assert.equal(first.sent,1);assert.equal(first.failed,1);
 await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(h.sends.length,1);
});
test('deferred ranking keeps its snapshot and is not claimed early',async()=>{
 const e=event();e.scheduled_for='2026-10-26T12:30:00Z';const h=fixture([e]);
 const r=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 assert.equal(r.scheduled,1);assert.deepEqual(h.claims,[]);assert.deepEqual(h.sends,[]);
 assert.equal(rankingDeliveryTime(new Date('2026-10-25T10:00:00Z')),'2026-10-25T12:30:00.000Z');
 assert.equal(rankingDeliveryTime(now()),now().toISOString());
});
test('device-level partial acceptance is reported without retrying accepted devices',async()=>{
 const h=fixture();h.delivered={sent:1,total:2,results:[{success:true},{success:false}]};
 const r=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 assert.equal(r.sent,1);assert.equal(r.failed,1);assert.equal(h.events[0].status,'sent');
 await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(h.sends.length,1);
});
test('no subscription is informative, not a fabricated provider failure',async()=>{
 const h=fixture();h.delivered={sent:0,total:0,results:[]};
 const r=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});
 assert.equal(r.noSubscription,1);assert.equal(r.failed,0);assert.equal(h.events[0].status,'no_subscription');
});
test('delivery reads only the requested season/week and no legacy or other notification',async()=>{
 const h=fixture([event(),{...event(),id:'other-season',season:2027},{...event(),id:'other-week',week:8},
  {...event(),id:'turn',notification_type:'qb_turn'},{...event(),id:'legacy',ranking_payload:null}]);
 await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(h.sends.length,1);
});
test('invalid frozen payload is never sent',async()=>{
 const e=event();e.ranking_payload.url='/admin';const h=fixture([e]);
 const r=await deliverRankingEvents(h.client,h.send,{season:2026,week:7,now});assert.equal(r.failed,1);assert.deepEqual(h.sends,[]);
});
