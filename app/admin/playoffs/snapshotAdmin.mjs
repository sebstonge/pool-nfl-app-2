import { validateSeedRows } from '../../../lib/playoffs/seeds.mjs';
export function snapshotState(rows, season) {
  let valid = false;
  try { validateSeedRows(rows, season); valid = true; } catch {}
  const capturedAt = rows[0]?.captured_at;
  const uniformCapture = Boolean(capturedAt) && rows.every(row => row.captured_at === capturedAt);
  const locked = rows.some(row => row.finalized_at != null);
  const finalized = valid && uniformCapture && rows.every(row => row.finalized_at && row.finalized_at === rows[0].finalized_at);
  return { capturedAt, finalizedAt: finalized ? rows[0].finalized_at : null, locked, finalized,
    canFinalize: valid && uniformCapture && !locked,
    conferences: ['AFC','NFC'].map(name => ({ name, rows: rows.filter(row => row.conference === name).sort((a,b)=>a.seed-b.seed) })) };
}
export function confirmationRequest(action, season, state, confirmed) {
  if (!confirmed || state.locked) throw new Error('Confirmation requise ou snapshot déjà figé.');
  if (action === 'sync') return { action, season };
  if (action !== 'finalize' || !state.canFinalize) throw new Error('Snapshot incomplet ou incohérent.');
  return { action, season, expectedCapturedAt: state.capturedAt, regularSeasonComplete: true };
}
export async function requestSnapshot(client, body, fetcher = fetch) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Connecte-toi avec un compte administrateur.');
  const response = await fetcher('/api/admin/playoff-seeds', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`}, body:JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Impossible de charger le snapshot.');
  if (!Array.isArray(result.rows)) throw new Error('Réponse du serveur invalide.');
  return result.rows;
}
