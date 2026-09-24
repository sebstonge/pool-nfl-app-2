import { ROUNDS } from './treeData.mjs';

export function playerName(player) {
  return player?.display_name || player?.real_name || 'Joueur';
}

export function consensus(game, picks) {
  const rows = picks.filter(pick => pick.game_id === game.id);
  const away = rows.filter(pick => pick.picked_team === game.away_team);
  const home = rows.filter(pick => pick.picked_team === game.home_team);
  const total = away.length + home.length;
  return { away, home, total };
}

export function teamPathGroups(paths, roundId) {
  const groups = new Map();
  for (const path of paths) {
    if (path.round_id !== roundId || !path.team) continue;
    if (!groups.has(path.team)) groups.set(path.team, []);
    groups.get(path.team).push(path);
  }
  return [...groups].map(([team, rows]) => ({ team, rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.team.localeCompare(b.team, 'fr'));
}

// Prefer the latest ongoing round; otherwise the most recently completed round,
// then the first draft with games, then the earliest configured round.
export function initialRound(rounds, games) {
  const ordered = [...rounds].sort((a, b) => a.round_order - b.round_order);
  const ongoing = ordered.filter(round => ['open', 'locked'].includes(round.status));
  if (ongoing.length) return ongoing.at(-1).round_key;
  const completed = ordered.filter(round => ['scored', 'finalized'].includes(round.status));
  if (completed.length) return completed.at(-1).round_key;
  return (ordered.find(round => games.some(game => game.round_id === round.id)) || ordered[0])?.round_key || 'wild_card';
}

export function collectiveRounds(rounds, games) {
  return ROUNDS.map(definition => {
    const row = rounds.find(round => round.round_key === definition.key);
    return { ...definition, id: row?.id, status: row?.status,
      games: row ? games.filter(game => game.round_id === row.id) : [] };
  });
}

async function read(query, source) {
  const { data, error } = await query;
  if (error) {
    console.error('[Collective playoffs]', source, error.code, error.message);
    throw new Error(`${source}: ${error.message}`, { cause: error });
  }
  return data || [];
}

export async function loadCollectiveData(client, requestedSeason) {
  const { data: auth, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!auth.session) return { requiresSignIn: true };
  const allRounds = await read(client.from('playoff_rounds')
    .select('id, season, round_key, round_name, round_order, status').order('round_order'), 'playoff_rounds');
  const seasons = [...new Set(allRounds.map(round => Number(round.season)))].filter(Number.isFinite).sort((a, b) => b - a);
  const season = seasons.includes(Number(requestedSeason)) ? Number(requestedSeason) : seasons[0];
  const rounds = allRounds.filter(round => Number(round.season) === season);
  const roundIds = rounds.map(round => round.id);
  const [teams, players, games, paths, qbPicks] = await Promise.all([
    read(client.from('teams').select('name, espn_abbr, logo'), 'teams'),
    read(client.from('users').select('id, display_name, real_name'), 'users'),
    roundIds.length ? read(client.from('playoff_games').select('id, round_id, external_game_id, game_date, away_team, home_team, away_score, home_score').in('round_id', roundIds).order('game_date'), 'playoff_games') : [],
    roundIds.length ? read(client.from('playoff_team_paths').select('id, user_id, round_id, team, multiplier, continues_previous_path').in('round_id', roundIds), 'playoff_team_paths') : [],
    roundIds.length ? read(client.from('playoff_qb_picks').select('id, user_id, round_id, qb_id, qbs(id, name, team, espn_athlete_id)').in('round_id', roundIds), 'playoff_qb_picks') : [],
  ]);
  const picks = games.length ? await read(client.from('playoff_picks')
    .select('id, user_id, game_id, picked_team, predicted_spread, created_at').in('game_id', games.map(game => game.id)).order('created_at', { ascending: true }), 'playoff_picks') : [];
  return { season, seasons, rounds, games, teams, players, paths, qbPicks, picks };
}

export function espnSummaryUrl(game) {
  const id = String(game.external_game_id || '').trim();
  if (!id || id.startsWith('TEST-')) return null;
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(id)}`;
}

export async function fetchLiveGame(game, fetcher, signal) {
  const url = espnSummaryUrl(game);
  if (!url) return null;
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error('ESPN indisponible');
  const summary = await response.json();
  const competition = summary?.header?.competitions?.[0];
  const state = competition?.status?.type?.state;
  if (!['in', 'post'].includes(state)) return null;
  const away = competition.competitors?.find(team => team.homeAway === 'away');
  const home = competition.competitors?.find(team => team.homeAway === 'home');
  if (away?.score == null || home?.score == null || away.score === '' || home.score === '') return null;
  const awayScore = Number(away.score), homeScore = Number(home.score);
  if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return null;
  return { awayScore, homeScore, state, detail: competition.status?.type?.shortDetail || '' };
}

export function submissionOrder(rows) {
  return [...rows].sort((a, b) => (Date.parse(a.created_at) || Infinity) - (Date.parse(b.created_at) || Infinity));
}
