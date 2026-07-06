import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { Provider } from '../db.js';
import { bestFormatForApp, codexModels, publicBaseUrl } from './providerConfig.js';
import { generateCodexModelCatalog } from './codexCatalog.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const CODEX_CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const CODEX_MODEL_CATALOG_PATH = path.join(CODEX_DIR, 'cc-switch-web-model-catalog.json');
const CODEX_MODEL_PROVIDER_ID = 'custom';

/**
 * Write Codex CLI configuration from a Provider.
 *
 * Codex uses two files:
 * - ~/.codex/auth.json:  contains API key（兼容性保留，部分版本会检查）
 * - ~/.codex/config.toml: contains model + model_provider config
 *
 * ⚠️ 不使用 env_key 模式。env_key 要求环境变量存在，终端启动时未设会报
 *    "Missing environment variable: OPENAI_API_KEY"。
 *    改用 api_key 直接写入 config.toml，Codex 从文件读取。
 */
export function writeCodexConfig(provider: Provider): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(CODEX_DIR)) {
      fs.mkdirSync(CODEX_DIR, { recursive: true });
    }

    const format = bestFormatForApp(provider, 'codex');
    const useProxy = format === 'openai_chat';
    const baseUrl = useProxy
      ? codexChatAdapterBaseUrl(provider)
      : provider.base_url;
    const models = codexModels(provider);

    // Proxy 模式下 Proxy 会注入真实 key，config 里写 PROXY_MANAGED 占位。
    // 直连模式写 Provider 真实 key。
    const apiKey = useProxy ? 'PROXY_MANAGED' : provider.api_key;

    // 1. Write auth.json（保留已有 key，兼容旧版 Codex）
    const auth: Record<string, string> = {};
    if (fs.existsSync(CODEX_AUTH_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
        Object.assign(auth, existing);
      } catch { /* ignore parse errors */ }
    }
    auth['OPENAI_API_KEY'] = apiKey;

    const authTmp = CODEX_AUTH_PATH + '.tmp';
    fs.writeFileSync(authTmp, JSON.stringify(auth, null, 2), 'utf-8');
    fs.renameSync(authTmp, CODEX_AUTH_PATH);

    // 2. Write config.toml（读取已有配置，只覆盖我们管理的字段）
    let configToml: Record<string, any> = {};
    if (fs.existsSync(CODEX_CONFIG_PATH)) {
      try {
        const existingContent = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
        configToml = parseToml(existingContent) as Record<string, any>;
      } catch { /* ignore parse errors */ }
    }

    configToml.model = models.defaultModel;
    configToml.model_provider = CODEX_MODEL_PROVIDER_ID;
    configToml.model_catalog_json = CODEX_MODEL_CATALOG_PATH;

    if (!configToml.model_providers) {
      configToml.model_providers = {};
    }

    configToml.model_providers[CODEX_MODEL_PROVIDER_ID] = {
      name: provider.name,
      base_url: baseUrl,
      // api_key 直接内联，不依赖环境变量
      api_key: apiKey,
      wire_api: 'responses',
      // 自定义 provider 不需要 OpenAI OAuth 登录
      requires_openai_auth: false,
      supports_websockets: false,
    };

    const configTmp = CODEX_CONFIG_PATH + '.tmp';
    fs.writeFileSync(configTmp, stringifyToml(configToml), 'utf-8');
    fs.renameSync(configTmp, CODEX_CONFIG_PATH);

    // 3. Write model catalog（使用 codexCatalog.ts 中定义的完整 schema）
    fs.writeFileSync(
      CODEX_MODEL_CATALOG_PATH,
      JSON.stringify(generateCodexModelCatalog(provider), null, 2),
      'utf-8',
    );

    return {
      success: true,
      message: `Codex config written: model=${configToml.model}, base_url=${baseUrl}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write Codex config: ${err.message}` };
  }
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
