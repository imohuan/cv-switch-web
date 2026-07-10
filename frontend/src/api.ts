const API_BASE = '/api'

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  model: string
  api_format: 'openai_chat' | 'openai_responses' | 'anthropic'
  extra_config: string
  sort_index: number
  created_at: string
  updated_at: string
}

export type ApiFormat = 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini_native'

export interface ProviderExtraConfig {
  provider_type?: string
  capabilities?: Partial<Record<ApiFormat, boolean>>
  claude?: {
    defaultModel?: string
    smallFastModel?: string
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
  }
  codex?: {
    defaultModel?: string
    models?: Array<{
      model: string
      displayName?: string
      contextWindow?: number | string
      supportsParallelToolCalls?: boolean
      inputModalities?: string[]
      baseInstructions?: string
    }>
  }
}

export interface ModelTestResult {
  ok: boolean
  url: string
  status: number
  statusText: string
  responseHeadersMs: number
  firstContentMs: number | null
  totalMs: number
  preview: string
}

export interface AppStatus {
  app_type: string
  current_provider_id: string | null
  current_provider_name: string | null
  live_config_status: {
    configured: boolean
    model?: string
    base_url?: string
  }
  updated_at: string
}

export interface WorkBuddyModel {
  id: string
  name: string
  vendor: string
  url: string
  apiKey?: string
  supportsToolCall: boolean
  supportsImages: boolean
  supportsReasoning: boolean
  useCustomProtocol: boolean
  reasoning?: {
    defaultEffort?: string
    supportedEfforts?: string[]
    [key: string]: unknown
  }
  maxInputTokens?: number
  maxOutputTokens?: number
  [key: string]: unknown
}

export interface WorkBuddyModelsData {
  exists: boolean
  path: string
  models: WorkBuddyModel[]
}

export interface Profile {
  id: string
  name: string
  app_type: string
  provider_id: string
  slug: string
  extra_config: string
  provider_name: string | null
  provider_model: string | null
  provider_base_url: string | null
  home_dir: string
  command: string
  commands: {
    bash: string
    powershell: string
    cmd: string
  }
  created_at: string
  updated_at: string
}

export type JsonPathSegment = string | number

export interface ConfigFilePayload {
  label: string
  content: string
  exists: boolean
  changes?: Record<string, string>
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return res.json()
}

export const api = {
  getProviders: () => request<Provider[]>('/providers-safe'),
  createProvider: (data: Partial<Provider>) =>
    request<Provider>('/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id: string, data: Partial<Provider>) =>
    request<Provider>(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (id: string) =>
    request<boolean>(`/providers/${id}`, { method: 'DELETE' }),

  getProfiles: () => request<Profile[]>('/profiles'),
  createProfile: (data: { name: string; app_type: string; provider_id: string; extra_config?: string }) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(data) }),
  applyProfile: (id: string) =>
    request<Profile>(`/profiles/${id}/apply`, { method: 'POST' }),
  getProfileConfig: (id: string) =>
    request<{ home_dir: string; app_type: string; files: ConfigFilePayload[] }>(`/profiles/${id}/config`),
  getAppConfig: (appType: string) =>
    request<{ home_dir: string; app_type: string; files: ConfigFilePayload[] }>(`/app/${appType}/config`),
  deleteProfile: (id: string) =>
    request<boolean>(`/profiles/${id}`, { method: 'DELETE' }),

  getStatus: () => request<Record<string, AppStatus>>('/status'),

  switchProvider: (appType: string, providerId: string) =>
    request<{ appType: string; providerId: string }>(`/switch/${appType}/${providerId}`, { method: 'POST' }),
  clearProvider: (appType: string) =>
    request<null>(`/switch/${appType}/clear`, { method: 'POST' }),

  getWorkBuddyModels: () => request<WorkBuddyModelsData>('/workbuddy/models'),
  saveWorkBuddyModel: (originalId: string | null, model: WorkBuddyModel) =>
    request<WorkBuddyModel>(`/workbuddy/models/${encodeURIComponent(originalId || '__new__')}`, {
      method: 'PUT',
      body: JSON.stringify(model),
    }),
  deleteWorkBuddyModel: (id: string) =>
    request<boolean>(`/workbuddy/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fetchModels: (providerId: string) =>
    request<Array<{ id: string }>>(`/providers/${providerId}/models`),

  fetchModelsByConfig: (baseUrl: string, apiKey: string) =>
    request<Array<{ id: string }>>('/models/fetch', {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey }),
    }),

  testModel: (data: {
    providerId?: string
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    model: string
  }) => request<ModelTestResult>('/models/test', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
}
