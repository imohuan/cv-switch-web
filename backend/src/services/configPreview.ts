import fs from "node:fs";
import { configChangeStore } from "./configChanges.js";

export type ConfigFileDescriptor = { label: string; path: string };

export type ConfigPreviewFile = {
  label: string;
  content: string;
  exists: boolean;
  /** 最近一次写入的键值对，前端根据文件类型决定高亮方式 */
  changes?: Record<string, string>;
};

function maskSensitiveContent(label: string, content: string): string {
  if (label.endsWith(".json")) {
    return content.replace(
      /("api[_-]?key"|"token"|"ANTHROPIC_API_KEY"|"ANTHROPIC_AUTH_TOKEN"|"GEMINI_API_KEY"|"OPENAI_API_KEY")\s*:\s*"[^"]*"/gi,
      (_, keyName) => keyName + ": \"***MASKED***\"",
    );
  }
  if (label.endsWith(".env")) {
    return content.replace(
      /(API_KEY|TOKEN|KEY)\s*=\s*.+/gi,
      (_, keyName) => keyName + "=***MASKED***",
    );
  }
  return content;
}

export function readConfigPreviewFiles(files: ConfigFileDescriptor[]): ConfigPreviewFile[] {
  return files.map((file) => {
    if (!fs.existsSync(file.path)) {
      return { label: file.label, content: "(文件不存在)", exists: false };
    }

    try {
      const rawContent = fs.readFileSync(file.path, "utf-8");
      const masked = maskSensitiveContent(file.label, rawContent);
      const entries = configChangeStore.getEntries(file.path);
      return {
        label: file.label,
        content: masked,
        exists: true,
        changes: entries && Object.keys(entries).length > 0 ? entries : undefined,
      };
    } catch {
      return { label: file.label, content: "(读取失败)", exists: true };
    }
  });
}
