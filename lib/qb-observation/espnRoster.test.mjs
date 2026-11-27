import assert from 'node:assert/strict';
import test from 'node:test';
import { findEspnQbs, qbTeamCode } from './espnRoster.mjs';

const reference = (team = '28', season = 2026) => ({
  $ref: `http://sports.core.api.espn.pvt/v2/sports/football/leagues/nfl/seasons/${season}/teams/${team}?lang=en&region=us`,
});
const athlete = (id, fullName, position = 'QB', teams = [reference()]) => ({
  id, fullName, position: { abbreviation: position }, teams,
});
const roster = (items, team = 'WSH') => ({
  status: 'success',
  season: { year: 2026 },
  team: { id: '28', abbreviation: team, name: 'Commanders', displayName: 'Washington Commanders' },
  athletes: [{ position: 'offense', items }],
});

test('resolves a literal name on the current team roster and normalizes the ESPN alias', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/wsh/roster');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(roster([athlete('4426348', 'Jayden Daniels')]));
  };
  assert.deepEqual(await findEspnQbs(qbTeamCode(' wsh '), '  jAyDeN  Daniels ', fetcher), [
    { id: '4426348', name: 'Jayden Daniels', team: 'WAS', position: 'QB' },
  ]);
  assert.deepEqual(await findEspnQbs('WAS', 'Daniels', fetcher), []);
});

test('rejects non-QBs, other teams, old roster references and contradictory athlete IDs', async () => {
  const candidates = [
    athlete('10', 'Eric Dupont', 'WR'),
    athlete('11', 'Eric Dupont', 'QB', [reference('16')]),
    athlete('12', 'Eric Dupont', 'QB', [reference('28', 2025)]),
    athlete('13', 'Eric Dupont'),
    athlete('13', 'Distinct Player'),
    athlete('14', 'Eric Dupont', 'QB', [{ $ref: 'https://untrusted.invalid/teams/28' }]),
    athlete('15', 'Éric Dupont'),
  ];
  let calls = 0;
  const matches = await findEspnQbs('WAS', 'Eric Dupont', async () => {
    calls++;
    return Response.json(roster(candidates));
  });
  assert.equal(calls, 1);
  assert.deepEqual(matches.map(x => x.id), ['15']);
});

test('separate QB identities with the same name remain distinguishable for the Admin', async () => {
  const matches = await findEspnQbs('WAS', 'Même nom', async () => Response.json(
    roster([athlete('10', 'Même nom'), athlete('10', 'Même nom'), athlete('11', 'Même nom')]),
  ));
  assert.deepEqual(matches.map(x => x.id), ['10', '11']);
});

test('a different or unavailable team roster cannot yield a verified identity', async () => {
  await assert.rejects(findEspnQbs('WAS', 'Jayden Daniels', async () => Response.json(roster([], 'BUF'))), /incohérent/);
  await assert.rejects(findEspnQbs('WAS', 'Jayden Daniels', async () => new Response('', { status: 503 })), /indisponible/);
  await assert.rejects(findEspnQbs('WAS/..', 'Jayden Daniels', async () => assert.fail('No fetch allowed')), /invalide/);
});
