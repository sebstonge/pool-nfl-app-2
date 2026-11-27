import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  admin, exchangeSql, member, other, prepareQbFixture, quoteSql, readQbCriticalState,
  signedExchange, withNativeQbFixture,
} from './qb_native_fixture.mjs';

const secondAdmin = '00000000-0000-0000-0000-000000000004';
const native = { skip: !process.env.QB_TEST_PG_BIN };
const embedded = { skip: !process.env.PGLITE_MODULE };
const stale = /périmée.*Rafraîchis/i;
const staleRpc = error => error.code === '40001' && stale.test(error.message);
const reasonOutlet = 'https://api.sleeper.app/v1/players/nfl?position=QB';

async function migrate(db) {
  const migration = new URL('../migrations/20261124102217_qb_manual_recommendation_review.sql', import.meta.url);
  const before = await db.criticalState();
  await db.sql(await readFile(migration, 'utf8'));
  assert.deepEqual(await db.criticalState(), before);
}

async function withEmbeddedQbFixture(task) {
  const moduleUrl = pathToFileURL(process.env.PGLITE_MODULE);
  const { PGlite } = await import(moduleUrl.href);
  const { pgcrypto } = await import(new URL('contrib/pgcrypto.js', moduleUrl).href);
  const instance = new PGlite({ extensions: { pgcrypto } });
  const sql = async text => {
    const result = await instance.exec(`reset role; set request.headers = '{"x-pool-regular-schema":"20261009"}';\n${text}`);
    const row = result.at(-1)?.rows[0];
    if (!row) return '';
    const [value] = Object.values(row);
    return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  };
  const asRole = (actor, text) => sql(
    `set request.jwt.claim.sub = ${quoteSql(actor)}; set role authenticated;\n${text}`
  );
  const secret = randomBytes(32).toString('hex');
  try {
    await prepareQbFixture(sql, secret);
    return await task({ sql, scalar: sql, asRole, criticalState: () => readQbCriticalState(sql), secret });
  } finally {
    await instance.close();
  }
}

const enableManual = db => db.sql(`update qb_observation.regular_menu_config
  set manual_admin_enabled = true where singleton;`);
const qbId = (db, espnId) => db.scalar(`select id from public.qbs where espn_athlete_id = ${quoteSql(espnId)};`);
const adminMenu = async db => JSON.parse(await db.asRole(admin, 'select public.read_regular_qb_menu_admin();'));
const team = menu => menu.teams.find(row => row.abbr === 'WAS');
const pick = (id, actor = member, expected = null, week = 5) => `insert into public.qb_picks
  (season,week,user_id,qb_id,selected_espn_athlete_id)
  values (2026,${week},${quoteSql(actor)},${quoteSql(id)},${expected == null ? 'null' : quoteSql(expected)}) returning id;`;
const business = ({ catalog, ...state }) => state;
const ledger = async db => JSON.parse(await db.sql(`select coalesce(jsonb_agg(to_jsonb(d) order by confirmed_at),'[]'::jsonb)
  from qb_observation.regular_qb_manual_decisions d;`));
const observationLog = async db => JSON.parse(await db.asRole(admin, 'select public.read_qb_observation_log();'));
const suggested = { name: 'Suggested QB', id: '101' };
const flags = async db => JSON.parse(await db.sql(`select jsonb_build_array(
  enabled, automation_enabled, manual_admin_enabled) from qb_observation.regular_menu_config;`));

async function observe(db, { candidate = false, priorState = null } = {}) {
  // Retain report history but make the next fake observation slot available.
  await db.sql(`update qb_observation.runs set period =
    (select least(coalesce(min(period),0),0)-1 from qb_observation.runs) where period >= 0;`);
  const claim = JSON.parse(await db.sql(exchangeSql(signedExchange(db.secret, 'claim'))));
  assert.equal(claim.status, 'claimed');
  const { runId, season, week, revision, firstKickoffAt, baseline } = claim.payload;
  const { id, name } = baseline.WAS;
  const previousQB = { id, name };
  const observedAt = new Date().toISOString();
  const reportedQB = { ...previousQB, team: 'WAS', status: 'Active', injuryStatus: 'Out' };
  const newQB = candidate ? suggested : null;
  const absences = [{ ...previousQB, team: 'WAS', since: observedAt, reason: 'sleeper_unavailable' }];
  const sleeper = priorState ? priorState.sleeper : {
    attemptedAt: observedAt, fetchedAt: observedAt, players: newQB
      ? [reportedQB, { ...newQB, team: 'WAS', status: 'Active', injuryStatus: null }]
      : [reportedQB],
  };
  const reason = 'sleeper_unavailable';
  const raw = JSON.stringify({
    mode: 'observation', runId, season, week, revision, firstKickoffAt,
    status: 'completed', observedAt, errors: [],
    decisions: [{ team: 'WAS', match: { id: '5005', opponent: 'BUF', kickoffAt: firstKickoffAt },
      previousQB, newQB, espnAthleteId: newQB?.id ?? null, url: reasonOutlet,
      status: 'ambiguous', reason }],
    sourceState: {
      version: 1, observedAt, sleeper,
      absences: priorState?.absences ?? absences,
      signals: [{ team: 'WAS', key: `exclude:${reason}` }],
    },
  });
  const report = JSON.parse(await db.sql(exchangeSql(signedExchange(db.secret, 'report', raw))));
  assert.equal(report.status, 'stored');
  const log = JSON.parse(await db.asRole(admin, 'select public.read_qb_observation_log();'));
  const entry = log.entries.find(row => row.runId === runId);
  assert.equal(entry?.currentSignal, true);
  const state = JSON.parse(await db.scalar(`select source_state from qb_observation.runs where run_id = ${quoteSql(runId)};`));
  return { entry, state };
}

async function readCard(db, entry) {
  const menu = await adminMenu(db);
  const row = team(menu);
  assert.ok(row);
  if (menu.manualOpen) assert.match(row.reviewState, /^[a-f0-9]{64}$/);
  else assert.equal(row.reviewState, null);
  // A valid-looking forged token cannot open the gate.
  return { entryId: entry.entryId, runId: entry.runId, state: row.reviewState ?? '0'.repeat(64) };
}

const sqlText = value => value == null ? 'null' : quoteSql(value);
function actionSql(card, selection, { actor = admin, confirmed = true, athlete = null, team = 'WAS' } = {}) {
  return `select public.manage_regular_qb_recommendation(${quoteSql(actor)}, ${quoteSql(selection)},
    ${quoteSql(card.entryId)}, ${quoteSql(card.runId)}, ${quoteSql(card.state)}, ${quoteSql(team)},
    ${confirmed}, ${sqlText(athlete?.id)}, ${sqlText(athlete?.name)});`;
}
const apply = (db, card, selection, options) => db.sql(`set role service_role; ${actionSql(card, selection, options)}`);

async function reserveAndSeedHistory(db) {
  const current = await qbId(db, '99');
  const id = await db.asRole(member, pick(current));
  await db.sql(`insert into public.qb_ratings
      (season, week, qb_id, passer_rating, actual_qb_name, actual_espn_athlete_id)
    values (2026,4,${quoteSql(current)},98.2,'Current QB','99');
    insert into public.weekly_scores (season,week,user_id,base_points,multiplier,final_score)
    values (2026,4,${quoteSql(member)},2,1.5,3);`);
  const snapshot = await db.criticalState();
  assert.equal(snapshot.qb_picks[0].selected_espn_athlete_id, '99');
  assert.equal(snapshot.qb_picks[0].id, id);
  assert.equal(snapshot.reservations, null);
  assert.equal(team(await adminMenu(db)).reserved, true);
  return snapshot;
}

test('manual confirmation is service-only, Admin-authorized, opt-in and independent of the two disabled flags', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    assert.deepEqual(await flags(db), [false, false, false]);
    const { entry } = await observe(db);
    const card = await readCard(db, entry);
    const before = await db.criticalState();
    await assert.rejects(apply(db, card, 'current', { actor: member }), /Administrator required/i);
    await assert.rejects(db.asRole(admin, actionSql(card, 'current')), /permission denied/i);
    await assert.rejects(db.sql(`set role anon; ${actionSql(card, 'current')}`), /permission denied/i);
    await assert.rejects(apply(db, card, 'current'), /désactivé/i);
    await enableManual(db);
    assert.deepEqual(await flags(db), [false, false, true]);
    assert.equal((await adminMenu(db)).manualOpen, true);
    const fresh = await readCard(db, entry);
    await assert.rejects(apply(db, fresh, 'current', { confirmed: false }), /confirmation/i);
    await assert.rejects(apply(db, fresh, 'current', { team: 'BUF' }), staleRpc);
    await assert.rejects(db.asRole(admin, 'select * from qb_observation.regular_qb_manual_decisions'), /permission denied/i);
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});

test('maintaining the starter leaves the catalogue untouched and a later run can surface the same journal key', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    const initial = await observe(db);
    await enableManual(db);
    const before = await db.criticalState();
    const card = await readCard(db, initial.entry);
    const outcome = JSON.parse(await apply(db, card, 'current'));
    assert.equal(outcome.outcome, 'maintained');
    assert.equal(outcome.espnAthleteId, '99');
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual((await adminMenu(db)).reviewed, [{ entryId: card.entryId, runId: card.runId, outcome: 'maintained' }]);
    assert.equal((await ledger(db))[0].actor_id, admin);
    assert.equal((await observationLog(db)).entries.find(row => row.entryId === card.entryId).currentSignal, false);
    await assert.rejects(apply(db, card, 'current'), staleRpc);
    const next = await observe(db, { priorState: initial.state });
    assert.equal(next.entry.entryId, card.entryId);
    assert.notEqual(next.entry.runId, card.runId);
    assert.equal(next.entry.currentSignal, true);
    assert.deepEqual((await adminMenu(db)).reviewed, []);
    await assert.rejects(apply(db, card, 'current'), staleRpc);
  });
});

test('a verified suggested replacement updates only the same slot identity and preserves its pick, reservation and result', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const before = await reserveAndSeedHistory(db);
    const card = await readCard(db, entry);
    const slot = await qbId(db, '99');
    await assert.rejects(apply(db, card, 'suggested', { athlete: { name: 'Unrelated', id: '123' } }), staleRpc);
    const result = JSON.parse(await apply(db, card, 'suggested', { athlete: suggested }));
    assert.equal(result.qbId, slot);
    assert.equal(result.espnAthleteId, suggested.id);
    assert.equal(result.outcome, 'confirmed');
    const after = await db.criticalState();
    assert.deepEqual(business(after), business(before));
    assert.deepEqual(after.catalog, before.catalog.map(q => q.id === slot ?
      { ...q, name: suggested.name, espn_athlete_id: suggested.id } : q));
    assert.equal(team(await adminMenu(db)).reserved, true);
    await assert.rejects(db.asRole(other, pick(slot, other, suggested.id)), /duplicate key/i);
    assert.deepEqual(await flags(db), [false, false, true]);
    const [audit] = await ledger(db);
    assert.equal(audit.entry_id, card.entryId);
    assert.equal(audit.previous_athlete_id, '99');
    assert.equal(audit.athlete_id, suggested.id);
    assert.equal(audit.actor_id, admin);
    await assert.rejects(apply(db, card, 'suggested', { athlete: suggested }), staleRpc);
    assert.deepEqual(await db.criticalState(), after);
  });
});

test('a verified Other changes no row count, blocks stale drafts and captures the new identity after reload', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db);
    await enableManual(db);
    const card = await readCard(db, entry);
    const slot = await qbId(db, '99');
    const otherAthlete = { name: 'Other QB', id: '102' };
    const before = await db.criticalState();
    const result = JSON.parse(await apply(db, card, 'other', { athlete: otherAthlete }));
    assert.equal(result.qbId, slot);
    const after = await db.criticalState();
    assert.deepEqual(business(after), business(before));
    assert.deepEqual(after.catalog, before.catalog.map(q => q.id === slot ?
      { ...q, name: otherAthlete.name, espn_athlete_id: otherAthlete.id } : q));
    await assert.rejects(db.asRole(member, pick(slot)), /titulaire.*changé/i);
    await assert.rejects(db.asRole(member, pick(slot, member, '99')), /titulaire.*changé/i);
    await db.asRole(member, pick(slot, member, otherAthlete.id));
    const selected = (await db.criticalState()).qb_picks[0];
    assert.equal(selected.qb_id, slot);
    assert.equal(selected.selected_espn_athlete_id, otherAthlete.id);
    assert.equal(selected.selected_qb_name, otherAthlete.name);
  });
});

test('a stale weekly override cannot hide the existing team catalogue row when the managed menu is off', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    await db.sql(`insert into qb_observation.regular_menu_overrides
        (season,week,team_id,game_id,qb_id,expected_athlete_id,note,actor_id,updated_at)
      select 2026,5,f.team_id,f.game_id,q.id,'567','old weekly override',${quoteSql(admin)},clock_timestamp()
      from qb_observation.regular_menu_fixtures(2026,5) f
      join public.qbs q on qb_observation.regular_team_id(q.team) = f.team_id
      where q.espn_athlete_id = '99';`);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const slot = await qbId(db, '99');
    assert.equal(team(await adminMenu(db)).qbId, slot);
    const before = await db.criticalState();
    const card = await readCard(db, entry);
    const result = JSON.parse(await apply(db, card, 'suggested', { athlete: suggested }));
    assert.equal(result.qbId, slot);
    const after = await db.criticalState();
    assert.deepEqual(business(after), business(before));
    assert.deepEqual(after.catalog, before.catalog.map(q => q.id === slot ?
      { ...q, name: suggested.name, espn_athlete_id: suggested.id } : q));
    assert.equal(team(await adminMenu(db)).qbEspnId, suggested.id);
  });
});

test('two active catalogue starters for the same team leave the recommendation unconfirmable', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    await db.sql(`insert into public.qbs(name,team,espn_athlete_id,active,is_active_starter)
      values ('Second active starter','WSH','102',true,true);`);
    const row = team(await adminMenu(db));
    assert.equal(row.qbId, null);
    assert.equal(row.reviewState, null);
    const before = await db.criticalState();
    await assert.rejects(apply(db, card, 'suggested', { athlete: suggested }), staleRpc);
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});

test('rejects an ESPN identity collision or historical picks depending on the mutable slot', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const slot = await qbId(db, '99');
    let before = await db.criticalState();
    let card = await readCard(db, entry);
    await assert.rejects(apply(db, card, 'other', { athlete: { name: 'Bills QB', id: '123' } }), /autre fiche/i);
    assert.deepEqual(await db.criticalState(), before);
    await db.sql(`alter table public.qb_picks disable trigger regular_qb_selection_snapshot_insert;
      ${pick(slot, member, null, 4)}
      alter table public.qb_picks enable trigger regular_qb_selection_snapshot_insert;`);
    before = await db.criticalState();
    card = await readCard(db, entry);
    await assert.rejects(apply(db, card, 'suggested', { athlete: suggested }), /identité complète/i);
    assert.deepEqual(await db.criticalState(), before);
    await db.sql(`delete from public.qb_picks where qb_id = ${quoteSql(slot)};
      insert into public.playoff_rounds(season,round_key,round_name,round_order)
      values (2025,'wild_card','Wild Card',1);
      insert into public.playoff_qb_picks(user_id,round_id,qb_id)
      select ${quoteSql(member)},r.id,${quoteSql(slot)} from public.playoff_rounds r where r.season = 2025;`);
    before = await db.criticalState();
    card = await readCard(db, entry);
    await assert.rejects(apply(db, card, 'suggested', { athlete: suggested }), /historique des séries/i);
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});

test('the deferred freeze rolls back a starter update and review at commit', embedded, async () => {
  await withEmbeddedQbFixture(async db => {
    await migrate(db);
    await db.sql(`update public.games set game_date = clock_timestamp() + interval '2 seconds'
      where external_game_id = '5005';`);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    const before = await db.criticalState();
    await db.sql('begin;');
    try {
      assert.equal(JSON.parse(await apply(db, card, 'suggested', { athlete: suggested })).espnAthleteId, '101');
      await db.sql(`select pg_sleep(greatest(0, extract(epoch from
        (select game_date - clock_timestamp() from public.games where external_game_id = '5005'))) + 0.1);`);
      await assert.rejects(db.sql('commit;'), /gelé au premier coup/i);
    } finally {
      await db.sql('rollback;');
    }
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});

async function untilWaiting(db, label, predicate) {
  for (let attempt = 0; attempt < 125; attempt++) {
    if (await db.scalar(`select exists (select from pg_stat_activity
      where application_name = ${quoteSql(label)} and (${predicate}));`) === 't') return;
    await wait(15);
  }
  assert.fail(`Session ${label} did not reach ${predicate}`);
}

function startSession(db, label, actor, work) {
  const identity = actor === null ? '' : `set request.jwt.claim.sub = ${quoteSql(actor)}; set role authenticated;`;
  return db.startSql(`set application_name = ${quoteSql(label)}; begin; ${identity}\n${work}\ncommit;`)
    .done.catch(error => error);
}

function completion(result) {
  if (result instanceof Error) throw result;
  return result;
}

test('a second Admin can update the slot before a waiting Admin confirms an old card', native, async () => {
  await withNativeQbFixture(async db => {
    await migrate(db);
    await db.sql(`insert into public.users(id,is_admin) values (${quoteSql(secondAdmin)},true);`);
    const { entry } = await observe(db);
    await enableManual(db);
    const before = await reserveAndSeedHistory(db);
    const card = await readCard(db, entry);
    const winner = startSession(db, 'qb_review_admin_b', null, `set role service_role;
      ${actionSql(card, 'other', { actor: secondAdmin, athlete: { id: '102', name: 'Other QB' } })}
      select pg_sleep(3);`);
    await untilWaiting(db, 'qb_review_admin_b', "wait_event = 'PgSleep'");
    const staleConfirm = startSession(db, 'qb_review_admin_a', null, `set role service_role; ${actionSql(card, 'current')}`);
    await untilWaiting(db, 'qb_review_admin_a', "wait_event_type = 'Lock'");
    assert.equal(JSON.parse(completion(await winner)).espnAthleteId, '102');
    assert.match((await staleConfirm).message, stale);
    const after = await db.criticalState();
    assert.equal((await ledger(db))[0].actor_id, secondAdmin);
    assert.deepEqual(business(after), business(before));
  });
});

test('a legacy reservation acquired after display invalidates a replacement', native, async () => {
  await withNativeQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    const current = await qbId(db, '99');
    const reserving = startSession(db, 'qb_review_new_pick', member, `${pick(current)} select pg_sleep(3);`);
    await untilWaiting(db, 'qb_review_new_pick', "wait_event = 'PgSleep'");
    const applyOldCard = startSession(db, 'qb_review_after_pick', null,
      `set role service_role; ${actionSql(card, 'suggested', { athlete: suggested })}`);
    await untilWaiting(db, 'qb_review_after_pick', "wait_event_type = 'Lock'");
    const pickId = completion(await reserving);
    assert.match((await applyOldCard).message, stale);
    const after = await db.criticalState();
    assert.equal(after.qb_picks[0].id, pickId);
    assert.equal(after.qb_picks[0].selected_espn_athlete_id, '99');
    assert.equal(team(await adminMenu(db)).reserved, true);
    assert.deepEqual(await ledger(db), []);
  });
});

test('an old player tab waits for the slot update and cannot submit a different QB silently', native, async () => {
  await withNativeQbFixture(async db => {
    await migrate(db);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    const slot = await qbId(db, '99');
    const adminChange = startSession(db, 'qb_review_before_old_tab', null,
      `set role service_role; ${actionSql(card, 'suggested', { athlete: suggested })} select pg_sleep(3);`);
    await untilWaiting(db, 'qb_review_before_old_tab', "wait_event = 'PgSleep'");
    const oldTab = startSession(db, 'qb_review_old_tab', member, pick(slot, member, '99'));
    await untilWaiting(db, 'qb_review_old_tab', "wait_event_type = 'Lock'");
    completion(await adminChange);
    assert.match((await oldTab).message, /titulaire.*changé/i);
    assert.equal((await db.criticalState()).qb_picks, null);
    await db.asRole(member, pick(slot, member, '101'));
    assert.equal((await db.criticalState()).qb_picks[0].selected_espn_athlete_id, '101');
  });
});

test('a recommendation waiting on the weekly lock cannot change the catalogue across the first kickoff', native, async () => {
  await withNativeQbFixture(async db => {
    await migrate(db);
    await db.sql(`update public.games set game_date = clock_timestamp() + interval '5 seconds'
      where external_game_id = '5005';`);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    const before = await db.criticalState();
    const blocker = startSession(db, 'qb_review_kickoff_lock', null,
      'select pg_advisory_xact_lock(1654741114, 202605); select pg_sleep(6);');
    await untilWaiting(db, 'qb_review_kickoff_lock', "wait_event = 'PgSleep'");
    const afterKickoff = startSession(db, 'qb_review_kickoff_admin', null,
      `set role service_role; ${actionSql(card, 'suggested', { athlete: suggested })}`);
    await untilWaiting(db, 'qb_review_kickoff_admin', "wait_event_type = 'Lock'");
    assert.equal(await db.scalar(`select clock_timestamp() < game_date from public.games
      where external_game_id = '5005';`), 't');
    completion(await blocker);
    assert.match((await afterKickoff).message, /gelé|périmée/i);
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});

test('a successful catalogue statement is rolled back with its audit when committed after kickoff', native, async () => {
  await withNativeQbFixture(async db => {
    await migrate(db);
    await db.sql(`update public.games set game_date = clock_timestamp() + interval '5 seconds'
      where external_game_id = '5005';`);
    const { entry } = await observe(db, { candidate: true });
    await enableManual(db);
    const card = await readCard(db, entry);
    const before = await db.criticalState();
    const attempted = startSession(db, 'qb_review_late_commit', null,
      `set role service_role; ${actionSql(card, 'suggested', { athlete: suggested })} select pg_sleep(6);`);
    await untilWaiting(db, 'qb_review_late_commit', "wait_event = 'PgSleep'");
    assert.deepEqual(await db.criticalState(), before);
    assert.match((await attempted).message, /gelé au premier coup/i);
    assert.deepEqual(await db.criticalState(), before);
    assert.deepEqual(await ledger(db), []);
  });
});
