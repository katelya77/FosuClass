const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appJs = fs.readFileSync(path.join(__dirname, "../server/src/app.js"), "utf8");
assert(appJs.includes("FOSU_ADMIN_PRIMARY"), "primary switch flag required");
assert(appJs.includes("/admin-legacy"), "legacy path must exist");
assert(appJs.includes("/admin-next"), "admin-next path must exist");
assert(appJs.includes("adminPrimaryNext"), "primary next mode required");
assert(appJs.includes("/api/admin/ui-mode"), "ui-mode discovery endpoint required");

// Default must remain legacy-safe (no forced production cutover in source).
assert(
  /FOSU_ADMIN_PRIMARY \|\| ["']legacy["']/.test(appJs) || appJs.includes('|| "legacy"'),
  "default primary should be legacy"
);

console.log("Legacy fallback tests passed.");
