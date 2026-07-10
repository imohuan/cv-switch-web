import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configChangeStore,
  createConfigChangeStore,
  writeTrackedConfigFile,
} from "../src/services/configChanges.ts";

test("records key-value changes and matches lines in file content", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-change-store-"));
  const recordPath = path.join(tempDir, "config-changes.json");
  const filePath = path.join(tempDir, "settings.json");
  const store = createConfigChangeStore(recordPath);

  // 模拟写入：设置了 base_url 和 model
  const content = [
    '{',
    '  "base_url": "https://api.example.com/v1",',
    '  "model": "gpt-5",',
    '  "keep": true',
    '}',
    '',
  ].join("\n");

  store.record(filePath, {
    base_url: "https://api.example.com/v1",
    model: "gpt-5",
  });

  // 读回来：当前文件内容中哪几行包含记录过的 value
  const lines = store.getChangedLines(filePath, content);
  assert.deepEqual(lines, [2, 3]); // 第2行和第3行分别包含 base_url 和 model 的值

  // 空 changes 不记录
  const store2 = createConfigChangeStore(recordPath + ".empty");
  store2.record(filePath, {});
  assert.deepEqual(store2.getChangedLines(filePath, content), []);

  // 没有记录的文件返回空
  assert.deepEqual(store.getChangedLines("/nonexistent/file.json", content), []);
});

test("record is persisted and can be reloaded", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-change-persist-"));
  const recordPath = path.join(tempDir, "config-changes.json");
  const filePath = path.join(tempDir, "config.toml");
  const content = 'model = "claude-sonnet-5"\nbase_url = "https://api.example.com"\n';

  const store = createConfigChangeStore(recordPath);
  store.record(filePath, { model: "claude-sonnet-5", base_url: "https://api.example.com" });

  // 重新加载
  const store2 = createConfigChangeStore(recordPath);
  const lines = store2.getChangedLines(filePath, content);
  assert.deepEqual(lines, [1, 2]);
});

test("writeTrackedConfigFile writes content and records changes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tracked-config-"));
  const filePath = path.join(tempDir, "config.toml");
  const content = 'model = "new-model"\n';

  writeTrackedConfigFile(filePath, content, { model: "new-model" });

  assert.equal(fs.readFileSync(filePath, "utf-8"), content);
  const lines = configChangeStore.getChangedLines(filePath, content);
  assert.deepEqual(lines, [1]);
});

test("writeTrackedConfigFile succeeds even when record store fails", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tracked-config-fail-"));
  const filePath = path.join(tempDir, "config.toml");
  const content = 'model = "test"\n';

  // 模拟 record 失败
  const originalRecord = configChangeStore.record;
  configChangeStore.record = () => { throw new Error("record unavailable"); };

  try {
    assert.doesNotThrow(() => writeTrackedConfigFile(filePath, content, { model: "test" }));
    assert.equal(fs.readFileSync(filePath, "utf-8"), content);
  } finally {
    configChangeStore.record = originalRecord;
  }
});
