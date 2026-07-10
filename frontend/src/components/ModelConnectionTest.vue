<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { api, type ApiFormat, type ModelTestResult } from "../api"
import { AxAlert, AxButton } from "./ui"
import AxModelSelect from "./ui/AxModelSelect.vue"

const props = withDefaults(
  defineProps<{
    providerId?: string
    providerName?: string
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    model: string
    models?: Array<{ value: string; label: string }>
  }>(),
  {
    providerId: "",
    providerName: "",
    models: () => [],
  },
)

const selectedModel = ref(props.model)
const running = ref(false)
const elapsedMs = ref(0)
const result = ref<ModelTestResult | null>(null)
const testError = ref("")
let timer: ReturnType<typeof setInterval> | null = null
let requestVersion = 0

const ready = computed(() => Boolean(props.baseUrl.trim() && selectedModel.value.trim()))

const formatLabel = computed(
  () =>
    ({
      openai_chat: "OpenAI Chat Completions",
      openai_responses: "OpenAI Responses",
      anthropic: "Anthropic Messages",
      gemini_native: "Gemini Native",
    })[props.apiFormat],
)

const versionedBase = computed(() => {
  const base = props.baseUrl.trim().replace(/\/+$/, "")
  if (/\/v\d+(?:beta)?$/i.test(base)) return base
  return `${base}/${props.apiFormat === "gemini_native" ? "v1beta" : "v1"}`
})

const requestUrl = computed(() => {
  const model = encodeURIComponent(selectedModel.value || props.model || "{model}")
  const path = {
    openai_chat: "chat/completions",
    openai_responses: "responses",
    anthropic: "messages",
    gemini_native: `models/${model}:streamGenerateContent`,
  }[props.apiFormat]
  return `${versionedBase.value}/${path}`
})

const requestHost = computed(() => {
  try {
    return new URL(requestUrl.value).host
  } catch {
    return props.baseUrl || "未填写地址"
  }
})

const requestPath = computed(() => {
  try {
    return new URL(requestUrl.value).pathname
  } catch {
    return requestUrl.value
  }
})

const steps = computed(() => {
  if (result.value) {
    const contentOk = result.value.firstContentMs !== null && Boolean(result.value.preview)
    return [
      { label: "请求已发出", detail: "POST", state: "done" },
      { label: "收到响应头", detail: `${result.value.responseHeadersMs} ms`, state: "done" },
      { label: "收到首段内容", detail: contentOk ? `${result.value.firstContentMs} ms` : "无内容", state: contentOk ? "done" : "error" },
      { label: "测试完成", detail: `${result.value.totalMs} ms`, state: result.value.ok ? "done" : "error" },
    ]
  }
  if (running.value) {
    return [
      { label: "请求已发出", detail: "POST", state: "done" },
      { label: "等待响应头", detail: `${elapsedMs.value} ms`, state: "active" },
      { label: "收到首段内容", detail: "", state: "idle" },
      { label: "测试完成", detail: "", state: "idle" },
    ]
  }
  if (testError.value) {
    return [
      { label: "请求已发出", detail: "POST", state: "done" },
      { label: "收到响应头", detail: "失败", state: "error" },
      { label: "收到首段内容", detail: "", state: "idle" },
      { label: "测试完成", detail: "", state: "idle" },
    ]
  }
  return [
    { label: "请求已发出", detail: "", state: "idle" },
    { label: "收到响应头", detail: "", state: "idle" },
    { label: "收到首段内容", detail: "", state: "idle" },
    { label: "测试完成", detail: "", state: "idle" },
  ]
})

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

function resetTest() {
  requestVersion += 1
  stopTimer()
  running.value = false
  elapsedMs.value = 0
  result.value = null
  testError.value = ""
}

watch(
  () => [props.providerId, props.baseUrl, props.apiKey, props.apiFormat, props.model],
  () => {
    selectedModel.value = props.model
    resetTest()
  },
)

watch(selectedModel, () => {
  if (!running.value) resetTest()
})

async function runTest() {
  if (!ready.value || running.value) return
  const currentRequest = ++requestVersion
  result.value = null
  testError.value = ""
  elapsedMs.value = 0
  running.value = true
  const startedAt = performance.now()
  timer = setInterval(() => {
    elapsedMs.value = Math.round(performance.now() - startedAt)
  }, 50)

  try {
    const response = await api.testModel({
      providerId: props.providerId || undefined,
      baseUrl: props.baseUrl,
      apiKey: props.apiKey,
      apiFormat: props.apiFormat,
      model: selectedModel.value,
    })
    if (currentRequest !== requestVersion) return
    result.value = response.data || null
    if (!response.success) testError.value = response.error || "模型没有返回有效内容"
  } catch (error) {
    if (currentRequest !== requestVersion) return
    testError.value = error instanceof Error ? error.message : "模型连通性测试失败"
  } finally {
    if (currentRequest === requestVersion) {
      stopTimer()
      running.value = false
    }
  }
}

onBeforeUnmount(stopTimer)
</script>

<template>
  <div class="space-y-ax-md">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-ax-sm min-w-0">
        <div class="w-8 h-8 rounded-lg bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-[20px]">network_check</span>
        </div>
        <div class="min-w-0">
          <h4 class="font-label-md text-label-md font-semibold text-primary">连通性测试</h4>
          <p class="font-body-sm text-[11px] text-secondary truncate">
            对 {{ providerName || requestHost }} 发起一次真实流式推理请求
          </p>
        </div>
      </div>
    </div>

    <div class="flex items-end gap-ax-md flex-wrap">
      <div class="flex-1 min-w-0 basis-48">
        <label class="block font-label-md text-[11px] text-secondary mb-1">测试模型</label>
        <AxModelSelect
          v-model="selectedModel"
          :options="models"
          placeholder="选择或输入测试模型"
          size="lg"
        />
      </div>
      <div class="min-w-28">
        <span class="block font-label-md text-[11px] text-secondary mb-1">API 格式</span>
        <span class="inline-flex h-7 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest items-center font-label-md text-label-md text-primary">
          {{ formatLabel }}
        </span>
      </div>
      <AxButton
        icon="network_ping"
        :loading="running"
        :disabled="!ready"
        size="lg"
        @click="runTest"
      >
        {{ running ? "测试中" : result ? "重新测试" : "开始测试" }}
      </AxButton>
    </div>
    
    <div class="grid grid-cols-[160px_minmax(0,1fr)] gap-ax-md min-h-52">
      <div class="py-1">
        <div v-for="(step, index) in steps" :key="step.label" class="relative flex gap-ax-sm min-h-12 last:min-h-0">
          <div
            v-if="index < steps.length - 1"
            class="absolute left-[11px] top-5 bottom-0 w-px"
            :class="step.state === 'done' ? 'bg-primary/45' : 'bg-outline-variant'"
          />
          <div
            class="relative z-10 w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors"
            :class="{
              'bg-primary text-on-primary border-primary': step.state === 'done',
              'bg-secondary-container text-on-secondary-container border-primary': step.state === 'active',
              'bg-error-container text-error border-error': step.state === 'error',
              'bg-surface-container-lowest text-outline border-outline-variant': step.state === 'idle',
            }"
          >
            <span
              class="material-symbols-outlined text-[14px]"
              :class="step.state === 'active' ? 'animate-pulse' : ''"
            >
              {{
                step.state === "done"
                  ? "check"
                  : step.state === "error"
                    ? "close"
                    : step.state === "active"
                      ? "hourglass_top"
                      : "circle"
              }}
            </span>
          </div>
          <div class="min-w-0">
            <p class="font-body-sm text-body-sm" :class="step.state === 'idle' ? 'text-secondary' : 'text-primary font-medium'">
              {{ step.label }}
            </p>
            <p v-if="step.detail" class="font-label-md text-[10px] text-secondary mt-0.5">
              {{ step.detail }}
            </p>
          </div>
        </div>
      </div>

      <div class="rounded-lg overflow-hidden border border-outline-variant bg-[#101114] text-slate-300 font-mono text-[11px] min-w-0">
        <div class="h-9 px-ax-md border-b border-white/10 flex items-center gap-ax-xs text-slate-400">
          <span class="material-symbols-outlined text-[14px]">terminal</span>
          <span class="truncate">{{ requestHost }}</span>
          <span v-if="running" class="ml-auto text-violet-300 animate-pulse">请求中</span>
          <span v-else-if="result?.ok" class="ml-auto text-emerald-300">HTTP {{ result.status }}</span>
          <span v-else-if="result" class="ml-auto text-rose-300">HTTP {{ result.status }}</span>
        </div>
        <div class="p-ax-md space-y-1.5 leading-relaxed break-all">
          <p><span class="text-violet-300">POST</span> <span class="text-slate-200">{{ requestPath }}</span></p>
          <p><span class="text-slate-500">Host:</span> {{ requestHost }}</p>
          <p><span class="text-slate-500">Model:</span> {{ selectedModel || "未选择" }}</p>
          <p><span class="text-slate-500">Accept:</span> text/event-stream</p>
          <div class="border-t border-white/10 pt-3 mt-3 min-h-20">
            <p class="text-slate-500 mb-2">// 响应流</p>
            <p v-if="running" class="text-violet-300 animate-pulse">等待上游返回...</p>
            <p v-else-if="result?.preview" class="text-emerald-300 whitespace-pre-wrap">{{ result.preview }}</p>
            <p v-else-if="testError" class="text-rose-300 whitespace-pre-wrap">{{ testError }}</p>
          </div>
        </div>
      </div>
    </div>

    <p class="font-body-sm text-[11px] text-secondary !mt-ax-sm">
      测试会发送"Reply with OK."并限制最多 16 个输出 Token，不会保存对话内容。
    </p>
  </div>
</template>