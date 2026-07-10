const fs = require("fs");
const p = "D:/Code/Git/cv-switch-web/backend/src/routes/providers.ts";
let c = fs.readFileSync(p, "utf-8");

const oldClear = [
"router.post('/switch/:appType/clear', (req: Request, res: Response) => {",
"  try {",
"    const { appType } = req.params;",
"    if (!VALID_APPS.includes(appType as any)) {",
"      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });",
"      return;",
"    }",
"    db.setCurrentProvider(appType, null);",
"    res.json({ success: true, message: `Cleared ${appType} config` });",
"  } catch (err: any) {",
"    res.status(500).json({ success: false, error: err.message });",
"  }",
"});",
].join("\r\n");

const newClear = [
"router.post('/switch/:appType/clear', (req: Request, res: Response) => {",
"  try {",
"    const { appType } = req.params;",
"    if (!VALID_APPS.includes(appType as any)) {",
"      res.status(400).json({ success: false, error: `Invalid app type. Must be one of: ${VALID_APPS.join(', ')}` });",
"      return;",
"    }",
"    db.setCurrentProvider(appType, null);",
'    if (appType === "codex") {',
"      // Codex：重新写 config.toml，VA 状态保持，但不指定 activeProvider",
"      const codexStatus = db.getAppStatus('codex');",
"      const virtualAccount = codexStatus?.virtual_account_enabled ?? false;",
"      writeCodexConfig(virtualAccount);",
"    }",
"    // Claude/Gemini/OpenCode：目前只清 db 状态，配置文件由下次连接时覆盖",
"    res.json({ success: true, message: `Cleared ${appType} config` });",
"  } catch (err: any) {",
"    res.status(500).json({ success: false, error: err.message });",
"  }",
"});",
].join("\r\n");

console.log("Clear found:", c.includes(oldClear));
c = c.replace(oldClear, newClear);
fs.writeFileSync(p, c, "utf-8");
console.log("Done");
