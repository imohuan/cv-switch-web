// 配置修改高亮记录
// 简化版：只记录本系统写入时设置了哪些 key=value，
// 显示配置文件时逐行匹配 value，命中就绿色高亮。

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.js";

type FileChangeRecord = {
  changed_at: string;
  entries: Record<string, string>;
};

type ChangeRecords = Record<string, FileChangeRecord>;

function loadRecords(recordPath: string): ChangeRecords {
  if (fs.existsSync(recordPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* ignore */ }
  }
  return {};
}

function saveRecords(recordPath: string, records: ChangeRecords): void {
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const tmpPath = recordPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), "utf-8");
  fs.renameSync(tmpPath, recordPath);
}

export function createConfigChangeStore(recordPath: string) {
  const records = loadRecords(recordPath);

  return {
    record(filePath: string, changes: Record<string, string>) {
      const keys = Object.keys(changes);
      if (keys.length === 0) return;

      const resolved = path.resolve(filePath);
      records[resolved] = {
        changed_at: new Date().toISOString(),
        entries: { ...changes },
      };
      saveRecords(recordPath, records);
    },

    getChangedLines(filePath: string, currentContent: string): number[] {
      const record = records[path.resolve(filePath)];
      if (!record || !record.entries) return [];

      const values = Object.values(record.entries).filter(Boolean);
      if (values.length === 0) return [];

      const lines = currentContent.split("\n");
      const result: number[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const val of values) {
          if (line.includes(val)) {
            result.push(i + 1);
            break;
          }
        }
      }
      return result;
    },

        getEntries(filePath: string): Record<string, string> | null {
      const record = records[path.resolve(filePath)];
      return record?.entries || null;
    },

    clear(filePath: string) {
      delete records[path.resolve(filePath)];
      saveRecords(recordPath, records);
    },
  };
}

const STORE_PATH = path.join(DATA_DIR, "config-changes.json");
export const configChangeStore = createConfigChangeStore(STORE_PATH);

export function writeTrackedConfigFile(
  filePath: string,
  content: string,
  changes: Record<string, string>,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
  try {
    configChangeStore.record(filePath, changes);
  } catch {
    // 高亮记录失败不影响配置写入
  }
}
