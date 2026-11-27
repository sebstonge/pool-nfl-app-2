export function manualQbDecision(recommendation, menu, now = Date.now()) {
  if (menu?.manualOpen !== true || recommendation.changedSinceObservation ||
      !recommendation.entryId || !recommendation.runId || recommendation.reservation == null ||
      recommendation.season !== menu.season || recommendation.week !== menu.week ||
      !(now < Date.parse(menu.firstKickoffAt) && now < Date.parse(recommendation.expiresAt))) return null;
  const team = menu.teams?.find(item => item.abbr === recommendation.team);
  if (!team?.qbName || typeof team.reviewState !== 'string' || !/^[a-f0-9]{64}$/.test(team.reviewState)) return null;

  return {
    entryId: recommendation.entryId,
    runId: recommendation.runId,
    expectedState: team.reviewState,
    team: team.abbr,
  };
}
