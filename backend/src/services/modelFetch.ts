export type ModelApiFormat = 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini_native';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ModelConnectionConfig {
  baseUrl: string;
  apiKey?: string;
  apiFormat: ModelApiFormat;
  model: string;
}

export interface ModelProbeResult {
  ok: boolean;
  url: string;
  status: number;
  statusText: string;
  responseHeadersMs: number;
  firstContentMs: number | null;
  totalMs: number;
  preview: string;
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function versionedBaseUrl(baseUrl: string, version: 'v1' | 'v1beta'): string {
  const base = cleanBaseUrl(baseUrl);
  return /\/v\d+(?:beta)?$/i.test(base) ? base : `${base}/${version}`;
}

function endpointUrl(baseUrl: string, path: string, version: 'v1' | 'v1beta' = 'v1'): string {
  return `${versionedBaseUrl(baseUrl, version)}/${path.replace(/^\/+/, '')}`;
}

function modelUrls(baseUrl: string): string[] {
  const base = cleanBaseUrl(baseUrl);
  const urls = [`${base}/models`];
  if (!/\/v\d+(?:beta)?$/i.test(base)) urls.push(`${base}/v1/models`);
  return urls;
}

function modelsFromPayload(payload: unknown): Array<{ id: string }> {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return items
    .map((item) => typeof item === 'string' ? { id: item } : item as { id?: unknown })
    .filter((item): item is { id: string } => typeof item?.id === 'string' && item.id.length > 0)
    .map(({ id }) => ({ id }));
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}): Promise<{ models: Array<{ id: string }>; url: string }> {
  const fetchImpl = input.fetchImpl || fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
  let lastError = 'Provider did not return a model list';

  for (const url of modelUrls(input.baseUrl)) {
    try {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        lastError = `Provider returned ${response.status}: ${response.statusText}`;
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        lastError = `Provider returned unsupported content type: ${contentType || 'unknown'}`;
        continue;
      }
      const models = modelsFromPayload(await response.json());
      if (models.length > 0) return { models, url };
      lastError = 'Provider returned an empty model list';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

export function buildModelProbeRequest(config: ModelConnectionConfig): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json',
  };

  if (config.apiFormat === 'gemini_native') {
    const model = encodeURIComponent(config.model);
    const key = config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : '';
    return {
      url: `${endpointUrl(config.baseUrl, `models/${model}:streamGenerateContent`, 'v1beta')}?alt=sse${key}`,
      headers,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
        generationConfig: { maxOutputTokens: 16 },
      }),
    };
  }

  if (config.apiFormat === 'anthropic') {
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      url: endpointUrl(config.baseUrl, 'messages'),
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 16,
        stream: true,
      }),
    };
  }

  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.apiFormat === 'openai_responses') {
    return {
      url: endpointUrl(config.baseUrl, 'responses'),
      headers,
      body: JSON.stringify({
        model: config.model,
        input: 'Reply with OK.',
        max_output_tokens: 16,
        stream: true,
      }),
    };
  }

  return {
    url: endpointUrl(config.baseUrl, 'chat/completions'),
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 16,
      stream: true,
    }),
  };
}

function textFromPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output_text === 'string') return payload.output_text;

  const choice = payload.choices?.[0];
  const choiceText = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
  if (typeof choiceText === 'string') return choiceText;

  const contentText = payload.content?.find?.((item: any) => typeof item?.text === 'string')?.text;
  if (typeof contentText === 'string') return contentText;

  const candidateText = payload.candidates?.[0]?.content?.parts?.find?.((part: any) => typeof part?.text === 'string')?.text;
  return typeof candidateText === 'string' ? candidateText : '';
}

function responsePreview(raw: string): string {
  const payloads = raw
    .split(/\r?\n/)
    .map((line) => line.startsWith('data:') ? line.slice(5).trim() : line.trim())
    .filter((line) => line && line !== '[DONE]');

  const parts: string[] = [];
  for (const payload of payloads) {
    try {
      const text = textFromPayload(JSON.parse(payload));
      if (text) parts.push(text);
    } catch {
      if (!raw.includes('data:')) return raw.trim().slice(0, 240);
    }
  }
  return parts.join('').trim().slice(0, 240);
}

export async function testProviderModel(input: ModelConnectionConfig & {
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<ModelProbeResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const now = input.now || (() => performance.now());
  const request = buildModelProbeRequest(input);
  const startedAt = now();
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(30_000),
  });
  const headersAt = now();
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let firstContentAt: number | null = null;

  if (reader) {
    while (raw.length < 65_536) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk && firstContentAt === null) firstContentAt = now();
      raw += chunk;
    }
    raw += decoder.decode();
    if (raw.length >= 65_536) await reader.cancel();
  } else {
    raw = await response.text();
    if (raw) firstContentAt = now();
  }

  const finishedAt = now();
  const preview = responsePreview(raw);
  return {
    ok: response.ok && Boolean(preview),
    url: request.url,
    status: response.status,
    statusText: response.statusText,
    responseHeadersMs: Math.round(headersAt - startedAt),
    firstContentMs: firstContentAt === null ? null : Math.round(firstContentAt - startedAt),
    totalMs: Math.round(finishedAt - startedAt),
    preview: preview || raw.trim().slice(0, 240),
  };
}