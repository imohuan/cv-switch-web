import fs from 'fs';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { Provider } from '../db.js';
import { GLOBAL_HOME_DIR } from '../config.js';
import { bestFormatForApp, codexModels, publicBaseUrl } from './providerConfig.js';
import { generateCodexModelCatalog } from './codexCatalog.js';
import { writeTrackedConfigFile } from './configChanges.js';

const CODEX_DIR = path.join(GLOBAL_HOME_DIR, '.codex');
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
export function writeCodexConfig(provider: Provider, virtualAccount = false): { success: boolean; message: string } {
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

        // 1. Write auth.json
    if (virtualAccount) {
      // 虚拟账号模式：写完整假 JWT
      const email = 'niuniu@woyao.pro';
      const name = 'NIUNIU WOYAO';
      const userId = 'user-niuniu-woyao-pro-unlock';

      const fakeJwtHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      function makeFakeJwt(e: string, n: string, uid: string) {
        const payload = Buffer.from(JSON.stringify({
          email: e, name: n, user_id: uid, plan_type: 'free',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        })).toString('base64url');
        const sig = Buffer.from('cv-switch-web-virtual-signature').toString('base64url');
        return fakeJwtHeader + '.' + payload + '.' + sig;
      }

      const accessToken = makeFakeJwt(email, name, userId);
      const idToken = makeFakeJwt(email, name, userId);

      const auth = {
        aimami_router_unlock_auth: true,
        auth_mode: 'chatgpt',
        axonhub_note: 'cv-switch-web virtual account. Not a real OpenAI account.',
        email,
        name,
        user_id: userId,
        tokens: {
          access_token: accessToken,
          id_token: idToken,
          refresh_token: 'cv-switch-web-refresh-token',
        },
        OPENAI_API_KEY: 'PROXY_MANAGED',
      };

      writeTrackedConfigFile(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), { api_key: 'PROXY_MANAGED', virtual: 'true' });
    } else {
      // 普通模式
      const auth: Record<string, string> = {};
      if (fs.existsSync(CODEX_AUTH_PATH)) {
        try {
          const existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
          // 如果当前是虚拟账号，不保留旧字段
          if (!existing.aimami_router_unlock_auth) {
            Object.assign(auth, existing);
          }
        } catch { /* ignore */ }
      }
      auth['OPENAI_API_KEY'] = apiKey;
      writeTrackedConfigFile(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), { api_key: apiKey });
    }

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
      requires_openai_auth: virtualAccount,
      supports_websockets: false,
    };

    // 推理深度：xhigh 让模型花更多算力深度思考，提升复杂任务质量
    configToml.model_reasoning_effort = 'xhigh';
    // 禁用 Codex 将对话记录上传到 OpenAI 服务器存储
    configToml.disable_response_storage = true;
    // 允许 Codex 在对话中联网搜索（如网页抓取、文档查询）
    configToml.network_access = 'enabled';
    // 确认已知悉 Windows WSL 环境设置要求，跳过首次启动的 WSL 提示
    configToml.windows_wsl_setup_acknowledged = true;
    // 启用 goals 功能：允许 Codex 自主规划并执行多步骤目标
    configToml.features = { goals: true };

    writeTrackedConfigFile(CODEX_CONFIG_PATH, stringifyToml(configToml), {
      model: configToml.model as string,
      base_url: baseUrl,
    });

    // 3. Write model catalog（使用 codexCatalog.ts 中定义的完整 schema）
    writeTrackedConfigFile(
      CODEX_MODEL_CATALOG_PATH,
      JSON.stringify(generateCodexModelCatalog(provider), null, 2),
      { model_catalog: 'updated' },
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
