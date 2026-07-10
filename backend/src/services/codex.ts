import fs from 'fs';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import * as db from '../db.js';
import { GLOBAL_HOME_DIR } from '../config.js';
import { bestFormatForApp, codexModels, publicBaseUrl } from './providerConfig.js';
import { generateAggregatedModelCatalog } from './codexCatalog.js';
import { writeTrackedConfigFile, configChangeStore } from './configChanges.js';

const CODEX_DIR = path.join(GLOBAL_HOME_DIR, '.codex');
const CODEX_AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const CODEX_CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const CODEX_MODEL_CATALOG_PATH = path.join(CODEX_DIR, 'cc-switch-web-model-catalog.json');
const ROUTER_PROVIDER_ID = 'cv-switch-router';

function providerSlug(p: db.Provider): string {
  return p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || p.id;
}

/**
 * Write Codex CLI configuration with all Providers.
 *
 * 模仿 AiMaMi 架构：
 * - 为每个 Provider 注册直连 model_provider + profile
 * - 注册一个路由 model_provider（cv-switch-router）
 * - 顶层 model_provider 指向路由 provider
 * - model_catalog 聚合所有 Provider 的模型
 * - 虚拟账号控制路由 provider 的 requires_openai_auth
 */
export function writeCodexConfig(virtualAccount = false, activeProviderId?: string): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(CODEX_DIR)) {
      fs.mkdirSync(CODEX_DIR, { recursive: true });
    }

    const allProviders = db.getAllProviders();

    // 1. Write auth.json
    if (virtualAccount) {
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

      writeTrackedConfigFile(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), { virtual_account: 'enabled' });
    } else {
      const auth: Record<string, string> = {};
      if (fs.existsSync(CODEX_AUTH_PATH)) {
        try {
          const existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
          if (!existing.aimami_router_unlock_auth) {
            Object.assign(auth, existing);
          }
        } catch { /* ignore */ }
      }
      auth['OPENAI_API_KEY'] = 'PROXY_MANAGED';
      writeTrackedConfigFile(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), { virtual_account: 'disabled' });
    }

    // 记录虚拟账号状态变更
    configChangeStore.record(CODEX_AUTH_PATH, {
      virtual_account: virtualAccount ? 'enabled' : 'disabled',
      user_id: 'user-niuniu-woyao-pro-unlock',
    });

    // 2. Write config.toml
    let configToml: Record<string, any> = {};
    if (fs.existsSync(CODEX_CONFIG_PATH)) {
      try {
        configToml = parseToml(fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')) as Record<string, any>;
      } catch { /* ignore */ }
    }

    // 顶层配置
        const activeSlug = activeProviderId ? (allProviders.find(p => p.id === activeProviderId) ? providerSlug(allProviders.find(p => p.id === activeProviderId)!) : activeProviderId) : (allProviders[0] ? providerSlug(allProviders[0]) : ROUTER_PROVIDER_ID);
    configToml.model_provider = virtualAccount ? ROUTER_PROVIDER_ID : activeSlug;
    configToml.model_catalog_json = CODEX_MODEL_CATALOG_PATH;
    configToml.model_reasoning_effort = 'xhigh';
    configToml.disable_response_storage = true;
    configToml.network_access = 'enabled';
    configToml.windows_wsl_setup_acknowledged = true;
    configToml.features = { goals: true };

    if (!configToml.model_providers) configToml.model_providers = {};
    if (!configToml.profiles) configToml.profiles = {};

    // 清理旧的 cv-switch 管理的 provider/profile（避免残留）
    for (const key of Object.keys(configToml.model_providers)) {
      if (key === ROUTER_PROVIDER_ID || allProviders.some(p => providerSlug(p) === key)) {
        // 保留，后续覆盖
      } else if (key.startsWith('aimami_relay_') || key === 'aimai1' || key === 'custom') {
        // 保留 AiMaMi 和旧自定义 provider（不删除用户已有配置）
      }
    }

    // 为每个 Provider 注册直连 provider + profile
    for (const provider of allProviders) {
      const format = bestFormatForApp(provider, 'codex');
      const useProxy = format === 'openai_chat';
      const baseUrl = useProxy
        ? `${publicBaseUrl()}/proxy/codex/${provider.id}/v1`
        : provider.base_url;
      const apiKey = useProxy ? 'PROXY_MANAGED' : provider.api_key;
      const { defaultModel } = codexModels(provider);

      const slug = providerSlug(provider);
      configToml.model_providers[slug] = {
        name: provider.name,
        base_url: baseUrl,
        api_key: apiKey,
        wire_api: 'responses',
        requires_openai_auth: false,
        supports_websockets: false,
      };

      configToml.profiles[slug] = {
        model_provider: slug,
        model: slug + '::' + defaultModel,
      };
    }

    // 路由 Provider
    const routerBaseUrl = `${publicBaseUrl()}/proxy/codex/router/v1`;
    configToml.model_providers[ROUTER_PROVIDER_ID] = {
      name: 'cv-switch 智能路由',
      base_url: routerBaseUrl,
      api_key: 'PROXY_MANAGED',
      wire_api: 'responses',
      requires_openai_auth: virtualAccount,
      supports_websockets: false,
    };

    configToml.profiles[ROUTER_PROVIDER_ID] = {
      model_provider: ROUTER_PROVIDER_ID,
      model: allProviders[0] ? (providerSlug(allProviders[0]) + '::' + (codexModels(allProviders[0]).defaultModel)) : 'unknown',
    };

    const providerIds = allProviders.map(p => providerSlug(p)).join(', ');
    writeTrackedConfigFile(CODEX_CONFIG_PATH, stringifyToml(configToml), {
      model_provider: ROUTER_PROVIDER_ID,
      providers: providerIds || 'none',
      virtual_account: virtualAccount ? 'true' : 'false',
    });

    // 3. Write model catalog（聚合所有 Provider 模型）
    const catalog = generateAggregatedModelCatalog(allProviders);
    writeTrackedConfigFile(
      CODEX_MODEL_CATALOG_PATH,
      JSON.stringify(catalog, null, 2),
      { model_catalog: 'aggregated', model_count: String(catalog.models.length) },
    );

    return {
      success: true,
      message: `Codex config written: router=${ROUTER_PROVIDER_ID}, providers=[${providerIds}], models=${catalog.models.length}`,
    };
  } catch (err: any) {
    return { success: false, message: `Failed to write Codex config: ${err.message}` };
  }
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
