import http from 'node:http';
import Stripe from 'stripe';
import { openStore } from './store.js';
import { createApp } from './app.js';
import { createNotifications } from './notifications.js';
import { validateDeployment } from './environment.js';

const config = {
  roomRequestsEnabled: process.env.ROOM_REQUESTS_ENABLED === 'true', roomPaymentsEnabled: process.env.ROOM_PAYMENTS_ENABLED === 'true',
  roomStripeKey: process.env.ROOM_STRIPE_SECRET_KEY || '', roomWebhookSecret: process.env.ROOM_STRIPE_WEBHOOK_SECRET || '',
  paymentMode: process.env.PAYMENT_MODE || 'sandbox', livePaymentsEnabled: process.env.LIVE_PAYMENTS_ENABLED === 'true',
  baseUrl: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:4242').replace(/\/$/, ''),
  stripeKey: process.env.STRIPE_SECRET_KEY || '', clientId: process.env.STRIPE_CONNECT_CLIENT_ID || '',
  webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '', adminToken: process.env.ADMIN_TOKEN || '',
  emailEnabled: process.env.EMAIL_ENABLED === 'true', resendKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'Bonita Multi-Services <notifications@updates.bonitamultiservices.com>',
  adminEmail: process.env.BMS_ADMIN_EMAIL || 'Admin@bonitamultiservices.com',
  emailAllowlist: (process.env.SANDBOX_EMAIL_ALLOWLIST || 'Admin@bonitamultiservices.com,admin+provider-test@bonitamultiservices.com').split(',').map(s => s.trim()).filter(Boolean)
};
if (config.adminToken.length < 32) throw new Error('Set ADMIN_TOKEN to a randomly generated value of at least 32 characters in the host secret manager.');
const oauthKey = process.env.STRIPE_OAUTH_SECRET_KEY || '';
const environment = validateDeployment(config, oauthKey);
const stripe = config.stripeKey ? new Stripe(config.stripeKey, { maxNetworkRetries: 0, timeout: 15000 }) : null;
if (stripe) {
  const platform = await stripe.accounts.retrieve();
  if (platform.id !== environment.platform) throw new Error('The configured key does not belong to the approved BMS Stripe environment.');
}
// OAuth can use a separate standard sandbox key; payment operations retain the restricted key.

const oauthStripe = oauthKey ? new Stripe(oauthKey, { maxNetworkRetries: 0, timeout: 15000 }) : stripe;
if (oauthKey) {
  const oauthPlatform = await oauthStripe.accounts.retrieve();
  if (oauthPlatform.id !== environment.platform) throw new Error('OAuth key must belong to the approved BMS Stripe environment.');
}
// An intentionally invalid code checks authentication without connecting an account.
if (!environment.live && oauthStripe && config.clientId && process.env.BMS_OAUTH_DIAGNOSTIC === '1') {
  try { await oauthStripe.oauth.token({ grant_type: 'authorization_code', code: 'bms_invalid_diagnostic_code' }); }
  catch (error) {
    console.error('BMS sandbox OAuth credential check', JSON.stringify({
      authenticated: error.type === 'StripeInvalidGrantError', type: error.type, status: error.statusCode
    }));
  }
}
const roomStripe = config.roomStripeKey ? new Stripe(config.roomStripeKey, { maxNetworkRetries: 0, timeout: 15000 }) : null;
if (roomStripe) {
  if ((config.paymentMode === 'live') !== /^(sk|rk)_live_/.test(config.roomStripeKey)) throw new Error('Room payment key must match the service mode.');
  const account = await roomStripe.accounts.retrieve();
  if (config.paymentMode === 'live' && account.id !== 'acct_1UQ8tWQhdCDcrQgc') throw new Error('Room payments must use the BMS direct-service Stripe account.');
}
const db = openStore(process.env.DATABASE_PATH || './data/payments.sqlite');
const notifications = createNotifications({ db, config });
const app = createApp({ db, stripe, roomStripe, oauthStripe, config, notifications });
const emailTimer = setInterval(() => notifications.flush().catch(() => console.error('BMS email queue unavailable')), 1000);
emailTimer.unref();
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 262144) { res.writeHead(413).end('Request too large'); return; }
      chunks.push(chunk);
    }
    const path = req.url || '/';
    // Ignore untrusted Host and forwarded headers when constructing request URLs.
    if (!path.startsWith('/') || path.startsWith('//')) { res.writeHead(400).end(); return; }
    const request = new Request(config.baseUrl + path, {
      method: req.method, headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {})
    });
    const response = await app(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end('Request unavailable'); }
});
server.headersTimeout = 10000;
server.requestTimeout = 20000;
server.listen(Number(process.env.PORT || 4242), '0.0.0.0', () => console.log('BMS payment service is running in ' + environment.mode + ' mode; live checkout ' + (config.livePaymentsEnabled ? 'enabled' : 'paused') + '.'));
process.on('SIGTERM', () => { clearInterval(emailTimer); server.close(() => process.exit(0)); });
