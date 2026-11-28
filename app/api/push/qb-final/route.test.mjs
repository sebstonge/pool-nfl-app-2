import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { regularIsOpen } from '../../../../lib/lifecycle/context.mjs';

const { transform } = createRequire(import.meta.url)('next/dist/build/swc');
const source = await readFile(new URL('./route.js', import.meta.url), 'utf8');
const { code } = await transform(source, { filename: 'route.js', module: { type: 'commonjs' } });

function harness({ enabled, phase = 'regular', syncError, rankingNotifications, notificationFailure = false } = {}) {
  const calls = [];
  const client = {};
  const send = () => assert.fail('the transport must be driven by the publication or delivery helper');
  const config = {
    CRON_SECRET: 'local-test',
    REGULAR_AUTO_RESULTS_ENABLED: enabled,
  };
  const context = { current_season: 2026, current_week: 9, phase, regular_finalized_at: null };
  const dependencies = {
    '@supabase/supabase-js': { createClient: () => client },
    '../../../../lib/lifecycle/context.mjs': {
      loadLifecycle: async actual => { assert.equal(actual, client); calls.push('context'); return context; },
      regularIsOpen,
    },
    '../../../../lib/notifications/qbFinalDelivery.mjs': {
      deliverQbFinalEvents: async (scoped, sender, { season }) => {
        assert.equal(scoped.season, season);
        assert.equal(season, 2026);
        assert.equal(sender, send);
        calls.push('dispatch');
        return { sent: 1, failed: notificationFailure ? 1 : 0, unconfirmed: 0 };
      },
    },
    '../../../../lib/pushNotifications': { sendRegularPushToUser: send },
    '../../../../lib/regular-admin/operations.mjs': {
      syncScheduledRegularWeek: async (actual, options, sender) => {
        assert.equal(actual, client);
        assert.equal(sender, send);
        calls.push(['sync', options]);
        if (syncError) throw syncError;
        return { waitingGames: 1, notifications: rankingNotifications };
      },
    },
    '../../../../lib/seasons/regularClient.mjs': {
      regularClient(actual, { season }) { assert.equal(actual, client); return { season }; },
    },
  };
  const exports = {};
  new Function('require', 'exports', 'process', 'console', code)(
    name => dependencies[name], exports, { env: config }, { error() {} },
  );
  return { calls, run: (token = 'local-test') => exports.GET({
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  }) };
}

test('the existing cron secret gates ESPN, publication and delivery', async () => {
  const h = harness({ enabled: 'true' });
  assert.equal((await h.run('wrong-token')).status, 401);
  assert.deepEqual(h.calls, []);
});

test('automatic results are opt-in and the disabled default still processes QB finals', async () => {
  for (const enabled of [undefined, 'false', 'true']) {
    const h = harness({ enabled });
    const response = await h.run();
    assert.equal(response.status, 200);
    assert.deepEqual(h.calls, ['context', ['sync', { automatic: enabled === 'true' }], 'dispatch']);
    assert.deepEqual(await response.json(), {
      success: true, season: 2026, week: 9, automatic: enabled === 'true',
      sync: { waitingGames: 1 }, qbNotifications: { sent: 1, failed: 0, unconfirmed: 0 },
    });
  }
});

test('closed regular context is a normal skip and pending QB pushes survive an ESPN error', async () => {
  const closed = harness({ phase: 'playoffs' });
  const skipped = await closed.run();
  assert.equal(skipped.status, 200);
  assert.deepEqual(await skipped.json(), { skipped: 'regular_closed' });
  assert.deepEqual(closed.calls, ['context']);

  const failed = harness({ syncError: new Error('provider error') });
  assert.equal((await failed.run()).status, 500);
  assert.deepEqual(failed.calls, ['context', ['sync', { automatic: false }], 'dispatch']);
});

test('a lost race is a normal skip and a push delivery failure is explicit', async () => {
  const stale = harness({ syncError: Object.assign(new Error('stale'), { code: '40001' }) });
  const skipped = await stale.run();
  assert.equal(skipped.status, 200);
  assert.deepEqual((await skipped.json()).sync, { skipped: 'stale_context' });

  const failed = harness({ notificationFailure: true });
  assert.equal((await failed.run()).status, 500);
});

test('the daily generic scheduler leaves qb_final to their guarded dispatcher', async () => {
  const daily = await readFile(new URL('../scheduled/route.js', import.meta.url), 'utf8');
  assert.match(daily, /\.not\("notification_type", "in", "\([^"]*\bqb_final\b[^"]*\)"\)/);
});

test('the cron response reports notification counts without IDs or event keys', async () => {
  const h = harness({ enabled: 'true', rankingNotifications: { sent: 3, failed: 0, results: [{ eventKey: 'private-user-id' }] } });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.sync.notifications, { sent: 3, failed: 0 });
  assert.doesNotMatch(JSON.stringify(body), /private-user-id/);
});
