#!/usr/bin/env node
/**
 * cv-switch-web CLI — Web API 管理脚本
 *
 *   start         后台启动服务（自动关闭旧服务）
 *   stop          停止服务
 *   restart       重启服务（先停后启）
 *   serve         前台运行服务（适合 systemd 托管）
 *   kill          杀死所有 cv-switch-web 端口进程
 *   help          显示帮助（默认）
 *
 * 实际服务由 backend/dist/index.js 提供，前端静态产物由 frontend/dist 提供。
 */
import { Command } from 'commander'
import { spawn, exec } from 'node:child_process'
import { request } from 'node:http'
import { readFile, writeFile, unlink, access, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PKG_JSON = join(ROOT, 'package.json')
const pkg = JSON.parse(await readFile(PKG_JSON, 'utf-8'))
const SERVER_SCRIPT = join(ROOT, 'backend', 'dist', 'index.js')

// ---- 持久化根目录（放用户目录，避免 npx 临时路径问题）----
const DEFAULT_RUNTIME_ROOT = join(homedir(), '.cv-switch-web')
let RUNTIME_ROOT = resolve(process.env.CV_SWITCH_ROOT_DIR || DEFAULT_RUNTIME_ROOT)

function expandHomeDir(value) {
  if (!value || value === '~') return value ? homedir() : value
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function configureRuntimeRoot(rootDir) {
  RUNTIME_ROOT = resolve(expandHomeDir(rootDir || process.env.CV_SWITCH_ROOT_DIR || DEFAULT_RUNTIME_ROOT))
}

function pidFile() {
  return join(RUNTIME_ROOT, '.pid')
}

function portsFile() {
  return join(RUNTIME_ROOT, '.ports')
}

function parsePort(value) {
  const port = parseInt(value, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    console.log('\n  \u2717 非法端口号，范围: 1-65535\n')
    process.exit(1)
  }
  return port
}

function getServerEnv(port) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_PATH: join(ROOT, 'node_modules'),
    CV_SWITCH_ROOT_DIR: RUNTIME_ROOT,
  }
}

async function ensureServerScript() {
  try {
    await access(SERVER_SCRIPT, constants.R_OK)
  } catch {
    console.log(`\n  \u2717 找不到服务脚本: ${SERVER_SCRIPT}`)
    console.log('  请先运行 pnpm build\n')
    process.exit(1)
  }
}

async function ensurePidDir() {
  try {
    await mkdir(RUNTIME_ROOT, { recursive: true })
  } catch { /* ignore */ }
}

// ---- 进程检查 ----
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---- PID 文件操作 ----
async function readPidFile() {
  const raw = await readFile(pidFile(), 'utf-8')
  return parseInt(raw.trim(), 10)
}

async function removePidFile() {
  try { await unlink(pidFile()) } catch { /* 不存在忽略 */ }
}

async function writePid(pid) {
  await ensurePidDir()
  await writeFile(pidFile(), String(pid))
}

// ---- 端口记录操作 ----
async function readPorts() {
  try {
    const raw = await readFile(portsFile(), 'utf-8')
    return raw.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
  } catch {
    return []
  }
}

async function writePorts(ports) {
  await ensurePidDir()
  const unique = [...new Set(ports)].sort((a, b) => a - b)
  await writeFile(portsFile(), unique.join('\n'))
}

async function addPort(port) {
  const ports = await readPorts()
  if (!ports.includes(port)) {
    ports.push(port)
    await writePorts(ports)
  }
}

async function removePort(port) {
  const ports = await readPorts()
  const filtered = ports.filter(p => p !== port)
  if (filtered.length !== ports.length) {
    await writePorts(filtered)
  }
}

// ---- 停止指定 PID ----
async function killPid(pid) {
  if (!pid || !isProcessRunning(pid)) return false
  try {
    process.kill(pid, 'SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (isProcessRunning(pid)) {
      process.kill(pid, 'SIGKILL')
    }
    return true
  } catch {
    return false
  }
}

// ---- 按端口查找 PID（跨平台） ----
async function findPidByPort(port) {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
      const lines = stdout.split('\n').filter(l => l.trim())
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        const local = parts[1] || ''
        if (local.endsWith(`:${port}`)) {
          const pid = parseInt(parts[parts.length - 1], 10)
          if (pid && !isNaN(pid)) return pid
        }
      }
    } else {
      const { stdout } = await execAsync(`lsof -ti:${port}`)
      const pid = parseInt(stdout.trim(), 10)
      if (pid && !isNaN(pid)) return pid
    }
  } catch {
    // 未找到
  }
  return null
}

// ---- 按端口查找并杀死进程 ----
async function killPort(port) {
  try {
    // 先通过 /info 接口确认身份
    const info = await fetchInfo(port)
    if (info !== 'cv-switch-web') {
      return { port, killed: false, reason: '不是 cv-switch-web 服务' }
    }

    const pid = await findPidByPort(port)
    if (!pid) {
      return { port, killed: false, reason: '未找到占用进程' }
    }

    process.kill(pid, 'SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (isProcessRunning(pid)) {
      process.kill(pid, 'SIGKILL')
    }
    await removePort(port)
    return { port, killed: true }
  } catch (err) {
    return { port, killed: false, reason: String(err.message || err) }
  }
}

// ---- 请求 /info 接口 ----
async function fetchInfo(port) {
  return new Promise((resolve) => {
    const req = request(
      { hostname: 'localhost', port, path: '/info', method: 'GET', timeout: 2000 },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => { resolve(data.trim()) })
      }
    )
    req.on('error', () => { resolve(null) })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

async function waitForReady(port, child, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return { ready: false, reason: `服务进程已退出，exitCode=${child.exitCode}` }
    }
    if (await fetchInfo(port) === 'cv-switch-web') {
      return { ready: true }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return { ready: false, reason: `服务未在 ${timeoutMs}ms 内响应 /info` }
}

// ---- tryStop：停止当前 PID 文件记录的服务 ----
async function tryStop() {
  let pid
  try {
    pid = await readPidFile()
  } catch {
    return false
  }

  if (!pid || !isProcessRunning(pid)) {
    await removePidFile()
    return false
  }

  const ok = await killPid(pid)
  await removePidFile()
  return ok
}

function printServerInfo({ port, pid, status, stopHint }) {
  const text = String(port)
  console.log(`
  cv-switch-web v${pkg.version}  ${status}
  ${'─'.repeat(54)}
  本地地址  http://localhost:${text}
  网络地址  http://0.0.0.0:${text}
  PID        ${pid}
  数据目录  ${RUNTIME_ROOT}
  停止服务   ${stopHint}
  ${'─'.repeat(54)}
`)
}

// ---- start 命令 ----
async function cmdStart(port) {
  // 先关闭旧服务
  const wasRunning = await tryStop()
  if (wasRunning) {
    console.log('  \u2713 已停止旧服务')
  }

  // 检查 server 脚本是否存在
  await ensureServerScript()

  // 记录端口
  await addPort(port)

  // 后台 spawn 服务进程
  // PORT 环境变量控制监听端口；NODE_PATH 让运行时优先从根依赖解析
  // 所有服务自身数据都挂在运行时根目录下，避免 npx 临时路径数据丢失
  const child = spawn('node', [SERVER_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: getServerEnv(port),
  })

  const readiness = await waitForReady(port, child)
  if (!readiness.ready) {
    await killPid(child.pid)
    await removePort(port)
    await removePidFile()
    console.log(`\n  \u2717 服务启动失败: ${readiness.reason}\n`)
    process.exit(1)
  }

  child.unref() // 不阻塞父进程
  await writePid(child.pid)

  printServerInfo({
    port,
    pid: child.pid,
    status: '✓ 启动成功',
    stopHint: `npx ${pkg.name} stop`,
  })

  // 自动打开浏览器
  const url = `http://localhost:${port}`
  const platform = process.platform
  const cmd = platform === 'win32'
    ? `start "" "${url}"`
    : platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`

  // 等一会让服务先起来再打开
  await new Promise(r => setTimeout(r, 1500))
  exec(cmd, (err) => {
    if (err) {
      console.log(`  \u26A0 无法自动打开浏览器: ${err.message}`)
    }
  })
}

// ---- stop 命令 ----
async function cmdStop() {
  const running = await tryStop()

  if (running) {
    console.log('\n  \u2713 服务已停止\n')
  } else {
    try {
      await readPidFile()
      console.log('\n  \u2717 PID 文件存在但进程已不在运行，已清理\n')
    } catch {
      console.log('\n  \u2717 未找到运行中的服务（PID 文件不存在）\n')
    }
    process.exit(1)
  }
}

// ---- restart 命令 ----
async function cmdRestart(port) {
  const wasRunning = await tryStop()
  if (wasRunning) {
    console.log('  \u2713 已停止旧服务')
  }
  await cmdStart(port)
}

// ---- serve 命令：前台运行，交给 systemd / supervisor 管理生命周期 ----
async function cmdServe(port) {
  await ensureServerScript()
  Object.assign(process.env, getServerEnv(port))
  printServerInfo({
    port,
    pid: process.pid,
    status: '前台运行中',
    stopHint: 'Ctrl+C',
  })
  await import(pathToFileURL(SERVER_SCRIPT).href)
}

// ---- kill 命令 ----
async function cmdKill() {
  const ports = await readPorts()
  if (ports.length === 0) {
    console.log('\n  \u2717 没有记录任何端口\n')
    process.exit(1)
  }

  console.log(`\n  检测到 ${ports.length} 个记录端口: ${ports.join(', ')}`)
  console.log('  正在并发探测 /info 并终止 cv-switch-web 进程...\n')

  const results = await Promise.all(ports.map(p => killPort(p)))

  let killedCount = 0
  for (const r of results) {
    if (r.killed) {
      console.log(`  \u2713 端口 ${r.port} \u2014 已终止`)
      killedCount++
    } else {
      console.log(`  \u2717 端口 ${r.port} \u2014 ${r.reason}`)
    }
  }

  await removePidFile()

  console.log()
  if (killedCount > 0) {
    console.log(`  共终止 ${killedCount} 个进程\n`)
  } else {
    console.log('  未终止任何进程\n')
    process.exit(1)
  }
}

// ---- CLI 定义 ----
const program = new Command()

program
  .name('cv-switch-web')
  .description('CV Switch Web — AI tool config manager web panel')
  .version(pkg.version)
  .option('--root-dir <dir>', '运行时根目录（默认: ~/.cv-switch-web）')
  .addHelpText('after', `
示例:
  cv-switch-web start                         默认端口 8033 启动
  cv-switch-web start --port 3000              指定端口启动
  cv-switch-web start --root-dir ~/.cv-switch-web 指定运行时根目录
  cv-switch-web stop                          停止服务
  cv-switch-web restart                       重启服务
  cv-switch-web restart --port 3000            指定端口重启
  cv-switch-web serve                         前台运行，适合 systemd
  cv-switch-web serve --port 3000              指定端口前台运行
  cv-switch-web kill                          杀死所有 cv-switch-web 端口进程
`)

program
  .command('start')
  .description('后台启动服务（自动关闭旧服务）')
  .option('-p, --port <port>', '监听端口', '8033')
  .option('--root-dir <dir>', '运行时根目录')
  .action(async (opts) => {
    configureRuntimeRoot(opts.rootDir || program.opts().rootDir)
    await cmdStart(parsePort(opts.port))
  })

program
  .command('stop')
  .description('停止服务')
  .option('--root-dir <dir>', '运行时根目录')
  .action((opts) => {
    configureRuntimeRoot(opts.rootDir || program.opts().rootDir)
    return cmdStop()
  })

program
  .command('restart')
  .description('重启服务（先停后启）')
  .option('-p, --port <port>', '监听端口', '8033')
  .option('--root-dir <dir>', '运行时根目录')
  .action(async (opts) => {
    configureRuntimeRoot(opts.rootDir || program.opts().rootDir)
    await cmdRestart(parsePort(opts.port))
  })

program
  .command('serve')
  .description('前台运行服务（适合 systemd 托管）')
  .option('-p, --port <port>', '监听端口', '8033')
  .option('--root-dir <dir>', '运行时根目录')
  .action(async (opts) => {
    configureRuntimeRoot(opts.rootDir || program.opts().rootDir)
    await cmdServe(parsePort(opts.port))
  })

program
  .command('kill')
  .description('杀死所有 cv-switch-web 端口进程')
  .option('--root-dir <dir>', '运行时根目录')
  .action((opts) => {
    configureRuntimeRoot(opts.rootDir || program.opts().rootDir)
    return cmdKill()
  })

program
  .command('help')
  .description('显示帮助')
  .action(() => program.help())

// ---- 入口 ----
const args = process.argv.slice(2)

if (args.length === 0) {
  program.help()
} else {
  program.parse()
}
