<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '../../api'
import AxDropdown from './AxDropdown.vue'
import type { ControlSize } from './types'

const props = withDefaults(defineProps<{
  modelValue?: string | string[]
  providerId?: string
  baseUrl?: string
  apiKey?: string
  options?: Array<{ value: string; label: string }>
  multiple?: boolean
  placeholder?: string
  size?: ControlSize
}>(), {
  modelValue: '',
  options: undefined,
  multiple: false,
  placeholder: '选择或输入模型',
  size: 'lg',
})

const emit = defineEmits<{ 'update:modelValue': [v: string | string[]] }>()

const models = ref<Array<{ id: string }>>([])
const fetchLoading = ref(false)
const open = ref(false)
const searchText = ref('')
const highlightIndex = ref(-1)
const searchInputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-[18px] px-1.5 py-px text-body-sm', sm: 'h-5 px-2 py-0.5 text-body-sm',
  md: 'h-6 px-2.5 py-1 text-label-md', lg: 'h-7 px-3 py-1.5 text-label-md',
}

const MULTI_SIZE_CLASSES: Record<string, string> = {
  xs: 'px-1.5 py-px text-body-sm', sm: 'px-2 py-0.5 text-body-sm',
  md: 'px-2.5 py-1 text-label-md', lg: 'px-3 py-1.5 text-label-md',
}

const currentValues = computed<(string | number)[]>(() => {
  if (props.multiple) return Array.isArray(props.modelValue) ? props.modelValue : []
  return props.modelValue && props.modelValue !== '' ? [props.modelValue as string] : []
})

const currentLabels = computed(() => currentValues.value.map(v => ({ value: v, label: String(v) })))

const options = computed(() => {
  const opts = props.options ? [...props.options] : models.value.map(m => ({ value: m.id, label: m.id }))
  for (const v of currentValues.value) {
    if (typeof v === 'string' && v && !opts.find(o => o.value === v)) {
      opts.unshift({ value: v, label: v })
    }
  }
  return opts
})

const filtered = computed(() => {
  if (!searchText.value.trim()) return options.value
  const q = searchText.value.toLowerCase()
  return options.value.filter(o => o.label.toLowerCase().includes(q))
})

const hasValue = computed(() => currentValues.value.length > 0)

async function fetchModels() {
  if (props.options) return // external options, no internal fetch
  fetchLoading.value = true
  try {
    let res
    if (props.providerId) {
      res = await api.fetchModels(props.providerId)
    } else if (props.baseUrl) {
      res = await api.fetchModelsByConfig(props.baseUrl, props.apiKey || '')
    } else {
      return
    }
    if (res.success && res.data) models.value = res.data
  } catch { /* ignore fetch errors */ }
  finally { fetchLoading.value = false }
}

watch([() => props.providerId, () => props.baseUrl, () => props.options], ([pid, burl, opts]) => {
  if (!opts && (pid || burl)) fetchModels()
}, { immediate: true })

function selectOption(opt: { value: string; label: string }) {
  if (props.multiple) {
    const cur = [...currentValues.value]
    const idx = cur.indexOf(opt.value)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(opt.value)
    emit('update:modelValue', cur as any)
  } else {
    emit('update:modelValue', opt.value)
    closeDropdown()
  }
}

function commitSearch() {
  const text = searchText.value.trim()
  if (!text) return
  if (props.multiple) {
    const curSet = new Set(currentValues.value)
    curSet.add(text)
    emit('update:modelValue', [...curSet] as any)
    searchText.value = ''
  } else {
    emit('update:modelValue', text)
    closeDropdown()
  }
}

function removeValue(val: string | number) {
  if (!props.multiple) return
  emit('update:modelValue', currentValues.value.filter(v => v !== val) as any)
}

function clearAll(e: Event) {
  e.stopPropagation()
  if (props.multiple) emit('update:modelValue', [] as any)
  else emit('update:modelValue', '' as any)
}

function closeDropdown() { open.value = false; searchText.value = ''; highlightIndex.value = -1 }
function openDropdown() {
  open.value = true
  setTimeout(() => searchInputRef.value?.focus(), 50)
}

function handleKeydown(e: KeyboardEvent) {
  const len = filtered.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightIndex.value = highlightIndex.value < len - 1 ? highlightIndex.value + 1 : 0
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightIndex.value = highlightIndex.value > 0 ? highlightIndex.value - 1 : len - 1
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (highlightIndex.value >= 0 && highlightIndex.value < len) {
      selectOption(filtered.value[highlightIndex.value])
      if (!props.multiple) return
      searchText.value = ''
      highlightIndex.value = -1
    } else if (searchText.value.trim()) {
      commitSearch()
    }
  } else if (e.key === 'Escape') {
    closeDropdown()
  }
}

// Highlight scroll
function scrollToHighlight(el: HTMLElement | null) {
  if (!el) return
  const items = el.querySelectorAll('[data-option]')
  if (items.length) items[highlightIndex.value]?.scrollIntoView({ block: 'nearest' })
}

// Reset on close
watch(open, (val) => { if (!val) { searchText.value = ''; highlightIndex.value = -1 } })
</script>

<template>
  <AxDropdown v-model="open" placement="bottom-start" :offset="4" menu-max-width="320px" body-class="p-1 max-h-56 overflow-y-auto scrollbar-thin">
    <template #trigger="{ open: isOpen, toggle }">
      <div class="relative w-full">
        <div :class="[
          'w-full bg-surface-container-low transition-colors text-left border rounded-md flex gap-1',
          multiple ? 'flex-col items-start h-[140px] overflow-hidden' : 'flex-nowrap items-center',
          isOpen ? 'ring-1 ring-primary border-primary' : 'border-outline-variant hover:bg-surface-container cursor-pointer',
          multiple ? MULTI_SIZE_CLASSES[size] : SIZE_CLASSES[size],
        ]"
          @click.stop="!isOpen && openDropdown()">
          <!-- Closed state -->
          <template v-if="!isOpen">
            <!-- Multi-select: chips area (flex-1 scroll) + bottom bar -->
            <template v-if="multiple">
              <div v-if="currentLabels.length > 0" class="flex-1 w-full flex flex-wrap items-start gap-1 overflow-y-auto">
                <span v-for="l in currentLabels" :key="l.value"
                  class="inline-flex items-center gap-0.5 bg-surface-container-high pl-1.5 pr-0.5 py-px rounded text-[11px] font-medium text-primary shrink-0">
                  <span class="truncate max-w-[120px]">{{ l.label }}</span>
                  <button class="inline-flex items-center justify-center w-3 h-3 rounded-full hover:bg-black/10 shrink-0" @click.stop="removeValue(l.value)">
                    <span class="material-symbols-outlined !text-[10px] leading-none">close</span>
                  </button>
                </span>
              </div>
              <div v-else class="flex-1 w-full flex items-center">
                <span class="text-secondary text-[11px]">{{ placeholder }}</span>
              </div>
              <div class="w-full flex items-center justify-end shrink-0">
                <span class="material-symbols-outlined text-secondary text-[16px] leading-none">expand_more</span>
              </div>
            </template>
            <!-- Single select: unchanged -->
            <template v-else>
              <span class="flex-1 min-w-0 truncate text-left">
                <span v-if="!hasValue" class="text-secondary">{{ placeholder }}</span>
                <span v-else class="text-primary font-medium">{{ currentLabels[0]?.label }}</span>
              </span>
              <div class="inline-flex items-center shrink-0 ml-auto">
                <button v-if="hasValue" class="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10" @click.stop="clearAll">
                  <span class="material-symbols-outlined !text-[14px] text-secondary leading-none">close</span>
                </button>
                <span class="material-symbols-outlined text-secondary text-[16px] leading-none">expand_more</span>
              </div>
            </template>
          </template>
          <!-- Open state: tags + input -->
          <template v-else>
            <!-- Multi-select: tags area (top, finite height) + textarea (flex-1) -->
            <template v-if="multiple">
              <div v-if="currentLabels.length > 0" class="w-full flex flex-wrap items-start gap-1 max-h-[60px] overflow-y-auto">
                <span v-for="l in currentLabels" :key="l.value"
                  class="inline-flex items-center gap-0.5 bg-primary/10 pl-1.5 pr-0.5 py-px rounded text-[11px] font-medium text-primary shrink-0">
                  <span class="truncate max-w-[120px]">{{ l.label }}</span>
                  <button class="inline-flex items-center justify-center w-3 h-3 rounded-full hover:bg-primary/20 shrink-0" @click.stop="removeValue(l.value)">
                    <span class="material-symbols-outlined !text-[10px] leading-none">close</span>
                  </button>
                </span>
              </div>
              <div v-else class="w-full text-[11px] text-secondary">{{ placeholder }}</div>
              <textarea
                ref="searchInputRef"
                v-model="searchText"
                rows="2"
                :placeholder="currentLabels.length > 0 ? '继续输入下一行（Shift+Enter 提交）' : '输入模型名，每行一个'"
                class="flex-1 w-full min-h-0 mt-1 bg-transparent border-none px-2 py-1 text-label-md font-label-md text-primary placeholder:text-secondary resize-none focus:outline-none focus:ring-0"
                @keydown="handleKeydown" @click.stop />
            </template>
            <!-- Single select: unchanged -->
            <template v-else>
              <div class="flex-1 flex items-center gap-1 min-w-0">
                <input ref="searchInputRef" v-model="searchText" type="text"
                  placeholder="输入模型名搜索或手动输入..."
                  class="flex-1 min-w-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 focus:border-none p-0 m-0 h-full text-primary font-medium placeholder:text-secondary text-label-md font-label-md"
                  autocomplete="off" @keydown="handleKeydown" @click.stop />
                <button v-if="!props.options" class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-surface-container-highest"
                  :class="fetchLoading ? 'animate-spin opacity-50' : ''" @click.stop="fetchModels" title="刷新模型列表">
                  <span class="material-symbols-outlined text-[16px] text-secondary">{{ fetchLoading ? 'progress_activity' : 'refresh' }}</span>
                </button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>
    <template #default>
      <div :ref="el => scrollToHighlight(el as HTMLElement)" class="space-y-0.5">
        <button v-for="(opt, idx) in filtered" :key="opt.value" type="button" data-option
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-label-md text-label-md rounded-lg transition-colors"
          :class="(!multiple && currentValues[0] === opt.value) ? 'bg-primary text-on-primary font-medium'
            : highlightIndex === idx ? 'bg-surface-container-highest' : multiple && currentValues.includes(opt.value) ? 'bg-primary/10' : 'text-primary hover:bg-surface-container-low'"
          @click="selectOption(opt)" @mouseenter="highlightIndex = idx">
          <span v-if="multiple" class="inline-flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0"
            :class="currentValues.includes(opt.value) ? 'bg-primary border-primary' : 'border-outline-variant'">
            <span v-if="currentValues.includes(opt.value)" class="material-symbols-outlined text-[12px] text-on-primary">check</span>
          </span>
          <span class="truncate">{{ opt.label }}</span>
        </button>
        <div v-if="filtered.length === 0 && searchText.trim()" class="py-2 px-3">
          <button class="w-full text-left text-secondary hover:text-primary font-label-md text-label-md rounded-lg px-2 py-1 hover:bg-surface-container-low"
            @click="commitSearch">
            使用自定义模型 "<span class="text-primary font-medium">{{ searchText.trim() }}</span>"
          </button>
        </div>
        <div v-else-if="filtered.length === 0" class="py-3 text-center font-body-sm text-[11px] text-secondary">暂无可用模型</div>
      </div>
    </template>
  </AxDropdown>
</template>
