import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import { logger } from '../services/logger.js';

const router = Router();

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

router.get('/claude/:providerId/v1/models', (req: Request, res: Response) => {
  const provider = db.getProviderById(req.params.providerId);
  if (!provider) {
    logger.claudeProxy.error('GET /v1/models: Provider 未找到', { providerId: req.params.providerId });
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }

  // 从 provider extra_config 中提取 Claude 模型列表，确保 ANTHROPIC_MODEL 等配置值被识别为有效模型
  let extra: any = {};
  try { extra = JSON.parse(provider.extra_config || '{}'); } catch { /* ignore */ }
  const claudeModels = new Set<string>();
  claudeModels.add(provider.model);
  const mc = extra.claude || {};
  for (const k of ['defaultModel', 'smallFastModel', 'haikuModel', 'sonnetModel', 'opusModel']) {
    if (mc[k]) claudeModels.add(mc[k]);
  }

  const models = [...claudeModels].map(id => ({ id, type: 'model', display_name: id }));
  logger.claudeProxy.info('GET /v1/models', { providerId: provider.id, count: models.length });
  res.json({ data: models });
});

router.post('/claude/:providerId/v1/messages', async (req: Request, res: Response) => {
  await handleClaudeMessages(req, res);
});

router.post('/claude/:providerId/messages', async (req: Request, res: Response) => {
  await handleClaudeMessages(req, res);
});

async function handleClaudeMessages(req: Request, res: Response) {
  const provider = db.getProviderById(req.params.providerId);
  if (!provider) {
    logger.claudeProxy.error('Provider 未找到', { providerId: req.params.providerId });
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  if (provider.api_format !== 'openai_chat') {
    logger.claudeProxy.error('Provider 格式不匹配，期望 openai_chat', { providerId: provider.id, apiFormat: provider.api_format });
    res.status(400).json({ error: { message: 'Provider is not configured for OpenAI Chat Completions' } });
    return;
  }

  const chatBody = anthropicToChat(req.body, provider);
  const upstreamUrl = `${trimTrailingSlash(provider.base_url)}/chat/completions`;
  const actualModel = String(chatBody.model || provider.model);
  const startTime = Date.now();

  logger.claudeProxy.request(provider.id, actualModel, JSON.stringify(req.body).length);
  logger.claudeProxy.upstreamRequest(upstreamUrl, actualModel, chatBody.stream === true);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.api_key}` },
      body: JSON.stringify(chatBody),
    });

    const latencyMs = Date.now() - startTime;

    if (!upstream.ok) {
      const parsed = await safeReadJsonOrText(upstream);
      const errBody = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      logger.claudeProxy.upstreamResponseError(actualModel, upstream.status, latencyMs, errBody);
      res.status(upstream.status).json(openaiErrorToAnthropic(parsed));
      return;
    }

    logger.claudeProxy.upstreamResponseOk(actualModel, upstream.status, latencyMs, chatBody.stream === true);

    if (chatBody.stream) {
      await streamChatAsAnthropic(upstream, req.body, provider, res);
      return;
    }

    const json = await upstream.json();
    res.json(chatToAnthropic(json, req.body, provider));
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.claudeProxy.error(`连接失败: ${err.message}`, { providerId: provider.id, model: actualModel, latencyMs });
    res.status(500).json({ error: { type: 'api_error', message: err.message || 'Claude proxy failed' } });
  }
}

function anthropicToChat(body: any, provider: db.Provider): Record<string, JsonValue> {
  const messages: JsonValue[] = [];
  const system = stripBillingHeader(systemToText(body.system));
  if (system) messages.push({ role: 'system', content: system });
  for (const message of body.messages || []) {
    const converted = anthropicMessageToChat(message);
    if (Array.isArray(converted)) messages.push(...converted);
    else if (converted) messages.push(converted);
  }

  const model = provider.model || body.model;
  const result: Record<string, JsonValue> = { model, messages, stream: Boolean(body.stream) };
  if (body.max_tokens) {
    if (supportsMaxCompletionTokens(String(model || ''))) result.max_completion_tokens = body.max_tokens;
    else result.max_tokens = body.max_tokens;
  }
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) result.stop = body.stop_sequences;
  const reasoningEffort = resolveReasoningEffort(body, String(model || ''));
  if (reasoningEffort) result.reasoning_effort = reasoningEffort;
  const tools = Array.isArray(body.tools) ? body.tools.filter((tool: any) => tool?.type !== 'BatchTool' && tool?.name !== 'BatchTool').map(anthropicToolToChatTool).filter(Boolean) : [];
  if (tools.length > 0) {
    result.tools = tools;
    if (body.tool_choice) result.tool_choice = anthropicToolChoiceToChat(body.tool_choice);
  }
  if (result.stream) result.stream_options = mergeIncludeUsage(null);
  return result;
}

function anthropicMessageToChat(message: any): JsonValue | JsonValue[] | null {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  if (typeof message.content === 'string') return { role, content: message.content };
  if (!Array.isArray(message.content)) return { role, content: textFromUnknown(message.content) };
  const textParts: any[] = [];
  const output: JsonValue[] = [];
  let reasoning = '';
  for (const part of message.content) {
    if (part?.type === 'text') textParts.push({ type: 'text', text: part.text || '' });
    if (part?.type === 'image') textParts.push(anthropicImageToOpenAi(part));
    if (part?.type === 'thinking' || part?.type === 'redacted_thinking') reasoning = appendText(reasoning, part.thinking || part.text || '[redacted thinking]');
    if (part?.type === 'tool_use') {
      output.push({
        role: 'assistant',
        content: textParts.length ? openAiContentOrText(textParts) : null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        tool_calls: [{ id: part.id, type: 'function', function: { name: part.name, arguments: canonicalJsonString(part.input || {}) } }],
      });
      textParts.length = 0;
      reasoning = '';
    }
    if (part?.type === 'tool_result') {
      if (textParts.length > 0 || reasoning) {
        output.push({ role, content: openAiContentOrText(textParts), ...(reasoning ? { reasoning_content: reasoning } : {}) });
        textParts.length = 0;
        reasoning = '';
      }
      output.push({ role: 'tool', tool_call_id: part.tool_use_id, content: anthropicContentToText(part.content) });
    }
  }
  if (textParts.length > 0 || reasoning) output.push({ role, content: openAiContentOrText(textParts), ...(reasoning ? { reasoning_content: reasoning } : {}) });
  return output.length === 1 ? output[0] : output;
}

function anthropicImageToOpenAi(part: any): JsonValue {
  const source = part.source || {};
  if (source.type === 'base64') return { type: 'image_url', image_url: { url: `data:${source.media_type || 'image/png'};base64,${source.data || ''}` } };
  if (source.url) return { type: 'image_url', image_url: { url: source.url } };
  return { type: 'text', text: '' };
}

function openAiContentOrText(parts: any[]): JsonValue {
  const clean = parts.filter((part) => part.type !== 'text' || part.text);
  if (clean.length === 0) return '';
  if (clean.every((part) => part.type === 'text')) return clean.map((part) => part.text).join('\n');
  return clean as JsonValue;
}

function anthropicToolToChatTool(tool: any): JsonValue | null {
  if (!tool || typeof tool !== 'object') return null;
  return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: cleanSchema(tool.input_schema || {}) } };
}

function anthropicToolChoiceToChat(choice: any): JsonValue {
  if (choice === 'auto' || choice?.type === 'auto') return 'auto';
  if (choice === 'none' || choice?.type === 'none') return 'none';
  if (choice === 'any' || choice?.type === 'any') return 'required';
  if (choice?.type === 'tool' && choice.name) return { type: 'function', function: { name: choice.name } };
  return 'auto';
}

function chatToAnthropic(chat: any, requestBody: any, provider: db.Provider): Record<string, JsonValue> {
  const choice = chat.choices?.[0] || {};
  const message = choice.message || {};
  const content: JsonValue[] = [];
  const reasoning = message.reasoning_content || message.reasoning || extractThinkBlock(message.content);
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning, signature: '' });
  for (const text of openAiMessageTexts(message)) content.push({ type: 'text', text });
  if (message.refusal) content.push({ type: 'text', text: message.refusal });
  const legacy = message.function_call ? [{ id: `call_${Date.now()}`, function: message.function_call }] : [];
  for (const toolCall of [...(message.tool_calls || []), ...legacy]) {
    content.push({ type: 'tool_use', id: toolCall.id || `toolu_${Date.now()}`, name: toolCall.function?.name || '', input: parseToolArguments(toolCall.function?.arguments) });
  }
  return { id: chat.id || `msg_${Date.now()}`, type: 'message', role: 'assistant', model: message.model || provider.model || requestBody.model, content, stop_reason: mapStopReason(choice.finish_reason), stop_sequence: null, usage: mapUsage(chat.usage) };
}

function openAiMessageTexts(message: any): string[] {
  const content = message.content;
  if (typeof content === 'string') return [stripThinkBlock(content)].filter(Boolean);
  if (!Array.isArray(content)) return [];
  return content.map((part) => part?.text || part?.output_text || part?.refusal || '').filter(Boolean);
}

async function streamChatAsAnthropic(upstream: globalThis.Response, requestBody: any, provider: db.Provider, res: Response) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const messageId = `msg_${Date.now()}`;
  const model = provider.model || requestBody.model;
  let contentStarted = false;
  let thinkingStarted = false;
  let finalUsage: any = null;
  let finishReason: string | null = null;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string; started: boolean; contentIndex: number }>();
  let nextContentIndex = 0;

  writeSse(res, 'message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: defaultUsage() } });

  const reader = upstream.body?.getReader();
  if (!reader) throw new Error('Upstream response body is not readable');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) {
        writeSse(res, 'error', { type: 'error', error: { type: chunk.error.type || 'upstream_error', message: chunk.error.message || 'Upstream stream failed' } });
        res.end();
        return;
      }
      if (chunk.usage) finalUsage = chunk.usage;
      const choice = chunk.choices?.[0] || {};
      const delta = choice.delta || {};
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const reasoningDelta = delta.reasoning_content || delta.reasoning || extractThinkBlock(delta.content);
      if (reasoningDelta) {
        if (!thinkingStarted) {
          thinkingStarted = true;
          writeSse(res, 'content_block_start', { type: 'content_block_start', index: nextContentIndex, content_block: { type: 'thinking', thinking: '', signature: '' } });
        }
        writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: nextContentIndex, delta: { type: 'thinking_delta', thinking: reasoningDelta } });
      }
      const textDelta = stripThinkBlock(delta.content);
      if (textDelta) {
        if (thinkingStarted) {
          writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: nextContentIndex });
          thinkingStarted = false;
          nextContentIndex += 1;
        }
        if (!contentStarted) {
          contentStarted = true;
          writeSse(res, 'content_block_start', { type: 'content_block_start', index: nextContentIndex, content_block: { type: 'text', text: '' } });
        }
        writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: nextContentIndex, delta: { type: 'text_delta', text: textDelta } });
      }
      for (const toolCall of delta.tool_calls || []) {
        if (thinkingStarted) {
          writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: nextContentIndex });
          thinkingStarted = false;
          nextContentIndex += 1;
        }
        if (contentStarted) {
          writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: nextContentIndex });
          contentStarted = false;
          nextContentIndex += 1;
        }
        const index = toolCall.index || 0;
        const existing = toolCalls.get(index) || { id: toolCall.id || `toolu_${index}`, name: '', arguments: '', started: false, contentIndex: nextContentIndex++ };
        existing.id = toolCall.id || existing.id;
        existing.name += toolCall.function?.name || '';
        const argDelta = toolCall.function?.arguments || '';
        if (!existing.started && existing.name) {
          existing.started = true;
          writeSse(res, 'content_block_start', { type: 'content_block_start', index: existing.contentIndex, content_block: { type: 'tool_use', id: existing.id, name: existing.name, input: {} } });
        }
        if (argDelta) {
          existing.arguments += argDelta;
          writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: existing.contentIndex, delta: { type: 'input_json_delta', partial_json: argDelta } });
        }
        toolCalls.set(index, existing);
      }
    }
  }

  if (thinkingStarted) writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: nextContentIndex });
  if (contentStarted) writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: nextContentIndex });
  for (const toolCall of toolCalls.values()) {
    if (toolCall.started) writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: toolCall.contentIndex });
  }
  writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: mapStopReason(finishReason), stop_sequence: null }, usage: mapUsage(finalUsage) });
  writeSse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function mapStopReason(reason: unknown): string {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop') return 'end_turn';
  return 'end_turn';
}

function mapUsage(usage: any): JsonValue {
  const cached = usage?.prompt_tokens_details?.cached_tokens || 0;
  const cacheCreation = usage?.prompt_tokens_details?.cache_creation_tokens || 0;
  const input = Math.max(0, (usage?.prompt_tokens || 0) - cached - cacheCreation);
  return { input_tokens: input, output_tokens: usage?.completion_tokens || 0, cache_read_input_tokens: cached, cache_creation_input_tokens: cacheCreation };
}

function defaultUsage(): JsonValue { return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }; }
function parseToolArguments(value: unknown): JsonValue { if (typeof value !== 'string') return {}; try { return JSON.parse(value); } catch { return {}; } }
function canonicalJsonString(value: unknown): string { if (typeof value === 'string') { try { return JSON.stringify(sortJson(JSON.parse(value))); } catch { return value; } } return JSON.stringify(sortJson(value)); }
function sortJson(value: any): any { if (Array.isArray(value)) return value.map(sortJson); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])])); }
function cleanSchema(schema: any): any { if (Array.isArray(schema)) return schema.map(cleanSchema); if (!schema || typeof schema !== 'object') return schema; const out: Record<string, any> = {}; for (const [key, value] of Object.entries(schema)) { if (key === 'format' && value === 'uri') continue; out[key] = cleanSchema(value); } return out; }
function supportsMaxCompletionTokens(model: string): boolean { const lower = model.toLowerCase(); return lower.startsWith('o') || lower.startsWith('gpt-5'); }
function resolveReasoningEffort(body: any, model: string): string | null { if (!/gpt-5|\bo\d|deepseek|qwen|glm|kimi|minimax/i.test(model)) return null; const effort = body.thinking?.budget_tokens || body.thinking?.effort || body.reasoning_effort; if (typeof effort === 'string') return effort === 'max' ? 'high' : effort; if (typeof effort === 'number') return effort > 12000 ? 'high' : effort > 4000 ? 'medium' : 'low'; return null; }
function mergeIncludeUsage(streamOptions: unknown): JsonValue { const base = streamOptions && typeof streamOptions === 'object' && !Array.isArray(streamOptions) ? { ...(streamOptions as Record<string, any>) } : {}; base.include_usage = true; return base as JsonValue; }
function anthropicContentToText(content: unknown): string { if (typeof content === 'string') return content; if (!Array.isArray(content)) return textFromUnknown(content); return content.map((part) => typeof part === 'string' ? part : part?.text || JSON.stringify(part)).filter(Boolean).join('\n'); }
function systemToText(system: unknown): string { if (typeof system === 'string') return system; if (!Array.isArray(system)) return ''; return system.map((part) => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n\n'); }
function stripBillingHeader(text: string): string { return text.replace(/^\s*x-anthropic-billing[^\n]*\n?/i, '').trimStart(); }
function textFromUnknown(value: unknown): string { if (typeof value === 'string') return value; if (value === null || value === undefined) return ''; return typeof value === 'object' ? JSON.stringify(value) : String(value); }
function appendText(existing: string, next: string): string { return [existing, next].filter(Boolean).join('\n'); }
function extractThinkBlock(value: unknown): string { if (typeof value !== 'string') return ''; const match = value.match(/<think>([\s\S]*?)<\/think>/i); return match?.[1]?.trim() || ''; }
function stripThinkBlock(value: unknown): string { if (typeof value !== 'string') return ''; return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart(); }
function openaiErrorToAnthropic(value: unknown): JsonValue { const error = typeof value === 'object' && value ? (value as any).error || value : { message: String(value) }; return { type: 'error', error: { type: error.type || 'api_error', message: error.message || 'Upstream request failed' } }; }
async function safeReadJsonOrText(response: globalThis.Response): Promise<unknown> { const text = await response.text(); try { return JSON.parse(text); } catch { return text; } }
function writeSse(res: Response, event: string, data: JsonValue) { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); }
function trimTrailingSlash(value: string) { return value.replace(/\/+$/, ''); }

export default router;
