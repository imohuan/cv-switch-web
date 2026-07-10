## 真相大白

你说得对，我之前被源码误导了。**功能确实都实现了，只是不在那个 Git 仓库里。** 运行中的 `AiMaMi.exe`（26444 进程）正在监听 `127.0.0.1:25817`，所有中转功能都在正常工作。源码仓库只是这个项目的**开源部分**（账号管理、MCP、Skills 等），核心的中转/路由逻辑在编译后的二进制里，没有开源。

下面基于你机器上的**实际数据**，完整解释两个问题：

---

## 一、"虚拟账号"是怎么骗过 Codex 登录的

看 `C:\Users\Administrator\.codex\auth.json`，这就是那个"虚拟账号"：

```json
{
  "aimami_router_unlock_auth": true,
  "auth_mode": "chatgpt",
  "axonhub_note": "AiMaMi router unlock auth. This is not a real OpenAI account.",
  "tokens": {
    "access_token": "eyJ...aimami-router-unlock",
    "id_token": "eyJ...aimami-router-unlock",
    "refresh_token": "aimami-router-unlock-refresh-token"
  },
  "OPENAI_API_KEY": "PROXY_MANAGED"
}
```

**原理很简单：**

1. **伪造 JWT**：`access_token` 和 `id_token` 的 payload 解码出来是：
   - `email`: `niuniu@woyao.pro`
   - `name`: `NIUNIU WOYAO`
   - `user_id`: `user-niuniu-woyao-pro-unlock`
   - `plan_type`: `free`
   - 签名部分是 `aimami-router-unlock`（假的，根本不是 OpenAI 签发的）

2. **骗 Codex 的三个关键字段**：
   - `auth_mode: "chatgpt"` → Codex 认为你是 ChatGPT 登录
   - `access_token` / `id_token` → Codex 本地解析 JWT payload 提取用户信息，**它不验证签名**（签名只在首次登录时由 OpenAI 服务器验证）
   - `OPENAI_API_KEY: "PROXY_MANAGED"` → 告诉 Codex 这个 API key 是代理管理的

3. **Codex 为什么接受它**：
   - Codex 启动时读 `auth.json`，解析 JWT payload（不验签），提取 `user_id`、`email`、`plan_type`
   - 然后 Codex 用 `access_token` 去 OpenAI API 验证——但此时**请求已经被 AiMaMi 的本地代理（127.0.0.1:25817）拦截了**
   - 本地代理返回"验证通过"，Codex 就认为已登录

4. **关键：`requires_openai_auth = true`**

   看 config.toml 里 `aimai1` 这个 provider：
   ```toml
   [model_providers.aimai1]
   name = "AiMaMi 智能路由"
   base_url = "http://127.0.0.1:25817/codex/router/v1"
   requires_openai_auth = true    # ← 这个很关键
   ```

   `requires_openai_auth = true` 的意思是：Codex 会带着真实的 OpenAI auth header（从 `auth.json` 的 access_token 来）去请求 `127.0.0.1:25817`。本地代理收到后：
   - 读到 JWT 里的 user_id，知道"这是哪个虚拟用户"
   - **剥离** OpenAI auth，换成真正上游（pixelstarrysky / 🐱 / LocalNewApi）的 API key
   - 转发到上游，拿到回复后返回给 Codex

   所以虚拟账号的角色就是：**给 Codex 一个"看起来合法的身份"，让 Codex 愿意发起 API 请求，然后本地代理接管请求、换 key、转发。**

---

## 二、config.toml 的中转配置规则

你看到的 `config-aimai1.toml` 里有两段 AiMaMi 托管的内容，用注释标记了边界：

### 顶部路由段（`aimami-relay codex-router top`）

```toml
# >>> aimami-relay codex-router top start (DO NOT EDIT MANUALLY)
model_provider = "aimai1"
model_catalog_json = "C:\\Users\\Administrator\\.codex\\codexmate\\relay\\codex_router_catalog.json"
# <<< aimami-relay codex-router top end
```

这两个顶层配置的作用：
- **`model_provider = "aimai1"`**：把 Codex 的默认模型提供者指向 `aimai1`（AiMaMi 智能路由），这样 Codex 启动后所有请求都走 `127.0.0.1:25817/codex/router/v1`
- **`model_catalog_json`**：指向 AiMaMi 生成的模型目录 JSON 文件，这个文件列出了所有中转模型（gpt-5.5、deepseek-v4-pro、claude-opus-4-8 等），Codex 读取后会在模型选择菜单里显示这些模型

### 底部 Provider 段（`aimami-relay managed`）

```toml
# >>> aimami-relay managed start (DO NOT EDIT MANUALLY)

[model_providers.aimami_relay_779dfe7f77]
name = "pixelstarrysky"
base_url = "http://127.0.0.1:25817/codex/by-provider/aimami_relay_779dfe7f77/v1"
wire_api = "responses"
supports_websockets = false
api_key = "aimami-relay"
requires_openai_auth = false

[profiles.aimami_relay_779dfe7f77]
model_provider = "aimami_relay_779dfe7f77"
model = "gpt-5.5"

[model_providers.aimami_relay_0ad43e08b0]
name = "🐱"
base_url = "http://127.0.0.1:25817/codex/by-provider/aimami_relay_0ad43e08b0/v1"
wire_api = "responses"
api_key = "aimami-relay"
requires_openai_auth = false

[profiles.aimami_relay_0ad43e08b0]
model_provider = "aimami_relay_0ad43e08b0"
model = "deepseek-v4-pro"

[model_providers.aimai1]
name = "AiMaMi 智能路由"
base_url = "http://127.0.0.1:25817/codex/router/v1"
requires_openai_auth = true     # ← 路由模式：带 OpenAI auth，由代理决定转发到哪个上游

[profiles.aimai1]
model_provider = "aimai1"
model = "aimami_relay_779dfe7f77"

# <<< aimami-relay managed end
```

### 规则总结：

| 概念 | 说明 |
|---|---|
| **`model_providers`** | 定义"上游供应商"。每个 provider 有 `base_url`（实际指向 `127.0.0.1:25817`）、`wire_api`（responses/chat）、`api_key` |
| **`profiles`** | 定义"模型选择"。每个 profile 绑定一个 provider + 一个具体 model 名 |
| **路由模式** (`aimai1`) | `requires_openai_auth = true` → 代理收到请求后**智能路由**，根据负载/可用性选择上游 |
| **直连模式** (`aimami_relay_*`) | `requires_openai_auth = false` → 代理直接转发到固定上游，不做路由决策 |
| **`model_catalog_json`** | AiMaMi 生成的模型菜单，Codex 读取后显示可选模型列表 |

### 请求流程：

```
Codex 桌面
  │
  ├─ 模型选择: gpt-5.5 (aimami_relay_779dfe7f77)
  │   └─ POST http://127.0.0.1:25817/codex/by-provider/aimami_relay_779dfe7f77/v1
  │       └─ AiMaMi 代理 → 换 pixelstarrysky 的 key → https://pixelstarrysky.xyz/
  │
  ├─ 模型选择: deepseek-v4-pro (aimami_relay_0ad43e08b0)  
  │   └─ POST http://127.0.0.1:25817/codex/by-provider/aimami_relay_0ad43e08b0/v1
  │       └─ AiMaMi 代理 → 换 🐱 的 key → http://newapi.imohuan.shop/v1
  │
  └─ 模型选择: AiMaMi 智能路由 (aimai1)
      └─ POST http://127.0.0.1:25817/codex/router/v1
          └─ AiMaMi 代理 → 根据 state.json 里的 activeByIde 决定 → pixelstarrysky 或 🐱
```

**这就是全部机制：虚拟账号给 Codex 一个假身份让它愿意工作，config.toml 把所有 API 请求指向 `127.0.0.1:25817`，本地代理（AiMaMi.exe 进程 26444）拦截请求、换上游 key、转发。** Codex 完全不知道自己在跟中转服务对话。