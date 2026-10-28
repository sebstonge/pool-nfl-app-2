import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeasonalGameAccent, getSeasonalPreview, getSeasonalTheme, thanksgivingDay } from './seasonalTheme.mjs';

const game = (game_date, overrides = {}) => ({ game_date, season: 2026, week: 12, is_pool_eligible: true, ...overrides });

test('Thanksgiving follows the fourth Thursday of each year', () => {
  for (const [year, day] of [[2025, 27], [2026, 26], [2027, 25], [2028, 23], [2029, 22], [2030, 28]]) {
    assert.equal(thanksgivingDay(year), day);
    assert.equal(getSeasonalTheme([game(`${year}-11-${day}T18:00:00Z`, { season: year, week: 99 })], { season: year, activeWeek: 99 }), 'thanksgiving');
  }
  assert.equal(thanksgivingDay(NaN), null);
});

test('the season, active week, and actual eligibility constrain the real theme', () => {
  const games = [game('2026-11-26T18:00:00Z')];
  assert.equal(getSeasonalTheme(games, { activeWeek: 12, season: 2026 }), 'thanksgiving');
  assert.equal(getSeasonalTheme(games, { activeWeek: 11, season: 2026 }), null);
  assert.equal(getSeasonalTheme(games, { activeWeek: 12, viewedWeek: 11, season: 2026 }), null);
  assert.equal(getSeasonalTheme(games, { activeWeek: 12, season: 2027 }), null);
  assert.equal(getSeasonalTheme([game('2026-11-26T18:00:00Z', { is_pool_eligible: false })]), null);
  assert.equal(getSeasonalTheme([game('2026-11-26T18:00:00Z', { is_pool_eligible: undefined })]), null);
});

test('Thanksgiving cards are accented only on their exact Toronto date', () => {
  for (const date of ['2026-11-26T18:00:00Z', '2026-11-27T01:20:00Z']) assert.equal(getSeasonalGameAccent(game(date), 'thanksgiving'), 'thanksgiving');
  for (const date of ['2026-11-26T01:20:00Z', '2026-11-27T05:00:00Z', '2026-11-29T18:00:00Z']) assert.equal(getSeasonalGameAccent(game(date), 'thanksgiving'), null);
});

test('Christmas ambience comes from eligible games on December 24 or 25', () => {
  for (const date of ['2026-12-24T18:00:00Z', '2026-12-25T18:00:00Z']) assert.equal(getSeasonalTheme([game(date)]), 'christmas');
  for (const date of ['2026-12-23T18:00:00Z', '2026-12-26T18:00:00Z']) assert.equal(getSeasonalTheme([game(date)]), null);
});

test('Christmas Eve and Christmas Day have distinct accents in Toronto', () => {
  assert.equal(getSeasonalGameAccent(game('2026-12-25T01:20:00Z'), 'christmas'), 'christmas-eve');
  assert.equal(getSeasonalGameAccent(game('2026-12-25T18:00:00Z'), 'christmas'), 'christmas-day');
  assert.equal(getSeasonalGameAccent(game('2026-12-26T01:20:00Z'), 'christmas'), 'christmas-day');
  assert.equal(getSeasonalGameAccent(game('2026-12-26T05:00:00Z'), 'christmas'), null);
  assert.equal(getSeasonalGameAccent(game('2026-12-25T18:00:00Z'), 'thanksgiving'), null);
});

test('ordinary weeks and invalid or missing dates remain unchanged', () => {
  assert.equal(getSeasonalTheme([game('2026-10-29T00:20:00Z')]), null);
  for (const value of [null, undefined, '', 'not-a-date']) {
    assert.equal(getSeasonalTheme([game(value)]), null);
    assert.equal(getSeasonalGameAccent(game(value), 'christmas'), null);
  }
  assert.equal(getSeasonalTheme(null), null);
  assert.equal(getSeasonalTheme([]), null);
  assert.equal(getSeasonalGameAccent(game('2026-12-25T18:00:00Z'), null), null);
  assert.equal(getSeasonalGameAccent(game('2026-10-29T00:20:00Z'), null, { previewIndex: 0 }), null);
  assert.equal(getSeasonalGameAccent(game('2026-10-29T00:20:00Z'), null, { preview: 'christmas', environment: 'production', previewIndex: 0 }), null);
});

test('preview is strictly local development only, never production, test or Vercel Preview', () => {
  for (const environment of ['production', 'test', 'preview', undefined]) {
    assert.equal(getSeasonalPreview('christmas', environment), null);
    assert.equal(getSeasonalTheme([], { preview: 'christmas', environment }), null);
    assert.equal(getSeasonalGameAccent(game('2026-10-29T00:20:00Z'), 'christmas', { preview: 'christmas', environment, previewIndex: 0 }), null);
  }
  for (const preview of ['thanksgiving', 'christmas']) {
    assert.equal(getSeasonalPreview(preview, 'development'), preview);
    assert.equal(getSeasonalTheme([], { preview, environment: 'development' }), preview);
  }
  assert.equal(getSeasonalPreview('anything', 'development'), null);
});

test('development preview shows Christmas Eve, Christmas Day and normal existing cards without mutating data', () => {
  const existing = Object.freeze(game('2026-10-29T00:20:00Z'));
  const original = { ...existing };
  const options = { preview: 'christmas', environment: 'development' };
  assert.deepEqual([0, 1, 2, 3].map(previewIndex => getSeasonalGameAccent(existing, 'christmas', { ...options, previewIndex })), ['christmas-eve', 'christmas-day', null, 'christmas-eve']);
  assert.deepEqual(existing, original);
});

test('development Thanksgiving preview leaves neighbouring cards normal', () => {
  const options = { preview: 'thanksgiving', environment: 'development' };
  assert.deepEqual([0, 1, 2].map(previewIndex => getSeasonalGameAccent(game('2026-10-29T00:20:00Z'), 'thanksgiving', { ...options, previewIndex })), ['thanksgiving', null, null]);
});

test('an ignored production preview never disables genuine calendar-driven decoration', () => {
  const existing = game('2026-11-26T18:00:00Z');
  assert.equal(getSeasonalTheme([existing], { preview: 'christmas', environment: 'production' }), 'thanksgiving');
  assert.equal(getSeasonalGameAccent(existing, 'thanksgiving', { preview: 'christmas', environment: 'production', previewIndex: 1 }), 'thanksgiving');
});
