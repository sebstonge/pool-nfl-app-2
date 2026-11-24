import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const admin = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const fourth = '00000000-0000-0000-0000-000000000004';
const migrations = [
  '202609240001_playoff_seeds.sql', '202609250001_playoff_round_admin.sql',
  '202609290001_playoff_scoring.sql', '202609300001_notification_reminders.sql',
  '202610040001_lifecycle_foundation.sql', '202610050001_regular_final_publication.sql',
  '202610070001_lifecycle_transition.sql', '202610080001_playoff_atomic_advance.sql',
  '202610090001_lifecycle_completion.sql', '202610190001_regular_qb_selection_snapshot.sql',
  '20261025164727_regular_ties_admin_robustness.sql', '20261105132645_qb_observation_log.sql',
];

test('regular weekly QB menu in disposable PostgreSQL', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const sql = text => db.exec(text);
  const query = (text, params = []) => db.query(text, params);
  const one = async (text, params) => (await query(text, params)).rows[0];
  const role = async (actor, task, name = 'authenticated') => {
    await query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await sql(`set role ${name}`);
    try { return await task(); }
    finally { await sql('reset role'); }
  };
  const migration = file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
  const read = async (actor, week = 5) => role(actor, async () => (await one(
    'select public.read_regular_qb_menu(2026, $1) result', [week]
  )).result);
  const readAdmin = async actor => role(actor, async () => (await one(
    'select public.read_regular_qb_menu_admin() result'
  )).result);
  const assign = (actor, team, qb, entry = null, week = 5) => role(actor, async () => (await one(
    "select public.manage_regular_qb_menu(2026, $1, $2, 'assign', $3, 'Annonce vérifiée', $4) result",
    [week, team, qb, entry]
  )).result);
  const unavailable = team => role(admin, () => one(
    "select public.manage_regular_qb_menu(2026, 5, $1, 'unavailable', null, 'Joueur blessé') result", [team]
  ));
  const pick = (actor, qb, week = 5) => role(actor, () => one(
    'insert into public.qb_picks(season, week, user_id, qb_id) values(2026,$1,$2,$3) returning *',
    [week, actor, qb]
  ));
  const picks = async () => (await query(
    'select * from public.qb_picks order by week, user_id, id'
  )).rows;
  const ids = async actor => (await read(actor)).qbs.map(qb => qb.espn_athlete_id).sort();

  try {
    for (const file of ['lifecycle_fixture.sql', 'lifecycle_transition_fixture.sql']) {
      await sql(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    await sql(`
      update settings set current_season=2026 where id=1;
      insert into users(id,is_admin) values ('${admin}',true), ('${member}',false),
        ('${other}',false), ('${fourth}',false);
      insert into teams(name,espn_abbr) values
        ('Washington Commanders','WSH'),('Buffalo Bills','BUF'),
        ('Baltimore Ravens','BAL'),('Arizona Cardinals','ARI'),
        ('Philadelphia Eagles','PHI'),('Seattle Seahawks','SEA');
      insert into qbs(name,team,espn_athlete_id,active,is_active_starter) values
        ('Marcus Mariota','Commanders','2576980',true,true),
        ('Jayden Daniels','Washington Commanders','4426348',true,false),
        ('Josh Allen','Bills','3918298',true,true),
        ('Lamar Jackson','Ravens','3916387',true,true),
        ('Gardner Minshew','Cardinals','4038524',true,true),
        ('Jalen Hurts','Eagles','4040715',true,true),
        ('Sam Darnold','Seahawks','3912547',true,true);
      insert into qb_picks(user_id,qb_id,week)
        select '${admin}',id,1 from qbs where espn_athlete_id='2576980';
    `);
    for (const file of migrations) {
      const source = await migration(file);
      if (file === '202610090001_lifecycle_completion.sql') {
        await sql(source.slice(0, source.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP')) + 'commit;');
        await sql('update settings set regular_writes_paused = true where id = 1');
      }
      await sql(source);
    }
    await sql(`
      update settings set regular_writes_paused=false where id=1;
      update settings set current_week=5 where id=1;
      insert into season_participants(season,user_id,confirmed) values
        (2026,'${member}',true),(2026,'${other}',true),(2026,'${fourth}',true);
      select set_config('request.headers','{"x-pool-regular-schema":"20261009"}',false);
      insert into qb_selection_weeks(season,week,started_at) values(2026,5,now()-interval '1 hour');
      insert into games(external_game_id,season,week,home_team,away_team,game_date,is_pool_eligible)
      values
        ('5001',2026,5,'Washington Commanders','Buffalo Bills',now()+interval '1 day',false),
        ('5002',2026,5,'Baltimore Ravens','Arizona Cardinals',now()+interval '2 days',true),
        ('5003',2026,5,'Philadelphia Eagles','Seattle Seahawks',now()+interval '3 days',true);
      insert into qb_picks(season,week,user_id,qb_id)
        select 2026,3,'${member}',id from qbs where espn_athlete_id='3918298';
      insert into qb_picks(season,week,user_id,qb_id)
        select 2026,4,'${other}',id from qbs where espn_athlete_id='3912547';
      insert into qb_ratings(season,week,qb_id,passer_rating,actual_qb_name,actual_espn_athlete_id)
        select 2026,3,id,0,'Lamar Jackson','3916387' from qbs where espn_athlete_id='3918298';
    `);
    const qb = Object.fromEntries((await query('select espn_athlete_id, id from qbs')).rows
      .map(row => [row.espn_athlete_id, row.id]));
    const mariota = qb['2576980'], daniels = qb['4426348'], allen = qb['3918298'];
    const lamar = qb['3916387'], min = qb['4038524'], hurts = qb['4040715'];
    const initialPicks = await picks();
    await sql(await migration('202611060001_regular_weekly_qb_menu.sql'));

    await t.test('installation preserves choices and disabled mode preserves the legacy path', async () => {
      assert.deepEqual(await picks(), initialPicks);
      assert.deepEqual(await read(member), { enabled: false, qbs: [] });
      const chosen = await pick(admin, mariota); // legacy submission already present at activation
      assert.equal(chosen.selected_espn_athlete_id, '2576980');
      assert.equal((await one('select count(*)::int n from qb_observation.regular_menu_reservations')).n, 0);
      assert.equal((await readAdmin(admin)).open, false);
      assert.equal((await readAdmin(admin)).canCheck, true);
      await assert.rejects(assign(admin, 'WAS', daniels), /désactivé/);
    });

    await t.test('private tables and Admin actions reject ordinary users', async () => {
      await assert.rejects(readAdmin(member), /Administrator required/);
      await assert.rejects(assign(member, 'WAS', daniels), /Administrator required/);
      await assert.rejects(role(member, () => sql('select * from qb_observation.regular_menu_config')), /permission denied/);
      await assert.rejects(role('', () => sql('select public.read_regular_qb_menu(2026,5)'), 'anon'), /permission denied/);
    });

    await t.test('only authorized writers can change the rating evidence used for eligibility', async () => {
      const tamper = () => query("update qb_ratings set actual_espn_athlete_id='3918298' where week=3 returning id");
      assert.equal((await role(member, tamper)).rows.length, 0);
      assert.equal((await role(member, () => one('select actual_espn_athlete_id from qb_ratings where week=3')))
        .actual_espn_athlete_id, '3916387');
      await assert.rejects(role(member, () => query(
        "insert into qb_ratings(season,week,qb_id,passer_rating,actual_espn_athlete_id) values(2026,4,$1,80,'3916387')", [lamar]
      )), /row-level security/);
      assert.equal((await role(admin, () => query(
        `insert into qb_ratings(season,week,qb_id,passer_rating,actual_qb_name,actual_espn_athlete_id)
         select season,week,qb_id,passer_rating,actual_qb_name,actual_espn_athlete_id from qb_ratings where week=3
         on conflict(season,qb_id,week) do update set passer_rating=excluded.passer_rating returning id`
      ))).rows.length, 1);
    });

    await t.test('enabled mode respects proven actual usage, pending choice and pre-activation reservation', async () => {
      await sql('update qb_observation.regular_menu_config set enabled=true');
      assert.ok((await ids(member)).includes('3918298')); // selected Allen, actual Lamar
      assert.ok(!(await ids(member)).includes('3916387'));
      assert.ok(!(await ids(other)).includes('3912547')); // pending official result
      assert.ok(!(await ids(member)).includes('2576980')); // already reserved before activation
      const allenOffer = (await read(member)).qbs.find(q => q.espn_athlete_id === '3918298');
      assert.equal(allenOffer.menu_game_id, (await one("select id from games where external_game_id='5001'")).id);
      assert.equal(allenOffer.menu_is_home, false);
      assert.deepEqual(await read(member, 4), { enabled: true, qbs: [] });
      await assert.rejects(role(member, () => sql('delete from qb_picks where week=3')), /ne peut pas être annulé/);
      await assert.rejects(pick(member, lamar), /plus admissibles/);
      await assert.rejects(pick(member, min, 6), /Semaine ou participant QB invalide/);
      await assert.rejects(assign(admin, 'WAS', daniels), /calendrier non vérifié/);
    });

    const { run_id: runId } = await one(`
      insert into qb_observation.runs(season,week,revision,opened_at,period,first_kickoff_at,
        dispatched_at,observed_at,status,event_ids,baseline)
      select 2026,5,s.revision,w.started_at,0,c.first_kickoff_at,now(),now(),'completed',c.event_ids,'{}'
      from settings s, qb_selection_weeks w, qb_observation.calendar(2026,5) c
      where s.id=1 and w.season=2026 and w.week=5 returning run_id
    `);

    await t.test('confirmed correction before any selection changes only the weekly offer', async () => {
      assert.equal((await readAdmin(admin)).open, true);
      await assert.rejects(assign(admin, 'WAS', min), /autre équipe/);
      const before = await picks();
      await unavailable('ARI');
      assert.ok(!(await ids(member)).includes('4038524'));
      await assert.rejects(pick(member, min), /plus admissibles/);
      await assign(admin, 'ARI', min);
      assert.ok((await ids(member)).includes('4038524'));
      assert.deepEqual(await picks(), before);
    });

    await t.test('Mariota remains recorded and Washington remains reserved after the Daniels override', async () => {
      const before = await picks();
      assert.equal((await assign(admin, 'WSH', daniels)).qbId, daniels);
      assert.ok(!(await ids(member)).includes('4426348'));
      await assert.rejects(pick(member, daniels), /plus admissibles/);
      await assert.rejects(pick(member, mariota), /plus admissibles/);
      await assert.rejects(role(admin, () => sql('delete from qb_picks where week=5')), /ne peut pas être annulé/);
      assert.deepEqual(await picks(), before);
      const { baseline } = await one("select qb_observation.regular_menu_override_baseline(2026,5,'{}') baseline");
      assert.equal(baseline.WAS.id, '4426348');
      assert.equal((await one('select is_active_starter from qbs where id=$1',[daniels])).is_active_starter, false);
    });

    await t.test('Admin can confirm a fixture-scoped observation for a QB missing from the catalog', async () => {
      const { id: entryId } = await one(`
        insert into qb_observation.entries(season,week,url,source_key,run_id,decision,team,event_id,
          first_detected_at,last_detected_at,scoped_before_freeze)
        values(2026,5,'https://github.com/nflverse/nflverse-data/releases/tag/schedules','nflverse:5002:BAL:4429582',$1,
          '{"status":"ambiguous","reason":"nflverse_projection","espnAthleteId":"4429582","previousQB":{"id":"3916387","name":"Lamar Jackson"},"newQB":{"id":"4429582","name":"Joe Fagnano"}}',
          'BAL','5002',now(),now(),false) returning id
      `, [runId]);
      await assert.rejects(assign(admin, 'PHI', null, entryId), /identité non vérifiée/);
      const { qbId } = await assign(admin, 'BAL', null, entryId);
      assert.deepEqual(await one('select active,is_active_starter from qbs where id=$1',[qbId]),
        { active: false, is_active_starter: false });
      assert.ok((await ids(member)).includes('4429582'));
      assert.ok(!(await ids(other)).includes('3916387'));
      assert.equal((await assign(admin, 'BAL', null, entryId)).qbId, qbId);
      assert.equal((await one("select decision->>'reviewOutcome' review from qb_observation.entries where id=$1",[entryId])).review, 'confirmed');
      await assert.rejects(pick(other, lamar), /plus admissibles/);
    });

    await t.test('one transactional reservation for competing selections', async () => {
      const picked = await pick(member, allen);
      assert.equal(picked.selected_espn_athlete_id, '3918298');
      await assert.rejects(pick(other, allen), /plus admissibles/);
      assert.equal((await one('select count(*)::int n from qb_observation.regular_menu_reservations')).n, 1);
      const key = (await one(`
        select count(*)::int n from pg_constraint
        where conrelid='qb_observation.regular_menu_reservations'::regclass and contype='p'
      `)).n;
      assert.equal(key, 1);
      await assert.rejects(pick(member, hurts), /qb_picks_user_id_week_key/);
      assert.ok((await ids(fourth)).includes('4040715')); // failed second pick did not leave a reservation
    });

    await t.test('crossing kickoff during a catalog insert rolls back the entire correction', async () => {
      const { id: entryId } = await one(`
        insert into qb_observation.entries(season,week,url,source_key,run_id,decision,team,event_id,
          first_detected_at,last_detected_at,scoped_before_freeze)
        values(2026,5,'https://github.com/nflverse/nflverse-data/releases/tag/schedules','nflverse:5002:ARI:999001',$1,
          '{"status":"ambiguous","reason":"nflverse_projection","espnAthleteId":"999001","previousQB":{"id":"4038524","name":"Gardner Minshew"},"newQB":{"id":"999001","name":"Test QB"}}',
          'ARI','5002',now(),now(),false) returning id
      `, [runId]);
      const before = await one("select game_date from games where external_game_id='5001'");
      const priorOffers = (await query('select * from qb_observation.regular_menu_overrides order by team_id')).rows;
      await sql(`
        create function wait_until_kickoff() returns trigger language plpgsql as $$
        begin
          perform pg_sleep_until((select game_date from public.games where external_game_id='5001') + interval '25 ms');
          return new;
        end $$;
        create trigger wait_until_kickoff before insert on qbs for each row
          when (new.espn_athlete_id = '999001') execute function wait_until_kickoff();
        update games set game_date=clock_timestamp()+interval '1 second' where external_game_id='5001';
      `);
      try {
        assert.equal((await readAdmin(admin)).open, true);
        await assert.rejects(assign(admin, 'ARI', null, entryId), /gelé/);
        assert.equal(await one("select id from qbs where espn_athlete_id='999001'"), undefined);
        assert.deepEqual((await query('select * from qb_observation.regular_menu_overrides order by team_id')).rows, priorOffers);
        assert.equal((await one('select dismissed_at from qb_observation.entries where id=$1', [entryId])).dismissed_at, null);
      } finally {
        await sql('drop trigger wait_until_kickoff on qbs; drop function wait_until_kickoff()');
        await query("update games set game_date=$1 where external_game_id='5001'", [before.game_date]);
      }
    });

    await t.test('first NFL kickoff closes Admin writes even on an ineligible game; rollback disables the feature', async () => {
      const before = await picks();
      const offers = (await query('select * from qb_observation.regular_menu_overrides order by team_id')).rows;
      await sql("update games set game_date=now()-interval '1 second' where external_game_id='5001'");
      assert.equal((await readAdmin(admin)).open, false);
      await assert.rejects(assign(admin, 'WAS', mariota), /gelé/);
      await assert.rejects(unavailable('PHI'), /gelé/);
      assert.deepEqual(await picks(), before);
      assert.deepEqual((await query('select * from qb_observation.regular_menu_overrides order by team_id')).rows, offers);
      await assert.rejects(sql('update qb_observation.regular_menu_config set enabled=false'), /fin de la semaine active/);
      await sql('update settings set current_week=6 where id=1');
      await sql('update qb_observation.regular_menu_config set enabled=false');
      assert.deepEqual(await read(other), { enabled: false, qbs: [] });
    });
  } finally {
    await db.close();
  }
});
