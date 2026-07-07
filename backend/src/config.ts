import os from 'os';
import path from 'path';

function expandHomeDir(value: string) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export const ROOT_DIR = path.resolve(expandHomeDir(process.env.CV_SWITCH_ROOT_DIR || path.join(os.homedir(), '.cv-switch-web')));
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const LOG_DIR = path.join(ROOT_DIR, 'logs');
export const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');

export const PORT = parseInt(process.env.PORT || '3120', 10);
export const PUBLIC_BASE_URL = (
  process.env.CC_SWITCH_PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`
).replace(/\/+$/, '');