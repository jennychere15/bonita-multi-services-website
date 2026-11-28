// Durable intake delivery. Never retry an ambiguous remote write automatically.
export const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return /^\+[1-9]\d{7,14}$/.test(String(value || '').trim()) ? '+' + digits : '';
};
export function reviewDue(now) {
  for (let time = now + 2 * 3600000; time < now + 8 * 86400000; time += 15 * 60000) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(time).map(p => [p.type, p.value]));
    if (!['Sat', 'Sun'].includes(parts.weekday) && +parts.hour >= 10 && +parts.hour < 16) return new Date(time).toISOString();
  }
  throw Error('No review window');
}
export function createIntakeSync({ db, config = {}, now = Date.now, fetcher = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS intake_outbox (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    phase TEXT NOT NULL DEFAULT 'lookup', lead_id TEXT, task_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL, error_code TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS intake_identities (email TEXT PRIMARY KEY, lead_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS service_inquiries (id TEXT PRIMARY KEY, service TEXT NOT NULL,
    name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,company TEXT NOT NULL,
    location TEXT NOT NULL,details TEXT NOT NULL,consent INTEGER NOT NULL,created INTEGER NOT NULL);`);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  // A process crash may have happened after Close accepted a write but before its ID was saved.
  run("UPDATE intake_outbox SET status='review',error_code='interrupted_write' WHERE status='sending'");
  const enabled = () => Boolean(config.closeIntakeEnabled && config.closeApiKey && config.closeOwnerId && config.closeLeadStatusId);
  function enqueue(id, input) {
    const payload = { ...input, email: String(input.email).trim().toLowerCase(), originalPhone: input.phone, phone: normalizePhone(input.phone), due: reviewDue(now()) };
    // QA and internal mailboxes never enter the sales CRM or its automation rules.
    const internal = [config.adminEmail, ...(config.closeInternalEmails || [])].filter(Boolean).map(x => x.toLowerCase());
    const qa = /\b(?:QA|TEST)\b|DO NOT CONTACT|NO OUTREACH/i.test(input.name + '\n' + input.details) || internal.includes(payload.email);
    run('INSERT OR IGNORE INTO intake_outbox(id,payload,status,next_attempt,created) VALUES(?,?,?,?,?)', id, JSON.stringify(payload), qa ? 'excluded' : 'pending', now(), now());
  }
  async function api(path, data, write = false) {
    let response;
    try {
      response = await fetcher('https://api.close.com/api/v1/' + path, {
        method: data ? 'POST' : 'GET', headers: { Authorization: 'Basic ' + Buffer.from(config.closeApiKey + ':').toString('base64'), 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000)
      });
    } catch { throw Object.assign(Error('Close unavailable'), { code: write ? 'uncertain_write' : 'lookup_unavailable', retry: !write }); }
    if (!response.ok) throw Object.assign(Error('Close rejected request'), { code: write && response.status >= 500 ? 'uncertain_write' : 'http_' + response.status, retry: response.status === 429 || (!write && response.status >= 500) });
    try { return await response.json(); } catch { throw Object.assign(Error('Close response unavailable'), { code: write ? 'uncertain_write' : 'invalid_response', retry: !write }); }
  }
  async function lookup(p) {
    const matches = new Map();
    // Read the complete bounded contact set, and compare exact normalized identities locally.
    // A truncated/failed scan must never be interpreted as "no duplicate".
    for (let skip = 0; skip < 10000; skip += 200) {
      const page = await api('contact/?_limit=200&_skip=' + skip + '&_fields=id,lead_id,emails,phones');
      if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean') throw Object.assign(Error('Invalid lookup'), { code: 'invalid_lookup' });
      for (const c of page.data) {
        const email = (c.emails || []).some(e => e.email?.toLowerCase() === p.email);
        const phone = p.phone && (c.phones || []).some(t => normalizePhone(t.phone) === p.phone);
        if (email || phone) matches.set(c.id, { ...c, emailMatch: email });
      }
      if (!page.has_more) {
        if (matches.size > 1 || (matches.size === 1 && ![...matches.values()][0].emailMatch)) throw Object.assign(Error('Review identity'), { code: 'ambiguous_identity' });
        return [...matches.values()][0]?.lead_id || null;
      }
    }
    throw Object.assign(Error('Lookup exceeds limit'), { code: 'lookup_limit' });
  }
  let busy = false;
  async function flush() {
    if (busy || !enabled()) return;
    busy = true;
    let row;
    try {
      row = one("SELECT * FROM intake_outbox WHERE status='pending' AND next_attempt<=? ORDER BY created,id LIMIT 1", now());
      if (!row) return;
      if (run("UPDATE intake_outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'", row.id).changes !== 1) return;
      const p = JSON.parse(row.payload);
      let leadId = row.lead_id;
      if (!leadId) {
        leadId = await lookup(p);
        const cached = one('SELECT lead_id FROM intake_identities WHERE email=?', p.email)?.lead_id;
        if (cached && leadId && cached !== leadId) throw Object.assign(Error('Review identity'), { code: 'ambiguous_identity' });
        leadId ||= cached;
        if (!leadId) {
          run("UPDATE intake_outbox SET phase='create_lead' WHERE id=?", row.id);
          const lead = await api('lead/', { name: p.company || p.name, status_id: config.closeLeadStatusId,
            description: 'BMS website inquiry. Source: ' + p.source + '\nRequest reference: ' + row.id + '\nNo marketing enrollment authorized.',
            contacts: [{ name: p.name, emails: [{ email: p.email, type: 'office' }], phones: p.phone ? [{ phone: p.phone, type: 'office' }] : [] }] }, true);
          if (!/^lead_/.test(lead.id || '')) throw Object.assign(Error('Missing lead receipt'), { code: 'uncertain_write' });
          leadId = lead.id;
        }
        run("UPDATE intake_outbox SET lead_id=?,phase='create_task' WHERE id=?", leadId, row.id);
        run('INSERT OR REPLACE INTO intake_identities(email,lead_id) VALUES(?,?)', p.email, leadId);
      }
      if (!row.task_id) {
        const task = await api('task/', { _type: 'lead', lead_id: leadId, assigned_to: config.closeOwnerId, date: p.due, is_complete: false, disable_notification: true,
          text: ['BMS INBOUND REVIEW — ' + p.service, 'Request reference: ' + row.id, 'Source: ' + p.source, 'Contact: ' + p.name + ' · ' + p.email + ' · ' + p.originalPhone,
            'Permission: respond about this inquiry only; no marketing enrollment.', 'Location: ' + p.location, p.details, 'Next: review scope and availability; match any appointment using the reference; confirm terms before payment.'].join('\n') }, true);
        if (!/^task_/.test(task.id || '')) throw Object.assign(Error('Missing task receipt'), { code: 'uncertain_write' });
        run('UPDATE intake_outbox SET task_id=? WHERE id=?', task.id, row.id);
      }
      run("UPDATE intake_outbox SET status='synced',phase='complete',error_code=NULL WHERE id=?", row.id);
    } catch (error) {
      if (row) run('UPDATE intake_outbox SET status=?,error_code=?,next_attempt=? WHERE id=?', error.retry ? 'pending' : 'review', error.code || 'sync_error', now() + Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7)), row.id);
    } finally { busy = false; }
  }
  async function reconcile(id, leadId, taskId) {
    const row = one("SELECT * FROM intake_outbox WHERE id=? AND status='review'", id);
    if (!row || !/^lead_[A-Za-z0-9]+$/.test(leadId || '') || !/^task_[A-Za-z0-9]+$/.test(taskId || '') || !enabled()) return false;
    const p = JSON.parse(row.payload);
    const lead = await api('lead/' + leadId + '/');
    const task = await api('task/' + taskId + '/');
    if (!lead.contacts?.some(c => c.emails?.some(e => e.email?.toLowerCase() === p.email)) || task.lead_id !== leadId || !task.text?.split('\n').includes('Request reference: ' + id) || task.assigned_to !== config.closeOwnerId) return false;
    run("UPDATE intake_outbox SET lead_id=?,task_id=?,status='synced',phase='complete',error_code=NULL WHERE id=? AND status='review'", leadId, taskId, id);
    return true;
  }
  return { enqueue, flush, reconcile, overview: () => ({ enabled: enabled(), counts: db.prepare('SELECT status,COUNT(*) AS count FROM intake_outbox GROUP BY status').all(),
    recent: db.prepare('SELECT id,status,phase,lead_id,task_id,error_code,created FROM intake_outbox ORDER BY created DESC,id LIMIT 100').all(),
    inquiries: db.prepare('SELECT * FROM service_inquiries ORDER BY created DESC LIMIT 100').all() }) };
}
