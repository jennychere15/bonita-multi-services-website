import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { accountReady, checkoutParams, equal, hash, quote, requireCondition, text, token } from './domain.js';

const DAY = 86400000;
const PUBLIC = new URL('../public/', import.meta.url);
export function createApp({ db, stripe, oauthStripe = stripe, config, now = Date.now }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const audit = (action, id) => run('INSERT INTO audit(action,record_id,created) VALUES(?,?,?)', action, id, now());
  const cookie = (request, name) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
  const cookieHeader = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.baseUrl.startsWith('https:') ? '; Secure' : ''}`;
  const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const redirect = (url, headers = {}) => new Response(null, { status: 303, headers: { Location: url, ...headers } });
  const requireStripe = () => requireCondition(stripe && config.stripeKey && config.webhookSecret, 'Stripe sandbox configuration is not complete yet.', 503);
  const bearer = request => request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  function providerAuth(request) {
    const p = one('SELECT * FROM providers WHERE invite_hash=? AND expires>?', hash(bearer(request)), now());
    requireCondition(p, 'This invitation has expired or is unavailable. Contact BMS for a new invitation.', 401);
    return p;
  }
  function jobAuth(request, scope) {
    const j = one(`SELECT * FROM jobs WHERE ${scope === 'approval' ? 'approval_hash' : 'payment_hash'}=? AND expires>?`, hash(bearer(request)), now());
    requireCondition(j, 'This private link has expired or is unavailable. Please contact BMS.', 401);
    return j;
  }
  function adminAuth(request) {
    requireCondition(one('SELECT hash FROM admin_sessions WHERE hash=? AND expires>?', hash(cookie(request, 'bms_admin') || ''), now()), 'Please sign in to BMS administration.', 401);
  }
  async function body(request) {
    requireCondition(request.headers.get('content-type')?.startsWith('application/json'), 'Use JSON for this request.', 415);
    const raw = await request.text();
    requireCondition(Buffer.byteLength(raw) < 16384, 'Request too large.', 413);
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
  async function refreshProvider(p) {
    requireCondition(p.connected && p.account_id, 'Connect your Stripe account first.', 409);
    const account = await stripe.accounts.retrieve(p.account_id);
    const ready = accountReady(account);
    run('UPDATE providers SET ready=? WHERE id=?', Number(ready), p.id);
    return ready;
  }
  const loginAttempts = new Map();
  async function route(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === 'POST' && path !== '/api/webhooks/stripe') {
      requireCondition(request.headers.get('origin') === config.baseUrl, 'Request origin is not allowed.', 403);
    }
    if (method === 'GET' && path === '/api/health') return json({ status: 'ok', mode: 'sandbox', stripeConfigured: Boolean(config.stripeKey && config.webhookSecret), oauthConfigured: Boolean(config.clientId) });
    if (method === 'POST' && path === '/api/admin/login') {
      const input = await body(request);
      // Global bounded rate limit: repeated login attempts cannot grow process memory.
      const window = Math.floor(now() / 60000);
      const count = loginAttempts.get(window) || 0;
      loginAttempts.clear(); loginAttempts.set(window, count + 1);
      requireCondition(count < 10, 'Please wait a minute before trying again.', 429);
      requireCondition(typeof input.token === 'string' && equal(input.token, config.adminToken), 'Invalid administration access code.', 401);
      const session = token();
      run('DELETE FROM admin_sessions WHERE expires<?', now());
      run('INSERT INTO admin_sessions VALUES(?,?)', hash(session), now() + 8 * 3600000);
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('bms_admin', session, 28800) });
    }
    if (path.startsWith('/api/admin/')) {
      adminAuth(request);
      if (method === 'POST' && path === '/api/admin/logout') {
        run('DELETE FROM admin_sessions WHERE hash=?', hash(cookie(request, 'bms_admin') || ''));
        return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('bms_admin', '', 0) });
      }
      if (method === 'GET' && path === '/api/admin/overview') return json({
        providers: db.prepare('SELECT id,name,email,account_id,ready,connected,expires FROM providers ORDER BY created DESC LIMIT 100').all(),
        jobs: db.prepare('SELECT j.id,j.title,j.amount,j.fee,j.tier,j.status,j.approved,j.paid,j.refunded,j.dispute_status,p.name AS provider FROM jobs j JOIN providers p ON p.id=j.provider_id ORDER BY j.created DESC LIMIT 100').all()
      });
      if (method === 'POST' && path === '/api/admin/providers') {
        const input = await body(request), name = text(input.name), email = text(input.email, 254);
        requireCondition(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
        const id = randomUUID(), invite = token();
        run('INSERT INTO providers(id,name,email,invite_hash,expires,created) VALUES(?,?,?,?,?,?)', id, name, email, hash(invite), now() + 7 * DAY, now());
        audit('provider_invited', id);
        return json({ id, invitationUrl: config.baseUrl + '/provider#' + invite }, 201);
      }
      if (method === 'POST' && path === '/api/admin/jobs/payment-link') {
        const input = await body(request), j = one('SELECT * FROM jobs WHERE id=?', input.jobId || '');
        requireCondition(j, 'Service request was not found.', 404);
        requireCondition(j.approved && !j.paid && ['approved', 'checkout_open'].includes(j.status), 'Only approved, unpaid requests can receive a payment link.', 409);
        const payment = token();
        run('UPDATE jobs SET payment_hash=?,expires=? WHERE id=?', hash(payment), now() + 7 * DAY, j.id);
        audit('payment_link_renewed', j.id);
        return json({ paymentUrl: config.baseUrl + '/pay#' + payment });
      }
      if (method === 'POST' && path === '/api/admin/jobs') {
        const input = await body(request), q = quote(input);
        requireCondition(one('SELECT id FROM providers WHERE id=?', input.providerId || ''), 'Choose a provider.');
        const id = randomUUID(), approval = token(), payment = token();
        run('INSERT INTO jobs(id,provider_id,title,amount,fee,tier,approval_hash,payment_hash,expires,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id, input.providerId, q.title, q.amount, q.fee, q.tier, hash(approval), hash(payment), now() + 7 * DAY, now());
        audit('quote_created', id);
        return json({ id, approvalUrl: config.baseUrl + '/approve#' + approval, paymentUrl: config.baseUrl + '/pay#' + payment }, 201);
      }
    }
    if (path.startsWith('/api/provider')) {
      const p = providerAuth(request);
      if (method === 'GET' && path === '/api/provider') return json({ name: p.name, connected: Boolean(p.connected), ready: Boolean(p.ready), onboardingAvailable: p.account_kind === 'v2' });
      if (method === 'POST' && path === '/api/provider/refresh') {
        requireStripe();
        return json({ ready: await refreshProvider(p) });
      }
      if (method === 'POST' && path === '/api/provider/existing') {
        requireStripe();
        requireCondition(config.clientId, 'Existing-account connections have not been configured yet.', 503);
        requireCondition(!p.account_id, 'This provider already has a linked account.', 409);
        const state = token(), browser = token();
        run('DELETE FROM oauth_states WHERE expires<? OR provider_id=?', now(), p.id);
        run('INSERT INTO oauth_states VALUES(?,?,?,?)', hash(state), p.id, hash(browser), now() + 600000);
        const oauth = new URL('https://connect.stripe.com/oauth/authorize');
        oauth.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId,
          scope: 'read_write', state, redirect_uri: config.baseUrl + '/oauth/callback', 'stripe_user[email]': p.email }).toString();
        return json({ url: oauth.href }, 200, { 'Set-Cookie': cookieHeader('bms_oauth', browser, 600) });
      }
      if (method === 'POST' && path === '/api/provider/new') {
        requireStripe();
        if (!p.account_id) {
          const account = await stripe.v2.core.accounts.create({ contact_email: p.email, display_name: p.name,
            dashboard: 'full', identity: { country: 'us' },
            configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
            defaults: { currency: 'usd', responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
            metadata: { bms_provider_id: p.id } }, { idempotencyKey: 'bms-provider-' + p.id });
          requireCondition(account.livemode === false, 'Unexpected Stripe account mode.', 502);
          run('UPDATE providers SET account_id=?,account_kind=?,connected=1 WHERE id=?', account.id, 'v2', p.id);
          p.account_id = account.id; p.account_kind = 'v2';
          audit('sandbox_account_created', p.id);
        }
        requireCondition(p.account_kind === 'v2',
          'Use your existing Stripe Dashboard to manage this account.', 409);
        // An unlinked account must never be silently reactivated.
        const current = one('SELECT connected FROM providers WHERE id=?', p.id);
        requireCondition(current.connected === 1, 'This account was disconnected. Contact BMS.', 409);
        const link = await stripe.v2.core.accountLinks.create({ account: p.account_id, use_case: {
          type: 'account_onboarding', account_onboarding: { refresh_url: config.baseUrl + '/provider?refresh=1',
            return_url: config.baseUrl + '/provider?returned=1', collection_options: { fields: 'eventually_due' } }
        } });
        return json({ url: link.url });
      }
    }
    if (method === 'GET' && path === '/oauth/callback') {
      requireStripe();
      const state = one('SELECT * FROM oauth_states WHERE hash=? AND expires>?', hash(url.searchParams.get('state') || ''), now());
      requireCondition(state && equal(state.browser_hash, hash(cookie(request, 'bms_oauth') || '')), 'Stripe connection session expired. Please start again from your invitation.', 403);
      // Consume before exchanging: OAuth codes must never be replayed or automatically retried.
      run('DELETE FROM oauth_states WHERE hash=?', state.hash);
      if (url.searchParams.has('error')) return redirect(config.baseUrl + '/provider?connection=cancelled', { 'Set-Cookie': cookieHeader('bms_oauth', '', 0) });
      const code = text(url.searchParams.get('code'), 512);
      const result = await oauthStripe.oauth.token({ grant_type: 'authorization_code', code });
      requireCondition(result.livemode === false && result.scope === 'read_write' && /^acct_/.test(result.stripe_user_id), 'Stripe connection did not match sandbox access.', 409);
      requireCondition(!one('SELECT id FROM providers WHERE account_id=? AND id<>?', result.stripe_user_id, state.provider_id), 'This Stripe account is already linked to another provider.', 409);
      run('UPDATE providers SET account_id=?,account_kind=?,connected=1 WHERE id=?', result.stripe_user_id, 'oauth', state.provider_id);
      audit('existing_account_connected', state.provider_id);
      // Deliberately discard deprecated access/refresh tokens; use the platform key + connected account scope.
      return redirect(config.baseUrl + '/provider?returned=1', { 'Set-Cookie': cookieHeader('bms_oauth', '', 0) });
    }
    if (path === '/api/approval') {
      const j = jobAuth(request, 'approval');
      if (method === 'GET') return json({ title: j.title, amount: j.amount, fee: j.fee, approved: Boolean(j.approved), status: j.status });
      if (method === 'POST') {
        const input = await body(request);
        requireCondition(input.accept === true, 'Please confirm the quote and coordination fee.');
        requireCondition(['awaiting_provider', 'approved'].includes(j.status), 'This quote can no longer be approved.', 409);
        run("UPDATE jobs SET approved=COALESCE(approved,?),status='approved' WHERE id=?", now(), j.id);
        audit('provider_approved_quote', j.id);
        return json({ approved: true });
      }
    }
    if (path === '/api/payment' || path === '/api/payment/checkout') {
      const j = jobAuth(request, 'payment');
      if (method === 'GET' && path === '/api/payment') {
        const p = one('SELECT name FROM providers WHERE id=?', j.provider_id);
        return json({ title: j.title, amount: j.amount, provider: p.name, status: j.status, approved: Boolean(j.approved) });
      }
      if (method === 'POST' && path === '/api/payment/checkout') {
        requireStripe();
        requireCondition(j.approved && ['approved', 'checkout_open'].includes(j.status), 'Your provider is finalizing this quote. Please contact BMS.', 409);
        const p = one('SELECT * FROM providers WHERE id=?', j.provider_id);
        requireCondition(await refreshProvider(p), 'Your provider is completing payment setup. Please contact BMS.', 409);
        if (j.checkout_id) {
          const existing = await stripe.checkout.sessions.retrieve(j.checkout_id, {}, { stripeAccount: p.account_id });
          requireCondition(existing.status === 'open', 'This checkout has been completed or expired. Please contact BMS.', 409);
          return json({ url: existing.url });
        }
        // Persist exact parameters before the network request. Retries and concurrent requests share the same Stripe idempotency key and payload.
        run('UPDATE jobs SET checkout_params=COALESCE(checkout_params,?) WHERE id=?', JSON.stringify(checkoutParams(j, config.baseUrl)), j.id);
        const params = JSON.parse(one('SELECT checkout_params FROM jobs WHERE id=?', j.id).checkout_params);
        requireCondition(params.expires_at * 1000 > now() + 60000, 'This checkout invitation has expired. Please contact BMS for a refreshed quote.', 409);
        const session = await stripe.checkout.sessions.create(params, { stripeAccount: p.account_id, idempotencyKey: 'bms-checkout-' + j.id });
        requireCondition(session.livemode === false, 'Unexpected Stripe payment mode.', 502);
        run("UPDATE jobs SET checkout_id=?,checkout_url=?,status=CASE WHEN paid IS NULL THEN 'checkout_open' ELSE status END WHERE id=?", session.id, session.url, j.id);
        audit('checkout_created', j.id);
        return json({ url: session.url });
      }
    }
    if (method === 'POST' && path === '/api/webhooks/stripe') {
      requireStripe();
      let event;
      try { event = stripe.webhooks.constructEvent(Buffer.from(await request.arrayBuffer()), request.headers.get('stripe-signature'), config.webhookSecret); }
      catch { return json({ error: 'Invalid webhook signature.' }, 400); }
      requireCondition(event.livemode === false, 'Live events are not accepted by this sandbox.', 400);
      if (one('SELECT id FROM webhook_events WHERE id=?', event.id)) return json({ received: true });
      const object = event.data.object;
      let payment;
      let adjustmentJob;
      // Refund/dispute notifications can arrive before the checkout-paid notification.
      if (event.type === 'charge.refunded' || event.type.startsWith('charge.dispute.')) {
        const provider = one('SELECT id FROM providers WHERE account_id=?', event.account || '');
        if (provider && typeof object.payment_intent === 'string') {
          const pi = await stripe.paymentIntents.retrieve(object.payment_intent, {}, { stripeAccount: event.account });
          const j = one('SELECT * FROM jobs WHERE id=? AND provider_id=?', pi.metadata?.bms_job_id || '', provider.id);
          if (j && pi.livemode === false && pi.amount_received === j.amount && pi.application_fee_amount === j.fee) adjustmentJob = j.id;
        }
      }
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && object.payment_status === 'paid') {
        const j = one('SELECT j.*,p.account_id,p.connected FROM jobs j JOIN providers p ON p.id=j.provider_id WHERE j.id=?', object.metadata?.bms_job_id || '');
        if (j) {
          requireCondition(j.approved && j.connected === 1 && event.account === j.account_id && object.id === j.checkout_id && object.client_reference_id === j.id && object.amount_total === j.amount && object.currency === 'usd', 'Payment does not match the approved quote.', 409);
          const pi = await stripe.paymentIntents.retrieve(object.payment_intent, {}, { stripeAccount: j.account_id });
          requireCondition(pi.livemode === false && pi.status === 'succeeded' && pi.amount_received === j.amount && pi.currency === 'usd' && pi.application_fee_amount === j.fee && pi.metadata?.bms_job_id === j.id, 'Payment fee verification failed.', 409);
          payment = { job: j.id, intent: pi.id };
        }
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        if (one('SELECT id FROM webhook_events WHERE id=?', event.id)) { db.exec('COMMIT'); return json({ received: true }); }
        if (payment) run("UPDATE jobs SET status='paid',paid=COALESCE(paid,?),payment_intent=? WHERE id=?", now(), payment.intent, payment.job);
        if (event.type === 'account.application.deauthorized') run('UPDATE providers SET connected=0,ready=0 WHERE account_id=?', event.account || '');
        if (event.type === 'account.updated') run('UPDATE providers SET ready=? WHERE account_id=? AND connected=1', Number(accountReady(object)), object.id);
        if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) run('UPDATE jobs SET status=? WHERE checkout_id=? AND paid IS NULL AND provider_id IN (SELECT id FROM providers WHERE account_id=?)', event.type.endsWith('expired') ? 'expired' : 'payment_failed', object.id, event.account || '');
        if (event.type === 'charge.refunded' && adjustmentJob) run('UPDATE jobs SET refunded=MAX(refunded,?) WHERE id=?', object.amount_refunded, adjustmentJob);
        if (event.type.startsWith('charge.dispute.') && adjustmentJob) run("UPDATE jobs SET dispute_status=? WHERE id=? AND (dispute_status IS NULL OR dispute_status NOT IN ('won','lost','warning_closed'))", object.status, adjustmentJob);
        run('INSERT INTO webhook_events VALUES(?,?,?)', event.id, event.type, now());
        audit(event.type, payment?.job || event.account || event.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json({ received: true });
    }
    const files = { '/': ['index.html', 'text/html'], '/admin': ['index.html', 'text/html'], '/provider': ['index.html', 'text/html'], '/approve': ['index.html', 'text/html'], '/pay': ['index.html', 'text/html'], '/payment-return': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (method === 'GET' && files[path]) return new Response(await readFile(new URL(files[path][0], PUBLIC)), { headers: { 'Content-Type': files[path][1] + '; charset=utf-8' } });
    return json({ error: 'Not found.' }, 404);
  }
  return async request => {
    let response;
    try { response = await route(request); }
    catch (error) {
      const status = error.status || (error.type?.startsWith('Stripe') ? 502 : 500);
      // Never return Stripe response bodies, OAuth codes, credentials, or internal stack traces.
      if (status >= 500) console.error('BMS request failed', { code: error.code || 'internal_error', type: error.type || error.name, stripeStatus: error.statusCode, requestId: error.requestId, restrictedKeyRejected: /restricted.*key|key.*restricted/i.test(error.message || ''), path: new URL(request.url).pathname });
      response = json({ error: status >= 500 ? 'This service is not ready right now. Please contact BMS or try again shortly.' : error.message }, status);
    }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return response;
  };
}
