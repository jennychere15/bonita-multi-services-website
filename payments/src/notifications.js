import { createHash } from 'node:crypto';

const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendResend(payload, id, apiKey, fetcher = fetch) {
  let response;
  try {
    response = await fetcher('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': id },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  } catch { throw Object.assign(new Error('Email request could not be confirmed.'), { code: 'network', retryable: true }); }
  if (!response.ok) throw Object.assign(new Error('Email service rejected the request.'), { code: 'http_' + response.status, retryable: response.status === 429 || response.status >= 500 });
  const result = await response.json();
  if (typeof result.id !== 'string') throw Object.assign(new Error('Email response could not be confirmed.'), { code: 'invalid_response', retryable: true });
  return result.id;
}

export function createNotifications({ db, config, now = Date.now, send = sendResend }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const enabled = () => Boolean(config.emailEnabled && config.resendKey && config.emailFrom && validEmail(config.adminEmail));
  function enqueue(jobId, kind, recipient, title, paragraphs, version = 0) {
    if (!validEmail(recipient)) return;
    recipient = recipient.toLowerCase();
    const id = 'bms-' + createHash('sha256').update(JSON.stringify([jobId, kind, recipient, version])).digest('hex');
    const live = config.paymentMode === 'live';
    const heading = (live ? '' : '[Sandbox] ') + title;
    const footer = live ? 'Personal coordination. Exceptional service.' : 'Sandbox test — no real payment or appointment.';
    const payload = {
      from: config.emailFrom || 'Bonita Multi-Services <notifications@updates.bonitamultiservices.com>',
      to: [recipient], reply_to: config.adminEmail || 'Admin@bonitamultiservices.com', subject: heading,
      text: [heading, ...paragraphs, 'Bonita Multi-Services', footer].join('\n\n'),
      html: `<div style="background:#f8f5ef;padding:32px;font-family:Arial,sans-serif;color:#12324a"><div style="max-width:600px;margin:auto;background:#fff;padding:32px;border-radius:12px"><p style="letter-spacing:3px;color:#8a6a2c">BONITA MULTI-SERVICES</p><h1 style="font-family:Georgia,serif">${escape(title)}</h1>${paragraphs.map(p => `<p style="line-height:1.7;white-space:pre-line">${escape(p)}</p>`).join('')}<p style="font-size:12px;color:#64748b">${escape(footer)}</p></div></div>`
    };
    run('INSERT OR IGNORE INTO notifications(id,job_id,kind,version,recipient,payload,next_attempt,created) VALUES(?,?,?,?,?,?,?,?)', id, jobId, kind, version, recipient, JSON.stringify(payload), now(), now());
  }
  function payment(jobId) {
    const j = one('SELECT j.*,p.name AS provider,p.email AS provider_email FROM jobs j JOIN providers p ON p.id=j.provider_id WHERE j.id=?', jobId);
    if (!j?.paid || j.refunded || j.dispute_status) return;
    enqueue(j.id, 'payment_customer', j.customer_email, 'Payment received', [
      `Thank you. Your payment of ${money(j.amount)} for ${j.title} has been received.`,
      `Your service provider: ${j.provider}.`, 'We’re arranging the final details and will be in touch with your appointment confirmation.'
    ]);
    enqueue(j.id, 'payment_provider', j.provider_email, 'Your service request is paid', [
      `${j.title}\nCustomer payment: ${money(j.amount)}\nBMS coordination fee: ${money(j.fee)}\nYour share before Stripe processing: ${money(j.amount - j.fee)}`,
      'BMS will coordinate the appointment details with you.'
    ]);
    enqueue(j.id, 'payment_admin', config.adminEmail, 'Payment received — appointment to arrange', [
      `${j.title}\nProvider: ${j.provider}\nTotal: ${money(j.amount)}\nBMS fee: ${money(j.fee)}\nCustomer: ${j.customer_email || 'Email unavailable — review Stripe Checkout'}`,
      `Arrange the appointment, then confirm it in BMS administration: ${config.baseUrl}/admin`
    ]);
  }
  function appointment(jobId) {
    const j = one('SELECT j.*,p.name AS provider,p.email AS provider_email FROM jobs j JOIN providers p ON p.id=j.provider_id WHERE j.id=?', jobId);
    const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/New_York' }).format(new Date(j.appointment_at));
    const paragraphs = [`${j.title}\nProvider: ${j.provider}\nWhen: ${date} (Eastern Time)\nWhere: ${j.appointment_location}`, j.appointment_notes || 'We look forward to assisting you.', 'For changes or questions, reply to this email and the BMS team will assist.'];
    for (const [audience, recipient] of [['customer', j.customer_email], ['provider', j.provider_email], ['admin', config.adminEmail]]) {
      enqueue(j.id, 'appointment_' + audience, recipient, j.appointment_version === 1 ? 'Your appointment is confirmed' : 'Your appointment has been updated', paragraphs, j.appointment_version);
    }
  }
  let busy = false;
  async function flush() {
    if (busy || !enabled()) return;
    busy = true;
    try {
      run("UPDATE notifications SET status='pending' WHERE status='sending' AND claimed<?", now() - 60000);
      const row = one("SELECT * FROM notifications WHERE status='pending' AND next_attempt<=? ORDER BY created,id LIMIT 1", now());
      if (!row) return;
      // A delayed room notice must still describe the reservation's current state.
      const roomNotice = /^room_([0-9a-f-]{36})_(.+)$/.exec(row.kind);
      if (roomNotice) {
        const room = one('SELECT status,date FROM room_bookings WHERE id=?', roomNotice[1]);
        const kind = roomNotice[2];
        const valid = room && (kind.startsWith('confirmed_') ? room.status === 'confirmed' : kind === 'payment_link' ? room.status === 'held' : ['requested','held'].includes(room.status));
        const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
        if (!valid || room.date < today) {
          run("UPDATE notifications SET status='cancelled',error_code='superseded' WHERE id=?", row.id); return;
        }
      }
      const j = row.job_id ? one('SELECT * FROM jobs WHERE id=?', row.job_id) : null;
      if (j && (j.refunded >= j.amount || (row.kind.startsWith('appointment_') && (j.refunded || j.dispute_status || j.appointment_version !== row.version)))) {
        run("UPDATE notifications SET status='cancelled',error_code='superseded' WHERE id=?", row.id); return;
      }
      const allowed = (config.emailAllowlist || []).map(e => e.toLowerCase());
      if (config.paymentMode !== 'live' && !allowed.includes(row.recipient)) { run("UPDATE notifications SET status='blocked',error_code='sandbox_recipient' WHERE id=?", row.id); return; }
      // Resend retains idempotency keys for 24 hours. Stop ambiguous retries before that window ends.
      if (row.first_attempt && now() - row.first_attempt >= 23 * 3600000) {
        run("UPDATE notifications SET status='review',error_code='retry_window' WHERE id=?", row.id); return;
      }
      run("UPDATE notifications SET status='sending',claimed=?,first_attempt=COALESCE(first_attempt,?),attempts=attempts+1 WHERE id=?", now(), now(), row.id);
      try {
        const id = await send(JSON.parse(row.payload), row.id, config.resendKey);
        run("UPDATE notifications SET status='accepted',accepted=?,provider_message_id=?,error_code=NULL WHERE id=?", now(), id, row.id);
      } catch (error) {
        const retry = error.retryable === true;
        run('UPDATE notifications SET status=?,error_code=?,next_attempt=? WHERE id=?', retry ? 'pending' : 'review', error.code || 'send_error', now() + Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7)), row.id);
      }
    } finally { busy = false; }
  }
  return { payment, appointment, flush, enabled, room: (id,kind,recipient,title,lines) => enqueue(null, 'room_'+id+'_'+kind, recipient, title, lines), test: () => enqueue(null, 'connection_test', config.adminEmail, 'Your BMS email connection is ready', ['Payment and appointment notifications can now be sent from your BMS service.']),
    overview: () => ({ enabled: enabled(), from: config.emailFrom || '', adminEmail: config.adminEmail || '',
      counts: db.prepare('SELECT status,COUNT(*) AS count FROM notifications GROUP BY status').all(),
      recent: db.prepare('SELECT id,kind,recipient,status,error_code,created FROM notifications ORDER BY created DESC LIMIT 20').all() }) };
}
