import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import * as presentation from '../../components/weekly-summary/presentation.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const swc = require('next/dist/build/swc');
const bindings = {
  '../../../lib/supabase': { supabase: {} },
  '../../../lib/notifications/adminLog.mjs': { torontoDate },
  '../../components/weekly-summary/presentation.mjs': presentation,
  './journal.module.css': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key }),
};
async function load(file, extra = '') {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { code } = await swc.transform(source + extra, {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const exports = {};
  new Function('require', 'exports', code)(path => bindings[path] ?? require(path), exports);
  return exports;
}
const { default: MenuControls } = await load('./MenuControls.js');
bindings['./MenuControls'] = { __esModule: true, default: MenuControls };
const { Entry } = await load('./page.js', '\nexport { Entry };\n');
const render = props => renderToStaticMarkup(React.createElement(MenuControls, props));
const open = {
  season: 2026, week: 9, enabled: true, open: true, canCheck: true, firstKickoffAt: '2026-11-06T01:15:00Z',
  teams: [{ abbr: 'WAS', name: 'Washington Commanders', qbId: 'old', qbName: 'Marcus Mariota', available: true, reserved: true }],
};

test('the menu commands follow the server week, window and feature switch', () => {
  assert.doesNotMatch(render({ context: null }), /Relancer la vérification|Corriger un titulaire/);
  assert.match(render({ context: open }), /Saison 2026 · Semaine 9/);
  assert.match(render({ context: open }), /Relancer la vérification/);
  assert.match(render({ context: open }), /Corriger un titulaire/);
  const closed = render({ context: { ...open, open: false, canCheck: false }, draft: {} });
  assert.match(closed, /Fenêtre hebdomadaire fermée/);
  assert.doesNotMatch(closed, /Relancer la vérification|Corriger un titulaire|Confirmer le titulaire/);
  const observeOnly = render({ context: { ...open, enabled: false, open: false }, draft: {} });
  assert.match(observeOnly, /Relancer la vérification/);
  assert.doesNotMatch(observeOnly, /Corriger un titulaire|Confirmer le titulaire/);
  const beforeFirstCheck = render({ context: { ...open, open: false }, draft: {} });
  assert.match(beforeFirstCheck, /Relancer la vérification/);
  assert.match(beforeFirstCheck, /Une vérification du calendrier est nécessaire/);
  assert.doesNotMatch(beforeFirstCheck, /Corriger un titulaire|Confirmer le titulaire/);
});

test('the Admin verifies the exact candidate and source while seeing the reservation', () => {
  const html = render({
    context: open,
    draft: { entry: { entryId: 'signal', team: 'WAS', newQB: { name: 'Jayden Daniels' }, espnAthleteId: '4426348' } },
  });
  assert.match(html, /Jayden Daniels/);
  assert.match(html, /ESPN 4426348/);
  assert.match(html, /players\/full\/4426348\.png/);
  assert.match(html, /teamlogos\/nfl\/500\/was\.png/);
  assert.match(html, /Le choix soumis est conservé/);
  assert.match(html, /Motif factuel et source de confirmation/);
  assert.match(html, /disabled="">Confirmer le titulaire/);
  assert.doesNotMatch(html, /Rechercher un QB par nom/);
});

test('manual selection can search the catalog or remove an unavailable QB', () => {
  const html = render({ context: open, draft: {} });
  assert.match(html, /Rechercher un QB par nom/);
  assert.match(html, /Retirer le QB indisponible du menu/);
  assert.match(html, /disabled="">Confirmer le titulaire/);
});

test('only current signals can be reviewed and dismissed', () => {
  const entry = {
    entryId: 'signal', currentSignal: true, season: 2026, week: 9,
    team: 'WAS', newQB: { name: 'Jayden Daniels' }, espnAthleteId: '4426348',
    url: 'https://example.test/schedules', status: 'ambiguous', reason: 'nflverse_projection',
  };
  const signal = (row, context = open) => renderToStaticMarkup(React.createElement(Entry, { entry: row, context }));
  assert.match(signal(entry), /Vérifier et confirmer/);
  assert.match(signal(entry), /Titulaire indiqué · à confirmer/);
  assert.doesNotMatch(signal(entry), /Annonce de titulaire confirmée/);
  assert.match(signal(entry), /Écarter le signal/);
  assert.doesNotMatch(signal(entry, { ...open, enabled: false, open: false }), /Vérifier et confirmer/);
  assert.doesNotMatch(signal(entry, { ...open, open: false, canCheck: false }), /Vérifier et confirmer|Écarter le signal/);
  assert.doesNotMatch(signal({ ...entry, week: 8 }), /Vérifier et confirmer|Écarter le signal/);
  assert.doesNotMatch(signal({ ...entry, currentSignal: false }), /Vérifier et confirmer|Écarter le signal/);
  const dismissed = signal({ ...entry, dismissedAt: '2026-11-05T15:00:00Z' });
  assert.match(dismissed, /Signal écarté/);
  assert.doesNotMatch(dismissed, /Vérifier et confirmer|Écarter le signal/);
  const confirmed = signal({ ...entry, dismissedAt: '2026-11-05T15:00:00Z', reviewOutcome: 'confirmed' });
  assert.match(confirmed, /Titulaire confirmé par l’Admin/);
  assert.doesNotMatch(confirmed, /Signal écarté|à confirmer|Vérifier et confirmer/);
});
