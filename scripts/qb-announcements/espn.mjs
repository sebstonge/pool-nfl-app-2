import { collection, ensure, json, sameIds } from '../../lib/regular-publication/espn.mjs';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export async function readWeek(season, week, teams, fetcher = fetch) {
  ensure(Number.isInteger(season) && season >= 2000 && season <= 2100, 'Invalid NFL season');
  ensure(Number.isInteger(week) && week >= 1 && week <= 18, 'Invalid regular week');
  const expectedIds = await collection(
    `/seasons/${season}/types/2/weeks/${week}/events`,
    /^\/v2\/sports\/football\/leagues\/nfl\/events\/(\d+)$/,
    fetcher,
  );
  const scoreboard = await json(
    `${SITE}/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=${expectedIds.length + 1}`,
    fetcher,
  );
  ensure(scoreboard.season?.year === season && scoreboard.season?.type === 2 &&
    scoreboard.week?.number === week && Array.isArray(scoreboard.events) &&
    sameIds(scoreboard.events.map(event => String(event.id)), expectedIds),
  'ESPN weekly calendar incomplete or inconsistent');

  const teamIds = new Map(Object.entries(teams).map(([abbr, team]) => [String(team.espnId), abbr]));
  const playingTeams = new Set();
  const games = scoreboard.events.map(event => {
    const [competition] = event.competitions || [];
    ensure(event.season?.year === season && event.season?.type === 2 &&
      event.week?.number === week && event.competitions?.length === 1 &&
      competition.competitors?.length === 2 &&
      competition.timeValid !== false && competition.dateValid !== false &&
      !/POSTPON|CANCEL|SUSPEND|DELAY|TBD/.test(competition.status?.type?.name || ''),
    'ESPN game context or kickoff unresolved');
    const kickoff = Date.parse(competition.date || event.date);
    const phase = competition.status?.type?.state;
    ensure(Number.isFinite(kickoff) && ['pre', 'in', 'post'].includes(phase),
      'ESPN game time or state invalid');
    const sides = competition.competitors.map(row => teamIds.get(String(row.team?.id)));
    ensure(sides.every(team => team && !playingTeams.has(team)) && sides[0] !== sides[1],
      'ESPN team missing or playing twice in the same week');
    sides.forEach(team => playingTeams.add(team));
    return { id: String(event.id), kickoffAt: new Date(kickoff).toISOString(), teams: sides, phase };
  });
  games.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  return { season, week, games, firstKickoffAt: games[0].kickoffAt };
}

export function qbRoster(payload, espnId, asOf) {
  ensure(String(payload.team?.id) === String(espnId) && Array.isArray(payload.athletes),
    'ESPN roster belongs to another team or is incomplete');
  const at = Date.parse(asOf);
  ensure(Number.isFinite(at), 'Roster observation time missing');
  const qbs = payload.athletes.flatMap(group => group.items || [])
    .filter(player => player.position?.abbreviation === 'QB').map(player => {
      const id = String(player.id ?? '');
      const name = player.fullName || player.displayName;
      ensure(/^\d+$/.test(id) && typeof name === 'string' && name.trim(), 'Incomplete ESPN QB identity');
      const injuries = (player.injuries || []).filter(injury =>
        injury.status && !(Date.parse(injury.date) > at));
      // A status whose time cannot be verified still prevents assuming availability.
      const recent = injuries.sort((a, b) =>
        (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))[0];
      const availability = recent?.status ?? null;
      return { id, name, status: player.status?.name || null, availability };
    });
  ensure(qbs.length > 0 && new Set(qbs.map(qb => qb.id)).size === qbs.length,
    'ESPN QB roster empty or duplicated');
  return qbs;
}

export async function readRoster(team, season, asOf, fetcher = fetch) {
  ensure(/^\d+$/.test(String(team?.espnId)) && Number.isInteger(season), 'Invalid ESPN roster request');
  const payload = await json(`${SITE}/teams/${team.espnId}/roster?season=${season}`, fetcher);
  return qbRoster(payload, team.espnId, asOf);
}

export function rotateClubs(games, observedAt, priorities = [], limit = 4) {
  const playing = new Set(games.flatMap(game => game.teams));
  const preferred = [...new Set(priorities)].filter(team => playing.has(team)).slice(0, limit);
  const rest = [...playing].filter(team => !preferred.includes(team)).sort();
  const cycle = Math.floor(Date.parse(observedAt) / 7_200_000);
  ensure(Number.isFinite(cycle), 'Invalid discovery clock');
  const slots = Math.min(limit - preferred.length, rest.length);
  for (let n = 0; n < slots; n++) preferred.push(rest[(cycle * slots + n) % rest.length]);
  return preferred;
}
