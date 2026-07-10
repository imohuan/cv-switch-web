<script setup lang="ts">
defineProps<{
  providersCount: number
  connectedCount: number
}>()
</script>

<template>
  <footer class="h-12 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-between px-margin select-none shrink-0 text-body-sm text-secondary">
    <div class="flex items-center gap-ax-md">
      <div class="flex items-center gap-ax-xs">
        <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>{{ providersCount }} Providers · {{ connectedCount }}/4 在线</span>
      </div>
    </div>
    <div class="flex items-center gap-ax-sm">
      <span>CC Switch Web v2.0</span>
      <span class="text-outline-variant">·</span>
      <span>Profile Isolation Mode</span>
    </div>
  </footer>
</template>
