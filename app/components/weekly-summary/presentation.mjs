// Shared visual formatting only. Results, QB identity and rankings are resolved upstream.
export function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

export function ratingColor(rating) {
  const value = Number(rating);
  if (value >= 100) return "#22c55e";
  if (value >= 90) return "#f8fafc";
  if (value >= 70) return "#f97316";
  return "#ef4444";
}

export function officialResultText(game) {
  if (game.home_score == null || game.away_score == null) return null;
  if (Number(game.home_score) === Number(game.away_score)) return "Égalité";
  const winner = Number(game.home_score) > Number(game.away_score) ? game.home_team : game.away_team;
  const spread = Math.abs(Number(game.home_score) - Number(game.away_score));
  return `${winner} par ${spread}`;
}

export function teamLogoUrl(name, teams = []) {
  const key = name?.toLowerCase().trim();
  const exact = teams.find((row) => row.name?.toLowerCase().trim() === key);
  const matches = key ? teams.filter(row => row.name?.toLowerCase().includes(key)) : [];
  const team = exact || (matches.length === 1 ? matches[0] : null);
  return team?.espn_abbr
    ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
    : team?.logo || null;
}

export function pointsPresentation(points) {
  if (points === 0) return { label: "0 point", tone: "red" };
  if (points === 1) return { label: "1 point", tone: "yellow" };
  if (points === 2) return { label: "2 points", tone: "green" };
  return { label: "—", tone: "neutral" };
}
