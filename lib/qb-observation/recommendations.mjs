import { SLEEPER_URL, unavailable } from '../../scripts/qb-announcements/sleeper.mjs';

const NFLVERSE_SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/tag/schedules';
const HOUR = 3_600_000;
const reasonPriority = {
  source_conflict: 0,
  sleeper_unavailable: 1,
  sleeper_return_review: 2,
  nflverse_projection: 3,
  source_missing: 4,
};

const normalizedName = value => typeof value === 'string'
  ? value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
  : '';
const numericId = value => typeof value === 'string' && /^\d{1,18}$/.test(value);
const isQbIdentity = qb => numericId(qb?.id) && Boolean(normalizedName(qb.name));
const sameName = (left, right) => Boolean(normalizedName(left)) && normalizedName(left) === normalizedName(right);
const identity = qb => ({ id: qb.id, name: qb.name });

function currentObservation(entry, run, now) {
  if (entry.currentSignal !== true || entry.dismissedAt != null || !run || run.status !== 'completed' ||
      !Object.hasOwn(reasonPriority, entry.reason) || !entry.entryId || !isQbIdentity(entry.previousQB) ||
      !numericId(entry.match?.id) || !/^[A-Z]{2,3}$/.test(entry.team ?? '') ||
      entry.season !== run.season || entry.week !== run.week || entry.revision !== run.revision) return null;

  const opened = Date.parse(run.openedAt);
  const observed = Date.parse(run.observedAt);
  const freeze = Date.parse(run.firstKickoffAt);
  const kickoff = Date.parse(entry.match.kickoffAt);
  const expires = Math.min(observed + 3 * HOUR, freeze);
  if (!(opened <= observed && observed <= now && now < expires && freeze <= kickoff)) return null;

  const sleeper = run.sourceState?.sleeper;
  const fetched = Date.parse(sleeper?.fetchedAt);
  const validSleeper = fetched <= observed && fetched <= now && now - fetched <= 36 * HOUR &&
    Array.isArray(sleeper?.players);
  const player = qb => validSleeper
    ? sleeper.players.find(row => row.id === qb.id && row.team === entry.team && sameName(row.name, qb.name))
    : null;
  const currentPlayer = fetched >= opened ? player(entry.previousQB) : null;
  const newQb = entry.newQB;
  const candidatePlayer = isQbIdentity(newQb) && entry.espnAthleteId === newQb.id && newQb.id !== entry.previousQB.id
    ? player(newQb)
    : null;

  return {
    entry,
    observed,
    expires,
    currentPlayer,
    candidate: candidatePlayer && !unavailable(candidatePlayer) &&
      !['source_conflict', 'source_missing'].includes(entry.reason)
      ? identity(newQb)
      : null,
    sleeperFetchedAt: validSleeper ? sleeper.fetchedAt : null,
  };
}

function describe({ reason, currentStatus, candidates, changedInMenu, signalCandidate }) {
  if (changedInMenu) return {
    confidence: 'uncertain', action: 'verifySources', recommendedQb: null,
    justification: 'L’affectation affichée dans le menu a changé depuis le relevé. Vérifier la situation actuelle avant de décider.',
  };
  if (reason === 'source_conflict' || candidates.length > 1) return {
    confidence: 'contradictory', action: 'verifySources', recommendedQb: null,
    justification: 'Le calendrier, le statut de disponibilité ou les identités signalées se contredisent. Une annonce liée à ce match est nécessaire.',
  };
  if (reason === 'sleeper_unavailable' && currentStatus === 'unavailable') {
    if (candidates.length === 1 && signalCandidate?.id === candidates[0].id) return {
      confidence: 'probable', action: 'reviewReplacement', recommendedQb: candidates[0],
      justification: 'Sleeper signale le QB actuel indisponible. Le calendrier nflverse indique un autre QB dont l’identité et l’équipe concordent avec Sleeper. Vérifier sa titularisation pour ce match.',
    };
    if (candidates.length > 0) return {
      confidence: 'uncertain', action: 'verifySources', recommendedQb: null,
      justification: 'L’absence et le remplaçant potentiel proviennent de signaux distincts. Vérifier la situation pour ce match.',
    };
    return {
      confidence: 'uncertain', action: 'reviewExclusion', recommendedQb: null,
      justification: 'Sleeper signale le QB actuel indisponible. Les sources disponibles n’identifient aucun remplaçant suffisamment étayé pour ce match.',
    };
  }
  if (reason === 'sleeper_return_review') return {
    confidence: 'uncertain', action: 'reviewReturn', recommendedQb: null,
    justification: 'L’observateur conserve une absence antérieure. Vérifier le retour et le rôle du QB pour ce match avant une réintégration.',
  };
  if (reason === 'nflverse_projection' && candidates.length === 1) return {
    confidence: 'probable', action: 'verifySources', recommendedQb: null,
    justification: 'Le calendrier nflverse indique un autre QB dont l’identité et l’équipe concordent avec Sleeper. Vérifier une annonce pour ce match avant un changement.',
  };
  return {
    confidence: 'uncertain', action: 'verifySources', recommendedQb: null,
    justification: 'Il manque un relevé récent ou une concordance fiable entre joueur, équipe et match. Vérifier les sources avant de décider.',
  };
}

function sourcesFor(observation, candidates) {
  const sources = [];
  if (observation.entry.reason === 'nflverse_projection' || observation.entry.reason === 'source_conflict' ||
      observation.entry.url === 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz' ||
      candidates.length > 0) {
    sources.push({ label: 'nflverse', url: NFLVERSE_SCHEDULE_URL, note: 'Calendrier NFL et QB indiqué pour le match.' });
  }
  sources.push({
    label: 'Sleeper', url: SLEEPER_URL, observedAt: observation.sleeperFetchedAt,
    note: observation.sleeperFetchedAt
      ? 'Identités et statuts de disponibilité déclarés.'
      : 'Aucun relevé d’identité et de disponibilité exploitable dans ce passage.',
  });
  return sources;
}

/** Read-only view over the signed report and the current Admin menu context. */
export function buildQbRecommendations(journal, { menu, now = Date.now() } = {}) {
  if (menu?.canCheck === false) return [];
  const groups = new Map();
  const runs = new Map((journal?.runs ?? []).map(run => [run.runId, run]));
  for (const entry of journal?.entries ?? []) {
    if (menu && (menu.season !== entry.season || menu.week !== entry.week)) continue;
    const observation = currentObservation(entry, runs.get(entry.runId), now);
    if (!observation) continue;
    const key = `${entry.season}:${entry.week}:${entry.team}:${entry.match.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(observation);
  }

  return Array.from(groups, ([id, observations]) => {
    observations.sort((left, right) => right.observed - left.observed ||
      reasonPriority[left.entry.reason] - reasonPriority[right.entry.reason] ||
      left.entry.entryId.localeCompare(right.entry.entryId));
    const primary = observations[0];
    const { entry, currentPlayer } = primary;
    const latest = observations.filter(observation => observation.observed === primary.observed);
    const candidates = Array.from(new Map(latest.filter(observation => observation.candidate)
      .map(observation => [observation.candidate.id, observation.candidate])).values());
    const teamMenu = menu?.teams?.find(team => team.abbr === entry.team);
    const changedInMenu = Boolean(teamMenu?.qbName && (
      !sameName(teamMenu.qbName, entry.previousQB.name) ||
      (teamMenu.qbEspnId != null && String(teamMenu.qbEspnId) !== entry.previousQB.id)
    ));
    const reserved = typeof teamMenu?.reserved === 'boolean' ? teamMenu.reserved : null;
    const statuses = [currentPlayer?.injuryStatus, currentPlayer?.status];
    const reportedStatus = changedInMenu ? null
      : statuses.find(status => unavailable({ status })) ?? statuses.find(Boolean) ?? null;
    const currentStatus = changedInMenu ? 'unknown'
      : unavailable(currentPlayer) ? 'unavailable'
      : reportedStatus ? 'reported'
      : 'unknown';
    const reason = new Set(latest.map(({ entry: row }) => row.previousQB.id)).size > 1 || candidates.length > 1
      ? 'source_conflict'
      : entry.reason;
    const shownCandidates = changedInMenu ? [] : candidates;
    const description = describe({
      reason, currentStatus, candidates: shownCandidates, changedInMenu, signalCandidate: primary.candidate,
    });
    const menuFreeze = Date.parse(menu?.firstKickoffAt);
    const expires = Number.isFinite(menuFreeze) ? Math.min(primary.expires, menuFreeze) : primary.expires;
    if (now >= expires) return null;

    return {
      id, entryId: entry.entryId, runId: entry.runId, team: entry.team, teamName: teamMenu?.name ?? null,
      season: entry.season, week: entry.week, match: entry.match,
      observedAt: new Date(primary.observed).toISOString(), expiresAt: new Date(expires).toISOString(),
      currentQb: changedInMenu ? { id: null, name: teamMenu.qbName } : identity(entry.previousQB),
      currentQbVerified: Boolean(teamMenu?.qbName),
      changedSinceObservation: changedInMenu,
      potentialQb: reason !== 'source_conflict' && shownCandidates.length === 1 &&
        primary.candidate?.id === shownCandidates[0].id ? primary.candidate : null,
      noCurrentOffer: Boolean(teamMenu && !teamMenu.qbName),
      currentStatus, reportedStatus, candidates: shownCandidates,
      sources: sourcesFor(primary, candidates), reason, reservation: reserved,
      teamInMenu: Array.isArray(menu?.teams) ? Boolean(teamMenu) : null,
      ...description,
    };
  }).filter(Boolean).sort((left, right) => reasonPriority[left.reason] - reasonPriority[right.reason] ||
    left.team.localeCompare(right.team));
}
