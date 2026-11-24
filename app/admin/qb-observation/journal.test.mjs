import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the Admin QB journal only calls its read-only RPC', async () => {
  const page = await readFile(new URL('./page.js', import.meta.url), 'utf8');
  assert.equal([...page.matchAll(/\.rpc\(/g)].length, 1);
  assert.match(page, /\.rpc\('read_qb_observation_log', \{ p_limit: 20 \}, \{ get: true \}\)/);
  assert.doesNotMatch(page, /MenuControls|qb_observer_exchange/);
});
