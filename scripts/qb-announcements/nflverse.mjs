import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const repo = 'nflverse/nflverse-data';
const github = 'https://github.com';
const api = 'https://api.github.com';
const downloads = new Set(['https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);
export const NFLVERSE_ORIGINS = new Set([github, api, ...downloads]);
export const SCHEDULE_URL = `${github}/${repo}/releases/download/schedules/games.csv.gz`;
const DAY = 86_400_000;
const LIMIT = 8 * 1024 * 1024;
const numberId = value => /^\d{1,18}$/.test(value ?? '');
const gsisId = value => /^\d{2}-\d{7}$/.test(value ?? '');
const team = code => ({ LA: 'LAR', WSH: 'WAS' }[code] ?? code);
const toronto = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function kickoff(date, time) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d$/.test(time)) return NaN;
  const text = `${date} ${time}`;
  const candidates = [4, 5].map(hours => Date.parse(`${date}T${time}:00-0${hours}:00`))
    .filter(value => Number.isFinite(value) && toronto.format(value) === text);
  return candidates.length === 1 ? candidates[0] : NaN;
}

function csv(text, fields) {
  const records = [];
  let record = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      record.push(value);
      value = '';
    } else if (!quoted && char === '\n') {
      record.push(value);
      if (record.length > 1) records.push(record);
      record = [];
      value = '';
    } else if (quoted || char !== '\r') {
      value += char;
    }
  }
  if (quoted) throw new Error('Malformed nflverse CSV');
  if (record.length) records.push([...record, value]);
  const headers = records.shift();
  if (!headers || new Set(headers).size !== headers.length || fields.some(key => !headers.includes(key))) {
    throw new Error('nflverse CSV fields missing');
  }
  const indexes = fields.map(key => headers.indexOf(key));
  return records.map(row => {
    if (row.length !== headers.length) throw new Error('Malformed nflverse CSV row');
    return Object.fromEntries(fields.map((key, index) => [key, row[indexes[index]]]));
  });
}

async function checkedFetch(url, fetcher, options = {}) {
  const result = await fetcher(url, options);
  if (!result.ok && !(options.redirect === 'manual' && [301, 302, 303, 307, 308].includes(result.status))) {
    const reset = result.headers.get('x-ratelimit-reset');
    const resetAt = /^\d{1,12}$/.test(reset ?? '') ? new Date(Number(reset) * 1000) : null;
    throw Object.assign(new Error(`nflverse HTTP ${result.status}`), {
      url: new URL(url).origin + '/', status: result.status,
      retryAfter: result.headers.get('retry-after') ??
        (result.headers.get('x-ratelimit-remaining') === '0' && resetAt ? resetAt.toUTCString() : null),
    });
  }
  return result;
}

async function bytes(response) {
  if (!response.body || Number(response.headers.get('content-length')) > LIMIT) throw new Error('nflverse asset too large');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, total);
    total += value.length;
    if (total > LIMIT) {
      await reader.cancel();
      throw new Error('nflverse asset too large');
    }
    chunks.push(value);
  }
}

async function readRelease(tag, file, maxAge, now, fetcher) {
  const url = `${github}/${repo}/releases/download/${tag}/${file}`;
  const metadata = await checkedFetch(`${api}/repos/${repo}/releases/tags/${tag}`, fetcher, {
    headers: { Accept: 'application/vnd.github+json' }, redirect: 'error',
  });
  const release = JSON.parse((await bytes(metadata)).toString('utf8'));
  const assets = release.assets?.filter(asset => asset.name === file) ?? [];
  const [asset] = assets;
  const updated = Date.parse(asset?.updated_at);
  if (assets.length !== 1 || asset.browser_download_url !== url || !Number.isFinite(updated) ||
      updated > now + 30_000 || now - updated > maxAge) {
    throw new Error('nflverse release missing or stale');
  }
  let response = await checkedFetch(url, fetcher, { redirect: 'manual' });
  if (!response.ok) {
    const redirect = new URL(response.headers.get('location') ?? '', url);
    if (!downloads.has(redirect.origin) || redirect.username || redirect.password) {
      throw new Error('Unexpected nflverse download redirect');
    }
    response = await checkedFetch(redirect.href, fetcher, { redirect: 'error' });
  }
  const data = await bytes(response);
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
      `sha256:${createHash('sha256').update(data).digest('hex')}` !== asset.digest) {
    throw new Error('nflverse release integrity check failed');
  }
  return (file.endsWith('.gz') ? gunzipSync(data, { maxOutputLength: LIMIT }) : data).toString('utf8');
}

export async function readNflverseWeek(season, week, teams, fetcher, now) {
  const fields = ['season', 'week', 'game_type', 'espn', 'gameday', 'gametime',
    'away_team', 'home_team', 'away_score', 'home_score',
    'away_qb_id', 'home_qb_id', 'away_qb_name', 'home_qb_name'];
  const data = await readRelease('schedules', 'games.csv.gz', DAY, now(), fetcher);
  const fixtures = csv(data, fields).filter(row => row.season === String(season) &&
    row.week === String(week) && row.game_type === 'REG');
  const ids = new Set(), clubs = new Set();
  const games = fixtures.map(row => {
    const sides = [team(row.away_team), team(row.home_team)];
    const starts = kickoff(row.gameday, row.gametime);
    if (!numberId(row.espn) || ids.has(row.espn) || !Number.isFinite(starts) ||
        sides[0] === sides[1] || sides.some(abbr => !Object.hasOwn(teams, abbr) || clubs.has(abbr))) {
      throw new Error('Incomplete or inconsistent nflverse fixture');
    }
    ids.add(row.espn);
    sides.forEach(abbr => clubs.add(abbr));
    return {
      id: row.espn, teams: sides, kickoffAt: new Date(starts).toISOString(),
      phase: row.away_score || row.home_score ? 'post' : 'pre',
      qbs: [ { gsis: row.away_qb_id, name: row.away_qb_name }, { gsis: row.home_qb_id, name: row.home_qb_name } ],
    };
  });
  if (games.length === 0) throw new Error('NFL week absent from nflverse');
  games.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  return { season, week, games, firstKickoffAt: games[0].kickoffAt };
}

const comparableName = value => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
let rosterCache;

export async function collectNflverse({ season, schedule, baseline, fetcher, now }) {
  const candidates = schedule.games.flatMap(game => game.teams.map((abbr, side) => ({
    game, abbr, opponent: game.teams[1 - side], player: game.qbs[side], previous: baseline[abbr],
  }))).filter(({ player, previous }) => player.name.trim() && previous &&
    comparableName(player.name) !== comparableName(previous.name));
  if (!candidates.length) return { decisions: [], errors: [], counts: { analyzed: schedule.games.length } };

  if (rosterCache?.season !== season || now() >= rosterCache.until) {
    const data = await readRelease('rosters', `roster_${season}.csv`, 36 * 3_600_000, now(), fetcher);
    const players = csv(data, ['position', 'team', 'gsis_id', 'espn_id', 'full_name']);
    rosterCache = { season, until: now() + 3_600_000, players };
  }
  const decisions = [], errors = [];
  for (const { game, abbr, opponent, player, previous } of candidates) {
    const identities = rosterCache.players.filter(row => gsisId(player.gsis) && row.gsis_id === player.gsis &&
      row.position === 'QB' && team(row.team) === abbr && numberId(row.espn_id) &&
      comparableName(row.full_name) === comparableName(player.name));
    const ids = new Set(identities.map(row => row.espn_id));
    if (ids.size !== 1) {
      errors.push({ message: `${abbr} : identité du QB nflverse à vérifier` });
      continue;
    }
    const [id] = ids;
    if (id === previous.id) continue;
    decisions.push({
      team: abbr, match: { id: game.id, opponent, kickoffAt: game.kickoffAt },
      previousQB: previous, newQB: { id, name: identities[0].full_name },
      espnAthleteId: id, url: SCHEDULE_URL, status: 'ambiguous', reason: 'nflverse_projection',
    });
  }
  return { decisions, errors, counts: { analyzed: schedule.games.length, ambiguous: decisions.length } };
}
