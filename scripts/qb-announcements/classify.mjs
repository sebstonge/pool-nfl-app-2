const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SENTENCES = new Intl.Segmenter('en', { granularity: 'sentence' });
const GAME_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Toronto',
  weekday: 'long',
});

const SUFFIX = /^(?:jr|sr|ii|iii|iv|v)$/;
const INELIGIBLE = /\b(?:inactive|out|injured reserve|reserve|ir|pup|nfi|injured|suspended|doubtful|questionable|practice squad|waived|released|retired|exempt)\b/;
const STARTER_CUE = /\b(?:start(?:s|ed|ing|er)?|under center)\b/;
const QUALIFIED = /\b(?:if|whether|unless|assuming|provided that|depending|pending|barring|expected|projected|likely|possibly|could|may|might|plan(?:s|ned)? (?:is|was|to|for)|hope(?:s|d)? to|would start|not (?:yet |necessarily )?(?:start|be|name|announce|confirm|say)|won't|will not|hasn't|has not|didn't say)\b/;
const QUALIFIED_START = /^(?:, who [^,]+,)? (?:(?:is |was |has been )?(?:expected|projected|likely) to start|to start|(?:would|could|may|might) (?:start|be under center))\b/;
const DENIED_START = /^ (?:will not|won't) (?:start|play|be under center)\b/;
const CONTINGENT = /^(?:that|the decision|his availability) (?:depends|assumes|is contingent|is conditional)\b/;
const COACH_REPORT = /\b(?:[Hh]ead [Cc]oach|[Ii]nterim [Cc]oach|[Cc]oach) [A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){1,3} (?:said|told|confirmed|announced|declared|revealed|named)\b|\b(?:[Aa]ccording to|[Pp]er) (?:[Hh]ead [Cc]oach|[Ii]nterim [Cc]oach|[Cc]oach) [A-Z][A-Za-z.'-]+ [A-Z][A-Za-z.'-]+/;
const REPORTED = /\b(?:(?:league|team|nfl|anonymous) sources?|per (?:a )?sources?|according to (?:a )?sources?|reported)\b/;
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const FIXTURE_DAY = new RegExp(
  `\\b(?:this|next|last) (${WEEKDAY})\\b|\\b(${WEEKDAY})(?:'s)? (?:game|matchup|night|afternoon|against|at|when)\\b`,
  'g',
);

function normalize(value, keepCase = false) {
  const text = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\b(?:[a-z]\.){2,}/gi, initials => initials.replace(/\./g, ''))
    .replace(/\b(jr|sr)\./gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return keepCase ? text : text.toLowerCase();
}

const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const teamNames = team => [...new Set([team?.name, ...(team?.aliases ?? [])]
  .map(alias => normalize(alias)).filter(Boolean))].map(escaped).join('|');

function identity(player) {
  const id = String(player?.id ?? '').trim();
  const name = String(player?.name ?? '').trim();
  return id && name ? { id, name } : null;
}

function sourceTeam(article, teams) {
  try {
    const url = new URL(article.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (article.teamHint) {
      const team = teams[article.teamHint];
      if (!team || (team.origin && new URL(team.origin).origin !== url.origin)) return null;
      return article.teamHint;
    }
    if (url.hostname === 'www.nfl.com' || url.hostname === 'nfl.com') return 'NFL';
  } catch {
    return null;
  }
  return null;
}

function fixturesFor(context, club) {
  return Object.entries(context.rosters ?? {}).flatMap(([team, roster]) => {
    if (club !== 'NFL' && team !== club) return [];
    const games = (context.games ?? []).filter(game => game.teams?.length === 2 && game.teams.includes(team));
    const [game] = games;
    const opponent = game?.teams.find(code => code !== team);
    const match = games.length === 1 && game.id != null && opponent
      ? { id: game.id, opponent, kickoffAt: game.kickoffAt }
      : null;
    return roster.flatMap(player => {
      const qb = identity(player);
      if (!qb) return [];
      const fullName = normalize(qb.name);
      const parts = fullName.split(' ');
      const suffix = SUFFIX.test(parts.at(-1)) ? parts.pop() : null;
      const surname = parts.at(-1);
      const aliases = [...new Set([fullName, parts.join(' '), suffix && `${surname} ${suffix}`, surname].filter(Boolean))];
      return [{ team, qb, match, aliases, ineligible: INELIGIBLE.test(normalize(`${player.status ?? ''} ${player.availability ?? ''}`)) }];
    });
  });
}

function starterPattern(name, clubNames) {
  const alias = `(?<![a-z'-])${escaped(name)}(?![a-z'-])`;
  const owner = clubNames ? `(?:the (?:${clubNames})(?:'s|')? |the |our |their )` : '(?:the |our |their )';
  const role = `(?:${owner})?(?:starting (?:quarterback|qb)|starter)`;
  const when = `(?:(?:this|on|last|next) )?${WEEKDAY}|in (?:the )?(?:(?:team|${clubNames || '(?!)'})'s? |their )?week \\d+`;
  const start = `(?:start(?= (?:at quarterback|under center|the game|the matchup|against|versus|vs\\.?|again|for (?:the )?(?:${clubNames || '(?!)'})|${when})\\b|[,.!"”]|$)|be ${role}|be (?:back )?under center)`;
  const named = '(?:named|naming|announced|confirmed|declared)';
  return new RegExp(
    `${alias} (?:(?:has been cleared to play and )?will ${start}|(?:has been|was|is) ${named} (?:as )?${role}|is (?:now )?${owner}(?:starting (?:quarterback|qb)|starter)|is starting (?:at quarterback|under center))\\b`
    + `|\\b${named} ${alias} (?:as ${role}|${owner}starting (?:quarterback|qb))\\b`
    + `|\\b(?:will start|are starting) (?:quarterback )?${alias}(?= (?:at quarterback|under center|against|versus|vs\\.|vs |this ${WEEKDAY}|on ${WEEKDAY})|[,."!?]|$)`,
  );
}

function mentionsIn(cased, players, teams, confirmed) {
  const body = cased.toLowerCase();
  const matches = players.flatMap(player => player.aliases.flatMap(alias => {
    const pattern = confirmed ? starterPattern(alias, teamNames(teams[player.team]))
      : new RegExp(`(?<![a-z'-])${escaped(alias)}(?![a-z'-])`);
    const match = pattern.exec(body);
    if (!match) return [];
    const start = match.index + match[0].indexOf(alias);
    return [{ player, alias, start, end: start + alias.length }];
  }));
  return matches.filter(mention => {
    const covered = matches.some(other => other.start <= mention.start
      && other.end >= mention.end && other.alias.length > mention.alias.length);
    const previousWord = cased.slice(0, mention.start).match(/\b([A-Z][A-Za-z.'-]+) $/)?.[1];
    const unknownName = !mention.alias.includes(' ') && previousWord
      && !/^(?:QB|Quarterback|Start|Starter|Named|Naming|Confirmed|Announced|For|And)$/.test(previousWord);
    return !covered && !unknownName;
  });
}

function opponentPattern(opponent) {
  const names = teamNames(opponent);
  if (!names) return null;
  return new RegExp(
    `\\b(?:against|versus|vs\\.?|at|host(?:s|ing)?|fac(?:e|es|ing)|play(?:s|ing)?) (?:in )?(?:the )?(?:${names})(?![a-z'-])`
    + `|\\b(?:${names})(?![a-z'-]) (?:come(?:s)? to|visit(?:s)?|travel(?:s)? to)\\b`,
  );
}

function checkFixture(body, match, context, opponentPatterns) {
  if (!match || !Number.isFinite(timestamp(match.kickoffAt))) return 'fixture_unconfirmed';
  const opponents = [...opponentPatterns].filter(([, pattern]) => pattern?.test(body)).map(([team]) => team);
  const weeks = [...body.matchAll(/\bweek\s+(\d{1,2})\b/g)];
  const seasons = [...body.matchAll(/\b(20\d\d) (?:nfl )?(?:regular )?season\b/g)];
  const days = [...body.matchAll(FIXTURE_DAY)].map(day => day[1] ?? day[2]);
  const day = GAME_DAY.format(new Date(match.kickoffAt)).toLowerCase();
  if (opponents.some(team => team !== match.opponent)
    || weeks.some(week => Number(week[1]) !== Number(context.week))
    || seasons.some(season => Number(season[1]) !== Number(context.season))
    || days.some(namedDay => namedDay !== day)
    || /\b(?:last (?:week|time|game|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next week|a week (?:ago|from)|two weeks (?:ago|from))\b/.test(body)) {
    return 'fixture_mismatch';
  }
  return opponents.includes(match.opponent) ? null : 'fixture_unconfirmed';
}

function fixtureAnchor(sentences, index, player, context, opponentPatterns, body) {
  const adjacent = [sentences[index - 1], sentences[index + 1]].find(sentence => sentence
    && /\b(?:career start|start(?:s|ing)? (?:at quarterback|against)|under center)\b/.test(sentence.body)
    && mentionsIn(sentence.cased, [player], context.teams ?? {}, false).length
    && checkFixture(sentence.body, player.match, context, opponentPatterns) === null);
  if (adjacent) return adjacent.evidence;

  // A club's explicit current depth chart can be scoped by its own stated next opponent.
  if (!/\bis now\b/.test(body)) return null;
  const clubNames = teamNames(context.teams?.[player.team]);
  if (!clubNames) return null;
  const nextGame = new RegExp(`^the (?:${clubNames}) next (?:play|face|host|visit) `);
  const anchors = sentences.filter(sentence => nextGame.test(sentence.body));
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  const nextFixture = anchor.body.split(/, followed by\b/)[0];
  return checkFixture(nextFixture, player.match, context, opponentPatterns) === null ? anchor.evidence : null;
}

function replacementAnchor(previous, claim, player, context, opponentPatterns) {
  if (!previous || !/\bto start in (?:his|their) place\b/.test(claim)) return null;
  const incumbent = identity(context.previous?.[player.team]);
  if (!incumbent || !previous.body.includes(normalize(incumbent.name))
    || !/\b(?:without|will not play|ruled out|out for)\b/.test(previous.body)) return null;
  return checkFixture(previous.body, player.match, context, opponentPatterns) === null ? previous.evidence : null;
}

function findAnnouncements(article, context, club) {
  const players = fixturesFor(context, club);
  const teams = context.teams ?? {};
  const opponentPatterns = new Map(Object.entries(teams).map(([code, team]) => [code, opponentPattern(team)]));
  const sentences = (article.paragraphs ?? []).flatMap(text =>
    typeof text === 'string' ? [...SENTENCES.segment(text)].map(({ segment }) => {
      const evidence = segment.trim();
      const cased = normalize(evidence, true);
      return { evidence, cased, body: cased.toLowerCase() };
    }) : [],
  );
  const findings = [];
  for (const [index, { evidence, body, cased }] of sentences.entries()) {
    if (!STARTER_CUE.test(body) && !/\b(?:will not|won't) play\b/.test(body)) continue;
    const positive = mentionsIn(cased, players, teams, true);
    const qualified = QUALIFIED.test(body) || /\?["”]?$/.test(body)
      || CONTINGENT.test(sentences[index + 1]?.body ?? '');
    if (!positive.length && !qualified) continue;
    const mentions = positive.length ? positive : mentionsIn(cased, players, teams, false)
      .filter(({ end }) => QUALIFIED_START.test(body.slice(end)) || DENIED_START.test(body.slice(end)));
    for (const { player, alias, start, end } of mentions) {
      const claim = positive.length ? body : body.slice(start);
      const denied = !positive.length && DENIED_START.test(body.slice(end));
      let fixtureReason = checkFixture(claim, player.match, context, opponentPatterns);
      let anchor = null;
      if (club !== 'NFL' && fixtureReason === 'fixture_unconfirmed') {
        anchor = positive.length
          ? fixtureAnchor(sentences, index, player, context, opponentPatterns, body)
          : replacementAnchor(sentences[index - 1], claim, player, context, opponentPatterns);
      }
      if (anchor) fixtureReason = null;
      const reason = fixtureReason
        ?? (REPORTED.test(body) || (club === 'NFL' && !COACH_REPORT.test(cased)) ? 'unattributed_report' : null)
        ?? (denied ? 'starter_denied' : null)
        ?? (qualified ? 'qualified_announcement' : null)
        ?? (player.ineligible ? 'qb_ineligible' : null);
      findings.push({ ...player, alias, evidence: anchor ? `${evidence}\n${anchor}` : evidence, reason });
    }
  }
  if (findings.length) return findings;
  for (const { cased, body, evidence } of sentences) {
    if (!/^(?:qb|quarterback) |\b(?:practic(?:e|ed|ing)|injury report|full participant|listed (?:as )?(?:active|available))\b/.test(body)) continue;
    for (const { player, alias } of mentionsIn(cased, players, teams, false)) {
      findings.push({ ...player, alias, evidence, reason: 'no_starter_announcement' });
    }
  }
  return findings;
}

function pickFinding(findings) {
  const scoped = findings.filter(finding => !['fixture_mismatch', 'fixture_unconfirmed'].includes(finding.reason));
  const confirmed = scoped.filter(finding => !finding.reason || finding.reason === 'qb_ineligible');
  const contradicted = confirmed.find(finding => scoped.some(other => other.reason === 'starter_denied'
    && other.team === finding.team && other.qb.id === finding.qb.id));
  if (contradicted) return { reason: 'contradictory_article', finding: contradicted };
  const pool = confirmed.length ? confirmed : scoped.length ? scoped : findings;
  const byIdentity = new Map();
  for (const finding of pool) {
    const key = `${finding.team}:${finding.qb.id}`;
    const existing = byIdentity.get(key);
    if (!existing || (existing.reason && !finding.reason)) byIdentity.set(key, finding);
  }
  if (byIdentity.size > 1) {
    const [first] = confirmed;
    const sameGame = first && confirmed.every(finding => finding.team === first.team && finding.match?.id === first.match?.id);
    return { reason: 'multiple_candidates', finding: null, scope: sameGame ? first : null };
  }
  const [finding] = byIdentity.values();
  return { reason: finding?.reason ?? null, finding };
}

function timingReason(article, context, match, prior) {
  const publication = timestamp(article.publishedAt);
  const updated = timestamp(article.updatedAt);
  const asOf = timestamp(context.asOf);
  const firstKickoff = timestamp(context.firstKickoffAt);
  const kickoff = match ? timestamp(match.kickoffAt) : firstKickoff;
  const freshSince = context.freshSince == null ? firstKickoff - WEEK_MS : timestamp(context.freshSince);
  const priorPublication = timestamp(prior?.publishedAt);
  if (![asOf, firstKickoff, kickoff, freshSince].every(Number.isFinite)) return 'invalid_run_window';
  if (!Number.isFinite(publication)) return 'missing_publication';
  if (publication > asOf) return 'future_publication';
  if (publication >= Math.min(firstKickoff, kickoff)) return 'late_publication';
  if (publication < freshSince) return 'stale_article';
  if (article.updatedAt != null && (!Number.isFinite(updated) || updated < publication)) return 'invalid_update';
  if (updated > asOf) return 'future_update';
  if (updated >= Math.min(firstKickoff, kickoff)) return 'late_update';
  if (publication < priorPublication) return 'older_than_previous';
  return null;
}

export function classifyArticle(article, context) {
  const club = sourceTeam(article, context.teams ?? {});
  const findings = club ? findAnnouncements(article, context, club) : [];
  const { reason, finding, scope } = pickFinding(findings);
  const team = (finding ?? scope)?.team ?? (club !== 'NFL' ? club : null);
  const prior = team ? context.previous?.[team] : null;
  const previousQB = identity(prior);
  const newQB = finding?.qb ?? null;
  const match = (finding ?? scope)?.match ?? null;
  const result = {
    previousQB,
    newQB,
    team,
    match,
    espnAthleteId: newQB?.id ?? null,
    publishedAt: article.publishedAt ?? null,
    url: article.url ?? null,
    evidence: (finding ?? scope)?.evidence ?? null,
  };
  const rejected = !club ? 'untrusted_source' : timingReason(article, context, match, prior);
  if (rejected) return { ...result, status: 'rejected', reason: rejected };
  if (!finding && !reason) return { ...result, status: 'rejected', reason: 'no_starter_announcement' };
  if (reason === 'fixture_mismatch' || reason === 'no_starter_announcement') {
    return { ...result, status: 'rejected', reason };
  }
  if (reason) return { ...result, status: 'ambiguous', reason };
  if (!previousQB) return { ...result, status: 'ambiguous', reason: 'previous_unknown' };
  if (newQB.id === previousQB.id) return { ...result, status: 'rejected', reason: 'same_qb' };
  if (timestamp(article.publishedAt) === timestamp(prior.publishedAt)) {
    return { ...result, status: 'ambiguous', reason: 'conflicting_announcements' };
  }
  return { ...result, status: 'proposed', reason: 'starter_confirmed' };
}

export function resolveLatest(results, context) {
  const output = results.slice();
  const groups = new Map();
  for (const [index, result] of results.entries()) {
    const isScoped = result.status === 'proposed'
      || ['same_qb', 'qualified_announcement', 'qb_ineligible', 'conflicting_announcements',
        'multiple_candidates', 'starter_denied', 'contradictory_article'].includes(result.reason);
    const published = timestamp(result.publishedAt);
    if (!isScoped || !result.team || !result.match || !Number.isFinite(published)) continue;
    const prior = context.previous?.[result.team];
    if (published < timestamp(prior?.publishedAt)) {
      output[index] = { ...result, status: 'rejected', reason: 'older_than_previous' };
      continue;
    }
    const atPrior = published === timestamp(prior?.publishedAt);
    const conflictsWithPrior = atPrior && result.status === 'proposed'
      && String(prior.id) !== result.espnAthleteId;
    const signal = conflictsWithPrior ? { ...result, status: 'ambiguous', reason: 'conflicting_announcements' } : result;
    output[index] = signal;
    const key = `${result.team}:${result.match.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, result: signal, published });
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.published - a.published || String(a.result.url).localeCompare(String(b.result.url)));
    const [latest] = group;
    const tied = group.filter(item => item.published === latest.published);
    const conflict = new Set(tied.map(item => item.result.espnAthleteId)).size > 1
      || (tied.some(item => item.result.status === 'ambiguous') && tied.some(item => item.result.status === 'proposed'));
    for (const item of group) {
      const { result, index, published } = item;
      if (conflict && published === latest.published) {
        output[index] = { ...result, status: 'ambiguous', reason: 'conflicting_announcements' };
      } else if (item !== latest && result.status === 'proposed') {
        const reason = latest.result.status !== 'ambiguous' && result.espnAthleteId === latest.result.espnAthleteId
          ? 'duplicate_evidence' : 'superseded';
        output[index] = { ...result, status: 'rejected', reason };
      }
    }
  }
  return output;
}
