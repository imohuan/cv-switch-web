<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, type WorkBuddyModel } from '../api'
import { AxAlert, AxButton, AxDialog, AxInput, AxSelect, AxSwitch, useNotify } from './ui'

interface ModelForm {
  id: string
  name: string
  vendor: string
  url: string
  apiKey: string
  supportsToolCall: boolean
  supportsImages: boolean
  supportsReasoning: boolean
  useCustomProtocol: boolean
  supportedEfforts: string[]
  defaultEffort: string
  maxInputTokens: string
  maxOutputTokens: string
}

const emit = defineEmits<{
  statusChange: [readable: boolean]
}>()

const { triggerNotify } = useNotify()
const models = ref<WorkBuddyModel[]>([])
const modelsPath = ref('')
const fileExists = ref(false)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editingModel = ref<WorkBuddyModel | null>(null)
const originalId = ref<string | null>(null)

const EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
}
const STANDARD_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']

function emptyForm(): ModelForm {
  return {
    id: '',
    name: '',
    vendor: 'Custom',
    url: '',
    apiKey: '',
    supportsToolCall: true,
    supportsImages: false,
    supportsReasoning: false,
    useCustomProtocol: false,
    supportedEfforts: [],
    defaultEffort: '',
    maxInputTokens: '',
    maxOutputTokens: '',
  }
}

const form = reactive<ModelForm>(emptyForm())

const effortOptions = computed(() => {
  const values = new Set([...STANDARD_EFFORTS, ...form.supportedEfforts])
  if (form.defaultEffort) values.add(form.defaultEffort)
  return [...values].map((value) => ({ value, label: EFFORT_LABELS[value] || value }))
})

function cloneModel(model: WorkBuddyModel): WorkBuddyModel {
  return JSON.parse(JSON.stringify(model)) as WorkBuddyModel
}

function toPositiveInteger(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

async function loadModels() {
  loading.value = true
  error.value = ''
  try {
    const response = await api.getWorkBuddyModels()
    if (!response.success || !response.data) {
      throw new Error(response.error || '读取 WorkBuddy models.json 失败')
    }
    models.value = response.data.models
    modelsPath.value = response.data.path
    fileExists.value = response.data.exists
    emit('statusChange', response.data.exists)
  } catch (cause) {
    models.value = []
    fileExists.value = false
    error.value = cause instanceof Error ? cause.message : '读取 WorkBuddy models.json 失败'
    emit('statusChange', false)
  } finally {
    loading.value = false
  }
}

function openForm(model: WorkBuddyModel | null) {
  editingModel.value = model ? cloneModel(model) : null
  originalId.value = model?.id || null
  Object.assign(form, emptyForm(), model ? {
    id: model.id,
    name: model.name,
    vendor: model.vendor || 'Custom',
    url: model.url,
    apiKey: '',
    supportsToolCall: Boolean(model.supportsToolCall),
    supportsImages: Boolean(model.supportsImages),
    supportsReasoning: Boolean(model.supportsReasoning),
    useCustomProtocol: Boolean(model.useCustomProtocol),
    supportedEfforts: [...(model.reasoning?.supportedEfforts || [])],
    defaultEffort: model.reasoning?.defaultEffort || '',
    maxInputTokens: model.maxInputTokens ? String(model.maxInputTokens) : '',
    maxOutputTokens: model.maxOutputTokens ? String(model.maxOutputTokens) : '',
  } : {})
  showForm.value = true
}

function buildPayload(): WorkBuddyModel {
  const payload: WorkBuddyModel = {
    ...(editingModel.value || {}),
    id: form.id.trim(),
    name: form.name.trim(),
    vendor: form.vendor.trim() || 'Custom',
    url: form.url.trim(),
    apiKey: form.apiKey.trim(),
    supportsToolCall: form.supportsToolCall,
    supportsImages: form.supportsImages,
    supportsReasoning: form.supportsReasoning,
    useCustomProtocol: form.useCustomProtocol,
  }

  const maxInputTokens = toPositiveInteger(form.maxInputTokens)
  const maxOutputTokens = toPositiveInteger(form.maxOutputTokens)
  if (maxInputTokens) payload.maxInputTokens = maxInputTokens
  else delete payload.maxInputTokens
  if (maxOutputTokens) payload.maxOutputTokens = maxOutputTokens
  else delete payload.maxOutputTokens

  const existingReasoning = editingModel.value?.reasoning || {}
  if (form.supportsReasoning || Object.keys(existingReasoning).length > 0) {
    payload.reasoning = {
      ...existingReasoning,
      supportedEfforts: [...form.supportedEfforts],
    }
    if (form.defaultEffort) payload.reasoning.defaultEffort = form.defaultEffort
    else delete payload.reasoning.defaultEffort
  }

  return payload
}

async function saveModel() {
  if (!form.id.trim() || !form.name.trim() || !form.url.trim()) {
    triggerNotify('模型 ID、名称和接口地址必填', 'error')
    return
  }
  if (form.maxInputTokens && !toPositiveInteger(form.maxInputTokens)) {
    triggerNotify('最大输入 Token 必须是正整数', 'error')
    return
  }
  if (form.maxOutputTokens && !toPositiveInteger(form.maxOutputTokens)) {
    triggerNotify('最大输出 Token 必须是正整数', 'error')
    return
  }

  saving.value = true
  try {
    const response = await api.saveWorkBuddyModel(originalId.value, buildPayload())
    if (!response.success) throw new Error(response.error || '保存模型失败')
    showForm.value = false
    triggerNotify(originalId.value ? 'WorkBuddy 模型已更新' : 'WorkBuddy 模型已添加', 'success')
    await loadModels()
  } catch (cause) {
    triggerNotify(cause instanceof Error ? cause.message : '保存模型失败', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteModel(model: WorkBuddyModel) {
  if (!confirm(`确定删除 WorkBuddy 模型「${model.name}」？`)) return
  const response = await api.deleteWorkBuddyModel(model.id)
  if (!response.success) {
    triggerNotify(response.error || '删除模型失败', 'error')
    return
  }
  triggerNotify('WorkBuddy 模型已删除', 'info')
  await loadModels()
}

function capabilityLabels(model: WorkBuddyModel): string[] {
  return [
    model.supportsToolCall ? '工具调用' : '',
    model.supportsImages ? '图片' : '',
    model.supportsReasoning ? '推理' : '',
    model.useCustomProtocol ? '自定义协议' : '',
  ].filter(Boolean)
}

onMounted(loadModels)
</script>

<template>
  <div class="space-y-ax-md">
    <AxAlert v-if="error" type="error" :dismissible="true" title="WorkBuddy 配置读取失败" @dismiss="error = ''">
      {{ error }}
    </AxAlert>

    <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md">
      <div class="flex items-start justify-between gap-ax-md">
        <div class="min-w-0">
          <div class="flex items-center gap-ax-sm">
            <span class="w-3 h-3 rounded-full shrink-0" :class="fileExists && !error ? 'bg-emerald-500 animate-pulse' : 'bg-outline'" />
            <div>
              <h4 class="font-label-md text-label-md font-semibold text-primary">WorkBuddy 模型配置</h4>
              <p class="font-body-sm text-body-sm text-secondary mt-0.5">
                {{ fileExists ? 'models.json 已读取' : 'models.json 尚不存在，首次保存时会自动创建' }}
              </p>
            </div>
          </div>
          <code v-if="modelsPath" class="block font-label-md text-[10px] text-outline mt-ax-sm break-all">{{ modelsPath }}</code>
        </div>
        <div class="flex gap-ax-sm shrink-0">
          <AxButton size="lg" variant="outline" icon="refresh" :loading="loading" @click="loadModels">刷新</AxButton>
          <AxButton size="lg" icon="add" @click="openForm(null)">添加模型</AxButton>
        </div>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-ax-sm border border-dashed border-outline-variant rounded-lg p-ax-lg text-secondary">
      <span class="material-symbols-outlined animate-spin">progress_activity</span>
      <span class="font-body-sm text-body-sm">正在读取 WorkBuddy 模型...</span>
    </div>

    <div v-else-if="models.length === 0 && !error" class="text-center border border-dashed border-outline-variant rounded-lg p-ax-lg text-secondary">
      <span class="material-symbols-outlined text-[32px] text-outline mb-ax-sm block">deployed_code</span>
      <p class="font-body-sm text-body-sm">暂无 WorkBuddy 模型。</p>
      <p class="font-body-sm text-[11px] mt-1">添加后会直接写入本机 models.json。</p>
    </div>

    <div v-else-if="models.length > 0" class="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-ax-md">
      <article v-for="model in models" :key="model.id" class="bg-surface-container-lowest border border-outline-variant rounded-lg p-ax-md">
        <div class="flex items-start justify-between gap-ax-sm mb-ax-sm">
          <div class="min-w-0">
            <h4 class="font-label-md text-label-md font-semibold text-primary truncate">{{ model.name }}</h4>
            <code class="block font-label-md text-[11px] text-secondary mt-0.5 truncate">{{ model.id }}</code>
          </div>
          <span class="rounded-full bg-surface-container-low border border-outline-variant text-secondary font-label-md text-[11px] px-2 py-0.5 shrink-0">
            {{ model.vendor || 'Custom' }}
          </span>
        </div>

        <div class="space-y-ax-sm">
          <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
            <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">API URL</span>
            <code class="block font-label-md text-label-md text-primary mt-0.5 break-all">{{ model.url }}</code>
          </div>

          <div v-if="model.maxInputTokens || model.maxOutputTokens" class="grid grid-cols-2 gap-ax-sm">
            <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
              <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Input Tokens</span>
              <p class="font-label-md text-label-md text-primary mt-0.5">{{ model.maxInputTokens?.toLocaleString() || '-' }}</p>
            </div>
            <div class="bg-surface-container-low border border-outline-variant rounded-lg p-ax-sm">
              <span class="font-label-md text-[10px] text-secondary uppercase tracking-wider">Output Tokens</span>
              <p class="font-label-md text-label-md text-primary mt-0.5">{{ model.maxOutputTokens?.toLocaleString() || '-' }}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-ax-xs min-h-5">
            <span v-for="label in capabilityLabels(model)" :key="label" class="rounded-full bg-secondary-container/70 text-on-secondary-container font-label-md text-[11px] px-2 py-0.5">
              {{ label }}
            </span>
            <span v-for="effort in model.reasoning?.supportedEfforts || []" :key="`effort-${effort}`" class="rounded-full bg-primary/10 text-primary font-label-md text-[11px] px-2 py-0.5">
              {{ EFFORT_LABELS[effort] || effort }}
            </span>
            <span v-if="capabilityLabels(model).length === 0 && !model.reasoning?.supportedEfforts?.length" class="font-body-sm text-[11px] text-outline">未声明能力</span>
          </div>
        </div>

        <div class="flex gap-ax-sm mt-ax-md pt-ax-sm border-t border-outline-variant">
          <AxButton size="lg" variant="outline" @click="openForm(model)">编辑</AxButton>
          <AxButton size="lg" variant="danger" @click="deleteModel(model)">删除</AxButton>
        </div>
      </article>
    </div>
  </div>

  <AxDialog v-model="showForm" :title="originalId ? '编辑 WorkBuddy 模型' : '添加 WorkBuddy 模型'" icon="deployed_code" max-width="max-w-3xl">
    <template #default>
      <div class="grid grid-cols-2 gap-ax-md">
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">模型 ID *</label>
          <AxInput v-model="form.id" placeholder="例如：gpt-5.5" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">显示名称 *</label>
          <AxInput v-model="form.name" placeholder="例如：GPT 5.5" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Vendor</label>
          <AxInput v-model="form.vendor" placeholder="Custom" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">API Key</label>
          <AxInput v-model="form.apiKey" :password="true" :placeholder="originalId ? '留空保留原 Key' : 'sk-xxxxxxxx'" size="lg" />
        </div>
        <div class="col-span-2">
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">接口地址 *</label>
          <AxInput v-model="form.url" placeholder="https://api.example.com/v1" size="lg" />
        </div>

        <div class="col-span-2 bg-surface-container-low border border-outline-variant rounded-lg p-ax-md">
          <h4 class="font-label-md text-label-md font-semibold text-primary mb-ax-sm">模型能力</h4>
          <div class="grid grid-cols-2 gap-x-ax-lg gap-y-ax-sm">
            <label class="flex items-center justify-between gap-ax-md cursor-pointer">
              <span class="font-body-sm text-body-sm text-secondary">支持工具调用</span>
              <AxSwitch v-model="form.supportsToolCall" size="sm" />
            </label>
            <label class="flex items-center justify-between gap-ax-md cursor-pointer">
              <span class="font-body-sm text-body-sm text-secondary">支持图片输入</span>
              <AxSwitch v-model="form.supportsImages" size="sm" />
            </label>
            <label class="flex items-center justify-between gap-ax-md cursor-pointer">
              <span class="font-body-sm text-body-sm text-secondary">支持推理</span>
              <AxSwitch v-model="form.supportsReasoning" size="sm" />
            </label>
            <label class="flex items-center justify-between gap-ax-md cursor-pointer">
              <span class="font-body-sm text-body-sm text-secondary">使用自定义协议</span>
              <AxSwitch v-model="form.useCustomProtocol" size="sm" />
            </label>
          </div>
        </div>

        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">最大输入 Token</label>
          <AxInput v-model="form.maxInputTokens" type="number" placeholder="例如：262144" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">最大输出 Token</label>
          <AxInput v-model="form.maxOutputTokens" type="number" placeholder="例如：65536" size="lg" />
        </div>

        <div v-if="form.supportsReasoning" class="col-span-2 bg-surface-container-low border border-outline-variant rounded-lg p-ax-md space-y-ax-sm">
          <div>
            <h4 class="font-label-md text-label-md font-semibold text-primary">推理配置</h4>
            <p class="font-body-sm text-[11px] text-secondary mt-0.5">推理强度会写入 reasoning.supportedEfforts。</p>
          </div>
          <div class="grid grid-cols-2 gap-ax-sm">
            <div>
              <label class="block font-label-md text-[11px] text-secondary mb-1">支持的推理强度</label>
              <AxSelect v-model="form.supportedEfforts" :options="effortOptions" multiple size="lg" trigger-max-width="100%" />
            </div>
            <div>
              <label class="block font-label-md text-[11px] text-secondary mb-1">默认推理强度</label>
              <AxSelect v-model="form.defaultEffort" :options="effortOptions" placeholder="未指定" size="lg" trigger-max-width="100%" />
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer="{ close }">
      <AxButton size="lg" variant="outline" :disabled="saving" @click="close">取消</AxButton>
      <AxButton size="lg" :loading="saving" @click="saveModel">{{ originalId ? '保存' : '添加' }}</AxButton>
    </template>
  </AxDialog>
</template>