import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createApp } from '../src/app.js';
import { openStore } from '../src/store.js';
import { accountReady, hash, quote } from '../src/domain.js';

const base = 'http://localhost:4242';
const goodAccount = { id: 'acct_provider', country: 'US', charges_enabled: true, payouts_enabled: true,
  capabilities: { card_payments: 'active' }, controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' } } };
function fixture(overrides = {}) {
  const db = openStore(), calls = [], sdk = new Stripe('sk_test_fixture');
  let account = structuredClone(goodAccount), sessionStatus = 'open';
  const stripe = {
    webhooks: sdk.webhooks,
    accounts: { retrieve: async () => account },
    oauth: { token: async (...args) => { calls.push(['oauth', ...args]); return { stripe_user_id: 'acct_provider', livemode: false, scope: 'read_write' }; } },
    v2: { core: { accounts: { create: async (...args) => { calls.push(['account', ...args]); return { id: 'acct_provider', livemode: false }; } },
      accountLinks: { create: async (...args) => { calls.push(['link', ...args]); return { url: 'https://connect.stripe.com/setup/test' }; } } } },
    checkout: { sessions: {
      create: async (...args) => { calls.push(['checkout', ...args]); return { id: 'cs_test_bms', url: 'https://checkout.stripe.com/test', livemode: false }; },
      retrieve: async () => ({ id: 'cs_test_bms', status: sessionStatus, url: 'https://checkout.stripe.com/test' })
    } },
    paymentIntents: { retrieve: async (...args) => { calls.push(['intent', ...args]); const j = db.prepare('SELECT * FROM jobs').get(); return {
      id: 'pi_test_bms', livemode: false, status: 'succeeded', amount_received: j.amount, currency: 'usd', application_fee_amount: j.fee, metadata: { bms_job_id: j.id }
    }; } }
  };
  const config = { baseUrl: base, adminToken: 'test-admin-access-code-that-is-long-enough', stripeKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', clientId: 'ca_test', adminEmail: 'admin@example.com', ...overrides };
  const app = createApp({ db, stripe, config });
  let adminCookie;
  async function request(path, { data, token, cookie, origin = base, method } = {}) {
    const r = await app(new Request(base + path, { method: method || (data === undefined ? 'GET' : 'POST'),
      headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) }));
    const result = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { r, result };
  }
  async function login() {
    const { r } = await request('/api/admin/login', { data: { token: config.adminToken } });
    assert.equal(r.status, 200); adminCookie = r.headers.get('set-cookie').split(';')[0]; return adminCookie;
  }
  async function provider() {
    if (!adminCookie) await login();
    const { result, r } = await request('/api/admin/providers', { cookie: adminCookie, data: { name: 'Polished Property Care', email: 'provider@example.com' } });
    assert.equal(r.status, 201); return { ...result, token: new URL(result.invitationUrl).hash.slice(1) };
  }
  async function job(p, tier = 'standard') {
    const { r, result } = await request('/api/admin/jobs', { cookie: adminCookie, data: { title: 'Property service', providerId: p.id, amount: 30000, tier } });
    assert.equal(r.status, 201); return { ...result, approval: new URL(result.approvalUrl).hash.slice(1), payment: new URL(result.paymentUrl).hash.slice(1) };
  }
  function connect(p) { db.prepare("UPDATE providers SET account_id='acct_provider',account_kind='oauth',connected=1 WHERE id=?").run(p.id); }
  async function approve(j) { return request('/api/approval', { token: j.approval, data: { accept: true } }); }
  async function checkout(j, overrides = {}) { return request('/api/payment/checkout', { token: j.payment, data: overrides }); }
  async function event(type, object, { accountId = 'acct_provider', id = 'evt_test_' + Math.random(), live = false, signature = true } = {}) {
    const payload = JSON.stringify({ id, object: 'event', livemode: live, type, account: accountId, data: { object } });
    const sig = signature ? sdk.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret }) : 'invalid';
    const r = await app(new Request(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig, 'Content-Type': 'application/json' }, body: payload }));
    return { r, result: await r.json() };
  }
  return { db, app, stripe, config, calls, request, login, provider, job, connect, approve, checkout, event, setAccount: a => { account = a; }, setSession: s => { sessionStatus = s; } };
}

test('only approved fixed tiers and integer cents are accepted', () => {
  assert.equal(quote({ title: 'Service', amount: 30000, tier: 'standard' }).fee, 6500);
  assert.equal(quote({ title: 'Service', amount: 30000, tier: 'expanded' }).fee, 9900);
  for (const amount of [6500, -1, 100.5, NaN, 10000001]) assert.throws(() => quote({ title: 'Service', amount, tier: 'standard' }));
  assert.throws(() => quote({ title: 'Service', amount: 30000, tier: 'custom' }));
});
test('provider account must match the agreed payment responsibility configuration', () => {
  assert.equal(accountReady(goodAccount), true);
  for (const key of ['charges_enabled', 'payouts_enabled']) assert.equal(accountReady({ ...goodAccount, [key]: false }), false);
  assert.equal(accountReady({ ...goodAccount, country: 'CA' }), false);
  assert.equal(accountReady({ ...goodAccount, controller: { ...goodAccount.controller, fees: { payer: 'application' } } }), false);
});
test('OAuth Standard accounts with abbreviated controller data remain eligible without bypassing restrictions', () => {
  const account = { ...goodAccount, type: 'standard', controller: { type: 'account' } };
  assert.equal(accountReady(account), true);
  for (const key of ['charges_enabled', 'payouts_enabled']) assert.equal(accountReady({ ...account, [key]: false }), false);
  assert.equal(accountReady({ ...account, capabilities: { card_payments: 'pending' } }), false);
  assert.equal(accountReady({ ...account, type: 'express' }), false);
  assert.equal(accountReady({ ...account, controller: { type: 'application' } }), false);
  for (const conflict of [{ fees: { payer: 'application' } }, { losses: { payments: 'application' } }, { stripe_dashboard: { type: 'express' } }]) {
    assert.equal(accountReady({ ...account, controller: { ...account.controller, ...conflict } }), false);
  }
});
test('admin writes require authentication and exact same-origin requests', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.request('/api/admin/providers', { data: { name: 'x', email: 'x@x.com' } })).r.status, 401);
  const cookie = await f.login();
  assert.equal((await f.request('/api/admin/providers', { data: {}, cookie, origin: 'https://attacker.example' })).r.status, 403);
  assert.equal((await f.request('/api/admin/overview', { cookie })).r.status, 200);
});
test('private invitation tokens are hashed, expired links are denied and approval/payment links have separate permissions', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p);
  assert.equal(f.db.prepare('SELECT invite_hash FROM providers').get().invite_hash, hash(p.token));
  assert.equal((await f.request('/api/approval', { token: j.payment })).r.status, 401);
  assert.equal((await f.request('/api/payment', { token: j.approval })).r.status, 401);
  f.db.prepare('UPDATE providers SET expires=0').run();
  assert.equal((await f.request('/api/provider', { token: p.token })).r.status, 401);
});
test('administrators can recover an approved payment link after refreshing without changing the quote', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p);
  const path = '/api/admin/jobs/payment-link', data = { jobId: j.id };
  assert.equal((await f.request(path, { data })).r.status, 401);
  const cookie = await f.login();
  assert.equal((await f.request(path, { data, cookie })).r.status, 409);
  await f.approve(j);
  assert.equal((await f.request(path, { data, cookie, origin: 'https://attacker.example' })).r.status, 403);
  const result = await f.request(path, { data, cookie });
  assert.equal(result.r.status, 200);
  assert.equal((await f.request('/api/payment', { token: j.payment })).r.status, 401);
  const renewed = new URL(result.result.paymentUrl).hash.slice(1);
  assert.equal((await f.request('/api/payment', { token: renewed })).result.amount, 30000);
  const stored = f.db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id);
  assert.equal(stored.fee, 6500); assert.ok(stored.approved);
  f.db.prepare("UPDATE jobs SET paid=1,status='paid' WHERE id=?").run(j.id);
  assert.equal((await f.request(path, { data, cookie })).r.status, 409);
});
test('new providers use Accounts v2 and hosted onboarding without duplicating accounts', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider();
  assert.equal((await f.request('/api/provider/new', { token: p.token, data: {} })).r.status, 200);
  assert.equal((await f.request('/api/provider/new', { token: p.token, data: {} })).r.status, 200);
  assert.equal(f.calls.filter(x => x[0] === 'account').length, 1);
  const params = f.calls.find(x => x[0] === 'account')[1];
  assert.equal(params.dashboard, 'full'); assert.deepEqual(params.defaults.responsibilities, { fees_collector: 'stripe', losses_collector: 'stripe' });
  assert.equal(params.configuration.merchant.capabilities.card_payments.requested, true);
  assert.equal(f.calls.filter(x => x[0] === 'link').length, 2);
});
test('existing-account OAuth is browser-bound, one-use and sandbox-only', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider();
  const start = await f.request('/api/provider/existing', { token: p.token, data: {} });
  const state = new URL(start.result.url).searchParams.get('state'), cookie = start.r.headers.get('set-cookie').split(';')[0];
  const callback = '/oauth/callback?code=ac_example&state=' + state;
  assert.equal((await f.request(callback)).r.status, 403);
  assert.equal((await f.request(callback, { cookie })).r.status, 303);
  assert.equal((await f.request(callback, { cookie })).r.status, 403);
  assert.equal(f.calls.filter(x => x[0] === 'oauth').length, 1);
  assert.equal(f.db.prepare('SELECT connected FROM providers').get().connected, 1);
});
test('customer cannot pay before approval, or alter the approved amount, fee or provider', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p);
  assert.equal((await f.checkout(j)).r.status, 409);
  await f.approve(j);
  assert.equal((await f.checkout(j, { amount: 1, application_fee_amount: 0, account: 'acct_attacker' })).r.status, 200);
  const call = f.calls.find(x => x[0] === 'checkout');
  assert.equal(call[1].line_items[0].price_data.unit_amount, 30000);
  assert.equal(call[1].payment_intent_data.application_fee_amount, 6500);
  assert.equal(call[2].stripeAccount, 'acct_provider');
  assert.equal('transfer_data' in call[1].payment_intent_data, false);
  assert.equal('payment_method_types' in call[1], false);
  assert.match(call[1].integration_identifier, /^bms-provider-[a-z]{8}$/);
  await f.checkout(j); assert.equal(f.calls.filter(x => x[0] === 'checkout').length, 1);
});
test('expanded coordination collects exactly $99 and readiness failures block checkout', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p, 'expanded'); f.connect(p); await f.approve(j);
  f.setAccount({ ...goodAccount, payouts_enabled: false }); assert.equal((await f.checkout(j)).r.status, 409);
  f.setAccount(goodAccount); await f.checkout(j);
  assert.equal(f.calls.find(x => x[0] === 'checkout')[1].payment_intent_data.application_fee_amount, 9900);
});
test('network retries preserve exact Checkout parameters and Stripe idempotency key', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p); await f.approve(j);
  await f.checkout(j);
  // Simulate Stripe succeeding but the service losing the response before persisting its session ID.
  f.db.prepare('UPDATE jobs SET checkout_id=NULL,checkout_url=NULL').run();
  await f.checkout(j);
  const calls = f.calls.filter(x => x[0] === 'checkout'); assert.deepEqual(calls[0], calls[1]);
});
test('only signed, account-bound, paid events matching quote and fee can mark payment received', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p); await f.approve(j); await f.checkout(j);
  const payload = { id: 'cs_test_bms', metadata: { bms_job_id: j.id }, client_reference_id: j.id, amount_total: 30000, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_test_bms' };
  assert.equal((await f.event('checkout.session.completed', payload, { signature: false })).r.status, 400);
  assert.equal((await f.event('checkout.session.completed', payload, { live: true })).r.status, 400);
  assert.equal((await f.event('checkout.session.completed', payload, { accountId: 'acct_attacker' })).r.status, 409);
  assert.equal((await f.event('checkout.session.completed', { ...payload, amount_total: 100 })).r.status, 409);
  await f.event('checkout.session.completed', { ...payload, payment_status: 'unpaid' });
  assert.equal(f.db.prepare('SELECT paid FROM jobs').get().paid, null);
  const opts = { id: 'evt_valid' };
  assert.equal((await f.event('checkout.session.async_payment_succeeded', payload, opts)).r.status, 200);
  const paid = f.db.prepare('SELECT paid FROM jobs').get().paid; assert.ok(paid);
  await f.event('checkout.session.async_payment_succeeded', payload, opts);
  assert.equal(f.db.prepare('SELECT paid FROM jobs').get().paid, paid);
  assert.equal(f.calls.filter(x => x[0] === 'intent').length, 1);
  assert.equal((await f.checkout(j)).r.status, 409);
});
test('redirect return never fulfills a job, and disconnected providers cannot accept payments', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p); await f.approve(j);
  await f.request('/payment-return'); assert.equal(f.db.prepare('SELECT paid FROM jobs').get().paid, null);
  await f.event('account.application.deauthorized', {});
  assert.equal((await f.checkout(j)).r.status, 409);
});
test('refunds and disputes update only the matching connected account payment', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p);
  f.db.prepare("UPDATE jobs SET payment_intent='pi_test_bms',status='paid',paid=1 WHERE id=?").run(j.id);
  await f.event('charge.refunded', { payment_intent: 'pi_test_bms', amount_refunded: 30000 }, { accountId: 'acct_attacker' });
  assert.equal(f.db.prepare('SELECT refunded FROM jobs').get().refunded, 0);
  await f.event('charge.refunded', { payment_intent: 'pi_test_bms', amount_refunded: 30000 });
  await f.event('charge.dispute.created', { payment_intent: 'pi_test_bms', status: 'needs_response' });
  const row = f.db.prepare('SELECT * FROM jobs').get(); assert.equal(row.refunded, 30000); assert.equal(row.dispute_status, 'needs_response');
});
test('refund and dispute state survives delayed and out-of-order webhook events', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p); await f.approve(j); await f.checkout(j);
  await f.event('charge.refunded', { payment_intent: 'pi_test_bms', amount_refunded: 30000 });
  await f.event('charge.refunded', { payment_intent: 'pi_test_bms', amount_refunded: 10000 });
  await f.event('charge.dispute.closed', { payment_intent: 'pi_test_bms', status: 'won' });
  await f.event('charge.dispute.created', { payment_intent: 'pi_test_bms', status: 'needs_response' });
  await f.event('checkout.session.completed', { id: 'cs_test_bms', metadata: { bms_job_id: j.id }, client_reference_id: j.id, amount_total: 30000, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_test_bms' });
  const row = f.db.prepare('SELECT * FROM jobs').get(); assert.equal(row.refunded, 30000); assert.equal(row.dispute_status, 'won'); assert.equal(row.status, 'paid');
});


test('verified payment notifications are durable, deduplicated and exclude internal fees from customer email', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p); await f.approve(j); await f.checkout(j);
  const payload = { id: 'cs_test_bms', metadata: { bms_job_id: j.id }, client_reference_id: j.id, amount_total: 30000, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_test_bms', customer_details: { email: 'customer@example.com' } };
  await f.request('/payment-return'); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
  await f.event('checkout.session.completed', payload, { signature: false });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
  await f.event('checkout.session.completed', payload);
  await f.event('checkout.session.async_payment_succeeded', payload);
  const emails = f.db.prepare('SELECT * FROM notifications').all(); assert.equal(emails.length, 3);
  const customer = JSON.parse(emails.find(e => e.kind === 'payment_customer').payload);
  assert.match(customer.text, /300.00/); assert.doesNotMatch(customer.text, /65.00|coordination fee|share before/);
  assert.equal(f.db.prepare('SELECT customer_email FROM jobs').get().customer_email, 'customer@example.com');
  assert.equal(emails.every(e => e.status === 'pending'), true);
});
test('appointment confirmations require admin access, verified paid customer email and a valid future schedule', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p);
  const path = '/api/admin/jobs/appointment', data = { jobId: j.id, version: 0, appointmentAt: new Date(Date.now() + 86400000).toISOString(), location: 'Test meeting room', notes: '<Welcome>' };
  assert.equal((await f.request(path, { data })).r.status, 401); const cookie = await f.login();
  assert.equal((await f.request(path, { cookie, data })).r.status, 409);
  f.db.prepare("UPDATE jobs SET status='paid',paid=1,customer_email='customer@example.com'").run();
  assert.equal((await f.request(path, { cookie, data, origin: 'https://attacker.example' })).r.status, 403);
  assert.equal((await f.request(path, { cookie, data: { ...data, appointmentAt: '2020-01-01T00:00:00Z' } })).r.status, 400);
  assert.equal((await f.request(path, { cookie, data })).r.status, 200);
  assert.equal((await f.request(path, { cookie, data })).r.status, 409);
  const emails = f.db.prepare('SELECT * FROM notifications').all(); assert.equal(emails.length, 3);
  const customer = JSON.parse(emails.find(e => e.kind === 'appointment_customer').payload);
  assert.match(customer.html, /&lt;Welcome&gt;/); assert.match(customer.text, /Eastern Time/);
  f.db.prepare('UPDATE jobs SET refunded=100').run();
  assert.equal((await f.request(path, { cookie, data: { ...data, version: 1 } })).r.status, 409);
  f.db.prepare("UPDATE jobs SET refunded=0,dispute_status='needs_response'").run();
  assert.equal((await f.request(path, { cookie, data: { ...data, version: 1 } })).r.status, 409);
});

test('earlier verified payments recover email from matching Stripe Checkout and queue confirmations once', async t => {
  const f = fixture(); t.after(() => f.db.close()); const p = await f.provider(), j = await f.job(p); f.connect(p);
  f.db.prepare("UPDATE jobs SET paid=1,status='paid',payment_intent='pi_test_bms',checkout_id='cs_test_bms'").run();
  const cookie = await f.login(), data = { jobId: j.id }, path = '/api/admin/jobs/payment-emails';
  assert.equal((await f.request(path, { data })).r.status, 401);
  let matching = false;
  f.stripe.checkout.sessions.retrieve = async (...args) => {
    assert.equal(args[2].stripeAccount, 'acct_provider');
    return { livemode: false, payment_status: 'paid', payment_intent: matching ? 'pi_test_bms' : 'pi_wrong', client_reference_id: j.id, amount_total: 30000, currency: 'usd', customer_details: { email: 'customer@example.com' } };
  };
  assert.equal((await f.request(path, { cookie, data })).r.status, 409); matching = true;
  assert.equal((await f.request(path, { cookie, data })).r.status, 200);
  assert.equal((await f.request(path, { cookie, data })).r.status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 3);
  f.db.prepare('UPDATE jobs SET refunded=30000').run();
  assert.equal((await f.request(path, { cookie, data })).r.status, 409);
});
