# 虚拟账号完整实现计划：双 API 架构 + configChanges 记录

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 AiMaMi 的 config.toml 架构，在自己的项目里实现完整的双 API 模式——直连 API + 路由 API，所有 Provider 写入 config.toml，model_catalog 聚合所有模型，虚拟账号开关控制身份验证层。

**Architecture:** 

```
config.toml 写入结构（模仿 AiMaMi）：

model_provider = "cv-switch-router"         ← 顶层指向路由 provider
model_catalog_json = "..."                   ← 聚合所有 Provider 的模型

[model_providers.{providerId1}]              ← 直连 provider，每个对应一个上游
  base_url = "/proxy/codex/by-provider/{id}/v1"
  requires_openai_auth = false

[model_providers.{providerId2}]              ← 直连 provider 2
  ...

[model_providers.cv-switch-router]           ← 路由 provider
  base_url = "/proxy/codex/router/v1"
  requires_openai_auth = true/false          ← 虚拟账号开关控制

[profiles.{providerId1}]                     ← 每个 provider 一个 profile
[profiles.{providerId2}]
[profiles.cv-switch-router]
```

代理端两个 API：
- `/proxy/codex/by-provider/{providerId}/v1` → 已有，直连转发
- `/proxy/codex/router/v1` → 新增，智能路由（读取 JWT user_id 或轮询选择上游）

**Tech Stack:** TypeScript / Express / Vue 3

**改哪些文件：**
- `backend/src/services/codex.ts` — 重写 writeCodexConfig()，写入所有 Provider + 路由 Provider
- `backend/src/services/codexCatalog.ts` — model_catalog 聚合所有 Provider 模型
- `backend/src/routes/codexProxy.ts` — 新增 /router/v1 端点，保留 JWT 验证
- `backend/src/routes/providers.ts` — toggle 端点加 configChanges 记录
- `frontend/src/components/StatusOverview.vue` — 虚拟账号开关状态从后端同步

---

### Task 1: 重写 writeCodexConfig() — 写入所有 Provider + 路由 Provider

**Files:**
- Modify: `backend/src/services/codex.ts`

**核心变化：** 不再只写当前激活的 Provider，而是把所有 Provider 都写入 config.toml，新增一个路由 Provider。

- [ ] **Step 1: 修改 writeCodexConfig 的逻辑**

当前逻辑：
```
1. 读 config.toml（保留已有字段）
2. 写 model_provider = "custom"
3. 只写一个 [model_providers.custom]
```

新逻辑：
```
1. 读 config.toml（保留已有字段）
2. 遍历 db 中所有 Provider
3. 为每个 Provider 写 [model_providers.{id}] + [profiles.{id}]
4. 写 [model_providers.cv-switch-router]（路由 provider）
5. 写 [profiles.cv-switch-router]
6. 写 model_provider = "cv-switch-router"（顶层指向路由）
7. 写 model_catalog_json（聚合所有模型）
8. 虚拟账号开关 → 控制 router provider 的 requires_openai_auth
```

具体代码：`writeCodexConfig` 不再需要 `provider` 参数（或改为可选，用于兼容现有调用），改为从 db 读取所有 Provider。

```typescript
export function writeCodexConfig(virtualAccount = false): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(CODEX_DIR)) {
      fs.mkdirSync(CODEX_DIR, { recursive: true });
    }

    // 获取所有 Provider
    const allProviders = db.getAllProviders();
    
    // 1. Write auth.json（与之前相同，略）
    
    // 2. Write config.toml
    let configToml: Record<string, any> = {};
    if (fs.existsSync(CODEX_CONFIG_PATH)) {
      try {
        configToml = parseToml(fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')) as Record<string, any>;
      } catch { /* ignore */ }
    }

    // 顶层配置
    configToml.model_provider = 'cv-switch-router';
    configToml.model_catalog_json = CODEX_MODEL_CATALOG_PATH;
    // ... 其他顶层配置不变

    if (!configToml.model_providers) configToml.model_providers = {};
    if (!configToml.profiles) configToml.profiles = {};

    // 为每个 Provider 注册直连 provider + profile
    for (const provider of allProviders) {
      const format = bestFormatForApp(provider, 'codex');
      const useProxy = format === 'openai_chat';
      const baseUrl = useProxy
        ? `${publicBaseUrl()}/proxy/codex/by-provider/${provider.id}/v1`
        : provider.base_url;
      const apiKey = useProxy ? 'PROXY_MANAGED' : provider.api_key;
      const { defaultModel } = codexModels(provider);

      configToml.model_providers[provider.id] = {
        name: provider.name,
        base_url: baseUrl,
        api_key: apiKey,
        wire_api: 'responses',
        requires_openai_auth: false,
        supports_websockets: false,
      };

      configToml.profiles[provider.id] = {
        model_provider: provider.id,
        model: defaultModel,
      };
    }

    // 路由 Provider
    const routerBaseUrl = `${publicBaseUrl()}/proxy/codex/router/v1`;
    configToml.model_providers['cv-switch-router'] = {
      name: 'cv-switch 智能路由',
      base_url: routerBaseUrl,
      api_key: 'PROXY_MANAGED',
      wire_api: 'responses',
      requires_openai_auth: virtualAccount,
      supports_websockets: false,
    };

    configToml.profiles['cv-switch-router'] = {
      model_provider: 'cv-switch-router',
      model: allProviders[0]?.id || 'unknown',
    };

    // ... 写入文件
    writeTrackedConfigFile(CODEX_CONFIG_PATH, stringifyToml(configToml), {
      model_provider: 'cv-switch-router',
      providers: allProviders.map(p => p.id).join(', '),
    });

    // 3. 聚合 model_catalog
    writeTrackedConfigFile(
      CODEX_MODEL_CATALOG_PATH,
      JSON.stringify(generateAggregatedModelCatalog(allProviders), null, 2),
      { model_catalog: 'aggregated' },
    );

    return { success: true, message: `Config written with ${allProviders.length} providers` };
  } catch (err: any) {
    return { success: false, message: `Failed: ${err.message}` };
  }
}
```

- [ ] **Step 2: 更新 codexCatalog.ts 新增聚合函数**

```typescript
export function generateAggregatedModelCatalog(providers: Provider[]): ModelsResponse {
  const allModels: ModelInfo[] = [];
  let priority = 0;

  for (const provider of providers) {
    const { models } = codexModels(provider);
    for (const item of models) {
      const modelSlug = `${provider.id}::${item.model}`;
      allModels.push({
        slug: modelSlug,
        display_name: `${provider.name} / ${item.model}`,
        model_provider_ref: provider.id,
        // ... 其余字段与现有 generateCodexModelCatalog 相同
        priority: priority++,
        // ...
      });
    }
  }

  return { models: allModels };
}
```

- [ ] **Step 3: 更新所有调用 writeCodexConfig 的地方**

`providers.ts` 中 `applyProviderToApp` 改为 `writeCodexConfig(virtualAccount)`（不再传 provider）
`providers.ts` 中 toggle 端点同理
`providers.ts` 中 switch 端点同理

- [ ] **Step 4: 编译 + 测试**

---

### Task 2: 新增 /proxy/codex/router/v1 端点

**Files:**
- Modify: `backend/src/routes/codexProxy.ts`

- [ ] **Step 1: 新增路由端点**

```typescript
// 路由 API：智能选择上游
router.post('/codex/router/v1/responses', async (req: Request, res: Response) => {
  // JWT 验证（与直连相同）
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    res.status(401).json({ error: { type: 'authentication_error', message: auth.message || 'Unauthorized' } });
    return;
  }

  // 智能路由：选择第一个可用的 Provider（或根据 JWT user_id 选择）
  const allProviders = db.getAllProviders();
  const codexProviders = allProviders.filter(p => {
    const extra = parseProviderExtra(p);
    return extra.codex?.models?.length > 0 || extra.codex?.defaultModel;
  });

  if (codexProviders.length === 0) {
    res.status(500).json({ error: { message: 'No available providers' } });
    return;
  }

  // 简单策略：用请求中的 model slug 匹配 provider
  const requestedModel = req.body?.model || '';
  const [providerId] = requestedModel.split('::');
  const provider = providerId ? db.getProviderById(providerId) : codexProviders[0];

  if (!provider) {
    res.status(400).json({ error: { message: `Unknown provider: ${providerId}` } });
    return;
  }

  // 覆盖 req.params.providerId，复用现有 handleCodexResponses
  req.params.providerId = provider.id;
  await handleCodexResponses(req, res);
});

router.post('/codex/router/v1/responses/compact', async (req: Request, res: Response) => {
  // 同上
});

router.get('/codex/router/v1/models', (req: Request, res: Response) => {
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    res.status(401).json({ error: { message: auth.message || 'Unauthorized' } });
    return;
  }

  // 返回所有 Provider 的所有模型
  const allProviders = db.getAllProviders();
  const allModels: any[] = [];
  for (const p of allProviders) {
    const { models } = codexModels(p);
    for (const m of models) {
      allModels.push({
        id: `${p.id}::${m.model}`,
        name: `${p.name} / ${m.displayName || m.model}`,
        model: `${p.id}::${m.model}`,
        provider: 'custom',
        wire_api: 'responses',
        tools: true,
        parallel_tool_calls: m.supportsParallelToolCalls ?? true,
        context_window: Number(m.contextWindow) || 128000,
        input_modalities: m.inputModalities || ['text'],
      });
    }
  }
  res.json({ models: allModels });
});
```

- [ ] **Step 2: 编译 + 测试**

---

### Task 3: toggle 端点加 configChanges 记录

**Files:**
- Modify: `backend/src/routes/providers.ts`

- [ ] **Step 1: 在 toggle 中加记录**

```typescript
import { configChangeStore } from '../services/configChanges.js';
import path from 'path';
import { GLOBAL_HOME_DIR } from '../config.js';

// 在 toggle 端点 writeCodexConfig 调用后：
configChangeStore.record(
  path.join(GLOBAL_HOME_DIR, '.codex', 'auth.json'),
  { virtual_account: enabled ? 'enabled' : 'disabled' }
);
```

---

### Task 4: 前端虚拟账号状态同步

**Files:**
- Modify: `frontend/src/components/StatusOverview.vue`

- [ ] **Step 1: 从后端 API 读取初始状态**

当前 `virtualAccountEnabled` 初始值是 `ref(false)`，没有从后端同步。需要在 `onMounted` 或通过 props 从 status API 获取。

但由于 `AppStatus` 没有在前端 status API 返回中包含 `virtual_account_enabled`，需要：
1. 要么在前端加一个独立的 API 调用获取状态
2. 要么在 status API 中返回该字段

选择方案 2——修改 `providers.ts` 的 `/api/status` 端点，返回 `virtual_account_enabled`：

```typescript
statuses[s.app_type] = {
  // ... 现有字段
  virtual_account_enabled: db.getAppStatus(s.app_type)?.virtual_account_enabled ?? false,
};
```

前端：
```typescript
// 从 statuses prop 中读取
const virtualAccountEnabled = computed(() => 
  props.statuses['codex']?.virtual_account_enabled ?? false
);
```

- [ ] **Step 2: 去掉乐观更新，改为依赖 props**

因为状态现在从后端 props 来，toggle 成功后 emit('refresh') 让父组件重新加载数据即可。

---

### Task 5: 端到端验证

- [ ] **Step 1: 构建 + 启动 + 测试完整流程**

1. 确认所有 Provider 写入 config.toml
2. 确认 model_catalog 聚合所有模型
3. 确认直连 API 正常工作
4. 确认路由 API 正常工作
5. 确认虚拟账号开关控制 JWT 验证
6. 确认 configChanges 记录虚拟账号状态变更
7. 确认前端开关状态与后端同步
