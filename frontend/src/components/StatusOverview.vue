<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { STATUS_APPS, APP_LABELS } from '../constants'
import { api, type Provider, type Profile, type AppStatus } from '../api'
import { useNotify } from './ui'
import AxSelect from './ui/AxSelect.vue'
import AxSwitch from './ui/AxSwitch.vue'
import AxButton from './ui/AxButton.vue'
import WorkBuddyModels from './WorkBuddyModels.vue'
import LocalConfigViewer from './LocalConfigViewer.vue'
import { useConfigViewer } from '../composables/useConfigViewer'
async function handleApplyProfile(profileId: string) {
  const res = await api.applyProfile(profileId, statusAppTab.value)
  if (res.success) {
    emit('refresh')
    triggerNotify('Profile 已应用', 'success')
  } else {
    triggerNotify(res.error || '应用失败', 'error')
  }
}

const props = defineProps<{
  providers: Provider[]
  profiles: Profile[]
  statuses: Record<string, AppStatus>
  providerOptions: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { triggerNotify } = useNotify()
const {
  expandedAppConfig, appConfigs, loadingAppConfig, expandedAppFiles,
  toggleAppConfig, toggleAppFileExpand, expandedAppFileKey, loadAppConfig,
} = useConfigViewer()


const statusAppTab = ref<string>(localStorage.getItem('statusAppTab') || 'codex')
watch(statusAppTab, (v) => localStorage.setItem('statusAppTab', v))
const profileOptions = computed(() => {
  return props.profiles
    .filter(p => {
      try {
        const extra = JSON.parse(p.extra_config || '{}')
        if (extra.targets && Array.isArray(extra.targets)) {
          return extra.targets.some((t: any) => t.app_type === statusAppTab.value)
        }
        return true
      } catch { return true }
    })
    .map(p => ({ value: p.id, label: p.name }))
})
const workBuddyReadable = ref(false)
// 虚拟账号状态从后端 props 同步
const virtualAccountEnabled = computed(() =>
  props.statuses['codex']?.virtual_account_enabled ?? false
)
const virtualAccountLoading = ref(false)

async function handleToggleVirtualAccount(enabled: boolean) {
  virtualAccountLoading.value = true
  try {
    const res = await api.toggleVirtualAccount(enabled)
    if (res.success) {
      triggerNotify(res.message || (enabled ? '虚拟账号已启用' : '虚拟账号已禁用'), 'success')
      emit('refresh')
    } else {
      triggerNotify(res.error || '操作失败', 'error')
    }
  } catch (e: any) {
    triggerNotify(e.message || '操作失败', 'error')
  } finally {
    virtualAccountLoading.value = false
  }
}

async function handleSwitch(appType: string, providerId: string) {
  const res = await api.switchProvider(appType, providerId)
  if (res.success) {
    await emit('refresh')
    triggerNotify(`已切换到 ${props.providers.find(p => p.id === providerId)?.name || providerId}`, 'success')
  }
}

async function handleClear(appType: string) {
  const res = await api.clearProvider(appType)
  if (res.success) {
    await emit('refresh')
    triggerNotify(`${APP_LABELS[appType] || appType} 已断开`, 'info')
  }
}
</script>

<template>
  <section>
    <div class="flex items-center justify-between mb-ax-md">
      <div>
        <h3 class="font-headline-sm text-headline-sm text-primary">系统概览</h3>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">管理各 App 的 Provider 连接状态</p>
      </div>
    </div>

    <!-- App Tabs -->
    <div class="flex flex-col gap-ax-md">
      <!-- Tab bar -->
      <div class="flex items-center gap-0 overflow-x-auto overflow-y-hidden flex-nowrap border border-outline-variant rounded-lg bg-surface-container-lowest px-ax-md">
        <button v-for="app in STATUS_APPS" :key="app.id"
          class="relative flex items-center gap-ax-xs px-ax-md py-ax-sm font-label-md text-label-md whitespace-nowrap transition-all duration-150 cursor-pointer border-b-2 -mb-px"
          :class="statusAppTab === app.id
            ? 'border-primary text-primary font-semibold'
            : 'border-transparent text-secondary hover:text-primary hover:bg-surface-container-low'"
          @click="statusAppTab = app.id">
          <span class="material-symbols-outlined text-[18px]">{{ app.icon }}</span>
          <span>{{ app.name }}</span>
          <span class="w-2 h-2 rounded-full ml-ax-xs" :class="app.id === 'workbuddy'
            ? (workBuddyReadable ? 'bg-emerald-500' : 'bg-outline')
            : (statuses[app.id]?.current_provider_id ? 'bg-emerald-500' : 'bg-outline')" />
        </button>
      </div>

      <!-- Active Provider Tab Content -->
      <div v-if="statusAppTab !== 'workbuddy'"
        class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md">
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

          <!-- 切换 Profile -->
          <div class="mt-ax-sm bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
            <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider block mb-ax-xs">切换 Profile</span>
            <AxSelect :options="profileOptions" :placeholder="`选择 Profile 替换当前连接`" size="lg"
              trigger-max-width="100%" @update:model-value="(v: string) => handleApplyProfile(v)" />
          </div>
        </template>

        <template v-else>
          <!-- Disconnected state -->
          <div class="flex items-center gap-ax-sm mb-ax-md">
            <span class="w-3 h-3 rounded-full bg-outline shrink-0" />
            <div>
              <p class="font-label-md text-label-md font-semibold text-secondary">未连接</p>
              <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">选择一个 Profile 进行连接</p>
            </div>
          </div>
          <AxSelect :options="profileOptions" placeholder="选择 Profile" size="lg" trigger-max-width="100%"
            @update:model-value="(v: string) => handleApplyProfile(v)" />
        </template>

        <!-- 虚拟账号（仅 Codex） -->
        <div v-if="statusAppTab === 'codex'" class="mt-ax-sm bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-ax-sm">
              <span class="material-symbols-outlined text-[16px] text-primary">account_circle</span>
              <div>
                <span class="font-label-md text-label-md font-semibold text-primary">虚拟账号</span>
                <p class="font-body-sm text-[11px] text-secondary mt-0.5">管理 Codex 登录身份与路由配置</p>
              </div>
            </div>
            <AxSwitch
            :model-value="virtualAccountEnabled"
            :disabled="virtualAccountLoading"
            size="md"
            @update:model-value="handleToggleVirtualAccount"
          />
          </div>
        </div>

        <!-- 查看本地配置 -->
        <div class="mt-ax-md border-t border-outline-variant pt-ax-md">
          <button
            class="flex items-center gap-ax-xs font-label-md text-label-md text-secondary hover:text-primary transition-colors cursor-pointer border-0 bg-transparent outline-none"
            @click="toggleAppConfig(statusAppTab)">
            <span class="material-symbols-outlined text-[18px] leading-none transition-transform duration-200"
              :class="{ 'rotate-90': expandedAppConfig === statusAppTab }">chevron_right</span>
            <span class="material-symbols-outlined text-[16px]">folder_open</span>
            <span>查看本地配置文件</span>
          </button>

          <div v-if="expandedAppConfig === statusAppTab">
            <LocalConfigViewer
              :config-data="appConfigs[statusAppTab]"
              :loading="loadingAppConfig"
              label="全局配置目录"
              :expanded-files="expandedAppFiles"
              :file-key-prefix="statusAppTab"
              @toggle:file="(key: string) => {
                const parts = key.split('-')
                toggleAppFileExpand(parts[0], Number(parts[1]))
              }"
            />
          </div>
        </div>
      </div>

      <div v-show="statusAppTab === 'workbuddy'">
        <WorkBuddyModels @status-change="workBuddyReadable = $event" />
      </div>
    </div>
  </section>
</template>
