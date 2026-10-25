// Ranking events are reserved in PostgreSQL before any external side effect.
// An attempted event is never reclaimed: provider acceptance can be ambiguous.
export function rankingDeliveryTime(now = new Date()) {
  const opening = new Date(now);
  // Preserve the existing scheduled-ranking delivery window.
  opening.setUTCHours(12, 30, 0, 0);
  return now < opening ? opening.toISOString() : now.toISOString();
}

export async function deliverRankingEvent(client, event, send, {payload = event.ranking_payload, now = () => new Date()} = {}) {
  if (!payload || !payload.title || !payload.body || payload.url !== '/classements') throw Error('Contenu du classement indisponible.');
  const claim = await client.rpc('claim_regular_ranking', {p_event_key: event.event_key});
  if (claim.error) throw claim.error; // Fail closed; telemetry is not the reservation.
  const result = {id:event.id,eventKey:event.event_key,type:'rankings_updated',sent:0,failed:0,noSubscription:0};
  if (claim.data !== true) return {...result,status:'skipped'};
  try {
    const delivered = await send({season:event.season,userId:event.user_id,
      notificationLog:{eventKey:event.event_key,type:'rankings_updated'},
      title:payload.title,body:payload.body,url:payload.url});
    result.sent = Number(delivered.sent) || 0;
    result.failed = (delivered.results || []).filter(r => r.success === false).length;
    result.noSubscription = result.sent === 0 && result.failed === 0 ? 1 : 0;
    result.status = result.sent > 0 ? 'sent' : result.failed ? 'failed' : 'no_subscription';
  } catch (error) {
    result.status = 'failed'; result.failed = 1;
    result.error = error?.message || 'Envoi non confirmé.';
  }
  const saved = await client.from('push_notification_events').update({status:result.status,
    ...(result.sent > 0 ? {sent_at:now().toISOString()} : {})}).eq('id',event.id);
  if (saved.error) {
    // Reservation remains committed even if the completion log cannot be saved.
    result.failed = Math.max(1,result.failed);
    result.error = 'État final de notification non confirmé; aucun renvoi automatique.';
  }
  return result;
}

export async function deliverRankingEvents(client, send, {season,week,now = () => new Date()} = {}) {
  const {data:events,error} = await client.from('push_notification_events')
    .select('id,event_key,user_id,season,week,ranking_payload,ranking_attempted_at,scheduled_for,status,sent_at')
    .eq('notification_type','rankings_updated').eq('season',season).eq('week',week)
    .eq('status','pending').is('sent_at',null).is('ranking_attempted_at',null)
    .not('ranking_payload','is',null).order('scheduled_for',{ascending:true});
  if (error) throw error;
  const report = {sent:0,failed:0,scheduled:0,noSubscription:0,results:[]};
  for (const event of events || []) {
    if (Date.parse(event.scheduled_for) > now().getTime()) {report.scheduled++;continue;}
    try {
      const result = await deliverRankingEvent(client,event,send,{now});
      report.sent += result.sent; report.failed += result.failed; report.noSubscription += result.noSubscription;
      report.results.push(result);
    } catch (error) {
      report.failed++;
      report.results.push({id:event.id,status:'failed',error:error?.message || 'Réservation impossible.'});
    }
  }
  return report;
}
