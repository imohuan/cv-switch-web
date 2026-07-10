<script setup lang="ts">
import { ref, computed } from "vue"
import AxDropdown from "./ui/AxDropdown.vue"
import AxTooltip from "./ui/AxTooltip.vue"
import type { ControlSize } from "./ui/types"

export interface GroupedModel {
  value: string
  label: string
  group: string
}

const props = withDefaults(defineProps<{
  modelValue?: string | string[]
  options?: GroupedModel[]
  multiple?: boolean
  placeholder?: string
  size?: ControlSize
}>(), {
  modelValue: "",
  options: () => [],
  multiple: false,
  placeholder: "选择模型",
  size: "lg",
})

const emit = defineEmits<{ "update:modelValue": [v: string | string[]] }>()

const open = ref(false)
const activeGroup = ref("")

// 按分组归类
const grouped = computed(() => {
  const map = new Map<string, GroupedModel[]>()
  for (const m of props.options) {
    const g = m.group || "默认"
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(m)
  }
  return map
})

const groups = computed(() => [...grouped.value.keys()])

// 初始化默认分组
if (groups.value.length > 0 && !activeGroup.value) {
  activeGroup.value = groups.value[0]
}

const currentGroupModels = computed(() => grouped.value.get(activeGroup.value) || [])

const currentValues = computed<(string | number)[]>(() => {
  if (props.multiple) return Array.isArray(props.modelValue) ? props.modelValue : []
  return props.modelValue && props.modelValue !== "" ? [props.modelValue as string] : []
})

const SIZE_CLASSES: Record<string, string> = {
  xs: "h-[18px] px-1.5 py-px text-body-sm",
  sm: "h-5 px-2 py-0.5 text-body-sm",
  md: "h-6 px-2.5 py-1 text-label-md",
  lg: "h-7 px-3 py-1.5 text-label-md",
}

const MULTI_SIZE_CLASSES: Record<string, string> = {
  xs: "px-1.5 py-px text-body-sm",
  sm: "px-2 py-0.5 text-body-sm",
  md: "px-2.5 py-1 text-label-md",
  lg: "px-3 py-1.5 text-label-md",
}

const hasValue = computed(() => currentValues.value.length > 0)

const currentLabels = computed(() => {
  return currentValues.value.map(v => {
    const raw = String(v)
    // 解析合成 key "group::value" 或纯 value
    const sep = raw.indexOf("::")
    let group = ""
    let value = raw
    if (sep > 0) {
      group = raw.slice(0, sep)
      value = raw.slice(sep + 2)
    }
    const found = props.options.find(o => o.value === value && o.group === group)
    return { value: raw, label: found?.label || value, group: found?.group || group }
  })
})

// 按 label 去重合并：同名标签只显示一个，带计数 badge 和 tooltip
const mergedLabels = computed(() => {
  const map = new Map<string, { label: string; count: number; groups: string[]; values: (string | number)[] }>()
  for (const l of currentLabels.value) {
    if (map.has(l.label)) {
      const entry = map.get(l.label)!
      entry.count++
      entry.values.push(l.value)
      if (l.group && !entry.groups.includes(l.group)) {
        entry.groups.push(l.group)
      }
    } else {
      map.set(l.label, { label: l.label, count: 1, groups: l.group ? [l.group] : [], values: [l.value] })
    }
  }
  return [...map.values()]
})

// 合成 key：group + "::" + value，用于区分不同 provider 下的同名模型
function makeKey(m: GroupedModel): string {
  return m.group + "::" + m.value
}

function selectModel(model: GroupedModel) {
  if (props.multiple) {
    const cur = [...currentValues.value] as string[]
    const key = makeKey(model)
    const idx = cur.indexOf(key)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(key)
    emit("update:modelValue", cur as any)
  } else {
    emit("update:modelValue", model.value)
    open.value = false
  }
}

function isSelected(model: GroupedModel): boolean {
  return (currentValues.value as string[]).includes(makeKey(model))
}

function removeValues(vals: (string | number)[]) {
  if (!props.multiple) return
  const set = new Set(vals)
  emit("update:modelValue", currentValues.value.filter(v => !set.has(v)) as any)
}

function clearAll(e: Event) {
  e.stopPropagation()
  if (props.multiple) emit("update:modelValue", [] as any)
  else emit("update:modelValue", "" as any)
}

function switchGroup(g: string) {
  activeGroup.value = g
}
</script>

<template>
  <AxDropdown v-model="open" placement="bottom-start" :offset="4" menu-width="360px" menu-max-width="480px"
    body-class="p-0 max-h-[420px] flex flex-col">
    <template #trigger="{ open: isOpen, toggle }">
      <div class="w-full">
        <div :class="[
          'relative w-full bg-surface-container-low transition-colors text-left border rounded-md flex gap-1',
          multiple ? 'flex-col items-start h-[140px] overflow-hidden' : 'flex-nowrap items-center',
          isOpen ? 'ring-1 ring-primary border-primary' : 'border-outline-variant hover:bg-surface-container cursor-pointer',
          multiple ? MULTI_SIZE_CLASSES[size] : SIZE_CLASSES[size],
        ]" @click.stop="toggle">
          <template v-if="!multiple">
            <span class="flex-1 min-w-0 truncate text-left">
              <span v-if="!hasValue" class="text-secondary">{{ placeholder }}</span>
              <span v-else class="text-primary font-medium">{{ currentLabels[0]?.label }}</span>
              <span v-if="hasValue && currentLabels[0]?.group" class="text-[10px] text-secondary ml-1">({{ currentLabels[0]?.group }})</span>
            </span>
            <div class="inline-flex items-center shrink-0 ml-auto">
              <button v-if="hasValue" class="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10" @click.stop="clearAll">
                <span class="material-symbols-outlined !text-[14px] text-secondary leading-none">close</span>
              </button>
              <span class="material-symbols-outlined text-secondary text-[16px] leading-none">expand_more</span>
            </div>
          </template>
          <template v-else>
            <div v-if="currentLabels.length > 0" class="w-full pr-5 flex flex-wrap items-start gap-1 overflow-y-auto">
              <AxTooltip v-for="l in mergedLabels" :key="l.label" placement="top" :offset="6">
                <template #content>
                  <div class="text-left">
                    <div class="font-semibold mb-0.5">{{ l.label }}</div>
                    <div v-if="l.groups.length > 0" class="text-[10px] opacity-80">
                      来自: {{ l.groups.join(', ') }}
                    </div>
                  </div>
                </template>
                <span
                  class="inline-flex items-center gap-0.5 bg-surface-container-high pl-1.5 pr-0.5 py-px rounded text-[11px] font-medium text-primary shrink-0 cursor-default">
                  <span class="truncate max-w-[120px]">{{ l.label }}</span>
                  <span v-if="l.count > 1" class="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-on-primary text-[9px] font-bold leading-none">{{ l.count }}</span>
                  <button class="inline-flex items-center justify-center w-3 h-3 rounded-full hover:bg-black/10 shrink-0" @click.stop="removeValues(l.values)">
                    <span class="material-symbols-outlined !text-[10px] leading-none">close</span>
                  </button>
                </span>
              </AxTooltip>
              <div class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center">
                <span class="material-symbols-outlined text-secondary text-[16px] leading-none">expand_more</span>
              </div>
            </div>
            <div v-else class="w-full h-full flex flex-col gap-2 pr-5">
              <div class="flex flex-1 flex-col items-center justify-center gap-1 text-secondary">
                <span class="material-symbols-outlined text-[20px] leading-none">model_training</span>
                <span class="text-[11px]">{{ placeholder }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <template #default>
      <div>
        <!-- 分组 Tab -->
        <div v-if="groups.length > 1" class="flex items-center gap-0 border-b border-outline-variant px-1 pb-px shrink-0 overflow-x-auto overflow-y-hidden scrollbar-thin">
          <button v-for="g in groups" :key="g" type="button"
            class="relative flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 cursor-pointer border-b-2 -mb-px whitespace-nowrap"
            :class="activeGroup === g
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-secondary hover:text-primary hover:bg-surface-container-low'"
            @click="switchGroup(g)">
            <span class="material-symbols-outlined text-[14px]">dns</span>
            {{ g }}
          </button>
        </div>

        <!-- 模型标签区域 -->
        <div class="flex-1 overflow-y-auto p-1.5">
          <div v-if="currentGroupModels.length === 0" class="py-6 text-center text-[11px] text-secondary">
            <span class="material-symbols-outlined text-[20px] opacity-40 block mb-1">inventory_2</span>
            该分组暂无模型
          </div>
          <div v-else class="flex flex-wrap gap-1">
            <button v-for="m in currentGroupModels" :key="m.value" type="button"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all duration-150 cursor-pointer border"
              :class="isSelected(m)
                ? 'bg-primary text-on-primary border-primary shadow-sm'
                : 'bg-surface-container-high text-secondary border-outline-variant hover:border-primary/40 hover:text-primary hover:bg-surface-container-highest'"
              @click="selectModel(m)">
              <span class="truncate max-w-[140px]">{{ m.label }}</span>
            </button>
          </div>
        </div>

        <!-- 底部统计 -->
        <div v-if="multiple" class="px-2 py-1 border-t border-outline-variant text-[10px] text-secondary shrink-0">
          已选 {{ currentValues.length }} / {{ options.length }} 个模型
        </div>
      </div>
    </template>
  </AxDropdown>
</template>