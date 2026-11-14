import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

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
  if (id === './history.mjs') return { buildQbWeeklyHistory: () => [] };
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
    assert.match(opened, /Semaine 6.*Saison 2026/);
    assert.match(opened, /QB sélectionné.*Jalen Hurts/);
    assert.match(opened, /QB ayant joué.*Tanner McKee/);
    assert.match(opened, /Rating crédité.*104\.2/);
    assert.match(opened, /🔄 Remplacement/);
    assert.equal(html(false), closed);
  });
}

test('details distinguish the QB NFL rating from each participant’s credited rating', () => {
  const history = [{ ...row.history[0], nflRating: 82.5, participants: [
    row.history[0].participants[0],
    { ...row.history[0].participants[0], pickId: 'p-other', displayName: 'Louis-Simon', creditedRating: 0, replaced: false },
  ] }];
  const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: { ...row, history } }));
  assert.match(html, /Passer rating du QB.*82\.5/);
  assert.match(html, /Katy/);
  assert.match(html, /Louis-Simon/);
  assert.match(html, /Rating crédité.*0\.0/);
  assert.equal(html.match(/🔄 Remplacement/g)?.length, 1);
});

test('missing results and empty participant weeks are shown without inventing zero or replacement', () => {
  const history = [
    { season: 2026, week: 1, nflRating: 0, participants: [] },
    { season: 2026, week: 2, nflRating: null, participants: [{
      pickId: 'pending', displayName: 'Sam', selected: null, actual: null, creditedRating: null, replaced: false,
    }] },
  ];
  const html = renderToStaticMarkup(React.createElement(components.QbWeeklyDetails, { row: { ...row, history } }));
  assert.match(html, /0\.0/);
  assert.match(html, /Aucun participant pour ce QB cette semaine/);
  assert.match(html, /Non disponible/);
  assert.match(html, /Identité sélectionnée à confirmer/);
  assert.match(html, /En attente de résultat/);
  assert.doesNotMatch(html, /🔄 Remplacement/);
});
