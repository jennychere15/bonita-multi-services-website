// Explicit deployment mode and immutable database binding prevent test/live crossover.
export const PLATFORMS = Object.freeze({ sandbox: 'acct_1UQIaJ5uSGpjnhUc', live: 'acct_1UQ8tWQhdCDcrQgc' });
export function deployment(config) {
  const mode = config.paymentMode || 'sandbox';
  if (!Object.hasOwn(PLATFORMS, mode)) throw new Error('PAYMENT_MODE must be sandbox or live.');
  return { mode, live: mode === 'live', platform: PLATFORMS[mode] };
}
export function validateDeployment(config, oauthKey = '') {
  const env = deployment(config), prefix = env.live ? 'live' : 'test';
  for (const [key, standard] of [[config.stripeKey, false], [oauthKey, true]]) {
    if (key && !new RegExp('^' + (standard ? 'sk' : '(sk|rk)') + '_' + prefix + '_').test(key)) throw new Error('Stripe credential mode does not match PAYMENT_MODE.');
  }
  const origin = new URL(config.baseUrl);
  if (origin.origin !== config.baseUrl || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('BASE_URL must be an HTTPS origin, or localhost for development.');
  if (env.live && origin.protocol !== 'https:') throw new Error('Live mode requires HTTPS.');
  if (config.livePaymentsEnabled && (!env.live || !config.stripeKey || !config.webhookSecret || !config.emailEnabled || !config.resendKey || !config.emailFrom || !config.adminEmail)) throw new Error('Live checkout requires live credentials, a webhook and an enabled email sender.');
  return env;
}
export function bindEnvironment(db, config) {
  const env = deployment(config);
  db.exec('CREATE TABLE IF NOT EXISTS deployment_binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL, platform TEXT NOT NULL)');
  const current = db.prepare('SELECT * FROM deployment_binding WHERE singleton=1').get();
  if (current) {
    if (current.mode !== env.mode || current.platform !== env.platform) throw new Error('Database belongs to a different Stripe environment. Use a separate production database.');
  } else {
    // Existing unlabelled databases were created by the sandbox-only build.
    const records = db.prepare('SELECT (SELECT COUNT(*) FROM providers)+(SELECT COUNT(*) FROM jobs)+(SELECT COUNT(*) FROM notifications) AS n').get().n;
    if (env.live && records) throw new Error('A live service must start with a fresh database; sandbox records cannot be imported.');
    db.prepare('INSERT INTO deployment_binding VALUES(1,?,?)').run(env.mode, env.platform);
  }
  return env;
}
