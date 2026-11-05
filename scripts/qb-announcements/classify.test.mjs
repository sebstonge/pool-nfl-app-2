import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyArticle, resolveLatest } from './classify.mjs';

const firstKickoffAt = '2026-11-06T01:15:00Z';
const sunday = '2026-11-08T21:25:00Z';
const teams = {
  WAS: { name: 'Washington Commanders', aliases: ['Commanders'], origin: 'https://www.commanders.com' },
  SEA: { name: 'Seattle Seahawks', aliases: ['Seattle', 'Seahawks'], origin: 'https://www.seahawks.com' },
  ARI: { name: 'Arizona Cardinals', aliases: ['Arizona', 'Cardinals'], origin: 'https://www.azcardinals.com' },
  BAL: { name: 'Baltimore Ravens', aliases: ['Ravens'], origin: 'https://www.baltimoreravens.com' },
  JAX: { name: 'Jacksonville Jaguars', aliases: ['Jacksonville', 'Jaguars'] },
  PHI: { name: 'Philadelphia Eagles', aliases: ['Eagles'] },
  NYG: { name: 'New York Giants', aliases: ['Giants'] },
  LAR: { name: 'Los Angeles Rams', aliases: ['Rams'] },
  CHI: { name: 'Chicago Bears', aliases: ['Bears'] },
};
const player = (id, name, availability = null) => ({ id, name, status: 'Active', availability });
const daniels = player('1', 'Jayden Daniels');
const mariota = player('2', 'Marcus Mariota');
const hartman = player('3', 'Sam Hartman');
const brissett = player('4', 'Jacoby Brissett');
const minshew = player('5', 'Gardner Minshew II');
const jackson = player('6', 'Lamar Jackson');
const fagnano = player('7', 'Joe Fagnano');
const huntley = player('8', 'Tyler Huntley');
const mckee = player('9', 'Tanner McKee');
const milton = player('10', 'Joe Milton III');
const darnold = player('11', 'Sam Darnold');
const lock = player('12', 'Drew Lock');

function context(overrides = {}) {
  return {
    teams,
    season: 2026,
    week: 9,
    firstKickoffAt,
    asOf: '2026-11-06T01:00:00Z',
    games: [
      { id: 'bal-jax', teams: ['BAL', 'JAX'], kickoffAt: firstKickoffAt },
      { id: 'was-sea', teams: ['WAS', 'SEA'], kickoffAt: sunday },
      { id: 'phi-nyg', teams: ['PHI', 'NYG'], kickoffAt: sunday },
    ],
    rosters: {
      WAS: [daniels, mariota, hartman],
      SEA: [darnold, lock],
      ARI: [brissett, minshew],
      BAL: [jackson, huntley, fagnano],
      PHI: [mckee, milton],
    },
    previous: { WAS: daniels, SEA: darnold, ARI: brissett, BAL: jackson, PHI: mckee },
    ...overrides,
  };
}

const wasBody = 'Mariota will be under center again on Sunday when the Seattle Seahawks come to Northwest Stadium.';
function article(paragraphs = [wasBody], overrides = {}) {
  return {
    title: 'Marcus Mariota named starter against Seattle',
    url: 'https://www.commanders.com/news/quarterback-update',
    teamHint: 'WAS',
    publishedAt: '2026-11-04T20:00:00Z',
    updatedAt: null,
    paragraphs,
    ...overrides,
  };
}

const clubArticle = (teamHint, paragraphs) => article(paragraphs, {
  teamHint,
  url: `${teams[teamHint].origin}/news/quarterback-update`,
});
const nflArticle = paragraphs => article(paragraphs, {
  teamHint: null,
  url: 'https://www.nfl.com/news/quarterback-update',
});

test('a direct club announcement resolves a unique surname, the roster identity, and the exact game', () => {
  const result = classifyArticle(article(), context());
  assert.deepEqual(result, {
    status: 'proposed',
    reason: 'starter_confirmed',
    team: 'WAS',
    previousQB: { id: '1', name: 'Jayden Daniels' },
    newQB: { id: '2', name: 'Marcus Mariota' },
    espnAthleteId: '2',
    match: { id: 'was-sea', opponent: 'SEA', kickoffAt: sunday },
    publishedAt: '2026-11-04T20:00:00Z',
    url: article().url,
    evidence: wasBody,
  });
});

test('a club current-role announcement requires the correct next opponent explicitly in its body', () => {
  const ariContext = context({
    games: [{ id: 'ari-sea', teams: ['ARI', 'SEA'], kickoffAt: sunday }],
  });
  const announcement = 'Gardner Minshew II is now the Cardinals starting quarterback.';
  const nextGame = 'The Cardinals next play in Seattle, followed by a home game against the Rams.';
  const confirmed = classifyArticle(clubArticle('ARI', [announcement, nextGame]), ariContext);
  assert.equal(confirmed.status, 'proposed');
  assert.deepEqual(confirmed.newQB, { id: '5', name: 'Gardner Minshew II' });
  assert.equal(confirmed.evidence, `${announcement}\n${nextGame}`);
  assert.equal(classifyArticle(clubArticle('ARI', [announcement]), ariContext).reason, 'fixture_unconfirmed');
  assert.notEqual(classifyArticle(clubArticle('ARI', [
    announcement,
    'The Cardinals next play the Rams, followed by a home game against Seattle.',
  ]), ariContext).status, 'proposed');
});

test('a coach can name a roster QB regardless of depth ranking, with an adjacent scoped passage', () => {
  const body = [
    'With Lamar Jackson and Tyler Huntley injured, third-string quarterback Joe Fagnano will make his first career start Thursday against the Jaguars.',
    'Head Coach Jesse Minter announced Tuesday that Fagnano will be under center.',
  ];
  const confirmed = classifyArticle(clubArticle('BAL', body), context());
  assert.equal(confirmed.status, 'proposed');
  assert.equal(confirmed.espnAthleteId, '7');
  assert.match(confirmed.evidence, /Thursday against the Jaguars/);
  const nfl = nflArticle(['Head coach Jesse Minter announced that Fagnano will start Thursday night against Jacksonville.']);
  assert.equal(classifyArticle(nfl, context()).status, 'proposed');
});

test('a reporter attribution is held while retaining the explicitly reported athlete', () => {
  const news = nflArticle([
    'The Eagles are naming Joe Milton III as their starting QB and benching Tanner McKee for Sunday’s game versus the Giants, two NFL reporters said.',
  ]);
  const result = classifyArticle(news, context());
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'unattributed_report');
  assert.equal(result.team, 'PHI');
  assert.equal(result.espnAthleteId, '10');
  const clubRoundup = classifyArticle(article([
    'Marcus Mariota will start against Seattle, NFL Network reported.',
  ]), context());
  assert.equal(clubRoundup.reason, 'unattributed_report');
});

test('conditional, speculative, and negated plans are held', () => {
  for (const claim of [
    'Marcus Mariota will start against the Seahawks if Daniels cannot play.',
    'The plan is for Marcus Mariota to start against the Seahawks.',
    'Marcus Mariota is expected to start against the Seahawks.',
    'Marcus Mariota will not start against the Seahawks.',
    'Could Marcus Mariota be the starter against the Seahawks?',
    'Marcus Mariota will start against the Seahawks. That depends on his recovery.',
  ]) {
    assert.notEqual(classifyArticle(article([claim]), context()).status, 'proposed', claim);
  }
  const sea = classifyArticle(clubArticle('SEA', [
    'Seattle will be without quarterback Sam Darnold for Sunday’s game against the Washington Commanders.',
    'Darnold was injured last week against the Bears, with Drew Lock, who has an elbow injury, expected to start in his place.',
    'The plan is for Drew to start.',
  ]), context());
  assert.equal(sea.reason, 'qualified_announcement');
  assert.equal(sea.espnAthleteId, '12');
});

test('a headline, workouts, practice, or availability do not provide positive body evidence', () => {
  for (const paragraphs of [
    [],
    ['Marcus Mariota will start throwing Sunday before the team faces Seattle.'],
    ['Marcus Mariota was a full participant in practice before the game against Seattle.'],
    ['Marcus Mariota is active for Sunday’s game against the Seahawks.'],
    ['Quarterback Marcus Mariota is available against the Seahawks.'],
  ]) {
    assert.notEqual(classifyArticle(article(paragraphs), context()).status, 'proposed');
  }
});

test('a wrong opponent, week, or named game day fails closed', () => {
  for (const claim of [
    'Marcus Mariota will start against the New York Giants.',
    'Marcus Mariota will start against the Seahawks in Week 5.',
    'Marcus Mariota will start this Thursday against the Seahawks.',
    'Marcus Mariota will start last Sunday against the Seahawks.',
    'Marcus Mariota will start against the Seahawks next week.',
  ]) {
    assert.equal(classifyArticle(article([claim]), context()).reason, 'fixture_mismatch', claim);
  }
});

test('surname collisions, unknown or ineligible players, and missing baselines cannot become proposals', () => {
  const collide = context({ rosters: { WAS: [daniels, mariota, player('13', 'Pat Mariota')] } });
  assert.equal(classifyArticle(article(), collide).reason, 'multiple_candidates');
  assert.equal(classifyArticle(article(['Marcus Mariota will start against Seattle.']), collide).espnAthleteId, '2');
  assert.notEqual(classifyArticle(article(['Jeff Mariota will start against Seattle.']), collide).status, 'proposed');
  assert.notEqual(classifyArticle(article(), context({ rosters: { SEA: [mariota] } })).status, 'proposed');
  for (const availability of ['Out', 'Questionable', 'Injured Reserve', 'Practice Squad']) {
    const rosters = { WAS: [daniels, { ...mariota, availability }] };
    assert.equal(classifyArticle(article(), context({ rosters })).reason, 'qb_ineligible');
  }
  assert.equal(classifyArticle(article(), context({ previous: {} })).reason, 'previous_unknown');
});

test('late, stale, missing, future, and edited sources fail according to the original time window', () => {
  for (const [overrides, reason] of [
    [{ url: 'https://commanders.com.example.com/news/quarterback-update' }, 'untrusted_source'],
    [{ publishedAt: null }, 'missing_publication'],
    [{ publishedAt: '2026-10-28T20:00:00Z', updatedAt: '2026-11-05T20:00:00Z' }, 'stale_article'],
    [{ publishedAt: '2026-11-06T01:04:00Z' }, 'future_publication'],
    [{ updatedAt: '2026-11-06T01:04:00Z' }, 'future_update'],
    [{ updatedAt: '2026-11-04T19:00:00Z' }, 'invalid_update'],
  ]) {
    assert.equal(classifyArticle(article(undefined, overrides), context()).reason, reason);
  }
  const afterGel = context({ asOf: '2026-11-06T02:00:00Z' });
  assert.equal(classifyArticle(article(undefined, { publishedAt: firstKickoffAt }), afterGel).reason, 'late_publication');
  assert.equal(classifyArticle(article(undefined, { updatedAt: firstKickoffAt }), afterGel).reason, 'late_update');
  assert.equal(classifyArticle(article(), afterGel).status, 'proposed');
  const lateConfirmation = classifyArticle(article([
    "Jayden Daniels has been cleared to play and will start in the Washington Commanders' Week 5 game against the New York Giants.",
  ], { publishedAt: firstKickoffAt }), {
    ...afterGel,
    week: 5,
    games: [{ id: 'was-nyg', teams: ['WAS', 'NYG'], kickoffAt: sunday }],
    previous: { WAS: mariota },
  });
  assert.equal(lateConfirmation.reason, 'late_publication');
  assert.equal(lateConfirmation.espnAthleteId, '1');
  assert.equal(lateConfirmation.match.id, 'was-nyg');
});

test('the newest verified signal wins regardless of arrival order and repeated reports are deduplicated', () => {
  const ctx = context();
  const first = classifyArticle(article(), ctx);
  const later = classifyArticle(article(['Sam Hartman will start against Seattle.'], {
    url: 'https://www.commanders.com/news/later',
    publishedAt: '2026-11-05T12:00:00Z',
  }), ctx);
  const repeat = { ...later, url: 'https://www.commanders.com/news/repeat' };
  const independent = classifyArticle(nflArticle([
    'Head coach Jesse Minter announced that Fagnano will start against Jacksonville.',
  ]), ctx);
  const statuses = results => Object.fromEntries(resolveLatest(results, ctx).map(row => [row.url, row.reason]));
  const before = structuredClone([first, later, repeat, independent]);
  const ordered = statuses([first, later, repeat, independent]);
  assert.deepEqual(ordered, statuses([repeat, independent, later, first]));
  assert.deepEqual([first, later, repeat, independent], before);
  assert.equal(ordered[first.url], 'superseded');
  assert.equal(ordered[later.url], 'starter_confirmed');
  assert.equal(ordered[repeat.url], 'duplicate_evidence');
  assert.equal(ordered[independent.url], 'starter_confirmed');
});

test('equal-time conflicting signals and a newer incumbent confirmation prevent stale proposals', () => {
  const ctx = context();
  const first = classifyArticle(article(), ctx);
  const conflict = classifyArticle(article(['Sam Hartman will start against Seattle.'], {
    url: 'https://www.commanders.com/news/conflicting',
  }), ctx);
  assert.deepEqual(resolveLatest([conflict, first], ctx).map(row => [row.status, row.reason]), [
    ['ambiguous', 'conflicting_announcements'],
    ['ambiguous', 'conflicting_announcements'],
  ]);
  const incumbent = classifyArticle(article(['Jayden Daniels will start against Seattle.'], {
    publishedAt: '2026-11-05T12:00:00Z',
  }), ctx);
  assert.equal(incumbent.reason, 'same_qb');
  assert.equal(resolveLatest([first, incumbent], ctx)[0].reason, 'superseded');
  const acceptedAfter = context({ previous: { WAS: { ...daniels, publishedAt: incumbent.publishedAt } } });
  assert.equal(classifyArticle(article(), acceptedAfter).reason, 'older_than_previous');
  assert.equal(resolveLatest([first], acceptedAfter)[0].reason, 'older_than_previous');
  const acceptedAtSameTime = context({ previous: { WAS: { ...daniels, publishedAt: first.publishedAt } } });
  assert.equal(resolveLatest([first], acceptedAtSameTime)[0].reason, 'conflicting_announcements');
});

test('a direct reversal holds a contradictory article and supersedes an older proposal', () => {
  const ctx = context();
  const first = classifyArticle(article(), ctx);
  const reversal = 'Marcus Mariota will not start against the Seahawks.';
  assert.equal(classifyArticle(article([wasBody, reversal]), ctx).reason, 'contradictory_article');
  const later = classifyArticle(article([reversal], {
    url: 'https://www.commanders.com/news/reversal',
    publishedAt: '2026-11-05T12:00:00Z',
  }), ctx);
  assert.equal(later.reason, 'starter_denied');
  assert.equal(resolveLatest([first, later], ctx)[0].reason, 'superseded');
});
