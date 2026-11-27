import assert from 'node:assert/strict';
import test from 'node:test';
import { manualQbDecision } from './manualDecision.mjs';

const now = Date.now();
const future = new Date(now + 60_000).toISOString();
const reviewState = 'b'.repeat(64);
const menu = {
  manualOpen: true, enabled: false, open: false, season: 2026, week: 12, firstKickoffAt: future,
  teams: [{ abbr: 'WAS', qbName: 'Current QB', reviewState }],
};
const card = {
  entryId: 'entry', runId: 'run', season: 2026, week: 12, team: 'WAS', expiresAt: future, reservation: true,
};

test('manual workflow binds to the displayed current team without enabling the managed menu', () => {
  assert.deepEqual(manualQbDecision(card, menu, now), {
    entryId: 'entry', runId: 'run', expectedState: reviewState, team: 'WAS',
  });
});

test('manual workflow requires valid context, identity, evidence and the weekly window', () => {
  for (const config of [
    null, { ...menu, manualOpen: false }, { ...menu, week: 13 },
    { ...menu, firstKickoffAt: new Date(now).toISOString() }, { ...menu, teams: [] },
    { ...menu, teams: [{ ...menu.teams[0], qbName: null }] },
    { ...menu, teams: [{ ...menu.teams[0], reviewState: 'unknown' }] },
  ]) assert.equal(manualQbDecision(card, config, now), null);

  for (const changes of [
    { expiresAt: new Date(now).toISOString() }, { reservation: null },
    { runId: null }, { changedSinceObservation: true },
  ]) assert.equal(manualQbDecision({ ...card, ...changes }, menu, now), null);
});
