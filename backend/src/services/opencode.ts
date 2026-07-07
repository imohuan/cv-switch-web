import fs from 'fs';
import path from 'path';
import type { Provider } from '../db.js';
import { GLOBAL_HOME_DIR } from '../config.js';

const OPENCODE_CONFIG_PATH = path.join(GLOBAL_HOME_DIR, '.config', 'opencode', 'opencode.json');

/**
 * Write OpenCode configuration from a Provider.
 * 
 * OpenCode uses ~/.config/opencode/opencode.json with:
 * - provider.<id>.name
 * - provider.<id>.base_url
 * - provider.<id>.api_key
 * - provider.<id>.model
 */
export function writeOpenCodeConfig(provider: Provider): { success: boolean; message: string } {
  try {
    const opencodeDir = path.join(GLOBAL_HOME_DIR, '.config', 'opencode');
    if (!fs.existsSync(opencodeDir)) {
      fs.mkdirSync(opencodeDir, { recursive: true });
    }

    // Read existing config (JSON5-compatible, but we'll parse as JSON)
    let config: Record<string, any> = {};
    if (fs.existsSync(OPENCODE_CONFIG_PATH)) {
      try {
        const content = fs.readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
        // OpenCode config uses JSON5, but for basic JSON it parses fine
        config = JSON.parse(content);
      } catch {
        // Try to handle JSON5 by stripping comments and trailing commas
        try {
          const content = fs.readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
          const cleaned = content
            .replace(/\/\/.*$/gm, '')     // single-line comments
            .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
            .replace(/,\s*}/g, '}')       // trailing commas in objects
            .replace(/,\s*\]/g, ']');      // trailing commas in arrays
          config = JSON.parse(cleaned);
        } catch {
          /* start fresh */
        }
      }
    }

    // Ensure provider section
    if (!config.provider) {
      config.provider = {};
    }

    // Write provider config
    config.provider[provider.id] = {
      name: provider.name,
      base_url: provider.base_url,
      api_key: provider.api_key,
      model: provider.model,
      ...(provider.api_format === 'openai_chat' ? { type: 'openai_compatible' } : {}),
    };

    // Write atomically
    const tmpPath = OPENCODE_CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, OPENCODE_CONFIG_PATH);

    return {
      success: true,
      message: `OpenCode config written: model=${provider.model}, base_url=${provider.base_url}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write OpenCode config: ${err.message}` };
  }
}

/** Check current OpenCode config status */
export function getOpenCodeConfigStatus(): { configured: boolean; model?: string; base_url?: string } {
  if (!fs.existsSync(OPENCODE_CONFIG_PATH)) {
    return { configured: false };
  }
  
  try {
    const content = fs.readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*\]/g, ']');
    const config = JSON.parse(cleaned);
    const providers = config.provider || {};
    const keys = Object.keys(providers);
    
    if (keys.length > 0) {
      const p = providers[keys[0]];
      return {
        configured: true,
        model: p.model,
        base_url: p.base_url,
      };
    }
    return { configured: false };
  } catch {
    return { configured: false };
  }
}
