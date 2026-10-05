import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDelivery, TELEMETRY_TIMEOUT_MS} from './deliveryLog.mjs';

const flush = () => new Promise(setImmediate);
const options = userId => ({userId, notificationLog:{type:'qb_turn', eventKey:`key:${userId}`}});
const success = {success:true, sent:1, total:1, results:[{success:true}]};
const failure = {success:true, sent:0, total:1, results:[{success:false, statusCode:410}]};

// The suspended requests deliberately ignore abort: the timeout must still win.
function telemetryClient(hangs, pending = () => new Promise(() => {})) {
 const calls = [];
 return {calls, from() {
  let row;
  const query = phase => {
   const call = {phase, row, signal:null};
   calls.push(call);
   return {
    abortSignal(signal) {call.signal = signal; return this;},
    then(resolve, reject) {
     return (hangs(call) ? pending() : Promise.resolve({data:{id:'log'}})).then(resolve, reject);
    },
   };
  };
  return {
   insert(value) {row = value; return this;},
   select() {return this;},
   single() {return query('create');},
   update(value) {row = value; return this;},
   eq() {return query(row.completed_at ? 'final' : 'attempt');},
  };
 }};
}

function fakeClock(t) {
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(console, 'error', () => {});
}

for (const phase of ['create', 'attempt']) {
 test(`never-resolving ${phase} telemetry expires and the push starts`, async t => {
  fakeClock(t);
  const client = telemetryClient(call => call.phase === phase);
  let sends = 0;
  const task = observeDelivery(client, options('first'), async onAttempt => {
   await onAttempt(); sends++; return success;
  });
  await flush();
  assert.equal(sends, 0);
  assert.equal(client.calls.at(-1).phase, phase);
  t.mock.timers.tick(TELEMETRY_TIMEOUT_MS - 1);
  await flush(); assert.equal(sends, 0);
  t.mock.timers.tick(1);
  assert.equal(await task, success);
  assert.equal(sends, 1);
  assert.equal(client.calls.find(call => call.phase === phase).signal.aborted, true);
 });
}

for (const [label, result] of [['provider success', success], ['provider failure', failure]]) {
 test(`never-resolving final telemetry returns the exact ${label} result`, async t => {
  fakeClock(t);
  const client = telemetryClient(call => call.phase === 'final');
  let sends = 0, settled = false;
  const task = observeDelivery(client, options('first'), async onAttempt => {
   await onAttempt(); sends++; return result;
  }).then(value => {settled = true; return value;});
  await flush();
  assert.equal(sends, 1); assert.equal(settled, false);
  assert.equal(client.calls.at(-1).phase, 'final');
  t.mock.timers.tick(TELEMETRY_TIMEOUT_MS);
  assert.equal(await task, result);
  assert.equal(client.calls.at(-1).signal.aborted, true);
 });
}

test('never-resolving interruption log propagates the original transport exception', async t => {
 fakeClock(t);
 const client = telemetryClient(call => call.phase === 'final');
 const error = new Error('original transport exception');
 const task = observeDelivery(client, options('first'), async onAttempt => {
  await onAttempt(); throw error;
 });
 const rejected = assert.rejects(task, value => value === error);
 await flush(); assert.equal(client.calls.at(-1).phase, 'final');
 t.mock.timers.tick(TELEMETRY_TIMEOUT_MS);
 await rejected;
});

test('expired telemetry lets the next recipient in a sequential batch run', async t => {
 fakeClock(t);
 const client = telemetryClient(call => call.phase === 'create' && call.row.user_id === 'first');
 const sent = [];
 const task = (async () => {
  for (const userId of ['first', 'next']) {
   assert.equal(await observeDelivery(client, options(userId), async onAttempt => {
    await onAttempt(); sent.push(userId); return success;
   }), success);
  }
 })();
 await flush(); assert.deepEqual(sent, []);
 t.mock.timers.tick(TELEMETRY_TIMEOUT_MS);
 await task; assert.deepEqual(sent, ['first', 'next']);
});

test('late telemetry rejection after expiration is handled without changing or repeating the send', async t => {
 fakeClock(t);
 let rejectLate, sends = 0;
 const late = new Promise((_, reject) => {rejectLate = reject;});
 const client = telemetryClient(call => call.phase === 'create', () => late);
 const task = observeDelivery(client, options('first'), async onAttempt => {
  await onAttempt(); sends++; return success;
 });
 await flush(); t.mock.timers.tick(TELEMETRY_TIMEOUT_MS);
 assert.equal(await task, success);
 rejectLate(new Error('late SDK rejection'));
 await flush(); assert.equal(sends, 1);
});

test('successful telemetry clears its timers and never times out the push itself', async t => {
 fakeClock(t);
 const client = telemetryClient(() => false);
 let finishTransport, started = false;
 const transport = new Promise(resolve => {finishTransport = resolve;});
 const task = observeDelivery(client, options('first'), async onAttempt => {
  await onAttempt(); started = true; return transport;
 });
 await flush(); assert.equal(started, true);
 t.mock.timers.tick(TELEMETRY_TIMEOUT_MS * 10);
 assert.ok(client.calls.every(call => !call.signal.aborted));
 finishTransport(success); assert.equal(await task, success);
 t.mock.timers.tick(TELEMETRY_TIMEOUT_MS * 10);
 assert.ok(client.calls.every(call => !call.signal.aborted));
 assert.equal(console.error.mock.calls.length, 0);
});
