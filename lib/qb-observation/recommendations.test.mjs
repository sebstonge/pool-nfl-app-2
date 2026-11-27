import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQbRecommendations } from './recommendations.mjs';

const previousQB = { id: '2576980', name: 'Marcus Mariota' };
const newQB = { id: '4426348', name: 'Jayden Daniels' };
const otherQB = { id: '2', name: 'Another Quarterback' };
const match = { id: '401772847', opponent: 'PHI', kickoffAt: '2026-11-29T21:25:00.000Z' };
const now = Date.parse('2026-11-26T19:00:00Z');
const dates = {
  openedAt: '2026-11-24T16:00:00.000Z', observedAt: '2026-11-26T18:00:00.000Z',
  firstKickoffAt: '2026-11-26T20:30:00.000Z', fetchedAt: '2026-11-26T16:00:00.000Z',
};

const decision = overrides => ({
  entryId: 'entry-1', runId: 'run-1', season: 2026, week: 12, revision: 5,
  team: 'WAS', match, status: 'ambiguous', reason: 'sleeper_unavailable', currentSignal: true,
  previousQB, newQB, espnAthleteId: newQB.id, ...overrides,
});

const unavailable = { ...previousQB, team: 'WAS', status: 'OUT', injuryStatus: 'Questionable' };
const candidate = { ...newQB, team: 'WAS', status: 'Active' };

function journal(entries, { players = [unavailable, candidate], fetchTime = dates.fetchedAt, run = {} } = {}) {
  return {
    entries,
    runs: [{
      runId: 'run-1', season: 2026, week: 12, revision: 5, status: 'completed',
      ...dates, sourceState: { sleeper: { fetchedAt: fetchTime, players } }, ...run,
    }],
  };
}

const menu = {
  enabled: false, open: false, canCheck: true, season: 2026, week: 12,
  firstKickoffAt: dates.firstKickoffAt,
  teams: [{ abbr: 'WAS', name: 'Commanders', qbName: previousQB.name, reserved: true }],
};

test('shows a pre-freeze reported absence and a verified proposed replacement as probable and manual', () => {
  const view = journal([decision()]);
  const before = structuredClone(view);
  const [row] = buildQbRecommendations(view, { menu, now });
  assert.deepEqual(view, before);
  assert.deepEqual(row.currentQb, previousQB);
  assert.equal(row.currentQbVerified, true);
  assert.equal(row.currentStatus, 'unavailable');
  assert.equal(row.reportedStatus, 'OUT');
  assert.equal(row.confidence, 'probable');
  assert.equal(row.action, 'reviewReplacement');
  assert.deepEqual(row.candidates, [newQB]);
  assert.deepEqual(row.recommendedQb, newQB);
  assert.equal(row.reservation, true);
  assert.equal(row.teamInMenu, true);
  assert.deepEqual(row.match, match);
  assert.equal(row.observedAt, dates.observedAt);
  assert.equal(row.expiresAt, dates.firstKickoffAt);
  assert.deepEqual(row.sources.map(source => source.label), ['nflverse', 'Sleeper']);
  assert.match(row.justification, /Vérifier sa titularisation/);
});

test('offers review of exclusion without inventing a replacement or roster-based candidates', () => {
  const [row] = buildQbRecommendations(journal([decision({ newQB: null, espnAthleteId: null })]), { menu, now });
  assert.equal(row.currentStatus, 'unavailable');
  assert.equal(row.action, 'reviewExclusion');
  assert.equal(row.recommendedQb, null);
  assert.deepEqual(row.candidates, []);
  assert.equal(row.sources.length, 1);
});

test('treats a projection and an Active identity as probable, with no starter confirmation or recommendation', () => {
  const [row] = buildQbRecommendations(journal([decision({ reason: 'nflverse_projection' })], {
    players: [{ ...unavailable, status: 'Active', injuryStatus: null }, candidate],
  }), { menu, now });
  assert.equal(row.currentStatus, 'reported');
  assert.equal(row.action, 'verifySources');
  assert.equal(row.confidence, 'probable');
  assert.deepEqual(row.candidates, [newQB]);
  assert.equal(row.recommendedQb, null);
});

test('does not turn separate absence and projection entries into a single actionable signal', () => {
  const [row] = buildQbRecommendations(journal([
    decision({ newQB: null, espnAthleteId: null }),
    decision({ entryId: 'projected', reason: 'nflverse_projection' }),
  ]), { menu, now });
  assert.equal(row.action, 'verifySources');
  assert.equal(row.recommendedQb, null);
  assert.deepEqual(row.candidates, [newQB]);
});

test('keeps a return for manual review even when Sleeper reports Active', () => {
  const [row] = buildQbRecommendations(journal([decision({ reason: 'sleeper_return_review' })], {
    players: [{ ...unavailable, status: 'Active', injuryStatus: null }, candidate],
  }), { menu, now });
  assert.equal(row.currentStatus, 'reported');
  assert.equal(row.confidence, 'uncertain');
  assert.equal(row.action, 'reviewReturn');
  assert.equal(row.recommendedQb, null);
});

test('deduplicates repeated observations and surfaces conflicting candidates without preferring one', () => {
  const entries = [decision(), decision({ entryId: 'entry-2' }),
    decision({ entryId: 'entry-3', newQB: otherQB, espnAthleteId: otherQB.id })];
  const [row, duplicate] = buildQbRecommendations(journal(entries, {
    players: [unavailable, candidate, { ...otherQB, team: 'WAS', status: 'Active' }],
  }), { menu, now });
  assert.equal(duplicate, undefined);
  assert.equal(row.confidence, 'contradictory');
  assert.equal(row.action, 'verifySources');
  assert.deepEqual(row.candidates, [newQB, otherQB]);
  assert.equal(row.recommendedQb, null);

  const [providerConflict] = buildQbRecommendations(journal([decision({ reason: 'source_conflict' })]), { menu, now });
  assert.equal(providerConflict.confidence, 'contradictory');
  assert.deepEqual(providerConflict.candidates, []);
});

test('does not expose an unverified name, ESPN identity or team as a potential candidate', () => {
  for (const result of [
    journal([decision({ espnAthleteId: '3' })]),
    journal([decision()], { players: [unavailable, { ...candidate, team: 'BAL' }] }),
    journal([decision()], { players: [unavailable, { ...candidate, name: 'Different player' }] }),
    journal([decision()], { players: [unavailable, { ...candidate, injuryStatus: 'IR' }] }),
  ]) {
    const [row] = buildQbRecommendations(result, { menu, now });
    assert.equal(row.action, 'reviewExclusion');
    assert.deepEqual(row.candidates, []);
  }
});

test('does not decide absence using an old, pre-opening or mismatched player record', () => {
  for (const result of [
    journal([decision()], { fetchTime: '2026-11-24T15:00:00Z' }),
    journal([decision()], { fetchTime: '2026-11-26T18:30:00Z' }),
    journal([decision()], { players: [{ ...unavailable, team: 'BAL' }, candidate] }),
    journal([decision({ reason: 'source_missing' })]),
  ]) {
    const [row] = buildQbRecommendations(result, { menu, now });
    assert.equal(row.action, 'verifySources');
    assert.equal(row.confidence, 'uncertain');
    assert.equal(row.recommendedQb, null);
  }
});

test('flags a changed assignment, retaining its reservation and clearing the old actionable signal', () => {
  const [row] = buildQbRecommendations(journal([decision()]), {
    menu: { ...menu, teams: [{ ...menu.teams[0], qbName: newQB.name }] }, now,
  });
  assert.deepEqual(row.currentQb, { id: null, name: newQB.name });
  assert.equal(row.currentQbVerified, true);
  assert.equal(row.currentStatus, 'unknown');
  assert.equal(row.reservation, true);
  assert.equal(row.action, 'verifySources');
  assert.equal(row.recommendedQb, null);
  assert.deepEqual(row.candidates, []);
});

test('keeps reservation and assignment unverified when the menu context is unavailable', () => {
  const [row] = buildQbRecommendations(journal([decision()]), { now });
  assert.deepEqual(row.currentQb, previousQB);
  assert.equal(row.currentQbVerified, false);
  assert.equal(row.reservation, null);
  assert.equal(row.teamInMenu, null);
});

test('ignores stale, dismissed, legacy, post-freeze and out-of-context recommendations', () => {
  assert.deepEqual(buildQbRecommendations(journal([
    decision({ currentSignal: false }), decision({ dismissedAt: dates.observedAt }),
    decision({ reason: 'starter_confirmed' }), decision({ week: 11 }), decision({ revision: 4 }),
  ]), { menu, now }), []);
  assert.deepEqual(buildQbRecommendations(journal([decision()]), { menu, now: Date.parse(dates.firstKickoffAt) }), []);
  assert.deepEqual(buildQbRecommendations(journal([decision()]), { menu: { ...menu, week: 11 }, now }), []);
  assert.deepEqual(buildQbRecommendations(journal([decision()]), {
    menu: { ...menu, firstKickoffAt: new Date(now).toISOString() }, now,
  }), []);
  assert.deepEqual(buildQbRecommendations(journal([decision()], {
    run: { observedAt: '2026-11-26T16:00:00Z' },
  }), { menu, now }), []);
});
