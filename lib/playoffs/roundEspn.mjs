import { ROUNDS, RoundError, official, assertMatchups } from './rounds.mjs';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const abbr = value => String(value || '').toUpperCase().replace(/^WSH$/, 'WAS');
async function json(url, fetcher) {
  const response = await fetcher(url, { cache:'no-store', signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new RoundError(`ESPN indisponible (${response.status}). Réessaie plus tard.`);
  return response.json();
}
function competitors(competition, seeds, teams) {
  if (competition?.competitors?.length !== 2) throw new RoundError('Équipes ESPN incomplètes.');
  return Object.fromEntries(['home','away'].map(side => {
    const row = competition.competitors.find(c => c.homeAway === side);
    const seed = seeds.find(s => s.espn_team_id === String(row?.team?.id));
    const matches = teams.filter(t => abbr(t.espn_abbr) && abbr(t.espn_abbr) === abbr(row?.team?.abbreviation));
    if (!seed || matches.length !== 1 || matches[0].name !== seed.team)
      throw new RoundError('Correspondance ESPN / teams / seeds invalide.');
    return [side, { team:seed.team, score:row.score }];
  }));
}
export async function discoverGames({season,key,expected,seeds,teams,fetcher=fetch,now=Date.now()}) {
  const week = ROUNDS.find(r => r.key === key).week;
  const data = await json(`${BASE}/scoreboard?dates=${season}&seasontype=3&week=${week}&limit=100`,fetcher);
  if (data.season?.year !== season || data.season?.type !== 3 || data.week?.number !== week)
    throw new RoundError('Le calendrier ESPN de cette saison/ronde n’est pas encore disponible.');
  const candidates = [];
  for (const event of data.events || []) {
    if (event.season?.year !== season || event.season?.type !== 3 || event.week?.number !== week) continue;
    if (!/^\d+$/.test(String(event.id)) || event.competitions?.length !== 1) continue;
    const c = event.competitions[0];
    let sides;
    try { sides = competitors(c,seeds,teams); } catch { continue; }
    candidates.push({ external_game_id:String(event.id),home_team:sides.home.team,away_team:sides.away.team,
      game_date:c.date || event.date, validTime:c.timeValid !== false && c.dateValid !== false,
      game_status:c.status?.type?.state, completed:c.status?.type?.completed });
  }
  const games = expected.map(p => {
    const matches = candidates.filter(g => key === 'super_bowl'
      ? [g.home_team,g.away_team].includes(p.home_team) && [g.home_team,g.away_team].includes(p.away_team)
      : g.home_team === p.home_team && g.away_team === p.away_team);
    if (matches.length !== 1) throw new RoundError(`Affrontement ESPN absent ou ambigu : ${p.away_team} / ${p.home_team}. Aucune ronde modifiée.`);
    const g = matches[0];
    if (!g.validTime || !Number.isFinite(Date.parse(g.game_date)) || Date.parse(g.game_date) <= now || g.game_status !== 'pre' || g.completed !== false)
      throw new RoundError(`Horaire non confirmé ou match déjà commencé : ${g.away_team} / ${g.home_team}.`);
    return {external_game_id:g.external_game_id,home_team:g.home_team,away_team:g.away_team,game_date:g.game_date,game_status:'pre',home_score:null,away_score:null};
  });
  assertMatchups(games,expected,key);
  return games;
}
export async function gameUpdate(game,{season,seeds,teams,fetcher=fetch}) {
  if (!official(game)) return null; // Includes TEST-*; never sent to ESPN.
  const data = await json(`${BASE}/summary?event=${encodeURIComponent(game.external_game_id)}`,fetcher);
  const header = data.header;
  if (String(header?.id) !== game.external_game_id || header.season?.year !== season || header.season?.type !== 3 || header.competitions?.length !== 1)
    throw new RoundError('Événement ESPN incohérent.');
  const c = header.competitions[0];
  const sides = competitors(c,seeds,teams);
  if (sides.home.team !== game.home_team || sides.away.team !== game.away_team) throw new RoundError('Affrontement ESPN modifié.');
  const state = c.status?.type?.state;
  if (!['pre','in','post'].includes(state) || (state === 'post' && c.status.type.completed !== true)) throw new RoundError('Statut ESPN non confirmé.');
  // Never downgrade an already observed FINAL (or LIVE) on a stale ESPN response.
  if ((game.game_status === 'post' && state !== 'post') || (game.game_status === 'in' && state === 'pre')) throw new RoundError('Réponse ESPN périmée.');
  const score = raw => raw !== null && raw !== undefined && String(raw).trim() !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
  const home = score(sides.home.score), away = score(sides.away.score);
  if (state !== 'pre' && (home === null || away === null || (state === 'post' && home === away))) throw new RoundError('Scores ESPN incomplets.');
  return {id:game.id,external_game_id:game.external_game_id,game_status:state,
    home_score:state === 'pre' ? game.home_score : home,away_score:state === 'pre' ? game.away_score : away};
}
