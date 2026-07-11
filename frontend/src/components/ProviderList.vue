<script setup lang="ts">
import { api, type Provider, type AppStatus } from '../api'
import { APP_LABELS, API_FORMAT_LABELS, parseExtra } from '../constants'
import AxButton from './ui/AxButton.vue'
import { useNotify } from './ui'

const props = defineProps<{
  providers: Provider[]
  statuses: Record<string, AppStatus>
}>()

const emit = defineEmits<{
  edit: [provider: Provider]
  refresh: []
  addProvider: []
}>()

const { triggerNotify } = useNotify()

function providerTypeLabel(p: Provider) {
  const t = parseExtra(p.extra_config).provider_type
  return t === 'newapi' ? 'New API' : (API_FORMAT_LABELS[p.api_format] || p.api_format)
}

function providerCapabilities(p: Provider) {
  const c = parseExtra(p.extra_config).capabilities || {}
  const e = Object.entries(c).filter(([, v]) => v).map(([f]) => f)
  return e.length ? e : [p.api_format]
}

function getActiveApps(pid: string) {
  return Object.entries(props.statuses).filter(([, s]) => s.current_provider_id === pid).map(([a]) => a)
}

async function handleDelete(id: string) {
  if (!confirm('确定删除此 Provider？')) return
  const res = await api.deleteProvider(id)
  if (res.success) {
    emit('refresh')
    triggerNotify('Provider 已删除', 'info')
  }
}
</script>

<template>
  <section>
    <div class="flex items-center justify-between mb-ax-md">
      <div>
        <h3 class="font-headline-sm text-headline-sm text-primary">Provider 管理</h3>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">管理 API 接入点，支持多种协议格式</p>
      </div>
      <div class="flex items-center gap-ax-sm">
        <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-label-md px-2.5 py-1">
          {{ providers.length }} 个 Provider
        </span>
        <AxButton size="lg" icon="add" @click="emit('addProvider')">添加 Provider</AxButton>
      </div>
    </div>

    <div v-if="providers.length === 0"
      class="text-center font-body-sm text-body-sm text-secondary border border-dashed border-outline-variant rounded-lg p-ax-lg">
      <span class="material-symbols-outlined text-[32px] text-outline mb-ax-sm block">dns</span>
      <p>暂无 Provider。</p>
      <p class="mt-1">点击右上角「添加 Provider」配置你的第一个 API 接入点</p>
    </div>
    <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-ax-sm">
      <div v-for="p in providers" :key="p.id"
        class="bg-surface-container-lowest border rounded-lg p-ax-sm transition-colors flex flex-col h-full"
        :class="getActiveApps(p.id).length > 0 ? 'border-primary/40' : 'border-outline-variant'">
        <!-- 标题行 -->
        <div class="flex items-center justify-between mb-ax-xs">
          <h4 class="font-label-md text-label-md font-semibold text-primary truncate">{{ p.name }}</h4>
          <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-[10px] px-1.5 py-0.5 shrink-0">
            {{ providerTypeLabel(p) }}
          </span>
        </div>
        <!-- 内容区域 flex-1 -->
        <div class="flex-1">
          <div class="space-y-0.5 mb-ax-xs">
            <div class="flex items-center gap-ax-xs text-[11px]">
              <span class="text-secondary shrink-0 w-14">Base URL</span>
              <code class="text-primary truncate">{{ p.base_url }}</code>
            </div>
            <div class="flex items-center gap-ax-xs text-[11px]">
              <span class="text-secondary shrink-0 w-14">API Key</span>
              <code class="text-primary truncate">{{ p.api_key }}</code>
            </div>
            <div v-if="p.model" class="flex items-center gap-ax-xs text-[11px]">
              <span class="text-secondary shrink-0 w-14">Model</span>
              <code class="text-primary truncate">{{ p.model }}</code>
            </div>
          </div>
          <!-- 标签 -->
          <div class="flex flex-wrap gap-ax-xs mb-ax-xs">
            <span v-for="f in providerCapabilities(p)" :key="f"
              class="rounded-full bg-secondary-container/70 text-on-secondary-container font-label-md text-[10px] px-1.5 py-0.5">
              {{ API_FORMAT_LABELS[f] || f }}
            </span>
            <span v-for="app in getActiveApps(p.id)" :key="app"
              class="rounded-full bg-primary/10 text-primary font-label-md text-[10px] px-1.5 py-0.5">
              {{ APP_LABELS[app] || app }}
            </span>
          </div>
        </div>
        <!-- 按钮 -->
        <div class="flex gap-ax-xs pt-ax-xs border-t border-outline-variant">
          <AxButton size="sm" variant="outline" icon="edit" @click="emit('edit', p)">编辑</AxButton>
          <AxButton size="sm" variant="danger" icon="delete" @click="handleDelete(p.id)">删除</AxButton>
        </div>
      </div>
    </div>
  </section>
</template>