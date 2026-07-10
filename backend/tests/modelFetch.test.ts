import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelProbeRequest,
  fetchProviderModels,
  testProviderModel,
} from '../src/services/modelFetch.ts';

test('falls back to /v1/models when root /models returns html', async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string) => {
    requestedUrls.push(url);
    if (url.endsWith('/models') && !url.endsWith('/v1/models')) {
      return new Response('<!doctype html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return Response.json({ data: [{ id: 'gpt-test' }] });
  };

  const result = await fetchProviderModels({
    baseUrl: 'https://newapi.example.com',
    apiKey: 'sk-test',
    fetchImpl,
  });

  assert.deepEqual(requestedUrls, [
    'https://newapi.example.com/models',
    'https://newapi.example.com/v1/models',
  ]);
  assert.deepEqual(result.models, [{ id: 'gpt-test' }]);
  assert.equal(result.url, 'https://newapi.example.com/v1/models');
});

test('builds protocol-specific model probe requests', () => {
  const responses = buildModelProbeRequest({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    apiFormat: 'openai_responses',
    model: 'gpt-test',
  });
  assert.equal(responses.url, 'https://api.example.com/v1/responses');
  assert.equal(responses.headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(JSON.parse(responses.body), {
    model: 'gpt-test',
    input: 'Reply with OK.',
    max_output_tokens: 16,
    stream: true,
  });

  const anthropic = buildModelProbeRequest({
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-ant',
    apiFormat: 'anthropic',
    model: 'claude-test',
  });
  assert.equal(anthropic.url, 'https://api.example.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], 'sk-ant');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');

  const gemini = buildModelProbeRequest({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'gem-key',
    apiFormat: 'gemini_native',
    model: 'gemini-test',
  });
  assert.equal(
    gemini.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=gem-key',
  );
});

test('reports response headers and first content timing from a streamed response', async () => {
  const times = [1_000, 1_045, 1_082, 1_082];
  const encoder = new TextEncoder();
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"OK"}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  const result = await testProviderModel({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    apiFormat: 'openai_responses',
    model: 'gpt-test',
    fetchImpl,
    now: () => times.shift() ?? 1_082,
  });

  assert.deepEqual(result, {
    ok: true,
    url: 'https://api.example.com/v1/responses',
    status: 200,
    statusText: '',
    responseHeadersMs: 45,
    firstContentMs: 82,
    totalMs: 82,
    preview: 'OK',
  });
});