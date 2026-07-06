import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.cc-switch-web', 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/** 获取当天的日志文件路径，格式: cc-switch-YYYY-MM-DD.log */
function logFilePath(): string {
  ensureLogDir();
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `cc-switch-${date}.log`);
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function writeLine(level: string, tag: string, message: string, data?: Record<string, unknown>) {
  const ts = timestamp();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${ts}] [${level}] [${tag}] ${message}${dataStr}\n`;

  // 控制台 — 始终输出
  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  fn(line.trimEnd());

  // 文件
  try {
    ensureLogDir();
    fs.appendFileSync(logFilePath(), line, 'utf-8');
  } catch (fileErr: any) {
    // 文件写入失败时在控制台明确警告，不要静默吞掉
    console.error(`[CC Switch] 日志文件写入失败: ${fileErr.message}`);
  }
}

/** 日志模块，按功能模块分类书写 */
export const logger = {
  /** Claude Proxy — Anthropic → OpenAI Chat 转换链路 */
  claudeProxy: {
    info(message: string, data?: Record<string, unknown>) {
      writeLine('INFO', 'claude-proxy', message, data);
    },
    request(providerId: string, model: string, bodySize: number) {
      writeLine('INFO', 'claude-proxy', `请求开始`, { providerId, model: model || '(from body)', bodySize });
    },
    upstreamRequest(baseUrl: string, model: string, stream: boolean) {
      writeLine('INFO', 'claude-proxy', `上游请求`, { baseUrl, model, stream });
    },
    upstreamResponseOk(model: string, status: number, latencyMs: number, stream: boolean, usage?: Record<string, unknown>) {
      writeLine('INFO', 'claude-proxy', `上游响应成功`, { model, status, latencyMs, stream, ...(usage ? { usage } : {}) });
    },
    upstreamResponseError(model: string, status: number, latencyMs: number, body: string) {
      writeLine('ERROR', 'claude-proxy', `上游响应失败 HTTP ${status}`, { model, status, latencyMs, bodyPreview: body.slice(0, 500) });
    },
    error(message: string, detail?: Record<string, unknown>) {
      writeLine('ERROR', 'claude-proxy', message, detail);
    },
  },

  /** Codex Proxy */
  codexProxy: {
    request(providerId: string, model: string) {
      writeLine('INFO', 'codex-proxy', `请求开始`, { providerId, model });
    },
    upstreamRequest(baseUrl: string, model: string) {
      writeLine('INFO', 'codex-proxy', `上游请求`, { baseUrl, model });
    },
    upstreamResponseOk(model: string, status: number, latencyMs: number) {
      writeLine('INFO', 'codex-proxy', `上游响应成功`, { model, status, latencyMs });
    },
    upstreamResponseError(model: string, status: number, latencyMs: number, body: string) {
      writeLine('ERROR', 'codex-proxy', `上游响应失败 HTTP ${status}`, { model, status, latencyMs, bodyPreview: body.slice(0, 500) });
    },
    error(message: string, detail?: Record<string, unknown>) {
      writeLine('ERROR', 'codex-proxy', message, detail);
    },
  },

  /** Provider 模型列表获取 */
  models: {
    fetchStart(providerId: string, baseUrl: string) {
      writeLine('INFO', 'models', `获取模型列表`, { providerId, baseUrl });
    },
    fetchOk(providerId: string, count: number) {
      writeLine('INFO', 'models', `获取模型列表成功`, { providerId, count });
    },
    fetchError(providerId: string, status: number, message: string) {
      writeLine('ERROR', 'models', `获取模型列表失败`, { providerId, status, errorPreview: message.slice(0, 300) });
    },
  },

  /** Profile 配置写入 */
  profiles: {
    writeStart(profileName: string, appType: string, providerName: string) {
      writeLine('INFO', 'profiles', `配置写入开始`, { profileName, appType, providerName });
    },
    writeOk(profileName: string, appType: string) {
      writeLine('INFO', 'profiles', `配置写入完成`, { profileName, appType });
    },
    writeError(profileName: string, appType: string, error: string) {
      writeLine('ERROR', 'profiles', `配置写入失败`, { profileName, appType, error });
    },
  },

  /** 通用 */
  info(tag: string, message: string, data?: Record<string, unknown>) {
    writeLine('INFO', tag, message, data);
  },
  warn(tag: string, message: string, data?: Record<string, unknown>) {
    writeLine('WARN', tag, message, data);
  },
  error(tag: string, message: string, data?: Record<string, unknown>) {
    writeLine('ERROR', tag, message, data);
  },

  /** 获取日志目录 */
  logDir: LOG_DIR,
  logFilePath,
};
