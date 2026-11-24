import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createScheduledObservationHandler } from '../../scripts/qb-announcements/scheduled.mjs';
import { SLEEPER_URL } from '../../scripts/qb-announcements/sleeper.mjs';
import { exchangeSql, member, quoteSql, signedExchange, withNativeQbFixture } from './qb_native_fixture.mjs';

const rpcPath = '/rest/v1/rpc/qb_observer_exchange';
const testOrigin = 'https://abcdefghijklmnopqrst.supabase.co';
const publishableKey = 'sb_publishable_' + 's'.repeat(32);
const event = { source: 'aws.scheduler', 'detail-type': 'qb-observation', detail: { version: 1 } };

test('scheduled Lambda exchanges signed observations with native PostgreSQL over loopback HTTP', {
  skip: !process.env.QB_TEST_PG_BIN, timeout: 45_000,
}, async t => {
  await withNativeQbFixture(async db => {
    const firstKickoffAt = await db.scalar("select qb_observation.iso(game_date) from public.games where external_game_id='5005';");
    const schedule = { firstKickoffAt, games: [{ id: '5005', kickoffAt: firstKickoffAt,
      teams: ['WAS', 'BUF'], phase: 'pre', qbs: [{ name: 'Current QB' }, { name: 'Bills QB' }] }] };
    let rpcCalls = 0;
    let sleeperReads = 0;
    let reportMode;
    let serverError;
    const reports = [];

    const server = createServer(async (req, res) => {
      rpcCalls++;
      try {
        assert.equal(req.url, rpcPath);
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.apikey, publishableKey);
        assert.equal(req.headers.authorization, undefined);
        const parts = [];
        for await (const part of req) parts.push(part);
        const params = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const message = JSON.parse(params.p_message);
        if (message.action === 'report') {
          const report = JSON.parse(message.report);
          reports.push(report);
          if (reportMode === 'drop') { req.socket.destroy(); return; }
          if (reportMode === 'late') {
            await db.sql(`update public.games set game_date=
              ${quoteSql(report.observedAt)}::timestamptz + interval '1 millisecond'
              where external_game_id='5005'; select pg_sleep(0.02);`);
          }
        }
        let result;
        try {
          result = await db.sql(exchangeSql(params));
        } catch (error) {
          if (/QB observer authentication refused/.test(error.message)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end('{}');
            return;
          }
          throw error;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result);
      } catch (error) {
        serverError = error;
        res.writeHead(500);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const url = `http://127.0.0.1:${server.address().port}${rpcPath}`;
      const worker = createScheduledObservationHandler({
        env: {
          QB_OBSERVATION_ENABLED: 'true', QB_OBSERVATION_SECRET: db.secret,
          QB_OBSERVATION_SUPABASE_URL: testOrigin, QB_OBSERVATION_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
        readSchedule: async () => schedule,
        fetcher: async (target, request) => {
          if (target === testOrigin + rpcPath) return fetch(url, request);
          assert.equal(target, SLEEPER_URL);
          sleeperReads++;
          return Response.json({ starter: {
            position: 'QB', team: 'WAS', espn_id: '99', full_name: 'Current QB',
            status: 'Active', injury_status: 'Out',
          } });
        },
      });
      const run = async () => {
        const result = await worker(event);
        if (serverError) throw serverError;
        return result;
      };
      const initial = await db.criticalState();
      const menu = () => db.asRole(member, 'select public.read_regular_qb_menu(2026,5);');
      const initialMenu = await menu();
      assert.equal(JSON.parse(initialMenu).enabled, false);
      assert.equal(await db.scalar("select to_regnamespace('net') is null and to_regnamespace('vault') is null;"), 't');
      const flags = () => db.scalar('select (not enabled and not automation_enabled) from qb_observation.regular_menu_config;');
      const resultOf = async runId => JSON.parse(await db.scalar(`select jsonb_build_object(
        'status',status,'reason',reason,'http',http_status,'cache',source_state)
        from qb_observation.runs where run_id=${quoteSql(runId)};`));
      const releaseBucket = () => db.sql(`update qb_observation.runs set period=
        (select least(coalesce(min(period),0),0)-1 from qb_observation.runs) where period>=0;`);
      const send = async params => fetch(url, { method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(params) });

      await t.test('signed round-trip, signed replay rejection, daily cache and repeated signal', async () => {
        const invalid = signedExchange(db.secret, 'claim', undefined, { valid: false });
        assert.equal((await send(invalid)).status, 403);
        assert.equal(await db.scalar('select count(*) from qb_observation.runs;'), '0');
        assert.equal((await run()).status, 'stored');
        const result = await resultOf(reports[0].runId);
        assert.equal(result.status, 'completed');
        assert.equal(result.http, 200);
        assert.equal(result.cache.absences[0].id, '99');
        assert.equal(await db.scalar('select count(*) from qb_observation.entries;'), '1');
        assert.deepEqual(await run(), { status: 'already_dispatched' });
        const alreadySigned = signedExchange(db.secret, 'claim');
        assert.deepEqual(await (await send(alreadySigned)).json(), { status: 'already_dispatched' });
        assert.deepEqual(await (await send(alreadySigned)).json(), { status: 'replayed' });

        await releaseBucket();
        assert.equal((await run()).status, 'stored');
        assert.equal((await resultOf(reports[1].runId)).status, 'completed');
        assert.equal(await db.scalar('select count(*) from qb_observation.entries;'), '1');
        assert.equal(await db.scalar('select count(*) from qb_observation.runs where sleeper_requested_at is not null;'), '1');
        assert.equal(sleeperReads, 1);
        assert.equal(rpcCalls, 8);
        assert.deepEqual(await db.criticalState(), initial);
        assert.equal(await menu(), initialMenu);
        assert.equal(await flags(), 't');
      });

      await t.test('network failure keeps the previous availability evidence and daily claim', async () => {
        const previous = await db.scalar('select qb_observation.latest_source_state(2026);');
        await releaseBucket();
        reportMode = 'drop';
        try { assert.deepEqual(await run(), { status: 'failed', reason: 'report_failed' }); }
        finally { reportMode = undefined; }
        const lost = reports.at(-1);
        assert.equal((await resultOf(lost.runId)).status, 'pending');
        assert.equal((await run()).status, 'already_dispatched');
        assert.equal(await db.scalar('select qb_observation.latest_source_state(2026);'), previous);
        assert.equal(await db.scalar('select count(*) from qb_observation.runs where sleeper_requested_at is not null;'), '1');
        assert.equal(sleeperReads, 1);
        assert.deepEqual(await db.criticalState(), initial);
        assert.equal(await flags(), 't');
        await db.sql(`update qb_observation.runs set dispatched_at=clock_timestamp()-interval '3 minutes'
          where run_id=${quoteSql(lost.runId)};`);
      });

      await t.test('a signed report received after kickoff is journaled without becoming active state', async () => {
        const previous = await db.scalar('select qb_observation.latest_source_state(2026);');
        await releaseBucket();
        reportMode = 'late';
        try { assert.deepEqual(await run(), { status: 'stored' }); }
        finally { reportMode = undefined; }
        const result = await resultOf(reports.at(-1).runId);
        assert.equal(result.status, 'completed');
        assert.equal(result.cache, null);
        assert.equal((await run()).status, 'outside_window');
        assert.equal(await db.scalar('select qb_observation.latest_source_state(2026);'), previous);
        assert.equal(await flags(), 't');
        assert.equal(sleeperReads, 1);
        assert.deepEqual(await db.criticalState(), initial);
        assert.equal(await menu(), initialMenu);
      });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
