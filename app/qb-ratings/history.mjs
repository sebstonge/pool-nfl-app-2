import { ratingForPick, regularQbResult } from '../../lib/seasons/qbSnapshot.mjs';

const athleteId = value => value == null ? '' : String(value).trim();
const ratingValue = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;
const weekNumber = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Display only: NFL ratings belong to the athlete, while credited ratings belong
// to a selection and may describe a different QB after an official replacement.
export function buildQbWeeklyHistory({ qb, season, picks = [], ratings = [], weeklyStats = [], users = [] }) {
  const year = Number(season);
  if (!Number.isInteger(year)) return [];

  const targetId = athleteId(qb?.espn_athlete_id);
  const seasonRatings = ratings.filter(row => Number(row.season) === year);
  const usersById = new Map(users.map(user => [user.id, user]));
  const weeks = new Map();
  const seenPicks = new Set();
  const getWeek = week => {
    if (!weeks.has(week)) weeks.set(week, { season: year, week, nflRating: null, participants: [] });
    return weeks.get(week);
  };

  if (targetId) {
    for (const stat of weeklyStats) {
      const week = weekNumber(stat.week);
      const value = ratingValue(stat.passer_rating);
      // The legacy in-memory stats fixtures are already season-scoped by the
      // caller. Explicitly different seasons are always excluded.
      if (stat.season != null && Number(stat.season) !== year) continue;
      if (week == null || athleteId(stat.espn_athlete_id) !== targetId || value === null) continue;
      getWeek(week).nflRating = value;
    }
  }

  for (const pick of picks) {
    const week = weekNumber(pick.week);
    if (Number(pick.season) !== year || week == null) continue;
    const rating = ratingForPick(pick, seasonRatings);
    const result = regularQbResult(pick, rating);
    const pertinent = targetId
      ? athleteId(result.selected?.espn_athlete_id) === targetId || athleteId(result.actual?.espn_athlete_id) === targetId
      : rating && qb?.id === `actual-unknown-${rating.qb_id}-${rating.week}`;
    if (!pertinent) continue;

    const pickKey = pick.id ?? `${year}-${week}-${pick.qb_id}-${pick.user_id}`;
    if (seenPicks.has(pickKey)) continue;
    seenPicks.add(pickKey);
    const user = usersById.get(pick.user_id);
    getWeek(week).participants.push({
      pickId: pick.id ?? null,
      userId: pick.user_id,
      displayName: user?.display_name || user?.email?.split('@')[0] || '—',
      realName: user?.real_name || '',
      selected: result.selected,
      actual: result.actual,
      replaced: result.replaced,
      replacementKnown: result.replacementKnown,
      creditedRating: result.rating,
    });
  }

  return [...weeks.values()].sort((a, b) => a.week - b.week);
}
