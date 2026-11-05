import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mapBounded } from '../../lib/regular-publication/espn.mjs';
import { cases } from './cases.mjs';
import { classifyArticle, resolveLatest } from './classify.mjs';
import { readRoster, readWeek, rotateClubs } from './espn.mjs';
import { collectArticles, TEAM_SOURCES } from './sources.mjs';

function articleKey(value) {
  const url = new URL(value);
  return url.hostname.replace(/^amp\./, 'www.') + url.pathname.replace(/\/$/, '');
}

function requiresRoster(article, team) {
  if (article.teamHint) return article.teamHint === team;
  const story = [article.title, ...article.paragraphs.slice(0, 5)].join(' ').toLowerCase();
  if (!/quarterback|\bqb\b|under center/.test(story)) return false;
  return TEAM_SOURCES[team].aliases.some(alias => story.includes(alias.toLowerCase()));
}

function summarizeBenchmark(bench, detections, discoveredUrls, rosters) {
  const read = new Map(detections.map(d => [articleKey(d.url), d]));
  const discovered = new Set(discoveredUrls.map(articleKey));
  return bench.map(item => {
    const result = read.get(articleKey(item.url));
    const expectedProposal = item.expectedStatus === 'proposed';
    const actualProposal = result?.status === 'proposed';
    const identityMatches = actualProposal &&
      String(result.espnAthleteId) === item.subject.id &&
      result.team === item.team &&
      result.match?.id === item.matchId;
    return {
      id: item.id, url: item.url, description: item.description,
      discovered: discovered.has(articleKey(item.url)),
      analyzed: Boolean(result && !result.contextError),
      expected: item.expectedStatus, status: result?.status || 'unavailable',
      reason: result?.reason || 'article_not_collected',
      detectedAthleteId: result?.espnAthleteId ?? null,
      expectedAthleteId: item.subject.id,
      rosterIdentity: rosters[item.team]?.find(player => player.id === item.subject.id) ?? null,
      falsePositive: actualProposal && (!expectedProposal || !identityMatches),
      falseNegative: expectedProposal && !identityMatches,
      statusMatches: result?.status === item.expectedStatus,
    };
  });
}

export async function runCollector({
  season, week, priorities = [], baseline = {}, benchmark = false, limit = 24, fetcher = fetch,
}) {
  const started = new Date().toISOString();
  const bench = benchmark ? cases.filter(item => item.season === season) : [];
  const byCaseUrl = new Map(bench.map(item => [articleKey(item.url), item]));
  const errors = [];
  let espnRequests = 0;
  const espnFetch = (value, options) => {
    espnRequests++;
    return fetcher(value, {
      ...options,
      redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': 'NFLPool-QB-Prototype/1.0' },
    });
  };

  const active = await readWeek(season, week, TEAM_SOURCES, espnFetch);
  const clubs = rotateClubs(active.games, started, priorities);
  const collected = await collectArticles({
    teams: clubs, urls: bench.map(item => item.url), limit, fetcher,
  });
  errors.push(...collected.errors);

  const weeks = new Map([[week, active]]);
  const archivedWeeks = [...new Set(bench.map(item => item.week))].filter(w => w !== week);
  await mapBounded(archivedWeeks, async archived => {
    try {
      weeks.set(archived, await readWeek(season, archived, TEAM_SOURCES, espnFetch));
    } catch (error) {
      errors.push({ week: archived, message: error.message });
    }
  }, 2);
  const participating = new Set(active.games.flatMap(game => game.teams));
  const rosterTeams = [...new Set([
    ...bench.map(item => item.team), ...clubs,
    ...[...participating].filter(team => collected.articles.some(article => requiresRoster(article, team))),
  ])].slice(0, 10);
  const rosters = {};
  await mapBounded(rosterTeams, async team => {
    try {
      rosters[team] = await readRoster(TEAM_SOURCES[team], season, new Date().toISOString(), espnFetch);
    } catch (error) {
      errors.push({ team, message: error.message });
    }
  }, 3);

  const asOf = new Date().toISOString();
  const previous = { ...baseline };
  for (const item of bench.filter(item => item.week === week)) previous[item.team] = item.baseline;
  const groups = new Map();
  const detections = [];
  for (const article of collected.articles) {
    const item = byCaseUrl.get(articleKey(article.url));
    const schedule = weeks.get(item?.week ?? week);
    if (!schedule) {
      detections.push({
        url: article.url, publishedAt: article.publishedAt, status: 'ambiguous',
        reason: 'calendar_unavailable', contextError: true,
      });
      continue;
    }
    const historical = Date.parse(asOf) >= Date.parse(schedule.firstKickoffAt) ||
      schedule.games.some(game => game.phase !== 'pre');
    // A present-day roster verifies an archived identity only. Today's injuries
    // cannot be replayed as if ESPN had reported them in the old week.
    const identities = historical ? Object.fromEntries(Object.entries(rosters).map(([team, rows]) =>
      [team, rows.map(({ id, name }) => ({ id, name }))])) : rosters;
    const context = {
      ...schedule, asOf, rosters: identities, teams: TEAM_SOURCES,
      previous: item && item.week !== week ? { [item.team]: item.baseline } : previous,
    };
    const result = classifyArticle(article, context);
    const detection = {
      ...result,
      season,
      week: schedule.week,
      title: article.title,
      historical,
      evidence: typeof result.evidence === 'string'
        ? result.evidence.trim().split(/\s+/).slice(0, 25).join(' ')
        : result.evidence,
    };
    detections.push(detection);
    if (!groups.has(schedule.week)) groups.set(schedule.week, { context, rows: [] });
    const group = groups.get(schedule.week);
    group.context.previous = { ...group.context.previous, ...context.previous };
    group.rows.push(detection);
  }

  const decisions = [...groups.values()].flatMap(({ rows, context }) => resolveLatest(rows, context));
  const eligible = decisions.filter(row => row.status === 'proposed');
  const current = eligible.filter(row => row.week === week && !row.historical);
  const labelled = bench.map(item => ({
    ...item,
    matchId: weeks.get(item.week)?.games.find(game => game.teams.includes(item.team))?.id,
  }));
  const evaluation = summarizeBenchmark(labelled, detections, collected.discoveredUrls, rosters);
  const counts = {
    discovered: collected.discoveredUrls.length,
    analyzed: detections.filter(row => !row.contextError).length,
    proposed: current.length,
    replayedProposals: eligible.length - current.length,
    ambiguous: decisions.filter(row => row.status === 'ambiguous').length,
    rejected: decisions.filter(row => row.status === 'rejected').length,
    sourceErrors: errors.length,
    falsePositives: evaluation.filter(row => row.falsePositive).length,
    falseNegatives: evaluation.filter(row => row.falseNegative).length,
  };
  const withTiming = row => ({
    ...row,
    firstKickoffAt: weeks.get(row.week).firstKickoffAt,
    hoursBetweenPublicationAndKickoff:
      (Date.parse(weeks.get(row.week).firstKickoffAt) - Date.parse(row.publishedAt)) / 3_600_000,
  });
  return {
    mode: 'read_only', season, week, observedAt: asOf, firstKickoffAt: active.firstKickoffAt,
    durationMs: Date.parse(asOf) - Date.parse(started),
    frozen: Date.parse(asOf) >= Date.parse(active.firstKickoffAt) || active.games.some(game => game.phase !== 'pre'),
    clubs, rosterTeams, httpRequests: { sources: collected.requests, espn: espnRequests },
    counts, errors, evaluation,
    proposals: current.map(withTiming),
    replayedProposals: eligible.filter(row => row.historical).map(withTiming),
    decisions, discoveredUrls: collected.discoveredUrls,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      season: { type: 'string' }, week: { type: 'string' }, team: { type: 'string', multiple: true },
      baseline: { type: 'string' }, benchmark: { type: 'boolean' }, limit: { type: 'string' },
    },
  });
  const season = Number(values.season ?? (values.benchmark ? 2026 : NaN));
  const week = Number(values.week ?? (values.benchmark ? 9 : NaN));
  const limit = Number(values.limit ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 32 ||
      (values.benchmark && (season !== 2026 || limit < cases.length))) {
    throw new Error('Use --limit 1..32. --benchmark requires season 2026 and room for every labelled article.');
  }
  const priorities = (values.team || (values.benchmark ? ['ARI', 'BAL', 'PHI', 'SEA'] : []))
    .map(team => team.toUpperCase());
  if (priorities.some(team => !Object.hasOwn(TEAM_SOURCES, team))) throw new Error('Unknown team abbreviation');
  const baseline = values.baseline ? JSON.parse(await readFile(values.baseline, 'utf8')) : {};
  for (const [team, qb] of Object.entries(baseline)) {
    if (!Object.hasOwn(TEAM_SOURCES, team) || !/^\d+$/.test(String(qb?.id)) ||
        typeof qb.name !== 'string' || !qb.name.trim() ||
        (qb.publishedAt && !Number.isFinite(Date.parse(qb.publishedAt)))) {
      throw new Error(`Invalid baseline for ${team}`);
    }
  }
  const report = await runCollector({ season, week, priorities, baseline, benchmark: values.benchmark, limit });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
