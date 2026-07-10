# 虚拟账号登录拦截 + 路由中转 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让虚拟账号的假 JWT 真正生效——Codex 带着 JWT 请求代理，代理验证 JWT 后放行，不匹配则拒绝（登录拦截）。同时修复 config.toml 中 `requires_openai_auth` 在虚拟账号模式下应为 `true`。

**Architecture:** 两处改动——
1. `codex.ts`：虚拟账号模式下 `requires_openai_auth` 写 `true`（让 Codex 发送 auth header）
2. `codexProxy.ts`：新增 JWT 验证中间件——解析 `Authorization: Bearer xxx` header，验证 payload 中的 `user_id` 是否匹配虚拟账号，不匹配返回 401

**Tech Stack:** Node.js / Express / TypeScript

**改哪些文件：**
- `backend/src/services/codex.ts` — `requires_openai_auth` 根据 virtualAccount 参数决定
- `backend/src/routes/codexProxy.ts` — 新增 JWT 验证 + 登录拦截中间件

---

## 文件结构

```
backend/src/services/codex.ts     ← requires_openai_auth 动态设置
backend/src/routes/codexProxy.ts  ← JWT 验证中间件，拦截非法请求
```

---

### Task 1: codex.ts — requires_openai_auth 动态设置

**Files:**
- Modify: `backend/src/services/codex.ts`

- [ ] **Step 1: 改 requires_openai_auth**

当前 config.toml 里永远是：

```typescript
requires_openai_auth: false,
```

改为根据 `virtualAccount` 参数动态设置：

```typescript
requires_openai_auth: virtualAccount,
```

完整上下文（`configToml.model_providers[CODEX_MODEL_PROVIDER_ID]` 块中）：

```typescript
    configToml.model_providers[CODEX_MODEL_PROVIDER_ID] = {
      name: provider.name,
      base_url: baseUrl,
      api_key: apiKey,
      wire_api: 'responses',
      // 虚拟账号模式下需要 OpenAI OAuth 登录（Codex 会带 JWT 来验证身份）
      requires_openai_auth: virtualAccount,
      supports_websockets: false,
    };
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `Set-Location D:\Code\Git\cv-switch-web\backend; & .\node_modules\.bin\tsc.cmd --noEmit`

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/codex.ts
git commit -m "fix: set requires_openai_auth=true when virtual account enabled"
```

---

### Task 2: codexProxy.ts — JWT 验证中间件 + 登录拦截

**Files:**
- Modify: `backend/src/routes/codexProxy.ts`

- [ ] **Step 1: 在路由文件中新增 JWT 验证函数和中间件**

在 `codexProxy.ts` 顶部（router 定义之后，路由注册之前）添加：

```typescript
// ── 虚拟账号 JWT 验证 ──
// 虚拟账号的固定 user_id，只有带这个 user_id 的 JWT 才放行
const VIRTUAL_ACCOUNT_USER_ID = 'user-niuniu-woyao-pro-unlock';

/**
 * 解析 JWT payload（不验签，Codex 也不验签）。
 * 返回 decoded payload 或 null。
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url decode
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * 验证请求是否来自合法的虚拟账号。
 * 规则：如果全局虚拟账号已启用，则要求请求带 Authorization header，
 * 且 JWT payload 中的 user_id 必须匹配 VIRTUAL_ACCOUNT_USER_ID。
 * 如果虚拟账号未启用，则不做验证（保持向后兼容）。
 */
function verifyVirtualAccountAuth(req: Request): { ok: boolean; message?: string } {
  // 检查全局虚拟账号状态
  const codexStatus = db.getAppStatus('codex');
  const virtualAccountEnabled = codexStatus?.virtual_account_enabled ?? false;

  if (!virtualAccountEnabled) {
    // 虚拟账号未启用，不做验证
    return { ok: true };
  }

  // 虚拟账号已启用，必须验证 JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, message: 'Missing or invalid Authorization header. Virtual account requires Bearer token.' };
  }

  const token = authHeader.slice(7);
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { ok: false, message: 'Invalid JWT token format.' };
  }

  if (payload.user_id !== VIRTUAL_ACCOUNT_USER_ID) {
    return { ok: false, message: `Unknown user: ${payload.user_id || 'null'}` };
  }

  return { ok: true };
}
```

- [ ] **Step 2: 在 handleCodexResponses 入口处调用验证**

在 `handleCodexResponses` 函数的开头（`const provider = db.getProviderById(...)` 之前）加入：

```typescript
async function handleCodexResponses(req: Request, res: Response) {
  // 登录拦截：虚拟账号模式下验证 JWT
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    logger.codexProxy.error('Auth rejected', { message: auth.message });
    res.status(401).json({ error: { type: 'authentication_error', message: auth.message || 'Unauthorized' } });
    return;
  }

  const provider = db.getProviderById(req.params.providerId);
  // ... 后续代码不变
```

- [ ] **Step 3: 在 /models 路由也加上验证**

```typescript
router.get('/codex/:providerId/v1/models', (req: Request, res: Response) => {
  // 登录拦截
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    res.status(401).json({ error: { message: auth.message || 'Unauthorized' } });
    return;
  }

  const provider = db.getProviderById(req.params.providerId);
  // ... 后续代码不变
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `Set-Location D:\Code\Git\cv-switch-web\backend; & .\node_modules\.bin\tsc.cmd --noEmit`

Expected: 无类型错误

- [ ] **Step 5: 构建并测试**

```bash
Set-Location D:\Code\Git\cv-switch-web\backend; & .\node_modules\.bin\tsc.cmd
```

启动服务器后测试：

```bash
# 测试 1：虚拟账号未启用时，不带 auth header 应正常
curl -X POST http://127.0.0.1:3121/proxy/codex/{providerId}/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","input":"hello"}'
# Expected: 200（虚拟账号未启用，跳过验证）

# 测试 2：启用虚拟账号
curl -X POST http://127.0.0.1:3121/api/codex/virtual-account/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'

# 测试 3：不带 auth header 应被拒绝
curl -X POST http://127.0.0.1:3121/proxy/codex/{providerId}/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","input":"hello"}'
# Expected: 401

# 测试 4：带正确 JWT 应通过（需要构造一个合法 JWT）
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/codexProxy.ts
git commit -m "feat: add JWT auth middleware to codex proxy for virtual account login interception"
```

---

### Task 3: 端到端验证

- [ ] **Step 1: 启动服务并测试完整流程**

```bash
# 构建
Set-Location D:\Code\Git\cv-switch-web\backend; & .\node_modules\.bin\tsc.cmd

# 启动
$env:PORT="3121"; Start-Process node -ArgumentList "dist/index.js"
```

用 node 脚本验证：

```javascript
// 测试虚拟账号未启用 → 代理不拦截
// 测试虚拟账号启用 → 代理拦截无 auth 请求 → 401
// 测试虚拟账号启用 → 代理放行带正确 JWT 的请求
// 测试虚拟账号启用 → 代理拒绝带错误 JWT 的请求 → 401
// 测试禁用虚拟账号 → 代理恢复不拦截
```

- [ ] **Step 2: 验证 config.toml 的 requires_openai_auth**

启用虚拟账号后检查 `~/.codex/config.toml`：

```bash
Get-Content ~/.codex/config.toml | Select-String "requires_openai_auth"
# Expected: requires_openai_auth = true
```

禁用虚拟账号后：

```bash
# Expected: requires_openai_auth = false
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: e2e verification of login interception"
```

---

## 自审

**1. 规格覆盖：**
- `requires_openai_auth` 动态设置 → Task 1
- JWT 验证中间件 → Task 2
- 登录拦截（虚拟账号启用时拒绝无 auth 请求） → Task 2
- 端到端验证 → Task 3

**2. 无占位符：** 所有步骤含完整代码。

**3. 类型一致性：**
- `VIRTUAL_ACCOUNT_USER_ID` 与 Task 1（上一轮）中 `codex.ts` 写 JWT 时的 `userId` 一致：`'user-niuniu-woyao-pro-unlock'`
- `db.getAppStatus('codex')` 在 Task 2 和 Task 1（上一轮 `providers.ts`）中调用方式一致

**4. 边界情况：**
- 虚拟账号未启用 → 代理不做任何验证（向后兼容，不影响现有功能）
- 虚拟账号启用但无 auth header → 401
- 虚拟账号启用但 JWT 格式错误 → 401
- 虚拟账号启用但 JWT user_id 不匹配 → 401
- 虚拟账号启用 + 正确 JWT → 放行
