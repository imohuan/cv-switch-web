<script setup lang="ts">
defineProps<{
  navTab: string
  providersCount: number
  connectedCount: number
  liveTime: string
}>()

const emit = defineEmits<{
  refresh: []
  addProvider: []
}>()
</script>

<template>
  <header class="h-14 bg-surface-container-lowest border-b border-outline-variant flex items-center justify-between px-margin select-none shrink-0">
    <div class="flex items-center gap-ax-md">
      <h1 class="font-headline-sm text-headline-sm text-primary">
        {{ navTab === 'status' ? '系统概览' : navTab === 'profiles' ? 'Profile 预设' : 'Provider 管理' }}
      </h1>
      <span class="text-body-sm text-on-surface-variant/60">{{ liveTime }}</span>
    </div>
    <div class="flex items-center gap-ax-sm">
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-label-md font-label-md bg-surface-container-low border border-outline-variant text-secondary hover:text-primary hover:bg-surface-container transition-colors cursor-pointer"
        @click="emit('refresh')">
        <span class="material-symbols-outlined text-[16px]">refresh</span>
        <span>刷新</span>
      </button>
      <button
        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-label-md font-label-md bg-primary text-on-primary hover:bg-primary/90 transition-colors cursor-pointer"
        @click="emit('addProvider')">
        <span class="material-symbols-outlined text-[16px]">add</span>
        <span>添加 Provider</span>
      </button>
    </div>
  </header>
</template>
