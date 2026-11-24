import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(file, import.meta.url), 'utf8');

test('the Admin QB observation page reads only the journal and the Admin menu context', async () => {
  const page = await read('./page.js');
  const panel = await read('./Recommendations.js');
  assert.match(page, /const SIGNAL_LIMIT = 100;/);
  assert.match(page, /\.rpc\('read_qb_observation_log', \{ p_limit: SIGNAL_LIMIT \}, \{ get: true \}\)/);
  assert.match(page, /\.rpc\('read_regular_qb_menu_admin', \{\}, \{ get: true \}\)/);
  assert.equal([...page.matchAll(/\.rpc\(/g)].length, 2);
  assert.doesNotMatch(page + panel, /manage_regular_qb_menu|dismiss_qb_observation_candidate|qb_observer_exchange|\.from\(/);
  assert.doesNotMatch(panel, /\.rpc\(|\bfetch\(|<form[^>]+\baction=|localStorage|sessionStorage/);
  assert.match(panel, /event\.preventDefault\(\)/);
});

test('recommendations are prioritized and reviewing them cannot submit a decision', async () => {
  const page = await read('./page.js');
  const panel = await read('./Recommendations.js');
  assert.match(page, /<Recommendations journal=/);
  assert.match(page, /<summary>Journal technique<\/summary>/);
  assert.ok(page.indexOf('<Recommendations journal=') < page.indexOf('<summary>Journal technique</summary>'));
  assert.match(panel, /<details className=\{styles\.review\}>/);
  assert.match(panel, /sans effet sur le menu/);
  assert.match(panel, /frozen \? <p>/);
});

test('renders the quarterback, probable replacement, evidence and reserved team in an inspection-only panel', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { transform } = require('next/dist/build/swc');
  const { code } = await transform(await read('./Recommendations.js'), {
    filename: 'Recommendations.jsx',
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const component = {};
  const styles = new Proxy({}, { get: (_, name) => (name === '__esModule' ? false : name) });
  new Function('require', 'exports', code)(id => id.endsWith('.css') ? styles : require(id), component);

  const now = Date.now();
  const iso = offset => new Date(now + offset).toISOString();
  const qb = { id: '1', name: 'QB actuel' };
  const replacement = { id: '2', name: 'QB proposé' };
  const menu = {
    season: 2026, week: 12, enabled: false, open: false, canCheck: true, firstKickoffAt: iso(60_000),
    teams: [{ abbr: 'WAS', name: 'Washington', qbName: qb.name, reserved: true }],
  };
  const run = {
    runId: 'run', season: 2026, week: 12, revision: 1, openedAt: iso(-600_000),
    observedAt: iso(-60_000), firstKickoffAt: menu.firstKickoffAt, status: 'completed',
    sourceState: { sleeper: { fetchedAt: iso(-120_000), players: [
      { ...qb, team: 'WAS', injuryStatus: 'Out' },
      { ...replacement, team: 'WAS', status: 'Active' },
    ] } },
  };
  const entry = {
    entryId: 'entry', runId: run.runId, season: 2026, week: 12, revision: 1,
    team: 'WAS', currentSignal: true, reason: 'sleeper_unavailable',
    previousQB: qb, newQB: replacement, espnAthleteId: replacement.id,
    match: { id: '5001', opponent: 'PHI', kickoffAt: iso(120_000) },
  };
  const journal = { runs: [run], entries: [entry] };
  const render = context => renderToStaticMarkup(createElement(component.default, { menu: context, journal }));

  const html = render(menu);
  for (const text of ['Recommandations', 'Washington c. PHI', qb.name, replacement.name, 'Probable',
    'Absent', 'Remplaçant recommandé', 'Autre QB', 'Sources et effets', 'nflverse', 'Sleeper',
    'L’équipe est réservée', 'les choix soumis sont conservés', 'Lecture seule']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /type="button"[^>]*aria-pressed="false"/);
  assert.match(html, /type="submit"[^>]*disabled[^>]*>OK<\/button>/);
  assert.doesNotMatch(html, /<details[^>]+open|>Confirmé</);
  assert.match(render({ ...menu, firstKickoffAt: iso(-1) }), /Menu gelé/);
  assert.doesNotMatch(render({ ...menu, firstKickoffAt: iso(-1) }), /QB proposé|Autre QB/);
  assert.match(render(null), /Contexte du menu indisponible/);
});
