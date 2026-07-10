import { ref, watch } from 'vue'
import { api, type Provider, type Profile } from '../api'
import { compactObject, parseExtra } from '../constants'
import { useNotify } from '../components/ui'

export function useProfileForm(providers: () => Provider[], onSaved: () => Promise<void>) {
  const { triggerNotify } = useNotify()

  const profileName = ref('')
  const profileApp = ref('codex')
  const profileProviderId = ref('')
  const profileClaudeDefault = ref('')
  const profileClaudeHaiku = ref('')
  const profileClaudeSonnet = ref('')
  const profileClaudeOpus = ref('')
  const profileCodexDefault = ref('')
  const profileCodexCatalogModels = ref<string[]>([])

  /** 每个 Profile 的启动命令平台选择 */
  const profileCommandPlatform = ref<Record<string, 'bash' | 'powershell' | 'cmd'>>({})

  function getCommandForProfile(p: Profile): string {
    const plat = profileCommandPlatform.value[p.id] || 'bash'
    return p.commands?.[plat] || p.command
  }

  /** Provider 选择后自动回填模型字段 */
  watch(profileProviderId, (newPid) => {
    if (!newPid) return
    const providerList = providers()
    const provider = providerList.find(p => p.id === newPid)
    if (!provider) return
    const extra = parseExtra(provider.extra_config)
    profileClaudeDefault.value = extra.claude?.defaultModel || ''
    profileClaudeHaiku.value = extra.claude?.haikuModel || ''
    profileClaudeSonnet.value = extra.claude?.sonnetModel || ''
    profileClaudeOpus.value = extra.claude?.opusModel || ''
    profileCodexDefault.value = extra.codex?.defaultModel || ''
    profileCodexCatalogModels.value = (extra.codex?.models || []).map(m => m.model)
  })

  async function handleCreateProfile() {
    const pid = profileProviderId.value || providers()[0]?.id
    if (!profileName.value || !pid) {
      triggerNotify('请填写名称并选择 Provider', 'error')
      return
    }
    const extra =
      profileApp.value === 'claude'
        ? {
            claude: compactObject({
              defaultModel: profileClaudeDefault.value,
              haikuModel: profileClaudeHaiku.value,
              sonnetModel: profileClaudeSonnet.value,
              opusModel: profileClaudeOpus.value,
            }),
          }
        : profileApp.value === 'codex'
          ? {
              codex: compactObject({
                defaultModel: profileCodexDefault.value,
                models: profileCodexCatalogModels.value.map(m => ({ model: m })),
              }),
            }
          : {}

    const res = await api.createProfile({
      name: profileName.value,
      app_type: profileApp.value,
      provider_id: pid,
      extra_config: JSON.stringify(extra),
    })
    if (res.success) {
      profileName.value = ''
      profileProviderId.value = ''
      profileClaudeDefault.value = ''
      profileClaudeHaiku.value = ''
      profileClaudeSonnet.value = ''
      profileClaudeOpus.value = ''
      profileCodexDefault.value = ''
      profileCodexCatalogModels.value = []
      await onSaved()
      triggerNotify('Profile 已创建', 'success')
    } else {
      triggerNotify(res.error || 'Create profile failed', 'error')
    }
  }

  return {
    profileName, profileApp, profileProviderId,
    profileClaudeDefault, profileClaudeHaiku, profileClaudeSonnet, profileClaudeOpus,
    profileCodexDefault, profileCodexCatalogModels,
    profileCommandPlatform,
    getCommandForProfile, handleCreateProfile,
  }
}
