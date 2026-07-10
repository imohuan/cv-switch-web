# 虚拟账号功能集成实现计划（方案二 · 修订版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 StatusOverview.vue 中已有的虚拟账号开关真正工作——全局开关，打开时写伪造 auth.json（假 JWT），关闭时恢复。不绑定 Provider/Profile，独立于现有切换流程。

**Architecture:** 方案二，基于现有路由机制扩展。虚拟账号是全局叠加层：
- 状态存在 db AppStatus 新增的 `virtual_account_enabled` 字段
- 开关 toggle 时更新 db 状态 + 调 writeCodexConfig() 直接写 auth.json
- writeCodexConfig() 新增可选参数 `virtualAccount`，决定 auth.json 写假 JWT 还是普通 key
- Provider 切换/apply 时也传这个参数，保证全局状态一致

**Tech Stack:** Node.js / Express / TypeScript (backend), Vue 3 + TypeScript (frontend)

**改哪些文件：**
- `backend/src/db.ts` — AppStatus 加 `virtual_account_enabled`，新增 `setVirtualAccountEnabled()`
- `backend/src/services/codex.ts` — writeCodexConfig() 加 `virtualAccount` 参数
- `backend/src/routes/providers.ts` — switch/apply/clear 时传 virtualAccount 参数；新增 toggle 端点
- `frontend/src/api.ts` — 新增 toggle 方法
- `frontend/src/components/StatusOverview.vue` — 开关对接后端

---

## 文件结构

```
backend/src/db.ts                     ← AppStatus 加字段，新增 setVirtualAccountEnabled()
backend/src/services/codex.ts         ← writeCodexConfig(provider, virtualAccount?)
backend/src/routes/providers.ts       ← 所有调用点传参 + 新增 toggle 端点
frontend/src/api.ts                   ← toggleVirtualAccount()
frontend/src/components/StatusOverview.vue ← 开关对接
```

---

### Task 1: db.ts AppStatus 加 virtual_account_enabled 字段

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: 修改 AppStatus 接口和 setCurrentProvider，新增 setVirtualAccountEnabled**

把：

```typescript
export interface AppStatus {
  app_type: string;
  current_provider_id: string | null;
  updated_at: string;
}
```

改为：

```typescript
export interface AppStatus {
  app_type: string;
  current_provider_id: string | null;
  virtual_account_enabled: boolean;
  updated_at: string;
}
```

把 `setCurrentProvider` 函数里构造 updated 的那行：

```typescript
const updated: AppStatus = { app_type: appType, current_provider_id: providerId, updated_at: now() };
```

改为（保留已有的 virtual_account_enabled）：

```typescript
const existingStatus = getAppStatus(appType);
const updated: AppStatus = {
  app_type: appType,
  current_provider_id: providerId,
  virtual_account_enabled: existingStatus?.virtual_account_enabled ?? false,
  updated_at: now(),
};
```

然后在该函数下方新增：

```typescript
export function setVirtualAccountEnabled(appType: string, enabled: boolean): AppStatus {
  const status = getAppStatus(appType);
  const updated: AppStatus = {
    app_type: appType,
    current_provider_id: status?.current_provider_id ?? null,
    virtual_account_enabled: enabled,
    updated_at: now(),
  };
  store.app_status = status
    ? store.app_status.map((item) => item.app_type === appType ? updated : item)
    : [...store.app_status, updated];
  saveStore();
  return updated;
}
```

在 `export default {` 对象里加一行：

```typescript
  setVirtualAccountEnabled,
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd D:\Code\Git\cv-switch-web\backend && npx tsc --noEmit`

Expected: 可能会报 `normalizeStore` 里构造 AppStatus 缺少 `virtual_account_enabled`，需要修。

找到 `normalizeStore` 函数里的这行：

```typescript
store.app_status.push({ app_type, current_provider_id: null, updated_at: now() });
```

改为：

```typescript
store.app_status.push({ app_type, current_provider_id: null, virtual_account_enabled: false, updated_at: now() });
```

再跑一次 `npx tsc --noEmit`，确认无类型错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat: add virtual_account_enabled to AppStatus"
```

---

### Task 2: writeCodexConfig() 加 virtualAccount 参数

**Files:**
- Modify: `backend/src/services/codex.ts`

- [ ] **Step 1: 改函数签名和 auth.json 写入逻辑**

函数签名从：

```typescript
export function writeCodexConfig(provider: Provider): { success: boolean; message: string } {
```

改为：

```typescript
export function writeCodexConfig(provider: Provider, virtualAccount = false): { success: boolean; message: string } {
```

然后把 auth.json 写入部分（约第 42-47 行）：

```typescript
    // 1. Write auth.json（保留已有 key，兼容旧版 Codex）
    const auth: Record<string, string> = {};
    if (fs.existsSync(CODEX_AUTH_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, 'utf-8'));
        Object.assign(auth, existing);
      } catch { /* ignore parse errors */ }
    }
    auth['OPENAI_API_KEY'] = apiKey;

    writeTrackedConfigFile(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), { api_key: apiKey });
```

替换为：

```typescript
    // 1. Write auth.json
    if (virtualAccount) {
      // ── 虚拟账号模式：写完整假 JWT ──
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
      // ── 普通模式 ──
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
```

- [ ] **Step 2: 验证编译**

Run: `cd D:\Code\Git\cv-switch-web\backend && npx tsc --noEmit`

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/codex.ts
git commit -m "feat: add virtualAccount param to writeCodexConfig for fake JWT auth.json"
```

---

### Task 3: providers.ts 所有调用点传 virtualAccount 参数 + 新增 toggle 端点

**Files:**
- Modify: `backend/src/routes/providers.ts`

- [ ] **Step 1: 修改 applyProviderToApp()，传 virtualAccount 参数**

把：

```typescript
function applyProviderToApp(appType: string, provider: db.Provider): { success: boolean; message: string } {
  switch (appType) {
    case 'codex': return writeCodexConfig(provider);
    case 'claude': return writeClaudeConfig(provider);
    case 'gemini': return writeGeminiConfig(provider);
    case 'opencode': return writeOpenCodeConfig(provider);
    default: return { success: false, message: `Unknown app type: ${appType}` };
  }
}
```

改为：

```typescript
function applyProviderToApp(appType: string, provider: db.Provider): { success: boolean; message: string } {
  // Codex 读取全局虚拟账号状态
  const codexStatus = appType === 'codex' ? db.getAppStatus('codex') : undefined;
  const virtualAccount = codexStatus?.virtual_account_enabled ?? false;

  switch (appType) {
    case 'codex': return writeCodexConfig(provider, virtualAccount);
    case 'claude': return writeClaudeConfig(provider);
    case 'gemini': return writeGeminiConfig(provider);
    case 'opencode': return writeOpenCodeConfig(provider);
    default: return { success: false, message: `Unknown app type: ${appType}` };
  }
}
```

- [ ] **Step 2: 在 providers.ts 末尾（export default 之前）新增 toggle 端点**

```typescript
// ── 虚拟账号 toggle（全局，仅 Codex） ──

router.post('/codex/virtual-account/toggle', (req: Request, res: Response) => {
  try {
    const enabled = req.body?.enabled === true;

    // 更新全局虚拟账号状态
    const updatedStatus = db.setVirtualAccountEnabled('codex', enabled);

    // 如果 Codex 当前已连接 Provider，立即重新写 auth.json
    if (updatedStatus.current_provider_id) {
      const provider = db.getProviderById(updatedStatus.current_provider_id);
      if (provider) {
        const result = writeCodexConfig(provider, enabled);
        res.json({
          success: result.success,
          message: enabled ? '虚拟账号已启用' : '虚拟账号已禁用',
          data: { enabled },
        });
        return;
      }
    }

    // 没连 Provider，只更新状态
    res.json({
      success: true,
      message: enabled ? '虚拟账号状态已设为启用（未连接 Provider）' : '虚拟账号状态已设为禁用',
      data: { enabled },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 3: 验证编译**

Run: `cd D:\Code\Git\cv-switch-web\backend && npx tsc --noEmit`

Expected: 无新增类型错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/providers.ts
git commit -m "feat: wire virtualAccount param through applyProviderToApp; add toggle endpoint"
```

---

### Task 4: 前端 API 加 toggle 方法

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: 在 api 对象末尾添加**

```typescript
  // 虚拟账号 toggle
  toggleVirtualAccount: (enabled: boolean) =>
    request<{ enabled: boolean }>('/codex/virtual-account/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
```

- [ ] **Step 2: 验证前端编译**

Run: `cd D:\Code\Git\cv-switch-web\frontend && npx vue-tsc --noEmit`

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add toggleVirtualAccount to frontend API"
```

---

### Task 5: StatusOverview.vue 开关对接后端

**Files:**
- Modify: `frontend/src/components/StatusOverview.vue`

- [ ] **Step 1: 改造 script**

把：

```typescript
const virtualAccountEnabled = ref(false)
```

改为：

```typescript
const virtualAccountEnabled = ref(false)
const virtualAccountLoading = ref(false)

async function handleToggleVirtualAccount(enabled: boolean) {
  virtualAccountLoading.value = true
  try {
    const res = await api.toggleVirtualAccount(enabled)
    if (res.success) {
      virtualAccountEnabled.value = enabled
      triggerNotify(res.message || (enabled ? '虚拟账号已启用' : '虚拟账号已禁用'), 'success')
      emit('refresh')
    } else {
      triggerNotify(res.error || '操作失败', 'error')
    }
  } catch (e: any) {
    triggerNotify(e.message || '操作失败', 'error')
  } finally {
    virtualAccountLoading.value = false
  }
}
```

模板中把：

```html
<AxSwitch v-model="virtualAccountEnabled" size="md" />
```

改为：

```html
<AxSwitch
  :model-value="virtualAccountEnabled"
  :disabled="virtualAccountLoading"
  size="md"
  @update:model-value="handleToggleVirtualAccount"
/>
```

- [ ] **Step 2: 验证前端编译**

Run: `cd D:\Code\Git\cv-switch-web\frontend && npx vue-tsc --noEmit`

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StatusOverview.vue
git commit -m "feat: connect virtual account switch to backend toggle API"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 启动服务**

```bash
# 终端 1
cd D:\Code\Git\cv-switch-web\backend && npx tsx src/index.ts
# 终端 2
cd D:\Code\Git\cv-switch-web\frontend && npx vite --port 5210
```

- [ ] **Step 2: 完整流程**

浏览器 `http://localhost:5210`：

1. Codex tab 先连一个 Provider
2. 打开虚拟账号开关 → 提示"虚拟账号已启用"
3. 终端 `cat ~/.codex/auth.json` → 确认是假 JWT
4. 切到另一个 Provider → auth.json 应该更新但保持虚拟账号模式（因为全局状态）
5. 关闭虚拟账号 → auth.json 恢复普通 OPENAI_API_KEY
6. 断开 Codex → 再开虚拟账号 → 提示"未连接 Provider"但仍更新状态
7. 再连 Provider → auth.json 自动变成假 JWT

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: virtual account e2e verification"
```

---

## 自审

**1. 规格覆盖：**
- 全局状态 → Task 1 (AppStatus.virtual_account_enabled)
- auth.json 假 JWT → Task 2 (writeCodexConfig virtualAccount 参数)
- 切换 Provider 时保持状态 → Task 3 (applyProviderToApp 读全局状态)
- toggle 端点 → Task 3
- 前端对接 → Task 4 + 5
- 验证 → Task 6

**2. 无占位符：** 所有步骤含完整代码。

**3. 类型一致性：**
- `virtual_account_enabled` 在 Task 1 db.ts、Task 3 providers.ts、Task 5 StatusOverview.vue 中一致
- `writeCodexConfig(provider, virtualAccount)` 签名在 Task 2 定义，Task 3 调用一致
- `/codex/virtual-account/toggle` 路径在 Task 3/4/5 中一致
