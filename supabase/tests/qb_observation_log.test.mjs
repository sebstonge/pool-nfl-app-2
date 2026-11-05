import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const admin = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const secret = 'test-only-0123456789abcdef-0123456789abcdef';
const origin = 'https://www.commanders.com';
const migration = new URL('../migrations/20261105132645_qb_observation_log.sql', import.meta.url);
const hmac = bytes => createHmac('sha256', secret).update(bytes).digest('hex');

test('QB observation journal in disposable PostgreSQL', { skip: !process.env.PGLITE_MODULE }, async t => {
  const moduleUrl = pathToFileURL(process.env.PGLITE_MODULE);
  const { PGlite } = await import(moduleUrl.href);
  const { pgcrypto } = await import(new URL('contrib/pgcrypto.js', moduleUrl).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  const sql = statement => db.exec(statement);
  const query = (statement, params = []) => db.query(statement, params);
  const one = async (statement, params) => (await query(statement, params)).rows[0];
  const tick = async () => (await one('select public.run_qb_observation_tick() result')).result;
  const journal = async (limit = 20) => (await one('select public.read_qb_observation_log($1) result', [limit])).result;
  const as = async (role, who, task) => {
    await query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
    await sql(`set role ${role}`);
    try { return await task(); }
    finally { await sql('reset role'); }
  };
  const adminJournal = limit => as('authenticated', admin, () => journal(limit));
  const queue = async () => (await query('select id, url, headers, convert_from(body,\'UTF8\') raw, timeout_milliseconds from net.queue order by id')).rows;
  const lastRequest = async () => {
    const request = (await queue()).at(-1);
    return { ...request, payload: JSON.parse(request.raw) };
  };
  const state = async () => (await one(`
    select jsonb_build_object(
      'settings', (select jsonb_agg(to_jsonb(s)) from public.settings s),
      'games', (select jsonb_agg(to_jsonb(g) order by external_game_id) from public.games g),
      'qbs', (select jsonb_agg(to_jsonb(q) order by espn_athlete_id) from public.qbs q),
      'teams', (select jsonb_agg(to_jsonb(t) order by name) from public.teams t),
      'weekly_scores', (select jsonb_agg(to_jsonb(s)) from public.weekly_scores s),
      'qb_weekly_stats', (select jsonb_agg(to_jsonb(s)) from public.qb_weekly_stats s),
      'weeks', (select jsonb_agg(to_jsonb(w) order by season, week) from public.qb_selection_weeks w),
      'picks', (select jsonb_agg(to_jsonb(p)) from public.picks p),
      'qb_picks', (select jsonb_agg(to_jsonb(p)) from public.qb_picks p),
      'qb_ratings', (select jsonb_agg(to_jsonb(r)) from public.qb_ratings r),
      'users', (select jsonb_agg(to_jsonb(u) order by id) from public.users u)
    ) state`
  )).state;
  // Move the recorded fixture claim into a past bucket without changing the real clock.
  const nextBucket = () => sql(`update qb_observation.runs
    set period = (select least(min(period), 0) - 1 from qb_observation.runs) where period >= 0`);
  const report = (request, fields = {}) => {
    const { runId, season, week, revision, firstKickoffAt } = request.payload;
    return { mode: 'observation', runId, season, week, revision, firstKickoffAt, status: 'completed',
      observedAt: new Date().toISOString(), decisions: [], errors: [], ...fields };
  };
  const respond = async (request, body, { status = 200, timedOut = false, sign = true, created = null } = {}) => {
    const raw = JSON.stringify(body);
    const envelope = JSON.stringify({ report: raw, signature: hmac(sign ? raw : 'different body') });
    await query(`insert into net._http_response (id, status_code, content, timed_out, created)
      values ($1,$2,$3,$4,coalesce($5,now()))`, [request.id, status, envelope, timedOut, created]);
  };
  const decision = (request, slug, publishedAt, fields = {}) => ({
    team: 'WAS', match: { id: '10001', opponent: 'BUF', kickoffAt: request.payload.firstKickoffAt },
    previousQB: { id: '99', name: 'Current QB' }, newQB: { id: '100', name: 'Replacement QB' },
    espnAthleteId: '100', publishedAt, url: `${origin}/news/${slug}`, title: 'Club names a starter',
    evidence: 'Replacement QB will start against Buffalo.', status: 'proposed', reason: 'starter_confirmed',
    ...fields,
  });

  try {
    await sql(await readFile(new URL('./lifecycle_fixture.sql', import.meta.url), 'utf8'));
    await sql(`
      alter table settings add column phase text not null default 'regular',
        add column revision bigint not null default 0, add column regular_finalized_at timestamptz,
        add column regular_writes_paused boolean not null default false;
      alter table qb_selection_weeks add column season integer not null default 2026;
      drop index qb_selection_weeks_pkey;
      create unique index qb_selection_weeks_pkey on qb_selection_weeks(season, week);
      insert into users(id,is_admin) values ('${admin}',true), ('${member}',false);
      insert into teams(name,espn_abbr) values ('Washington Commanders','wsh'), ('Buffalo Bills','BUF'),
        ('Philadelphia Eagles','PHI'), ('Arizona Cardinals','ARI');
      insert into qbs(name,team,espn_athlete_id,active,is_active_starter) values
        ('Current QB','Commanders','99',true,true), ('Old QB','Commanders','96',false,true),
        ('Backup QB','Commanders','97',true,false), ('One Bills QB','Buffalo Bills','123',true,true),
        ('Other Bills QB','Bills',null,true,true), ('Eagles QB','Philadelphia Eagles','124',true,true);
      insert into games(external_game_id, season, week, home_team, away_team, game_date, is_pool_eligible, season_type)
      values ('10000',2026,5,'Washington Commanders','Buffalo Bills',now()-interval '1 day',false,'preseason'),
        ('10001',2026,5,'Washington Commanders','Buffalo Bills',now()+interval '1 day',false,'regular'),
        ('10002',2026,5,'Philadelphia Eagles','Arizona Cardinals',now()+interval '2 days',true,'regular'),
        ('10003',2025,5,'Washington Commanders','Buffalo Bills',now()-interval '365 days',true,'regular');
      insert into qb_selection_weeks(season,week,started_at) values (2025,5,now()-interval '365 days');
      insert into picks(user_id,game_id,picked_team,predicted_spread)
        select '${member}',id,'Buffalo Bills',3 from games where external_game_id='10001';
      insert into qb_picks(user_id,qb_id,week) select '${member}',id,5 from qbs where espn_athlete_id='99';
      insert into qb_ratings(qb_id,week,passer_rating) select id,5,95 from qbs where espn_athlete_id='99';
    `);
    const initial = await state();
    await sql(await readFile(migration, 'utf8'));
    assert.deepEqual(await state(), initial);

    await t.test('owner alone can tick and only an authenticated administrator can read the journal', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await as(role, admin, async () => {
          await assert.rejects(tick(), /permission denied/);
          await assert.rejects(sql('select * from qb_observation.entries'), /permission denied/);
          await assert.rejects(sql("update qb_observation.runs set status='completed'"), /permission denied/);
          if (role !== 'authenticated') await assert.rejects(journal(), /permission denied/);
        });
      }
      await assert.rejects(as('authenticated', member, () => journal()), /Administrator required/);
      await assert.rejects(as('authenticated', '', () => journal()), /Administrator required/);
      assert.deepEqual(await adminJournal(), { runs: [], entries: [] });
    });

    await t.test('dispatch requires the actual regular selection window and usable integration configuration', async () => {
      assert.equal((await tick()).status, 'outside_window'); // Only historical opening exists.
      await sql("insert into qb_selection_weeks(season,week,started_at) values(2026,5,now()+interval '1 hour')");
      assert.equal((await tick()).status, 'outside_window');
      await sql("update qb_selection_weeks set started_at=now()-interval '4 hours 1 minute' where season=2026");
      await sql("update settings set phase='playoffs'");
      assert.equal((await tick()).status, 'inactive');
      await sql("update settings set phase='regular',regular_writes_paused=true");
      assert.equal((await tick()).status, 'inactive');
      await sql('update settings set regular_writes_paused=false,regular_finalized_at=now()');
      assert.equal((await tick()).status, 'inactive');
      await sql('update settings set regular_finalized_at=null');
      await sql("update games set game_date=null where external_game_id='10002'");
      assert.equal((await tick()).status, 'outside_window');
      await sql("update games set game_date=now()+interval '2 days' where external_game_id='10002'");
      assert.equal((await tick()).status, 'dispatch_failed');
      assert.equal((await adminJournal()).runs[0].reason, 'vault_unavailable');
      assert.equal((await tick()).status, 'already_dispatched');
    });

    await sql(`
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create schema vault;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      insert into vault.decrypted_secrets values
        ('qb_observation_url','https://observer.example.com/api/cron/qb-observation'),
        ('qb_observation_secret','${secret}');
      create schema net;
      create table net._http_response(id bigint, status_code integer, content text, timed_out boolean,
        error_msg text, created timestamptz not null default clock_timestamp());
      create table net.queue(id bigint generated always as identity, url text, headers jsonb, body bytea, timeout_milliseconds integer);
      create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
        headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
      language sql as $$
        insert into net.queue(url,headers,body,timeout_milliseconds)
          values($1,$4,convert_to($2::text,'UTF8'),$5) returning id
      $$;
    `);

    await t.test('dispatch signs the exact pg_net bytes and deduplicates the open bucket and pending requests', async () => {
      await nextBucket();
      const before = await state();
      const outcome = await tick();
      assert.equal(outcome.status, 'dispatched');
      const request = await lastRequest();
      assert.equal(request.url, 'https://observer.example.com/api/cron/qb-observation');
      assert.equal(request.timeout_milliseconds, 55000);
      assert.deepEqual(request.headers, {
        'Content-Type': 'application/json', 'X-QB-Observation-Signature': hmac(request.raw),
      });
      assert.equal(request.payload.runId, outcome.runId);
      assert.deepEqual(request.payload.eventIds, ['10001', '10002']);
      assert.deepEqual(request.payload.baseline, {
        WAS: { id: '99', name: 'Current QB' }, PHI: { id: '124', name: 'Eagles QB' },
      });
      assert.deepEqual(request.payload.seenUrls, []);
      assert.deepEqual(request.payload.retryAfterByOrigin, {});
      const local = await one(`select qb_observation.iso(game_date) kickoff from games where external_game_id='10001'`);
      assert.equal(request.payload.firstKickoffAt, local.kickoff); // Non-pool game controls freeze.
      assert(Date.parse(request.payload.dispatchedAt) >= Date.parse(request.payload.openedAt));
      assert.equal((await tick()).status, 'already_dispatched');
      await nextBucket();
      assert.equal((await tick()).status, 'already_dispatched'); // Pending crosses the bucket boundary.
      assert.equal((await queue()).length, 1);
      assert.deepEqual(await state(), before);
    });

    await t.test('harvests trusted results, remembers URLs and backoff, and preserves chronology', async () => {
      const before = await state();
      const first = await lastRequest();
      const firstPublished = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const firstReport = report(first, {
        decisions: [decision(first, 'first?tracking=1', firstPublished)],
        counts: { analyzed: 1 }, httpRequests: { sources: 3, espn: 2 },
        errors: [{ url: `${origin}/robots.txt`, message: 'HTTP 429', status: 429, retryAfter: '7200' }],
      });
      // pg_net records the transaction start even when the HTTP takes several seconds.
      await query("update qb_observation.runs set dispatched_at=dispatched_at-interval '5 seconds' where run_id=$1",
        [first.payload.runId]);
      await respond(first, firstReport, { created: new Date(Date.now() - 4_000).toISOString() });
      const outcome = await tick();
      assert.equal(outcome.harvested, 1);
      assert.equal(outcome.status, 'dispatched'); // The fixture advanced the prior bucket.
      const second = await lastRequest();
      const savedUrl = `${origin}/news/first`;
      assert.deepEqual(second.payload.seenUrls, [savedUrl]);
      assert.equal(second.payload.baseline.WAS.publishedAt, firstPublished);
      assert(Date.parse(second.payload.retryAfterByOrigin[origin]) > Date.now());
      const secondReport = report(second, { decisions: [
        decision(second, 'first/#duplicate', firstPublished, { title: 'Changed title' }),
        decision(second, 'older', new Date(Date.now() - 30 * 60 * 1000).toISOString()),
        decision(second, 'newer', new Date(Date.now() - 5 * 60 * 1000).toISOString()),
      ] });
      await respond(second, secondReport);
      assert.equal((await tick()).harvested, 1);
      const { runs, entries } = await adminJournal();
      assert.equal(entries.length, 3);
      const original = entries.find(entry => entry.url === savedUrl);
      assert.equal(original.firstDetectedAt, firstReport.observedAt);
      assert.equal(original.lastDetectedAt, secondReport.observedAt);
      assert.equal(original.title, 'Club names a starter');
      assert.equal(original.proposalEligible, false);
      assert.deepEqual(entries.filter(entry => entry.proposalEligible).map(entry => entry.url), [`${origin}/news/newer`]);
      assert.deepEqual(runs.find(run => run.runId === first.payload.runId).errors, firstReport.errors);
      assert.equal((await adminJournal(0)).entries.length, 1);
      assert.equal((await adminJournal(1)).runs.length, 1);
      assert(!JSON.stringify({ runs, entries }).includes(secret));
      assert.deepEqual(await state(), before);
    });

    await t.test('harvest ignores forged and mismatched responses and distinguishes run and transport failures', async () => {
      const before = await state();
      for (const scenario of [
        { reply: {}, options: { sign: false }, status: 'response_failed', reason: 'invalid_signature' },
        { reply: { revision: 999 }, options: {}, status: 'response_failed', reason: 'invalid_response' },
        { reply: {}, options: { status: 502 }, status: 'response_failed', reason: 'http_status' },
        { reply: {}, options: { timedOut: true }, status: 'response_failed', reason: 'http_timeout' },
        { reply: { status: 'failed', reason: 'calendar_unavailable', errors: [{ message: 'ESPN error' }] },
          options: {}, status: 'failed', reason: 'calendar_unavailable' },
      ]) {
        await nextBucket();
        assert.equal((await tick()).status, 'dispatched');
        const request = await lastRequest();
        await respond(request, report(request, scenario.reply), scenario.options);
        assert.equal((await tick()).harvested, 1);
        const run = (await adminJournal()).runs.find(row => row.runId === request.payload.runId);
        assert.deepEqual([run.status, run.reason], [scenario.status, scenario.reason]);
      }
      await nextBucket();
      assert.equal((await tick()).status, 'dispatched');
      const request = await lastRequest();
      await respond(request, report(request, { decisions: [
        decision(request, 'rolled-back', new Date().toISOString()),
        decision(request, 'wrong-match', new Date().toISOString(), {
          match: { id: '10003', opponent: 'BUF', kickoffAt: request.payload.firstKickoffAt },
        }),
      ] }));
      assert.equal((await tick()).harvested, 1);
      assert.equal((await adminJournal()).runs[0].reason, 'invalid_response');
      assert.equal((await adminJournal()).entries.length, 3); // Whole signed response rolls back.
      assert.deepEqual(await state(), before);
    });

    await t.test('expires missing replies and gates proposals by observation time rather than harvest time', async () => {
      await nextBucket();
      assert.equal((await tick()).status, 'dispatched');
      await sql("update qb_observation.runs set dispatched_at=clock_timestamp()-interval '11 minutes' where status='pending'");
      assert.equal((await tick()).harvested, 1);
      assert((await adminJournal()).runs.some(run => run.reason === 'response_missing'));

      await nextBucket();
      assert.equal((await tick()).status, 'dispatched');
      const request = await lastRequest();
      const cutoff = new Date(Date.now() - 250).toISOString();
      await query("update games set game_date=$1 where external_game_id='10001'", [cutoff]);
      const before = await state();
      const late = decision(request, 'after-gel', new Date(Date.now() - 60_000).toISOString());
      await respond(request, report(request, { decisions: [late] }));
      const queued = (await queue()).length;
      assert.deepEqual(await tick(), { status: 'outside_window', harvested: 1 });
      assert.equal((await queue()).length, queued);
      assert.equal((await adminJournal()).entries.find(row => row.url === late.url).proposalEligible, false);
      assert.deepEqual(await state(), before);

      await sql(`
        update settings set current_week=6, revision=revision+1;
        insert into qb_selection_weeks(season,week,started_at) values(2026,6,now()-interval '1 hour');
        insert into games(external_game_id,season,week,home_team,away_team,game_date,season_type)
          values('10006',2026,6,'Washington Commanders','Buffalo Bills',now()+interval '1 day','regular');
      `);
      assert.equal((await tick()).status, 'dispatched');
      const next = await lastRequest();
      const observedAt = new Date(Date.now() - 1_000).toISOString();
      const firstKickoffAt = new Date(Date.now() - 500).toISOString();
      await query("update qb_observation.runs set dispatched_at=dispatched_at-interval '2 seconds' where run_id=$1",
        [next.payload.runId]);
      await query("update games set game_date=$1 where external_game_id='10006'", [firstKickoffAt]);
      const observedBeforeGel = decision(next, 'before-gel-harvested-later', new Date(Date.now() - 60_000).toISOString(), {
        match: { id: '10006', opponent: 'BUF', kickoffAt: firstKickoffAt },
      });
      await respond(next, report(next, { observedAt, firstKickoffAt, decisions: [observedBeforeGel] }));
      assert.deepEqual(await tick(), { status: 'outside_window', harvested: 1 });
      assert.equal((await adminJournal()).entries.find(row => row.url === observedBeforeGel.url).proposalEligible, true);
    });
  } finally {
    await db.close();
  }
});
