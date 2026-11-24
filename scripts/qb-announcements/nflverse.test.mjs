import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { collectNflverse, readNflverseWeek, SCHEDULE_URL } from './nflverse.mjs';

const now = () => Date.parse('2026-11-05T18:00:00Z');
const teams = { JAX: {}, BAL: {}, ARI: {}, SEA: {}, WAS: {}, LAR: {} };
const rosterUrl = 'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv';
const schedules = `season,week,game_type,espn,gameday,gametime,away_team,home_team,away_score,home_score,away_qb_id,home_qb_id,away_qb_name,home_qb_name
2026,9,REG,401873037,2026-11-05,20:15,JAX,BAL,,,00-0036971,00-0040981,Trevor Lawrence,Joe Fagnano
2026,9,REG,401873048,2026-11-08,16:25,ARI,SEA,,,00-0035289,00-0039870,Gardner Minshew,Sam Darnold
2026,9,REG,401873043,2026-11-08,13:00,LA,WSH,,,00-0026498,00-0039910,Matthew Stafford,Jayden Daniels
`;
const rosters = `position,team,gsis_id,espn_id,full_name
QB,BAL,00-0040981,4429582,Joe Fagnano
QB,ARI,00-0035289,4038524,Gardner Minshew
QB,WAS,00-0039910,4426348,Jayden Daniels
QB,WAS,00-0039910,99999,Jayden Daniels
`;
const baseline = {
  BAL: { id: '3916387', name: 'Lamar Jackson' },
  ARI: { id: '2578570', name: 'Jacoby Brissett' },
  WAS: { id: '2576980', name: 'Marcus Mariota' },
};
const metadata = (url, data, date = '2026-11-05T15:00:00Z') => Response.json({ assets: [{
  name: url.split('/').at(-1), browser_download_url: url, updated_at: date,
  digest: `sha256:${createHash('sha256').update(data).digest('hex')}`,
}] });
const compressed = gzipSync(schedules);

test('nflverse validates the complete fixture shape and joins unique GSIS and ESPN IDs without confirming a starter', async () => {
  const fetcher = async url => {
    if (url.endsWith('/tags/schedules')) return metadata(SCHEDULE_URL, compressed);
    if (url === SCHEDULE_URL) return new Response(compressed);
    if (url.endsWith('/tags/rosters')) return metadata(rosterUrl, rosters);
    if (url === rosterUrl) return new Response(rosters);
    assert.fail(`Unexpected URL ${url}`);
  };
  const schedule = await readNflverseWeek(2026, 9, teams, fetcher, now);
  assert.equal(schedule.firstKickoffAt, '2026-11-06T01:15:00.000Z');
  assert.deepEqual(schedule.games.find(row => row.id === '401873043').teams, ['LAR', 'WAS']);
  const result = await collectNflverse({ season: 2026, schedule, baseline, fetcher, now });
  assert.deepEqual(result.decisions.map(row => [row.team, row.match.opponent, row.espnAthleteId, row.status]), [
    ['BAL', 'JAX', '4429582', 'ambiguous'], ['ARI', 'SEA', '4038524', 'ambiguous'],
  ]);
  assert.ok(result.decisions.every(row => row.publishedAt === undefined && row.reason === 'nflverse_projection'));
  assert.match(result.errors[0].message, /WAS.*à vérifier/);
});

test('an expired snapshot, mismatched content and a disallowed redirect fail closed', async () => {
  await assert.rejects(readNflverseWeek(2026, 9, teams, async () =>
    metadata(SCHEDULE_URL, compressed, '2026-11-02T01:00:00Z'), now), /stale/);
  await assert.rejects(readNflverseWeek(2026, 9, teams, async url =>
    url === SCHEDULE_URL ? new Response('different data') : metadata(SCHEDULE_URL, compressed), now), /integrity/);
  await assert.rejects(readNflverseWeek(2026, 9, teams, async url =>
    url === SCHEDULE_URL ? Response.redirect('https://www.nfl.com/news/test') : metadata(SCHEDULE_URL, compressed), now), /redirect/);
});

test('provider rate limits preserve the retry hint without starting another source', async () => {
  await assert.rejects(readNflverseWeek(2026, 9, teams, async () => new Response('', {
    status: 429, headers: { 'Retry-After': '7200' },
  }), now), { status: 429, retryAfter: '7200', url: 'https://api.github.com/' });
});
