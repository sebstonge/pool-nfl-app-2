import { loadLifecycle } from '../lifecycle/context.mjs';

// Preview remains available in regular; only the season comes from settings.
export async function getPlayoffContext(client) {
  const context = await loadLifecycle(client);
  return { season: context.current_season, phase: context.phase };
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
