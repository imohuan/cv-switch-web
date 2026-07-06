import fs from 'fs';
import path from 'path';
import os from 'os';
import { stringify as stringifyToml } from 'smol-toml';
import type { Provider, Profile } from '../db.js';
import { bestFormatForApp, claudeModels, codexModels, publicBaseUrl } from './providerConfig.js';

const PROFILES_DIR = path.join(os.homedir(), '.cc-switch-web', 'profiles');

export interface ProfileResult {
  success: boolean;
  message: string;
  home_dir?: string;
  command?: string;
  commands?: LaunchCommands;
}

/** 支持的命令平台类型 */
export type CommandPlatform = 'bash' | 'powershell' | 'cmd'

/** 多平台启动命令 */
export interface LaunchCommands {
  bash: string        // Linux / macOS / Git Bash
  powershell: string  // Windows PowerShell (pwsh / powershell)
  cmd: string         // Windows CMD
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 将全局 Claude 二进制复制到 Profile HOME，避免每个 Profile 都需要 claude install */
function copyClaudeBinary(homeDir: string) {
  const globalBin = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  const profileBinDir = path.join(homeDir, '.local', 'bin');
  const profileBin = path.join(profileBinDir, 'claude.exe');
  if (fs.existsSync(globalBin) && !fs.existsSync(profileBin)) {
    ensureDir(profileBinDir);
    fs.copyFileSync(globalBin, profileBin);
  }
}

/** 将全局 .claude.json（认证状态）复制到 Profile HOME，避免 "Not logged in" */
function copyClaudeAuthState(homeDir: string) {
  const globalAuth = path.join(os.homedir(), '.claude.json');
  const profileAuth = path.join(homeDir, '.claude.json');
  if (fs.existsSync(globalAuth)) {
    fs.copyFileSync(globalAuth, profileAuth);
  }
}

function atomicWrite(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function profileHomeDir(profile: Profile): string {
  return path.join(PROFILES_DIR, profile.slug);
}

export function writeProfileConfig(profile: Profile, provider: Provider): ProfileResult {
  try {
    const homeDir = profileHomeDir(profile);
    ensureDir(homeDir);
    const effectiveProvider = providerWithProfileOverrides(provider, profile);

    switch (profile.app_type) {
      case 'codex':
        writeCodexProfile(homeDir, effectiveProvider);
        break;
      case 'claude':
        writeClaudeProfile(homeDir, effectiveProvider);
        copyClaudeBinary(homeDir);
        copyClaudeAuthState(homeDir);
        break;
      case 'gemini':
        writeGeminiProfile(homeDir, effectiveProvider);
        break;
      case 'opencode':
        writeOpenCodeProfile(homeDir, effectiveProvider);
        break;
      default:
        return { success: false, message: `Unsupported app type: ${profile.app_type}` };
    }

    return {
      success: true,
      message: `Profile created for ${profile.app_type}`,
      home_dir: homeDir,
      command: launchCommand(profile, homeDir),
      commands: launchCommands(profile, homeDir),
    };
  } catch (err: any) {
    return { success: false, message: `Failed to create profile: ${err.message}` };
  }
}

function providerWithProfileOverrides(provider: Provider, profile: Profile): Provider {
  const providerExtra = parseJsonObject(provider.extra_config);
  const profileExtra = parseJsonObject(profile.extra_config);
  const merged = deepMerge(providerExtra, profileExtra);
  const model = profile.app_type === 'codex'
    ? merged.codex?.defaultModel || provider.model
    : profile.app_type === 'claude'
      ? merged.claude?.defaultModel || provider.model
      : provider.model;
  return { ...provider, model, extra_config: JSON.stringify(merged) };
}

function parseJsonObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function deepMerge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

const APP_COMMANDS: Record<string, string> = {
  codex: 'codex',
  claude: 'claude',
  gemini: 'gemini',
  opencode: 'opencode',
}

/** 生成多平台启动命令 */
export function launchCommands(profile: Profile, homeDir = profileHomeDir(profile)): LaunchCommands {
  const appCmd = APP_COMMANDS[profile.app_type] || profile.app_type;

  if (profile.app_type === 'claude') {
    // Claude Code 在 Windows 上 HOME 无效，CLAUDE_CONFIG_DIR 会导致找不到凭证。
    // 方案：直接用环境变量覆盖 ANTHROPIC_BASE_URL / API_KEY / MODEL，
    // Claude Code 读取全局 ~/.claude/ 的凭证和 settings，env vars 优先级最高。
    const envVars = readClaudeEnvVars(homeDir);
    if (envVars) {
      // Bash — 前缀环境变量
      const bashParts = Object.entries(envVars).map(([k, v]) => `${k}=${shellQuote(String(v))}`);
      const bash = `${bashParts.join(' ')} ${appCmd}`;
      // PowerShell
      const psParts = Object.entries(envVars).map(([k, v]) => `$env:${k}='${String(v).replace(/'/g, "''")}'`);
      const powershell = `${psParts.join('; ')}; ${appCmd}`;
      // CMD
      const cmdParts = Object.entries(envVars).map(([k, v]) => `set ${k}=${String(v).replace(/&/g, '^^&')}`);
      const cmd = `${cmdParts.join(' && ')} && ${appCmd}`;
      return { bash, powershell, cmd };
    }
    // fallback: 没有找到 settings.json，用 HOME 方式
  }

  // 其他应用（Codex / Gemini / OpenCode）使用 HOME 方式
  const bash = `HOME=${shellQuote(homeDir)} ${appCmd}`;
  const psHome = homeDir.replace(/'/g, "''");
  const powershell = `$env:HOME='${psHome}'; ${appCmd}`;
  const cmdHome = homeDir.replace(/"/g, '\\"');
  const cmd = `set HOME="${cmdHome}" && ${appCmd}`;
  return { bash, powershell, cmd };
}

/** 读取 Profile 的 Claude settings.json，提取 env 块 */
function readClaudeEnvVars(homeDir: string): Record<string, string> | null {
  try {
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.env && typeof parsed.env === 'object') {
      return parsed.env as Record<string, string>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 向后兼容：仅返回 Bash 格式 */
export function launchCommand(profile: Profile, homeDir?: string): string {
  return launchCommands(profile, homeDir).bash;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function envKey(provider: Provider): string {
  return provider.api_format === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

function writeCodexProfile(homeDir: string, provider: Provider) {
  const codexDir = path.join(homeDir, '.codex');
  const format = bestFormatForApp(provider, 'codex');
  const key = 'OPENAI_API_KEY';
  const models = codexModels(provider);
  const baseUrl = format === 'openai_chat'
    ? codexChatAdapterBaseUrl(provider)
    : provider.base_url;
  atomicWrite(path.join(codexDir, 'auth.json'), JSON.stringify({ [key]: format === 'openai_chat' ? 'PROXY_MANAGED' : provider.api_key }, null, 2));
  atomicWrite(path.join(codexDir, 'config.toml'), stringifyToml({
    model: models.defaultModel,
    model_provider: 'custom',
    model_catalog_json: path.join(codexDir, 'cc-switch-web-model-catalog.json'),
    model_providers: {
      custom: {
        name: provider.name,
        base_url: baseUrl,
        env_key: key,
        wire_api: 'responses',
      },
    },
  }));
  atomicWrite(path.join(codexDir, 'cc-switch-web-model-catalog.json'), JSON.stringify(codexModelCatalog(provider), null, 2));
}

function codexChatAdapterBaseUrl(provider: Provider): string {
  return `${publicBaseUrl()}/proxy/codex/${provider.id}/v1`;
}

function writeClaudeProfile(homeDir: string, provider: Provider) {
  const format = bestFormatForApp(provider, 'claude');
  const models = claudeModels(provider);
  const baseUrl = format === 'openai_chat'
    ? claudeChatAdapterBaseUrl(provider)
    : provider.base_url;
  const token = format === 'openai_chat'
    ? provider.api_key  // 使用 Provider 真实 key，Claude Code 已批准此 key
    : provider.api_key;

  // Claude Code v2.1.x 客户端内置模型名称白名单，自定义模型名会被拒绝。
  // 不同角色用不同的 Claude 模型名（当前非退役版本），Proxy 根据名称映射到 Provider 实际模型：
  //   claude-sonnet-5            → sonnetModel / defaultModel
  //   claude-haiku-4-5-20251001  → haikuModel / smallFastModel
  //   claude-opus-4-8            → opusModel / defaultModel
  const CLAUDE_SONNET = 'claude-sonnet-5';
  const CLAUDE_HAIKU  = 'claude-haiku-4-5';
  const CLAUDE_OPUS   = 'claude-opus-4-8';

  atomicWrite(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: token,
      ANTHROPIC_MODEL: CLAUDE_SONNET,
      ...(models.smallFastModel ? { ANTHROPIC_SMALL_FAST_MODEL: CLAUDE_HAIKU } : {}),
      ...(models.haikuModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: CLAUDE_HAIKU } : {}),
      ...(models.sonnetModel ? { ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_SONNET } : {}),
      ...(models.opusModel ? { ANTHROPIC_DEFAULT_OPUS_MODEL: CLAUDE_OPUS } : {}),
    },
  }, null, 2));
}

function codexModelCatalog(provider: Provider) {
  const { models } = codexModels(provider);
  return {
    models: models.map((item) => ({
      id: item.model,
      name: item.displayName || item.model,
      model: item.model,
      provider: 'custom',
      wire_api: 'responses',
      tools: true,
      parallel_tool_calls: item.supportsParallelToolCalls ?? true,
      context_window: Number(item.contextWindow) || 128000,
      input_modalities: item.inputModalities || ['text'],
      ...(item.baseInstructions ? { base_instructions: item.baseInstructions } : {}),
    })),
  };
}

function claudeChatAdapterBaseUrl(provider: Provider): string {
  return `${publicBaseUrl()}/proxy/claude/${provider.id}`;
}

function writeGeminiProfile(homeDir: string, provider: Provider) {
  atomicWrite(path.join(homeDir, '.gemini', '.env'), [
    `GEMINI_API_KEY=${provider.api_key}`,
    `GOOGLE_GEMINI_BASE_URL=${provider.base_url}`,
    '',
  ].join('\n'));
  atomicWrite(path.join(homeDir, '.gemini', 'settings.json'), JSON.stringify({
    ...(provider.model ? { model: provider.model } : {}),
  }, null, 2));
}

function writeOpenCodeProfile(homeDir: string, provider: Provider) {
  atomicWrite(path.join(homeDir, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    provider: {
      [provider.id]: {
        name: provider.name,
        base_url: provider.base_url,
        api_key: provider.api_key,
        model: provider.model,
        ...(provider.api_format === 'openai_chat' ? { type: 'openai_compatible' } : {}),
      },
    },
  }, null, 2));
}
