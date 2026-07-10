<script setup lang="ts">
import { ref } from 'vue'
import { STATUS_APPS, APP_LABELS } from '../constants'
import { api, type Provider, type AppStatus } from '../api'
import { useNotify } from './ui'
import AxSelect from './ui/AxSelect.vue'
import AxButton from './ui/AxButton.vue'
import WorkBuddyModels from './WorkBuddyModels.vue'
import LocalConfigViewer from './LocalConfigViewer.vue'
import { useConfigViewer } from '../composables/useConfigViewer'

const props = defineProps<{
  providers: Provider[]
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

const statusAppTab = ref<string>('codex')
const workBuddyReadable = ref(false)

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
    <div class="bg-surface-container-lowest border border-outline-variant rounded-lg">
      <!-- Tab bar -->
      <div class="flex items-center gap-0 overflow-x-auto border-b border-outline-variant px-ax-md">
        <button v-for="app in STATUS_APPS" :key="app.id"
          class="relative flex items-center gap-ax-xs px-ax-md py-ax-sm font-label-md text-label-md transition-all duration-150 cursor-pointer border-b-2 -mb-px"
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

          <!-- 切换 Provider -->
          <div class="mt-ax-sm bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
            <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider block mb-ax-xs">切换 Provider</span>
            <AxSelect :options="providerOptions" :placeholder="`选择新 Provider 替换当前连接`" size="lg"
              trigger-max-width="100%" @update:model-value="(v: string) => handleSwitch(statusAppTab, v)" />
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
