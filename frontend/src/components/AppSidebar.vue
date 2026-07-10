<script setup lang="ts">
import { NAV_ITEMS } from '../constants'

defineProps<{
  navTab: string
}>()

const emit = defineEmits<{
  'update:navTab': [tab: string]
}>()
</script>

<template>
  <aside
    class="w-60 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between py-ax-md px-ax-sm select-none z-10 shrink-0">
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
          @click="emit('update:navTab', item.id)">
          <span class="material-symbols-outlined"
            :style="{ fontVariationSettings: navTab === item.id ? '\'FILL\' 1' : '\'FILL\' 0' }">{{ item.icon }}</span>
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
</template>
