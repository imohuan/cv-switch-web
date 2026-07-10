import { ref } from 'vue'
import { api, type Provider, type ApiFormat, type ProviderExtraConfig } from '../api'
import { compactObject, parseExtra } from '../constants'
import { useNotify } from '../components/ui'

export function useProviderForm() {
  const { triggerNotify } = useNotify()

  const showForm = ref(false)
  const editingProvider = ref<Provider | null>(null)
  const fetchedModels = ref<Array<{ value: string; label: string }>>([])
  const fetchingModels = ref(false)

  const formName = ref('')
  const formBaseUrl = ref('')
  const formApiKey = ref('')
  const formModel = ref('')
  const formApiFormat = ref<Provider['api_format']>('openai_chat')
  const formProviderType = ref('custom')
  const formCapabilities = ref<Record<ApiFormat, boolean>>({
    openai_chat: true, openai_responses: false, anthropic: false, gemini_native: false,
  })
  const formClaudeDefault = ref('')
  const formClaudeHaiku = ref('')
  const formClaudeSonnet = ref('')
  const formClaudeOpus = ref('')
  const formCodexDefault = ref('')
  const formCodexCatalogModels = ref<string[]>([])

  function openForm(provider: Provider | null) {
    editingProvider.value = provider
    fetchedModels.value = []
    const extra = parseExtra(provider?.extra_config)
    formName.value = provider?.name || ''
    formBaseUrl.value = provider?.base_url || ''
    formApiKey.value = ''
    formModel.value = provider?.model || ''
    formApiFormat.value = provider?.api_format || 'openai_chat'
    formProviderType.value = extra.provider_type || 'custom'
    formCapabilities.value = {
      openai_chat: extra.capabilities?.openai_chat ?? (provider ? provider.api_format === 'openai_chat' : true),
      openai_responses: extra.capabilities?.openai_responses ?? (provider ? provider.api_format === 'openai_responses' : false),
      anthropic: extra.capabilities?.anthropic ?? (provider ? provider.api_format === 'anthropic' : false),
      gemini_native: extra.capabilities?.gemini_native ?? false,
    }
    formClaudeDefault.value = extra.claude?.defaultModel || provider?.model || ''
    formClaudeHaiku.value = extra.claude?.haikuModel || ''
    formClaudeSonnet.value = extra.claude?.sonnetModel || provider?.model || ''
    formClaudeOpus.value = extra.claude?.opusModel || provider?.model || ''
    formCodexDefault.value = extra.codex?.defaultModel || provider?.model || ''
    formCodexCatalogModels.value = (extra.codex?.models || []).map((m: any) => m.model).filter(Boolean)
    showForm.value = true
  }

  async function fetchAllModels() {
    fetchingModels.value = true
    try {
      let res
      if (editingProvider.value?.id) {
        res = await api.fetchModels(editingProvider.value.id)
      } else if (formBaseUrl.value) {
        res = await api.fetchModelsByConfig(formBaseUrl.value, formApiKey.value)
      } else {
        triggerNotify('请先填写 Base URL', 'error')
        return
      }
      if (res.success && res.data) {
        fetchedModels.value = res.data.map(m => ({ value: m.id, label: m.id }))
        triggerNotify(`已获取 ${fetchedModels.value.length} 个模型`, 'success')
      } else {
        triggerNotify(res.error || '获取模型失败', 'error')
      }
    } finally {
      fetchingModels.value = false
    }
  }

  async function handleSave(onSaved: () => Promise<void>) {
    if (!formName.value || !formBaseUrl.value) {
      triggerNotify('名称和 Base URL 必填', 'error')
      return
    }
    const extraConfig: ProviderExtraConfig = {
      provider_type: formProviderType.value,
      capabilities: formCapabilities.value,
      claude: compactObject({
        defaultModel: formClaudeDefault.value,
        haikuModel: formClaudeHaiku.value,
        sonnetModel: formClaudeSonnet.value,
        opusModel: formClaudeOpus.value,
      }),
      codex: compactObject({
        defaultModel: formCodexDefault.value || formModel.value,
        models: formCodexCatalogModels.value.map(m => ({ model: m })),
      }),
    }
    const payload: Partial<Provider> = {
      name: formName.value,
      base_url: formBaseUrl.value,
      ...(formApiKey.value ? { api_key: formApiKey.value } : {}),
      model: formModel.value,
      api_format: formApiFormat.value,
      extra_config: JSON.stringify(extraConfig),
    }
    const res = editingProvider.value
      ? await api.updateProvider(editingProvider.value.id, payload)
      : await api.createProvider(payload)
    if (res.success) {
      showForm.value = false
      await onSaved()
      triggerNotify(editingProvider.value ? 'Provider 已更新' : 'Provider 已创建', 'success')
    } else {
      triggerNotify(res.error || 'Save failed', 'error')
    }
  }

  function setNewApiPreset() {
    formProviderType.value = 'newapi'
    formCapabilities.value = { openai_chat: true, openai_responses: true, anthropic: true, gemini_native: false }
  }

  return {
    showForm, editingProvider, fetchedModels, fetchingModels,
    formName, formBaseUrl, formApiKey, formModel, formApiFormat,
    formProviderType, formCapabilities,
    formClaudeDefault, formClaudeHaiku, formClaudeSonnet, formClaudeOpus,
    formCodexDefault, formCodexCatalogModels,
    openForm, fetchAllModels, handleSave, setNewApiPreset,
  }
}
