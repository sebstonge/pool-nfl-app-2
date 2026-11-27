import { createClient } from '@supabase/supabase-js';
import { findEspnQbs, isEspnAthleteId, qbNameKey, qbTeamCode } from '../../../../lib/qb-observation/espnRoster.mjs';

export const runtime = 'nodejs';
export const maxDuration = 15;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STATE = /^[0-9a-f]{64}$/;
const SELECTIONS = new Set(['current', 'suggested', 'other']);
const validName = value => typeof value === 'string' && value.trim().length <= 120 && Boolean(qbNameKey(value));
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ error: 'Connexion requise.' }, 401);

  try {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      ...options,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: session, error: sessionError } = await auth.auth.getUser(token);
    if (sessionError || !session?.user?.id) return json({ error: 'Session invalide.' }, 401);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
    const profile = await service.from('users').select('is_admin').eq('id', session.user.id).maybeSingle();
    if (profile.error) throw profile.error;
    if (profile.data?.is_admin !== true) return json({ error: 'Accès administrateur requis.' }, 403);

    const body = await request.json().catch(() => null);
    const team = qbTeamCode(body?.team);
    if (!/^[A-Z]{2,3}$/.test(team)) return json({ error: 'Équipe requise.' }, 400);
    const lookup = body.operation === 'lookup';
    const needsEspn = lookup || body.selection !== 'current';
    if (!lookup && (body.operation !== 'confirm' || body.confirmed !== true || !SELECTIONS.has(body.selection) ||
        !UUID.test(body.entryId ?? '') || !UUID.test(body.runId ?? '') || !STATE.test(body.expectedState ?? ''))) {
      return json({ error: 'Confirmation et fiche QB valides requises.' }, 400);
    }
    if (needsEspn && (!validName(body.name) || (!lookup && !isEspnAthleteId(body.athleteId)))) {
      return json({ error: lookup ? 'Saisis le nom complet du QB.' : 'Choisis une identité ESPN vérifiée.' }, 400);
    }

    const { data: menu, error: menuError } = await auth.rpc('read_regular_qb_menu_admin', {}, { get: true });
    if (menuError || !Array.isArray(menu?.teams)) throw new Error('Contexte du menu QB indisponible');
    if (menu.manualOpen !== true) return json({ error: 'Confirmation indisponible pour cette semaine.' }, 423);
    const slots = menu.teams.filter(slot => qbTeamCode(slot.abbr) === team);
    if (slots.length !== 1 || !UUID.test(slots[0].qbId ?? '')) {
      return json({ error: 'Aucun titulaire unique n’est configuré pour cette équipe.' }, 409);
    }
    if (!lookup && slots[0].reviewState !== body.expectedState) {
      return json({ code: 'stale', error: 'La fiche a changé. Actualise-la avant de confirmer.' }, 409);
    }
    const matches = needsEspn ? await findEspnQbs(team, body.name, fetch) : [];
    if (lookup) return json({ matches: matches.map(qb => ({ ...qb, eligible: true })) });

    const selected = matches.find(qb => qb.id === body.athleteId);
    if (needsEspn && !selected) {
      return json({ error: 'Identité ESPN introuvable pour cette équipe. Relance la recherche.' }, 409);
    }

    const { data, error } = await service.rpc('manage_regular_qb_recommendation', {
      p_actor_id: session.user.id,
      p_selection: body.selection,
      p_entry_id: body.entryId,
      p_run_id: body.runId,
      p_expected_state: body.expectedState,
      p_team: team,
      p_confirmed: true,
      p_athlete_id: selected?.id ?? null,
      p_athlete_name: selected?.name ?? null,
    });
    if (error?.code === '40001') return json({ code: 'stale', error: 'La fiche a changé. Actualise-la avant de confirmer.' }, 409);
    if (error?.code === '42501') return json({ error: 'Confirmation indisponible pour ce compte ou cette semaine.' }, 403);
    if (error?.code === '23514') {
      const knownReasons = [
        'Cet identifiant ESPN est lié à une autre fiche QB du catalogue.',
        'Une sélection historique de cette fiche QB n’a pas d’identité complète.',
        'Cette fiche QB est utilisée par l’historique des séries.',
      ];
      return json({ error: knownReasons.includes(error.message) ? error.message
        : 'Le titulaire ou le catalogue a changé. Vérifie la fiche actualisée.' }, 409);
    }
    if (error) throw error;
    return json(data);
  } catch {
    return json({ error: 'Vérification du QB indisponible. Réessaie.' }, 502);
  }
}
