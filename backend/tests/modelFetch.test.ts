import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../src/services/modelFetch.ts';

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