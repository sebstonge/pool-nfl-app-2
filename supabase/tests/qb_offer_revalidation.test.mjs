import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
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

test('QB offer revalidation in disposable PostgreSQL', { skip: !process.env.PGLITE_MODULE }, async t => {
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
    await query('update qb_observation.transport_control set dispatch_enabled=true,hmac_secret=$1 where singleton', [secret]);
    const qb = Object.fromEntries((await query('select espn_athlete_id,id from qbs')).rows
      .map(row => [row.espn_athlete_id,row.id]));

    const log = () => role(admin, async () => (await one('select public.read_qb_observation_log() result')).result);
    const currentState = async () => (await one('select qb_observation.latest_source_state(2026) state')).state;
    const inTransaction = async task => {
      await sql('begin');
      try { await task(); }
      finally { await sql('rollback'); }
    };
    const projection = request => decision(request, {
      reason: 'nflverse_projection', url: 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz',
      newQB: { id: '100', name: 'Backup QB' }, espnAthleteId: '100',
    });
    const bootstrap = await nextRequest();
    const bootstrapState = sourceState(bootstrap, { absences: [] });
    bootstrapState.sleeper.players[0].injuryStatus = null;
    await respond(bootstrap, bootstrapState, { decisions: [projection(bootstrap)] });
    await sql('update qb_observation.regular_menu_config set enabled=true,automation_enabled=true');

    await t.test('an old-reference absence cannot hide a QB confirmed before that source observation', async () => inTransaction(async () => {
      const request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '99');
      await assign(qb['100'], 'Backup confirmé pendant la collecte');
      const confirmed = await one('select updated_at from qb_observation.regular_menu_overrides');
      const before = await criticalState();
      const claimsBefore = (await one('select count(*)::int n from qb_observation.runs where sleeper_requested_at is not null')).n;
      await new Promise(resolve => setTimeout(resolve, 5));
      const state = sourceState(request);
      assert.ok(Date.parse(state.absences[0].since) > new Date(confirmed.updated_at).getTime());
      const result = await respond(request, state, { decisions: [decision(request, {
        newQB: { id: '100', name: 'Backup QB' }, espnAthleteId: '100',
      })] });
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.source_state.absences, []);
      assert.equal(result.source_state.sleeper.fetchedAt, state.sleeper.fetchedAt);
      assert.equal(result.source_state.signals[0].key, 'review:stale_baseline');
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '100'));
      assert.deepEqual(await criticalState(), before);
      assert.equal((await one('select count(*)::int n from qb_observation.runs where sleeper_requested_at is not null')).n, claimsBefore);
      const stale = (await log()).entries.find(row => row.runId === request.payload.runId);
      assert.equal(stale.status, 'rejected');
      assert.equal(stale.reason, 'stale_baseline');
      assert.equal(stale.originalReason, 'sleeper_unavailable');
      assert.equal(stale.currentSignal, false);
      await query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
      await sql('set role authenticated; savepoint stale_candidate');
      try {
        await assert.rejects(query(
          "select public.manage_regular_qb_menu(2026,5,'WAS','assign',null,'Ancienne référence',$1)", [stale.entryId]
        ), /identité non vérifiée/);
      } finally { await sql('rollback to savepoint stale_candidate; reset role'); }
    }));

    await t.test('an obsolete candidate is journaled separately instead of replacing valid earlier evidence', async () => inTransaction(async () => {
      const original = await one("select * from qb_observation.entries where decision->>'reason'='nflverse_projection'");
      const request = await nextRequest();
      await assign(qb['100'], 'Correction confirmée après dispatch');
      const state = sourceState(request, { absences: [] });
      state.sleeper.players[0].injuryStatus = null;
      await respond(request, state, { decisions: [projection(request)] });
      assert.deepEqual(await one('select * from qb_observation.entries where id=$1', [original.id]), original);
      const stale = await one("select source_key,decision from qb_observation.entries where run_id=$1", [request.payload.runId]);
      assert.ok(stale.source_key.startsWith('stale:nflverse:'));
      assert.equal(stale.decision.reason, 'stale_baseline');
      assert.equal(stale.decision.originalReason, 'nflverse_projection');
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '100'));
    }));

    await t.test('an old-reference refresh cannot rearm a prior absence after another QB is confirmed', async () => inTransaction(async () => {
      let request = await nextRequest();
      await respond(request, sourceState(request));
      const originalSince = (await currentState()).absences[0].since;
      await assign(qb['99'], 'Retour du titulaire vérifié');
      request = await nextRequest();
      const active = sourceState(request);
      active.sleeper.players[0].injuryStatus = null;
      await respond(request, active, { decisions: [decision(request, {
        reason: 'sleeper_return_review', newQB: { id: '99', name: 'Current QB' }, espnAthleteId: '99',
      })] });
      request = await nextRequest();
      await assign(qb['100'], 'Un autre QB confirmé avant le nouveau relevé');
      await new Promise(resolve => setTimeout(resolve, 5));
      const result = await respond(request, sourceState(request));
      assert.equal(result.status, 'completed');
      assert.equal(result.source_state.absences[0].since, originalSince);
      assert.equal(result.source_state.sleeper.players[0].injuryStatus, 'OUT');
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '100'));
    }));

    await t.test('Admin confirmation uses the excluded weekly replacement as its reference', async () => inTransaction(async () => {
      await assign(qb['100'], 'Titulaire hebdomadaire confirmé');
      let request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '100');
      const at = new Date().toISOString();
      const state = sourceState(request, {
        sleeper: { attemptedAt: at, fetchedAt: at, players: [
          { id: '100', name: 'Backup QB', team: 'WAS', status: 'ACTIVE', injuryStatus: 'OUT' },
        ] },
        absences: [{ id: '100', name: 'Backup QB', team: 'WAS', since: at, reason: 'sleeper_unavailable' }],
      });
      state.observedAt = at;
      await respond(request, state);
      assert.equal((await adminMenu()).teams.find(row => row.abbr === 'WAS').qbId, null);
      request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '100');
      const updated = sourceState(request, { sleeper: request.payload.sourceState.sleeper,
        absences: request.payload.sourceState.absences });
      await respond(request, updated, { decisions: [decision(request, {
        newQB: { id: '101', name: 'New Verified QB' }, espnAthleteId: '101',
      })] });
      const entry = (await log()).entries.find(row => row.runId === request.payload.runId);
      assert.equal(entry.currentSignal, true);
      const result = await role(admin, () => one(
        "select public.manage_regular_qb_menu(2026,5,'WAS','assign',null,'Annonce vérifiée pour ce match',$1) result", [entry.entryId]
      ));
      assert.ok(result.result.qbId);
      assert.ok((await menu()).qbs.some(row => row.espn_athlete_id === '101'));
      assert.deepEqual(await one("select active,is_active_starter from qbs where espn_athlete_id='101'"),
        { active: false, is_active_starter: false });
      assert.equal((await one("select is_active_starter from qbs where espn_athlete_id='99'")).is_active_starter, true);
    }));

    await t.test('Admin replacement commits as authenticated and survives a report about the former QB', async () => {
      assert.deepEqual(await one(`select p.prosecdef as runs_as_owner,
        has_schema_privilege('authenticated', 'qb_observation', 'USAGE') as schema_access,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as direct_execution
        from pg_proc p where p.oid = 'qb_observation.check_regular_menu_freeze()'::regprocedure`),
      { runs_as_owner: true, schema_access: false, direct_execution: false });
      const request = await nextRequest();
      assert.equal(request.payload.baseline.WAS.id, '99');

      await sql('begin');
      try {
        await query("select set_config('request.jwt.claim.sub', $1, true)", [admin]);
        await sql('set local role authenticated');
        const assignment = await one(
          "select public.manage_regular_qb_menu(2026,5,'WAS','assign',$1,'Confirmed replacement') result", [qb['100']]
        );
        assert.equal(assignment.result.qbId, qb['100']);
        await sql('commit');
      } catch (error) {
        await sql('rollback');
        throw error;
      }

      const result = await respond(request, sourceState(request));
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.source_state.absences, []);
      const currentQbs = (await menu()).qbs;
      assert.ok(currentQbs.some(row => row.espn_athlete_id === '100'));
      assert.ok(!currentQbs.some(row => row.espn_athlete_id === '99'));
      const stale = (await log()).entries.find(row => row.runId === request.payload.runId);
      assert.equal(stale.status, 'rejected');
      assert.equal(stale.reason, 'stale_baseline');
    });
  } finally {
    await db.close();
  }
});
