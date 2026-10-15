import http from 'node:http';
import Stripe from 'stripe';
import { openStore } from './store.js';
import { createApp } from './app.js';

const config = {
  baseUrl: (process.env.BASE_URL || 'http://localhost:4242').replace(/\/$/, ''),
  stripeKey: process.env.STRIPE_SECRET_KEY || '', clientId: process.env.STRIPE_CONNECT_CLIENT_ID || '',
  webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '', adminToken: process.env.ADMIN_TOKEN || ''
};
if (config.adminToken.length < 32) throw new Error('Set ADMIN_TOKEN to a randomly generated value of at least 32 characters in the host secret manager.');
const origin = new URL(config.baseUrl);
if (origin.origin !== config.baseUrl || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('BASE_URL must be an HTTPS origin, or localhost for development.');
if (config.stripeKey && !/^(sk|rk)_test_/.test(config.stripeKey)) throw new Error('This build accepts sandbox/test Stripe keys only. Live payments are disabled.');
const stripe = config.stripeKey ? new Stripe(config.stripeKey, { maxNetworkRetries: 0, timeout: 15000 }) : null;
if (stripe) {
  const platform = await stripe.accounts.retrieve();
  if (platform.id !== 'acct_1UQIaJ5uSGpjnhUc') throw new Error('The configured key does not belong to the approved BMS Provider Network sandbox.');
}
const db = openStore(process.env.DATABASE_PATH || './data/payments.sqlite');
const app = createApp({ db, stripe, config });
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
server.listen(Number(process.env.PORT || 4242), '0.0.0.0', () => console.log('BMS sandbox payment service is running.'));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
