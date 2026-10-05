import test from 'node:test';
import assert from 'node:assert/strict';
import {regularDue,morning,regularCandidate,plannedReminders,reminderEligible,firstKickoff} from './reminderRules.mjs';
import {processReminders} from './reminderWorker.mjs';
import {regularOrder} from './regularOrder.mjs';
const iso=n=>new Date(n).toISOString();
function fixture(){return {regular:{week:2,startedAt:'2026-09-21T12:00:00Z',players:[{id:'a',real_name:'A'},{id:'b',real_name:'B'}],games:[{id:1,game_date:'2026-09-27T17:00:00Z',home_team:'A',away_team:'B'}],qbPicks:[{user_id:'a',created_at:'2026-09-22T16:00:00Z'}],picks:[{user_id:'a',game_id:1,picked_team:'A',predicted_spread:7,updated_at:'2026-09-22T16:00:00Z'}],previousScores:[{user_id:'a',final_score:1},{user_id:'b',final_score:2}]},rounds:[{id:1,status:'open',round_key:'wild_card',reminder_opened_at:'2026-09-21T12:00:00Z'}],playoffGames:[{id:10,round_id:1,external_game_id:'123',game_date:'2026-09-27T17:00:00Z',home_team:'X',away_team:'Y',game_status:'pre'}],playoffQB:[],paths:[],playoffPicks:[]};}
const at=isoString=>Date.parse(isoString);
for(const [start,due] of [['12:00','21:00'],['16:00','01:00'],['18:00','12:30'],['21:00','12:30'],['04:00','13:00']])test(`regular activation ${start} Toronto -> expected +5h/quiet hours`,()=>{
 const input=`2026-09-22T${start}:00-04:00`,next=['18:00','21:00','16:00'].includes(start)?'23':'22';
 assert.equal(iso(regularDue(input)),`2026-09-${next}T${due}:00.000Z`);
});
test('22:00 included, 08:30 excluded; DST uses actual Toronto offset',()=>{
 assert.equal(iso(regularDue('2026-09-22T17:00:00-04:00')),'2026-09-23T12:30:00.000Z');
 assert.equal(iso(regularDue('2026-09-22T03:30:00-04:00')),'2026-09-22T12:30:00.000Z');
 assert.equal(iso(regularDue('2026-10-31T21:00:00-04:00')),'2026-11-01T13:30:00.000Z');
 assert.equal(iso(regularDue('2026-03-07T21:00:00-05:00')),'2026-03-08T12:30:00.000Z');
});
test('regular clock is previous complete submission, not poll or notification time',()=>{
 const d=fixture(),before=structuredClone(d.regular);
 assert.deepEqual(regularCandidate(d.regular),{userId:'b',activatedAt:'2026-09-22T16:00:00.000Z'});
 assert.equal(plannedReminders(d)[0].scheduled_for,'2026-09-22T21:00:00.000Z');assert.deepEqual(d.regular,before);
 d.regular.picks=[];assert.equal(regularCandidate(d.regular),null);
});
test('submitted/current-player/week changes suppress regular reminder',()=>{
 const d=fixture(),event=plannedReminders(d)[0],now=at('2026-09-22T21:00:00Z');
 assert.equal(reminderEligible(event,d,now-1),false);assert.equal(reminderEligible(event,d,now),true);
 d.regular.qbPicks.push({user_id:'b'});assert.equal(reminderEligible(event,d,now),false);
 d.regular.qbPicks.pop();d.regular.week=3;assert.equal(reminderEligible(event,d,now),false);
});
test('first player deadline uses existing week opening timestamp; order never mutates',()=>{
 const d=fixture();d.regular.qbPicks=[];d.regular.picks=[];
 assert.equal(regularCandidate(d.regular).activatedAt,iso(d.regular.startedAt));
 const before=structuredClone(d.regular);regularOrder(d.regular.players,2,d.regular.previousScores);assert.deepEqual(d.regular,before);
});
for(const date of ['2026-09-27T13:00:00-04:00','2026-09-26T16:30:00-04:00','2026-09-28T20:00:00-04:00'])test(`08:30 local on kickoff day ${date}`,()=>assert.equal(iso(morning(at(date))),`${date.slice(0,10)}T12:30:00.000Z`));
test('round opening event targets all; H24 and morning target only incomplete submissions',()=>{
 const d=fixture(),h24=plannedReminders(d).find(e=>e.notification_type==='playoff_h24'&&e.user_id==='b'),morningEvent=plannedReminders(d).find(e=>e.notification_type==='playoff_morning'&&e.user_id==='b');
 assert.equal(reminderEligible(h24,d,at('2026-09-26T17:00:00Z')),true);
 assert.equal(reminderEligible(morningEvent,d,at('2026-09-27T12:30:00Z')),true);
 d.playoffQB.push({round_id:1,user_id:'b'});d.paths.push({round_id:1,user_id:'b'});d.playoffPicks.push({user_id:'b',game_id:10,picked_team:'X',predicted_spread:7});
 assert.equal(reminderEligible(h24,d,at('2026-09-26T17:00:00Z')),false);
 assert.equal(reminderEligible(morningEvent,d,at('2026-09-27T12:30:00Z')),false);
 assert.equal(reminderEligible({...h24,notification_type:'playoff_open'},d,at('2026-09-26T17:00:00Z')),true);
});
test('whole round earliest official kickoff; TEST IDs excluded, no ESPN dependency',()=>{
 const d=fixture();d.playoffGames.push({...d.playoffGames[0],id:11,external_game_id:'124',game_date:'2026-09-28T23:00:00Z'},{...d.playoffGames[0],id:12,external_game_id:'TEST-1',game_date:'2026-09-22T13:00:00Z'});
 assert.equal(firstKickoff(d.playoffGames),at('2026-09-27T17:00:00Z'));
 assert.equal(plannedReminders(d).find(e=>e.notification_type==='playoff_morning').scheduled_for,'2026-09-27T12:30:00.000Z');
});
test('closed round, started kickoff and already-attempted event are ineligible',()=>{
 const d=fixture(),e=plannedReminders(d).find(e=>e.notification_type==='playoff_h24'),now=at('2026-09-26T17:00:00Z');
 assert.equal(reminderEligible({...e,reminder_attempted_at:'done'},d,now),false);
 assert.equal(reminderEligible(e,d,at('2026-09-27T17:00:00Z')),false);
 d.rounds[0].status='locked';assert.equal(reminderEligible(e,d,now),false);
});
test('rescheduled kickoff is rechecked; no retrospective reminder when opening missed its deadline',()=>{
 const d=fixture(),e=plannedReminders(d).find(e=>e.notification_type==='playoff_h24');d.playoffGames[0].game_date='2026-09-28T17:00:00Z';
 assert.equal(reminderEligible(e,d,at('2026-09-26T17:00:00Z')),false);
 d.rounds[0].reminder_opened_at='2026-09-28T14:00:00Z';assert.equal(plannedReminders(d).filter(e=>e.notification_type.startsWith('playoff_')).length,0);
});
test('worker rechecks, claims once across concurrent jobs, and never retries ambiguous delivery',async()=>{
 const d=fixture(),event=plannedReminders(d)[0];let claimed=false,sends=0,reads=0;
 const client={rpc:async name=>name==='queue_pool_reminder'?{error:null}:{data:claimed?false:(claimed=true)},from(){const q={select(){return q;},in(){return q;},eq(){return q;},is(){return q;},lte(){return q;},order(){return q;},range(){return Promise.resolve({data:[event]});},update(){return {eq:async()=>({error:null})};}};return q;}};
 const options={context:async()=>({phase:'regular',regular_finalized_at:null,playoff_reminders_enabled:false}),now:()=>at('2026-09-22T21:00:00Z'),load:async()=>{reads++;return d;}};
 const send=async()=>{sends++;throw new Error('ambiguous network failure');};
 await Promise.all([processReminders(client,send,options),processReminders(client,send,options)]);
 await processReminders(client,send,options);assert.equal(sends,1);assert.ok(reads>=6);
 claimed=false;sends=0;let n=0;
 await processReminders(client,send,{...options,load:async()=>{n++;return n===1?d:{...d,regular:{...d.regular,qbPicks:[...d.regular.qbPicks,{user_id:'b'}]}};}});assert.equal(sends,0);
});

test('worker never queues or sends disabled/closed reminders',async()=>{
 const d=fixture();let writes=0,sends=0;
 const client={rpc:async()=>{writes++;return {data:true};},from(){const q={select(){return q;},in(){return q;},eq(){return q;},is(){return q;},lte(){return q;},order(){return q;},range:async()=>({data:plannedReminders(d)})};return q;}};
 await processReminders(client,async()=>{sends++;},{load:async()=>d,context:async()=>({phase:'offseason',regular_finalized_at:'closed',playoff_reminders_enabled:false})});
 assert.equal(writes,0);assert.equal(sends,0);
});
