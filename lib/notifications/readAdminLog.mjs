import {logRows} from './adminLog.mjs';
const EVENT_COLUMNS='event_key,user_id,notification_type,scheduled_for,sent_at,status,reminder_attempted_at,reminder_cancelled_at';
export async function readAdminLog(client,scope,filter,{remindersFlag=false}={}){
 const scoped=q=>scope==='playoffs'?q.like('notification_type','playoff_%'):q.not('notification_type','like','playoff_%');
 const [sent,queued,deliveries,settings]=await Promise.all([
  scoped(client.from('push_notification_events').select(EVENT_COLUMNS)).not('sent_at','is',null).order('sent_at',{ascending:false}).limit(50),
  scoped(client.from('push_notification_events').select(EVENT_COLUMNS)).is('sent_at',null).order('scheduled_for',{ascending:false,nullsFirst:false}).limit(50),
  client.from('push_notification_deliveries').select('id,event_key,user_id,notification_type,created_at,attempted_at,completed_at,accepted_at,attempted_count,accepted_count,failed_count,title,body,failure_reason').eq('scope',scope).order('created_at',{ascending:false}).limit(50),
  client.from('settings').select('phase,playoff_reminders_enabled').eq('id',1).single(),
 ]);
 for(const result of [sent,queued,settings])if(result.error)throw result.error;
 // Missing telemetry migration must be visible, without breaking old notifications.
 if(deliveries.error&&!['42P01','PGRST205'].includes(deliveries.error.code))throw deliveries.error;
 const events=[...(sent.data||[]),...(queued.data||[])],attempts=deliveries.data||[];
 const ids=[...new Set([...events,...attempts].map(r=>r.user_id).filter(Boolean))];
 let users=[];if(ids.length){const result=await client.from('users').select('id,display_name,real_name').in('id',ids);if(result.error)throw result.error;users=result.data||[];}
 return {rows:logRows(events,attempts,users,scope,filter),telemetryAvailable:!deliveries.error,
  playoffRemindersEnabled:remindersFlag&&settings.data?.phase==='playoffs'&&settings.data?.playoff_reminders_enabled===true};
}
