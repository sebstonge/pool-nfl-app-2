import { fetchEspnStandings } from '../espnStandings.mjs';
import { selectRegularPasser } from '../playoffs/qbResults.mjs';
import { json, mapBounded } from '../regular-publication/espn.mjs';
import { selectionSnapshot } from '../seasons/qbSnapshot.mjs';
import { regularGameResult } from '../seasons/regularResults.mjs';
import { isFinalEspnCompetition } from './liveFinalSignal.mjs';

const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const athleteIdPattern = /^\d{1,18}$/;
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ');
const abbreviation = value => normalize(value).replace(/^wsh$/, 'was').replace(/^la$/, 'lar');

function nflTeamMatches(team, name) {
  return Boolean(normalize(name)) && (normalize(team.name) === normalize(name) ||
    normalize(team.name).split(' ').at(-1) === normalize(name) ||
    Boolean(team.espn_abbr) && abbreviation(team.espn_abbr) === abbreviation(name));
}

function requiredNumber(value, check) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && check(number) ? number : null;
}

const ratingNumber = value => requiredNumber(value, number => number >= 0 && number <= 158.3);
const scoreNumber = value => requiredNumber(value, number => Number.isInteger(number) && number >= 0 && number <= 2147483647);
const validIdentity = row => athleteIdPattern.test(row.id) && Boolean(row.name?.trim());
const storedFinal = game => game.result_status === 'final' && regularGameResult(game).status !== 'pending';
const storedRating = rating => ratingNumber(rating.passer_rating) !== null &&
  validIdentity({ id: rating.actual_espn_athlete_id, name: rating.actual_qb_name });

// Keep the Admin update's three FINAL signals, including its overtime variants.
function competitionState(competition) {
  const type = competition?.status?.type;
  if (type?.state === 'pre' || type?.state === 'in') return 'pending';
  return isFinalEspnCompetition(competition) ? 'final' : 'unconfirmed';
}

function verifiedGame(game, summary, teams) {
  const header = summary?.header;
  const competitions = header?.competitions;
  if (String(header?.id) !== String(game.external_game_id) ||
      header?.season?.year !== game.season || header?.season?.type !== 2 ||
      (header.week?.number != null && header.week.number !== game.week) ||
      !Array.isArray(competitions) || competitions.length !== 1) {
    throw Error('Identité du match ESPN incohérente.');
  }
  const competition = competitions[0];
  const state = competitionState(competition);
  if (state === 'pending') return null;
  if (state !== 'final') throw Error('Statut FINAL ESPN non confirmé.');
  if (competition.competitors?.length !== 2) throw Error('Équipes du match ESPN incomplètes.');
  const sides = {};
  for (const side of ['home', 'away']) {
    const opponents = competition.competitors.filter(row => row.homeAway === side);
    const local = teams.filter(team => normalize(team.name) === normalize(game[`${side}_team`]));
    const row = opponents[0];
    if (opponents.length !== 1 || local.length !== 1 || !local[0].espn_abbr ||
        abbreviation(local[0].espn_abbr) !== abbreviation(row.team?.abbreviation) ||
        !athleteIdPattern.test(String(row.team?.id ?? ''))) {
      throw Error('Équipe ou orientation ESPN incompatible avec le match.');
    }
    const score = scoreNumber(row.score);
    if (score === null) throw Error('Score final ESPN indisponible ou invalide.');
    sides[side] = { id: String(row.team.id), team: local[0].name, score };
  }
  if (sides.home.id === sides.away.id || sides.home.team === sides.away.team) throw Error('Équipes du match dupliquées.');
  return { sides, patch: { id: game.id, external_game_id: String(game.external_game_id),
    home_score: sides.home.score, away_score: sides.away.score, result_status: 'final' } };
}

function passingRows(summary, espnTeamId) {
  const teams = summary.boxscore?.players?.filter(row => String(row.team?.id) === espnTeamId) ?? [];
  const category = teams.length === 1 && teams[0].statistics?.find(row => row.name === 'passing' || row.displayName === 'Passing');
  const index = category ? (category.labels ?? []).findIndex(label => ['RTG', 'RAT', 'RATE'].includes(String(label).toUpperCase())) : -1;
  if (index < 0 || !Array.isArray(category.athletes) || !category.athletes.length) throw Error('Statistiques de passes ESPN indisponibles.');
  return category.athletes.map(row => ({
    id: String(row.athlete?.id ?? ''), name: row.athlete?.displayName, rating: ratingNumber(row.stats?.[index]),
  }));
}

function chosenRating(pick, summary, verified, game) {
  const rows = passingRows(summary, verified.sides[pick.side].id);
  const selectedRows = rows.filter(row => row.id === pick.selected.espn_athlete_id);
  if (selectedRows.length > 1 || selectedRows.some(row => row.rating === null || !validIdentity(row))) {
    throw Error('Rating final du QB sélectionné indisponible ou ambigu.');
  }
  const rated = rows.filter(row => row.rating !== null);
  const { actual } = selectRegularPasser(pick.selected, rated);
  if (!validIdentity(actual)) throw Error('Identité ESPN du QB réel incomplète.');
  return { qb_id: pick.selected.id, game_id: game.id, passer_rating: actual.rating,
    actual_qb_name: actual.name, actual_espn_athlete_id: actual.id };
}

export function selectedQbGames(selected, games, teams) {
  const local = selected && teams.filter(team => nflTeamMatches(team, selected.team));
  if (local?.length !== 1) return [];
  const teamName = normalize(local[0].name);
  return games.flatMap(game => ['home', 'away'].filter(side => normalize(game[`${side}_team`]) === teamName)
    .map(side => ({ game, side })));
}

function pickedGames(state, games, teams, warn) {
  const byGame = new Map();
  for (const pick of state.qb_picks) {
    const selected = selectionSnapshot(pick);
    const matches = selectedQbGames(selected, games, teams);
    if (matches.length !== 1 || !athleteIdPattern.test(selected?.espn_athlete_id ?? '')) {
      warn(`${selected?.name ?? 'Choix QB'} : identité ou match du QB absent ou ambigu.`);
      continue;
    }
    const { game, side } = matches[0];
    const picks = byGame.get(game.id) ?? [];
    picks.push({ selected, side });
    byGame.set(game.id, picks);
  }
  return byGame;
}

function weeklyStats(summary, verified, week, warn) {
  const rows = [];
  for (const team of Object.values(verified.sides)) {
    try {
      for (const player of passingRows(summary, team.id)) {
        if (player.rating === null || !validIdentity(player)) {
          warn(`${player.name ?? team.team} : statistiques de passes ESPN incomplètes.`);
          continue;
        }
        rows.push({ week, espn_athlete_id: player.id, qb_name: player.name, team: team.team, passer_rating: player.rating });
      }
    } catch (error) {
      warn(`${team.team} : ${error.message}`);
    }
  }
  return rows;
}

// Prepare only. The database revalidates the snapshot, handles concurrent
// writers and decides which verified rows can be persisted in each mode.
export async function prepareEspnWeek(state, { mode, teams, fetcher = fetch, qbNotificationsDue, gameIds } = {}) {
  if (!['automatic', 'qb-only', 'manual', 'close'].includes(mode) || !Array.isArray(teams)) throw Error('Préparation de semaine invalide.');
  const { current_season: season, current_week: week } = state.settings;
  const scoped = state.games.filter(g => g.season === season && g.week === week && g.season_type === 'regular');
  const result = { games: [], ratings: [], qbStats: [], warnings: [], pending: 0 };
  const warn = message => {
    if (mode === 'close') throw Error(message);
    result.warnings.push(message);
  };
  const picks = pickedGames(state, scoped, teams, warn);
  const isRelevant = game => game.is_pool_eligible === true || picks.has(game.id);
  const frozen = mode === 'automatic' || mode === 'qb-only';
  const rated = new Set(state.qb_ratings.filter(row => row.season === season && row.week === week && storedRating(row)).map(row => row.qb_id));
  const events = new Map();
  for (const game of scoped) {
    const id = String(game.external_game_id ?? '');
    events.set(id, (events.get(id) ?? 0) + 1);
  }
  const candidates = scoped.filter(game => {
    if (gameIds && !gameIds.has(game.id)) return false;
    if (mode === 'manual') return true;
    const gamePicks = picks.get(game.id) ?? [];
    const qbNeeded = gamePicks.some(pick => !frozen || !rated.has(pick.selected.id) || qbNotificationsDue?.has(pick.selected.id));
    return qbNeeded || (mode !== 'qb-only' && isRelevant(game) && (!frozen || !storedFinal(game)));
  });

  // There is one resolved JSON document per unique scoreboard event. All
  // selected QB ratings and ancillary stats reuse that same boxscore.
  const prepared = await mapBounded(candidates, async game => {
    const label = `${game.away_team} @ ${game.home_team}`;
    const warnings = [];
    const eventId = String(game.external_game_id ?? '');
    try {
      if (!athleteIdPattern.test(eventId) || events.get(eventId) !== 1) throw Error('Identifiant ESPN absent ou dupliqué.');
      const summary = await json(`${ESPN_SUMMARY}?event=${eventId}`, fetcher);
      const verified = verifiedGame(game, summary, teams);
      if (!verified) return { pending: true, warnings: [`${label} : match ESPN non FINAL.`] };
      const selectedPicks = (picks.get(game.id) ?? []).filter(pick => !frozen || !rated.has(pick.selected.id));
      const ratings = [];
      for (const pick of selectedPicks) {
        try {
          ratings.push(chosenRating(pick, summary, verified, game));
        } catch (error) {
          warnings.push(`${pick.selected.name} : ${error.message}`);
        }
      }
      if (selectedPicks.length !== ratings.length) return { warnings };
      const qbStats = mode === 'automatic' || mode === 'manual'
        ? weeklyStats(summary, verified, week, message => warnings.push(message)) : [];
      return { game: verified.patch, ratings, qbStats, warnings };
    } catch (error) {
      return { warnings: [`${label} : ${error.message}`] };
    }
  });
  const statsByAthlete = new Map();
  const retryGameIds = [];
  for (const [index, row] of prepared.entries()) {
    if (row.pending) result.pending++;
    if (!row.pending || mode === 'close') row.warnings.forEach(warn);
    if (row.game) result.games.push(row.game);
    else if (gameIds) retryGameIds.push(candidates[index].id);
    if (row.ratings) result.ratings.push(...row.ratings);
    for (const stats of row.qbStats ?? []) {
      // The stats schema stores one row per week/athlete. An ambiguous feed
      // should not abort the score publication for the whole week.
      const id = stats.espn_athlete_id;
      if (!statsByAthlete.has(id)) statsByAthlete.set(id, stats);
      else if (statsByAthlete.get(id)) {
        statsByAthlete.set(id, null);
        warn(`${stats.qb_name} : statistiques ESPN hebdomadaires ambiguës.`);
      }
    }
  }
  result.qbStats = [...statsByAthlete.values()].filter(Boolean);
  if (gameIds) {
    result.retryGameIds = retryGameIds;
    result.hasVerifiedGame = result.games.length > 0 ||
      scoped.some(game => gameIds.has(game.id) && isRelevant(game) && storedFinal(game));
  }
  return result;
}

// Use the existing division feed, matching by ESPN abbreviation when present
// and by team name otherwise. Incomplete records keep their previous values.
export async function prepareEspnStandings(teams, { season, fetcher = fetch } = {}) {
  const data = await fetchEspnStandings({ season, fetcher, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const patches = new Map();
  const warnings = [];
  function visit(node, inherited = null) {
    const name = String(node?.name || node?.displayName || node?.shortDisplayName || node?.abbreviation || '');
    const divisionName = name.trim().replace(/^American Football Conference\s*-\s*/i, 'AFC ')
      .replace(/^National Football Conference\s*-\s*/i, 'NFC ').replace(/^(AFC|NFC)\s*-\s*/i, '$1 ');
    const division = /\b(?:AFC|NFC)\b/i.test(divisionName) && /\b(?:East|West|North|South)\b/i.test(divisionName)
      ? divisionName : inherited;
    if (division) {
      const entries = node?.standings?.entries ?? node?.entries ?? [];
      for (const [index, entry] of entries.entries()) {
        const name = entry.team?.displayName || entry.team?.shortDisplayName || entry.team?.name || '';
        const abbr = abbreviation(entry.team?.abbreviation);
        const found = teams.filter(team => abbr ? abbreviation(team.espn_abbr) === abbr : normalize(team.name) === normalize(name));
        const read = key => scoreNumber(entry.stats?.find(stat => normalize(stat.name) === key)?.value);
        const wins = read('wins'), losses = read('losses'), ties = read('ties');
        if (found.length !== 1 || wins === null || losses === null || ties === null) {
          warnings.push(`${name || abbr || 'Équipe'} : fiche ESPN incomplète ou non associée.`);
          continue;
        }
        const id = found[0].id;
        if (!patches.has(id)) patches.set(id, { id, wins, losses, ties, division_rank: read('divisionrank') || index + 1, division_name: division });
      }
    }
    for (const child of node?.children ?? []) visit(child, division);
  }
  visit(data);
  if (!patches.size) warnings.push('Aucune fiche d’équipe NFL exploitable dans la réponse ESPN.');
  return { teams: [...patches.values()], warnings };
}
