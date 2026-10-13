// Same attribution rules as the season standings; no QB-rating thresholds.
export function rankBadges(weeklyRankings, userId, activeWeek, movement, previousRank, currentRank) {
  const weeks = Object.keys(weeklyRankings).map(Number).filter(w => w <= activeWeek).sort((a,b) => b-a).slice(0,3);
  const ranks = weeks.map(w => weeklyRankings[w]?.find(r => r.userId === userId)?.rank || 999);
  const badges = [];
  const details = {};
  const history = weeks.map((w,i) => `Semaine ${w} : ${ranks[i] === 999 ? "absent du classement" : `rang ${ranks[i]}`}`).reverse();
  if (ranks.length === 3 && ranks.every(r => r <= 3)) {
    badges.push("🔥 En feu");
    details["🔥 En feu"] = ["Top 3 dans les trois derniers classements hebdomadaires disponibles.", ...history];
  }
  if (ranks.length === 3 && ranks.every(r => r > 3)) {
    badges.push("🧊 Glacé");
    details["🧊 Glacé"] = ["Hors du top 3 dans les trois derniers classements hebdomadaires disponibles.", ...history];
  }
  if (movement <= -3) {
    badges.push("📉 Chute libre");
    details["📉 Chute libre"] = [`Recul de ${-movement} places au classement cumulatif.`, `Avant la semaine ${activeWeek} : rang ${previousRank}`, `Classement actuel : rang ${currentRank}`];
  }
  return {badges, badgeDetails: details};
}
