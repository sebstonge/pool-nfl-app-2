import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// Enumerate the civil calendar independently of the helper's date formula.
function fourthNovemberThursday(year) {
  return Array.from({ length: 30 }, (_, index) => index + 1)
    .filter(day => new Date(Date.UTC(year, 10, day)).getUTCDay() === 4)[3];
}
const utc = (year, month, day, hour, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();

test('Thanksgiving remains the fourth November Thursday across leap years and the 2100 century boundary', () => {
  for (let year = 2025; year <= 2105; year++) {
    const day = thanksgivingDay(year);
    assert.equal(day, fourthNovemberThursday(year), `civil calendar ${year}`);
    assert.ok(day >= 22 && day <= 28);
    assert.equal(new Date(Date.UTC(year, 10, day)).getUTCDay(), 4);
  }
});

for (const year of [2027, 2028, 2029, 2030]) {
  test(`every eligible Thanksgiving game is accented in ${year}, independently of the number of games`, () => {
    const day = fourthNovemberThursday(year), week = 4;
    const neighbours = [day - 1, day + 1].map((date, index) => game(utc(year, 11, date, 18), {
      id: `ordinary-${index}`, season: year, week,
    }));
    for (const count of [0, 1, 2, 3, 4, 5, 9, 16]) {
      const holiday = Array.from({ length: count }, (_, index) => game(utc(year, 11, day, 6 + index), {
        id: `arbitrary-id-${index}`, season: year, week,
        away_team: `Unlisted visitor ${index}`, home_team: `Unlisted host ${index}`,
      }));
      const games = [neighbours[0], ...holiday, neighbours[1]];
      const original = JSON.stringify(games);
      for (const schedule of [games, [...games].reverse()]) {
        const theme = getSeasonalTheme(schedule, { activeWeek: week, season: year });
        assert.equal(theme, count ? 'thanksgiving' : null, `${year}: ${count} holiday games`);
        for (const row of holiday) assert.equal(getSeasonalGameAccent(row, theme), 'thanksgiving', row.id);
        for (const row of neighbours) assert.equal(getSeasonalGameAccent(row, theme), null, row.id);
      }
      assert.equal(JSON.stringify(games), original, 'decoration never changes the schedule');
    }
  });

  test(`all December 24 and 25 games receive their own accents in ${year}, with independent game counts`, () => {
    const week = 3;
    const ordinary = [23, 26].map(day => game(utc(year, 12, day, 18), { season: year, week }));
    for (const eveCount of [0, 1, 2, 4, 8]) for (const dayCount of [0, 1, 3, 5, 9]) {
      const eve = Array.from({ length: eveCount }, (_, index) => game(utc(year, 12, 24, 6 + index), {
        id: `eve-${index}`, season: year, week,
      }));
      const christmas = Array.from({ length: dayCount }, (_, index) => game(utc(year, 12, 25, 6 + index), {
        id: `day-${index}`, season: year, week,
      }));
      const theme = getSeasonalTheme([...ordinary, ...christmas, ...eve], { activeWeek: week, season: year });
      assert.equal(theme, eveCount + dayCount ? 'christmas' : null);
      for (const row of eve) assert.equal(getSeasonalGameAccent(row, theme), 'christmas-eve', row.id);
      for (const row of christmas) assert.equal(getSeasonalGameAccent(row, theme), 'christmas-day', row.id);
      for (const row of ordinary) assert.equal(getSeasonalGameAccent(row, theme), null);
    }
  });

  test(`Toronto midnight boundaries preserve late games on the correct local holiday in ${year}`, () => {
    const day = fourthNovemberThursday(year);
    const thanksgivingCases = [
      [utc(year, 11, day, 4, 59, 59), null],
      [utc(year, 11, day, 5), 'thanksgiving'],
      [utc(year, 11, day + 1, 4, 59, 59), 'thanksgiving'],
      [utc(year, 11, day + 1, 5), null],
    ];
    const christmasCases = [
      [utc(year, 12, 24, 4, 59, 59), null],
      [utc(year, 12, 24, 5), 'christmas-eve'],
      [utc(year, 12, 25, 4, 59, 59), 'christmas-eve'],
      [utc(year, 12, 25, 5), 'christmas-day'],
      [utc(year, 12, 26, 4, 59, 59), 'christmas-day'],
      [utc(year, 12, 26, 5), null],
    ];
    for (const [date, expected] of thanksgivingCases) {
      const row = game(date, { season: year, week: 1 });
      assert.equal(getSeasonalGameAccent(row, 'thanksgiving'), expected, date);
      assert.equal(getSeasonalTheme([row], { season: year, activeWeek: 1 }), expected ? 'thanksgiving' : null, date);
    }
    for (const [date, expected] of christmasCases) {
      const row = game(date, { season: year, week: 2 });
      assert.equal(getSeasonalGameAccent(row, 'christmas'), expected, date);
      assert.equal(getSeasonalTheme([row], { season: year, activeWeek: 2 }), expected ? 'christmas' : null, date);
    }
    const late = game(`${year}-12-25T23:59:59-05:00`, { season: year });
    assert.equal(getSeasonalGameAccent(late, 'christmas'), 'christmas-day');
  });
}

test('holiday activation follows dates across arbitrary active-week numbers, seasons and team identities', () => {
  for (const year of [2027, 2028, 2029, 2036, 2050]) for (const week of [1, 2, 7, 12, 16, 18, 99]) {
    const settings = { season: year, activeWeek: week };
    for (const [date, expectedTheme, expectedAccent] of [
      [utc(year, 11, fourthNovemberThursday(year), 18), 'thanksgiving', 'thanksgiving'],
      [utc(year, 12, 24, 18), 'christmas', 'christmas-eve'],
      [utc(year, 12, 25, 18), 'christmas', 'christmas-day'],
      [utc(year, 10, 15, 18), null, null],
    ]) {
      const row = game(date, { season: year, week, id: `unknown-${year}-${week}`, home_team: '', away_team: 'Unknown' });
      const theme = getSeasonalTheme([row], settings);
      assert.equal(theme, expectedTheme);
      assert.equal(getSeasonalGameAccent(row, theme), expectedAccent);
      assert.equal(getSeasonalTheme([{ ...row, is_pool_eligible: false }], settings), null);
      assert.equal(getSeasonalGameAccent({ ...row, is_pool_eligible: false }, expectedTheme), null);
    }
  }
});

test('host timezone cannot change the Toronto holiday date or a late-game accent', () => {
  const moduleUrl = new URL('./seasonalTheme.mjs', import.meta.url).href;
  const script = `import {getSeasonalTheme,getSeasonalGameAccent} from ${JSON.stringify(moduleUrl)};
    const dates=['2029-11-23T04:59:59Z','2029-12-25T04:59:59Z','2029-12-26T04:59:59Z','2029-12-26T05:00:00Z'];
    console.log(JSON.stringify(dates.map(game_date=>{
      const game={game_date,season:2029,week:1,is_pool_eligible:true};
      const theme=getSeasonalTheme([game],{season:2029,activeWeek:1});
      return [theme,getSeasonalGameAccent(game,theme)];
    })));`;
  const expected = [['thanksgiving', 'thanksgiving'], ['christmas', 'christmas-eve'], ['christmas', 'christmas-day'], [null, null]];
  for (const hostZone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, TZ: hostZone },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), expected, hostZone);
  }
});
