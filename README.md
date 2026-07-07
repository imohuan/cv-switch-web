# cv-switch-web

`cv-switch-web` 是一个本地 Web 面板，用于管理 Claude、Codex、Gemini、OpenCode 等 AI 工具的供应商配置、配置档案和代理路由。

它的发布形态是一个 npm CLI 包：通过 `npx` 启动本地服务，然后在浏览器中使用管理界面。

## 模块结构

```text
@axtools/cv-switch-web          # npm 发布包，也是唯一对外入口
├─ bin/server.mjs               # CLI 入口：start / stop / restart / kill
├─ backend                      # Express API，构建产物输出到 backend/dist
└─ frontend                     # Vue + Vite 前端，构建产物输出到 frontend/dist
```

职责边界：

- 根目录：负责 npm 发布、CLI 入口、workspace 编排。
- `backend`：负责 API、配置读写、代理路由和服务状态。
- `frontend`：负责浏览器管理界面。
- `backend` 和 `frontend` 只作为 pnpm workspace，不单独发布到 npm。

## 环境要求

- Node.js `>= 20`
- 本地开发使用 pnpm `>= 10`

## 快速启动

不需要全局安装，直接使用 `npx` 启动：

```bash
npx -y @axtools/cv-switch-web start
```

默认访问地址：

```text
http://localhost:8033
```

指定端口：

```bash
npx -y @axtools/cv-switch-web start --port 3000
```

停止服务：

```bash
npx -y @axtools/cv-switch-web stop
```

重启服务：

```bash
npx -y @axtools/cv-switch-web restart
```

清理所有已记录的 `cv-switch-web` 服务进程：

```bash
npx -y @axtools/cv-switch-web kill
```

## 全局安装

如果需要长期使用，也可以全局安装：

```bash
npm install -g @axtools/cv-switch-web
cv-switch-web start
```

## 本地开发

在项目根目录安装依赖：

```bash
pnpm install
```

分别启动后端和前端开发服务：

```bash
pnpm dev:backend
pnpm dev:frontend
```

默认开发地址：

```text
Backend   http://localhost:3120
Frontend  http://localhost:5210
```

构建完整发布产物：

```bash
pnpm build
```

构建结果：

```text
backend/dist    # 后端运行时代码
frontend/dist   # 前端静态资源
```

## npm 发布

发布前先确认构建和打包清单：

```bash
pnpm install
pnpm build
npm pack --dry-run
```

确认 `npm pack --dry-run` 中包含以下核心文件：

```text
bin/server.mjs
backend/dist/**
frontend/dist/**
package.json
README.md
```

发布公开 scoped 包：

```bash
npm publish --access public
```

发布后验证 npm registry 是否能解析：

```bash
npm view @axtools/cv-switch-web version --registry=https://registry.npmjs.org/
```

能返回版本号后，再验证真实安装启动链路：

```bash
npx -y @axtools/cv-switch-web start
```

## 运行时数据目录

CLI 会把运行状态、PID、端口记录和服务数据放到用户目录下：

```text
~/.axtools/cv-switch-web
```

这样做是为了兼容 `npx`：`npx` 可能使用临时包目录，如果把数据写在包目录里，后续运行时容易丢失。

## 常见问题

### `npx` 报 `E404 Not Found`

先直接查询 npm 官方 registry：

```bash
npm view @axtools/cv-switch-web version --registry=https://registry.npmjs.org/
```

如果仍然是 404，说明当前 registry 还不能安装这个包。常见原因：

- 包没有真正发布成功。
- 包发到了其他 registry。
- npm 账号没有该 scope 的权限。
- scoped 包被发布成了 private。
- npm registry 尚未完成同步。

检查本机 npm 配置：

```bash
npm config get registry
npm whoami
```

### 发布时出现 `bin[cv-switch-web] ... was invalid and removed`

这次发布不能视为可用 CLI 发布。

含义是：npm 发布时移除了可执行入口映射，导致下面的命令无法正确找到 CLI：

```bash
npx -y @axtools/cv-switch-web start
```

处理方式：先修复根 `package.json`，再重新构建、打包、升版本、发布。

```bash
npm pkg fix
pnpm build
npm pack --dry-run
npm version patch
npm publish --access public
```

根 `package.json` 必须保留有效的 `bin` 映射：

```json
{
  "bin": {
    "cv-switch-web": "bin/server.mjs"
  }
}
```

### 发布后 npm 页面存在，但 `npm view` 还是 404

以 `npm view` 和 registry API 为准，不以网页展示为准。

如果网页存在但 registry 404，优先排查：

```bash
npm view @axtools/cv-switch-web version --registry=https://registry.npmjs.org/
npm access ls-packages
npm owner ls @axtools/cv-switch-web
```

## 命令速查

```bash
# 临时启动
npx -y @axtools/cv-switch-web start

# 指定端口
npx -y @axtools/cv-switch-web start --port 3000

# 停止
npx -y @axtools/cv-switch-web stop

# 重启
npx -y @axtools/cv-switch-web restart

# 清理进程
npx -y @axtools/cv-switch-web kill

# 本地构建
pnpm build

# 发布前检查
npm pack --dry-run
```
