// No clock-derived season, MAX(season), or client-selected authority.
export function validateLifecycle(row) {
  if (!row || row.id !== 1 || !Number.isInteger(row.current_season) || row.current_season < 2000 || row.current_season > 9999 ||
      !Number.isInteger(row.current_week) || row.current_week < 1 || !['regular','playoffs','offseason'].includes(row.phase) ||
      !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      (row.regular_finalized_at !== null && !Number.isFinite(Date.parse(row.regular_finalized_at))) ||
      typeof row.playoff_reminders_enabled !== 'boolean') throw new Error('Contexte global absent ou invalide.');
  return Object.freeze({...row});
}
export async function loadLifecycle(client) {
  const {data,error} = await client.from('settings').select('id,current_season,current_week,phase,regular_finalized_at,revision,playoff_reminders_enabled,regular_writes_paused').eq('id',1).single();
  if (error) throw new Error('Contexte global indisponible.', {cause:error});
  return validateLifecycle(data);
}
export function regularIsOpen(context) {
  return context.phase === 'regular' && context.regular_finalized_at === null && context.regular_writes_paused !== true;
}
export async function requireActiveSeason(client, requested) {
  const context = await loadLifecycle(client);
  if (requested !== context.current_season) throw new Error('La saison demandée ne correspond pas au contexte global.');
  return context.current_season;
}
