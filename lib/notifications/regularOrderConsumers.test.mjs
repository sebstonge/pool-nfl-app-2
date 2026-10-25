import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as regularClientModule from '../seasons/regularClient.mjs';
import * as lifecycle from '../lifecycle/context.mjs';
import * as selectionOrder from '../seasons/selectionOrder.mjs';
import * as rankingDelivery from './rankingDelivery.mjs';
import {regularCandidate} from './reminderRules.mjs';
import {reminderData} from './reminderWorker.mjs';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
const fixedNow='2026-10-22T15:00:00Z';
class FixedDate extends Date {
 constructor(...args){super(...(args.length?args:[fixedNow]));}
 static now(){return Date.parse(fixedNow);}
}
const players=[
 {id:'a',real_name:'Alice',display_name:'Alice',initial_order:2},
 {id:'b',real_name:'Benoît',display_name:'Benoît',initial_order:1},
 {id:'c',real_name:'Chloé',display_name:'Chloé',initial_order:3},
];
const score=(user_id,week,final_score,season=2026)=>({user_id,week,final_score,season});
const historicalPick=(user_id,week,minute)=>({user_id,week,created_at:`2026-09-22T13:${minute}:00Z`,season:2026});

function mockClient({week,weeklyScores=[],historyQbPicks=[],currentPicks=[],events=[],readErrorTable}){
 const queries=[],writes=[];
 const settings={id:1,current_week:week,current_season:2026,phase:'regular',revision:0,regular_finalized_at:null,playoff_reminders_enabled:false};
 const tables={settings:[settings],users:[...players.map(({initial_order,...p})=>p),{id:'admin',is_admin:true}],
  season_participants:players.map(p=>({season:2026,user_id:p.id,initial_order:p.initial_order,confirmed:true})),
  weekly_scores:weeklyScores,qb_picks:[...historyQbPicks,...currentPicks.map(p=>({...p,season:2026,week}))],
  qb_selection_weeks:[{season:2026,week,started_at:'2026-09-22T12:00:00Z'}],push_notification_events:events};
 const claimed=new Set();
 const client={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async(name,args)=>{
  assert.equal(name,'claim_regular_ranking');
  if(claimed.has(args.p_event_key))return {data:false};
  claimed.add(args.p_event_key);return {data:true};
 },from(table){
  const filters=[];let method='select',value,columns='*',single=false,range;
  const execute=()=>{
   queries.push({table,method,filters:[...filters],columns});
   if(method!=='select'){writes.push({table,method,value});return {data:single?{id:'event'}:null,error:null};}
   if(table===readErrorTable)return {data:null,error:new Error(`Unavailable ${table}`)};
   let data=[...(tables[table]||[])];
   for(const [kind,key,v] of filters)data=data.filter(row=>{
    if(kind==='eq'||kind==='is')return row[key]===v;
    if(kind==='lt')return Number(row[key])<Number(v);
    if(kind==='lte')return row[key]<=v;
    if(kind==='not-is')return row[key]!==v;
    if(kind==='not-in')return !v.replace(/^\(|\)$/g,'').split(',').includes(row[key]);
    return v.includes(row[key]);
   });
   if(range)data=data.slice(range[0],range[1]+1);
   return {data:single?(data[0]||null):data,error:null};
  };
  const q={select(v='*'){columns=v;return q;},eq(k,v){filters.push(['eq',k,v]);return q;},lt(k,v){filters.push(['lt',k,v]);return q;},in(k,v){filters.push(['in',k,v]);return q;},
   not(k,kind,v){filters.push([`not-${kind}`,k,v]);return q;},is(k,v){filters.push(['is',k,v]);return q;},lte(k,v){filters.push(['lte',k,v]);return q;},order(){return q;},
   range(a,b){range=[a,b];return q;},setHeader(){return q;},insert(v){method='insert';value=v;return q;},update(v){method='update';value=v;return q;},delete(){method='delete';return q;},
   single(){single=true;return q;},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
  return q;
 }};
 return {client,queries,writes};
}

async function route(name,fixture){
 const source=await readFile(new URL(`../../app/api/push/${name}/route.js`,import.meta.url),'utf8');
 const {code}=await swc.transform(source,{filename:'route.js',jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}});
 const {client,queries,writes}=mockClient(fixture),sends=[],orders=[],exports={};
 const imports=id=>{
  if(id==='@supabase/supabase-js')return {createClient:()=>client};
  if(id.endsWith('/regularClient.mjs'))return regularClientModule;
  if(id.endsWith('/context.mjs'))return lifecycle;
  if(id.endsWith('/rankingDelivery.mjs'))return rankingDelivery;
  if(id.endsWith('/selectionOrder.mjs'))return {...selectionOrder,loadRegularOrder:async(...args)=>{const order=await selectionOrder.loadRegularOrder(...args);orders.push(order.map(p=>p.id));return order;}};
  if(id.endsWith('/pushNotifications'))return {sendRegularPushToUser:async value=>{sends.push(value);return {sent:1,total:1};}};
  throw new Error(`Unexpected route dependency: ${id}`);
 };
 new Function('require','exports','Date','process',code)(imports,exports,FixedDate,{env:{CRON_SECRET:'local-test'}});
 const response=await exports[name==='scheduled'?'GET':'POST']({headers:{get:()=> 'Bearer local-test'}});
 return {response,body:await response.json(),sends,orders,queries,writes};
}

for(const [label,fixture,expected] of [
 ['first week initial order',{week:1},['b','a','c']],
 ['previous zero score and cumulative tie-break',{week:3,weeklyScores:[score('a',1,9),score('b',1,1),score('c',1,3),score('a',2,0),score('b',2,0),score('c',2,4)]},['b','a','c']],
 ['exact general tie preserves observed previous order',{week:4,weeklyScores:[score('a',1,5),score('b',1,1),score('c',1,4),score('a',2,0),score('b',2,4),score('c',2,1),score('a',3,0),score('b',3,0),score('c',3,0)],historyQbPicks:[historicalPick('c',3,'10'),historicalPick('b',3,'20'),historicalPick('a',3,'30')]},['c','b','a']],
 ['missing score stays after real zero',{week:2,weeklyScores:[score('b',1,0),score('c',1,2),score('a',1,-100,2025)]},['b','c','a']],
])test(`actual first/next routes share ${label}`,async()=>{
 const first=await route('first-player',fixture),next=await route('next-player',{...fixture,currentPicks:[{user_id:expected[0]}]});
 assert.equal(first.response.status,200,JSON.stringify(first.body));assert.equal(next.response.status,200,JSON.stringify(next.body));
 assert.deepEqual(first.orders,[expected]);assert.deepEqual(next.orders,[expected]);
 assert.equal(first.sends[0].userId,expected[0]);assert.equal(next.sends[0].userId,expected[1]);
 assert.equal(first.writes.find(w=>w.table==='push_notification_events').value.user_id,expected[0]);
 assert.equal(next.writes.find(w=>w.table==='push_notification_events').value.user_id,expected[1]);
 if(fixture.week===1)assert.equal(first.queries.some(q=>q.table==='weekly_scores'),false);
 else for(const result of [first,next])for(const table of ['weekly_scores','qb_picks'])assert.ok(result.queries.some(q=>q.table===table&&q.filters.some(f=>f[0]==='lt'&&f[1]==='week'&&f[2]===fixture.week)&&q.filters.some(f=>f[0]==='eq'&&f[1]==='season'&&f[2]===2026)));
});

test('reminder loader includes season-scoped score and QB history before current week',async()=>{
 const fixture={week:4,weeklyScores:[score('a',1,4),score('a',2,2),score('a',3,0),score('a',4,99),score('b',1,98,2025)],historyQbPicks:[historicalPick('a',2,'10'),historicalPick('b',3,'20')],currentPicks:[{user_id:'c',created_at:'2026-10-22T12:00:00Z'}]};
 const {client,queries}=mockClient(fixture),data=await reminderData(client);
 assert.deepEqual(data.regular.previousScores,fixture.weeklyScores.slice(0,3));
 assert.deepEqual(data.regular.historyQbPicks,fixture.historyQbPicks);
 assert.deepEqual(data.regular.qbPicks,[{user_id:'c',created_at:'2026-10-22T12:00:00Z',season:2026,week:4}]);
 assert.deepEqual(data.regular.players.map(p=>[p.id,p.initial_order]),players.map(p=>[p.id,p.initial_order]));
 for(const table of ['weekly_scores','qb_picks'])assert.ok(queries.some(q=>q.table===table&&q.filters.some(f=>f[0]==='lt'&&f[1]==='week'&&f[2]===4)));
});

test('regular reminder candidate uses cumulative and previous-order tie-breaks',()=>{
 const historyQbPicks=[historicalPick('c',3,'10'),historicalPick('b',3,'20'),historicalPick('a',3,'30')];
 const data={week:4,players,games:[{id:'g'}],picks:[],qbPicks:[],previousScores:[score('a',1,5),score('b',1,1),score('c',1,4),score('a',2,0),score('b',2,4),score('c',2,1),score('a',3,0),score('b',3,0),score('c',3,0)],historyQbPicks,startedAt:'2026-09-22T12:00:00Z'};
 assert.equal(regularCandidate(data).userId,'c');
 data.week=3;data.previousScores=[score('a',1,9),score('b',1,1),score('c',1,3),score('a',2,0),score('b',2,0),score('c',2,4)];
 assert.equal(regularCandidate(data).userId,'b');
});

const queuedEvent=(user_id,week=3,notification_type='qb_turn')=>({id:`${notification_type}-${user_id}-${week}`,event_key:`${notification_type}-week-${week}-${user_id}`,user_id,week,notification_type,season:2026,status:'pending',sent_at:null,scheduled_for:'2026-10-22T14:00:00Z'});
const scheduledScores=[score('a',1,9),score('b',1,1),score('c',1,3),score('a',2,0),score('b',2,0),score('c',2,4)];
for(const [label,currentPicks,event,reason] of [
 ['obsolete recipient',[],queuedEvent('a'),'stale_qb_turn'],
 ['already submitted recipient',[{user_id:'b'}],queuedEvent('b'),'stale_qb_turn'],
 ['obsolete week',[],queuedEvent('b',2),'stale_week'],
])test(`actual scheduled route skips QB turn for ${label} without writes`,async()=>{
 const result=await route('scheduled',{week:3,weeklyScores:scheduledScores,currentPicks,events:[event]});
 assert.equal(result.response.status,200);assert.equal(result.body.sent,0);assert.equal(result.body.failed,0);
 assert.deepEqual(result.sends,[]);assert.deepEqual(result.writes,[]);
 assert.deepEqual(result.body.results,[{id:event.id,eventKey:event.event_key,type:'qb_turn',status:'skipped',reason}]);
});

test('actual scheduled route sends only the canonical remaining player',async()=>{
 const event=queuedEvent('a'),result=await route('scheduled',{week:3,weeklyScores:scheduledScores,currentPicks:[{user_id:'b'}],events:[event]});
 assert.equal(result.response.status,200);assert.equal(result.body.sent,1);assert.equal(result.body.failed,0);
 assert.deepEqual(result.orders,[['b','a','c']]);assert.equal(result.sends[0].userId,'a');
 assert.deepEqual(result.writes,[{table:'push_notification_events',method:'update',value:{status:'sent',sent_at:fixedNow.replace('Z','.000Z')}}]);
});

test('actual scheduled route reports order read errors through its existing failure path',async()=>{
 const event=queuedEvent('b'),result=await route('scheduled',{week:3,weeklyScores:scheduledScores,events:[event],readErrorTable:'weekly_scores'});
 assert.equal(result.response.status,200);assert.equal(result.body.failed,1);assert.equal(result.body.results[0].status,'failed');
 assert.equal(result.body.results[0].error,'Unavailable weekly_scores');assert.deepEqual(result.sends,[]);assert.deepEqual(result.writes,[]);
});

test('actual scheduled route leaves other event types outside QB turn validation',async()=>{
 const event=queuedEvent('a',2,'rankings_updated'),result=await route('scheduled',{week:3,weeklyScores:scheduledScores,events:[event]});
 assert.equal(result.response.status,200);assert.equal(result.body.sent,1);assert.equal(result.body.failed,0);
 assert.deepEqual(result.orders,[]);assert.equal(result.sends[0].userId,'a');
 assert.equal(result.sends[0].title,'🏆 Classements mis à jour');
});
