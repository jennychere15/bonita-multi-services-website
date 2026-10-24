import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createNotifications, sendResend } from '../src/notifications.js';

function setup(t) {
  const db = openStore(); t.after(() => db.close());
  let clock = Date.now(); const sent = [];
  const config = { baseUrl: 'https://bms.example', emailEnabled: true, resendKey: 'test-only', emailFrom: 'BMS <test@example.com>', adminEmail: 'admin@example.com', emailAllowlist: ['admin@example.com', 'customer@example.com', 'provider@example.com'] };
  db.prepare('INSERT INTO providers(id,name,email,invite_hash,expires,created) VALUES(?,?,?,?,?,?)').run('p', 'Provider <Test>', 'provider@example.com', 'h', clock + 1000, clock);
  db.prepare("INSERT INTO jobs(id,provider_id,title,amount,fee,tier,approval_hash,payment_hash,expires,created,paid,customer_email,appointment_at,appointment_location,appointment_version) VALUES('j','p','Cleaning',30000,6500,'standard','a','b',?,?,?,'customer@example.com',?,'Test room',1)").run(clock + 1000, clock, clock, new Date(clock + 86400000).toISOString());
  const mail = createNotifications({ db, config, now: () => clock, send: async (payload, id) => { sent.push({ payload, id }); return 'message_' + sent.length; } });
  return { db, config, mail, sent, now: () => clock, advance: ms => { clock += ms; } };
}
test('email delivery stays paused until configured and sandbox recipient restrictions are enforced', async t => {
  const f = setup(t); f.mail.payment('j'); f.config.emailEnabled = false;
  await f.mail.flush(); assert.equal(f.sent.length, 0);
  f.config.emailEnabled = true; f.config.emailAllowlist = [];
  for (let n = 0; n < 3; n++) await f.mail.flush();
  assert.equal(f.sent.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status='blocked'").get().n, 3);
});
test('accepted payment emails survive worker restarts and repeated payment notifications', async t => {
  const f = setup(t); f.mail.payment('j'); f.mail.payment('j');
  await Promise.all([f.mail.flush(), f.mail.flush()]);
  for (let n = 0; n < 3; n++) await f.mail.flush();
  assert.equal(f.sent.length, 3);
  f.mail.payment('j'); await f.mail.flush(); assert.equal(f.sent.length, 3);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status='accepted'").get().n, 3);
});

test('explicit connection tests use distinct persisted identifiers across sandbox and live sends', async t => {
  const f = setup(t);
  f.mail.test(); await f.mail.flush();
  f.config.paymentMode = 'live';
  f.mail.test(); await f.mail.flush();
  f.mail.test(); await f.mail.flush();
  assert.equal(f.sent.length, 3);
  assert.equal(new Set(f.sent.map(message => message.id)).size, 3);
  assert.match(f.sent[0].payload.subject, /Sandbox/);
  assert.doesNotMatch(f.sent[1].payload.subject, /Sandbox/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status='accepted'").get().n, 3);
});
test('ambiguous sends retry the identical message and idempotency key, then stop before key expiry', async t => {
  const f = setup(t), attempts = [];
  const mail = createNotifications({ db: f.db, config: f.config, now: f.now, send: async (payload, id) => {
    attempts.push({ payload, id }); throw Object.assign(new Error('timeout'), { code: 'network', retryable: true });
  } });
  mail.test(); await mail.flush(); f.advance(60001); await mail.flush();
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  f.advance(24 * 3600000); await mail.flush();
  assert.equal(attempts.length, 2); assert.equal(f.db.prepare('SELECT status FROM notifications').get().status, 'review');
});
test('refunds and appointment revisions suppress outdated confirmations', async t => {
  const f = setup(t); f.mail.payment('j'); f.mail.appointment('j');
  f.db.prepare('UPDATE jobs SET refunded=30000').run();
  for (let n = 0; n < 6; n++) await f.mail.flush();
  assert.equal(f.sent.length, 0);
  f.db.prepare('UPDATE jobs SET refunded=0,appointment_version=2').run(); f.mail.appointment('j');
  f.db.prepare('UPDATE jobs SET appointment_version=3').run();
  for (let n = 0; n < 3; n++) await f.mail.flush();
  assert.equal(f.sent.length, 0);
});
test('Resend transport scopes credentials to its API, supplies idempotency and safely classifies errors', async () => {
  const payload = { from: 'BMS <test@example.com>', to: ['admin@example.com'], subject: 'Test', text: 'Test' };
  assert.equal(await sendResend(payload, 'bms-id', 'test-key', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.headers['Idempotency-Key'], 'bms-id');
    assert.equal(options.headers.Authorization, 'Bearer test-key'); assert.deepEqual(JSON.parse(options.body), payload);
    return new Response(JSON.stringify({ id: 'message' }), { status: 200 });
  }), 'message');
  await assert.rejects(sendResend(payload, 'id', 'key', async () => new Response('private error body', { status: 403 })), e => e.code === 'http_403' && e.retryable === false && !e.message.includes('private'));
  await assert.rejects(sendResend(payload, 'id', 'key', async () => new Response('', { status: 429 })), e => e.retryable === true);
});

test('live messages omit sandbox wording and send to real job recipients without the sandbox allowlist', async t => {
  const f = setup(t); f.config.paymentMode = 'live'; f.config.emailAllowlist = [];
  f.mail.payment('j'); f.mail.appointment('j');
  for (let n = 0; n < 6; n++) await f.mail.flush();
  assert.equal(f.sent.length, 6);
  for (const { payload } of f.sent) {
    assert.doesNotMatch(payload.subject + payload.text + payload.html, /Sandbox|no real payment/);
    assert.match(payload.html, /Personal coordination/);
  }
  assert.deepEqual([...new Set(f.sent.map(s => s.payload.to[0]))].sort(), ['admin@example.com', 'customer@example.com', 'provider@example.com']);
});

test('delayed room emails suppress expired holds and send only current confirmations', async t => {
  const f = setup(t); f.config.paymentMode = 'live';
  const roomId = '12345678-1234-1234-1234-123456789012';
  f.db.exec('CREATE TABLE room_bookings(id TEXT PRIMARY KEY,status TEXT,date TEXT)');
  f.db.prepare('INSERT INTO room_bookings VALUES(?,?,?)').run(roomId,'expired','2026-11-15');
  f.mail.room(roomId,'payment_link','customer@example.com','Complete payment',['Old link']);
  f.mail.room(roomId,'request_admin','admin@example.com','Request',['Expired setup request']);
  await f.mail.flush(); await f.mail.flush(); assert.equal(f.sent.length,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status='cancelled'").get().n,2);
  f.db.prepare("UPDATE room_bookings SET status='confirmed'").run();
  f.mail.room(roomId,'confirmed_customer@example.com','customer@example.com','Confirmed',['Current paid booking']);
  await f.mail.flush(); assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].payload.subject,'Confirmed');
});
