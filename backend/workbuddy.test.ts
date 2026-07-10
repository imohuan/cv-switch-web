import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteWorkBuddyModel,
  readWorkBuddyModels,
  saveWorkBuddyModel,
  type WorkBuddyModel,
} from './src/services/workbuddy.js';

const model = (overrides: Partial<WorkBuddyModel> = {}): WorkBuddyModel => ({
  id: 'model-a',
  name: 'Model A',
  vendor: 'Custom',
  url: 'http://127.0.0.1:8002/v1',
  apiKey: 'secret-key',
  supportsToolCall: true,
  supportsImages: true,
  supportsReasoning: true,
  useCustomProtocol: false,
  ...overrides,
});

test('WorkBuddy 模型支持新增、改名和删除，且留空 Key 时保留原值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-switch-workbuddy-'));
  const modelsPath = path.join(dir, 'models.json');

  try {
    assert.deepEqual(readWorkBuddyModels(modelsPath), {
      exists: false,
      path: modelsPath,
      models: [],
    });

    saveWorkBuddyModel(model({ customField: 'keep-me' }), undefined, modelsPath);
    saveWorkBuddyModel(model({ id: 'model-b', name: 'Model B', apiKey: '' }), 'model-a', modelsPath);

    const updated = readWorkBuddyModels(modelsPath);
    assert.equal(updated.models[0]?.id, 'model-b');
    assert.equal(updated.models[0]?.apiKey, 'secret-key');
    assert.equal(updated.models[0]?.customField, 'keep-me');

    deleteWorkBuddyModel('model-b', modelsPath);
    assert.deepEqual(readWorkBuddyModels(modelsPath).models, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});