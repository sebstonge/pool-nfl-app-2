const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_TEAM_REF = /^https?:\/\/sports\.core\.api\.espn\.(?:com|pvt)\/v2\/sports\/football\/leagues\/nfl\/seasons\/(\d{4})\/teams\/(\d+)(?:\?.*)?$/;

export function qbTeamCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return ({ WSH: 'WAS', LA: 'LAR' })[code] ?? code;
}

export function qbNameKey(value) {
  return typeof value === 'string'
    ? value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

export function isEspnAthleteId(id) {
  return typeof id === 'string' && /^[1-9]\d{0,17}$/.test(id);
}

export async function findEspnQbs(team, name, fetcher = fetch) {
  const nameKey = qbNameKey(name);
  if (!/^[A-Z]{2,3}$/.test(team) || !nameKey) throw new Error('Recherche QB invalide');
  const providerCode = team === 'WAS' ? 'wsh' : team.toLowerCase();
  const response = await fetcher(`${ESPN_NFL}/teams/${providerCode}/roster`, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Effectif ESPN indisponible');
  const roster = await response.json();
  if (roster?.status !== 'success' || !Array.isArray(roster.athletes) || !roster.athletes.length ||
      qbTeamCode(roster.team?.abbreviation) !== team || !isEspnAthleteId(roster.team?.id) ||
      !Number.isInteger(roster.season?.year) || typeof roster.team.name !== 'string' ||
      typeof roster.team.displayName !== 'string' ||
      !roster.athletes.every(group => Array.isArray(group?.items))) {
    throw new Error('Effectif ESPN incohérent');
  }
  const byId = new Map();
  const conflictingIds = new Set();
  for (const athlete of roster.athletes.flatMap(group => group.items)) {
    if (!isEspnAthleteId(athlete?.id)) continue;
    if (qbNameKey(athlete.fullName) !== nameKey || athlete.position?.abbreviation !== 'QB') {
      conflictingIds.add(athlete.id);
      continue;
    }
    if (athlete.teams != null && (!Array.isArray(athlete.teams) || !athlete.teams.every(item => {
      const match = item?.$ref?.match?.(ESPN_TEAM_REF);
      return match?.[1] === String(roster.season.year) && match[2] === roster.team.id;
    }))) {
      conflictingIds.add(athlete.id);
      continue;
    }
    const fullName = athlete.fullName.trim();
    if (!fullName || fullName.length > 120) continue;
    if (byId.has(athlete.id) && byId.get(athlete.id).name !== fullName) {
      conflictingIds.add(athlete.id);
      continue;
    }
    byId.set(athlete.id, { id: athlete.id, name: fullName, team, position: 'QB' });
  }
  return [...byId.values()].filter(qb => !conflictingIds.has(qb.id));
}
