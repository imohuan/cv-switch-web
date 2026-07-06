import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Provider } from '../db.js';
import { bestFormatForApp, claudeModels, publicBaseUrl } from './providerConfig.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Write Claude Code configuration from a Provider.
 * 
 * Claude Code uses ~/.claude/settings.json with env variables:
 * - ANTHROPIC_BASE_URL
 * - ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)
 * - ANTHROPIC_MODEL
 * - ANTHROPIC_SMALL_FAST_MODEL (optional)
 */
export function writeClaudeConfig(provider: Provider): { success: boolean; message: string } {
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Read existing settings
    let settings: Record<string, any> = {};
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
      } catch { /* ignore parse errors */ }
    }

    // Ensure env section
    if (!settings.env) {
      settings.env = {};
    }

    const format = bestFormatForApp(provider, 'claude');
    const models = claudeModels(provider);
    const baseUrl = format === 'openai_chat'
      ? claudeChatAdapterBaseUrl(provider)
      : provider.base_url;
    const token = format === 'openai_chat' ? 'PROXY_MANAGED' : provider.api_key;

    // Write provider config into env
    settings.env.ANTHROPIC_BASE_URL = baseUrl;
    settings.env.ANTHROPIC_API_KEY = token;
    // 删除旧的 AUTH_TOKEN 避免冲突（我们的场景是 API Key 模式，非 OAuth）
    delete settings.env.ANTHROPIC_AUTH_TOKEN;
    
    if (models.defaultModel) settings.env.ANTHROPIC_MODEL = models.defaultModel;
    if (models.smallFastModel) settings.env.ANTHROPIC_SMALL_FAST_MODEL = models.smallFastModel;
    if (models.haikuModel) settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models.haikuModel;
    if (models.sonnetModel) settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = models.sonnetModel;
    if (models.opusModel) settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = models.opusModel;
    
    // Write atomically
    const tmpPath = CLAUDE_SETTINGS_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmpPath, CLAUDE_SETTINGS_PATH);

    return {
      success: true,
      message: `Claude Code config written: model=${provider.model}, base_url=${provider.base_url}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write Claude Code config: ${err.message}` };
  }
}

function claudeChatAdapterBaseUrl(provider: Provider): string {
  return `${publicBaseUrl()}/proxy/claude/${provider.id}`;
}

/** Check current Claude Code config status */
export function getClaudeConfigStatus(): { configured: boolean; model?: string; base_url?: string } {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return { configured: false };
  }
  
  try {
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    const env = settings.env || {};
    return {
      configured: true,
      model: env.ANTHROPIC_MODEL,
      base_url: env.ANTHROPIC_BASE_URL,
    };
  } catch {
    return { configured: false };
  }
}
