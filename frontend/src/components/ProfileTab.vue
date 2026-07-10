<script setup lang="ts">
import { ref } from 'vue'
import AxModelSelect from './AxModelSelect.vue'
import AxButton from './ui/AxButton.vue'
import type { Profile } from '../api'

const props = defineProps<{
  providers: any[]
  profiles: Profile[]
}>()

const emit = defineEmits<{
  apply: [profileId: string]
  save: [data: { name: string; targets: ProfileTargetData[] }]
  delete: [profileId: string]
}>()

const PLATFORMS = [
  { id: 'codex', label: 'Codex CLI', icon: 'terminal' },
  { id: 'claude', label: 'Claude Code', icon: 'auto_awesome' },
  { id: 'gemini', label: 'Gemini CLI', icon: 'diamond' },
  { id: 'opencode', label: 'OpenCode', icon: 'code' },
  { id: 'workbuddy', label: 'WorkBuddy', icon: 'deployed_code' },
] as const

interface ProfileTargetData {
  appType: string
  model: string
  claudeHaiku?: string
  claudeSonnet?: string
  claudeOpus?: string
  codexModels?: string[]
}

// ---- 平台多选（Dialog 内） ----
const selectedPlatforms = ref<string[]>([])

function togglePlatform(id: string) {
  const idx = selectedPlatforms.value.indexOf(id)
  if (idx >= 0) selectedPlatforms.value.splice(idx, 1)
  else selectedPlatforms.value.push(id)
}

function isPlatformSelected(id: string) {
  return selectedPlatforms.value.includes(id)
}

// ---- 每个平台的配置 ----
const platformConfigs = ref<Record<string, {
  model: string
  claudeHaiku: string
  claudeSonnet: string
  claudeOpus: string
  codexModels: string[]
}>>({})

function initPlatformConfigs() {
  const configs: Record<string, any> = {}
  for (const p of PLATFORMS) {
    configs[p.id] = { model: '', claudeHaiku: '', claudeSonnet: '', claudeOpus: '', codexModels: [] }
  }
  platformConfigs.value = configs
}
initPlatformConfigs()

// ---- Dialog ----
const showDialog = ref(false)
const editingProfileId = ref<string | null>(null)
const profileName = ref('')

function openCreateDialog() {
  editingProfileId.value = null
  profileName.value = ''
  selectedPlatforms.value = []
  initPlatformConfigs()
  showDialog.value = true
}

function openEditDialog(profile: Profile) {
  editingProfileId.value = profile.id
  profileName.value = profile.name
  selectedPlatforms.value = []
  initPlatformConfigs()
  showDialog.value = true
}

function handleSave() {
  if (!profileName.value.trim()) return
  const targets: ProfileTargetData[] = []
  for (const p of PLATFORMS) {
    if (!isPlatformSelected(p.id)) continue
    const cfg = platformConfigs.value[p.id]
    const t: ProfileTargetData = { appType: p.id, model: cfg.model }
    if (p.id === 'claude') { t.claudeHaiku = cfg.claudeHaiku; t.claudeSonnet = cfg.claudeSonnet; t.claudeOpus = cfg.claudeOpus }
    if (p.id === 'codex') { t.codexModels = cfg.codexModels }
    targets.push(t)
  }
  if (targets.length === 0) return
  emit('save', { name: profileName.value.trim(), targets })
  showDialog.value = false
}

function handleApply() {
  emit('apply', '__all__')
}
</script>
<template>
  <div>
    <!-- 头部 -->
    <div class="flex items-center justify-between mb-ax-md">
      <div>
        <h3 class="font-headline-sm text-headline-sm text-primary">Profile 预设</h3>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">为每个平台选择模型，支持统一应用</p>
      </div>
      <AxButton size="lg" icon="add" @click="openCreateDialog">新建 Profile</AxButton>
    </div>

    <!-- 空状态 -->
    <div v-if="profiles.length === 0"
      class="text-center font-body-sm text-body-sm text-secondary border border-dashed border-outline-variant rounded-lg p-ax-lg">
      <span class="material-symbols-outlined text-[32px] text-outline mb-ax-sm block">folder_off</span>
      <p>暂无 Profile 预设。</p>
      <p class="mt-1">点击「新建 Profile」配置你的第一个平台预设</p>
    </div>

    <!-- Profile 列表 -->
    <div v-else class="space-y-ax-md">
      <div v-for="profile in profiles" :key="profile.id"
        class="bg-surface-container-lowest border border-outline-variant rounded-xl p-ax-md">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-ax-sm mb-ax-sm">
              <h4 class="font-headline-sm text-headline-sm text-primary">{{ profile.name }}</h4>
              <span class="rounded-full bg-purple-50 text-purple-700 font-label-md text-[11px] px-2 py-0.5 border border-purple-200">统一预设</span>
            </div>
            <div class="space-y-ax-xs">
              <div class="flex items-center gap-ax-sm text-body-sm text-secondary bg-surface-container-low rounded-lg px-ax-sm py-ax-xs">
                <span class="material-symbols-outlined text-[14px]">terminal</span>
                <span class="font-medium w-24">Codex CLI</span>
                <span class="text-outline-variant">→</span>
                <code class="text-[11px]">gpt-4o</code>
              </div>
              <div class="flex items-center gap-ax-sm text-body-sm text-secondary bg-surface-container-low rounded-lg px-ax-sm py-ax-xs">
                <span class="material-symbols-outlined text-[14px]">auto_awesome</span>
                <span class="font-medium w-24">Claude Code</span>
                <span class="text-outline-variant">→</span>
                <code class="text-[11px]">claude-sonnet-4</code>
              </div>
            </div>
          </div>
          <div class="flex gap-ax-sm ml-ax-md">
            <AxButton size="lg" @click="handleApply">应用</AxButton>
            <AxButton size="lg" variant="outline" @click="openEditDialog(profile)">编辑</AxButton>
            <AxButton size="lg" variant="danger" @click="$emit('delete', profile.id)">删除</AxButton>
          </div>
        </div>
      </div>
    </div>
  </div>
    <!-- ====== 新建/编辑 Profile Dialog ====== -->
  <div v-if="showDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showDialog = false">
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl w-full max-w-3xl flex flex-col" style="max-height: 85vh" @click.stop>
      <!-- 固定标题栏 -->
      <div class="flex items-center justify-between px-ax-md py-ax-sm border-b border-outline-variant shrink-0">
        <h3 class="font-headline-sm text-headline-sm text-primary">{{ editingProfileId ? '编辑 Profile' : '新建 Profile' }}</h3>
        <button @click="showDialog = false" class="w-8 h-8 flex items-center justify-center text-secondary hover:bg-surface-container-low rounded-lg transition-colors">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- 可滚动中间区域 -->
      <div class="overflow-y-auto flex-1 px-ax-lg py-ax-md space-y-ax-md">
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Profile 名称 *</label>
          <input v-model="profileName" required placeholder="例如：日常开发、省钱模式"
            class="w-full h-7 px-3 rounded-md border border-outline-variant bg-surface-container-low text-label-md text-primary focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-secondary" />
        </div>

        <!-- 平台多选 -->
        <div>
          <label class="block font-label-md text-[11px] text-secondary mb-ax-xs uppercase tracking-wider">选择要配置的平台</label>
          <div class="flex flex-wrap gap-ax-xs">
            <button type="button" v-for="plat in PLATFORMS" :key="plat.id"
              class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-label-md text-label-md transition-colors cursor-pointer border"
              :class="isPlatformSelected(plat.id) ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-surface-container-lowest text-secondary hover:bg-surface-container-low hover:text-primary border-outline-variant'"
              @click="togglePlatform(plat.id)">
              <span class="material-symbols-outlined text-[16px]">{{ plat.icon }}</span>
              {{ plat.label }}
            </button>
          </div>
        </div>

        <p v-if="selectedPlatforms.length === 0" class="text-center font-body-sm text-[11px] text-secondary py-ax-md">
          请在上方选择需要配置的平台
        </p>

        <!-- Codex -->
        <div v-if="isPlatformSelected('codex')" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center gap-ax-sm mb-ax-sm">
            <span class="material-symbols-outlined text-[16px] text-primary">terminal</span>
            <span class="font-label-md text-label-md font-semibold text-primary">Codex CLI</span>
          </div>
          <div class="mb-ax-sm">
            <AxModelSelect v-model="platformConfigs.codex.model" placeholder="默认模型（来自所有 Provider）" size="lg" />
          </div>
          <AxModelSelect v-model="platformConfigs.codex.codexModels" multiple placeholder="模型列表（多选，来自所有 Provider）" size="lg" />
          <p class="font-body-sm text-[10px] text-secondary mt-0.5">这些模型将出现在 Codex 的模型选择器中</p>
        </div>

        <!-- Claude -->
        <div v-if="isPlatformSelected('claude')" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center gap-ax-sm mb-ax-sm">
            <span class="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
            <span class="font-label-md text-label-md font-semibold text-primary">Claude Code</span>
          </div>
          <div class="mb-ax-sm">
            <AxModelSelect v-model="platformConfigs.claude.model" placeholder="默认模型（来自所有 Provider）" size="lg" />
          </div>
          <div class="grid grid-cols-3 gap-ax-sm">
            <AxModelSelect v-model="platformConfigs.claude.claudeHaiku" placeholder="Haiku" size="lg" />
            <AxModelSelect v-model="platformConfigs.claude.claudeSonnet" placeholder="Sonnet" size="lg" />
            <AxModelSelect v-model="platformConfigs.claude.claudeOpus" placeholder="Opus" size="lg" />
          </div>
        </div>

        <!-- Gemini -->
        <div v-if="isPlatformSelected('gemini')" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center gap-ax-sm mb-ax-sm">
            <span class="material-symbols-outlined text-[16px] text-primary">diamond</span>
            <span class="font-label-md text-label-md font-semibold text-primary">Gemini CLI</span>
          </div>
          <AxModelSelect v-model="platformConfigs.gemini.model" placeholder="模型（来自所有 Provider）" size="lg" />
        </div>

        <!-- OpenCode -->
        <div v-if="isPlatformSelected('opencode')" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center gap-ax-sm mb-ax-sm">
            <span class="material-symbols-outlined text-[16px] text-primary">code</span>
            <span class="font-label-md text-label-md font-semibold text-primary">OpenCode</span>
          </div>
          <AxModelSelect v-model="platformConfigs.opencode.model" placeholder="模型（来自所有 Provider）" size="lg" />
        </div>

        <!-- WorkBuddy -->
        <div v-if="isPlatformSelected('workbuddy')" class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center gap-ax-sm mb-ax-sm">
            <span class="material-symbols-outlined text-[16px] text-primary">deployed_code</span>
            <span class="font-label-md text-label-md font-semibold text-primary">WorkBuddy</span>
          </div>
          <AxModelSelect v-model="platformConfigs.workbuddy.model" placeholder="模型（来自所有 Provider）" size="lg" />
          <div class="mt-ax-sm bg-amber-50 border border-amber-200 rounded-lg p-ax-xs">
            <p class="font-body-sm text-[11px] text-amber-800 flex items-center gap-1">
              <span class="material-symbols-outlined text-[14px]">info</span>
              应用时写入 <code class="bg-amber-100 px-1 rounded text-[10px]">%USERPROFILE%\.workbuddy\models.json</code>
            </p>
          </div>
        </div>
      </div>

      <!-- 固定底部按钮 -->
      <div class="flex justify-end gap-ax-sm px-ax-lg py-ax-sm border-t border-outline-variant shrink-0">
        <AxButton size="lg" variant="outline" @click="showDialog = false">取消</AxButton>
        <AxButton size="lg" type="submit" @click="handleSave">保存</AxButton>
      </div>
    </div>
  </div>
</template>



