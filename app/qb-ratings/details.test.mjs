import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { compactQbSelections } from './history.mjs';
import { ratingColor } from '../components/weekly-summary/presentation.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const swc = require('next/dist/build/swc');
const source = await readFile(new URL('./RegularPage.js', import.meta.url), 'utf8');
const { code } = await swc.transform(source + '\nexport { historyButton, QbWeeklyDetails, DesktopPodiumQB, DesktopCompactQB };', {
  filename: 'ratings.jsx',
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
});
const components = {};
const styles = new Proxy({}, { get: (_, key) => String(key) });
new Function('require', 'exports', code)(id => {
  if (id.endsWith('/regularClient.mjs')) return { regularClient: () => ({}) };
  if (id.endsWith('/supabase')) return { supabase: {} };
  if (id.endsWith('/BottomNav')) return () => null;
  if (id === './history.mjs') return { buildQbWeeklyHistory: () => [], compactQbSelections };
  if (id.endsWith('.module.css')) return { __esModule: true, default: styles };
  if (id.endsWith('/qbSnapshot.mjs')) return {};
  return require(id);
}, components);

const row = {
  qb: { id: 'actual-mckee', name: 'Tanner McKee', team: 'Eagles', espn_athlete_id: 'mckee' },
  best: { week: 6, passer_rating: 104.2, selected_by: 'Katy' },
  worst: null, average: 104.2,
  history: [{ season: 2026, week: 6, nflRating: 104.2, participants: [{
    pickId: 'p6', displayName: 'Katy', realName: '',
    selected: { name: 'Jalen Hurts' }, actual: { name: 'Tanner McKee' },
    replaced: true, creditedRating: 104.2,
  }] }],
};

test('QB disclosure uses a native keyboard button and stops click bubbling to the card', () => {
  let expanded = false;
  const toggle = () => { expanded = !expanded; };
  let props = components.historyButton(row, expanded, toggle);
  assert.equal(props.type, 'button');
  assert.equal(props['aria-expanded'], false);
  assert.equal(props['aria-controls'], 'qb-history-actual-mckee');
  let stopped = 0;
  props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 1);
  props = components.historyButton(row, expanded, toggle);
  assert.equal(props['aria-expanded'], true);
  assert.match(props['aria-label'], /Replier.*Tanner McKee/);
  props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(expanded, false);
  assert.equal(stopped, 2);
});

for (const name of ['DesktopPodiumQB', 'DesktopCompactQB']) {
  test(`${name} keeps details hidden until expanded and can close them again`, () => {
    const html = expanded => renderToStaticMarkup(React.createElement(components[name], {
      row, rank: name === 'DesktopPodiumQB' ? 1 : 4, teamLogo: '/eagles.png',
      isLast: true, expanded, onToggle() {},
    }));
    const closed = html(false);
    assert.match(closed, /aria-expanded="false"/);
    assert.match(closed, /<button type="button"/);
    assert.doesNotMatch(closed, /<div[^>]*role="button"/);
    assert.doesNotMatch(closed, /Historique hebdomadaire|QB sélectionné/);
    assert.match(closed, /104\.2/);
    assert.match(closed, /eagles\.png/);
    const opened = html(true);
    assert.match(opened, /aria-expanded="true"/);
    assert.match(opened, /role="region"/);
    assert.match(opened, /Semaine 6/);
    assert.match(opened, /Katy/);
    assert.match(opened, /104\.2/);
    assert.match(opened, /title="Remplacement : Jalen Hurts → Tanner McKee"/);
    assert.doesNotMatch(opened, /<h3|QB sélectionné|QB ayant joué|Rating crédité|Saison 2026/);
    assert.equal(html(false), closed);
  });
}

test('details distinguish the QB NFL rating from each participant’s credited rating', () => {
  const history = [{ ...row.history[0], nflRating: 82.5, participants: [
    row.history[0].participants[0],
    { ...row.history[0].participants[0], pickId: 'p-other', displayName: 'Louis-Simon', creditedRating: 0, replaced: false },
  ] }];
  const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: { ...row, history } }));
  assert.doesNotMatch(html, /82\.5|Passer rating du QB/);
  assert.match(html, /Katy/);
  assert.match(html, /Louis-Simon/);
  assert.match(html, /0\.0/);
  assert.equal(html.match(/🔄/g)?.length, 1);
  assert.ok(html.indexOf('Katy') < html.indexOf('Louis-Simon'));
});

test('missing results and empty participant weeks are shown without inventing zero or replacement', () => {
  const history = [
    { season: 2026, week: 1, nflRating: 0, participants: [] },
    { season: 2026, week: 2, nflRating: null, participants: [{
      pickId: 'pending', displayName: 'Sam', selected: null, actual: null, creditedRating: null, replaced: false,
    }] },
  ];
  const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: { ...row, history } }));
  assert.doesNotMatch(html, /Semaine 1|0\.0|Aucun participant|Non disponible|Identité sélectionnée|QB ayant joué/);
  assert.match(html, /Sam/);
  assert.match(html, /En attente/);
  assert.doesNotMatch(html, /🔄/);
});

test('a fully represented history stays compact with one empty-state sentence', () => {
  const current = { ...row, best: { ...row.best, selected_pick_id: 'p6', season: 2026 } };
  const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: current }));
  assert.match(html, /Aucune autre sélection\./);
  assert.doesNotMatch(html, /<li|<h3|Semaine 6/);
});

test('rating colors reuse the existing application formatter and exactly match Tous les choix', async () => {
  const reference = await readFile(new URL('../tous-les-choix/RegularPage.js', import.meta.url), 'utf8');
  const definition = reference.match(/function ratingColor\(rating\) \{[\s\S]*?\n\}/)[0];
  const referenceColor = new Function(`return (${definition})`)();
  for (const value of [0, 69.9, 70, 89.9, 90, 99.9, 100, 158.3]) {
    assert.equal(ratingColor(value), referenceColor(value));
    const history = [{ season: 2026, week: 2, participants: [{ pickId: 'color', displayName: 'Sam', creditedRating: value }] }];
    const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: { ...row, history } }));
    assert.ok(html.includes(`color:${referenceColor(value)}`));
  }
  assert.match(source, /import \{ ratingColor \} from "\.\.\/components\/weekly-summary\/presentation\.mjs"/);
});
