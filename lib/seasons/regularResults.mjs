export const REGULAR_TIE_NOTE = "Match nul NFL : les choix des deux équipes valent 1 point de base.";

const pending = () => ({status: 'pending', winner: null, spread: null});
const validScore = value => ['number', 'string'].includes(typeof value) &&
  String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;

// Scores alone never establish that a game ended. Legacy rows stay pending
// until an Admin update or verified provider evidence confirms the final.
export function regularGameResult(game) {
  const final = game?.result_status === 'final' ||
    (game?.state === 'post' && (game.completed === true || game.final_status === 'STATUS_FINAL'));
  if (!final || !validScore(game?.home_score) || !validScore(game?.away_score) ||
      typeof game.home_team !== 'string' || !game.home_team ||
      typeof game.away_team !== 'string' || !game.away_team || game.home_team === game.away_team) return pending();
  const home = Number(game.home_score), away = Number(game.away_score);
  if (home === away) return {status: 'tie', winner: null, spread: 0};
  return {status: 'winner', winner: home > away ? game.home_team : game.away_team, spread: Math.abs(home - away)};
}

export function regularPickResult(game, pick) {
  const result = regularGameResult(game);
  const validPick = pick && [game?.home_team, game?.away_team].includes(pick.picked_team) &&
    typeof pick.picked_team === 'string' && pick.picked_team.length > 0;
  if (result.status === 'pending' || !validPick) return {...result, points: null, correct: false, exact: false};
  // A tie has no winner and no exact-margin bonus, including legacy spread 0.
  if (result.status === 'tie') return {...result, points: 1, correct: false, exact: false};
  const correct = pick.picked_team === result.winner;
  const exact = correct && validScore(pick.predicted_spread) && Number(pick.predicted_spread) === result.spread;
  return {...result, points: correct ? (exact ? 2 : 1) : 0, correct, exact};
}
