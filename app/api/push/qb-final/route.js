import { createClient } from '@supabase/supabase-js';
import { loadLifecycle, regularIsOpen } from '../../../../lib/lifecycle/context.mjs';
import { deliverQbFinalEvents } from '../../../../lib/notifications/qbFinalDelivery.mjs';
import { sendRegularPushToUser } from '../../../../lib/pushNotifications';
import { syncScheduledRegularWeek } from '../../../../lib/regular-admin/operations.mjs';
import { regularClient } from '../../../../lib/seasons/regularClient.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const rawAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let context;
  try {
    context = await loadLifecycle(rawAdmin);
  } catch (error) {
    console.error('[QB final] Contexte indisponible', error.code);
    return Response.json({ error: 'Contexte indisponible' }, { status: 500 });
  }
  if (!regularIsOpen(context)) return Response.json({ skipped: 'regular_closed' });

  const automatic = process.env.REGULAR_AUTO_RESULTS_ENABLED === 'true';
  const season = context.current_season;
  const response = { success: true, season, week: context.current_week, automatic };

  try {
    response.sync = await syncScheduledRegularWeek(rawAdmin, { automatic }, sendRegularPushToUser);
    if (response.sync.notifications) {
      const { results, ...counts } = response.sync.notifications;
      response.sync.notifications = counts;
    }
    if (response.sync.notifications?.failed) response.success = false;
  } catch (error) {
    if (error.code === '40001') {
      response.sync = { skipped: 'stale_context' };
    } else {
      console.error('[QB final] Synchronisation impossible', error.code);
      response.success = false;
      response.sync = { error: 'Synchronisation impossible' };
    }
  }

  // An interrupted ESPN check must not strand notifications from a previous
  // successful commit. The queue remains scoped to the active season.
  try {
    response.qbNotifications = await deliverQbFinalEvents(
      regularClient(rawAdmin, { season }), sendRegularPushToUser, { season },
    );
    if (response.qbNotifications.failed || response.qbNotifications.unconfirmed) response.success = false;
  } catch (error) {
    console.error('[QB final] File de notifications indisponible', error.code);
    response.success = false;
    response.qbNotifications = { error: 'File de notifications indisponible' };
  }

  return Response.json(response, { status: response.success ? 200 : 500 });
}
