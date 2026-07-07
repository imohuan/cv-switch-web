# npm 发布指南 — @axtools/web2api

## 一、项目架构

```
web2api/
├── src/                    # Vue 3 前端（Vite + TailwindCSS + ECharts）
├── server/
│   ├── index.ts            # 后端入口：一体化 HTTP 服务（静态文件 + API）
│   ├── stockApi.ts         # westock-data CLI 桥接层（行情/K线/分时）
│   └── westock-data/       # 股票数据 CLI（3.3MB，不可修改的第三方工具）
├── bin/
│   └── server.mjs          # CLI 管理脚本（commander：start / stop / restart）
├── scripts/
│   └── build-server.mjs    # 后端编译脚本（esbuild API）
├── vite.config.ts          # 前端构建配置 + npmFontsPlugin（字体 CDN）
├── dist/                   # 构建产物（npm 发布目录）
│   ├── index.html
│   ├── assets/             # 前端 JS/CSS bundle
│   └── server/
│       └── index.js        # 编译后的后端（esbuild bundle）
└── package.json
```

### 前后端关系

| 层 | 技术 | 构建工具 | 产物 |
|----|------|---------|------|
| 前端 | Vue 3 SPA | Vite (Rolldown) | `dist/assets/*.js` + `dist/assets/*.css` |
| 后端 API | TypeScript (Node.js) | esbuild (bundle) | `dist/server/index.js` |
| 数据源 | westock-data CLI | 不构建（直接包含） | `server/westock-data/index.js` |

**关键点：前后端合并为一个 HTTP 服务**。`dist/server/index.js` 同时处理：

```
请求 ──→ /api/stock/*  →  stockApiMiddleware（调用 westock-data CLI）
    └──→ / 其他        →  静态文件服务（serve dist/）
```

## 二、构建流程

### 普通开发模式

```bash
# 前端 dev server（Vite HMR，端口 5180）
npm run dev

# 后端 dev server（tsx 热重载，端口 3180）
npm run dev:server

# 同时启动前后端
npm run dev:all
```

开发时 Vite 配置了 `/api/stock` 中间件代理，直接调用 `server/stockApi.ts`。

### npm 发布构建

```bash
npm run build:npm
```

等价于两步：

```bash
# 1. 前端构建（字体切 CDN）
vite build --mode npm
# 产物：dist/index.html + dist/assets/index-*.js + dist/assets/index-*.css

# 2. 后端编译
node scripts/build-server.mjs
# 产物：dist/server/index.js（单文件，包含 stockApi.ts + index.ts 全部逻辑）
```

**字体 CDN 机制（npmFontsPlugin）**：

`vite.config.ts` 中通过 Vite 的 `--mode npm` 触发。构建时自动将以下本地字体导入替换为 Google Fonts CDN：

```typescript
// 源码中的导入
import 'material-symbols/outlined.css'  // → Google Fonts CDN @import
import '@fontsource/geist/400.css'      // → Google Fonts CDN @import
import '@fontsource/jetbrains-mono/400.css' // → Google Fonts CDN @import
```

开发和普通构建不受影响，只有 `--mode npm` 才触发替换。这使包体积从 5.3MB 降至 1MB（不含 westock-data）。

**westock-data 路径自动检测（findWestockHome）**：

`server/stockApi.ts` 中的 `findWestockHome()` 自动检测两种运行模式：

```typescript
function findWestockHome(): string {
  const candidates = [
    path.resolve(__dirname, 'westock-data'),          // dev: server/westock-data
    path.resolve(__dirname, '../../server/westock-data'), // compiled: dist/server/ → ../../server/westock-data
  ]
  for (const c of candidates) {
    if (existsSync(path.join(c, 'index.js'))) return c
  }
  return candidates[0]
}
```

## 三、CLI 命令系统

### 技术选型

使用 `commander`（14.x）—— 它只用于解析命令行参数和子命令路由，不处理业务逻辑。

### 文件结构

```
bin/server.mjs     # 唯一的 CLI 入口
bin/.web2api.pid # 运行时 PID 文件（启动时创建，停止时删除）
```

### 命令实现

#### `start` — 后台启动服务

```javascript
// 核心逻辑：spawn 子进程运行编译后的后端
const child = spawn('node', [SERVER_SCRIPT, String(port)], {
  detached: true,     // 子进程独立于父进程
  stdio: 'ignore',    // 不捕获输出
  windowsHide: true,  // 不弹控制台窗口
})
child.unref()         // 父进程不阻塞，立即退出

await writePid(child.pid) // 写入 PID 文件
```

关键点：
- `detached: true` + `unref()`：父进程（CLI）退出后子进程继续运行
- PID 写入 `bin/.web2api.pid`，打印绝对路径
- 双重启动检测、stale PID 自动清理、EADDRINUSE 友好提示

#### `stop` — 停止服务

```javascript
// 读取 PID 文件 → 检查进程是否存在 → 发送 SIGTERM → 清理 PID 文件
const pid = await readPidFile()
process.kill(pid, 'SIGTERM')
await removePidFile()
```

#### `restart` — 重启服务

```javascript
// 先 tryStop()（静默停止，不关心是否真的在运行）
// 再 cmdStart()（正常启动）
const wasRunning = await tryStop()
await cmdStart(port)
```

### 用户使用

```bash
npx @axtools/web2api start              # 启动（端口 5180）
npx @axtools/web2api start --port 3000  # 自定义端口
npx @axtools/web2api stop               # 停止
npx @axtools/web2api restart            # 重启
npx @axtools/web2api                    # 显示帮助
```

## 四、npm 发布流程

### 4.1 创建 Access Token（一次性）

浏览器操作：

1. 打开 https://www.npmjs.com/settings/imohuan/tokens
2. 点 **Generate New Token** → 选 **Granular Access Token**
3. 权限设置：
   - **Permissions**: Read and write
   - **Packages and scopes**: Select packages → `@axtools/web2api`
   - **Security**: ✅ Bypass two-factor authentication (2FA)
4. 生成后复制 token（格式：`npm_xxxxxxxxxxxxxxxxxxxx`）

本地配置：

```bash
npm config set //registry.npmjs.org/:_authToken npm_你的token
```

验证：

```bash
npm whoami
# 输出: imohuan
```

### 4.2 发布

```bash
# 1. 确保已登录
npm whoami

# 2. 构建
npm run build:npm

# 3. 本地验证（可选）
npm pack          # 生成 .tgz 文件
tar -tzf axtools-web2api-1.0.0.tgz

# 4. 升级版本号
npm version patch   # 0.0.1 → 0.0.2
npm version minor   # 0.0.1 → 0.1.0
npm version major   # 0.0.1 → 1.0.0

# 5. 发布
npm publish --access public
```

### 4.3 验证发布结果

```bash
# 查看已发布的包信息
npm view @axtools/web2api

# 在其他目录测试安装
cd /tmp
npx @axtools/web2api start
```

## 五、package.json 关键配置

```json
{
  "name": "@axtools/web2api",        // scoped 包名
  "version": "1.0.0",
  "private": false,                      // 允许发布（private: true 会阻止发布）
  "type": "module",                      // ESM 模式

  "bin": {
    "web2api": "bin/server.mjs"        // CLI 入口（npx 自动识别）
  },

  "files": [
    "bin/",                              // CLI 脚本
    "dist/",                             // 构建产物（前端 + 后端）
    "server/westock-data/"               // 第三方股票数据 CLI
  ],

  "dependencies": {
    "commander": "^14.0.3"               // CLI 唯一运行时依赖
  }

  // 其他 18 个包（vue/echarts/tailwindcss 等）都是 devDependencies
  // → npx 安装时不下载，只在 build:npm 时使用
}
```

### 依赖分离原则

| 依赖类型 | 示例 | 发布时下载？ |
|---------|------|------------|
| `dependencies` | commander | ✅ 是（CLI 运行时需要） |
| `devDependencies` | vue, echarts, vite... | ❌ 否（仅构建时用） |

优点：`npx @axtools/web2api` 只下载 commander + 构建产物（~2MB），不下载几百 MB 的 Vue 生态。

## 六、CI/CD 发布自动化（可选）

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run build:npm
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 七、常见问题

### Q: 发布时报 403 需要 2FA

A: 创建 Granular Access Token 并勾选 "Bypass 2FA"，用 token 登录。

### Q: 包名已被占用

A: 用 scoped 包名 `@你的scope/xxx`。Scope 需要在 npmjs.com 上注册为 organization。

### Q: 字体不显示

A: npm 发布版字体走 Google Fonts CDN。确保能访问 `fonts.googleapis.com`。开发版用本地字体不受影响。

### Q: 股票数据 API 返回空

A: westock-data CLI 需要非交易时段或网络问题导致数据为空。CLI 启动时会检测并提示 westock-data 是否可用。
