# 虚拟账号修复计划：configChanges 历史记录 + 架构梳理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个问题——
1. 虚拟账号 toggle 操作未记录到 configChanges 历史
2. 澄清"2 个 API"的架构含义并确保实现正确

**Architecture:** 
- configChanges：在 toggle 端点中显式调用 configChangeStore.record，记录虚拟账号状态变更
- 架构：当前已有 AiMaMi 的 provider 在 config.toml 中，custom provider 是叠加层。核心问题不是"少 provider"，而是 configChanges 没记录 toggle 操作

**Tech Stack:** TypeScript / Express

**改哪些文件：**
- `backend/src/routes/providers.ts` — toggle 端点中加 configChanges 记录

---

### Task 1: toggle 端点加 configChanges 历史记录

**Files:**
- Modify: `backend/src/routes/providers.ts`

- [ ] **Step 1: 在 toggle 端点中导入 configChangeStore 并记录变更**

在 providers.ts 顶部 import 区加：

```typescript
import { configChangeStore } from '../services/configChanges.js';
```

在 toggle 端点中，`writeCodexConfig` 调用成功后加记录：

找到 toggle 端点中这段：
```typescript
        const result = writeCodexConfig(provider, enabled);
        res.json({
          success: result.success,
          message: enabled ? '虚拟账号已启用' : '虚拟账号已禁用',
          data: { enabled },
        });
```

改为：
```typescript
        const result = writeCodexConfig(provider, enabled);
        if (result.success) {
          // 记录虚拟账号状态变更到历史
          const authPath = path.join(GLOBAL_HOME_DIR, '.codex', 'auth.json');
          configChangeStore.record(authPath, {
            virtual_account: enabled ? 'enabled' : 'disabled',
            user_id: 'user-niuniu-woyao-pro-unlock',
          });
        }
        res.json({
          success: result.success,
          message: enabled ? '虚拟账号已启用' : '虚拟账号已禁用',
          data: { enabled },
        });
```

同时在未连接 Provider 的分支也加记录：
```typescript
    // 没连 Provider，只更新状态
    res.json({
      success: true,
      message: enabled ? '虚拟账号状态已设为启用（未连接 Provider）' : '虚拟账号状态已设为禁用',
      data: { enabled },
    });
```

改为在 toggle 端点最外层（两个分支之后、catch 之前）统一记录，或者分别记录。最简单是在 `setVirtualAccountEnabled` 之后立刻记录。

- [ ] **Step 2: 编译验证**

Run: `Set-Location D:\Code\Git\cv-switch-web\backend; & .\node_modules\.bin\tsc.cmd --noEmit`

- [ ] **Step 3: Commit**

---

### Task 2: 架构说明 + 确认

**这不是代码改动，是分析确认。**

当前 config.toml 的架构：

```
model_provider = "custom"           ← 顶层，所有请求走 custom provider
                                     ↓
[model_providers.custom]            ← base_url → localhost:3120（你的代理）
  requires_openai_auth = true/false ← 虚拟账号开关控制

[model_providers.aimai1]            ← AiMaMi 路由模式（已存在，未被使用）
  requires_openai_auth = true
  base_url = 127.0.0.1:25817/codex/router/v1

[model_providers.aimami_relay_*]    ← AiMaMi 直连模式（已存在，未被使用）
  requires_openai_auth = false
```

"2 个 API"指的是 AiMaMi 的：
- `/codex/router/v1` — 路由 API，根据 state.json 智能选择上游
- `/codex/by-provider/{id}/v1` — 直连 API，固定转发到指定上游

这两个 API 由 AiMaMi.exe（端口 25817）提供，你的项目（端口 3120）通过 `/proxy/codex/{providerId}/v1` 提供类似功能。

**如果要做"2 个 API"模式，需要：** 虚拟账号开启时，`model_provider` 从 `"custom"` 切到 `"aimai1"`（走 AiMaMi 路由），或者你的代理也实现一个 `/proxy/codex/router/v1` 端点来做智能路由。

**当前状态：** 你的 custom provider 已经是"直连 API"，JWT 验证已加上。如果需要"路由 API"，需要确认是要走 AiMaMi 的路由还是自己实现。
