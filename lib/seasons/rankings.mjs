// Preserve the regular rankings page's stable ordering and ordinal ranks.
// Callers choose the season and included weeks before passing scores here.
export function rankWeeklyScores(scores, week) {
  const weekScores = (scores || [])
    .filter((score) => Number(score.week) === Number(week))
    .sort((a, b) => Number(b.final_score || 0) - Number(a.final_score || 0));
  const leader = Number(weekScores[0]?.final_score || 0);
  return weekScores.map((score, index) => {
    const value = Number(score.final_score || 0);
    return { userId: score.user_id, rank: index + 1, score: value, diff: leader - value };
  });
}

export function rankSeasonScores(scores) {
  const grouped = {};
  for (const score of scores || []) {
    if (!grouped[score.user_id]) {
      grouped[score.user_id] = { userId: score.user_id, total: 0, weeks: 0 };
    }
    grouped[score.user_id].total += Number(score.final_score || 0);
    grouped[score.user_id].weeks += 1;
  }
  return Object.values(grouped).sort((a, b) => b.total - a.total);
}
