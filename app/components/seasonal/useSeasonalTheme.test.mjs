import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as seasonal from '../../../lib/seasonal/seasonalTheme.mjs';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('./useSeasonalTheme.js', import.meta.url), 'utf8');
const { code } = await require('next/dist/build/swc').transform(source, {
  filename: 'useSeasonalTheme.js',
  jsc: { parser: { syntax: 'ecmascript' } },
  module: { type: 'commonjs' },
});

function harness(environment, search = '') {
  const states = [], effects = [], listeners = new Map();
  let index = 0;
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = value; }];
    },
    useEffect(effect) { if (!effects.length) effects.push(effect); },
  };
  const window = {
    get location() {
      assert.equal(environment, 'development', 'Production must not inspect the preview URL');
      return { search };
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  const exports = {};
  new Function('require', 'exports', 'process', 'window', code)(id => {
    if (id === 'react') return react;
    if (id.endsWith('/seasonalTheme.mjs')) return seasonal;
    if (id.endsWith('.css')) return { surface: 'surface', thanksgiving: 'thanksgiving', christmas: 'christmas' };
    throw Error(id);
  }, exports, { env: { NODE_ENV: environment } }, window);
  return {
    render(games, options) { index = 0; return exports.default(games, options); },
    mount() { return effects.map(effect => effect()); },
    listeners,
  };
}

const ordinary = Object.freeze({ week: 7, season: 2026, game_date: '2026-10-29T00:20:00Z', is_pool_eligible: true });
const thanksgiving = { ...ordinary, game_date: '2026-11-26T18:00:00Z' };

test('normal rendering has no seasonal classes or indexed game accents', () => {
  const h = harness('production', '?seasonalPreview=christmas');
  const ui = h.render([ordinary], { activeWeek: 7, season: 2026 });
  h.mount();
  assert.equal(ui.theme, null);
  assert.equal(ui.pageClassName, '');
  assert.deepEqual([0, 1, 2].map(i => ui.gameAccent(ordinary, i)), [null, null, null]);
  assert.equal(h.listeners.size, 0);
});

test('Production uses actual dates and never inspects the development preview parameter', () => {
  const h = harness('production', '?seasonalPreview=christmas');
  const ui = h.render([thanksgiving], { activeWeek: 7, season: 2026 });
  h.mount();
  assert.equal(ui.theme, 'thanksgiving');
  assert.equal(ui.pageClassName, 'surface thanksgiving');
  assert.equal(ui.gameAccent(thanksgiving, 0), 'thanksgiving');
  assert.equal(ui.gameAccent(ordinary, 1), null);
});

test('development URL preview decorates existing cards without changing their data', () => {
  const h = harness('development', '?seasonalPreview=christmas');
  h.render([ordinary]);
  const cleanup = h.mount();
  const ui = h.render([ordinary]);
  assert.equal(ui.theme, 'christmas');
  assert.equal(ui.pageClassName, 'surface christmas');
  assert.deepEqual([0, 1, 2].map(i => ui.gameAccent(ordinary, i)), ['christmas-eve', 'christmas-day', null]);
  assert.equal(ordinary.game_date, '2026-10-29T00:20:00Z');
  assert.equal(h.listeners.size, 1);
  cleanup.forEach(fn => fn?.());
  assert.equal(h.listeners.size, 0);
});

test('disabled surface and historical weeks stay undecorated', () => {
  const dev = harness('development', '?seasonalPreview=christmas');
  dev.render([thanksgiving], { enabled: false });
  dev.mount();
  const disabled = dev.render([thanksgiving], { enabled: false });
  assert.equal(disabled.pageClassName, '');
  assert.equal(disabled.gameAccent(ordinary, 0), null);
  const history = harness('production').render([thanksgiving], { activeWeek: 8, viewedWeek: 7, season: 2026 });
  assert.equal(history.theme, null);
  assert.equal(history.gameAccent(thanksgiving, 0), null);
});

test('decoration is static, scoped and pointer-transparent with no functional style overrides', async () => {
  const css = await readFile(new URL('./seasonal.module.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /data-seasonal-accent="christmas-eve"/);
  assert.match(css, /data-seasonal-accent="christmas-day"/);
  assert.doesNotMatch(css, /font-size:|font-family:|font-weight:|padding:|:global\(\.bottom-nav\)|:global\(body\)|transform:/);
  assert.doesNotMatch(source, /fetch\(|\.from\(|\.rpc\(|localStorage|sessionStorage/);
});

test('Production decorates every Thanksgiving card across future seasons, never only a preview index', () => {
  for (const [year, day] of [[2027, 25], [2028, 23], [2029, 22]]) {
    const games = Array.from({ length: 8 }, (_, index) => ({
      id: `future-${index}`, season: year, week: 2, is_pool_eligible: true,
      game_date: `${year}-11-${day}T${String(10 + index).padStart(2, '0')}:00:00-05:00`,
    }));
    const h = harness('production', '?seasonalPreview=christmas');
    const ui = h.render(games, { activeWeek: 2, season: year });
    h.mount();
    assert.equal(ui.theme, 'thanksgiving');
    assert.deepEqual(games.map((row, index) => ui.gameAccent(row, index)), Array(8).fill('thanksgiving'));
    assert.equal(h.listeners.size, 0);
  }
});

test('Production decorates every Christmas Eve and Day card while leaving ordinary dates normal', () => {
  for (const year of [2027, 2028, 2029]) {
    const games = [23, 24, 24, 24, 24, 25, 25, 25, 25, 25, 26].map((day, index) => ({
      id: `future-${index}`, season: year, week: 1, is_pool_eligible: true,
      game_date: `${year}-12-${day}T18:00:00Z`,
    }));
    const h = harness('production', '?seasonalPreview=thanksgiving');
    const ui = h.render(games, { activeWeek: 1, season: year });
    h.mount();
    assert.equal(ui.theme, 'christmas');
    assert.deepEqual(games.map((row, index) => ui.gameAccent(row, index)), [
      null, ...Array(4).fill('christmas-eve'), ...Array(5).fill('christmas-day'), null,
    ]);
    assert.equal(h.listeners.size, 0);
  }
});
