import { loadLifecycle, regularIsOpen } from '../lifecycle/context.mjs';
import {plannedReminders,reminderEligible,reminderMessage,REMINDER_TYPES} from './reminderRules.mjs';
async function rows(client,table,filter=q=>q){
 const output=[];
 for(let offset=0;;offset+=1000){const {data,error}=await filter(client.from(table).select('*')).range(offset,offset+999);if(error)throw error;output.push(...data);if(data.length<1000)return output;}
}
export async function reminderData(client){
 const settings=await rows(client,'settings'),week=Number(settings[0]?.current_week);
 const [players,games,qbPicks,previousScores,starts,rounds]=await Promise.all([
  rows(client,'users'),rows(client,'games',q=>q.eq('week',week).eq('is_pool_eligible',true)),rows(client,'qb_picks',q=>q.eq('week',week)),
  rows(client,'weekly_scores',q=>q.eq('week',week-1)),rows(client,'qb_selection_weeks',q=>q.eq('week',week)),rows(client,'playoff_rounds'),
 ]);
 const roundIds=rounds.map(r=>r.id);
 const [picks,playoffGames,playoffQB,paths]=await Promise.all([
  games.length?rows(client,'picks',q=>q.in('game_id',games.map(g=>g.id))):[],
  roundIds.length?rows(client,'playoff_games',q=>q.in('round_id',roundIds)):[],
  roundIds.length?rows(client,'playoff_qb_picks',q=>q.in('round_id',roundIds)):[],
  roundIds.length?rows(client,'playoff_team_paths',q=>q.in('round_id',roundIds)):[],
 ]);
 const playoffPicks=playoffGames.length?await rows(client,'playoff_picks',q=>q.in('game_id',playoffGames.map(g=>g.id))):[];
 return {regular:{week,players,games,picks,qbPicks,previousScores,startedAt:starts[0]?.started_at},rounds,playoffGames,playoffQB,paths,playoffPicks};
}
export async function processReminders(client,send,{now=()=>Date.now(),load=reminderData,context=loadLifecycle}={}){
 const allowed=async event=>{const c=await context(client);return event.notification_type.startsWith('playoff_')?c.phase==='playoffs'&&c.playoff_reminders_enabled:regularIsOpen(c);};
 const data=await load(client);
 for(const event of plannedReminders(data)){
  if(!await allowed(event))continue;
  const {error}=await client.rpc('queue_pool_reminder',{p_event:event});if(error)throw error;
 }
 const events=await rows(client,'push_notification_events',q=>q.in('notification_type',REMINDER_TYPES).eq('status','pending').is('sent_at',null).is('reminder_attempted_at',null).is('reminder_cancelled_at',null).lte('scheduled_for',new Date(now()).toISOString()).order('scheduled_for'));
 const outcomes=[];
 for(const event of events){
  // Re-read immediately before claiming; queued eligibility is never authoritative.
  const fresh=await load(client),time=now();
  if(!await allowed(event)||!reminderEligible(event,fresh,time))continue;
  const {data:claimed,error}=await client.rpc('claim_pool_reminder',{p_event_key:event.event_key});
  if(error)throw error;if(!claimed)continue;
  // Permanent claim BEFORE external transport: at most one push attempt. Never
  // automatically retry an ambiguous network result (provider has no idempotency API).
  try {
   if(!await allowed(event))continue;
   const result=await send({userId:event.user_id,...reminderMessage(event)});
   const {error:saveError}=await client.from('push_notification_events').update({status:result.sent>0?'sent':'no_subscription',sent_at:result.sent>0?new Date(now()).toISOString():null}).eq('event_key',event.event_key);
   if(saveError)throw saveError;
   outcomes.push({key:event.event_key,sent:result.sent});
  }catch(error){outcomes.push({key:event.event_key,attempted:true,error:error.message});}
 }
 return outcomes;
}
