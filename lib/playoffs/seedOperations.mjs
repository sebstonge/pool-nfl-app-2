import { fetchEspnStandings } from '../espnStandings.mjs';
import { extractEspnSeeds, validateSeedRows } from './seeds.mjs';

async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message, { cause: error });
  return data;
}
export async function readPlayoffSeeds(client, season) {
  return (await checked(client.from('playoff_seeds').select('*').eq('season', season).order('conference').order('seed'))) || [];
}
export async function syncPlayoffSeedsFromEspn(client, season, fetcher = fetch) {
  const existing = await readPlayoffSeeds(client, season);
  if (existing.some(row => row.finalized_at)) throw new Error('Snapshot déjà finalisé');
  const teams = await checked(client.from('teams').select('name, espn_abbr'));
  const data = await fetchEspnStandings({ season, fetcher, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const rows = extractEspnSeeds(data, season, teams || []);
  // DB RPC repeats validation and takes a season lock: a concurrent finalization
  // cannot be bypassed by the earlier read above.
  return checked(client.rpc('sync_playoff_seeds', { p_season: season, p_rows: rows }));
}
export async function finalizePlayoffSeeds(client, season, expectedCapturedAt, regularSeasonComplete) {
  if (regularSeasonComplete !== true || !expectedCapturedAt || !Number.isFinite(Date.parse(expectedCapturedAt))) throw new Error('Confirmation explicite de fin de saison et capture attendue requises');
  validateSeedRows(await readPlayoffSeeds(client, season), season);
  return checked(client.rpc('finalize_playoff_seeds', { p_season: season, p_expected_captured_at: expectedCapturedAt }));
}
