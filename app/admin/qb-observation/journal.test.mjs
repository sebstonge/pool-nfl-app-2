import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(file, import.meta.url), 'utf8');

test('the Admin QB page reads only its two contexts and delegates one guarded decision', async () => {
  const page = await read('./page.js');
  const panel = await read('./Recommendations.js');
  assert.match(page, /const SIGNAL_LIMIT = 100;/);
  assert.match(page, /\.rpc\('read_qb_observation_log', \{ p_limit: SIGNAL_LIMIT \}, \{ get: true \}\)/);
  assert.match(page, /\.rpc\('read_regular_qb_menu_admin', \{\}, \{ get: true \}\)/);
  assert.equal([...page.matchAll(/\.rpc\(/g)].length, 2);
  assert.match(page, /fetch\('\/api\/admin\/qb-starter'/);
  assert.doesNotMatch(page + panel, /manage_regular_qb_|dismiss_qb_observation_candidate|qb_observer_exchange|SUPABASE_SERVICE_ROLE_KEY|\.from\(/);
  assert.doesNotMatch(panel, /\.rpc\(|<form\b/);
});

test('recommendations are prioritized and require a deliberate submission', async () => {
  const page = await read('./page.js');
  const panel = await read('./Recommendations.js');
  const decision = await read('./RecommendationDecision.js');
  assert.match(page, /<Recommendations journal=/);
  assert.match(page, /<summary>Journal technique<\/summary>/);
  assert.ok(page.indexOf('<Recommendations journal=') < page.indexOf('<summary>Journal technique</summary>'));
  assert.match(panel, /<details className=\{styles\.review\}>/);
  assert.match(panel, /Sources et effets/);
  assert.match(panel, /frozen \? <p>/);
  assert.match(decision, /request\('lookup',/);
  assert.match(decision, /if \(disabled \|\| !selection\) return/);
  assert.match(decision, /request\('confirm', [\s\S]+confirmed: true/);
  assert.match(decision, /Actualise la fiche avant de confirmer/);
});

test('renders the quarterback, probable replacement, evidence and reserved team in an inspection-only panel', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { transform } = require('next/dist/build/swc');
  const styles = new Proxy({}, { get: (_, name) => (name === '__esModule' ? false : name) });
  async function compile(file, resolve) {
    const { code } = await transform(await read(file), {
      filename: file,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' },
    });
    const component = {};
    new Function('require', 'exports', code)(id => id.endsWith('.css') ? styles : resolve(id), component);
    return component;
  }
  const decision = await compile('./RecommendationDecision.js', require);
  const component = await compile('./Recommendations.js', id => id === './RecommendationDecision' ? decision : require(id));

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
    'Absence signalée', 'Remplaçant potentiel', 'nflverse', 'Sleeper', 'L’équipe est réservée',
    'les choix soumis sont conservés', 'Lecture seule']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /disabled=""[^>]*>Confirmer le titulaire<\/button>/);
  assert.doesNotMatch(html, /<details[^>]+open|>Confirmé</);
  assert.match(render({ ...menu, firstKickoffAt: iso(-1) }), /Menu gelé/);
  assert.doesNotMatch(render({ ...menu, firstKickoffAt: iso(-1) }), /QB proposé|Confirmer le titulaire/);
  assert.match(render(null), /Contexte du menu indisponible/);
  const manuallyOpen = { ...menu, manualOpen: true,
    teams: [{ ...menu.teams[0], reviewState: 'b'.repeat(64) }] };
  const enabled = render(manuallyOpen);
  assert.match(enabled, /Confirmation Admin/);
  assert.match(enabled, /<form/);
  assert.match(enabled, /<button type="button" class="identityTile" aria-pressed="false"/);
  assert.match(enabled, /Autre QB pour Washington/);
  assert.match(enabled, /disabled=""[^>]*>Confirmer le titulaire<\/button>/);
});

test('player and scoring consumers preserve the captured identity after a catalogue slot changes', async () => {
  const choices = await read('../../matchs/RegularPage.js');
  const ratings = await read('../../api/push/qb-final/route.js');
  assert.match(choices, /selected_espn_athlete_id:\s+selectedQb\.espn_athlete_id/);
  assert.match(choices, /postgres_changes[^\n]+table: "qbs"/);
  assert.match(ratings, /const selectedQB = selectionSnapshot\(pick\)/);
  assert.doesNotMatch(ratings, /pick\.qbs\b/);
});
