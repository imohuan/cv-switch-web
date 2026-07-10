import { ref, computed, onMounted } from 'vue'
import { api, type Provider, type Profile, type AppStatus } from '../api'

export function useAppData() {
  const providers = ref<Provider[]>([])
  const profiles = ref<Profile[]>([])
  const statuses = ref<Record<string, AppStatus>>({})
  const loading = ref(true)
  const error = ref('')

  async function loadData() {
    loading.value = true
    error.value = ''
    try {
      const [provRes, statusRes, profileRes] = await Promise.all([
        api.getProviders(),
        api.getStatus(),
        api.getProfiles(),
      ])
      if (provRes.success && provRes.data) providers.value = provRes.data
      if (statusRes.success && statusRes.data) statuses.value = statusRes.data
      if (profileRes.success && profileRes.data) profiles.value = profileRes.data
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  const connectedCount = computed(() =>
    Object.values(statuses.value).filter(s => s.current_provider_id).length,
  )

  const providerOptions = computed(() =>
    providers.value.map(p => ({ value: p.id, label: p.name })),
  )

  onMounted(loadData)

  return {
    providers,
    profiles,
    statuses,
    loading,
    error,
    loadData,
    connectedCount,
    providerOptions,
  }
}
