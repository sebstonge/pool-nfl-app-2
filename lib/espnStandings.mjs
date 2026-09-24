// Shared by the existing division importer and the backend playoff snapshot.
export const ESPN_STANDINGS_URL = 'https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=0&level=3';

export async function fetchEspnStandings({ season, fetcher = fetch, signal, cache } = {}) {
  if (season !== undefined && (!Number.isInteger(season) || season < 2000 || season > 9999)) throw new Error('Saison invalide');
  const url = season === undefined ? ESPN_STANDINGS_URL : `${ESPN_STANDINGS_URL}&season=${season}`;
  const response = await fetcher(url, { signal, ...(cache ? { cache } : {}) });
  if (!response.ok) throw new Error(`Standings ESPN : ${response.status}`);
  const data = await response.json();
  if (season !== undefined && data?.season?.year !== season) throw new Error('ESPN a retourné une autre saison');
  return data;
}
