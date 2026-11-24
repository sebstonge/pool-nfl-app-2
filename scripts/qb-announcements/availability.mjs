import { collectNflverse, SCHEDULE_URL } from './nflverse.mjs';
import { emptySourceState, readSleeper, SLEEPER_URL, unavailable } from './sleeper.mjs';

const name = value => value?.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const sameIdentity = (player, qb, team) => player?.id === qb?.id && player.team === team && name(player.name) === name(qb.name);
const safeError = error => ({ message: String(error?.message || 'Source unavailable').slice(0, 300),
  ...(error?.url ? { url: error.url, status: error.status, retryAfter: error.retryAfter } : {}) });

// Observation is the only worker mode. It returns signed facts/diagnostics;
// only the separately gated database menu can apply an exclusion, never a QB promotion.
export async function collectFreeSources({ season, schedule, baseline, sourceState, openedAt, allowSleeperFetch = false, fetcher, now,
  projections = collectNflverse } ) {
  const state = sourceState ? structuredClone(sourceState) : emptySourceState(now());
  const errors = [];
  let projected = { decisions: [], errors: [] };
  try { projected = await projections({ season, schedule, baseline, fetcher, now }); }
  catch (error) { errors.push(safeError(error)); }
  errors.push(...projected.errors);
  let refreshed = false, previousPlayers = state.sleeper.players;
  try { ({ refreshed, previousPlayers } = await readSleeper(state, fetcher, now, allowSleeperFetch)); }
  catch (error) { errors.push(safeError(error)); }
  const fresh = state.sleeper.fetchedAt != null && now() - Date.parse(state.sleeper.fetchedAt) <= 36 * 3_600_000;
  const scoped = fresh && Date.parse(state.sleeper.fetchedAt) >= Date.parse(openedAt);
  if (!fresh) errors.push({ message: 'Sleeper missing or stale; no new availability inferred', url: 'https://api.sleeper.app/' });
  const decisions = [], diagnostics = [];
  for (const game of schedule.games) for (const [side, team] of game.teams.entries()) {
    const current = baseline[team];
    if (!current) { diagnostics.push({ team, action: 'review', reason: 'previous_unknown' }); continue; }
    const player = state.sleeper.players.find(row => sameIdentity(row, current, team));
    const oldPlayer = previousPlayers.find(row => sameIdentity(row, current, team));
    let blocked = state.absences.find(row => row.team === team);
    if (scoped && unavailable(player)) {
      let absence = state.absences.find(row => row.team === team && row.id === current.id);
      if (!absence) {
        absence = { id: current.id, name: current.name, team, since: state.sleeper.fetchedAt, reason: 'sleeper_unavailable' };
        state.absences.push(absence);
      } else if (refreshed && oldPlayer && !unavailable(oldPlayer)) {
        absence.since = state.sleeper.fetchedAt;
      }
      blocked = absence;
    }
    const projection = projected.decisions.find(row => row.team === team);
    const candidate = projection?.newQB;
    const candidatePlayer = candidate && state.sleeper.players.find(row => sameIdentity(row, candidate, team));
    let reason, proposed = null, action = 'retain', url = SLEEPER_URL;
    if (blocked) {
      action = 'exclude';
      reason = scoped && unavailable(player) && blocked.id === current.id ? 'sleeper_unavailable' : 'sleeper_return_review';
      if (candidate && fresh && candidatePlayer && !unavailable(candidatePlayer)) proposed = candidate;
      if (candidate && fresh && candidatePlayer && unavailable(candidatePlayer)) reason = 'source_conflict';
    } else if (projection) {
      action = 'review'; url = SCHEDULE_URL;
      reason = fresh && candidatePlayer ? (unavailable(candidatePlayer) ? 'source_conflict' : 'nflverse_projection') : 'source_missing';
      if (fresh && candidatePlayer && !unavailable(candidatePlayer)) proposed = candidate;
    } else if (fresh && unavailable(player) && !scoped) {
      action = 'review'; reason = 'source_missing';
    } else if (fresh && !player) {
      diagnostics.push({ team, action: 'retain', reason: 'source_missing' }); continue;
    }
    diagnostics.push({ team, action, reason: reason ?? (fresh ? 'unchanged' : 'source_missing') });
    if (!reason) continue;
    const evidence = reason === 'sleeper_unavailable'
      ? `${current.name}: indisponibilité déclarée par Sleeper, observée ${state.sleeper.fetchedAt}. Aucun titulaire remplaçant confirmé.`
      : reason === 'sleeper_return_review'
        ? 'Absence antérieure conservée. Un statut Active ou la disparition de Out ne confirme ni le retour ni le titulaire; validation Admin requise.'
        : 'Projection ou identité incertaine; aucune promotion automatique. Vérifier une confirmation liée à ce match.';
    decisions.push({ team, match: { id: game.id, opponent: game.teams[1 - side], kickoffAt: game.kickoffAt },
      previousQB: current, newQB: proposed, espnAthleteId: proposed?.id ?? null, url,
      status: 'ambiguous', reason, evidence });
  }
  state.observedAt = new Date(now()).toISOString();
  state.signals = diagnostics.map(row => ({ team: row.team, key: `${row.action}:${row.reason}` }));
  // No full article or provider payload is retained. The normalized daily cache
  // and sticky absences survive cold starts and changes of week in private runs.
  return { decisions, errors, sourceState: state,
    counts: { analyzed: schedule.games.length, retained: diagnostics.filter(row => row.action === 'retain').length,
      excluded: diagnostics.filter(row => row.action === 'exclude').length,
      ambiguous: decisions.length, sourceErrors: errors.length } };
}
