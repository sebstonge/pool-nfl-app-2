export function validateSeedRows(rows, season) {
  if (!Number.isInteger(season) || season < 2000 || season > 9999) throw new Error('Saison invalide');
  if (!Array.isArray(rows) || rows.length !== 14) throw new Error('14 équipes requises');
  for (const row of rows) {
    if (row.season !== season || !['AFC', 'NFC'].includes(row.conference) || !Number.isInteger(row.seed) || row.seed < 1 || row.seed > 7 ||
      typeof row.team !== 'string' || !row.team.trim() || typeof row.espn_team_id !== 'string' || !/^\d+$/.test(row.espn_team_id)) throw new Error('Équipe ou seed invalide');
  }
  for (const field of ['team', 'espn_team_id']) {
    if (new Set(rows.map(row => row[field].trim().toLowerCase())).size !== 14) throw new Error(`Équipe dupliquée : ${field}`);
  }
  for (const conference of ['AFC', 'NFC']) {
    if (rows.filter(row => row.conference === conference).map(row => row.seed).sort((a, b) => a - b).join(',') !== '1,2,3,4,5,6,7') throw new Error(`Seeds incomplets ou dupliqués : ${conference}`);
  }
  return rows;
}

export function extractEspnSeeds(data, season, localTeams) {
  if (data?.season?.year !== season) throw new Error('Saison ESPN incohérente');
  const rows = [];
  const abbreviation = value => String(value || '').toUpperCase().replace(/^WSH$/, 'WAS');
  function walk(node, inheritedConference) {
    const conference = ['AFC', 'NFC'].includes(node.abbreviation) ? node.abbreviation : inheritedConference;
    for (const entry of node.standings?.entries || node.entries || []) {
      const value = entry.stats?.find(stat => stat.name === 'playoffSeed')?.value;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('playoffSeed ESPN absent ou invalide');
      if (value > 7) continue;
      if (!conference) throw new Error('Conférence ESPN absente');
      const team = entry.team;
      const matches = localTeams.filter(local => abbreviation(local.espn_abbr) && abbreviation(local.espn_abbr) === abbreviation(team?.abbreviation));
      if (matches.length !== 1 || !team?.id) throw new Error(`Correspondance équipe ambiguë ou absente : ${team?.abbreviation || '?'}`);
      rows.push({ season, team: matches[0].name, espn_team_id: String(team.id), conference, seed: value });
    }
    for (const child of node.children || []) walk(child, conference);
  }
  walk(data);
  return validateSeedRows(rows, season);
}

// Public progression consumes finalized rows only. Drafts never grant a bye.
export function seedSnapshot(rows, season) {
  if (!rows.length || rows.some(row => !row.finalized_at)) return undefined;
  validateSeedRows(rows, season);
  if (new Set(rows.map(row => row.finalized_at)).size !== 1) throw new Error('Finalisation incohérente');
  return { season, frozen: true, teams: rows.map(({ team, conference, seed }) => ({ team, conference, seed })) };
}

// Derived data only, no playoff_games inserts or fabricated event IDs.
export function wildCardSeeds(snapshot) {
  if (!snapshot?.frozen) return { byes: [], matchups: [] };
  return {
    byes: snapshot.teams.filter(row => row.seed === 1).map(row => ({ ...row, qualifiedForDivisional: true })),
    matchups: ['AFC', 'NFC'].flatMap(conference => [[2, 7], [3, 6], [4, 5]].map(([home, away]) => ({
      conference, home: snapshot.teams.find(row => row.conference === conference && row.seed === home),
      away: snapshot.teams.find(row => row.conference === conference && row.seed === away),
    }))),
  };
}
