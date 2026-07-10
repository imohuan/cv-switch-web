<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import { api } from "../api"
import { AxButton, AxInput } from "./ui"

const props = withDefaults(
  defineProps<{
    providerId?: string
    baseUrl?: string
    apiKey?: string
    /** 外部传入的模型列表（跳过自动获取） */
    externalModels?: Array<{ value: string; label: string }>
    /** 多选模式 */
    multiple?: boolean
    /** 选中的值（多选为数组，单选为字符串） */
    modelValue?: string | string[]
  }>(),
  {
    providerId: "",
    baseUrl: "",
    apiKey: "",
    externalModels: undefined,
    multiple: true,
    modelValue: () => [],
  },
)

const emit = defineEmits<{
  "update:modelValue": [v: string | string[]]
  "models-fetched": [models: Array<{ value: string; label: string }>]
}>()

// ---- 状态 ----
const models = ref<Array<{ value: string; label: string }>>([])
const fetching = ref(false)
const fetchError = ref("")
const searchQuery = ref("")

// 内部选中集合（Set 保证唯一）
const selectedSet = computed<Set<string>>(() => {
  const raw = props.multiple
    ? Array.isArray(props.modelValue) ? props.modelValue : []
    : props.modelValue ? [props.modelValue as string] : []
  return new Set(raw.filter(Boolean))
})

// 搜索过滤后的模型列表
const filteredModels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return models.value
  return models.value.filter(m => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
})

// ---- 自定义模型添加（搜索时回车） ----
function addSearchAsModel() {
  const name = searchQuery.value.trim()
  if (!name) return
  // 已存在则不重复添加
  if (models.value.some(m => m.value === name)) {
    searchQuery.value = ""
    return
  }
  // 添加到模型列表末尾
  models.value = [...models.value, { value: name, label: name }]
  // 自动选中
  if (props.multiple) {
    const next = new Set(selectedSet.value)
    next.add(name)
    emit("update:modelValue", [...next] as string[])
  } else {
    emit("update:modelValue", name)
  }
  searchQuery.value = ""
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && filteredModels.value.length === 0) {
    e.preventDefault()
    addSearchAsModel()
  }
}

// ---- 计算属性 ----
const allSelected = computed(() =>
  filteredModels.value.length > 0 && filteredModels.value.every(m => selectedSet.value.has(m.value))
)

const someSelected = computed(() =>
  models.value.some(m => selectedSet.value.has(m.value))
)

// ---- 获取模型 ----
async function fetchModels() {
  fetching.value = true
  fetchError.value = ""
  try {
    let res
    if (props.providerId) {
      res = await api.fetchModels(props.providerId)
    } else if (props.baseUrl) {
      res = await api.fetchModelsByConfig(props.baseUrl, props.apiKey)
    } else {
      fetchError.value = "请先填写 Provider 信息"
      return
    }
    if (res.success && res.data) {
      models.value = res.data.map(m => ({ value: m.id, label: m.id }))
      emit("models-fetched", models.value)
    } else {
      fetchError.value = res.error || "获取模型失败"
    }
  } catch (e: any) {
    fetchError.value = e?.message || "请求异常"
  } finally {
    fetching.value = false
  }
}

// 外部传了 externalModels 就自动加载
watch(
  () => props.externalModels,
  (ext) => {
    if (ext && ext.length > 0) {
      models.value = ext
    }
  },
  { immediate: true },
)

// ---- 选择逻辑 ----
function isSelected(modelValue: string): boolean {
  return selectedSet.value.has(modelValue)
}

function toggleModel(modelValue: string) {
  if (props.multiple) {
    const next = new Set(selectedSet.value)
    if (next.has(modelValue)) {
      next.delete(modelValue)
    } else {
      next.add(modelValue)
    }
    emit("update:modelValue", [...next] as string[])
  } else {
    // 单选：点同一个就取消，否则替换
    if (selectedSet.value.has(modelValue)) {
      emit("update:modelValue", "")
    } else {
      emit("update:modelValue", modelValue)
    }
  }
}

function selectAll() {
  if (!props.multiple) return
  emit("update:modelValue", models.value.map(m => m.value) as string[])
}

function deselectAll() {
  if (props.multiple) {
    emit("update:modelValue", [] as string[])
  } else {
    emit("update:modelValue", "")
  }
}

// ---- Shift 范围选择（多选模式下） ----
const lastClickedIndex = ref(-1)

function handleTagClick(modelValue: string, index: number, event: MouseEvent) {
  if (props.multiple && event.shiftKey && lastClickedIndex.value >= 0) {
    // Shift + 点击：选中范围
    const start = Math.min(lastClickedIndex.value, index)
    const end = Math.max(lastClickedIndex.value, index)
    const rangeValues = models.value.slice(start, end + 1).map(m => m.value)
    const next = new Set(selectedSet.value)
    for (const v of rangeValues) next.add(v)
    emit("update:modelValue", [...next] as string[])
  } else {
    toggleModel(modelValue)
  }
  lastClickedIndex.value = index
}

// ---- 键盘快捷键 ----
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "a") {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA") return // 不拦截输入框内的 Ctrl+A
    e.preventDefault()
    if (props.multiple) selectAll()
  }
}

// 编辑已有 Provider 时自动加载已保存的模型列表
onMounted(async () => {
  if (props.providerId && !props.externalModels) {
    try {
      const res = await api.getProviderModelsManage(props.providerId)
      if (res.success && res.data?.models && res.data.models.length > 0) {
        models.value = (res.data!).models.map((m: any) => ({
          value: m.id || m.model,
          label: m.displayName || m.id || m.model,
        }))
        emit("models-fetched", models.value)
      }
    } catch { /* silent */ }
  }
  document.addEventListener("keydown", onKeydown)
})
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown))

defineExpose({ fetchModels })
</script>

<template>
  <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-md space-y-ax-md">
    <!-- 头部：标题 + 操作按钮 -->
    <div class="flex items-center justify-between gap-ax-sm">
      <div class="flex items-center gap-ax-sm">
        <span class="material-symbols-outlined text-[20px] text-primary">model_training</span>
        <h4 class="font-label-md text-label-md font-semibold text-primary">模型设置</h4>
        <span v-if="models.length > 0" class="text-[11px] text-secondary">
          {{ multiple ? `已选 ${selectedSet.size} / ${models.length}` : selectedSet.size > 0 ? '已选 1' : '未选择' }}
        </span>
      </div>
      <div class="flex items-center gap-ax-xs">
        <!-- 搜索框 -->
        <div class="relative w-[180px]">
          <AxInput
            v-model="searchQuery"
            placeholder="搜索模型..."
            size="sm"
            @keydown="onSearchKeydown"
          >
            <template #prefix>
              <span class="material-symbols-outlined text-[14px]">search</span>
            </template>
          </AxInput>
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary hover:text-primary cursor-pointer z-10"
            @click="searchQuery = ''"
          >
            <span class="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
        <AxButton
          size="sm"
          variant="outline"
          icon="refresh"
          :loading="fetching"
          @click="fetchModels"
        >
          获取模型{{ models.length > 0 ? ` (${models.length})` : "" }}
        </AxButton>
        <template v-if="models.length > 0 && multiple">
          <AxButton size="sm" variant="ghost" @click="selectAll">
            全选
          </AxButton>
          <AxButton size="sm" variant="ghost" @click="deselectAll" :disabled="selectedSet.size === 0">
            取消全选
          </AxButton>
        </template>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="fetchError"
      class="flex items-center gap-ax-xs text-error font-body-sm text-[12px] bg-error-container/30 rounded-md px-ax-sm py-1">
      <span class="material-symbols-outlined text-[14px]">error</span>
      {{ fetchError }}
    </div>

    <!-- 空状态 -->
    <div v-if="models.length === 0 && !fetching && !fetchError"
      class="flex flex-col items-center justify-center py-8 text-secondary gap-2">
      <span class="material-symbols-outlined text-[32px] opacity-40">inventory_2</span>
      <span class="font-body-sm text-[12px]">点击"获取模型"加载可用模型列表</span>
    </div>

    <!-- 模型标签区域 -->
    <div v-if="filteredModels.length > 0"
      class="flex flex-wrap gap-ax-xs max-h-[240px] overflow-y-auto scrollbar-thin py-ax-xs"
      :class="multiple ? 'select-none' : ''">
      <button
        v-for="(model, idx) in filteredModels"
        :key="model.value"
        type="button"
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all duration-150 cursor-pointer border"
        :class="isSelected(model.value)
          ? 'bg-primary text-on-primary border-primary shadow-sm'
          : 'bg-surface-container-high text-secondary border-outline-variant hover:border-primary/40 hover:text-primary hover:bg-surface-container-highest'"
        :title="multiple ? `Shift+点击范围选择 · ${model.label}` : model.label"
        @click="handleTagClick(model.value, idx, $event)"
      >
        <span class="truncate max-w-[200px]">{{ model.label }}</span>
      </button>
    </div>

    <!-- 搜索无结果 -->
    <div v-else-if="searchQuery && models.length > 0"
      class="flex flex-col items-center justify-center py-4 text-secondary gap-1">
      <span class="material-symbols-outlined text-[24px] opacity-40">search_off</span>
      <span class="font-body-sm text-[12px]">未找到 "{{ searchQuery }}" 相关模型</span>
      <span class="font-body-sm text-[11px] text-outline">按 Enter 添加为自定义模型</span>
    </div>

    <!-- 底部提示 -->
    <p v-if="models.length > 0" class="font-body-sm text-[10px] text-secondary !mt-ax-xs">
      <template v-if="multiple">
        点击标签切换选中 · Shift+点击进行范围选择 · Ctrl+A 全选
      </template>
      <template v-else>
        点击标签选择模型，再次点击取消选择
      </template>
    </p>
  </div>
</template>
