// Public, non-commercial player metadata only. Sleeper asks clients to cache
// the players endpoint and read it at most once daily, including on cold starts.
export const SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl?position=QB';
export const DAY_MS = 86_400_000;
export const MAX_PLAYERS = 256;
const MAX_BYTES = 8 * 1024 * 1024;
const TEAMS = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
const athlete = value => typeof value === 'string' && /^\d{1,18}$/.test(value);
const teamCode = value => ({ WSH: 'WAS', LA: 'LAR', JAC: 'JAX' }[value] ?? value);
const text = value => typeof value === 'string' && value.length <= 64 ? value.trim() : null;
export const unavailable = player => [player?.status, player?.injuryStatus]
  .some(value => ['OUT', 'IR', 'PUP', 'SUSPENDED'].includes(value?.trim().toUpperCase()));

export function validSourceState(state, now) {
  if (state == null) return true;
  if (typeof state !== 'object' || Array.isArray(state) || state.version !== 1 ||
      Buffer.byteLength(JSON.stringify(state)) > 96 * 1024 || !state.sleeper ||
      !Array.isArray(state.sleeper.players) || state.sleeper.players.length > MAX_PLAYERS ||
      !Array.isArray(state.absences) || state.absences.length > MAX_PLAYERS ||
      !Array.isArray(state.signals) || state.signals.length > 32) return false;
  const date = value => value == null || (typeof value === 'string' &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30_000);
  if (state.observedAt == null || !date(state.observedAt) || !date(state.sleeper.attemptedAt) || !date(state.sleeper.fetchedAt) ||
      [state.sleeper.attemptedAt, state.sleeper.fetchedAt].some(value => value != null && Date.parse(value) > Date.parse(state.observedAt))) return false;
  const player = row => row && athlete(row.id) && TEAMS.has(row.team) &&
    typeof row.name === 'string' && row.name.trim() && row.name.length <= 120;
  if (!state.sleeper.players.every(row => player(row) &&
      [row.status, row.injuryStatus].every(value => value == null || (typeof value === 'string' && value.length <= 64))) ||
      new Set(state.sleeper.players.map(row => row.id)).size !== state.sleeper.players.length) return false;
  return state.absences.every(row => player(row) && row.since != null && date(row.since) && row.reason === 'sleeper_unavailable') &&
    new Set(state.absences.map(row => `${row.team}:${row.id}`)).size === state.absences.length &&
    state.signals.every(row => row && TEAMS.has(row.team) && typeof row.key === 'string' && row.key.length <= 240);
}

export function emptySourceState(now) {
  return { version: 1, observedAt: new Date(now).toISOString(),
    sleeper: { attemptedAt: null, fetchedAt: null, players: [] }, absences: [], signals: [] };
}

export async function readSleeper(state, fetcher, now, allowFetch = true) {
  const previousPlayers = state.sleeper.players;
  if (!allowFetch || (state.sleeper.attemptedAt && now() - Date.parse(state.sleeper.attemptedAt) < DAY_MS)) {
    return { previousPlayers, refreshed: false };
  }
  state.sleeper.attemptedAt = new Date(now()).toISOString();
  const response = await fetcher(SLEEPER_URL, { redirect: 'error' });
  if (!response.ok) throw Object.assign(new Error(`Sleeper HTTP ${response.status}`), {
    url: 'https://api.sleeper.app/', status: response.status, retryAfter: response.headers.get('retry-after'),
  });
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Sleeper response too large');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Sleeper response too large'); }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Sleeper players');
  const rows = Object.values(data).filter(row => row?.position === 'QB' && TEAMS.has(teamCode(row.team)))
    .map(row => ({ id: row.espn_id == null ? '' : String(row.espn_id), name: row.full_name,
      team: teamCode(row.team), status: text(row.status), injuryStatus: text(row.injury_status) }))
    .filter(row => athlete(row.id) && typeof row.name === 'string' && row.name.trim() && row.name.length <= 120);
  if (!rows.length || rows.length > MAX_PLAYERS || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('Missing or conflicting Sleeper identities');
  }
  state.sleeper = { attemptedAt: state.sleeper.attemptedAt, fetchedAt: new Date(now()).toISOString(), players: rows };
  return { previousPlayers, refreshed: true };
}
