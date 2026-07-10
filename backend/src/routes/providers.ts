import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import fs from 'fs';
import path from 'path';
import { writeCodexConfig, getCodexConfigStatus } from '../services/codex.js';
import { writeClaudeConfig, getClaudeConfigStatus } from '../services/claude.js';
import { writeGeminiConfig, getGeminiConfigStatus } from '../services/gemini.js';
import { writeOpenCodeConfig, getOpenCodeConfigStatus } from '../services/opencode.js';
import { deleteWorkBuddyModel, readWorkBuddyModels, saveWorkBuddyModel } from '../services/workbuddy.js';
import { launchCommand, launchCommands, profileHomeDir, writeProfileConfig } from '../services/profiles.js';
import { GLOBAL_HOME_DIR } from '../config.js';
import { logger } from '../services/logger.js';
import { readConfigPreviewFiles } from '../services/configPreview.js';
import { fetchProviderModels, testProviderModel, type ModelApiFormat } from '../services/modelFetch.js';

const router = Router();
const VALID_APPS = ['codex', 'claude', 'gemini', 'opencode'] as const;
const VALID_API_FORMATS = ['openai_chat', 'openai_responses', 'anthropic'] as const;
const VALID_TEST_API_FORMATS: ModelApiFormat[] = [...VALID_API_FORMATS, 'gemini_native'];

// UUID v4 generator (minimal, no dependency)
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `profile-${Date.now()}`;
}

function uniqueProfileSlug(name: string): string {
  const base = slugify(name);
  const existing = new Set(db.getAllProfiles().map((profile) => profile.slug));
  if (!existing.has(base)) return base;

  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function isMaskedKey(value: unknown): boolean {
  return typeof value === 'string' && value.includes('****');
}

function providerPayload(body: any, existing?: db.Provider): Partial<db.Provider> | null {
  const name = typeof body.name === 'string' ? body.name.trim() : existing?.name;
  const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : existing?.base_url;
  const model = typeof body.model === 'string' ? body.model.trim() : existing?.model || '';
  const apiFormat = typeof body.api_format === 'string' ? body.api_format : existing?.api_format || 'openai_chat';

  if (!name || !baseUrl) return null;
  if (!VALID_API_FORMATS.includes(apiFormat as any)) return null;

  const payload: Partial<db.Provider> = {
    name,
    base_url: baseUrl,
    model,
    api_format: apiFormat as db.Provider['api_format'],
    extra_config: normalizeExtraConfig(body.extra_config, existing?.extra_config),
    sort_index: Number.isInteger(body.sort_index) ? body.sort_index : existing?.sort_index || 0,
  };

  if (typeof body.api_key === 'string' && body.api_key.length > 0 && !isMaskedKey(body.api_key)) {
    payload.api_key = body.api_key;
  } else if (!existing) {
    payload.api_key = '';
  }

  return payload;
}

function normalizeExtraConfig(value: unknown, fallback = '{}'): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return fallback;
    }
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return fallback;
}

function profileResponse(profile: db.Profile, provider: db.Provider) {
  return {
    ...profile,
    provider_name: provider.name,
    provider_model: provider.model,
    provider_base_url: provider.base_url,
    home_dir: profileHomeDir(profile),
    command: launchCommand(profile),
    commands: launchCommands(profile),
  };
}

function rewriteProviderProfiles(provider: db.Provider) {
  const failures: string[] = [];
  for (const profile of db.getProfilesByProviderId(provider.id)) {
    const result = writeProfileConfig(profile, provider);
    if (!result.success) failures.push(`${profile.name}: ${result.message}`);
  }
  return failures;
}

// ── Provider CRUD ──

router.get('/providers', (_req: Request, res: Response) => {
  try {
    const providers = db.getAllProviders();
    res.json({ success: true, data: providers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/providers', (req: Request, res: Response) => {
  try {
    const payload = providerPayload(req.body);
    if (!payload) {
      res.status(400).json({ success: false, error: 'Invalid provider payload' });
      return;
    }

    const provider = db.createProvider({
      id: generateId(),
      name: payload.name!,
      base_url: payload.base_url!,
      api_key: payload.api_key || '',
      model: payload.model || '',
      api_format: payload.api_format!,
      extra_config: payload.extra_config || '{}',
      sort_index: db.getAllProviders().length,
    });

    res.json({ success: true, data: provider });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/providers/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.getProviderById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    const updates = providerPayload(req.body, existing);
    if (!updates) {
      res.status(400).json({ success: false, error: 'Invalid provider payload' });
      return;
    }
    const updated = db.updateProvider(id, updates);
    
    if (!updated) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    
    // If this provider is currently active for any app, re-write config
    const statuses = db.getAllAppStatus();
    for (const status of statuses) {
      if (status.current_provider_id === id) {
        applyProviderToApp(status.app_type, updated);
      }
    }
    const profileFailures = rewriteProviderProfiles(updated);

    res.json({ success: true, data: updated, message: profileFailures.length ? profileFailures.join('; ') : undefined });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/providers/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = db.deleteProvider(id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Task Profiles ──

router.get('/profiles', (_req: Request, res: Response) => {
  try {
    const profiles = db.getAllProfiles().map((profile) => {
      const provider = db.getProviderById(profile.provider_id);
      return {
        ...profile,
        provider_name: provider?.name || null,
        provider_model: provider?.model || null,
        provider_base_url: provider?.base_url || null,
        home_dir: profileHomeDir(profile),
        command: launchCommand(profile),
        commands: launchCommands(profile),
      };
    });
    res.json({ success: true, data: profiles });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/profiles', (req: Request, res: Response) => {
  try {
    const { name, app_type, provider_id, kind, targets } = req.body

    // ── 新格式：多平台 targets ──
    if (kind && Array.isArray(targets) && targets.length > 0) {
      if (!name) {
        res.status(400).json({ success: false, error: 'name is required' })
        return
      }

      for (const t of targets) {
        if (!t.app_type || !VALID_APPS.includes(t.app_type)) {
          res.status(400).json({ success: false, error: `Invalid target app_type: ${t.app_type}` })
          return
        }
        if (!t.model) {
          res.status(400).json({ success: false, error: `target model is required for ${t.app_type}` })
          return
        }
      }

      const extra: any = {
        kind: kind || 'bundle',
        targets: targets.map((t: any) => ({
          app_type: t.app_type,
          model: t.model,
          ...(t.app_type === 'claude' ? {
            claude_haiku: t.claude_haiku || undefined,
            claude_sonnet: t.claude_sonnet || undefined,
            claude_opus: t.claude_opus || undefined,
          } : {}),
          ...(t.app_type === 'codex' ? {
            codex_models: Array.isArray(t.codex_models) ? t.codex_models : [],
          } : {}),
        })),
      }

      const primaryAppType = targets[0].app_type
      const firstProviderId = db.getAllProviders()[0]?.id || ''

      const profile = db.createProfile({
        id: generateId(),
        name: String(name).trim(),
        app_type: primaryAppType,
        provider_id: firstProviderId,
        slug: uniqueProfileSlug(name),
        extra_config: JSON.stringify(extra),
      })

      res.json({
        success: true,
        message: 'Profile created',
        data: {
          ...profile,
          provider_name: null,
          provider_model: null,
          provider_base_url: null,
          home_dir: profileHomeDir(profile),
          command: launchCommand(profile),
          commands: launchCommands(profile),
        },
      })
      return
    }

    // ── 旧格式：单 app_type + 单 provider_id（向后兼容） ──
    if (!name || !app_type || !provider_id) {
      res.status(400).json({ success: false, error: 'name, app_type and provider_id are required' });
      return;
    }
    if (!VALID_APPS.includes(app_type)) {
      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });
      return;
    }

    const provider = db.getProviderById(provider_id);
    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }

    const draftProfile: db.Profile = {
      id: generateId(),
      name: String(name).trim(),
      app_type,
      provider_id,
      slug: uniqueProfileSlug(name),
      extra_config: normalizeExtraConfig(req.body.extra_config),
      created_at: '',
      updated_at: '',
    };
    const result = writeProfileConfig(draftProfile, provider);
    if (!result.success) {
      res.status(500).json({ success: false, error: result.message });
      return;
    }
    const profile = db.createProfile({
      id: draftProfile.id,
      name: draftProfile.name,
      app_type: draftProfile.app_type,
      provider_id: draftProfile.provider_id,
      slug: draftProfile.slug,
      extra_config: draftProfile.extra_config,
    });

    res.json({
      success: result.success,
      message: result.message,
      data: profileResponse(profile, provider),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
})


// PUT /api/profiles/:id — 编辑 Profile（名称 + targets）
router.put('/profiles/:id', (req: Request, res: Response) => {
  try {
    const profile = db.getProfileById(req.params.id)
    if (!profile) {
      res.status(404).json({ success: false, error: 'Profile not found' })
      return
    }

    const { name, kind, targets } = req.body
    const updates: Partial<db.Profile> = {}

    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim()
      updates.slug = uniqueProfileSlug(name)
    }

    // 更新 targets（写入 extra_config）
    if (kind && Array.isArray(targets)) {
      let extra: any
      try { extra = JSON.parse(profile.extra_config || '{}') } catch { extra = {} }
      extra.kind = kind
      extra.targets = targets.map((t: any) => ({
        app_type: t.app_type,
        model: t.model,
        ...(t.app_type === 'claude' ? {
          claude_haiku: t.claude_haiku || undefined,
          claude_sonnet: t.claude_sonnet || undefined,
          claude_opus: t.claude_opus || undefined,
        } : {}),
        ...(t.app_type === 'codex' ? {
          codex_models: Array.isArray(t.codex_models) ? t.codex_models : [],
        } : {}),
      }))
      updates.extra_config = JSON.stringify(extra)
    }

    const updated = db.updateProfile(profile.id, updates)
    if (!updated) {
      res.status(404).json({ success: false, error: 'Profile not found' })
      return
    }

    res.json({ success: true, data: updated })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})
router.post('/profiles/:id/apply', (req: Request, res: Response) => {
  try {
    const profile = db.getProfileById(req.params.id);
    if (!profile) {
      res.status(404).json({ success: false, error: 'Profile not found' });
      return;
    }

    // 解析 extra_config，判断是否多平台 targets 格式
    let extra: any
    try { extra = JSON.parse(profile.extra_config || '{}') } catch { extra = {} }

    if (extra.kind && Array.isArray(extra.targets) && extra.targets.length > 0) {
      // ── 多平台 apply ──
      const results: Array<{ app_type: string; success: boolean; message: string }> = []

      // 可选 appType 参数：只应用指定平台（概览页单平台切换用）
      const filterAppType = req.body?.appType as string | undefined

      for (const target of extra.targets) {
        if (filterAppType && target.app_type !== filterAppType) continue

        // 查找匹配该模型的 Provider
        const allProviders = db.getAllProviders()
        let matchedProvider = null

        for (const p of allProviders) {
          let pextra: any
          try { pextra = JSON.parse(p.extra_config || '{}') } catch { pextra = {} }
          const pmodels = Array.isArray(pextra.models) ? pextra.models : (Array.isArray(pextra.codex?.models) ? pextra.codex.models : [])
          if (pmodels.some((m: any) => (m.id || m.model) === target.model)) {
            matchedProvider = p
            break
          }
        }

        // Fallback: 用第一个 Provider
        if (!matchedProvider) matchedProvider = allProviders[0]

        if (!matchedProvider) {
          results.push({ app_type: target.app_type, success: false, message: 'No provider available' })
          continue
        }

        // 构造临时 Profile 用于 writeProfileConfig
        const tempProfile: db.Profile = {
          ...profile,
          app_type: target.app_type,
          provider_id: matchedProvider.id,
        }

        // 用 target 的 model 覆盖 Provider 的 model
        const effectiveProvider = { ...matchedProvider, model: target.model }

        const result = writeProfileConfig(tempProfile, effectiveProvider);
        if (result.success) {
          db.setCurrentProvider(target.app_type, matchedProvider.id)
        }
        results.push({ app_type: target.app_type, success: result.success, message: result.message })
      }

      res.json({ success: true, message: 'Applied to ' + results.length + ' platforms', data: { results } })
      return
    }

    // ── 旧格式 apply（向后兼容） ──
    const provider = db.getProviderById(profile.provider_id);
    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }

    const result = writeProfileConfig(profile, provider);
    res.json({
      success: result.success,
      message: result.message,
      data: profileResponse(profile, provider),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
})

router.delete('/profiles/:id', (req: Request, res: Response) => {
  try {
    const deleted = db.deleteProfile(req.params.id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 读取 Profile 本地配置文件 ──

router.get('/profiles/:id/config', (req: Request, res: Response) => {
  try {
    const profile = db.getProfileById(req.params.id);
    if (!profile) {
      res.status(404).json({ success: false, error: 'Profile not found' });
      return;
    }

    const homeDir = profileHomeDir(profile);

    /** 根据应用类型定义要读取的配置文件路径 */
    const configFiles = (() => {
      switch (profile.app_type) {
        case 'claude':
          return [
            { label: '.claude/settings.json', path: path.join(homeDir, '.claude', 'settings.json') },
          ];
        case 'codex':
          return [
            { label: '.codex/auth.json', path: path.join(homeDir, '.codex', 'auth.json') },
            { label: '.codex/config.toml', path: path.join(homeDir, '.codex', 'config.toml') },
            { label: '.codex/model-catalog.json', path: path.join(homeDir, '.codex', 'cc-switch-web-model-catalog.json') },
          ];
        case 'gemini':
          return [
            { label: '.gemini/.env', path: path.join(homeDir, '.gemini', '.env') },
            { label: '.gemini/settings.json', path: path.join(homeDir, '.gemini', 'settings.json') },
          ];
        case 'opencode':
          return [
            { label: 'opencode.json', path: path.join(homeDir, '.config', 'opencode', 'opencode.json') },
          ];
        default:
          return [];
      }
    })();

    const files = readConfigPreviewFiles(configFiles);

    res.json({ success: true, data: { home_dir: homeDir, app_type: profile.app_type, files } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 读取全局 App 本地配置文件（非 Profile，直接读取用户 HOME 目录） ──

/** 根据应用类型返回全局配置文件路径列表 */
function globalConfigFiles(appType: string): Array<{ label: string; path: string }> {
  const home = GLOBAL_HOME_DIR;
  switch (appType) {
    case 'claude':
      return [
        { label: '.claude/settings.json', path: path.join(home, '.claude', 'settings.json') },
      ];
    case 'codex':
      return [
        { label: '.codex/auth.json', path: path.join(home, '.codex', 'auth.json') },
        { label: '.codex/config.toml', path: path.join(home, '.codex', 'config.toml') },
        { label: '.codex/cc-switch-web-model-catalog.json', path: path.join(home, '.codex', 'cc-switch-web-model-catalog.json') },
      ];
    case 'gemini':
      return [
        { label: '.gemini/.env', path: path.join(home, '.gemini', '.env') },
        { label: '.gemini/settings.json', path: path.join(home, '.gemini', 'settings.json') },
      ];
    case 'opencode':
      return [
        { label: 'opencode.json', path: path.join(home, '.config', 'opencode', 'opencode.json') },
      ];
    default:
      return [];
  }
}

router.get('/app/:appType/config', (req: Request, res: Response) => {
  try {
    const { appType } = req.params;
    if (!VALID_APPS.includes(appType as any)) {
      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });
      return;
    }

    const homeDir = GLOBAL_HOME_DIR;
    const configFiles = globalConfigFiles(appType);

    const files = readConfigPreviewFiles(configFiles);

    res.json({ success: true, data: { home_dir: homeDir, app_type: appType, files } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── App Status & Switching ──

router.get('/status', (_req: Request, res: Response) => {
  try {
    const appStatuses = db.getAllAppStatus();
    const statuses: Record<string, any> = {};
    
    for (const s of appStatuses) {
      const provider = s.current_provider_id ? db.getProviderById(s.current_provider_id) : null;
      
      // Get live config status
      let configStatus: { configured: boolean; model?: string; base_url?: string } = { configured: false };
      switch (s.app_type) {
        case 'codex': configStatus = getCodexConfigStatus(); break;
        case 'claude': configStatus = getClaudeConfigStatus(); break;
        case 'gemini': configStatus = getGeminiConfigStatus(); break;
        case 'opencode': configStatus = getOpenCodeConfigStatus(); break;
      }
      
            // 查找该 app_type 下有哪些 Profile 的 targets 包含此平台
      const matchingProfiles = db.getAllProfiles().filter((p) => {
        try {
          const e = JSON.parse(p.extra_config || '{}')
          if (e.targets && Array.isArray(e.targets)) {
            return e.targets.some((t: any) => t.app_type === s.app_type)
          }
          return p.app_type === s.app_type
        } catch { return p.app_type === s.app_type }
      }).map((p) => ({ id: p.id, name: p.name }))

      statuses[s.app_type] = {
        app_type: s.app_type,
        current_provider_id: s.current_provider_id,
        current_provider_name: provider?.name || null,
                live_config_status: configStatus,
        matching_profiles: matchingProfiles,
        updated_at: s.updated_at,
      };
    }
    
    res.json({ success: true, data: statuses });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear (unset) provider for an app. This must be registered before the dynamic provider route.
router.post('/switch/:appType/clear', (req: Request, res: Response) => {
  try {
    const { appType } = req.params;
    if (!VALID_APPS.includes(appType as any)) {
      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });
      return;
    }
    db.setCurrentProvider(appType, null);
    res.json({ success: true, message: `Cleared ${appType} config` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/switch/:appType/:providerId', (req: Request, res: Response) => {
  try {
    const { appType, providerId } = req.params;
    
    if (!VALID_APPS.includes(appType as any)) {
      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });
      return;
    }
    
    const provider = db.getProviderById(providerId);
    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    
    // Write config to the target tool
    const result = applyProviderToApp(appType, provider);
    
    if (result.success) {
      db.setCurrentProvider(appType, providerId);
    }
    
    res.json({ success: result.success, message: result.message, data: { appType, providerId } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Helper ──

function applyProviderToApp(appType: string, provider: db.Provider): { success: boolean; message: string } {
  switch (appType) {
    case 'codex': return writeCodexConfig(provider);
    case 'claude': return writeClaudeConfig(provider);
    case 'gemini': return writeGeminiConfig(provider);
    case 'opencode': return writeOpenCodeConfig(provider);
    default: return { success: false, message: `Unknown app type: ${appType}` };
  }
}

// ── API Key masking ──
// Return providers with masked API keys for safe display
router.get('/providers-safe', (_req: Request, res: Response) => {
  try {
    const providers = db.getAllProviders();
    const masked = providers.map(p => ({
      ...p,
      api_key: maskKey(p.api_key),
    }));
    res.json({ success: true, data: masked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function maskKey(key: string): string {
  if (!key || key.length < 8) return key;
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// ── WorkBuddy local models ──

router.get('/workbuddy/models', (_req: Request, res: Response) => {
  try {
    const data = readWorkBuddyModels();
    res.json({
      success: true,
      data: {
        ...data,
        models: data.models.map((model) =>
          Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'apiKey')),
        ),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/workbuddy/models/:id', (req: Request, res: Response) => {
  try {
    const input = req.body && typeof req.body === 'object' ? req.body : {};
    if (input.apiKey === '***MASKED***') input.apiKey = '';
    const model = saveWorkBuddyModel(input, req.params.id === '__new__' ? undefined : req.params.id);
    const safeModel = Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'apiKey'));
    res.json({ success: true, data: safeModel });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/workbuddy/models/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteWorkBuddyModel(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'WorkBuddy 模型不存在' });
      return;
    }
    res.json({ success: true, data: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/providers/models/all — 所有 Provider 模型汇总
router.get('/providers/models/all', (_req: Request, res: Response) => {
  try {
    const providers = db.getAllProviders()
    const result = providers.map((provider) => {
      let extra: any
      try { extra = JSON.parse(provider.extra_config || '{}') } catch { extra = {} }
      const models = Array.isArray(extra.models) && extra.models.length > 0
        ? extra.models
        : Array.isArray(extra.codex?.models) ? extra.codex.models : []
      return {
        id: provider.id,
        name: provider.name,
        models: models.map((m: any) => ({
          id: m.id || m.model || '',
          displayName: m.displayName || m.id || m.model || '',
        })),
      }
    })
    res.json({ success: true, data: { providers: result } })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── Fetch provider models ──

router.get('/providers/:id/models', async (req: Request, res: Response) => {
  try {
    const provider = db.getProviderById(req.params.id);
    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }

    logger.models.fetchStart(provider.id, provider.base_url);
    const result = await fetchProviderModels({ baseUrl: provider.base_url, apiKey: provider.api_key });
    logger.models.fetchOk(provider.id, result.models.length);
    res.json({ success: true, data: result.models });
  } catch (err: any) {
    logger.models.fetchError(req.params.id, 0, err.message || 'Failed to fetch models');
    res.json({ success: false, error: err.message || 'Failed to fetch models' });
  }
});

// ── Fetch models by config (no saved provider) ──

router.post('/models/fetch', async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl) {
      res.status(400).json({ success: false, error: 'baseUrl is required' });
      return;
    }
    const result = await fetchProviderModels({
      baseUrl: String(baseUrl),
      apiKey: typeof apiKey === 'string' ? apiKey : '',
    });
    res.json({ success: true, data: result.models });
  } catch (err: any) {
    res.json({ success: false, error: err.message || 'Failed to fetch models' });
  }
});

// ── Test model connectivity ──

router.post('/models/test', async (req: Request, res: Response) => {
  try {
    const provider = typeof req.body.providerId === 'string'
      ? db.getProviderById(req.body.providerId)
      : undefined;
    const baseUrl = typeof req.body.baseUrl === 'string' && req.body.baseUrl.trim()
      ? req.body.baseUrl.trim()
      : provider?.base_url || '';
    const apiKey = typeof req.body.apiKey === 'string' && req.body.apiKey
      ? req.body.apiKey
      : provider?.api_key || '';
    const apiFormat = req.body.apiFormat as ModelApiFormat;
    const model = typeof req.body.model === 'string' ? req.body.model.trim() : '';

    if (!baseUrl || !model || !VALID_TEST_API_FORMATS.includes(apiFormat)) {
      res.status(400).json({ success: false, error: 'Base URL、模型和 API 格式不能为空' });
      return;
    }

    const result = await testProviderModel({ baseUrl, apiKey, apiFormat, model });
    res.json({
      success: result.ok,
      data: result,
      error: result.ok
        ? undefined
        : result.preview || `Provider returned ${result.status}: ${result.statusText}`,
    });
  } catch (err: any) {
    res.json({ success: false, error: err.message || '模型连通性测试失败' });
  }
});

// ── 日志查询 ──

router.get('/logs', (_req: Request, res: Response) => {
  try {
    const logFile = logger.logFilePath();
    if (!fs.existsSync(logFile)) {
      res.json({ success: true, data: { lines: [], file: path.basename(logFile) } });
      return;
    }
    const raw = fs.readFileSync(logFile, 'utf-8');
    const lines = raw.trim().split('\n').slice(-200); // 最近 200 行
    res.json({ success: true, data: { lines, file: path.basename(logFile), dir: logger.logDir } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ===== cc-switch-web v2 新增路由 =====

// PUT /api/providers/:id/models — 全量覆盖保存模型选择
router.put('/providers/:id/models', (req: Request, res: Response) => {
  try {
    const provider = db.getProviderById(req.params.id)
    if (!provider) { res.status(404).json({ success: false, error: 'Provider not found' }); return }
    const models: Array<any> = Array.isArray(req.body?.models) ? req.body.models : []
    let extra: any
    try { extra = JSON.parse(provider.extra_config || '{}') } catch { extra = {} }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) extra = {}
    extra.models = models.map((m: any) => ({
      id: String(m.id || '').trim(),
      displayName: m.displayName || undefined,
      contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
      maxOutputTokens: typeof m.maxOutputTokens === 'number' ? m.maxOutputTokens : undefined,
      supportsImages: typeof m.supportsImages === 'boolean' ? m.supportsImages : undefined,
      supportsParallelToolCalls: typeof m.supportsParallelToolCalls === 'boolean' ? m.supportsParallelToolCalls : undefined,
      supportsReasoning: typeof m.supportsReasoning === 'boolean' ? m.supportsReasoning : undefined,
      defaultReasoningEffort: m.defaultReasoningEffort || undefined,
      supportedReasoningEfforts: Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : undefined,
      inputModalities: Array.isArray(m.inputModalities) ? m.inputModalities : undefined,
      baseInstructions: m.baseInstructions || undefined,
    })).filter((m: any) => m.id)
    if (!extra.codex) extra.codex = {}
    extra.codex.models = extra.models
    db.updateProvider(provider.id, { extra_config: JSON.stringify(extra) })
    res.json({ success: true, data: { models: extra.models } })
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }) }
})

// GET /api/providers/:id/models/manage — 读取已保存的模型列表
router.get('/providers/:id/models/manage', (req: Request, res: Response) => {
  try {
    const provider = db.getProviderById(req.params.id)
    if (!provider) { res.status(404).json({ success: false, error: 'Provider not found' }); return }
    let extra: any
    try { extra = JSON.parse(provider.extra_config || '{}') } catch { extra = {} }
    const models = Array.isArray(extra.models) && extra.models.length > 0
      ? extra.models
      : (Array.isArray(extra.codex?.models) ? extra.codex.models : [])
    res.json({ success: true, data: { models } })
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }) }
})

// POST /api/profiles — 支持多平台 targets（新格式），向后兼容旧格式
// （注意：此路由会覆盖上面的旧 POST /profiles，因为 Express 按注册顺序匹配，后面注册的优先级低，
//  但由于路径完全相同，实际只会命中先注册的那个。这里需要用不同的方式处理。）
//
// 方案：不在文件末尾加新路由，而是直接修改原有 POST /profiles 路由

export default router;
