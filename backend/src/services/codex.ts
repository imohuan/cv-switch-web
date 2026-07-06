import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { Provider } from '../db.js';
import { bestFormatForApp, codexModels, publicBaseUrl } from './providerConfig.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const CODEX_CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const CODEX_MODEL_PROVIDER_ID = 'custom';

/**
 * Write Codex CLI configuration from a Provider.
 * 
 * Codex uses two files:
 * - ~/.codex/auth.json: contains API key as env var
 * - ~/.codex/config.toml: contains model + model_provider config
 */
export function writeCodexConfig(provider: Provider): { success: boolean; message: string } {
  try {
    // Ensure directory exists
    if (!fs.existsSync(CODEX_DIR)) {
      fs.mkdirSync(CODEX_DIR, { recursive: true });
    }

    const format = bestFormatForApp(provider, 'codex');
    const envKey = 'OPENAI_API_KEY';
    const baseUrl = format === 'openai_chat'
      ? codexChatAdapterBaseUrl(provider)
      : provider.base_url;
    const models = codexModels(provider);

    // 1. Write auth.json
    const auth: Record<string, string> = {};
    
    // Read existing auth if present, to preserve other keys
    if (fs.existsSync(CODEX_AUTH_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
        Object.assign(auth, existing);
      } catch { /* ignore parse errors */ }
    }
    
    auth[envKey] = format === 'openai_chat' ? 'PROXY_MANAGED' : provider.api_key;
    
    // Write atomically
    const authTmp = CODEX_AUTH_PATH + '.tmp';
    fs.writeFileSync(authTmp, JSON.stringify(auth, null, 2), 'utf-8');
    fs.renameSync(authTmp, CODEX_AUTH_PATH);

    // 2. Write config.toml
    let configToml: Record<string, any> = {};
    
    // Read existing config
    if (fs.existsSync(CODEX_CONFIG_PATH)) {
      try {
        const existingContent = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
        configToml = parseToml(existingContent) as Record<string, any>;
      } catch { /* ignore parse errors */ }
    }

    // Update top-level model and model_provider
    configToml.model = models.defaultModel;
    configToml.model_provider = CODEX_MODEL_PROVIDER_ID;
    configToml.model_catalog_json = path.join(CODEX_DIR, 'cc-switch-web-model-catalog.json');

    // Ensure model_providers section exists
    if (!configToml.model_providers) {
      configToml.model_providers = {};
    }
    
    configToml.model_providers[CODEX_MODEL_PROVIDER_ID] = {
      name: provider.name,
      base_url: baseUrl,
      env_key: envKey,
      wire_api: 'responses',
    };

    // Write atomically
    const configTmp = CODEX_CONFIG_PATH + '.tmp';
    fs.writeFileSync(configTmp, stringifyToml(configToml), 'utf-8');
    fs.renameSync(configTmp, CODEX_CONFIG_PATH);
    fs.writeFileSync(path.join(CODEX_DIR, 'cc-switch-web-model-catalog.json'), JSON.stringify(codexModelCatalog(provider), null, 2), 'utf-8');

    return {
      success: true,
      message: `Codex config written: model=${configToml.model}, base_url=${provider.base_url}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write Codex config: ${err.message}` };
  }
}

function codexModelCatalog(provider: Provider) {
  const { models } = codexModels(provider);
  return {
    models: models.map((item) => ({
      id: item.model,
      name: item.displayName || item.model,
      model: item.model,
      provider: CODEX_MODEL_PROVIDER_ID,
      wire_api: 'responses',
      tools: true,
      parallel_tool_calls: item.supportsParallelToolCalls ?? true,
      context_window: Number(item.contextWindow) || 128000,
      input_modalities: item.inputModalities || ['text'],
      ...(item.baseInstructions ? { base_instructions: item.baseInstructions } : {}),
    })),
  };
}

function codexChatAdapterBaseUrl(provider: Provider): string {
  return `${publicBaseUrl()}/proxy/codex/${provider.id}/v1`;
}

/** Check current Codex config status */
export function getCodexConfigStatus(): { configured: boolean; model?: string; base_url?: string } {
  if (!fs.existsSync(CODEX_CONFIG_PATH)) {
    return { configured: false };
  }
  
  try {
    const content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
    const config = parseToml(content) as Record<string, any>;
    const providerId = config.model_provider as string;
    const modelProviders = config.model_providers as Record<string, any> | undefined;
    const provider = modelProviders?.[providerId];
    
    return {
      configured: true,
      model: config.model as string,
      base_url: provider?.base_url as string,
    };
  } catch {
    return { configured: false };
  }
}
