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

function deliverQbNotifications(season) {
  return deliverQbFinalEvents(
    regularClient(rawAdmin, { season }), sendRegularPushToUser, { season },
  );
}

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
    response.qbNotifications = await deliverQbNotifications(season);
    if (response.qbNotifications.failed || response.qbNotifications.unconfirmed) response.success = false;
  } catch (error) {
    console.error('[QB final] File de notifications indisponible', error.code);
    response.success = false;
    response.qbNotifications = { error: 'File de notifications indisponible' };
  }

  return Response.json(response, { status: response.success ? 200 : 500 });
}

const gameIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return Response.json({ error: 'Non autorisé' }, { status: 401 });
  if (process.env.REGULAR_AUTO_RESULTS_ENABLED !== 'true') return Response.json({ retryGameIds: [] });

  const body = await request.json().catch(() => null);
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.gameIds) ||
      body.gameIds.length < 1 || body.gameIds.length > 16 ||
      body.gameIds.some(id => typeof id !== 'string' || !gameIdPattern.test(id))) {
    return Response.json({ error: 'Identifiants de matchs invalides' }, { status: 400 });
  }
  const gameIds = [...new Set(body.gameIds.map(id => id.toLowerCase()))];

  try {
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.getUser(token);
    const user = data?.user;
    if (error || !user) return Response.json({ error: 'Session invalide' }, { status: 401 });

    const context = await loadLifecycle(rawAdmin);
    if (!regularIsOpen(context)) return Response.json({ retryGameIds: [] });
    const { data: participant, error: participantError } = await rawAdmin.from('season_participants')
      .select('user_id').eq('season', context.current_season).eq('user_id', user.id).eq('confirmed', true).maybeSingle();
    if (participantError) throw participantError;
    if (!participant) return Response.json({ error: 'Participant confirmé requis' }, { status: 403 });

    const report = await syncScheduledRegularWeek(
      rawAdmin, { automatic: true }, sendRegularPushToUser, { context, gameIds },
    );
    if (report.hasVerifiedGame) {
      const notifications = await deliverQbNotifications(context.current_season);
      if (report.notifications?.failed || notifications.failed || notifications.unconfirmed) {
        return Response.json({ error: 'Distribution des notifications non confirmée' }, { status: 503 });
      }
    }
    return Response.json({ retryGameIds: report.retryGameIds ?? [] });
  } catch (error) {
    if (error.code === '40001') return Response.json({ retryGameIds: gameIds });
    console.error('[Live final] Publication indisponible', error.code);
    return Response.json({ error: 'Publication indisponible' }, { status: 503 });
  }
}
