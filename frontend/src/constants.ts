import type { ApiFormat, ProviderExtraConfig, ConfigFilePayload } from "./api"

export const APP_LABELS: Record<string, string> = {
  codex: "Codex CLI",
  claude: "Claude Code",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
}

export const API_FORMAT_LABELS: Record<string, string> = {
  openai_chat: "Chat Completions",
  openai_responses: "Responses",
  anthropic: "Anthropic",
  gemini_native: "Gemini",
}

export const API_FORMATS: Array<{ value: ApiFormat; label: string }> = [
  { value: "openai_chat", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "gemini_native", label: "Gemini Native" },
]

export const NAV_ITEMS = [
  { id: "status", name: "概览", icon: "dashboard" },
  { id: "profiles", name: "Profile 预设", icon: "folder_special" },
  { id: "providers", name: "Provider 管理", icon: "dns" },
]

export const STATUS_APPS = [
  { id: "codex", name: "Codex CLI", icon: "terminal" },
  { id: "claude", name: "Claude Code", icon: "auto_awesome" },
  { id: "gemini", name: "Gemini CLI", icon: "diamond" },
  { id: "opencode", name: "OpenCode", icon: "code" },
  { id: "workbuddy", name: "WorkBuddy", icon: "deployed_code" },
]

export const COMMAND_PLATFORMS = [
  { value: "bash" as const, label: "Bash", icon: "terminal", desc: "Linux / macOS / Git Bash" },
  { value: "powershell" as const, label: "PowerShell", icon: "powershell", desc: "Windows PowerShell" },
  { value: "cmd" as const, label: "CMD", icon: "command_line", desc: "Windows CMD" },
]

export function parseExtra(v?: string): ProviderExtraConfig {
  try {
    const p = JSON.parse(v || "{}")
    return p && typeof p === "object" ? p : {}
  } catch {
    return {}
  }
}

export function compactObject<T extends Record<string, any>>(v: T): T {
  return Object.fromEntries(
    Object.entries(v).filter(
      ([, val]) =>
        val !== "" &&
        val !== undefined &&
        val !== null &&
        (!Array.isArray(val) || val.length > 0),
    ),
  ) as T
}

export type ConfigFile = ConfigFilePayload &
  ({ isJson: true; parsed: unknown } | { isJson?: false; parsed?: undefined })

export function toConfigFile(file: ConfigFilePayload): ConfigFile {
  if (!file.label.toLowerCase().endsWith(".json"))
    return { ...file, isJson: false }
  try {
    return { ...file, isJson: true, parsed: JSON.parse(file.content) }
  } catch {
    return { ...file, isJson: false }
  }
}

export function isJsonFile(
  file: ConfigFile,
): file is ConfigFile & { isJson: true; parsed: unknown } {
  return file.isJson === true
}

export function changeCount(file: ConfigFilePayload): number {
  return file.changes ? Object.keys(file.changes).length : 0
}
