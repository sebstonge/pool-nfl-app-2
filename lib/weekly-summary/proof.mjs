import {
  PublicationError, ensure, collection, json, finalEvent, finalSummary,
  sameIds, mapBounded,
} from '../regular-publication/espn.mjs';
import {calculateFinalScores} from '../regular-publication/prepare.mjs';
import {validateLifecycle, regularIsOpen} from '../lifecycle/context.mjs';
import {selectionSnapshot} from '../seasons/qbSnapshot.mjs';
import {selectRegularPasser} from '../playoffs/qbResults.mjs';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const eventPattern = /^\/v2\/sports\/football\/leagues\/nfl\/events\/(\d+)$/;
const numericId = value => /^\d+$/.test(String(value ?? ''));
const number = value => {
  ensure(['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)), 'Valeur officielle absente ou invalide.');
  return Number(value);
};
const key = row => `${row.user_id}:${row.week}`;

// This proves an existing result. It never publishes or repairs pool sources.
export async function verifyCompletedHistory(state, {fetcher = fetch} = {}) {
  try {
    return await verify(state, fetcher);
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError(error?.message || 'Vérification finale indisponible.');
  }
}

async function verify(state, fetcher) {
  const context = validateLifecycle(state?.settings);
  const season = context.current_season, week = context.current_week - 1;
  ensure(regularIsOpen(context) && week >= 1, 'Aucune semaine régulière précédente à certifier.');
  for (const field of ['games', 'picks', 'qb_picks', 'qb_ratings', 'weekly_scores', 'teams', 'users']) {
    ensure(Array.isArray(state[field]), 'Sources historiques incomplètes.');
  }
  const historical = row => Number.isInteger(row.week) && row.week >= 1 && row.week <= week;
  ensure(state.games.every(g => g.season === season && g.season_type === 'regular' && Number.isInteger(g.week) && g.week >= 1), 'Match local de mauvaise saison/type/semaine.');
  const localById = new Map(state.games.map(g => [g.id, g]));
  ensure(localById.size === state.games.length, 'Match local dupliqué.');
  ensure(state.picks.every(p => localById.has(p.game_id)), 'Choix sans match local.');
  const picks = state.picks.filter(p => {
    const game = localById.get(p.game_id);
    return historical(game) && game.is_pool_eligible === true;
  });
  ensure(picks.length > 0, 'Aucun choix admissible à certifier.');
  const members = new Set(state.users);
  ensure(new Set(picks.map(p => p.id)).size === picks.length && picks.every(p => typeof p.id === 'string' && p.id && members.has(p.user_id)), 'Identité de choix/participant absente ou dupliquée.');
  ensure(new Set(picks.map(p => `${p.user_id}:${p.game_id}`)).size === picks.length, 'Choix de match dupliqué.');

  // A matching partial score is insufficient: every observed participation must
  // cover that week's complete eligible slate, one QB choice and one score.
  const participation = new Map();
  const participate = (userId, value) => {
    if (!participation.has(value)) participation.set(value, new Set());
    participation.get(value).add(userId);
  };
  for (const pick of picks) participate(pick.user_id, localById.get(pick.game_id).week);
  for (const row of [...state.qb_picks, ...state.weekly_scores]) {
    if (row.season === season && historical(row)) participate(row.user_id, row.week);
  }
  for (const [value, participants] of participation) {
    const eligible = state.games.filter(g => g.week === value && g.is_pool_eligible === true);
    for (const userId of participants) {
      ensure(state.qb_picks.filter(q => q.user_id === userId && q.week === value && q.season === season).length === 1, 'Choix QB historique absent ou ambigu.');
      ensure(eligible.length > 0 && eligible.every(g => picks.filter(p => p.user_id === userId && p.game_id === g.id).length === 1), 'Participation hebdomadaire incomplète : choix de match admissible absent.');
      ensure(state.weekly_scores.filter(s => s.user_id === userId && s.week === value && s.season === season).length === 1, 'Score hebdomadaire de participation absent ou ambigu.');
    }
  }

  const choices = [], needed = new Map();
  const requiredGames = new Map(state.games.filter(g => historical(g) && g.is_pool_eligible === true).map(g => [g.id, g]));
  for (const pick of picks) {
    const game = localById.get(pick.game_id);
    const matches = state.qb_picks.filter(q => q.user_id === pick.user_id && q.week === game.week && q.season === season);
    ensure(matches.length === 1, 'Choix QB historique absent ou ambigu.');
    const choice = matches[0], selected = selectionSnapshot(choice);
    ensure(selected && numericId(selected.espn_athlete_id), 'Instantané de sélection QB historique incomplet.');
    if (!choices.includes(choice)) choices.push(choice);
    const ratingKey = `${choice.qb_id}:${choice.week}`, previous = needed.get(ratingKey);
    ensure(!previous || (previous.selected.name === selected.name && previous.selected.espn_athlete_id === selected.espn_athlete_id && previous.selected.team === selected.team), 'Instantanés de sélection QB contradictoires.');
    if (previous) continue;
    const team = selected.team.toLowerCase();
    const qbGames = state.games.filter(g => g.week === choice.week && [g.home_team, g.away_team].some(t => typeof t === 'string' && t.toLowerCase().includes(team)));
    ensure(qbGames.length === 1, 'Match historique du QB absent ou ambigu.');
    const qbGame = qbGames[0];
    requiredGames.set(qbGame.id, qbGame);
    needed.set(ratingKey, {choice, selected, gameId: qbGame.id});
  }
  // A TEST identifier must never reach a provider request, including as a QB game.
  for (const game of requiredGames.values()) {
    ensure(numericId(game.external_game_id), 'Match TEST ou identifiant ESPN non numérique.');
    if (game.is_pool_eligible === true) {
      ensure([game.home_score, game.away_score].every(s => Number.isInteger(s) && s >= 0), 'Scores locaux finaux absents.');
    }
  }
  ensure(new Set([...requiredGames.values()].map(g => String(g.external_game_id))).size === requiredGames.size, 'Identifiant ESPN local dupliqué.');

  const root = `/seasons/${season}/types/2`;
  const weekPattern = new RegExp(`^/v2/sports/football/leagues/nfl/seasons/${season}/types/2/weeks/(\\d+)$`);
  const indexedWeeks = await collection(`${root}/weeks`, weekPattern, fetcher);
  ensure(week <= indexedWeeks.length, 'Historique hebdomadaire ESPN incomplet.');
  const weeks = Array.from({length: week}, (_, i) => i + 1);
  ensure(weeks.every(w => indexedWeeks.includes(String(w))), 'Historique hebdomadaire ESPN incomplet.');
  const calendar = await mapBounded(weeks, async value => {
    const expected = await collection(`${root}/weeks/${value}/events`, eventPattern, fetcher);
    const board = await json(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${value}&limit=${expected.length + 1}`, fetcher);
    ensure(board.season?.year === season && board.season?.type === 2 && board.week?.number === value && Array.isArray(board.events), 'Scoreboard historique de mauvaise saison/semaine.');
    ensure(sameIds(board.events.map(e => String(e.id)), expected), 'Scoreboard hebdomadaire partiel ou dupliqué.');
    return {week: value, expected, games: board.events.map(e => finalEvent(e, season, value, state.teams))};
  });
  const events = calendar.flatMap(row => row.games);
  ensure(new Set(events.map(g => g.external_game_id)).size === events.length, 'Événement ESPN présent dans plusieurs semaines.');
  const eventById = new Map(events.map(g => [g.external_game_id, g]));
  const games = [...requiredGames.values()].map(local => {
    const event = eventById.get(String(local.external_game_id));
    ensure(event && event.week === local.week && event.home_team === local.home_team && event.away_team === local.away_team, 'Match local incompatible avec le calendrier final.');
    // The admin persists scores only for pool games. An ineligible QB game
    // contributes its FINAL provider evidence and rating, not local pool points.
    if (local.is_pool_eligible === true) {
      ensure(event.home_score === local.home_score && event.away_score === local.away_score, 'Scores locaux différents des scores ESPN finaux.');
    }
    return {...event, id: local.id};
  });
  const gamesById = new Map(games.map(g => [g.id, g])), summaries = new Map();
  const ratings = await mapBounded([...needed.values()], async ({choice, selected, gameId}) => {
    const game = gamesById.get(gameId), team = selected.team.toLowerCase();
    const sides = ['home', 'away'].filter(side => game[`${side}_team`].toLowerCase().includes(team));
    ensure(sides.length === 1, 'Équipe historique du QB ambiguë.');
    const side = sides[0];
    if (!summaries.has(game.id)) summaries.set(game.id, finalSummary(game, fetcher));
    const summary = await summaries.get(game.id);
    const boxes = summary.boxscore?.players?.filter(b => String(b.team?.id) === game[`${side}_espn_id`]);
    ensure(boxes?.length === 1, 'Boxscore QB final absent ou ambigu.');
    const category = boxes[0].statistics?.find(c => c.name === 'passing' || c.displayName === 'Passing');
    const index = (category?.labels || []).findIndex(label => ['RTG', 'RAT', 'RATE'].includes(String(label).toUpperCase()));
    ensure(index >= 0 && category?.athletes?.length, 'Rating QB final absent.');
    const passers = category.athletes.map(row => {
      const rating = number(row.stats?.[index]);
      ensure(rating >= 0 && rating <= 158.3 && numericId(row.athlete?.id) && row.athlete?.displayName, 'Rating QB final incomplet.');
      return {id: String(row.athlete.id), name: row.athlete.displayName, rating};
    });
    const {actual} = selectRegularPasser(selected, passers);
    const stored = state.qb_ratings.filter(r => r.qb_id === choice.qb_id && r.week === choice.week && r.season === season);
    ensure(stored.length === 1 && number(stored[0].passer_rating) === actual.rating && stored[0].actual_qb_name === actual.name && String(stored[0].actual_espn_athlete_id) === actual.id, 'Rating ou identité QB stocké différent du résultat final.');
    return {qb_id: choice.qb_id, week: choice.week, passer_rating: actual.rating};
  });
  const source = {...state, picks, qb_picks: choices};
  const calculated = calculateFinalScores(source, ratings, games);
  const storedScores = state.weekly_scores.filter(historical);
  ensure(storedScores.every(s => s.season === season) && new Set(storedScores.map(key)).size === storedScores.length && storedScores.length === calculated.length, 'Scores hebdomadaires historiques incomplets ou ambigus.');
  const scoresByKey = new Map(storedScores.map(s => [key(s), s]));
  for (const result of calculated) {
    const stored = scoresByKey.get(key(result));
    ensure(stored && ['base_points', 'multiplier', 'final_score'].every(field => number(stored[field]) === result[field]), 'Score hebdomadaire différent du calcul canonique final.');
  }
  // Re-read provider indexes after summaries so a changed calendar cannot pass.
  ensure(sameIds(await collection(`${root}/weeks`, weekPattern, fetcher), indexedWeeks), 'Index des semaines modifié pendant la vérification.');
  await mapBounded(calendar, async row => {
    ensure(sameIds(await collection(`${root}/weeks/${row.week}/events`, eventPattern, fetcher), row.expected), 'Calendrier hebdomadaire modifié pendant la vérification.');
  });
  const pointsByPick = Object.fromEntries(picks.map(pick => [
    pick.id, calculateFinalScores({...source, picks: [pick]}, ratings, games)[0].base_points,
  ]));
  return {pointsByPick, verifiedGames: games};
}
