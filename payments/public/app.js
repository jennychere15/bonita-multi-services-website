const app = document.querySelector('#app');
const path = location.pathname;
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const key = 'bms-private-' + path;
if (location.hash.length > 1) { sessionStorage.setItem(key, location.hash.slice(1)); history.replaceState(null, '', location.pathname + location.search); }
const access = sessionStorage.getItem(key) || '';
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function page(eyebrow, title, intro) {
  app.replaceChildren(node('div', eyebrow, 'eyebrow'), node('h1', title));
  if (intro) app.append(node('p', intro, 'intro'));
  const msg = node('div'); msg.id = 'message'; msg.setAttribute('role', 'status'); app.append(msg);
}
function notice(text, error = false) { const e = document.querySelector('#message'); e.className = 'notice' + (error ? ' error' : ''); e.textContent = text; }
async function api(url, data, authenticated = true) {
  const r = await fetch(url, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authenticated ? { Authorization: 'Bearer ' + access } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || 'Please try again.');
  return result;
}
function button(parent, label, action, secondary = false) {
  const b = node('button', label, secondary ? 'secondary' : ''); b.type = 'button'; parent.append(b);
  b.addEventListener('click', async () => { b.disabled = true; try { await action(); } catch (e) { notice(e.message, true); } finally { b.disabled = false; } });
  return b;
}
function card(parent, title, description) { const c = node('section', undefined, 'card'); c.append(node('h2', title)); if (description) c.append(node('p', description)); parent.append(c); return c; }
function field(parent, label, name, type = 'text') { const l = node('label', label), i = node('input'); i.name = name; i.id = name; i.type = type; i.required = true; l.htmlFor = name; parent.append(l, i); return i; }
function detail(parent, label, value) { const row = node('div', undefined, 'details'); row.append(node('span', label), node('strong', value)); parent.append(row); }
function link(parent, label, url) { const a = node('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; const p = node('p', undefined, 'link-output'); p.append(a); parent.append(p); }
async function provider() {
  page('BMS Preferred Provider Network', 'A seamless start to your partnership.', 'Connect your business securely with Stripe, then return here to check your payment setup.');
  const p = await api('/api/provider');
  app.append(node('p', p.name, 'eyebrow'));
  if (p.connected) {
    const c = card(app, p.ready ? 'You’re ready for paid requests.' : 'Your account is connected.', 'Check your status after completing your details with Stripe.');
    button(c, 'Check payment readiness', async () => { const r = await api('/api/provider/refresh', {}); notice(r.ready ? 'Payment setup is complete. BMS will be in touch with your next opportunity.' : 'Stripe still needs information before you can accept paid requests. Please finish your details in Stripe.'); });
    if (p.onboardingAvailable) button(c, 'Continue Stripe setup', async () => { const r = await api('/api/provider/new', {}); location.assign(r.url); }, true);
    link(c, 'Open Stripe Dashboard', 'https://dashboard.stripe.com/');
    return;
  }
  const grid = node('div', undefined, 'grid'); app.append(grid);
  const existing = card(grid, 'Already using Stripe?', 'Connect your existing business account. Your payment details remain with Stripe.');
  button(existing, 'Connect my Stripe account', async () => location.assign((await api('/api/provider/existing', {})).url));
  const fresh = card(grid, 'New to Stripe?', 'Set up your business account and payout details through Stripe’s secure onboarding.');
  button(fresh, 'Set up my account', async () => location.assign((await api('/api/provider/new', {})).url));
}
async function approve() {
  page('Provider quote review', 'A clear agreement before we begin.', 'Review this request and confirm the total and BMS coordination fee.');
  const q = await api('/api/approval'), c = card(app, q.title);
  detail(c, 'Customer’s service total', money(q.amount)); detail(c, 'BMS coordination fee', money(q.fee));
  detail(c, 'Your share before Stripe processing', money(q.amount - q.fee));
  c.append(node('p', 'Stripe deducts its processing fees from your share.', 'small'));
  if (q.approved) { notice('You’ve approved this quote. BMS can now share checkout with the customer.'); return; }
  const row = node('div', undefined, 'check'), check = node('input'), label = node('label', 'I approve this quote and the BMS coordination fee, with Stripe processing fees deducted from my share.');
  check.type = 'checkbox'; check.id = 'accept'; label.htmlFor = 'accept'; row.append(check, label); c.append(row);
  button(c, 'Approve quote', async () => { if (!check.checked) throw new Error('Please confirm the quote before approving.'); await api('/api/approval', { accept: true }); await approve(); });
}
async function pay() {
  page('Your service request', 'Thoughtfully arranged. Ready when you are.', 'Review your service details and continue to secure checkout.');
  const q = await api('/api/payment'), c = card(app, q.title);
  detail(c, 'Your service provider', q.provider); detail(c, 'Service total', money(q.amount));
  if (q.status === 'paid') { notice('Payment received. BMS will confirm your appointment details.'); return; }
  if (!['approved', 'checkout_open'].includes(q.status)) { notice('Your provider is finalizing this request. Please contact BMS for the next step.'); return; }
  button(c, 'Continue to secure checkout', async () => location.assign((await api('/api/payment/checkout', {})).url));
}
async function dashboard() {
  const data = await api('/api/admin/overview', undefined, false);
  page('BMS administration', 'Your provider network.', 'Invite approved providers, prepare quotes and follow payment progress.');
  const toolbar = node('div', undefined, 'toolbar'); app.append(toolbar);
  button(toolbar, 'Refresh status', dashboard, true);
  button(toolbar, 'Sign out', async () => { await api('/api/admin/logout', {}, false); await admin(); }, true);
  const mail = card(app, 'Email notifications', data.email.enabled ? 'Your email connection is enabled. Accepted means the email service accepted the message; it does not confirm inbox delivery.' : 'Email delivery is paused until your BMS sender is connected. Appointment details and queued emails are saved here.');
  if (data.email.enabled) button(mail, 'Send connection test to BMS', async () => { await api('/api/admin/notifications/test', {}, false); notice('Connection test queued. Refresh email status shortly.'); }, true);
  data.email.counts.forEach(s => detail(mail, s.status.replaceAll('_', ' '), String(s.count)));
  const mailDetails = node('details'); mailDetails.append(node('summary', 'Recent email activity'));
  data.email.recent.forEach(n => mailDetails.append(node('p', `${n.kind.replaceAll('_', ' ')} · ${n.recipient} · ${n.status}${n.error_code ? ' (' + n.error_code + ')' : ''}`, 'small'))); mail.append(mailDetails);
  const grid = node('div', undefined, 'grid'); app.append(grid);
  const p = card(grid, 'Invite a provider');
  const name = field(p, 'Business name', 'business-name'), email = field(p, 'Business email', 'business-email', 'email');
  button(p, 'Create private invitation', async () => {
    if (!name.reportValidity() || !email.reportValidity()) return;
    const r = await api('/api/admin/providers', { name: name.value, email: email.value }, false);
    const out = card(app, 'Provider invitation ready', 'Share this private link with the approved provider. It expires in seven days.');
    link(out, 'Open provider invitation', r.invitationUrl);
    data.providers.unshift({ id: r.id, name: name.value }); const o = node('option', name.value); o.value = r.id; select.append(o); select.value = r.id;
  });
  const q = card(grid, 'Prepare a service quote');
  const l = node('label', 'Provider'), select = node('select'); select.id = 'provider'; l.htmlFor = 'provider';
  select.append(node('option', 'Choose a provider')); select.firstChild.value = '';
  data.providers.forEach(p => { const o = node('option', p.name); o.value = p.id; select.append(o); }); q.append(l, select);
  const title = field(q, 'Service description', 'title'), amount = field(q, 'Customer total ($)', 'amount', 'number'); amount.min = '65.01'; amount.step = '.01'; amount.max = '100000';
  const tierLabel = node('label', 'Coordination tier'), tier = node('select'); tier.id = 'tier'; tierLabel.htmlFor = 'tier';
  for (const [value, label] of [['standard', 'Standard — $65'], ['expanded', 'Expanded — $99']]) { const o = node('option', label); o.value = value; tier.append(o); } q.append(tierLabel, tier);
  button(q, 'Create quote for approval', async () => {
    if (!title.reportValidity() || !amount.reportValidity()) return;
    const r = await api('/api/admin/jobs', { providerId: select.value, title: title.value, amount: Math.round(Number(amount.value) * 100), tier: tier.value }, false);
    const out = card(app, 'Quote links ready', 'Send the approval link to the provider first. Customer checkout stays locked until the provider approves. Both links expire in seven days.');
    link(out, 'Provider: review and approve', r.approvalUrl); link(out, 'Customer: review and pay', r.paymentUrl);
  });
  const providers = card(app, 'Provider readiness');
  if (!data.providers.length) providers.append(node('p', 'Your invited providers will appear here.'));
  data.providers.forEach(p => { const row = node('div', undefined, 'list-row'); row.append(node('strong', p.name), node('span', p.ready ? 'Ready for payments' : p.connected ? 'Setup in progress' : 'Awaiting connection', 'status')); providers.append(row); });
  const jobs = card(app, 'Service requests');
  if (!data.jobs.length) jobs.append(node('p', 'Your quotes and payment activity will appear here.'));
  data.jobs.forEach(j => {
    const row = node('div', undefined, 'list-row');
    row.append(node('strong', j.title + ' · ' + j.provider), node('span', money(j.amount) + ' · ' + j.status.replaceAll('_', ' ') + (j.refunded ? ' · Refunded ' + money(j.refunded) : '') + (j.dispute_status ? ' · Dispute: ' + j.dispute_status : ''), 'status'));
    if (j.approved && !j.paid && ['approved', 'checkout_open'].includes(j.status)) {
      button(row, 'Open customer checkout', async () => {
        const result = await api('/api/admin/jobs/payment-link', { jobId: j.id }, false);
        location.assign(result.paymentUrl);
      }, true);
    }
    if (j.paid && !j.refunded && !j.dispute_status) {
      button(row, 'Queue payment confirmations', async () => {
        await api('/api/admin/jobs/payment-emails', { jobId: j.id }, false);
        await dashboard(); notice('Payment confirmations queued. Previously queued or accepted messages are not duplicated.');
      }, true);
      if (j.appointment_at) row.append(node('p', 'Appointment: ' + new Date(j.appointment_at).toLocaleString() + ' · ' + j.appointment_location, 'small'));
      button(row, j.appointment_at ? 'Update appointment' : 'Confirm appointment', async () => {
        document.querySelector('#appointment-form')?.remove();
        const form = card(app, j.appointment_at ? 'Update appointment' : 'Confirm appointment', j.title + ' · ' + j.provider); form.id = 'appointment-form';
        const at = field(form, 'Date and time (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')', 'appointment-at', 'datetime-local');
        if (j.appointment_at) { const d = new Date(j.appointment_at); at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
        const place = field(form, 'Service address or meeting location', 'appointment-location'); place.maxLength = 500; place.value = j.appointment_location || '';
        const notes = field(form, 'Appointment notes (optional)', 'appointment-notes'); notes.required = false; notes.maxLength = 1000; notes.value = j.appointment_notes || '';
        form.append(node('p', data.email.enabled ? 'Saving queues confirmations for the customer, provider and BMS.' : 'Email sending is paused. Saving will queue the confirmations until the sender is connected.', 'small'));
        button(form, 'Save appointment and queue confirmations', async () => {
          if (!at.reportValidity() || !place.reportValidity()) return;
          await api('/api/admin/jobs/appointment', { jobId: j.id, appointmentAt: new Date(at.value).toISOString(), location: place.value, notes: notes.value, version: j.appointment_version }, false);
          await dashboard(); notice('Appointment saved. Confirmation emails are queued.');
        });
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, true);
    }
    jobs.append(row);
  });
}
async function admin() {
  try { await dashboard(); }
  catch {
    page('BMS administration', 'Welcome back, Jennifer.', 'Sign in to manage your provider network.');
    const c = card(app, 'Private access'), code = field(c, 'Administration access code', 'access-code', 'password'); code.autocomplete = 'current-password';
    button(c, 'Sign in', async () => { await api('/api/admin/login', { token: code.value }, false); code.value = ''; await dashboard(); });
  }
}
async function start() {
  const environment = await api('/api/health', undefined, false);
  if (environment.mode === 'live') document.querySelector('.badge').textContent = environment.livePaymentsEnabled ? 'PROVIDER NETWORK' : 'PAYMENTS SETUP';
  if (path === '/admin') return admin();
  if (path === '/provider') return provider();
  if (path === '/approve') return approve();
  if (path === '/pay') return pay();
  if (path === '/payment-return') {
    page('Your service request', 'Thank you.', 'Your payment status is being confirmed securely. BMS will follow up with your appointment details once payment is verified.');
    if (location.search.includes('cancelled')) notice('Checkout was closed. Return to your private payment link whenever you’re ready.');
    return;
  }
  page('BMS Preferred Provider Network', 'Professional connections. Personal attention.', 'This private workspace helps approved providers connect their payment accounts and manage individual service requests.');
  const c = card(app, 'Your invitation is the starting point.', 'Open the private link shared by BMS to set up your account or review your service request.');
  link(c, 'Learn about the BMS Provider Network', 'https://bonitamultiservices.com/provider-network.html');
}
start().catch(e => { if (!document.querySelector('#message')) page('BMS Provider Network', 'Let’s get you connected.'); notice(e.message, true); });
