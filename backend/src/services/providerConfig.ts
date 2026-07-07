import type { Provider } from '../db.js';
import { PUBLIC_BASE_URL } from '../config.js';

export type ApiFormat = 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini_native';

export interface ProviderExtraConfig {
  provider_type?: string;
  capabilities?: Partial<Record<ApiFormat, boolean>>;
  claude?: {
    defaultModel?: string;
    smallFastModel?: string;
    haikuModel?: string;
    sonnetModel?: string;
    opusModel?: string;
  };
  codex?: {
    defaultModel?: string;
    models?: Array<{
      model: string;
      displayName?: string;
      contextWindow?: number | string;
      supportsParallelToolCalls?: boolean;
      inputModalities?: string[];
      baseInstructions?: string;
    }>;
  };
}

export function parseProviderExtra(provider: Provider): ProviderExtraConfig {
  try {
    const parsed = JSON.parse(provider.extra_config || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function providerSupports(provider: Provider, format: ApiFormat): boolean {
  const extra = parseProviderExtra(provider);
  const value = extra.capabilities?.[format];
  if (typeof value === 'boolean') return value;
  return provider.api_format === format;
}

export function bestFormatForApp(provider: Provider, appType: 'codex' | 'claude'): ApiFormat {
  if (appType === 'codex') {
    if (providerSupports(provider, 'openai_responses')) return 'openai_responses';
    return 'openai_chat';
  }
  if (providerSupports(provider, 'anthropic')) return 'anthropic';
  if (providerSupports(provider, 'openai_chat')) return 'openai_chat';
  return provider.api_format;
}

export function claudeModels(provider: Provider) {
  const models = parseProviderExtra(provider).claude || {};
  const fallback = provider.model || '';
  return {
    defaultModel: models.defaultModel || fallback,
    smallFastModel: models.smallFastModel || models.haikuModel || fallback,
    haikuModel: models.haikuModel || models.smallFastModel || fallback,
    sonnetModel: models.sonnetModel || models.defaultModel || fallback,
    opusModel: models.opusModel || models.defaultModel || fallback,
  };
}

export function codexModels(provider: Provider) {
  const codex = parseProviderExtra(provider).codex || {};
  const defaultModel = codex.defaultModel || provider.model || 'gpt-4';
  const models = (codex.models || [])
    .filter((item) => item?.model && String(item.model).trim())
    .map((item) => ({ ...item, model: String(item.model).trim() }));
  if (!models.some((item) => item.model === defaultModel)) {
    models.unshift({ model: defaultModel, displayName: defaultModel });
  }
  return { defaultModel, models };
}

export function publicBaseUrl() {
  return PUBLIC_BASE_URL;
}
