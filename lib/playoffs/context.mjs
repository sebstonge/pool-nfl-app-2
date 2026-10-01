// Temporary configuration boundary; replace its source with seasons/phase later.
// NFL season, not the calendar year of the January/February playoff games.
export function getPlayoffContext() {
  return { season: 2026 };
}

export function validatePlayoffSeason(season) {
  if (!Number.isInteger(season) || season < 2000 || season > 9999) {
    throw new Error('Saison Playoffs invalide.');
  }
  return season;
}

export function assertPlayoffRounds(rounds, season) {
  validatePlayoffSeason(season);
  if (rounds.some(round => round.season !== season) ||
      new Set(rounds.map(round => round.id)).size !== rounds.length) {
    throw new Error('Les rondes ne correspondent pas à la saison Playoffs demandée.');
  }
  return rounds;
}
