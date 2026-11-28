import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { regularIsOpen } from '../../../../lib/lifecycle/context.mjs';

const { transform } = createRequire(import.meta.url)('next/dist/build/swc');
const source = await readFile(new URL('./route.js', import.meta.url), 'utf8');
const { code } = await transform(source, { filename: 'route.js', module: { type: 'commonjs' } });

function harness({
  enabled, phase = 'regular', syncError, syncResult, rankingNotifications,
  notificationFailure = false, confirmed = true,
} = {}) {
  const calls = [];
  const participantId = 'regular-participant';
  const auth = {
    async getUser(token) {
      calls.push(['auth', token]);
      if (token !== 'participant-session') return { data: { user: null }, error: new Error('Invalid session') };
      return { data: { user: { id: participantId } }, error: null };
    },
  };
  const client = {
    auth,
    from(table) {
      assert.equal(table, 'season_participants');
      const filters = {};
      const response = () => {
        assert.deepEqual(filters, { user_id: participantId, season: 2026, confirmed: true });
        calls.push('participation');
        return { data: confirmed ? { user_id: participantId, confirmed: true } : null, error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        async maybeSingle() { return response(); },
        async single() { return response(); },
      };
      return query;
    },
  };
  const send = () => assert.fail('the transport must be driven by the publication or delivery helper');
  const config = {
    CRON_SECRET: 'local-test',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    REGULAR_AUTO_RESULTS_ENABLED: enabled,
  };
  const context = { current_season: 2026, current_week: 9, phase, regular_finalized_at: null, revision: 4 };
  const dependencies = {
    '@supabase/supabase-js': { createClient: (_url, key) => key === config.NEXT_PUBLIC_SUPABASE_ANON_KEY ? { auth } : client },
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
      syncScheduledRegularWeek: async (actual, options, sender, ...additional) => {
        assert.equal(actual, client);
        assert.equal(sender, send);
        calls.push(['sync', options, ...additional]);
        if (syncError) throw syncError;
        return syncResult ?? { waitingGames: 1, notifications: rankingNotifications };
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
  return {
    calls,
    run: (token = 'local-test') => exports.GET({
      headers: new Headers({ Authorization: `Bearer ${token}` }),
    }),
    post: (body, token = 'participant-session') => exports.POST(new Request('https://local.test/api/push/qb-final', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })),
  };
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

const gameA = '11111111-1111-4111-8111-11111111111a';
const gameB = '22222222-2222-4222-8222-222222222222';

test('live signals stay disabled unless the existing publication flag is exactly true', async () => {
  for (const enabled of [undefined, 'false', 'TRUE']) {
    const h = harness({ enabled });
    const response = await h.post({ gameIds: [gameA] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).retryGameIds, []);
    assert.equal(h.calls.some(call => call === 'dispatch' || call[0] === 'sync'), false);
  }
});

test('live signals require a verified participant session and do not accept the cron secret', async () => {
  for (const token of [null, 'invalid-token', 'local-test']) {
    const h = harness({ enabled: 'true' });
    assert.equal((await h.post({ gameIds: [gameA] }, token)).status, 401);
    assert.equal(h.calls.some(call => call === 'participation' || call === 'dispatch' || call[0] === 'sync'), false);
  }
  const h = harness({ enabled: 'true', confirmed: false });
  assert.equal((await h.post({ gameIds: [gameA] })).status, 403);
  assert.ok(h.calls.includes('participation'));
  assert.equal(h.calls.some(call => call === 'dispatch' || call[0] === 'sync'), false);
});

test('live signals accept only a small nonempty list of pool game IDs', async () => {
  for (const body of [
    '{}', '{', { gameIds: [] }, { gameIds: [42] }, { gameIds: ['espn-1234'] },
    { gameIds: Array(17).fill(gameA) }, { gameIds: [gameA], score: 99 },
    { gameIds: [gameA], url: 'https://example.test/schedule' }, { gameIds: [gameA], week: 2 },
  ]) {
    const h = harness({ enabled: 'true' });
    assert.equal((await h.post(body)).status, 400);
    assert.equal(h.calls.some(call => call === 'dispatch' || call[0] === 'sync'), false);
  }
});

test('a live signal in a closed phase is acknowledged without publication or delivery', async () => {
  const h = harness({ enabled: 'true', phase: 'playoffs' });
  const response = await h.post({ gameIds: [gameA] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { retryGameIds: [] });
  assert.deepEqual(h.calls, [['auth', 'participant-session'], 'context']);
});

test('live signals use the scoped automatic publication and relay only unfinished games', async () => {
  const h = harness({ enabled: 'true', syncResult: { hasVerifiedGame: true, retryGameIds: [gameB], notifications: { sent: 1 } } });
  const response = await h.post({ gameIds: [gameA.toUpperCase(), gameB, gameA] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { retryGameIds: [gameB] });
  assert.deepEqual(h.calls, [
    ['auth', 'participant-session'], 'context', 'participation',
    ['sync', { automatic: true }, {
      context: { current_season: 2026, current_week: 9, phase: 'regular', regular_finalized_at: null, revision: 4 },
      gameIds: [gameA, gameB],
    }],
    'dispatch',
  ]);
});

test('a live hint without a verified FINAL cannot trigger notification delivery', async () => {
  const h = harness({ enabled: 'true', syncResult: { hasVerifiedGame: false, retryGameIds: [gameA] } });
  const response = await h.post({ gameIds: [gameA] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { retryGameIds: [gameA] });
  assert.equal(h.calls.includes('dispatch'), false);
});

test('a stale transaction does not permanently acknowledge the live results', async () => {
  const stale = Object.assign(new Error('stale'), { code: '40001' });
  const h = harness({ enabled: 'true', syncError: stale });
  const response = await h.post({ gameIds: [gameA, gameB] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).retryGameIds, [gameA, gameB]);
});

test('provider exceptions do not acknowledge a live signal as complete', async () => {
  const h = harness({ enabled: 'true', syncError: new Error('provider error') });
  const response = await h.post({ gameIds: [gameA] });
  assert.equal(response.ok, false);
});
