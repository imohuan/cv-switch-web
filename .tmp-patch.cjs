const fs = require("fs");
const p = "D:/Code/Git/cv-switch-web/backend/src/services/codexCatalog.ts";
let c = fs.readFileSync(p, "utf-8");

// Fix aggregate catalog: use provider name slug instead of id
const oldLine = '      const fullSlug = provider.id + "::" + modelSlug;';
const newLine = '      const nameSlug = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || provider.id;\n      const fullSlug = nameSlug + "::" + modelSlug;';

c = c.replace(oldLine, newLine);

// Also fix model_provider_ref to use name slug
const oldRef = '        model_provider_ref: provider.id,';
const newRef = '        model_provider_ref: nameSlug,';

c = c.replace(oldRef, newRef);

fs.writeFileSync(p, c, "utf-8");
console.log("Done");
