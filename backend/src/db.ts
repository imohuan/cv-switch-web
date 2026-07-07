import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const APP_TYPES = ['codex', 'claude', 'gemini', 'opencode'];
const DB_PATH = path.join(DATA_DIR, 'cc-switch-web.json');

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

interface Store {
  providers: Provider[];
  app_status: AppStatus[];
  profiles: Profile[];
}

function now() {
  return new Date().toISOString();
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function emptyStore(): Store {
  const updated_at = now();
  return {
    providers: [],
    app_status: APP_TYPES.map((app_type) => ({ app_type, current_provider_id: null, updated_at })),
    profiles: [],
  };
}

function normalizeStore(value: unknown): Store {
  const draft = value && typeof value === 'object' ? value as Partial<Store> : {};
  const store: Store = {
    providers: Array.isArray(draft.providers) ? draft.providers : [],
    app_status: Array.isArray(draft.app_status) ? draft.app_status : [],
    profiles: Array.isArray(draft.profiles) ? draft.profiles : [],
  };

  for (const app_type of APP_TYPES) {
    if (!store.app_status.some((item) => item.app_type === app_type)) {
      store.app_status.push({ app_type, current_provider_id: null, updated_at: now() });
    }
  }

  store.providers = store.providers.map((provider) => ({
    ...provider,
    api_key: provider.api_key || '',
    model: provider.model || '',
    api_format: provider.api_format || 'openai_chat',
    extra_config: provider.extra_config || '{}',
    sort_index: Number.isInteger(provider.sort_index) ? provider.sort_index : 0,
  }));
  store.profiles = store.profiles.map((profile) => ({
    ...profile,
    extra_config: profile.extra_config || '{}',
  }));

  return store;
}

function loadStore(): Store {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DB_PATH)) return emptyStore();

  try {
    return normalizeStore(JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')));
  } catch {
    return emptyStore();
  }
}

let store = loadStore();

function saveStore() {
  ensureDir(DATA_DIR);
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

function byProviderOrder(a: Provider, b: Provider) {
  return a.sort_index - b.sort_index || b.created_at.localeCompare(a.created_at);
}

function byCreatedDesc<T extends { created_at: string }>(a: T, b: T) {
  return b.created_at.localeCompare(a.created_at);
}

// Provider CRUD
export function getAllProviders(): Provider[] {
  return [...store.providers].sort(byProviderOrder);
}

export function getProviderById(id: string): Provider | undefined {
  return store.providers.find((provider) => provider.id === id);
}

export function createProvider(provider: Omit<Provider, 'created_at' | 'updated_at'>): Provider {
  if (getProviderById(provider.id)) throw new Error(`Provider already exists: ${provider.id}`);

  const timestamp = now();
  const created: Provider = {
    ...provider,
    api_key: provider.api_key || '',
    model: provider.model || '',
    extra_config: provider.extra_config || '{}',
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.providers.push(created);
  saveStore();
  return created;
}

export function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'created_at'>>): Provider | undefined {
  const existing = getProviderById(id);
  if (!existing) return undefined;

  const updated = { ...existing, ...updates, id: existing.id, created_at: existing.created_at, updated_at: now() };
  store.providers = store.providers.map((provider) => provider.id === id ? updated : provider);
  saveStore();
  return updated;
}

export function deleteProvider(id: string): boolean {
  const existed = Boolean(getProviderById(id));
  if (!existed) return false;

  store.providers = store.providers.filter((provider) => provider.id !== id);
  store.profiles = store.profiles.filter((profile) => profile.provider_id !== id);
  store.app_status = store.app_status.map((status) => (
    status.current_provider_id === id
      ? { ...status, current_provider_id: null, updated_at: now() }
      : status
  ));
  saveStore();
  return true;
}

// App Status
export function getAppStatus(appType: string): AppStatus | undefined {
  return store.app_status.find((status) => status.app_type === appType);
}

export function getAllAppStatus(): AppStatus[] {
  return [...store.app_status];
}

export function setCurrentProvider(appType: string, providerId: string | null): void {
  const status = getAppStatus(appType);
  const updated: AppStatus = { app_type: appType, current_provider_id: providerId, updated_at: now() };
  store.app_status = status
    ? store.app_status.map((item) => item.app_type === appType ? updated : item)
    : [...store.app_status, updated];
  saveStore();
}

// Profile CRUD
export function getAllProfiles(): Profile[] {
  return [...store.profiles].sort(byCreatedDesc);
}

export function getProfileById(id: string): Profile | undefined {
  return store.profiles.find((profile) => profile.id === id);
}

export function getProfilesByProviderId(providerId: string): Profile[] {
  return store.profiles.filter((profile) => profile.provider_id === providerId);
}

export function createProfile(profile: Omit<Profile, 'created_at' | 'updated_at'>): Profile {
  if (getProfileById(profile.id)) throw new Error(`Profile already exists: ${profile.id}`);
  if (store.profiles.some((item) => item.slug === profile.slug)) throw new Error(`Profile slug already exists: ${profile.slug}`);

  const timestamp = now();
  const created: Profile = {
    ...profile,
    extra_config: profile.extra_config || '{}',
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.profiles.push(created);
  saveStore();
  return created;
}

export function deleteProfile(id: string): boolean {
  const existed = Boolean(getProfileById(id));
  if (!existed) return false;

  store.profiles = store.profiles.filter((profile) => profile.id !== id);
  saveStore();
  return true;
}

export default {
  getAllProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  getAppStatus,
  getAllAppStatus,
  setCurrentProvider,
  getAllProfiles,
  getProfileById,
  getProfilesByProviderId,
  createProfile,
  deleteProfile,
};