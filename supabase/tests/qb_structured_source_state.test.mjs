import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createScheduledObservationHandler } from '../../scripts/qb-announcements/scheduled.mjs';
import { signedExchange } from './qb_native_fixture.mjs';

const admin = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const secret = 'a'.repeat(64);
const sleeperUrl = 'https://api.sleeper.app/v1/players/nfl?position=QB';
const migrations = [
  '202609240001_playoff_seeds.sql', '202609250001_playoff_round_admin.sql',
  '202609290001_playoff_scoring.sql', '202609300001_notification_reminders.sql',
  '202610040001_lifecycle_foundation.sql', '202610050001_regular_final_publication.sql',
  '202610070001_lifecycle_transition.sql', '202610080001_playoff_atomic_advance.sql',
  '202610090001_lifecycle_completion.sql', '202610190001_regular_qb_selection_snapshot.sql',
  '20261025164727_regular_ties_admin_robustness.sql', '20261105132645_qb_observation_log.sql',
  '202611060001_regular_weekly_qb_menu.sql',
];

test('structured QB source state in disposable PostgreSQL', { skip: !process.env.PGLITE_MODULE }, async t => {
  const moduleUrl = pathToFileURL(process.env.PGLITE_MODULE);
  const { PGlite } = await import(moduleUrl.href);
  const { pgcrypto } = await import(new URL('contrib/pgcrypto.js', moduleUrl).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  const sql = text => db.exec(text);
  const query = (text, params = []) => db.query(text, params);
  const one = async (text, params) => (await query(text, params)).rows[0];
  const migration = file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  const role = async (actor, task, name = 'authenticated') => {
    await query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await sql(`set role ${name}`);
    try { return await task(); }
    finally { await sql('reset role'); }
  };
  const send = ({ p_message, p_signature }) => role(member, async () => (await one(
    'select public.qb_observer_exchange($1,$2) result', [p_message,p_signature])).result, 'anon');
  const exchange = (action, report, options) => send(signedExchange(secret, action, report, options));
  const nextRequest = async () => {
    // Retain previous data while moving its dispatch claim out of this bucket.
    await sql(`update qb_observation.runs set period =
      (select least(coalesce(min(period),0),0)-1 from qb_observation.runs) where period >= 0`);
    const result = await exchange('claim');
    assert.equal(result.status, 'claimed');
    return { payload: result.payload };
  };
  const sourceState = (request, fields = {}) => {
    const at = new Date().toISOString();
    return { version: 1, sleeper: { attemptedAt: at, fetchedAt: at, players: [
      { id: '99', name: 'Current QB', team: 'WAS', status: 'ACTIVE', injuryStatus: 'OUT' },
    ] }, absences: [{ id: '99', name: 'Current QB', team: 'WAS', since: at, reason: 'sleeper_unavailable' }],
    signals: [{ team: 'WAS', key: `unavailable:${request.payload.week}` }], observedAt: at, ...fields };
  };
  const decision = (request, fields = {}) => ({
    team: 'WAS', match: { id: String(5000 + request.payload.week), opponent: 'BUF', kickoffAt: request.payload.firstKickoffAt },
    previousQB: request.payload.baseline.WAS, newQB: null, espnAthleteId: null,
    url: sleeperUrl, status: 'ambiguous', reason: 'sleeper_unavailable', evidence: 'OUT dans le relevé Sleeper.',
    ...fields,
  });
  const respond = async (request, state, fields = {}, validSignature = true) => {
    const { runId, season, week, revision, firstKickoffAt } = request.payload;
    const body = { mode: 'observation', runId, season, week, revision, firstKickoffAt,
      status: 'completed', reason: null, observedAt: state.observedAt,
      decisions: [decision(request)], errors: [], sourceState: state, ...fields };
    const result = await exchange('report', JSON.stringify(body), { valid: validSignature });
    if (result.status !== 'stored') return result;
    return one('select status,reason,source_state from qb_observation.runs where run_id=$1', [runId]);
  };
  const menu = async (actor = member, week = 5) => role(actor, async () => (await one(
    'select public.read_regular_qb_menu(2026,$1) result', [week])).result);
  const adminMenu = async () => role(admin, async () => (await one('select public.read_regular_qb_menu_admin() result')).result);
  const assign = (qb, note = 'Vérification explicite') => role(admin, () => one(
    "select public.manage_regular_qb_menu(2026,5,'WAS','assign',$1,$2) result", [qb, note]));
  const criticalState = async () => (await one(`select jsonb_build_object(
    'picks',(select jsonb_agg(to_jsonb(p) order by p.id) from public.qb_picks p),
    'ratings',(select jsonb_agg(to_jsonb(p) order by p.id) from public.qb_ratings p),
    'scores',(select jsonb_agg(to_jsonb(p) order by p.id) from public.weekly_scores p),
    'catalog',(select jsonb_agg(to_jsonb(p) order by p.id) from public.qbs p),
    'offers',(select jsonb_agg(to_jsonb(p) order by p.team_id) from qb_observation.regular_menu_overrides p),
    'reservations',(select jsonb_agg(to_jsonb(p) order by p.team_id) from qb_observation.regular_menu_reservations p)
  ) state`)).state;

  try {
    for (const file of ['lifecycle_fixture.sql', 'lifecycle_transition_fixture.sql']) {
      await sql(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    await sql(`create role authenticator noinherit;
      update settings set current_season=2026 where id=1;
      insert into users(id,is_admin) values ('${admin}',true),('${member}',false),('${other}',false);
      insert into teams(name,espn_abbr) values ('Washington Commanders','WAS'),('Buffalo Bills','BUF');
      insert into qbs(name,team,espn_athlete_id,active,is_active_starter) values
        ('Current QB','Commanders','99',true,true),('Backup QB','Commanders','100',true,false),
        ('Bills QB','Bills','123',true,true);`);
    for (const file of migrations) {
      const text = await migration(file);
      if (file === '202610090001_lifecycle_completion.sql') {
        await sql(text.slice(0, text.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP')) + 'commit;');
        await sql('update settings set regular_writes_paused=true where id=1');
      }
      await sql(text);
    }
    await sql('update settings set regular_writes_paused=false where id=1');
    await sql(`update settings set current_week=5 where id=1;
      insert into season_participants(season,user_id,confirmed) values
        (2026,'${member}',true),(2026,'${other}',true);
      select set_config('request.headers','{"x-pool-regular-schema":"20261009"}',false);
      insert into qb_selection_weeks(season,week,started_at) values(2026,5,now()-interval '1 hour');
      insert into games(external_game_id,season,week,home_team,away_team,game_date,is_pool_eligible)
      values('5005',2026,5,'Washington Commanders','Buffalo Bills',now()+interval '1 day',false);
      create schema extensions;
      create extension pgcrypto with schema extensions;`);
    const before = await criticalState();
    const preparedMigration = await migration('20261121183802_qb_free_source_observation.sql');
    await sql(preparedMigration);
    assert.deepEqual(await criticalState(), before);
    assert.deepEqual(await one('select enabled,automation_enabled from qb_observation.regular_menu_config'),
      { enabled: false, automation_enabled: false });
    const qb = Object.fromEntries((await query('select espn_athlete_id,id from qbs')).rows
      .map(row => [row.espn_athlete_id,row.id]));

    await t.test('installation stays paused and legacy dispatch cannot use pg_net', async () => {
      assert.deepEqual(await one(`select
        has_table_privilege('anon', 'qb_observation.transport_control', 'SELECT') as anon_secret,
        has_table_privilege('authenticated', 'qb_observation.transport_control', 'UPDATE') as app_dispatch,
        has_function_privilege('anon', 'public.qb_observer_exchange(text,text)', 'EXECUTE') as anon_exchange,
        has_function_privilege('authenticated', 'public.qb_observer_exchange(text,text)', 'EXECUTE') as app_exchange,
        has_function_privilege('service_role', 'public.qb_observer_exchange(text,text)', 'EXECUTE') as server_exchange,
        has_function_privilege('authenticated', 'public.request_qb_observation_check()', 'EXECUTE') as old_manual`),
      { anon_secret: false, app_dispatch: false, anon_exchange: true, app_exchange: false,
        server_exchange: false, old_manual: false });
      assert.equal((await one("select to_regnamespace('net') is null and to_regnamespace('vault') is null private")).private, true);
      assert.equal((await one('select public.run_qb_observation_tick() result')).result.reason, 'outbound_transport_retired');
      await assert.rejects(exchange('claim'), /authentication refused/);
      await query('update qb_observation.transport_control set hmac_secret=$1 where singleton', [secret]);
      assert.deepEqual(await exchange('claim'), { status: 'inactive' });
      assert.equal((await one('select count(*)::int n from qb_observation.runs')).n, 0);
      assert.deepEqual(await criticalState(), before);
      await sql('update qb_observation.transport_control set dispatch_enabled=true where singleton');
    });

    await t.test('wrong signatures, expired timestamps and future timestamps are refused before any receipt', async () => {
      const previous = await one('select count(*)::int n from qb_observation.exchange_nonces');
      await assert.rejects(exchange('claim', undefined, { valid: false }), /authentication refused/);
      // Allow for time spent getting the signed message to PostgreSQL.
      for (const age of [-125_000, 20_000]) {
        await assert.rejects(exchange('claim', undefined, {
          timestamp: new Date(Date.now() + age).toISOString(),
        }), /authentication refused/);
      }
      assert.deepEqual(await one('select count(*)::int n from qb_observation.exchange_nonces'), previous);
      assert.equal((await one('select count(*)::int n from qb_observation.runs')).n, 0);
    });

    await t.test('replayed claims never return a payload and reports are written once even after a pause', async () => {
      await sql('begin');
      try {
        const signedClaim = signedExchange(secret, 'claim');
        const claim = await send(signedClaim);
        assert.equal(claim.status, 'claimed');
        assert.deepEqual(await send(signedClaim), { status: 'replayed' });
        assert.deepEqual(await exchange('claim'), { status: 'already_dispatched' });
        const request = { payload: claim.payload };
        const state = sourceState(request);
        const report = JSON.stringify({ mode: 'observation', runId: claim.payload.runId,
          season: claim.payload.season, week: claim.payload.week, revision: claim.payload.revision,
          firstKickoffAt: claim.payload.firstKickoffAt, status: 'completed', observedAt: state.observedAt,
          decisions: [decision(request)], errors: [], sourceState: state });
        const signedReport = signedExchange(secret, 'report', report);
        await sql('update qb_observation.transport_control set dispatch_enabled=false where singleton');
        assert.deepEqual(await exchange('claim'), { status: 'inactive' });
        assert.deepEqual(await send(signedReport), { status: 'stored' });
        assert.deepEqual(await send(signedReport), { status: 'replayed' });
        assert.deepEqual(await exchange('report', report), { status: 'already_stored' });
        const saved = await one('select status,source_state from qb_observation.runs where run_id=$1', [claim.payload.runId]);
        assert.equal(saved.status, 'completed');
        assert.equal(saved.source_state.absences[0].id, '99');
        assert.equal((await one('select count(*)::int n from qb_observation.entries')).n, 1);
        assert.deepEqual(await criticalState(), before);
        assert.deepEqual(await menu(), { enabled: false, qbs: [] });
      } finally { await sql('rollback'); }
    });

    await t.test('the scheduled worker and anonymous SQL exchange round-trip an observation', async () => {
      await sql('begin');
      try {
        const origin = 'https://abcdefghijklmnopqrst.supabase.co';
        const apiKey = 'sb_publishable_' + 'p'.repeat(32);
        const kickoff = (await one("select qb_observation.iso(game_date) kickoff from games where external_game_id='5005'")).kickoff;
        let sourceReads = 0;
        const worker = createScheduledObservationHandler({
          env: {
            QB_OBSERVATION_ENABLED: 'true', QB_OBSERVATION_SECRET: secret,
            QB_OBSERVATION_SUPABASE_URL: origin, QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY: apiKey,
          },
          readSchedule: async () => ({ firstKickoffAt: kickoff, games: [{
            id: '5005', kickoffAt: kickoff, teams: ['WAS', 'BUF'],
            phase: 'pre', qbs: [{ name: 'Current QB' }, { name: 'Bills QB' }],
          }] }),
          fetcher: async (url, options) => {
            if (url === origin + '/rest/v1/rpc/qb_observer_exchange') {
              assert.equal(options.headers.apikey, apiKey);
              assert.equal(options.headers.Authorization, undefined);
              return Response.json(await send(JSON.parse(options.body)));
            }
            assert.equal(url, sleeperUrl);
            sourceReads++;
            return Response.json({ qb: {
              position: 'QB', team: 'WAS', espn_id: '99', full_name: 'Current QB',
              status: 'Active', injury_status: 'Out',
            } });
          },
        });
        const event = { source: 'aws.scheduler', 'detail-type': 'qb-observation', detail: { version: 1 } };
        assert.deepEqual(await worker(event), { status: 'stored' });
        assert.deepEqual(await worker(event), { status: 'already_dispatched' });
        assert.equal(sourceReads, 1);
        assert.equal((await one("select status from qb_observation.runs")).status, 'completed');
        assert.equal((await one("select decision->>'reason' reason from qb_observation.entries")).reason, 'sleeper_unavailable');
        assert.deepEqual(await criticalState(), before);
        assert.deepEqual(await one('select enabled,automation_enabled from qb_observation.regular_menu_config'),
          { enabled: false, automation_enabled: false });
      } finally { await sql('rollback'); }
    });

    await t.test('a configuration update before kickoff is rolled back when commit crosses kickoff', async () => {
      const game = await one("select game_date from games where external_game_id='5005';");
      try {
        const changed = await one(`update games set game_date=clock_timestamp()+interval '300 milliseconds'
          where external_game_id='5005' returning game_date;`);
        await sql('begin');
        await sql('update qb_observation.regular_menu_config set automation_enabled=true');
        const expiry = new Date(changed.game_date).getTime();
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now()) + 25));
        await assert.rejects(sql('commit'), /gelé au premier coup/);
        assert.deepEqual(await one('select enabled,automation_enabled from qb_observation.regular_menu_config'),
          { enabled: false, automation_enabled: false });
      } finally {
        await sql('rollback');
        await query("update games set game_date=$1 where external_game_id='5005'", [game.game_date]);
      }
    });

    await t.test('a durable daily claim survives lost responses without a harvested cache', async () => {
      const first = await nextRequest();
      assert.equal(first.payload.allowSleeperFetch, true);
      assert.equal(first.payload.sourceState, null);
      const claim = await one('select sleeper_requested_at from qb_observation.runs where run_id=$1', [first.payload.runId]);
      assert.ok(claim.sleeper_requested_at);
      await query("update qb_observation.runs set dispatched_at=clock_timestamp()-interval '11 minutes' where run_id=$1", [first.payload.runId]);
      const second = await nextRequest(); // Previous worker response was lost.
      assert.equal(second.payload.allowSleeperFetch, false);
      assert.equal(second.payload.sourceState, null);
      assert.equal((await one('select sleeper_requested_at from qb_observation.runs where run_id=$1', [second.payload.runId])).sleeper_requested_at, null);
      assert.deepEqual((await one('select sleeper_requested_at from qb_observation.runs where run_id=$1', [first.payload.runId])).sleeper_requested_at, claim.sleeper_requested_at);
      assert.equal((await one('select count(*)::int n from qb_observation.runs where sleeper_requested_at is not null')).n, 1);
      await sql(`update qb_observation.runs set sleeper_requested_at=clock_timestamp()-interval '25 hours'
          where sleeper_requested_at is not null;
        update qb_observation.runs set dispatched_at=clock_timestamp()-interval '11 minutes' where status='pending'`);
      const third = await nextRequest();
      assert.equal(third.payload.allowSleeperFetch, true);
      assert.equal(third.payload.sourceState, null);
      assert.ok((await one('select sleeper_requested_at from qb_observation.runs where run_id=$1', [third.payload.runId])).sleeper_requested_at);
      await query("update qb_observation.runs set status='response_failed',reason='test_lost_response' where run_id=$1", [third.payload.runId]);
    });

    await t.test('state stays private and signed observation mode changes no existing selection or offer', async () => {
      await assert.rejects(role(member, () => sql('select source_state from qb_observation.runs')), /permission denied/);
      await assert.rejects(role(member, () => sql('update qb_observation.regular_menu_config set automation_enabled=true')), /permission denied/);
      const request = await nextRequest();
      assert.equal(request.payload.sourceState, null);
      const result = await respond(request, sourceState(request));
      assert.equal(result.status, 'completed');
      assert.equal(result.source_state.absences.length, 1);
      assert.deepEqual(await criticalState(), before);
      assert.deepEqual(await menu(), { enabled: false, qbs: [] });
    });

    await t.test('daily cache survives fresh requests and repeated signals keep one journal entry', async () => {
      const first = await one('select id,first_detected_at from qb_observation.entries');
      const request = await nextRequest();
      assert.equal(request.payload.sourceState.sleeper.players[0].id, '99');
      const result = await respond(request, sourceState(request));
      assert.equal(result.status, 'completed');
      const rows = (await query('select id,first_detected_at,last_detected_at,run_id from qb_observation.entries')).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, first.id);
      assert.deepEqual(rows[0].first_detected_at, first.first_detected_at);
      assert.equal(rows[0].run_id, request.payload.runId);
      const log = await role(admin, async () => (await one('select public.read_qb_observation_log() result')).result);
      assert.equal(log.entries[0].reason, 'sleeper_unavailable');
      assert.equal(log.entries[0].currentSignal, true);
      assert.equal(log.entries[0].newQB, null);
      assert.equal(log.runs[0].sourceState.version, 1);
    });

    await t.test('only enabled automation suppresses an offer and never promotes a catalog backup', async () => {
      await sql('update qb_observation.regular_menu_config set enabled=true');
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '99'));
      await sql('update qb_observation.regular_menu_config set automation_enabled=true');
      assert.ok(!(await menu()).qbs.some(row => ['99','100'].includes(row.espn_athlete_id)));
      assert.equal((await adminMenu()).teams.find(row => row.abbr === 'WAS').qbId, null);
      const absenceEntry = await one("select id from qb_observation.entries where decision->>'reason'='sleeper_unavailable'");
      await assert.rejects(role(admin, () => query(
        "select public.manage_regular_qb_menu(2026,5,'WAS','assign',null,'Aucun remplaçant identifié',$1)", [absenceEntry.id]
      )), /identité non vérifiée/);
      await assert.rejects(role(member, () => query(
        'insert into qb_picks(season,week,user_id,qb_id) values(2026,5,$1,$2)', [member,qb['99']])), /plus admissibles/);
      await sql(`update qbs set is_active_starter=false where espn_athlete_id='99';
        update qbs set is_active_starter=true where espn_athlete_id='100'`);
      assert.ok(!(await menu()).qbs.some(row => row.espn_athlete_id === '100'));
      await sql(`update qbs set is_active_starter=true where espn_athlete_id='99';
        update qbs set is_active_starter=false where espn_athlete_id='100'`);
    });

    await t.test('Active, missing rows and a failed refresh preserve sticky absence; failed refresh keeps its attempt', async () => {
      const request = await nextRequest();
      const state = sourceState(request, { absences: [], sleeper: {
        attemptedAt: new Date().toISOString(), fetchedAt: request.payload.sourceState.sleeper.fetchedAt, players: [],
      } });
      state.observedAt = new Date().toISOString();
      const result = await respond(request, state, { status: 'failed', reason: 'collection_error', decisions: [] });
      assert.equal(result.status, 'failed');
      assert.equal(result.source_state.absences.length, 1);
      assert.equal(result.source_state.sleeper.attemptedAt, state.sleeper.attemptedAt);
      assert.ok(!(await menu()).qbs.some(row => row.espn_athlete_id === '99'));
    });

    await t.test('an explicit Admin confirmation can restore the same athlete without resetting reservations', async () => {
      await assign(qb['99']);
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '99'));
      const first = await one('select updated_at from qb_observation.regular_menu_overrides');
      await assign(qb['99'], 'Nouvelle confirmation explicite du même joueur');
      const second = await one('select updated_at from qb_observation.regular_menu_overrides');
      assert.ok(Date.parse(second.updated_at) >= Date.parse(first.updated_at));

      const oldSignal = await one("select id from qb_observation.entries where decision->>'reason'='sleeper_unavailable'");
      await role(admin, () => query('select public.dismiss_qb_observation_candidate($1)', [oldSignal.id]));
      const dismissedLog = await role(admin, async () => (await one('select public.read_qb_observation_log() result')).result);
      const dismissedSignal = dismissedLog.entries.find(row => row.entryId === oldSignal.id);
      assert.ok(dismissedSignal.dismissedAt);
      assert.equal(dismissedSignal.currentSignal, false);

      // A real second unavailable transition rearms the guard. Repeating OUT
      // alone must not revoke a later explicit confirmation on every passage.
      let request = await nextRequest();
      const active = sourceState(request);
      active.sleeper.players[0].injuryStatus = null;
      await respond(request, active, { decisions: [decision(request, {
        reason: 'sleeper_return_review', newQB: request.payload.baseline.WAS,
        espnAthleteId: request.payload.baseline.WAS.id,
      })] });
      await assign(qb['99'], 'Retour vérifié après le relevé Active');
      request = await nextRequest();
      const unavailable = sourceState(request);
      const signalCount = (await one("select count(*)::int n from qb_observation.entries where decision->>'reason'='sleeper_unavailable'")).n;
      await respond(request, unavailable);
      assert.ok(!(await menu()).qbs.some(row => row.espn_athlete_id === '99'));
      const newSignal = await one("select id,dismissed_at from qb_observation.entries where run_id=$1 and decision->>'reason'='sleeper_unavailable'", [request.payload.runId]);
      assert.notEqual(newSignal.id, oldSignal.id);
      assert.equal(newSignal.dismissed_at, null);
      assert.equal((await one("select count(*)::int n from qb_observation.entries where decision->>'reason'='sleeper_unavailable'")).n, signalCount + 1);
      const rearmed = (await one('select qb_observation.latest_source_state(2026) state')).state.absences[0].since;
      assert.equal(rearmed, unavailable.absences[0].since);
      await assign(qb['99'], 'Identité et disponibilité de nouveau vérifiées');
      request = await nextRequest();
      await respond(request, sourceState(request));
      assert.equal((await one("select count(*)::int n from qb_observation.entries where decision->>'reason'='sleeper_unavailable'")).n, signalCount + 1);
      assert.equal((await one('select qb_observation.latest_source_state(2026) state')).state.absences[0].since, rearmed);
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '99'));

      await role(member, () => query('insert into qb_picks(season,week,user_id,qb_id) values(2026,5,$1,$2)', [member,qb['99']]));
      const selected = await one('select * from qb_picks where week=5');
      await assign(qb['100']);
      assert.ok(!(await menu(other)).qbs.some(row => row.espn_athlete_id === '100'));
      assert.deepEqual(await one('select * from qb_picks where week=5'), selected);
      assert.equal((await one('select count(*)::int n from qb_observation.regular_menu_reservations')).n, 1);
    });

    await t.test('invalid signatures and malformed states never replace the durable state', async () => {
      const previous = (await one('select qb_observation.latest_source_state(2026) state')).state;
      let request = await nextRequest();
      await assert.rejects(respond(request, sourceState(request), {}, false), /authentication refused/);
      assert.deepEqual((await one('select qb_observation.latest_source_state(2026) state')).state, previous);
      await query("update qb_observation.runs set dispatched_at=clock_timestamp()-interval '3 minutes' where run_id=$1", [request.payload.runId]);
      request = await nextRequest();
      const bad = sourceState(request);
      bad.sleeper.players.push({ ...bad.sleeper.players[0] });
      assert.equal((await respond(request, bad)).status, 'ignored');
      assert.deepEqual((await one('select qb_observation.latest_source_state(2026) state')).state, previous);
      await query("update qb_observation.runs set dispatched_at=clock_timestamp()-interval '3 minutes' where run_id=$1", [request.payload.runId]);
    });

    await t.test('new absences require a current, exact unavailable identity and bounded source state', async () => {
      const previous = (await one('select qb_observation.latest_source_state(2026) state')).state;
      for (const fault of ['INACTIVE', 'before opening', 'wrong identity', 'too many players', 'future fetch']) {
        const request = await nextRequest();
        const at = new Date().toISOString();
        const state = sourceState(request, { sleeper: { attemptedAt: at, fetchedAt: at, players: [
          { id: '123', name: 'Bills QB', team: 'BUF', status: 'ACTIVE', injuryStatus: 'OUT' },
        ] }, absences: [{ id: '123', name: 'Bills QB', team: 'BUF', since: at, reason: 'sleeper_unavailable' }] });
        if (fault === 'INACTIVE') {
          state.sleeper.players[0].status = 'INACTIVE';
          state.sleeper.players[0].injuryStatus = null;
        } else if (fault === 'before opening') {
          state.sleeper.fetchedAt = new Date(Date.parse(request.payload.openedAt) - 1000).toISOString();
        } else if (fault === 'wrong identity') state.sleeper.players[0].name = 'Different QB';
        else if (fault === 'too many players') state.sleeper.players = Array(257).fill(state.sleeper.players[0]);
        else state.sleeper.fetchedAt = new Date(Date.parse(at) + 60_000).toISOString();
        const result = await respond(request, state);
        assert.equal(result.status, 'ignored', fault);
        assert.deepEqual((await one('select qb_observation.latest_source_state(2026) state')).state, previous, fault);
        await query("update qb_observation.runs set dispatched_at=clock_timestamp()-interval '3 minutes' where run_id=$1", [request.payload.runId]);
      }
      const request = await nextRequest();
      const state = sourceState(request);
      state.absences.push({ id: '123', name: 'Bills QB', team: 'BUF', since: state.observedAt, reason: 'sleeper_unavailable' });
      state.sleeper.players.push({ id: '123', name: 'Bills QB', team: 'BUF', status: 'OUT', injuryStatus: null });
      const result = await respond(request, state, { status: 'failed', reason: 'collection_error', decisions: [] });
      assert.equal(result.status, 'failed');
      assert.deepEqual(result.source_state.absences, previous.absences); // cache attempt is not a new exclusion
    });

    await t.test('new structured candidates retain exact Admin checks and cannot release a reserved team', async () => {
      let request = await nextRequest();
      const candidate = decision(request, { reason: 'source_conflict', newQB: { id: '101', name: 'Review QB' }, espnAthleteId: '101' });
      const result = await respond(request, sourceState(request), { decisions: [candidate] });
      assert.equal(result.status, 'completed');
      const entry = await one("select id from qb_observation.entries where decision->>'reason'='source_conflict'");
      const confirm = actor => role(actor, () => one(
        "select public.manage_regular_qb_menu(2026,5,'WAS','assign',null,'Annonce explicite liée au match',$1) result", [entry.id]));
      await assert.rejects(confirm(member), /Administrator required/);
      await confirm(admin);
      const qbRow = await one("select active,is_active_starter from qbs where espn_athlete_id='101'");
      assert.deepEqual(qbRow, { active: false, is_active_starter: false });
      assert.ok(!(await menu(other)).qbs.some(row => row.espn_athlete_id === '101'));
      assert.equal((await one('select count(*)::int n from qb_observation.regular_menu_reservations')).n, 1);
      request = await nextRequest();
      await respond(request, sourceState(request), { decisions: [decision(request, {
        reason: 'sleeper_return_review', newQB: request.payload.baseline.WAS,
        espnAthleteId: request.payload.baseline.WAS.id,
      })] });
      const returning = await one("select id from qb_observation.entries where decision->>'reason'='sleeper_return_review'");
      await role(admin, () => query('select public.dismiss_qb_observation_candidate($1)', [returning.id]));
      assert.ok((await one('select dismissed_at from qb_observation.entries where id=$1', [returning.id])).dismissed_at);
    });

    await t.test('a confirmed return survives the next week while a prior backup never clears the injured athlete', async () => {
      const openNextWeek = () => sql(`update settings set current_week=6 where id=1;
        insert into qb_selection_weeks(season,week,started_at) values(2026,6,now()-interval '1 minute');
        insert into games(external_game_id,season,week,home_team,away_team,game_date,is_pool_eligible)
          values('5006',2026,6,'Washington Commanders','Buffalo Bills',now()+interval '2 days',true)`);
      await sql('begin');
      try {
        await assign(qb['99'], 'Retour du même athlète confirmé');
        await openNextWeek();
        assert.ok((await menu(other,6)).qbs.some(row => row.espn_athlete_id === '99'));
        // The earlier tests validate rearming from new source proof. A renewed
        // transition must also supersede a return confirmed in an earlier week.
        await sql(`update qb_observation.runs set source_state=jsonb_set(source_state,'{absences,0,since}',
          to_jsonb(qb_observation.iso(clock_timestamp()))) where run_id=(
            select run_id from qb_observation.runs where source_state is not null
            order by observed_at desc,dispatched_at desc,run_id desc limit 1)`);
        assert.ok(!(await menu(other,6)).qbs.some(row => row.espn_athlete_id === '99'));
      } finally { await sql('rollback'); }
      await sql('begin');
      try {
        await assign(qb['100'], 'Remplaçant confirmé, sans confirmation du retour de 99');
        await openNextWeek();
        const next = await menu(other,6);
        assert.ok(!next.qbs.some(row => row.espn_athlete_id === '99'));
        assert.ok(!next.qbs.some(row => row.espn_athlete_id === '100')); // Weekly backup is not promoted next week.
      } finally { await sql('rollback'); }
    });

    await t.test('an excluded weekly replacement remains the baseline instead of the catalog starter', async () => {
      let request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '101'); // Confirmed weekly replacement, catalog still 99.
      const state = sourceState(request);
      state.sleeper.players = [{ ...request.payload.baseline.WAS, team: 'WAS', status: 'OUT', injuryStatus: null }];
      state.absences.push({ ...request.payload.baseline.WAS, team: 'WAS',
        since: state.observedAt, reason: 'sleeper_unavailable' });
      const result = await respond(request, state);
      assert.equal(result.status, 'completed');
      assert.equal((await adminMenu()).teams.find(row => row.abbr === 'WAS').qbId, null);
      request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '101');
      assert.equal(request.payload.baseline.WAS.name, 'Review QB');
      assert.equal((await adminMenu()).teams.find(row => row.abbr === 'WAS').qbId, null);
      await respond(request, sourceState(request, { sleeper: request.payload.sourceState.sleeper,
        absences: request.payload.sourceState.absences }));
    });

    await t.test('next week carries the absence but no automatic return; the season boundary isolates it', async () => {
      await sql(`update settings set current_week=6 where id=1;
        insert into qb_selection_weeks(season,week,started_at) values(2026,6,now()-interval '1 minute');
        insert into games(external_game_id,season,week,home_team,away_team,game_date,is_pool_eligible)
          values('5006',2026,6,'Washington Commanders','Buffalo Bills',now()+interval '2 days',true);`);
      const request = await nextRequest();
      assert.ok(request.payload.sourceState.absences.some(row => row.id === '99'));
      assert.ok(!(await menu(other,6)).qbs.some(row => row.espn_athlete_id === '99'));
      assert.equal((await one('select qb_observation.latest_source_state(2027) state')).state, null);
      const state = sourceState(request, { absences: [], sleeper: { attemptedAt: null, fetchedAt: null, players: [] } });
      await sql('update settings set revision=revision+1 where id=1');
      const result = await respond(request, state);
      assert.equal(result.source_state, null); // valid signed response, stale lifecycle context

      const phaseRequest = await nextRequest();
      const before = await criticalState();
      await sql("update settings set phase='playoffs' where id=1");
      const phaseResult = await respond(phaseRequest, sourceState(phaseRequest));
      assert.equal(phaseResult.source_state, null);
      assert.deepEqual(await criticalState(), before);
      await sql("update settings set phase='regular' where id=1");
    });

    await t.test('crossing the first kickoff harvests the journal without authorizing state or a menu write', async () => {
      const request = await nextRequest();
      const previous = (await one('select qb_observation.latest_source_state(2026) state')).state;
      const before = await criticalState();
      const menuBefore = await menu(other,6);
      assert.ok(menuBefore.qbs.some(row => row.espn_athlete_id === '123'));
      await sql("update games set game_date=clock_timestamp()+interval '100 milliseconds' where external_game_id='5006'");
      const lateState = sourceState(request);
      lateState.sleeper.players.push({ id: '123', name: 'Bills QB', team: 'BUF', status: 'OUT', injuryStatus: null });
      lateState.absences.push({ id: '123', name: 'Bills QB', team: 'BUF', since: lateState.observedAt, reason: 'sleeper_unavailable' });
      const kickoff = await one("select game_date from games where external_game_id='5006'");
      const kickoffMs = new Date(kickoff.game_date).getTime();
      assert.ok(Date.parse(lateState.observedAt) < kickoffMs);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, kickoffMs - Date.now()) + 25));
      const result = await respond(request, lateState);
      assert.equal(result.status, 'completed');
      assert.equal(result.source_state, null);
      assert.deepEqual((await one('select qb_observation.latest_source_state(2026) state')).state, previous);
      assert.deepEqual(await criticalState(), before);
      assert.deepEqual(await menu(other,6), menuBefore);
      await assert.rejects(role(admin, () => one(
        "select public.manage_regular_qb_menu(2026,6,'WAS','assign',$1,'Trop tard') result", [qb['99']])), /gelé/);
      const flagsBefore = await one('select enabled, automation_enabled from qb_observation.regular_menu_config');
      assert.deepEqual(flagsBefore, { enabled: true, automation_enabled: true });
      for (const flag of ['enabled', 'automation_enabled']) {
        await assert.rejects(sql(`update qb_observation.regular_menu_config set ${flag}=false`), /gelé|fin de la semaine/);
      }
      assert.deepEqual(await one('select enabled, automation_enabled from qb_observation.regular_menu_config'), flagsBefore);
      assert.deepEqual(await menu(other,6), menuBefore);
    });
  } finally {
    await db.close();
  }
});
