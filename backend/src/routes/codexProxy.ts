import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import { codexModels } from '../services/providerConfig.js';
import { logger } from '../services/logger.js';

const router = Router();

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const EXTRA_CHAT_PASSTHROUGH_FIELDS = [
  'frequency_penalty', 'logit_bias', 'logprobs', 'metadata', 'n', 'presence_penalty',
  'response_format', 'seed', 'service_tier', 'stop', 'top_logprobs', 'user',
];

router.get('/codex/:providerId/v1/models', (req: Request, res: Response) => {
  const provider = db.getProviderById(req.params.providerId);
  if (!provider) {
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  const { models } = codexModels(provider);
  res.json({
    models: models.map((item) => ({
      id: item.model,
      name: item.displayName || item.model,
      model: item.model,
      provider: 'custom',
      wire_api: 'responses',
      tools: true,
      parallel_tool_calls: item.supportsParallelToolCalls ?? true,
      context_window: Number(item.contextWindow) || 128000,
      input_modalities: item.inputModalities || ['text'],
    })),
  });
});

router.post('/codex/:providerId/v1/responses', async (req: Request, res: Response) => {
  await handleCodexResponses(req, res);
});

router.post('/codex/:providerId/v1/responses/compact', async (req: Request, res: Response) => {
  await handleCodexResponses(req, res);
});

async function handleCodexResponses(req: Request, res: Response) {
  const provider = db.getProviderById(req.params.providerId);
  if (!provider) {
    logger.codexProxy.error('Provider 未找到', { providerId: req.params.providerId });
    res.status(404).json({ error: { message: 'Provider not found' } });
    return;
  }
  if (provider.api_format !== 'openai_chat') {
    logger.codexProxy.error('Provider 格式不匹配，期望 openai_chat', { providerId: provider.id, apiFormat: provider.api_format });
    res.status(400).json({ error: { message: 'Provider is not configured for OpenAI Chat Completions' } });
    return;
  }

  const chatBody = responsesToChat(req.body, provider);
  const upstreamUrl = `${trimTrailingSlash(provider.base_url)}/chat/completions`;
  const actualModel = String(chatBody.model || provider.model);
  const startTime = Date.now();

  logger.codexProxy.request(provider.id, actualModel);
  logger.codexProxy.upstreamRequest(upstreamUrl, actualModel);

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
      logger.codexProxy.upstreamResponseError(actualModel, upstream.status, latencyMs, errBody);
      res.status(upstream.status).json(chatErrorToResponseError(parsed));
      return;
    }

    logger.codexProxy.upstreamResponseOk(actualModel, upstream.status, latencyMs);

    if (chatBody.stream) {
      await streamChatAsResponses(upstream, req.body, provider, res);
      return;
    }

    const json = await upstream.json();
    res.json(chatToResponse(json, req.body, provider));
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    logger.codexProxy.error(`连接失败: ${err.message}`, { providerId: provider.id, model: actualModel, latencyMs });
    res.status(500).json({ error: { type: 'server_error', message: err.message || 'Codex proxy failed' } });
  }
}

function responsesToChat(body: any, provider: db.Provider): Record<string, JsonValue> {
  const messages = inputToMessages(body.instructions, body.input);
  const model = provider.model || body.model;
  const result: Record<string, JsonValue> = { model, messages, stream: Boolean(body.stream) };

  const maxTokens = body.max_output_tokens ?? body.max_tokens ?? body.max_completion_tokens;
  if (maxTokens !== undefined) {
    if (supportsMaxCompletionTokens(String(model || ''))) result.max_completion_tokens = maxTokens;
    else result.max_tokens = maxTokens;
  }
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning) result.reasoning = body.reasoning;
  for (const field of EXTRA_CHAT_PASSTHROUGH_FIELDS) {
    if (body[field] !== undefined) result[field] = body[field];
  }

  const toolContext = new CodexToolContext();
  const tools = Array.isArray(body.tools) ? body.tools.map((tool: any) => responsesToolToChatTool(tool, toolContext)).filter(Boolean) : [];
  if (tools.length > 0) {
    result.tools = tools;
    if (body.tool_choice) result.tool_choice = responsesToolChoiceToChat(body.tool_choice, toolContext);
    if (body.parallel_tool_calls !== undefined) result.parallel_tool_calls = body.parallel_tool_calls;
  }
  if (result.stream) result.stream_options = mergeIncludeUsage(body.stream_options);
  return result;
}

class CodexToolContext {
  readonly chatToResponse = new Map<string, { kind: string; name: string; namespace?: string }>();
  add(chatName: string, spec: { kind: string; name: string; namespace?: string }) {
    this.chatToResponse.set(chatName, spec);
  }
}

function inputToMessages(instructions: unknown, input: unknown): JsonValue[] {
  const messages: JsonValue[] = [];
  const instructionText = textFromUnknown(instructions);
  if (instructionText) messages.push({ role: 'system', content: instructionText });
  if (typeof input === 'string') return [...messages, { role: 'user', content: input }];
  if (!Array.isArray(input)) {
    if (input && typeof input === 'object') messages.push({ role: 'user', content: contentToText(input) });
    return messages;
  }

  let pendingAssistant: Record<string, any> | null = null;
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, any>;
    if (value.type === 'message') {
      if (pendingAssistant) messages.push(pendingAssistant as JsonValue);
      pendingAssistant = null;
      messages.push({ role: value.role || 'user', content: contentToText(value.content) });
    } else if (value.type === 'reasoning') {
      const reasoning = contentToText(value.summary || value.content || value.text || '');
      if (reasoning) {
        pendingAssistant = pendingAssistant || { role: 'assistant', content: null };
        pendingAssistant.reasoning_content = appendText(pendingAssistant.reasoning_content, reasoning);
      }
    } else if (value.type === 'function_call' || value.type === 'custom_tool_call' || value.type === 'tool_search_call') {
      pendingAssistant = pendingAssistant || { role: 'assistant', content: null, tool_calls: [] };
      pendingAssistant.tool_calls = pendingAssistant.tool_calls || [];
      pendingAssistant.tool_calls.push({
        id: value.call_id || value.id,
        type: 'function',
        function: { name: value.name || value.type, arguments: canonicalJsonString(value.arguments ?? value.input ?? value.query ?? {}) },
      });
    } else if (value.type === 'function_call_output' || value.type === 'custom_tool_call_output' || value.type === 'tool_search_output') {
      if (pendingAssistant) messages.push(pendingAssistant as JsonValue);
      pendingAssistant = null;
      messages.push({ role: 'tool', tool_call_id: value.call_id, content: textFromUnknown(value.output ?? value.content) });
    }
  }
  if (pendingAssistant) messages.push(pendingAssistant as JsonValue);
  return messages;
}

function responsesToolToChatTool(tool: any, context: CodexToolContext): JsonValue | null {
  if (!tool || typeof tool !== 'object') return null;
  if (tool.type === 'tool_search') {
    context.add('tool_search', { kind: 'tool_search', name: 'tool_search' });
    return { type: 'function', function: { name: 'tool_search', description: 'Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } };
  }
  if (tool.type === 'custom') {
    context.add(tool.name, { kind: 'custom', name: tool.name });
    return { type: 'function', function: { name: tool.name, description: `${tool.description || ''}\n\nOriginal tool definition:\n${JSON.stringify(tool)}`, parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } } };
  }
  if (tool.type !== 'function') return null;
  context.add(tool.name, { kind: 'function', name: tool.name });
  return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: cleanSchema(tool.parameters || {}) } };
}

function responsesToolChoiceToChat(choice: any, context: CodexToolContext): JsonValue {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  if (choice?.type === 'function' && choice.name) return { type: 'function', function: { name: choice.name } };
  if (choice?.type === 'custom' && choice.name) return { type: 'function', function: { name: choice.name } };
  if (choice?.type === 'tool_search') return { type: 'function', function: { name: 'tool_search' } };
  const first = context.chatToResponse.keys().next().value;
  return first ? { type: 'function', function: { name: first } } : 'auto';
}

function chatToResponse(chat: any, requestBody: any, provider: db.Provider): Record<string, JsonValue> {
  const choice = chat.choices?.[0] || {};
  const message = choice.message || {};
  const output: JsonValue[] = [];
  const reasoning = message.reasoning_content || message.reasoning || extractThinkBlock(message.content);
  if (reasoning) output.push(responseReasoningItem(reasoning));
  const text = stripThinkBlock(message.content);
  if (text) output.push(responseMessageItem(text));
  for (const toolCall of message.tool_calls || []) output.push(responseFunctionCallItem(toolCall));
  return {
    id: responseIdFromChatId(chat.id), object: 'response', created_at: chat.created || nowSec(),
    status: responseStatusFromFinishReason(choice.finish_reason), model: provider.model || requestBody.model,
    output, usage: mapUsage(chat.usage),
    ...(choice.finish_reason === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
  };
}

function responseMessageItem(text: string): JsonValue {
  return { id: `msg_${Date.now()}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
}

function responseReasoningItem(text: string): JsonValue {
  return { id: `rs_${Date.now()}`, type: 'reasoning', summary: [{ type: 'summary_text', text }] };
}

function responseFunctionCallItem(toolCall: any): JsonValue {
  return { id: toolCall.id || `fc_${Date.now()}`, type: 'function_call', status: 'completed', call_id: toolCall.id || `call_${Date.now()}`, name: toolCall.function?.name || '', arguments: canonicalJsonString(toolCall.function?.arguments || '{}') };
}

function mapUsage(usage: any): JsonValue {
  return { input_tokens: usage?.prompt_tokens || 0, output_tokens: usage?.completion_tokens || 0, total_tokens: usage?.total_tokens || 0, input_tokens_details: { cached_tokens: usage?.prompt_tokens_details?.cached_tokens || 0 }, output_tokens_details: { reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens || 0 } };
}

async function streamChatAsResponses(upstream: globalThis.Response, requestBody: any, provider: db.Provider, res: Response) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  let completedText = '';
  let reasoningText = '';
  let finalUsage: any = null;
  let finishReason: string | null = null;
  let contentStarted = false;
  let reasoningStarted = false;
  const toolCalls = new Map<number, { id: string; itemId: string; name: string; arguments: string; started: boolean }>();

  writeSse(res, 'response.created', { type: 'response.created', response: responseEnvelope(responseId, provider, requestBody, 'in_progress', []) });
  writeSse(res, 'response.in_progress', { type: 'response.in_progress', response: responseEnvelope(responseId, provider, requestBody, 'in_progress', []) });

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
        writeSse(res, 'response.failed', { type: 'response.failed', response: { ...responseEnvelope(responseId, provider, requestBody, 'failed', []), error: chunk.error } });
        res.end();
        return;
      }
      if (chunk.usage) finalUsage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta || {};
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      const reasoningDelta = delta.reasoning_content || delta.reasoning || extractThinkBlock(delta.content);
      if (reasoningDelta) {
        if (!reasoningStarted) {
          reasoningStarted = true;
          writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: `rs_${Date.now()}`, type: 'reasoning', summary: [] } });
          writeSse(res, 'response.reasoning_summary_part.added', { type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: '' } });
        }
        reasoningText += reasoningDelta;
        writeSse(res, 'response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: reasoningDelta });
      }
      const textDelta = stripThinkBlock(delta.content);
      if (textDelta) {
        if (!contentStarted) {
          contentStarted = true;
          writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: 1, item: { id: messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
          writeSse(res, 'response.content_part.added', { type: 'response.content_part.added', item_id: messageId, output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        completedText += textDelta;
        writeSse(res, 'response.output_text.delta', { type: 'response.output_text.delta', item_id: messageId, output_index: 1, content_index: 0, delta: textDelta });
      }
      for (const toolCall of delta.tool_calls || []) {
        const index = toolCall.index || 0;
        const existing = toolCalls.get(index) || { id: toolCall.id || `call_${index}`, itemId: `fc_${Date.now()}_${index}`, name: '', arguments: '', started: false };
        existing.id = toolCall.id || existing.id;
        existing.name += toolCall.function?.name || '';
        const argDelta = toolCall.function?.arguments || '';
        if (!existing.started && existing.name) {
          existing.started = true;
          writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: 2 + index, item: { id: existing.itemId, type: 'function_call', status: 'in_progress', call_id: existing.id, name: existing.name, arguments: '' } });
        }
        if (argDelta) {
          existing.arguments += argDelta;
          writeSse(res, 'response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: existing.itemId, output_index: 2 + index, delta: argDelta });
        }
        toolCalls.set(index, existing);
      }
    }
  }

  const output: JsonValue[] = [];
  if (reasoningStarted) {
    const item = responseReasoningItem(reasoningText);
    output.push(item);
    writeSse(res, 'response.reasoning_summary_text.done', { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: reasoningText });
    writeSse(res, 'response.reasoning_summary_part.done', { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: reasoningText } });
    writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: 0, item });
  }
  if (contentStarted) {
    const item = responseMessageItem(completedText);
    output.push(item);
    writeSse(res, 'response.content_part.done', { type: 'response.content_part.done', item_id: messageId, output_index: 1, content_index: 0, part: { type: 'output_text', text: completedText, annotations: [] } });
    writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: 1, item });
  }
  for (const toolCall of toolCalls.values()) {
    const item = responseFunctionCallItem({ id: toolCall.id, function: { name: toolCall.name, arguments: toolCall.arguments } });
    output.push(item);
    writeSse(res, 'response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: toolCall.itemId, output_index: output.length, arguments: (item as any).arguments });
    writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: output.length, item });
  }
  const status = responseStatusFromFinishReason(finishReason);
  writeSse(res, status === 'incomplete' ? 'response.incomplete' : 'response.completed', { type: status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: { ...responseEnvelope(responseId, provider, requestBody, status, output), usage: mapUsage(finalUsage), ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) } });
  res.end();
}

function responseEnvelope(responseId: string, provider: db.Provider, requestBody: any, status: string, output: JsonValue[]) {
  return { id: responseId, object: 'response', created_at: nowSec(), status, model: provider.model || requestBody.model, output };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return textFromUnknown(content);
  return content.map((part) => {
    if (!part || typeof part !== 'object') return textFromUnknown(part);
    const value = part as Record<string, any>;
    return value.text || value.input_text || value.output_text || value.content || value.image_url?.url || '';
  }).filter(Boolean).join('\n');
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function appendText(existing: unknown, next: string): string {
  return [typeof existing === 'string' ? existing : '', next].filter(Boolean).join('\n');
}

function canonicalJsonString(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(sortJson(JSON.parse(value))); } catch { return value; }
  }
  return JSON.stringify(sortJson(value));
}

function sortJson(value: any): any {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function cleanSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'format' && value === 'uri') continue;
    next[key] = cleanSchema(value);
  }
  return next;
}

function mergeIncludeUsage(streamOptions: unknown): JsonValue {
  const base = streamOptions && typeof streamOptions === 'object' && !Array.isArray(streamOptions) ? { ...(streamOptions as Record<string, any>) } : {};
  base.include_usage = true;
  return base as JsonValue;
}

function supportsMaxCompletionTokens(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.startsWith('o') || lower.startsWith('gpt-5');
}

function responseIdFromChatId(id: unknown): string {
  const value = typeof id === 'string' && id ? id : `chatcmpl_${Date.now()}`;
  return value.startsWith('resp_') ? value : value.replace(/^chatcmpl_?/, 'resp_');
}

function responseStatusFromFinishReason(finishReason: unknown): string {
  return finishReason === 'length' ? 'incomplete' : 'completed';
}

function extractThinkBlock(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = value.match(/<think>([\s\S]*?)<\/think>/i);
  return match?.[1]?.trim() || '';
}

function stripThinkBlock(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart();
}

function chatErrorToResponseError(value: unknown): JsonValue {
  const error = typeof value === 'object' && value ? (value as any).error || value : { message: String(value) };
  return { error: { type: error.type || 'upstream_error', message: error.message || 'Upstream request failed', code: error.code || null } };
}

async function safeReadJsonOrText(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

function writeSse(res: Response, event: string, data: JsonValue) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function trimTrailingSlash(value: string) { return value.replace(/\/+$/, ''); }
function nowSec() { return Math.floor(Date.now() / 1000); }

export default router;
