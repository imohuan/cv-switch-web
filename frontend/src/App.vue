<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Toaster } from 'vue-sonner'
import { useNotify, AxJsonViewer } from './components/ui'
import AxModelSelect from './components/ui/AxModelSelect.vue'
import { api, type Provider, type Profile, type AppStatus, type ProviderExtraConfig, type ApiFormat } from './api'

const { triggerNotify } = useNotify()

const APP_LABELS: Record<string, string> = { codex: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI', opencode: 'OpenCode' }
const API_FORMAT_LABELS: Record<string, string> = { openai_chat: 'Chat Completions', openai_responses: 'Responses', anthropic: 'Anthropic', gemini_native: 'Gemini' }
const API_FORMATS: Array<{ value: ApiFormat; label: string }> = [
  { value: 'openai_chat', label: 'OpenAI Chat Completions' }, { value: 'openai_responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' }, { value: 'gemini_native', label: 'Gemini Native' },
]

const NAV_ITEMS = [
  { id: 'status', name: '概览', icon: 'dashboard' },
  { id: 'profiles', name: '任务 Profile', icon: 'folder_special' },
  { id: 'providers', name: 'Provider 管理', icon: 'dns' },
]

const providers = ref<Provider[]>([])
const profiles = ref<Profile[]>([])
const statuses = ref<Record<string, AppStatus>>({})
const loading = ref(true)
const error = ref('')
const showForm = ref(false)
const editingProvider = ref<Provider | null>(null)
const navTab = ref('status')

// Shared model list for provider form
const fetchedModels = ref<Array<{ value: string; label: string }>>([])
const fetchingModels = ref(false)

// Profile form
const profileName = ref('')
const profileApp = ref('codex')
const profileProviderId = ref('')
const profileClaudeDefault = ref(''); const profileClaudeHaiku = ref(''); const profileClaudeSonnet = ref(''); const profileClaudeOpus = ref('')
const profileCodexDefault = ref(''); const profileCodexCatalogModels = ref<string[]>([])

/** 每个 Profile 的启动命令平台选择 */
const profileCommandPlatform = ref<Record<string, 'bash' | 'powershell' | 'cmd'>>({})
const COMMAND_PLATFORMS = [
  { value: 'bash' as const, label: 'Bash', icon: 'terminal', desc: 'Linux / macOS / Git Bash' },
  { value: 'powershell' as const, label: 'PowerShell', icon: 'powershell', desc: 'Windows PowerShell' },
  { value: 'cmd' as const, label: 'CMD', icon: 'command_line', desc: 'Windows CMD' },
]

function getCommandForProfile(p: Profile): string {
  const plat = profileCommandPlatform.value[p.id] || 'bash'
  return p.commands?.[plat] || p.command
}

/** 配置文件类型（含预解析的 JSON 数据） */
type ConfigFile = { label: string; content: string; exists: boolean; parsed?: unknown }

/** 尝试解析 JSON 文件内容，失败返回 null */
function tryParseJson(file: { label: string; content: string }): unknown | null {
  if (!file.label.endsWith('.json')) return null
  try { return JSON.parse(file.content) } catch { return null }
}

/** Profile 本地配置查看 */
const expandedConfigId = ref<string | null>(null)
const profileConfigs = ref<Record<string, { home_dir: string; app_type: string; files: ConfigFile[] } | null>>({})
const loadingConfig = ref<string | null>(null)
/** 文件级别展开/折叠 */
const expandedFiles = ref<Set<string>>(new Set())

/** 概览页 — App Tab + 全局配置查看 */
const statusAppTab = ref<string>('codex')
const STATUS_APPS = [
  { id: 'codex', name: 'Codex CLI', icon: 'terminal' },
  { id: 'claude', name: 'Claude Code', icon: 'auto_awesome' },
  { id: 'gemini', name: 'Gemini CLI', icon: 'diamond' },
  { id: 'opencode', name: 'OpenCode', icon: 'code' },
]
const expandedAppConfig = ref<string | null>(null)
const appConfigs = ref<Record<string, { home_dir: string; app_type: string; files: ConfigFile[] } | null>>({})
const loadingAppConfig = ref<string | null>(null)
const expandedAppFiles = ref<Set<string>>(new Set())

function toggleProfileConfig(profile: Profile) {
  if (expandedConfigId.value === profile.id) {
    expandedConfigId.value = null
    return
  }
  expandedConfigId.value = profile.id
  // 每次展开都重新获取最新文件内容
  loadProfileConfig(profile.id)
}

function toggleFileExpand(profileId: string, fileIdx: number) {
  const key = `${profileId}-${fileIdx}`
  if (expandedFiles.value.has(key)) {
    expandedFiles.value.delete(key)
    expandedFiles.value = new Set(expandedFiles.value)
  } else {
    expandedFiles.value.add(key)
    expandedFiles.value = new Set(expandedFiles.value)
  }
}
function expandedFileKey(key: string): boolean {
  return expandedFiles.value.has(key)
}

async function loadProfileConfig(id: string) {
  loadingConfig.value = id
  try {
    const res = await api.getProfileConfig(id)
    if (res.success && res.data) {
      profileConfigs.value[id] = { ...res.data, files: res.data.files.map(f => ({ ...f, parsed: tryParseJson(f) })) }
    } else {
      profileConfigs.value[id] = { home_dir: '', app_type: '', files: [{ label: '错误', content: res.error || '读取失败', exists: false }] }
    }
  } catch (e: any) {
    profileConfigs.value[id] = { home_dir: '', app_type: '', files: [{ label: '错误', content: e.message, exists: false }] }
  } finally { loadingConfig.value = null }
}

/** 概览页 — 全局 App 配置查看 */
function toggleAppConfig(appType: string) {
  if (expandedAppConfig.value === appType) {
    expandedAppConfig.value = null
    return
  }
  expandedAppConfig.value = appType
  loadAppConfig(appType)
}

function toggleAppFileExpand(appType: string, fileIdx: number) {
  const key = `${appType}-${fileIdx}`
  if (expandedAppFiles.value.has(key)) {
    expandedAppFiles.value.delete(key)
    expandedAppFiles.value = new Set(expandedAppFiles.value)
  } else {
    expandedAppFiles.value.add(key)
    expandedAppFiles.value = new Set(expandedAppFiles.value)
  }
}
function expandedAppFileKey(key: string): boolean {
  return expandedAppFiles.value.has(key)
}

async function loadAppConfig(appType: string) {
  loadingAppConfig.value = appType
  try {
    const res = await api.getAppConfig(appType)
    if (res.success && res.data) {
      appConfigs.value[appType] = { ...res.data, files: res.data.files.map(f => ({ ...f, parsed: tryParseJson(f) })) }
    } else {
      appConfigs.value[appType] = { home_dir: '', app_type: appType, files: [{ label: '错误', content: res.error || '读取失败', exists: false }] }
    }
  } catch (e: any) {
    appConfigs.value[appType] = { home_dir: '', app_type: appType, files: [{ label: '错误', content: e.message, exists: false }] }
  } finally { loadingAppConfig.value = null }
}

// Provider form
const formName = ref(''); const formBaseUrl = ref(''); const formApiKey = ref(''); const formModel = ref('')
const formApiFormat = ref<Provider['api_format']>('openai_chat'); const formProviderType = ref('custom')
const formCapabilities = ref<Record<ApiFormat, boolean>>({ openai_chat: true, openai_responses: false, anthropic: false, gemini_native: false })
const formClaudeDefault = ref(''); const formClaudeSmall = ref(''); const formClaudeHaiku = ref(''); const formClaudeSonnet = ref(''); const formClaudeOpus = ref('')
const formCodexDefault = ref(''); const formCodexCatalogModels = ref<string[]>([])

const liveTime = ref('')
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  loadData()
  liveTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  timer = setInterval(() => { liveTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false }) }, 1000)
})

async function loadData() {
  try {
    const [provRes, statusRes, profileRes] = await Promise.all([api.getProviders(), api.getStatus(), api.getProfiles()])
    if (provRes.success && provRes.data) providers.value = provRes.data
    if (statusRes.success && statusRes.data) statuses.value = statusRes.data
    if (profileRes.success && profileRes.data) profiles.value = profileRes.data
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}

const connectedCount = computed(() => Object.values(statuses.value).filter(s => s.current_provider_id).length)

async function handleSwitch(appType: string, providerId: string) {
  error.value = ''
  const res = await api.switchProvider(appType, providerId)
  if (res.success) { await loadData(); triggerNotify(`已切换到 ${providers.value.find(p=>p.id===providerId)?.name||providerId}`, 'success') }
  else { error.value = res.error || 'Switch failed' }
}
async function handleClear(appType: string) {
  error.value = ''
  const res = await api.clearProvider(appType)
  if (res.success) { await loadData(); triggerNotify(`${APP_LABELS[appType] || appType} 已断开`, 'info') }
  else { error.value = res.error || 'Clear failed' }
}

function openForm(provider: Provider | null) {
  editingProvider.value = provider
  fetchedModels.value = []
  const extra = parseExtra(provider?.extra_config)
  formName.value = provider?.name || ''; formBaseUrl.value = provider?.base_url || ''; formApiKey.value = ''
  formModel.value = provider?.model || ''; formApiFormat.value = provider?.api_format || 'openai_chat'
  formProviderType.value = extra.provider_type || 'custom'
  formCapabilities.value = {
    openai_chat: extra.capabilities?.openai_chat ?? (provider ? provider.api_format === 'openai_chat' : true),
    openai_responses: extra.capabilities?.openai_responses ?? (provider ? provider.api_format === 'openai_responses' : false),
    anthropic: extra.capabilities?.anthropic ?? (provider ? provider.api_format === 'anthropic' : false),
    gemini_native: extra.capabilities?.gemini_native ?? false,
  }
  formClaudeDefault.value = extra.claude?.defaultModel || provider?.model || ''
  formClaudeSmall.value = extra.claude?.smallFastModel || ''
  formClaudeHaiku.value = extra.claude?.haikuModel || ''
  formClaudeSonnet.value = extra.claude?.sonnetModel || provider?.model || ''
  formClaudeOpus.value = extra.claude?.opusModel || provider?.model || ''
  formCodexDefault.value = extra.codex?.defaultModel || provider?.model || ''
  formCodexCatalogModels.value = (extra.codex?.models || []).map((m: any) => m.model).filter(Boolean)
  showForm.value = true
}

async function fetchAllModels() {
  fetchingModels.value = true
  try {
    let res
    if (editingProvider.value?.id) {
      res = await api.fetchModels(editingProvider.value.id)
    } else if (formBaseUrl.value) {
      res = await api.fetchModelsByConfig(formBaseUrl.value, formApiKey.value)
    } else {
      triggerNotify('请先填写 Base URL', 'error')
      return
    }
    if (res.success && res.data) {
      fetchedModels.value = res.data.map(m => ({ value: m.id, label: m.id }))
      triggerNotify(`已获取 ${fetchedModels.value.length} 个模型`, 'success')
    } else {
      triggerNotify(res.error || '获取模型失败', 'error')
    }
  } finally {
    fetchingModels.value = false
  }
}

async function handleSave() {
  if (!formName.value || !formBaseUrl.value) { triggerNotify('名称和 Base URL 必填', 'error'); return }
  error.value = ''
  const extraConfig: ProviderExtraConfig = {
    provider_type: formProviderType.value, capabilities: formCapabilities.value,
    claude: compactObject({ defaultModel: formClaudeDefault.value, smallFastModel: formClaudeSmall.value, haikuModel: formClaudeHaiku.value, sonnetModel: formClaudeSonnet.value, opusModel: formClaudeOpus.value }),
    codex: compactObject({ defaultModel: formCodexDefault.value || formModel.value, models: formCodexCatalogModels.value.map(m => ({ model: m })) }),
  }
  const payload: Partial<Provider> = { name: formName.value, base_url: formBaseUrl.value, ...(formApiKey.value ? { api_key: formApiKey.value } : {}), model: formModel.value, api_format: formApiFormat.value, extra_config: JSON.stringify(extraConfig) }
  const res = editingProvider.value ? await api.updateProvider(editingProvider.value.id, payload) : await api.createProvider(payload)
  if (res.success) { showForm.value = false; await loadData(); triggerNotify(editingProvider.value ? 'Provider 已更新' : 'Provider 已创建', 'success') }
  else { error.value = res.error || 'Save failed' }
}
async function handleDelete(id: string) {
  if (!confirm('确定删除此 Provider？')) return
  error.value = ''
  const res = await api.deleteProvider(id)
  if (res.success) { await loadData(); triggerNotify('Provider 已删除', 'info') }
  else { error.value = res.error || 'Delete failed' }
}
async function handleCreateProfile() {
  const pid = profileProviderId.value || providers.value[0]?.id
  if (!profileName.value || !pid) { triggerNotify('请填写名称并选择 Provider', 'error'); return }
  error.value = ''
  const extra = profileApp.value === 'claude' ? { claude: compactObject({ defaultModel: profileClaudeDefault.value, haikuModel: profileClaudeHaiku.value, sonnetModel: profileClaudeSonnet.value, opusModel: profileClaudeOpus.value }) }
    : profileApp.value === 'codex' ? { codex: compactObject({ defaultModel: profileCodexDefault.value, models: profileCodexCatalogModels.value.map(m => ({ model: m })) }) } : {}
  const res = await api.createProfile({ name: profileName.value, app_type: profileApp.value, provider_id: pid, extra_config: JSON.stringify(extra) })
  if (res.success) { profileName.value = ''; profileProviderId.value = ''; profileClaudeDefault.value = ''; profileClaudeHaiku.value = ''; profileClaudeSonnet.value = ''; profileClaudeOpus.value = ''; profileCodexDefault.value = ''; profileCodexCatalogModels.value = []; await loadData(); triggerNotify('Profile 已创建', 'success') }
  else { error.value = res.error || 'Create profile failed' }
}
async function handleApplyProfile(id: string) { error.value = ''; const r = await api.applyProfile(id); if (r.success) { await loadData(); triggerNotify('配置已写入', 'success') } else error.value = r.error || 'Apply failed' }
async function handleDeleteProfile(id: string) { if (!confirm('确定删除此 Profile？配置目录会保留。')) return; error.value = ''; const r = await api.deleteProfile(id); if (r.success) { await loadData(); triggerNotify('Profile 已删除', 'info') } else error.value = r.error || 'Delete failed' }
async function copyCommand(cmd: string) { await navigator.clipboard.writeText(cmd); triggerNotify('已复制', 'info') }

/** Provider 选择后自动回填模型字段 */
watch(profileProviderId, (newPid) => {
  if (!newPid) return
  const provider = providers.value.find(p => p.id === newPid)
  if (!provider) return
  const extra = parseExtra(provider.extra_config)
  // Claude 模型回填
  profileClaudeDefault.value = extra.claude?.defaultModel || ''
  profileClaudeHaiku.value = extra.claude?.haikuModel || ''
  profileClaudeSonnet.value = extra.claude?.sonnetModel || ''
  profileClaudeOpus.value = extra.claude?.opusModel || ''
  // Codex 模型回填
  profileCodexDefault.value = extra.codex?.defaultModel || ''
  profileCodexCatalogModels.value = (extra.codex?.models || []).map(m => m.model)
})

function getActiveApps(pid: string) { return Object.entries(statuses.value).filter(([, s]) => s.current_provider_id === pid).map(([a]) => a) }
function providerTypeLabel(p: Provider) { const t = parseExtra(p.extra_config).provider_type; return t === 'newapi' ? 'New API' : (API_FORMAT_LABELS[p.api_format] || p.api_format) }
function providerCapabilities(p: Provider) { const c = parseExtra(p.extra_config).capabilities || {}; const e = Object.entries(c).filter(([,v]) => v).map(([f]) => f); return e.length ? e : [p.api_format] }
const providerOptions = computed(() => providers.value.map(p => ({ value: p.id, label: p.name })))

function parseExtra(v?: string): ProviderExtraConfig { try { const p = JSON.parse(v || '{}'); return p && typeof p === 'object' ? p : {} } catch { return {} } }
function compactObject<T extends Record<string, any>>(v: T): T { return Object.fromEntries(Object.entries(v).filter(([, val]) => val !== '' && val !== undefined && val !== null && (!Array.isArray(val) || val.length > 0))) as T }
function setNewApiPreset() { formProviderType.value = 'newapi'; formCapabilities.value = { openai_chat: true, openai_responses: true, anthropic: true, gemini_native: false } }
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-background">
    <Toaster position="top-right" rich-colors close-button :toast-options="{ style: { background: 'transparent', border: 'none', boxShadow: 'none', padding: '0px' } }" />

    <!-- ===== Sidebar ===== -->
    <aside class="w-60 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between py-ax-md px-ax-sm select-none z-10 shrink-0">
      <div class="space-y-ax-lg">
        <!-- Brand -->
        <div class="flex items-center gap-ax-sm px-2">
          <div class="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-on-primary">
            <span class="material-symbols-outlined text-[18px]">auto_fix_high</span>
          </div>
          <div>
            <h2 class="font-headline-sm text-headline-sm text-primary tracking-tight">CC Switch</h2>
            <div class="flex items-center gap-ax-xs">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span class="font-label-md text-[10px] text-secondary">Cloud Profile Console</span>
            </div>
          </div>
        </div>

        <!-- Nav -->
        <nav class="space-y-ax-xs">
          <p class="font-label-md text-[10px] text-secondary uppercase tracking-wider px-2 pb-1">导航</p>
          <a v-for="item in NAV_ITEMS" :key="item.id"
            class="flex items-center gap-ax-sm rounded-xl py-1.5 px-2 font-label-md text-label-md transition-all duration-100 cursor-pointer select-none"
            :class="navTab === item.id ? 'bg-secondary-container text-on-secondary-container font-medium scale-[0.98]' : 'text-secondary hover:bg-surface-container-low'"
            @click="navTab = item.id">
            <span class="material-symbols-outlined" :style="{ fontVariationSettings: navTab === item.id ? '\'FILL\' 1' : '\'FILL\' 0' }">{{ item.icon }}</span>
            <span>{{ item.name }}</span>
          </a>
        </nav>
      </div>

      <!-- Bottom info -->
      <div class="border-t border-outline-variant pt-ax-md px-2">
        <div class="rounded-xl bg-surface-container-low border border-outline-variant p-ax-sm">
          <div class="flex items-center gap-ax-sm">
            <span class="material-symbols-outlined text-secondary text-[16px]">info</span>
            <div>
              <p class="font-body-sm text-[11px] text-primary font-semibold">Profile Isolation</p>
              <p class="font-body-sm text-[10px] text-secondary">独立 HOME 目录运行</p>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- ===== Main ===== -->
    <div class="flex-1 flex flex-col overflow-hidden" v-if="!loading">
      <!-- Header -->
      <header class="h-14 bg-surface-container-lowest border-b border-outline-variant flex items-center justify-between px-margin select-none shrink-0 z-10">
        <div class="flex items-center gap-ax-sm">
          <span class="font-body-sm text-body-sm text-secondary">控制台</span>
          <span class="text-outline-variant font-light">/</span>
          <span class="font-body-sm text-body-sm text-primary font-medium">{{ NAV_ITEMS.find(i => i.id === navTab)?.name || '概览' }}</span>
        </div>
        <div class="flex items-center gap-ax-md">
          <div class="font-label-md text-label-md text-secondary border border-outline-variant bg-surface-container-low rounded-lg px-2.5 py-1 flex items-center gap-ax-xs">
            <span class="material-symbols-outlined text-[14px]">schedule</span>
            <span>{{ liveTime }}</span>
          </div>
          <AxButton size="lg" icon="add" @click="openForm(null)">添加 Provider</AxButton>
        </div>
      </header>

      <!-- Content -->
      <main class="flex-1 overflow-y-auto p-margin space-y-ax-lg scrollbar-hide">
        <!-- Error alert -->
        <AxAlert v-if="error" type="error" :dismissible="true" title="操作失败" @dismiss="error = ''">{{ error }}</AxAlert>

        <!-- Status / Overview -->
        <section v-if="navTab === 'status'">
          <div class="flex items-center justify-between mb-ax-md">
            <div>
              <h3 class="font-headline-sm text-headline-sm text-primary">系统概览</h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">当前各 AI 工具的 Provider 连接状态</p>
            </div>
            <div class="flex items-center gap-ax-sm">
              <span class="rounded-full bg-surface-container-low border border-outline-variant text-primary font-label-md text-label-md px-2.5 py-1">
                {{ connectedCount }} / 4 已连接
              </span>
            </div>
          </div>

          <!-- App Tab Bar -->
          <div class="flex gap-ax-xs border-b border-outline-variant mb-ax-md">
            <button
              v-for="app in STATUS_APPS" :key="app.id"
              class="relative flex items-center gap-ax-xs px-ax-md py-ax-sm font-label-md text-label-md transition-all duration-150 cursor-pointer border-b-2 -mb-px"
              :class="statusAppTab === app.id
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-secondary hover:text-primary hover:bg-surface-container-low'"
              @click="statusAppTab = app.id"
            >
              <span class="material-symbols-outlined text-[18px]">{{ app.icon }}</span>
              <span>{{ app.name }}</span>
              <span class="w-2 h-2 rounded-full ml-ax-xs" :class="statuses[app.id]?.current_provider_id ? 'bg-emerald-500' : 'bg-outline'" />
            </button>
          </div>

          <!-- Active Tab Content -->
          <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md">
            <template v-if="statuses[statusAppTab]?.current_provider_id">
              <!-- Connected state -->
              <div class="flex items-start justify-between gap-ax-md mb-ax-md">
                <div class="flex items-center gap-ax-sm">
                  <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <div>
                    <p class="font-label-md text-label-md font-semibold text-primary">已连接</p>
                    <p class="font-body-sm text-body-sm text-secondary mt-0.5">{{ statuses[statusAppTab].current_provider_name }}</p>
                  </div>
                </div>
                <AxButton size="lg" variant="outline" @click="handleClear(statusAppTab)">
                  <span class="material-symbols-outlined text-[16px]">link_off</span>
                  <span>断开</span>
                </AxButton>
              </div>

              <div class="grid grid-cols-3 gap-ax-sm">
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Provider</span>
                  <p class="font-label-md text-label-md text-primary mt-0.5 truncate">{{ statuses[statusAppTab].current_provider_name }}</p>
                </div>
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Model</span>
                  <p class="font-label-md text-label-md text-primary mt-0.5 truncate">{{ statuses[statusAppTab].live_config_status?.model || '-' }}</p>
                </div>
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Base URL</span>
                  <p class="font-label-md text-label-md text-primary mt-0.5 truncate">{{ statuses[statusAppTab].live_config_status?.base_url || '-' }}</p>
                </div>
              </div>

              <!-- 切换 Provider -->
              <div class="mt-ax-sm bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider block mb-ax-xs">切换 Provider</span>
                <AxSelect :options="providerOptions" :placeholder="`选择新 Provider 替换当前连接`" size="lg" trigger-max-width="100%"
                  @update:model-value="(v: string) => handleSwitch(statusAppTab, v)" />
              </div>
            </template>

            <template v-else>
              <!-- Disconnected state -->
              <div class="flex items-center gap-ax-sm mb-ax-md">
                <span class="w-3 h-3 rounded-full bg-outline shrink-0" />
                <div>
                  <p class="font-label-md text-label-md font-semibold text-secondary">未连接</p>
                  <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">选择一个 Provider 进行连接</p>
                </div>
              </div>
              <AxSelect :options="providerOptions" placeholder="选择 Provider" size="lg" trigger-max-width="100%"
                @update:model-value="(v: string) => handleSwitch(statusAppTab, v)" />
            </template>

            <!-- 查看本地配置（折叠面板） -->
            <div class="mt-ax-md border-t border-outline-variant pt-ax-md">
              <button
                class="flex items-center gap-ax-xs font-label-md text-label-md text-secondary hover:text-primary transition-colors cursor-pointer border-0 bg-transparent outline-none"
                @click="toggleAppConfig(statusAppTab)"
              >
                <span class="material-symbols-outlined text-[18px] leading-none transition-transform duration-200" :class="{ 'rotate-90': expandedAppConfig === statusAppTab }">chevron_right</span>
                <span class="material-symbols-outlined text-[16px]">folder_open</span>
                <span>查看本地配置文件</span>
              </button>

              <div v-if="expandedAppConfig === statusAppTab" class="mt-ax-sm border border-outline-variant rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
                <div class="bg-surface-container-highest px-3 py-2 flex items-center gap-2">
                  <span class="material-symbols-outlined text-[14px] text-secondary">home</span>
                  <span class="font-label-md text-[11px] text-secondary font-medium uppercase tracking-wider">全局配置目录</span>
                  <span class="font-body-sm text-[10px] text-outline ml-auto">{{ appConfigs[statusAppTab]?.home_dir || '' }}</span>
                </div>
                <!-- 加载中 -->
                <div v-if="loadingAppConfig === statusAppTab && !appConfigs[statusAppTab]" class="px-4 py-4 flex items-center gap-2">
                  <span class="material-symbols-outlined text-[16px] text-secondary animate-spin">progress_activity</span>
                  <span class="font-body-sm text-[12px] text-secondary">读取配置中...</span>
                </div>
                <!-- 文件列表 -->
                <template v-else-if="appConfigs[statusAppTab]">
                  <div
                    v-for="(file, fi) in appConfigs[statusAppTab]!.files"
                    :key="fi"
                    class="border-t border-outline-variant/50 last:border-b-0"
                  >
                    <button
                      class="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-container-low transition-colors cursor-pointer text-left"
                      :class="{ 'opacity-50': !file.exists }"
                      @click="toggleAppFileExpand(statusAppTab, fi)"
                    >
                      <span class="material-symbols-outlined text-[14px]" :class="file.exists ? 'text-success' : 'text-error'">
                        {{ file.exists ? 'description' : 'error' }}
                      </span>
                      <span class="font-label-md text-[12px] font-medium text-primary truncate">{{ file.label }}</span>
                      <span class="material-symbols-outlined text-[14px] text-secondary ml-auto transition-transform" :class="expandedAppFileKey(`${statusAppTab}-${fi}`) ? 'rotate-180' : ''">expand_more</span>
                    </button>
                    <div v-if="expandedAppFileKey(`${statusAppTab}-${fi}`)" class="px-4 py-3 bg-surface-container-lowest border-t border-outline-variant/30">
                      <AxJsonViewer v-if="file.parsed" :data="file.parsed" :expand-level="2" class="max-h-80 overflow-y-auto" />
                      <pre v-else class="font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all leading-relaxed max-h-80 overflow-y-auto">{{ file.content }}</pre>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- Profiles -->
        <section v-if="navTab === 'profiles'">
          <div class="flex items-center justify-between mb-ax-md">
            <div>
              <h3 class="font-headline-sm text-headline-sm text-primary">任务 Profile</h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">每个 Profile 拥有独立 HOME 目录，可并行使用不同模型</p>
            </div>
            <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-label-md px-2.5 py-1">{{ profiles.length }} 个 Profile</span>
          </div>

          <!-- Create form -->
          <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md mb-ax-md">
            <h4 class="font-label-md text-label-md font-semibold text-primary mb-ax-sm">创建新 Profile</h4>
            <div class="grid grid-cols-[1fr_170px_1fr_auto] gap-ax-sm items-end">
              <AxInput v-model="profileName" placeholder="任务名称，例如 task-a" size="lg" />
              <AxSelect v-model="profileApp" :options="Object.entries(APP_LABELS).map(([v,l]) => ({value:v,label:l}))" size="lg" placeholder="App" />
              <AxSelect v-model="profileProviderId" :options="providerOptions" size="lg" placeholder="选择 Provider" />
              <AxButton size="lg" icon="add" :disabled="providers.length === 0" @click="handleCreateProfile">创建</AxButton>
            </div>
            <!-- App-specific overrides -->
            <div v-if="profileApp === 'claude'" class="mt-ax-sm grid grid-cols-4 gap-ax-sm">
              <AxModelSelect v-model="profileClaudeDefault" :provider-id="profileProviderId" placeholder="默认模型" size="lg" />
              <AxModelSelect v-model="profileClaudeHaiku" :provider-id="profileProviderId" placeholder="Haiku" size="lg" />
              <AxModelSelect v-model="profileClaudeSonnet" :provider-id="profileProviderId" placeholder="Sonnet" size="lg" />
              <AxModelSelect v-model="profileClaudeOpus" :provider-id="profileProviderId" placeholder="Opus" size="lg" />
            </div>
            <div v-if="profileApp === 'codex'" class="mt-ax-sm grid grid-cols-4 gap-ax-sm">
              <AxModelSelect v-model="profileCodexDefault" :provider-id="profileProviderId" placeholder="默认模型" size="lg" />
              <AxModelSelect v-model="profileCodexCatalogModels" :provider-id="profileProviderId" multiple placeholder="选择 Codex 模型..." size="lg" class="col-span-3" />
            </div>
          </div>

          <!-- Profile list -->
          <div v-if="profiles.length === 0" class="text-center font-body-sm text-body-sm text-secondary border border-dashed border-outline-variant rounded-lg p-ax-lg">
            <span class="material-symbols-outlined text-[32px] text-outline mb-ax-sm block">folder_off</span>
            <p>暂无 Profile。创建后会生成独立配置目录和启动命令。</p>
          </div>
          <div v-else class="space-y-ax-md">
            <div v-for="p in profiles" :key="p.id" class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md">
              <div class="flex items-start justify-between gap-ax-md mb-ax-md">
                <div class="flex items-center gap-ax-sm min-w-0 flex-1">
                  <button
                    class="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-secondary hover:bg-surface-container-low transition-colors cursor-pointer border-0 bg-transparent outline-none"
                    :title="'查看本地配置文件'"
                    @click.stop="toggleProfileConfig(p)"
                  >
                    <span class="material-symbols-outlined text-[18px] leading-none transition-transform duration-200" :class="{ 'rotate-90': expandedConfigId === p.id }">chevron_right</span>
                  </button>
                  <div>
                    <h4 class="font-label-md text-label-md font-semibold text-primary">{{ p.name }}</h4>
                    <p class="font-body-sm text-body-sm text-secondary mt-0.5">{{ APP_LABELS[p.app_type] || p.app_type }} · {{ p.provider_name }} · {{ p.provider_model || '-' }}</p>
                  </div>
                </div>
                <div class="flex gap-ax-sm shrink-0">
                  <AxButton size="lg" @click="handleApplyProfile(p.id)">重新写入配置</AxButton>
                  <AxButton size="lg" variant="outline" @click="copyCommand(getCommandForProfile(p))">复制命令</AxButton>
                  <AxButton size="lg" variant="danger" @click="handleDeleteProfile(p.id)">删除</AxButton>
                </div>
              </div>
              <div class="space-y-ax-sm">
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">HOME 目录</span>
                  <code class="block font-label-md text-label-md text-primary mt-0.5 break-all">{{ p.home_dir }}</code>
                </div>
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <div class="flex items-center justify-between mb-ax-xs">
                    <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">启动命令</span>
                    <!-- 平台切换 Tabs -->
                    <div class="flex rounded-lg bg-surface-container-low border border-outline-variant overflow-hidden">
                      <button
                        v-for="plat in COMMAND_PLATFORMS" :key="plat.value"
                        class="font-body-sm text-[11px] px-2 py-0.5 transition-colors cursor-pointer"
                        :class="(profileCommandPlatform[p.id] || 'bash') === plat.value ? 'bg-primary text-on-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-container-low'"
                        @click="profileCommandPlatform[p.id] = plat.value; profileCommandPlatform = { ...profileCommandPlatform }"
                      >{{ plat.label }}</button>
                    </div>
                  </div>
                  <p class="font-body-sm text-[10px] text-secondary mb-1">{{ COMMAND_PLATFORMS.find(plat => plat.value === (profileCommandPlatform[p.id] || 'bash'))?.desc }}</p>
                  <code class="block font-label-md text-label-md text-primary mt-0.5 break-all select-all">{{ getCommandForProfile(p) }}</code>
                </div>

                <!-- 本地配置文件（折叠面板） -->
                <div v-if="expandedConfigId === p.id" class="border border-outline-variant rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
                  <div class="bg-surface-container-highest px-3 py-2 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[14px] text-secondary">folder_open</span>
                    <span class="font-label-md text-[11px] text-secondary font-medium uppercase tracking-wider">本地配置文件</span>
                    <span class="font-body-sm text-[10px] text-outline ml-auto">{{ profileConfigs[p.id]?.home_dir || '' }}</span>
                  </div>
                  <!-- 加载中 -->
                  <div v-if="loadingConfig === p.id && !profileConfigs[p.id]" class="px-4 py-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[16px] text-secondary animate-spin">progress_activity</span>
                    <span class="font-body-sm text-[12px] text-secondary">读取配置中...</span>
                  </div>
                  <!-- 文件列表 -->
                  <template v-else-if="profileConfigs[p.id]">
                    <div
                      v-for="(file, fi) in profileConfigs[p.id]!.files"
                      :key="fi"
                      class="border-t border-outline-variant/50 last:border-b-0"
                    >
                      <button
                        class="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-container-low transition-colors cursor-pointer text-left"
                        :class="{ 'opacity-50': !file.exists }"
                        @click="toggleFileExpand(p.id, fi)"
                      >
                        <span class="material-symbols-outlined text-[14px]" :class="file.exists ? 'text-success' : 'text-error'">
                          {{ file.exists ? 'description' : 'error' }}
                        </span>
                        <span class="font-label-md text-[12px] font-medium text-primary truncate">{{ file.label }}</span>
                        <span class="material-symbols-outlined text-[14px] text-secondary ml-auto transition-transform" :class="expandedFileKey(`${p.id}-${fi}`) ? 'rotate-180' : ''">expand_more</span>
                      </button>
                      <div v-if="expandedFileKey(`${p.id}-${fi}`)" class="px-4 py-3 bg-surface-container-lowest border-t border-outline-variant/30">
                        <AxJsonViewer v-if="file.parsed" :data="file.parsed" :expand-level="2" class="max-h-80 overflow-y-auto" />
                        <pre v-else class="font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all leading-relaxed max-h-80 overflow-y-auto">{{ file.content }}</pre>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Providers -->
        <section v-if="navTab === 'providers'">
          <div class="flex items-center justify-between mb-ax-md">
            <div>
              <h3 class="font-headline-sm text-headline-sm text-primary">Provider 管理</h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">管理 API 接入点，支持多种协议格式</p>
            </div>
            <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-label-md px-2.5 py-1">{{ providers.length }} 个 Provider</span>
          </div>

          <div v-if="providers.length === 0" class="text-center font-body-sm text-body-sm text-secondary border border-dashed border-outline-variant rounded-lg p-ax-lg">
            <span class="material-symbols-outlined text-[32px] text-outline mb-ax-sm block">dns</span>
            <p>暂无 Provider。</p>
            <p class="mt-1">点击右上角「添加 Provider」配置你的第一个 API 接入点</p>
          </div>
          <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-ax-md">
            <div v-for="p in providers" :key="p.id"
              class="bg-surface-container-lowest border rounded-lg p-ax-md transition-colors"
              :class="getActiveApps(p.id).length > 0 ? 'border-primary/40' : 'border-outline-variant'">
              <div class="flex items-center justify-between mb-ax-sm">
                <h4 class="font-label-md text-label-md font-semibold text-primary">{{ p.name }}</h4>
                <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-[11px] px-2 py-0.5">{{ providerTypeLabel(p) }}</span>
              </div>
              <div class="space-y-ax-sm">
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Base URL</span>
                  <code class="block font-label-md text-label-md text-primary mt-0.5 break-all">{{ p.base_url }}</code>
                </div>
                <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">API Key</span>
                  <code class="block font-label-md text-label-md text-primary mt-0.5 break-all">{{ p.api_key }}</code>
                </div>
                <div v-if="p.model" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
                  <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Model</span>
                  <code class="block font-label-md text-label-md text-primary mt-0.5 break-all">{{ p.model }}</code>
                </div>
                <div class="flex flex-wrap gap-ax-xs">
                  <span v-for="f in providerCapabilities(p)" :key="f" class="rounded-full bg-secondary-container/70 text-on-secondary-container font-label-md text-[11px] px-2 py-0.5">{{ API_FORMAT_LABELS[f] || f }}</span>
                  <span v-for="app in getActiveApps(p.id)" :key="app" class="rounded-full bg-primary/10 text-primary font-label-md text-[11px] px-2 py-0.5">{{ APP_LABELS[app] || app }}</span>
                </div>
              </div>
              <div class="flex gap-ax-sm mt-ax-md pt-ax-sm border-t border-outline-variant">
                <AxButton size="lg" variant="outline" @click="openForm(p)">编辑</AxButton>
                <AxButton size="lg" variant="danger" @click="handleDelete(p.id)">删除</AxButton>
              </div>
            </div>
          </div>
        </section>
      </main>

      <!-- Footer -->
      <footer class="h-12 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-between px-margin select-none shrink-0 text-body-sm text-secondary">
        <div class="flex items-center gap-ax-md">
          <div class="flex items-center gap-ax-xs">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{{ providers.length }} Providers · {{ connectedCount }}/4 在线</span>
          </div>
        </div>
        <div class="flex items-center gap-ax-sm">
          <span>CC Switch Web v2.0</span>
          <span class="text-outline-variant">·</span>
          <span>Profile Isolation Mode</span>
        </div>
      </footer>
    </div>

    <!-- Loading -->
    <div v-else class="flex-1 flex items-center justify-center bg-background">
      <div class="text-center space-y-ax-sm">
        <span class="material-symbols-outlined text-[32px] text-primary animate-spin">progress_activity</span>
        <p class="font-body-sm text-body-sm text-on-surface-variant">正在加载配置数据...</p>
      </div>
    </div>
  </div>

  <!-- Provider Form Dialog -->
  <AxDialog v-model="showForm" :title="editingProvider ? '编辑 Provider' : '添加 Provider'" icon="dns" max-width="max-w-3xl">
    <template #default>
      <div class="grid grid-cols-2 gap-ax-md">
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">名称 *</label>
          <AxInput v-model="formName" placeholder="例如：我的 New API" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Provider 类型</label>
          <div class="flex gap-ax-sm">
            <AxSelect v-model="formProviderType" :options="[{value:'custom',label:'自定义'},{value:'newapi',label:'New API'}]" size="lg" class="flex-1" />
            <AxButton size="lg" variant="outline" @click="setNewApiPreset">套用 New API</AxButton>
          </div>
        </div>
        <div class="col-span-2">
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Base URL *</label>
          <AxInput v-model="formBaseUrl" placeholder="https://api.example.com/v1" size="lg" />
          <p class="font-body-sm text-[11px] text-secondary mt-0.5">New API 通常填你的服务地址，协议能力在下方勾选</p>
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">API Key</label>
          <AxInput v-model="formApiKey" :password="true" :placeholder="editingProvider ? '留空保持原 Key' : 'sk-xxxxxxxx'" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">通用默认 Model</label>
          <div class="flex gap-ax-sm">
            <AxModelSelect v-model="formModel" :options="fetchedModels" :provider-id="editingProvider?.id" :base-url="!editingProvider ? formBaseUrl : undefined" :api-key="!editingProvider ? formApiKey : undefined" placeholder="选择或输入模型" size="lg" class="flex-1" />
            <AxButton size="lg" icon="refresh" :loading="fetchingModels" :disabled="!editingProvider && !formBaseUrl" @click="fetchAllModels">
              获取模型{{ fetchedModels.length > 0 ? ` (${fetchedModels.length})` : '' }}
            </AxButton>
          </div>
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">默认 API 格式</label>
          <AxSelect v-model="formApiFormat" :options="API_FORMATS.filter(f => f.value !== 'gemini_native').map(f => ({value:f.value,label:f.label}))" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">协议能力</label>
          <div class="grid grid-cols-2 gap-ax-xs">
            <label v-for="f in API_FORMATS" :key="f.value" class="flex items-center gap-ax-xs font-body-sm text-body-sm text-secondary cursor-pointer">
              <input type="checkbox" :checked="formCapabilities[f.value]" @change="formCapabilities[f.value] = ($event.target as HTMLInputElement).checked" class="rounded border-outline text-primary" />
              {{ f.label }}
            </label>
          </div>
        </div>

        <div class="col-span-2 bg-surface-container-low border border-outline-variant rounded-lg p-ax-md space-y-ax-sm">
          <h4 class="font-label-md text-label-md font-semibold text-primary">Claude 模型映射</h4>
          <div class="grid grid-cols-5 gap-ax-sm">
            <AxModelSelect v-model="formClaudeDefault" :options="fetchedModels" placeholder="默认模型" size="lg" />
            <AxModelSelect v-model="formClaudeSmall" :options="fetchedModels" placeholder="Small/Fast" size="lg" />
            <AxModelSelect v-model="formClaudeHaiku" :options="fetchedModels" placeholder="Haiku" size="lg" />
            <AxModelSelect v-model="formClaudeSonnet" :options="fetchedModels" placeholder="Sonnet" size="lg" />
            <AxModelSelect v-model="formClaudeOpus" :options="fetchedModels" placeholder="Opus" size="lg" />
          </div>
        </div>

        <div class="col-span-2 bg-surface-container-low border border-outline-variant rounded-lg p-ax-md space-y-ax-sm">
          <h4 class="font-label-md text-label-md font-semibold text-primary">Codex 模型目录</h4>
          <p class="font-body-sm text-[11px] text-secondary">选择 Codex 可用的模型列表，支持多选</p>
          <div class="grid grid-cols-2 gap-ax-sm">
            <AxModelSelect v-model="formCodexDefault" :options="fetchedModels" placeholder="Codex 默认模型" size="lg" />
            <AxModelSelect v-model="formCodexCatalogModels" :options="fetchedModels" multiple placeholder="选择 Codex 模型..." size="lg" />
          </div>
        </div>
      </div>
    </template>
    <template #footer="{ close }">
      <AxButton size="lg" variant="outline" @click="close">取消</AxButton>
      <AxButton size="lg" @click="handleSave(); close()">{{ editingProvider ? '保存' : '添加' }}</AxButton>
    </template>
  </AxDialog>
</template>
