const fs = require("fs");
const p = "D:/Code/Git/cv-switch-web/backend/src/routes/codexProxy.ts";
let c = fs.readFileSync(p, "utf-8");

// Remove dead code after the early return
const oldDead = "  // requires_openai_auth=false, Codex does not send auth header; skip JWT check\n  return { ok: true };\n\n  // (unreachable, kept for reference)\n  const authHeader = req.headers.authorization;\n  if (!authHeader || !authHeader.startsWith('Bearer ')) {\n    return { ok: false, message: 'Missing or invalid Authorization header. Virtual account requires Bearer token.' };\n  }\n\n  const token = authHeader.slice(7);\n  const payload = decodeJwtPayload(token);\n  if (!payload) {\n    return { ok: false, message: 'Invalid JWT token format.' };\n  }\n\n  if (payload.user_id !== VIRTUAL_ACCOUNT_USER_ID) {\n    return { ok: false, message: `Unknown user: ${payload.user_id || 'null'}` };\n  }\n\n  return { ok: true };";

const newDead = "  // requires_openai_auth=false, Codex does not send auth header; skip JWT check\n  return { ok: true };";

c = c.replace(oldDead, newDead);
fs.writeFileSync(p, c, "utf-8");
console.log("Done");
