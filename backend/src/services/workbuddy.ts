import fs from 'fs';
import path from 'path';
import { GLOBAL_HOME_DIR } from '../config.js';

export interface WorkBuddyReasoningConfig {
  defaultEffort?: string;
  supportedEfforts?: string[];
  [key: string]: unknown;
}

export interface WorkBuddyModel {
  id: string;
  name: string;
  vendor: string;
  url: string;
  apiKey: string;
  supportsToolCall: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  useCustomProtocol: boolean;
  reasoning?: WorkBuddyReasoningConfig;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  [key: string]: unknown;
}

export const WORKBUDDY_MODELS_PATH = path.join(GLOBAL_HOME_DIR, '.workbuddy', 'models.json');

function writeModels(models: WorkBuddyModel[], modelsPath: string) {
  fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
  const tmpPath = `${modelsPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(models, null, 2), 'utf-8');
  fs.renameSync(tmpPath, modelsPath);
}

export function readWorkBuddyModels(modelsPath = WORKBUDDY_MODELS_PATH): {
  exists: boolean;
  path: string;
  models: WorkBuddyModel[];
} {
  if (!fs.existsSync(modelsPath)) return { exists: false, path: modelsPath, models: [] };

  const parsed: unknown = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error('WorkBuddy models.json 必须是 JSON 数组');
  return { exists: true, path: modelsPath, models: parsed as WorkBuddyModel[] };
}

export function saveWorkBuddyModel(
  input: WorkBuddyModel,
  originalId?: string,
  modelsPath = WORKBUDDY_MODELS_PATH,
): WorkBuddyModel {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const url = String(input.url || '').trim();
  if (!id || !name || !url) throw new Error('模型 ID、名称和接口地址必填');

  const { models } = readWorkBuddyModels(modelsPath);
  const matchId = originalId || id;
  const existingIndex = models.findIndex((item) => item.id === matchId);
  if (models.some((item, index) => item.id === id && index !== existingIndex)) {
    throw new Error(`模型 ID 已存在: ${id}`);
  }

  const existing = existingIndex >= 0 ? models[existingIndex] : undefined;
  const saved: WorkBuddyModel = {
    ...existing,
    ...input,
    id,
    name,
    vendor: String(input.vendor || 'Custom').trim() || 'Custom',
    url,
    apiKey: input.apiKey || existing?.apiKey || '',
  };

  if (existingIndex >= 0) models[existingIndex] = saved;
  else models.push(saved);
  writeModels(models, modelsPath);
  return saved;
}

export function deleteWorkBuddyModel(id: string, modelsPath = WORKBUDDY_MODELS_PATH): boolean {
  const { models } = readWorkBuddyModels(modelsPath);
  const remaining = models.filter((item) => item.id !== id);
  if (remaining.length === models.length) return false;
  writeModels(remaining, modelsPath);
  return true;
}