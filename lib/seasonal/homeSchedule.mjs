// Optional decoration-only read: no publication, update, RPC, or fallback season.
// Its caller catches failures so seasonal decoration never blocks the home page.
export async function loadHomeSeasonalSchedule(client) {
  const { data: settings, error: settingsError } = await client
    .from('settings')
    .select('current_season,current_week,phase')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;
  if (!settings) throw new Error('Seasonal schedule settings unavailable.');

  const season = Number(settings.current_season);
  const activeWeek = Number(settings.current_week);
  if (settings.phase !== 'regular') return { games: [], activeWeek, season };
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(activeWeek) || activeWeek < 1) {
    throw new Error('Seasonal schedule context invalid.');
  }

  const { data: games, error: gamesError } = await client
    .from('games')
    .select('season,week,game_date,is_pool_eligible')
    .eq('season', season)
    .eq('week', activeWeek)
    .eq('is_pool_eligible', true);
  if (gamesError) throw gamesError;
  return { games: games || [], activeWeek, season };
}
