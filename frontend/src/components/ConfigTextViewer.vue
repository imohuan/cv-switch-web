<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  content: string
  /** 写入时设置的键值对，用 value 匹配行 */
  changes?: Record<string, string>
}>()

const lines = computed(() => props.content.split("\n"))

const changedLineSet = computed(() => {
  const set = new Set<number>()
  if (!props.changes) return set
  const values = Object.values(props.changes).filter(Boolean)
  if (values.length === 0) return set
  const lineArr = lines.value
  for (let i = 0; i < lineArr.length; i++) {
    for (const val of values) {
      if (lineArr[i].includes(val)) {
        set.add(i + 1) // 1-based
        break
      }
    }
  }
  return set
})

const changedCount = computed(() => changedLineSet.value.size)
</script>

<template>
  <div class="max-h-80 overflow-auto rounded-md border border-outline-variant/50 bg-surface-container-lowest font-mono text-[11px] leading-relaxed">
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="flex min-w-full"
      :class="changedLineSet.has(index + 1) ? 'bg-green-100/80 shadow-[inset_3px_0_0_#22c55e]' : ''"
    >
      <span class="w-10 shrink-0 select-none border-r border-outline-variant/40 px-2 text-right text-outline">
        {{ index + 1 }}
      </span>
      <span class="min-w-0 flex-1 whitespace-pre-wrap break-all px-3 text-on-surface">{{ line || '\u00a0' }}</span>
    </div>
  </div>
</template>
