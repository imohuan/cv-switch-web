import { ref } from 'vue'
import { api } from '../api'
import { toConfigFile, type ConfigFile } from '../constants'

export function useConfigViewer() {
  const expandedConfigId = ref<string | null>(null)
  const profileConfigs = ref<Record<string, { home_dir: string; app_type: string; files: ConfigFile[] } | null>>({})
  const loadingConfig = ref<string | null>(null)
  const expandedFiles = ref<Set<string>>(new Set())

  function toggleProfileConfig(profileId: string) {
    if (expandedConfigId.value === profileId) {
      expandedConfigId.value = null
      return
    }
    expandedConfigId.value = profileId
    loadProfileConfig(profileId)
  }

  function toggleFileExpand(profileId: string, fileIdx: number) {
    const key = `${profileId}-${fileIdx}`
    if (expandedFiles.value.has(key)) {
      expandedFiles.value.delete(key)
      expandedFiles.value = new Set(expandedFiles.value)
    } else {
      expandedFiles.value.add(key)
      expandedFiles.value = new Set(expandedFiles.value)
    }
  }

  function expandedFileKey(key: string): boolean {
    return expandedFiles.value.has(key)
  }

  async function loadProfileConfig(id: string) {
    loadingConfig.value = id
    try {
      const res = await api.getProfileConfig(id)
      if (res.success && res.data) {
        profileConfigs.value[id] = {
          ...res.data,
          files: res.data.files.map(toConfigFile),
        }
      } else {
        profileConfigs.value[id] = {
          home_dir: '',
          app_type: '',
          files: [{ label: '错误', content: res.error || '读取失败', exists: false }],
        }
      }
    } catch (e: any) {
      profileConfigs.value[id] = {
        home_dir: '',
        app_type: '',
        files: [{ label: '错误', content: e.message, exists: false }],
      }
    } finally {
      loadingConfig.value = null
    }
  }

  // ---- App config viewer (概览页用) ----
  const expandedAppConfig = ref<string | null>(null)
  const appConfigs = ref<Record<string, { home_dir: string; app_type: string; files: ConfigFile[] } | null>>({})
  const loadingAppConfig = ref<string | null>(null)
  const expandedAppFiles = ref<Set<string>>(new Set())

  function toggleAppConfig(appType: string) {
    if (expandedAppConfig.value === appType) {
      expandedAppConfig.value = null
      return
    }
    expandedAppConfig.value = appType
    loadAppConfig(appType)
  }

  function toggleAppFileExpand(appType: string, fileIdx: number) {
    const key = `${appType}-${fileIdx}`
    if (expandedAppFiles.value.has(key)) {
      expandedAppFiles.value.delete(key)
      expandedAppFiles.value = new Set(expandedAppFiles.value)
    } else {
      expandedAppFiles.value.add(key)
      expandedAppFiles.value = new Set(expandedAppFiles.value)
    }
  }

  function expandedAppFileKey(key: string): boolean {
    return expandedAppFiles.value.has(key)
  }

  async function loadAppConfig(appType: string) {
    loadingAppConfig.value = appType
    try {
      const res = await api.getAppConfig(appType)
      if (res.success && res.data) {
        appConfigs.value[appType] = {
          ...res.data,
          files: res.data.files.map(toConfigFile),
        }
      } else {
        appConfigs.value[appType] = {
          home_dir: '',
          app_type: appType,
          files: [{ label: '错误', content: res.error || '读取失败', exists: false }],
        }
      }
    } catch (e: any) {
      appConfigs.value[appType] = {
        home_dir: '',
        app_type: appType,
        files: [{ label: '错误', content: e.message, exists: false }],
      }
    } finally {
      loadingAppConfig.value = null
    }
  }

  return {
    // profile config
    expandedConfigId, profileConfigs, loadingConfig, expandedFiles,
    toggleProfileConfig, toggleFileExpand, expandedFileKey, loadProfileConfig,
    // app config
    expandedAppConfig, appConfigs, loadingAppConfig, expandedAppFiles,
    toggleAppConfig, toggleAppFileExpand, expandedAppFileKey, loadAppConfig,
  }
}
