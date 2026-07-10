const fs = require("fs");
const p = "D:\\Code\\Git\\cv-switch-web\\backend\\src\\routes\\codexProxy.ts";
let c = fs.readFileSync(p, "utf-8");

// 1. Insert JWT verification code after the router creation and EXTRA_CHAT_PASSTHROUGH_FIELDS, before first route
const insertPoint = c.indexOf("router.get('/codex/:providerId/v1/models'");
const authCode = [
"",
"// ── 虚拟账号 JWT 验证 ──",
"// 虚拟账号的固定 user_id，只有带这个 user_id 的 JWT 才放行",
"const VIRTUAL_ACCOUNT_USER_ID = 'user-niuniu-woyao-pro-unlock';",
"",
"/**",
" * 解析 JWT payload（不验签，Codex 也不验签）。",
" * 返回 decoded payload 或 null。",
" */",
"function decodeJwtPayload(token: string): Record<string, any> | null {",
"  try {",
"    const parts = token.split('.');",
"    if (parts.length !== 3) return null;",
"    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');",
"    return JSON.parse(payload);",
"  } catch {",
"    return null;",
"  }",
"}",
"",
"/**",
" * 验证请求是否来自合法的虚拟账号。",
" * 规则：如果全局虚拟账号已启用，则要求请求带 Authorization header，",
" * 且 JWT payload 中的 user_id 必须匹配 VIRTUAL_ACCOUNT_USER_ID。",
" * 如果虚拟账号未启用，则不做验证（保持向后兼容）。",
" */",
"function verifyVirtualAccountAuth(req: Request): { ok: boolean; message?: string } {",
"  const codexStatus = db.getAppStatus('codex');",
"  const virtualAccountEnabled = codexStatus?.virtual_account_enabled ?? false;",
"",
"  if (!virtualAccountEnabled) {",
"    return { ok: true };",
"  }",
"",
"  const authHeader = req.headers.authorization;",
"  if (!authHeader || !authHeader.startsWith('Bearer ')) {",
"    return { ok: false, message: 'Missing or invalid Authorization header. Virtual account requires Bearer token.' };",
"  }",
"",
"  const token = authHeader.slice(7);",
"  const payload = decodeJwtPayload(token);",
"  if (!payload) {",
"    return { ok: false, message: 'Invalid JWT token format.' };",
"  }",
"",
"  if (payload.user_id !== VIRTUAL_ACCOUNT_USER_ID) {",
"    return { ok: false, message: `Unknown user: ${payload.user_id || 'null'}` };",
"  }",
"",
"  return { ok: true };",
"}",
"",
].join("\n");

c = c.substring(0, insertPoint) + authCode + "\n" + c.substring(insertPoint);

// 2. Add auth check in handleCodexResponses
c = c.replace(
  "async function handleCodexResponses(req: Request, res: Response) {\n  const provider = db.getProviderById(req.params.providerId);",
  `async function handleCodexResponses(req: Request, res: Response) {
  // 登录拦截：虚拟账号模式下验证 JWT
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    logger.codexProxy.error('Auth rejected', { message: auth.message });
    res.status(401).json({ error: { type: 'authentication_error', message: auth.message || 'Unauthorized' } });
    return;
  }

  const provider = db.getProviderById(req.params.providerId);`
);

// 3. Add auth check in /models route
c = c.replace(
  "router.get('/codex/:providerId/v1/models', (req: Request, res: Response) => {\n  const provider = db.getProviderById(req.params.providerId);",
  `router.get('/codex/:providerId/v1/models', (req: Request, res: Response) => {
  // 登录拦截
  const auth = verifyVirtualAccountAuth(req);
  if (!auth.ok) {
    res.status(401).json({ error: { message: auth.message || 'Unauthorized' } });
    return;
  }

  const provider = db.getProviderById(req.params.providerId);`
);

fs.writeFileSync(p, c, "utf-8");
console.log("Done");
