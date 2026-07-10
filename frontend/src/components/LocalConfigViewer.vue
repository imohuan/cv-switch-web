<script setup lang="ts">
import { computed } from 'vue'
import { isJsonFile, changeCount, type ConfigFile } from '../constants'
import AxJsonViewer from './ui/AxJsonViewer.vue'
import ConfigTextViewer from './ConfigTextViewer.vue'

const props = defineProps<{
  configData: { home_dir: string; app_type: string; files: ConfigFile[] } | null
  loading: string | null
  label: string
  expandedFiles: Set<string>
  fileKeyPrefix: string
}>()

const emit = defineEmits<{
  'toggle:file': [key: string]
}>()

function expanded(key: string): boolean {
  return props.expandedFiles.has(key)
}
</script>

<template>
  <div class="mt-ax-sm border border-outline-variant rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
    <div class="bg-surface-container-highest px-3 py-2 flex items-center gap-2">
      <span class="material-symbols-outlined text-[14px] text-secondary">home</span>
      <span class="font-label-md text-[11px] text-secondary font-medium uppercase tracking-wider">{{ label }}</span>
      <span class="font-body-sm text-[10px] text-outline ml-auto">{{ configData?.home_dir || '' }}</span>
    </div>
    <!-- 加载中 -->
    <div v-if="loading && !configData" class="px-4 py-4 flex items-center gap-2">
      <span class="material-symbols-outlined text-[16px] text-secondary animate-spin">progress_activity</span>
      <span class="font-body-sm text-[12px] text-secondary">读取配置中...</span>
    </div>
    <!-- 文件列表 -->
    <template v-else-if="configData">
      <div v-for="(file, fi) in configData.files" :key="fi" class="border-t border-outline-variant/50 last:border-b-0">
        <div
          class="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-container-low transition-colors cursor-pointer text-left"
          :class="{ 'opacity-50': !file.exists }" role="button" tabindex="0"
          @click="emit('toggle:file', `${fileKeyPrefix}-${fi}`)"
          @keydown.enter.prevent="emit('toggle:file', `${fileKeyPrefix}-${fi}`)"
          @keydown.space.prevent="emit('toggle:file', `${fileKeyPrefix}-${fi}`)">
          <span class="material-symbols-outlined text-[14px]"
            :class="file.exists ? 'text-success' : 'text-error'">
            {{ file.exists ? 'description' : 'error' }}
          </span>
          <span class="font-label-md text-[12px] font-medium text-primary truncate min-w-0">{{ file.label }}</span>
          <span v-if="changeCount(file)"
            class="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-label-md text-[10px] font-semibold text-amber-700">
            本次改动 {{ changeCount(file) }} 处
          </span>
          <div class="ml-auto flex items-center gap-1 shrink-0">
            <span class="material-symbols-outlined text-[14px] text-secondary transition-transform"
              :class="expanded(`${fileKeyPrefix}-${fi}`) ? 'rotate-180' : ''">expand_more</span>
          </div>
        </div>
        <div v-if="expanded(`${fileKeyPrefix}-${fi}`)"
          class="px-4 py-3 bg-surface-container-lowest border-t border-outline-variant/30">
          <AxJsonViewer v-if="isJsonFile(file)" :data="file.parsed" :changed-values="file.changes" :is-root="true" :expand-level="2" class="max-h-80 overflow-y-auto" />
          <ConfigTextViewer v-else :content="file.content" :changes="file.changes" />
        </div>
      </div>
    </template>
  </div>
</template>
