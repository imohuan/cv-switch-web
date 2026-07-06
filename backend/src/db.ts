import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_DIR = path.join(os.homedir(), '.cc-switch-web');
const DB_PATH = path.join(DB_DIR, 'cc-switch-web.db');

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    api_format TEXT NOT NULL DEFAULT 'openai_chat',
    extra_config TEXT NOT NULL DEFAULT '{}',
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_status (
    app_type TEXT PRIMARY KEY,
    current_provider_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (current_provider_id) REFERENCES providers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    app_type TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
  );

  -- Insert default app types
  INSERT OR IGNORE INTO app_status (app_type) VALUES ('codex');
  INSERT OR IGNORE INTO app_status (app_type) VALUES ('claude');
  INSERT OR IGNORE INTO app_status (app_type) VALUES ('gemini');
  INSERT OR IGNORE INTO app_status (app_type) VALUES ('opencode');
`);

ensureColumn('providers', 'extra_config', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('profiles', 'extra_config', "TEXT NOT NULL DEFAULT '{}'");

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  api_format: 'openai_chat' | 'openai_responses' | 'anthropic';
  extra_config: string;
  sort_index: number;
  created_at: string;
  updated_at: string;
}

export interface AppStatus {
  app_type: string;
  current_provider_id: string | null;
  updated_at: string;
}

export interface Profile {
  id: string;
  name: string;
  app_type: string;
  provider_id: string;
  slug: string;
  extra_config: string;
  created_at: string;
  updated_at: string;
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Provider CRUD
export function getAllProviders(): Provider[] {
  return db.prepare('SELECT * FROM providers ORDER BY sort_index ASC, created_at DESC').all() as Provider[];
}

export function getProviderById(id: string): Provider | undefined {
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Provider | undefined;
}

export function createProvider(provider: Omit<Provider, 'created_at' | 'updated_at'>): Provider {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO providers (id, name, base_url, api_key, model, api_format, extra_config, sort_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    provider.id, provider.name, provider.base_url, provider.api_key,
    provider.model, provider.api_format, provider.extra_config,
    provider.sort_index, now, now
  );
  return getProviderById(provider.id)!;
}

export function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'created_at'>>): Provider | undefined {
  const existing = getProviderById(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...updates, id: existing.id, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE providers SET name=?, base_url=?, api_key=?, model=?, api_format=?, extra_config=?, sort_index=?, updated_at=?
    WHERE id=?
  `).run(
    merged.name, merged.base_url, merged.api_key, merged.model,
    merged.api_format, merged.extra_config, merged.sort_index,
    merged.updated_at, merged.id
  );
  return getProviderById(id);
}

export function deleteProvider(id: string): boolean {
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  // Also clear any app_status referencing this provider
  db.prepare('UPDATE app_status SET current_provider_id = NULL WHERE current_provider_id = ?').run(id);
  return result.changes > 0;
}

// App Status
export function getAppStatus(appType: string): AppStatus | undefined {
  return db.prepare('SELECT * FROM app_status WHERE app_type = ?').get(appType) as AppStatus | undefined;
}

export function getAllAppStatus(): AppStatus[] {
  return db.prepare('SELECT * FROM app_status').all() as AppStatus[];
}

export function setCurrentProvider(appType: string, providerId: string | null): void {
  db.prepare(`
    UPDATE app_status SET current_provider_id = ?, updated_at = ?
    WHERE app_type = ?
  `).run(providerId, new Date().toISOString(), appType);
}

// Profile CRUD
export function getAllProfiles(): Profile[] {
  return db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all() as Profile[];
}

export function getProfileById(id: string): Profile | undefined {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Profile | undefined;
}

export function getProfilesByProviderId(providerId: string): Profile[] {
  return db.prepare('SELECT * FROM profiles WHERE provider_id = ?').all(providerId) as Profile[];
}

export function createProfile(profile: Omit<Profile, 'created_at' | 'updated_at'>): Profile {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO profiles (id, name, app_type, provider_id, slug, extra_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(profile.id, profile.name, profile.app_type, profile.provider_id, profile.slug, profile.extra_config || '{}', now, now);
  return getProfileById(profile.id)!;
}

export function deleteProfile(id: string): boolean {
  const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return result.changes > 0;
}

export default db;
