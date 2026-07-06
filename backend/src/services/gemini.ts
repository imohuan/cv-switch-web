import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Provider } from '../db.js';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const GEMINI_ENV_PATH = path.join(GEMINI_DIR, '.env');
const GEMINI_SETTINGS_PATH = path.join(GEMINI_DIR, 'settings.json');

/**
 * Write Gemini CLI configuration from a Provider.
 * 
 * Gemini CLI uses:
 * - ~/.gemini/.env: environment variables (GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL)
 * - ~/.gemini/settings.json: additional settings
 */
export function writeGeminiConfig(provider: Provider): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(GEMINI_DIR)) {
      fs.mkdirSync(GEMINI_DIR, { recursive: true });
    }

    // Write .env file
    const envLines: string[] = [];
    
    // Read existing .env to preserve other vars
    if (fs.existsSync(GEMINI_ENV_PATH)) {
      const existing = fs.readFileSync(GEMINI_ENV_PATH, 'utf-8');
      const existingLines = existing.split('\n');
      for (const line of existingLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          envLines.push(line);
        } else if (
          !trimmed.startsWith('GEMINI_API_KEY=') &&
          !trimmed.startsWith('GOOGLE_GEMINI_BASE_URL=') &&
          !trimmed.startsWith('GOOGLE_API_KEY=')
        ) {
          envLines.push(line);
        }
      }
    }

    // Add our config
    envLines.push(`GEMINI_API_KEY=${provider.api_key}`);
    envLines.push(`GOOGLE_GEMINI_BASE_URL=${provider.base_url}`);

    // Write atomically
    const tmpPath = GEMINI_ENV_PATH + '.tmp';
    fs.writeFileSync(tmpPath, envLines.join('\n') + '\n', 'utf-8');
    fs.renameSync(tmpPath, GEMINI_ENV_PATH);

    // Write settings.json
    let settings: Record<string, any> = {};
    if (fs.existsSync(GEMINI_SETTINGS_PATH)) {
      try {
        settings = JSON.parse(fs.readFileSync(GEMINI_SETTINGS_PATH, 'utf-8'));
      } catch { /* ignore */ }
    }
    
    if (provider.model) {
      settings.model = provider.model;
    }

    const settingsTmp = GEMINI_SETTINGS_PATH + '.tmp';
    fs.writeFileSync(settingsTmp, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(settingsTmp, GEMINI_SETTINGS_PATH);

    return {
      success: true,
      message: `Gemini CLI config written: model=${provider.model}, base_url=${provider.base_url}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write Gemini CLI config: ${err.message}` };
  }
}

/** Check current Gemini CLI config status */
export function getGeminiConfigStatus(): { configured: boolean; model?: string; base_url?: string } {
  if (!fs.existsSync(GEMINI_ENV_PATH)) {
    return { configured: false };
  }
  
  try {
    const content = fs.readFileSync(GEMINI_ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    let baseUrl = '';
    let model = '';
    
    for (const line of lines) {
      if (line.startsWith('GOOGLE_GEMINI_BASE_URL=')) {
        baseUrl = line.split('=')[1]?.trim() || '';
      }
    }
    
    if (fs.existsSync(GEMINI_SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(GEMINI_SETTINGS_PATH, 'utf-8'));
      model = settings.model || '';
    }
    
    return {
      configured: true,
      model: model || undefined,
      base_url: baseUrl || undefined,
    };
  } catch {
    return { configured: false };
  }
}
