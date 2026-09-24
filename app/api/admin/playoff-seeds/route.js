import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncPlayoffSeedsFromEspn, finalizePlayoffSeeds, readPlayoffSeeds } from '../../../../lib/playoffs/seedOperations.mjs';

// Same authorization convention as /api/admin/reset-password. No privileged
// client or secret is imported by the public playoff components.
export async function POST(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const { data: { user }, error } = await auth.auth.getUser(token);
    if (error || !user) return NextResponse.json({ error: 'Session invalide' }, { status: 401 });
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
    const { data: profile, error: profileError } = await admin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.is_admin !== true) return NextResponse.json({ error: 'Accès administrateur requis' }, { status: 403 });
    const { action, season, expectedCapturedAt, regularSeasonComplete } = await request.json();
    if (!Number.isInteger(season) || season < 2000 || season > 9999 || !['read', 'sync', 'finalize'].includes(action)) {
      return NextResponse.json({ error: 'Action ou saison invalide' }, { status: 400 });
    }
    if (action === 'sync') await syncPlayoffSeedsFromEspn(admin, season);
    if (action === 'finalize') await finalizePlayoffSeeds(admin, season, expectedCapturedAt, regularSeasonComplete);
    return NextResponse.json({ rows: await readPlayoffSeeds(admin, season) });
  } catch (error) {
    console.error('[Playoff seeds admin]', error.message);
    return NextResponse.json({ error: 'Opération refusée ou source indisponible. Consulte les journaux administrateur.' }, { status: 409 });
  }
}
