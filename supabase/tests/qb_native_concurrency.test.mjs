import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { admin, exchangeSql, member, quoteSql, signedExchange, withNativeQbFixture } from './qb_native_fixture.mjs';

const native = { skip: !process.env.QB_TEST_PG_BIN };
const fetchUrl = 'https://api.sleeper.app/v1/players/nfl?position=QB';

async function waitFor(db, label, condition) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await db.scalar(`select exists (
      select from pg_stat_activity where application_name = ${quoteSql(label)} and (${condition})
    );`) === 't') return;
    await pause(20);
  }
  assert.fail(`Session ${label} did not reach ${condition}`);
}

async function dispatch(db) {
  const result = JSON.parse(await db.sql(exchangeSql(signedExchange(db.secret, 'claim'))));
  assert.equal(result.status, 'claimed');
  return result.payload;
}

function reportAbsence(db, request) {
  const at = new Date().toISOString();
  const previousQB = request.baseline.WAS;
  const raw = JSON.stringify({
    mode: 'observation', runId: request.runId, season: request.season,
    week: request.week, revision: request.revision, firstKickoffAt: request.firstKickoffAt,
    status: 'completed', observedAt: at, errors: [],
    decisions: [{ team: 'WAS', match: { id: '5005', opponent: 'BUF', kickoffAt: request.firstKickoffAt },
      previousQB, newQB: null, espnAthleteId: null, url: fetchUrl,
      status: 'ambiguous', reason: 'sleeper_unavailable' }],
    sourceState: {
      version: 1, observedAt: at,
      sleeper: { attemptedAt: at, fetchedAt: at,
        players: [{ ...previousQB, team: 'WAS', status: 'Active', injuryStatus: 'Out' }] },
      absences: [{ ...previousQB, team: 'WAS', since: at, reason: 'sleeper_unavailable' }],
      signals: [{ team: 'WAS', key: 'exclude:sleeper_unavailable' }],
    },
  });
  return exchangeSql(signedExchange(db.secret, 'report', raw));
}

const flags = db => db.scalar('select enabled::text || \'/\' || automation_enabled::text from qb_observation.regular_menu_config;');
const menu = async db => JSON.parse(await db.asRole(member, 'select public.read_regular_qb_menu(2026,5);'));

test('harvest waits for an uncommitted Admin replacement and then discards the former QB absence', native, async () => {
  await withNativeQbFixture(async db => {
    await db.sql(`update qb_observation.regular_menu_config set enabled=true,automation_enabled=true;
      insert into qb_observation.runs(season, week, revision, opened_at, period, first_kickoff_at,
        dispatched_at, observed_at, status, event_ids, baseline)
      select 2026,5,s.revision,w.started_at,-99,cal.first_kickoff_at,
        now()-interval '1 minute',now()-interval '1 minute','completed',cal.event_ids,'{}'
      from public.settings s cross join public.qb_selection_weeks w
      cross join qb_observation.calendar(2026,5) cal where s.id=1;`);
    const claimed = signedExchange(db.secret, 'claim');
    const first = db.startSql(`set application_name='qb_claim_transaction'; begin;
      ${exchangeSql(claimed)}
      select pg_sleep(2); commit;`).done;
    const completed = first.catch(error => error);
    await waitFor(db, 'qb_claim_transaction', "wait_event = 'PgSleep'");
    const second = JSON.parse(await db.sql(exchangeSql(signedExchange(db.secret, 'claim'))));
    assert.deepEqual(second, { status: 'busy' });
    const claimResult = await completed;
    if (claimResult instanceof Error) throw claimResult;
    const { status, payload: request } = JSON.parse(claimResult);
    assert.equal(status, 'claimed');
    assert.deepEqual(JSON.parse(await db.sql(exchangeSql(claimed))), { status: 'replayed' });
    assert.equal(await db.scalar("select count(*) from qb_observation.runs where status='pending';"), '1');
    assert.equal(request.baseline.WAS.id, '99');
    const replacement = await db.scalar("select id from public.qbs where espn_athlete_id='100';");
    const adminSession = db.startSql(`set application_name='qb_test_admin';
      begin; set request.jwt.claim.sub=${quoteSql(admin)}; set role authenticated;
      select public.manage_regular_qb_menu(2026,5,'WAS','assign',${quoteSql(replacement)},'Fixture confirmation');
      select pg_sleep(2);
      commit;`).done;
    // When the session is sleeping, its replacement has been written and is
    // still invisible outside its transaction. Harvest must wait for commit.
    const received = adminSession.catch(error => error);
    await waitFor(db, 'qb_test_admin', "wait_event = 'PgSleep'");
    const report = reportAbsence(db, request);
    const harvest = db.startSql(`set application_name='qb_test_harvest'; ${report}`).done;
    const harvestResult = harvest.catch(error => error);
    await waitFor(db, 'qb_test_harvest', "wait_event_type = 'Lock'");
    const assignment = await received;
    if (assignment instanceof Error) throw assignment;
    assert.equal(JSON.parse(assignment).qbId, replacement);
    const result = await harvestResult;
    if (result instanceof Error) throw result;
    assert.equal(JSON.parse(result).status, 'stored');
    assert.deepEqual(JSON.parse(await db.sql(`select source_state->'absences' from qb_observation.runs
      where run_id=${quoteSql(request.runId)};`)), []);
    const currentQbs = (await menu(db)).qbs;
    assert.ok(currentQbs.some(qb => qb.espn_athlete_id === '100'));
    assert.ok(!currentQbs.some(qb => qb.espn_athlete_id === '99'));
    assert.equal(await db.scalar("select decision->>'reason' from qb_observation.entries;"), 'stale_baseline');
  });
});

test('a harvest blocked on a journal write across kickoff leaves only diagnostics', native, async () => {
  await withNativeQbFixture(async db => {
    const request = await dispatch(db);
    await db.sql("update public.games set game_date=clock_timestamp()+interval '2 seconds' where external_game_id='5005';");
    const report = reportAbsence(db, request);
    const blocker = db.startSql(`set application_name='qb_test_journal_lock';
      begin; lock table qb_observation.entries in exclusive mode;
      select pg_sleep(3);
      commit;`).done.catch(error => error);
    await waitFor(db, 'qb_test_journal_lock', "wait_event = 'PgSleep'");
    const harvest = db.startSql(`set application_name='qb_test_late_harvest'; ${report}`).done.catch(error => error);
    await waitFor(db, 'qb_test_late_harvest', "wait_event_type = 'Lock'");
    assert.equal(await db.scalar("select clock_timestamp() < game_date from public.games where external_game_id='5005';"), 't');
    assert.equal(typeof await blocker, 'string');
    const result = await harvest;
    if (result instanceof Error) throw result;
    assert.equal(JSON.parse(result).status, 'stored');
    assert.equal(JSON.parse(await db.sql(exchangeSql(signedExchange(db.secret, 'claim')))).status, 'outside_window');
    assert.equal(await db.scalar(`select status || '/' || (source_state is null)::text from qb_observation.runs
      where run_id=${quoteSql(request.runId)};`), 'completed/true');
    assert.equal(await db.scalar('select count(*) from qb_observation.entries;'), '1');
    assert.equal(await flags(db), 'false/false');
  });
});

test('an in-flight flag flip cannot commit after kickoff and change a frozen menu', native, async () => {
  await withNativeQbFixture(async db => {
    await db.sql(`update qb_observation.regular_menu_config set enabled=true,automation_enabled=true;
      update public.games set game_date=clock_timestamp()+interval '2 seconds' where external_game_id='5005';`);
    const before = await menu(db);
    const session = db.startSql(`set application_name='qb_test_flag_commit';
      begin;
      update qb_observation.regular_menu_config set automation_enabled=false;
      select pg_sleep(3);
      commit;`).done.catch(error => error);
    await waitFor(db, 'qb_test_flag_commit', "wait_event = 'PgSleep'");
    assert.equal(await flags(db), 'true/true');
    assert.match((await session).message, /gelé au premier coup/);
    assert.equal(await flags(db), 'true/true');
    assert.deepEqual(await menu(db), before);
  });
});
