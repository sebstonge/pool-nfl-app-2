import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PublicationError} from '../regular-publication/espn.mjs';

const source = (await readFile(new URL('../../app/api/weekly-summary/route.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/export const /g, 'const ')
  .replace(/export async function (GET|POST)/g, 'async function $1');

function harness() {
  const h = {user: {id: 'verified-account'}, authError: null, profileError: null,
    profile: {display_name: 'Pool player', real_name: 'Real name', must_change_password: false},
    tokens: [], constructors: [], profileQueries: [], reads: [], acknowledgements: [], logs: [],
    summary: {season: 2026, week: 2}, loadError: null, ackError: null};
  const authClient = {auth: {getUser: async token => {
    h.tokens.push(token);
    return {data: {user: h.user}, error: h.authError};
  }}};
  const serviceClient = {from(table) {
    assert.equal(table, 'users');
    const query = {table, filters: []}; h.profileQueries.push(query);
    return {
      select(columns) {query.columns = columns; return this;},
      eq(field, value) {query.filters.push([field, value]); return this;},
      maybeSingle: async () => ({data: h.profile, error: h.profileError}),
    };
  }};
  h.serviceClient = serviceClient;
  const createClient = (url, key, options) => {
    h.constructors.push({url, key, options});
    assert.equal(url, 'https://mock.invalid');
    assert.deepEqual(options, {auth: {persistSession: false, autoRefreshToken: false}});
    assert.ok(['anon-test-key', 'server-test-key'].includes(key));
    return key === 'anon-test-key' ? authClient : serviceClient;
  };
  const load = async (client, userId, options) => {
    h.reads.push({client, userId, options});
    if (h.loadError) throw h.loadError;
    return h.summary;
  };
  const acknowledge = async (client, userId, body) => {
    h.acknowledgements.push({client, userId, body});
    if (h.ackError) throw h.ackError;
  };
  const console = {error: (...args) => h.logs.push(args)};
  const fetch = async () => {throw new Error('A route test must never request the network.');};
  const process = {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://mock.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key'}};
  h.handlers = new Function('createClient', 'loadWeeklySummary', 'acknowledgeWeeklySummary',
    'PublicationError', 'console', 'fetch', 'process', `${source};return {GET,POST};`)
    (createClient, load, acknowledge, PublicationError, console, fetch, process);
  return h;
}
const request = (body = {season: 2026, week: 2}, token = 'Bearer verified-token') => ({
  url: 'https://pool.invalid/api/weekly-summary?user_id=forged-owner',
  headers: {get: name => name.toLowerCase() === 'authorization' ? token : null},
  json: async () => body,
});
const assertPrivate = response => assert.equal(response.headers.get('Cache-Control'), 'private, no-store');

test('GET validates the JWT with getUser and loads only the verified account', async () => {
  const h = harness(), response = await h.handlers.GET(request());
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.deepEqual(await response.json(), {summary: h.summary});
  assert.deepEqual(h.tokens, ['verified-token']);
  assert.deepEqual(h.profileQueries[0].filters, [['id', 'verified-account']]);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].client, h.serviceClient);
  assert.equal(h.reads[0].userId, 'verified-account');
  assert.equal(typeof h.reads[0].options.fetcher, 'function');
  assert.deepEqual(h.acknowledgements, []);
});

for (const [name, token, mutate] of [
  ['missing authorization', null, () => {}],
  ['incorrect authorization scheme', 'Basic forged-token', () => {}],
  ['unverified user', 'Bearer forged-token', h => {h.user = null;}],
  ['rejected JWT', 'Bearer rejected-token', h => {h.authError = {message: 'JWT rejected'};}],
]) test(`GET silently skips ${name}; POST rejects it`, async () => {
  const h = harness(); mutate(h);
  const get = await h.handlers.GET(request(undefined, token));
  assert.equal(get.status, 200); assertPrivate(get);
  assert.deepEqual(await get.json(), {summary: null});
  const post = await h.handlers.POST(request(undefined, token));
  assert.equal(post.status, 401); assertPrivate(post);
  assert.deepEqual(h.profileQueries, []);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.acknowledgements, []);
});

for (const [name, profile] of [
  ['required password change', {display_name: 'Pool player', real_name: 'Real name', must_change_password: true}],
  ['missing display name', {display_name: '  ', real_name: 'Real name', must_change_password: false}],
  ['missing real name', {display_name: 'Pool player', real_name: '', must_change_password: false}],
  ['missing profile', null],
]) test(`GET skips and POST rejects an unfinished profile: ${name}`, async () => {
  const h = harness(); h.profile = profile;
  const get = await h.handlers.GET(request());
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), {summary: null});
  assert.equal((await h.handlers.POST(request())).status, 401);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.acknowledgements, []);
});

test('POST ignores browser owner and business values when choosing the authenticated owner', async () => {
  const h = harness();
  const body = {season: 2026, week: 2, user_id: 'forged-owner', actor: 'forged-admin', final_score: 999, proof: {forged: true}};
  const response = await h.handlers.POST(request(body));
  assert.equal(response.status, 200); assertPrivate(response);
  assert.deepEqual(await response.json(), {seen: true});
  assert.equal(h.acknowledgements.length, 1);
  assert.equal(h.acknowledgements[0].client, h.serviceClient);
  assert.equal(h.acknowledgements[0].userId, 'verified-account');
  assert.equal(h.acknowledgements[0].body.season, 2026);
  assert.equal(h.acknowledgements[0].body.week, 2);
  assert.deepEqual(h.reads, []);
});

for (const body of [{}, {season: '2026', week: 2}, {season: 2026, week: '2'}, {season: 2026, week: 1.5}]) {
  test(`POST rejects invalid acknowledgement coordinates: ${JSON.stringify(body)}`, async () => {
    const h = harness(), response = await h.handlers.POST(request(body));
    assert.equal(response.status, 400); assertPrivate(response);
    assert.deepEqual(h.acknowledgements, []);
  });
}

test('POST returns a retryable error when persistence fails', async () => {
  const h = harness(); h.ackError = new Error('Private database detail');
  const response = await h.handlers.POST(request());
  assert.equal(response.status, 409); assertPrivate(response);
  assert.deepEqual(await response.json(), {error: 'Impossible d’enregistrer la fermeture. Réessaie.'});
});

test('POST exposes a safe validation explanation for a stale or invalid acknowledgement', async () => {
  const h = harness(); h.ackError = new PublicationError('La semaine demandée est future.');
  const response = await h.handlers.POST(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {error: 'La semaine demandée est future.'});
});

test('GET contains loader failures and returns no private database detail', async () => {
  const h = harness(); h.loadError = new Error('Private database detail');
  const response = await h.handlers.GET(request());
  assert.equal(response.status, 503); assertPrivate(response);
  assert.deepEqual(await response.json(), {summary: null, error: 'Résumé temporairement indisponible.'});
  assert.equal(h.logs.length, 1);
  assert.deepEqual(h.acknowledgements, []);
});

test('GET contains profile read failures before calling the loader', async () => {
  const h = harness(); h.profileError = new Error('Profile read unavailable');
  const response = await h.handlers.GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.acknowledgements, []);
});
