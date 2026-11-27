import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as espnRoster from '../../../../lib/qb-observation/espnRoster.mjs';

const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const source = await readFile(new URL('./route.js', import.meta.url), 'utf8');
const { code } = await transform(source, { filename: 'route.js', module: { type: 'commonjs' } });
const actor = '00000000-0000-0000-0000-000000000001';
const entryId = '00000000-0000-0000-0000-000000000002';
const runId = '00000000-0000-0000-0000-000000000003';
const expectedState = 'f'.repeat(64);
const confirm = {
  operation: 'confirm', team: 'WAS', selection: 'other', name: 'Jayden Daniels', athleteId: '4426348',
  entryId, runId, expectedState, confirmed: true,
};
const lookup = { operation: 'lookup', team: 'WAS', name: 'Jayden Daniels' };

function harness() {
  const h = {
    actor, admin: true, manualOpen: true, qbId: actor, reviewState: expectedState,
    candidates: ['4426348'], calls: [], rosterCalls: [], error: null,
  };
  const auth = {
    auth: { getUser: async () => ({ data: { user: h.actor ? { id: h.actor } : null } }) },
    rpc: async (method, args, options) => {
      assert.equal(method, 'read_regular_qb_menu_admin');
      assert.deepEqual(args, {});
      assert.deepEqual(options, { get: true });
      return { data: { manualOpen: h.manualOpen,
        teams: [{ abbr: 'WAS', qbId: h.qbId, reviewState: h.reviewState }] } };
    },
  };
  const service = {
    from(table) {
      assert.equal(table, 'users');
      return { select(field) {
        assert.equal(field, 'is_admin');
        return { eq(key, value) {
          assert.equal(key, 'id');
          assert.equal(value, actor);
          return { maybeSingle: async () => ({ data: { is_admin: h.admin } }) };
        } };
      } };
    },
    async rpc(method, args) {
      assert.equal(method, 'manage_regular_qb_recommendation');
      h.calls.push(args);
      return { data: { qbId: actor }, error: h.error };
    },
  };
  const imports = id => {
    if (id.includes('espnRoster.mjs')) return espnRoster;
    assert.equal(id, '@supabase/supabase-js');
    return { createClient(_url, key, options) {
      if (key === 'anon') {
        assert.equal(options.global.headers.Authorization, 'Bearer valid');
        return auth;
      }
      assert.equal(key, 'service');
      assert.equal(options.global, undefined);
      return service;
    } };
  };
  const fetcher = async url => {
    h.rosterCalls.push(url);
    return Response.json({
      status: 'success', season: { year: 2026 },
      team: { id: '28', abbreviation: 'WSH', name: 'Commanders', displayName: 'Washington Commanders' },
      athletes: [{ position: 'offense', items: h.candidates.map(id => ({
        id, fullName: 'Jayden Daniels', position: { abbreviation: 'QB' },
      })) }],
    });
  };
  const exports = {};
  new Function('require', 'exports', 'process', 'fetch', code)(imports, exports, {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://local.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    },
  }, fetcher);
  h.run = (body, token = 'Bearer valid') => exports.POST({ headers: { get: () => token }, json: async () => body });
  return h;
}

test('only authenticated Admin can read ESPN or confirm', async () => {
  const h = harness();
  assert.equal((await h.run(lookup, null)).status, 401);
  h.actor = null;
  assert.equal((await h.run(confirm)).status, 401);
  h.actor = actor;
  h.admin = false;
  assert.equal((await h.run(lookup)).status, 403);
  assert.deepEqual(h.rosterCalls, []);
  assert.deepEqual(h.calls, []);
});

test('lookup returns the verified candidates for preview without writing', async () => {
  const h = harness();
  h.candidates = ['4426348', '23'];
  const response = await h.run(lookup);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { matches: h.candidates.map(id => ({
    id, name: 'Jayden Daniels', team: 'WAS', position: 'QB', eligible: true,
  })) });
  assert.deepEqual(h.calls, []);
});

test('confirmation rechecks ESPN and passes only its verified identity and authenticated actor', async () => {
  const h = harness();
  const response = await h.run({ ...confirm, actor: 'forged', name: 'jayden daniels' });
  assert.equal(response.status, 200);
  assert.equal(h.rosterCalls.length, 1);
  assert.deepEqual(h.calls, [{
    p_actor_id: actor, p_selection: 'other', p_entry_id: entryId, p_run_id: runId,
    p_expected_state: expectedState, p_team: 'WAS', p_confirmed: true,
    p_athlete_id: '4426348', p_athlete_name: 'Jayden Daniels',
  }]);
});

test('a forged ID, a missing slot, a closed window or a stale card never calls the writer', async () => {
  const h = harness();
  assert.equal((await h.run({ ...confirm, athleteId: '42' })).status, 409);
  assert.equal((await h.run({ ...confirm, confirmed: false })).status, 400);
  h.reviewState = '1'.repeat(64);
  assert.equal((await h.run(confirm)).status, 409);
  h.qbId = null;
  assert.equal((await h.run(lookup)).status, 409);
  h.manualOpen = false;
  assert.equal((await h.run(lookup)).status, 423);
  assert.equal(h.rosterCalls.length, 1);
  assert.deepEqual(h.calls, []);
});

test('keeping the current QB bypasses ESPN and ignores caller-supplied identity fields', async () => {
  const h = harness();
  assert.equal((await h.run({ ...confirm, selection: 'current' })).status, 200);
  assert.deepEqual(h.rosterCalls, []);
  assert.equal(h.calls[0].p_athlete_id, null);
  assert.equal(h.calls[0].p_athlete_name, null);
});

test('a race after route preflight still surfaces the database refusal', async () => {
  const h = harness();
  h.error = { code: '40001' };
  const response = await h.run(confirm);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Actualise/);
});
