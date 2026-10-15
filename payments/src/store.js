import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      invite_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL,
      account_id TEXT UNIQUE, account_kind TEXT, connected INTEGER NOT NULL DEFAULT 0,
      ready INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (
      hash TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id),
      browser_hash TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id),
      title TEXT NOT NULL, amount INTEGER NOT NULL, fee INTEGER NOT NULL, tier TEXT NOT NULL,
      approval_hash TEXT UNIQUE NOT NULL, payment_hash TEXT UNIQUE NOT NULL,
      expires INTEGER NOT NULL, approved INTEGER, status TEXT NOT NULL DEFAULT 'awaiting_provider',
      checkout_id TEXT UNIQUE, checkout_url TEXT, checkout_params TEXT, payment_intent TEXT UNIQUE,
      paid INTEGER, refunded INTEGER NOT NULL DEFAULT 0, dispute_status TEXT,
      created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, record_id TEXT NOT NULL, created INTEGER NOT NULL);`);
  return db;
}
