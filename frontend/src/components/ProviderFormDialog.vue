<script setup lang="ts">
import { API_FORMATS } from "../constants"
import AxDialog from "./ui/AxDialog.vue"
import AxInput from "./ui/AxInput.vue"
import AxSelect from "./ui/AxSelect.vue"
import AxButton from "./ui/AxButton.vue"
import AxModelSelect from "./AxModelSelect.vue"
import ModelSettings from "./ModelSettings.vue"
import ModelConnectionTest from "./ModelConnectionTest.vue"
import { useProviderForm } from "../composables/useProviderForm"
import type { Provider } from "../api"

const emit = defineEmits<{
  saved: []
}>()

const {
  showForm, editingProvider, fetchedModels, fetchingModels,
  formName, formBaseUrl, formApiKey, formModel, formApiFormat,
  formProviderType, formCapabilities,
  formClaudeDefault, formClaudeHaiku, formClaudeSonnet, formClaudeOpus,
  formCodexDefault, formCodexCatalogModels,
  openForm, fetchAllModels, handleSave, setNewApiPreset,
} = useProviderForm()

function onSaved() {
  emit("saved")
}

function onSave() {
  handleSave(onSaved)
}

function toggleCapability(f: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  formCapabilities.value = { ...formCapabilities.value, [f]: checked }
}


function onModelsFetched(models: Array<{ value: string; label: string }>) {
  fetchedModels.value = models
}

defineExpose({ openForm })
</script>

<template>
  <AxDialog v-model="showForm" :title="editingProvider ? '编辑 Provider' : '添加 Provider'" icon="dns"
    max-width="max-w-3xl">
    <template #default>
      <div class="grid grid-cols-2 gap-ax-md">
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">名称 *</label>
          <AxInput v-model="formName" placeholder="例如：我的 New API" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Provider 类型</label>
          <div class="flex gap-ax-sm">
            <AxSelect v-model="formProviderType"
              :options="[{ value: 'custom', label: '自定义' }, { value: 'newapi', label: 'New API' }]" size="lg"
              class="flex-1" />
            <AxButton size="lg" variant="outline" @click="setNewApiPreset">套用 New API</AxButton>
          </div>
        </div>
        <div class="col-span-2">
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">Base URL *</label>
          <AxInput v-model="formBaseUrl" placeholder="https://api.example.com/v1" size="lg" />
          <p class="font-body-sm text-[11px] text-secondary mt-0.5">New API 通常填你的服务地址，协议能力在下方勾选</p>
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">API Key</label>
          <AxInput v-model="formApiKey" :password="true"
            :placeholder="editingProvider ? '留空保持原 Key' : 'sk-xxxxxxxx'" size="lg" />
        </div>
        <div>
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">默认 API 格式</label>
          <AxSelect v-model="formApiFormat"
            :options="API_FORMATS.filter(f => f.value !== 'gemini_native').map(f => ({ value: f.value, label: f.label }))"
            size="lg" />
        </div>

        <!-- 协议能力 -->
        <div class="col-span-2">
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">协议能力</label>
          <div class="grid grid-cols-2 gap-ax-xs">
            <label v-for="f in API_FORMATS" :key="f.value"
              class="flex items-center gap-ax-xs font-body-sm text-body-sm text-secondary cursor-pointer">
              <input type="checkbox" :checked="formCapabilities[f.value]"
                @change="toggleCapability(f.value, $event)"
                class="rounded border-outline text-primary" />
              {{ f.label }}
            </label>
          </div>
        </div>

        <!-- 模型设置（标签模式） -->
        <ModelSettings
          class="col-span-2"
          :provider-id="editingProvider?.id"
          :base-url="!editingProvider ? formBaseUrl : undefined"
          :api-key="!editingProvider ? formApiKey : undefined"
          :external-models="fetchedModels.length > 0 ? fetchedModels : undefined"
          multiple
          v-model="formCodexCatalogModels"
          @models-fetched="onModelsFetched"
        />

        <!-- 默认模型（单选） -->
        <div class="col-span-2">
          <label class="block font-label-md text-label-md font-semibold text-primary mb-1">默认模型</label>
          <AxModelSelect
            v-model="formModel"
            :options="fetchedModels"
            :provider-id="editingProvider?.id"
            :base-url="!editingProvider ? formBaseUrl : undefined"
            :api-key="!editingProvider ? formApiKey : undefined"
            placeholder="选择或输入默认模型"
            size="lg"
          />
        </div>

        <ModelConnectionTest class="col-span-2 bg-secondary-container/35 border border-outline-variant rounded-lg p-ax-md"
          :provider-id="editingProvider?.id" :provider-name="formName" :base-url="formBaseUrl" :api-key="formApiKey"
          :api-format="formApiFormat" :model="formModel" :models="fetchedModels" />
      </div>
    </template>

    <!-- Footer -->
    <template #footer>
      <div class="flex justify-end gap-ax-sm">
        <AxButton variant="outline" @click="showForm = false">取消</AxButton>
        <AxButton @click="onSave">{{ editingProvider ? '保存' : '添加' }}</AxButton>
      </div>
    </template>
  </AxDialog>
</template>
