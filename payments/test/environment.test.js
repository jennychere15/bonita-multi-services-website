import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { bindEnvironment, validateDeployment, PLATFORMS } from '../src/environment.js';

const config = { baseUrl: 'https://payments.example.com', stripeKey: 'rk_test_fixture' };
test('live and sandbox reject crossed credentials and live checkout is a separate opt-in', () => {
  assert.equal(validateDeployment(config).platform, PLATFORMS.sandbox);
  assert.throws(() => validateDeployment({ ...config, stripeKey: 'rk_live_fixture' }));
  assert.throws(() => validateDeployment({ ...config, paymentMode: 'live' }));
  const live = { ...config, paymentMode: 'live', stripeKey: 'rk_live_fixture' };
  assert.equal(validateDeployment(live).live, true);
  assert.throws(() => validateDeployment(live, 'sk_test_fixture'));
  assert.throws(() => validateDeployment({ ...live, baseUrl: 'http://localhost:4242' }));
  assert.throws(() => validateDeployment({ ...live, livePaymentsEnabled: true }));
  assert.throws(() => validateDeployment({ ...config, paymentMode: 'typo' }));
  assert.equal(validateDeployment({ ...live, livePaymentsEnabled: true, webhookSecret: 'whsec_fixture', emailEnabled: true, resendKey: 'fixture', emailFrom: 'BMS <notify@example.com>', adminEmail: 'admin@example.com' }).live, true);
});
test('database permanently binds its mode and platform across restarts', t => {
  const db = openStore(); t.after(() => db.close());
  bindEnvironment(db, config); bindEnvironment(db, config);
  assert.throws(() => bindEnvironment(db, { paymentMode: 'live' }));
  assert.equal(db.prepare('SELECT mode FROM deployment_binding').get().mode, 'sandbox');
});
test('an unlabelled sandbox database with historical records cannot become live', t => {
  const db = openStore(); t.after(() => db.close());
  db.prepare("INSERT INTO providers(id,name,email,invite_hash,expires,created) VALUES('test','Test','test@example.com','hash',1,1)").run();
  assert.throws(() => bindEnvironment(db, { paymentMode: 'live' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deployment_binding').get().n, 0);
  bindEnvironment(db, config);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM providers').get().n, 1);
});


test('dedicated network account correction is allowed only before production has any provider or payment records', t => {
  const db = openStore(); t.after(() => db.close());
  db.exec("CREATE TABLE deployment_binding (singleton INTEGER PRIMARY KEY, mode TEXT, platform TEXT); INSERT INTO deployment_binding VALUES(1,'live','acct_1UQ8tWQhdCDcrQgc'); INSERT INTO admin_sessions VALUES('old',999999)");
  bindEnvironment(db, { paymentMode: 'live' });
  assert.equal(db.prepare('SELECT platform FROM deployment_binding').get().platform, PLATFORMS.live);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get().n, 0);
  db.prepare("INSERT INTO providers(id,name,email,invite_hash,expires,created) VALUES('real','Provider','real@example.com','hash',1,1)").run();
  db.prepare("UPDATE deployment_binding SET platform='acct_1UQ8tWQhdCDcrQgc'").run();
  assert.throws(() => bindEnvironment(db, { paymentMode: 'live' }));
});
