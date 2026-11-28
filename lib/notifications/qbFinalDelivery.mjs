import { finalRatingMessage } from './teamFrench.mjs';

const pendingQbFinal = (query, season) => query.eq('season', season)
  .eq('notification_type', 'qb_final').eq('status', 'pending')
  .is('sent_at', null).is('qb_final_attempted_at', null).not('qb_final_payload', 'is', null);

export async function deliverQbFinalEvents(client, send, { season, now = () => new Date() }) {
  const events = await pendingQbFinal(client.from('push_notification_events')
    .select('id,event_key,user_id,qb_final_payload'), season).order('id');
  if (events.error) throw events.error;
  const result = { sent: 0, failed: 0, noSubscription: 0, skipped: 0, unconfirmed: 0 };

  for (const event of events.data ?? []) {
    const { actualQbName, opponent, passerRating } = event.qb_final_payload;
    if (typeof actualQbName !== 'string' || !actualQbName.trim() ||
        typeof opponent !== 'string' || !opponent.trim() ||
        !Number.isFinite(passerRating) || passerRating < 0 || passerRating > 158.3) {
      result.failed++;
      continue;
    }

    // The conditional update is the durable claim. A lost response, process
    // crash or unknown provider outcome must not permit a retry after it.
    const claimedAt = now().toISOString();
    const claim = await pendingQbFinal(client.from('push_notification_events')
      .update({ qb_final_attempted_at: claimedAt }).eq('id', event.id), season)
      .select('id').maybeSingle();
    if (claim.error) {
      result.failed++;
      continue;
    }
    if (!claim.data) {
      result.skipped++;
      continue;
    }

    let status = 'failed';
    try {
      const delivery = await send({
        season,
        userId: event.user_id,
        notificationLog: { eventKey: event.event_key, type: 'qb_final' },
        title: '🏈 Passer Rating final',
        body: finalRatingMessage(actualQbName, opponent, passerRating.toFixed(1)),
        url: '/',
      });
      if (delivery.sent > 0) {
        status = 'sent';
        result.sent += Number(delivery.sent);
      } else if (!delivery.results?.some(device => device.success === false)) {
        status = 'no_subscription';
        result.noSubscription++;
      }
    } catch {
      // The downstream provider may still have accepted the notification.
    }
    if (status === 'failed') result.failed++;

    const saved = await client.from('push_notification_events')
      .update({ status, ...(status === 'sent' ? { sent_at: now().toISOString() } : {}) })
      .eq('id', event.id).eq('season', season).eq('qb_final_attempted_at', claimedAt)
      .select('id').maybeSingle();
    if (saved.error || !saved.data) result.unconfirmed++;
  }
  return result;
}
