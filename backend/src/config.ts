import os from 'os';
import path from 'path';

function userAccountHomeDir() {
  try {
    return os.userInfo().homedir;
  } catch {
    return os.homedir();
  }
}

function expandHomeDir(value: string, homeDir = os.homedir()) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDir, value.slice(2));
  return value;
}

export function resolveGlobalHomeDir(env: NodeJS.ProcessEnv = process.env, accountHomeDir = userAccountHomeDir()) {
  const override = env.CV_SWITCH_GLOBAL_HOME_DIR;
  if (override) return path.resolve(expandHomeDir(override, accountHomeDir));

  return path.resolve(accountHomeDir);
}

export const GLOBAL_HOME_DIR = resolveGlobalHomeDir();
export const ROOT_DIR = path.resolve(expandHomeDir(process.env.CV_SWITCH_ROOT_DIR || path.join(os.homedir(), '.cv-switch-web')));
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const LOG_DIR = path.join(ROOT_DIR, 'logs');
export const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');

export const PORT = parseInt(process.env.PORT || '3120', 10);
export const PUBLIC_BASE_URL = (
  process.env.CC_SWITCH_PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`
).replace(/\/+$/, '');