import { validateSeedRows } from './seeds.mjs';

export const ROUNDS = [
  { key: 'wild_card', name: 'Wild Card', count: 6, week: 1 },
  { key: 'divisional', name: 'Divisional', count: 4, week: 2 },
  { key: 'conference', name: 'Finales de conférence', count: 2, week: 3 },
  { key: 'super_bowl', name: 'Super Bowl', count: 1, week: 5 },
];
export class RoundError extends Error {}
export const official = game => /^\d+$/.test(String(game.external_game_id || ''));
export function frozenSeeds(rows, season) {
  try { validateSeedRows(rows, season); } catch { throw new RoundError('Un snapshot complet de 14 seeds est requis.'); }
  if (rows.some(r => !r.finalized_at) || new Set(rows.map(r => r.finalized_at)).size !== 1)
    throw new RoundError('Les seeds sont provisoires : impossible de préparer une ronde officielle.');
  return rows;
}
export function winner(game) {
  if (!official(game) || game.game_status !== 'post' ||
    ![game.home_score, game.away_score].every(s => Number.isInteger(s) && s >= 0) || game.home_score === game.away_score)
    throw new RoundError('Tous les matchs officiels doivent être FINAL, avec un gagnant valide.');
  return game.home_score > game.away_score ? game.home_team : game.away_team;
}
const pair = (home, away) => ({ home_team: home.team, away_team: away.team });
export function assertMatchups(games, expected, key) {
  if (games.length !== expected.length || games.some(g => !official(g)) ||
      new Set(games.map(g => g.external_game_id)).size !== games.length ||
      new Set(games.flatMap(g => [g.home_team, g.away_team])).size !== games.length * 2 ||
      expected.some(p => !games.some(g => key === 'super_bowl'
        ? [g.home_team, g.away_team].includes(p.home_team) && [g.home_team, g.away_team].includes(p.away_team)
        : g.home_team === p.home_team && g.away_team === p.away_team)))
    throw new RoundError('Les matchs enregistrés ne correspondent pas à la ronde officielle attendue.');
}
// Rebuild the entire chain from frozen ORIGINAL seeds, never from display order.
export function expectedMatchups(seeds, season, key, rounds, games) {
  frozenSeeds(seeds, season);
  const target = ROUNDS.findIndex(r => r.key === key);
  if (target < 0) throw new RoundError('Ronde inconnue.');
  let expected = ['AFC', 'NFC'].flatMap(conference => {
    const seed = n => seeds.find(s => s.conference === conference && s.seed === n);
    return [[2,7],[3,6],[4,5]].map(([h,a]) => pair(seed(h), seed(a)));
  });
  for (let i = 0; i < target; i++) {
    const round = rounds.find(r => r.round_key === ROUNDS[i].key);
    if (!round) throw new RoundError('Ronde précédente absente.');
    const source = games.filter(g => g.round_id === round.id);
    assertMatchups(source, expected, ROUNDS[i].key);
    let survivors = source.map(g => seeds.find(s => s.team === winner(g)));
    if (i === 0) survivors = survivors.concat(seeds.filter(s => s.seed === 1));
    if (i === 2) {
      const afc = survivors.filter(s => s.conference === 'AFC');
      const nfc = survivors.filter(s => s.conference === 'NFC');
      if (afc.length !== 1 || nfc.length !== 1) throw new RoundError('Champions de conférence incomplets.');
      // Placeholder order only; matching below uses ESPN's Super Bowl orientation.
      expected = [pair(afc[0], nfc[0])];
    } else expected = ['AFC','NFC'].flatMap(conference => {
      const s = survivors.filter(r => r.conference === conference).sort((a,b) => a.seed-b.seed);
      if (s.length !== (i === 0 ? 4 : 2)) throw new RoundError('Résultats de conférence incomplets.');
      return i === 0 ? [pair(s[0],s[3]),pair(s[1],s[2])] : [pair(s[0],s[1])];
    });
  }
  return expected;
}
export function currentRound(rounds) {
  const active = rounds.filter(r => ['open','locked'].includes(r.status));
  if (active.length > 1) throw new RoundError('Plusieurs rondes actives : aucune transition automatique possible.');
  if (active.length) return active[0];
  return ROUNDS.map(d => rounds.find(r => r.round_key === d.key) || {round_key:d.key,status:'draft'})
    .find(r => r.status !== 'finalized') || rounds.find(r => r.round_key === 'super_bowl');
}
export function roundSummary(data) {
  const current = currentRound(data.rounds);
  const definition = ROUNDS.find(r => r.key === current.round_key);
  const games = data.games.filter(g => g.round_id === current.id);
  const real = games.filter(official);
  let blocked = '';
  try { frozenSeeds(data.seeds, data.season); } catch(e) { blocked = e.message; }
  if (!blocked && games.some(g => !official(g))) blocked = 'Cette ronde contient des matchs TEST ou non officiels. Ils sont conservés; la préparation officielle est bloquée.';
  let canAdvance = false;
  try {
    if (!blocked && ['open','locked'].includes(current.status) && definition.key !== 'super_bowl') {
      expectedMatchups(data.seeds,data.season,ROUNDS[ROUNDS.indexOf(definition)+1].key,data.rounds,data.games);
      canAdvance = true;
    }
  } catch { /* Incomplete results keep the next-round action disabled. */ }
  return { current, definition, games, officialCount:real.length,
    finalCount:real.filter(g => {try {winner(g);return true;} catch{return false;}}).length,
    firstKickoff:real.map(g => g.game_date).sort()[0] || null,
    blocked, canPrepare:!blocked && current.round_key === 'wild_card' && current.status === 'draft' && real.length === 0,
    canUpdate:!blocked && real.length === definition.count && ['open','locked'].includes(current.status), canAdvance };
}
