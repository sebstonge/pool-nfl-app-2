import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverQbFinalEvents } from './qbFinalDelivery.mjs';
import { finalRatingMessage } from './teamFrench.mjs';

const season = 2026;
const eventKey = 'qb-final-week-8-user-member';
const now = () => new Date('2026-10-27T01:00:00.000Z');

function queuedEvent(overrides = {}) {
  return {
    id: 'event-1', user_id: 'member', event_key: eventKey, season, week: 8,
    notification_type: 'qb_final', status: 'pending', sent_at: null, qb_final_attempted_at: null,
    qb_final_payload: { actualQbName: 'Jayden Daniels', opponent: 'Chicago Bears', passerRating: 0 },
    ...overrides,
  };
}

function fixture(rows) {
  const controls = { failClaim: false, failSave: false };
  return {
    rows,
    controls,
    from(table) {
      assert.equal(table, 'push_notification_events');
      const filters = [];
      let single = false;
      let patch;
      const query = {
        select: () => query,
        update: value => { patch = value; return query; },
        eq: (field, value) => { filters.push(row => row[field] === value); return query; },
        is: (field, value) => query.eq(field, value),
        not: (field, operator, value) => {
          assert.equal(operator, 'is');
          filters.push(row => row[field] !== value);
          return query;
        },
        order: () => query,
        maybeSingle: () => { single = true; return query; },
        then(resolve) {
          if (patch?.qb_final_attempted_at && controls.failClaim) return resolve({ error: new Error('claim unavailable') });
          if (patch?.status && controls.failSave) return resolve({ error: new Error('save unavailable') });
          const matching = rows.filter(row => filters.every(filter => filter(row)));
          if (patch) matching.forEach(row => Object.assign(row, patch));
          return resolve({ data: single ? (matching[0] ?? null) : matching.map(row => ({ ...row })) });
        },
      };
      return query;
    },
  };
}

test('drains an existing committed QB reservation on the next tick and sends the original content once', async () => {
  const db = fixture([queuedEvent()]);
  const messages = [];
  const send = async payload => { messages.push(payload); return { sent: 1 }; };

  db.controls.failClaim = true;
  assert.equal((await deliverQbFinalEvents(db, send, { season, now })).failed, 1);
  assert.equal(db.rows[0].qb_final_attempted_at, null);
  assert.deepEqual(messages, []);

  db.controls.failClaim = false;
  assert.equal((await deliverQbFinalEvents(db, send, { season, now })).sent, 1);
  assert.equal((await deliverQbFinalEvents(db, send, { season, now })).sent, 0);
  assert.equal(db.rows[0].status, 'sent');
  assert.deepEqual(messages, [{
    season, userId: 'member', notificationLog: { eventKey, type: 'qb_final' },
    title: '🏈 Passer Rating final', body: finalRatingMessage('Jayden Daniels', 'Chicago Bears', '0.0'), url: '/',
  }]);
});

test('two workers that read the same pending event can claim and send it only once', async () => {
  const db = fixture([queuedEvent()]);
  let attempts = 0;
  const send = async () => { attempts++; return { sent: 1 }; };
  const [first, second] = await Promise.all([
    deliverQbFinalEvents(db, send, { season, now }),
    deliverQbFinalEvents(db, send, { season, now }),
  ]);
  assert.equal(attempts, 1);
  assert.equal(first.sent + second.sent, 1);
  assert.equal(first.skipped + second.skipped, 1);
});

test('an uncertain provider result or missing completion status does not rearm the attempted event', async () => {
  const db = fixture([queuedEvent()]);
  db.controls.failSave = true;
  let attempts = 0;
  const send = async () => { attempts++; throw new Error('provider response lost'); };
  const first = await deliverQbFinalEvents(db, send, { season, now });
  assert.equal(first.failed, 1);
  assert.equal(first.unconfirmed, 1);
  assert.equal(db.rows[0].status, 'pending');
  assert.equal(db.rows[0].qb_final_attempted_at, now().toISOString());
  await deliverQbFinalEvents(db, send, { season, now });
  assert.equal(attempts, 1);
});

test('leaves legacy pending, claimed, sent, other-season and ranking events untouched', async () => {
  const db = fixture([
    queuedEvent({ id: 'legacy-event', qb_final_payload: null }),
    queuedEvent({ id: 'claimed-event', qb_final_attempted_at: now().toISOString() }),
    queuedEvent({ id: 'sent-event', status: 'sent', sent_at: now().toISOString() }),
    queuedEvent({ id: 'other-season-event', season: 2027 }),
    queuedEvent({ id: 'ranking-event', notification_type: 'rankings_updated' }),
  ]);
  const before = structuredClone(db.rows);
  const send = () => assert.fail('forbidden dispatch');
  await deliverQbFinalEvents(db, send, { season, now });
  assert.deepEqual(db.rows, before);
});
