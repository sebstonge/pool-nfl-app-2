const TIME_ZONE = 'America/Toronto';
const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function localDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(localDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// US Thanksgiving is the fourth Thursday in November, independently of NFL week numbers.
export function thanksgivingDay(year) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  const novemberFirst = new Date(0);
  novemberFirst.setUTCFullYear(year, 10, 1);
  return 1 + ((4 - novemberFirst.getUTCDay() + 7) % 7) + 21;
}

export function getSeasonalPreview(value, environment = 'production') {
  return environment === 'development' && (value === 'thanksgiving' || value === 'christmas')
    ? value
    : null;
}

function dateAccent(game) {
  if (game?.is_pool_eligible !== true) return null;
  const date = localDate(game.game_date);
  if (!date) return null;
  if (date.month === 11 && date.day === thanksgivingDay(date.year)) return 'thanksgiving';
  if (date.month === 12 && date.day === 24) return 'christmas-eve';
  if (date.month === 12 && date.day === 25) return 'christmas-day';
  return null;
}

// Callers supply the current regular schedule; viewedWeek prevents an archive from
// borrowing the active week's decorations. This never changes schedule or pick data.
export function getSeasonalTheme(games, {
  activeWeek,
  viewedWeek = activeWeek,
  season,
  preview,
  environment = 'production',
} = {}) {
  const forced = getSeasonalPreview(preview, environment);
  if (forced) return forced;
  if (activeWeek != null && viewedWeek != null && Number(viewedWeek) !== Number(activeWeek)) return null;
  const activeGames = (Array.isArray(games) ? games : []).filter(game =>
    game?.is_pool_eligible === true &&
    (activeWeek == null || Number(game.week) === Number(activeWeek)) &&
    (season == null || Number(game.season) === Number(season))
  );
  const accents = activeGames.map(dateAccent);
  if (accents.includes('thanksgiving')) return 'thanksgiving';
  if (accents.some(accent => accent === 'christmas-eve' || accent === 'christmas-day')) return 'christmas';
  return null;
}

export function getSeasonalGameAccent(game, theme, {
  preview,
  environment = 'production',
  previewIndex,
} = {}) {
  const forced = getSeasonalPreview(preview, environment);
  if (forced && forced === theme && Number.isInteger(previewIndex) && previewIndex >= 0) {
    // Dev-only visual samples on existing cards, without altering their real dates.
    const variant = previewIndex % 3;
    if (forced === 'thanksgiving') return variant === 0 ? 'thanksgiving' : null;
    return variant === 0 ? 'christmas-eve' : variant === 1 ? 'christmas-day' : null;
  }
  const accent = dateAccent(game);
  if (theme === 'thanksgiving') return accent === 'thanksgiving' ? accent : null;
  if (theme === 'christmas') return accent === 'christmas-eve' || accent === 'christmas-day' ? accent : null;
  return null;
}
