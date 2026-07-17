const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "server/src/app.js"), "utf8");
assert(appJs.includes("/admin-next"), "server must serve /admin-next SPA shell");
assert(appJs.includes("admin-app"), "server must serve admin-app static assets");
assert(appJs.includes("FOSU_ADMIN_NEXT_ENABLED"), "feature flag required for admin-next");
assert(appJs.includes("pan.katelya.eu.org"), "CSP should allow logo domain");

const adminWebPkg = JSON.parse(fs.readFileSync(path.join(root, "admin-web/package.json"), "utf8"));
assert(adminWebPkg.dependencies.vue, "vue required");
assert(adminWebPkg.dependencies["vue-router"], "vue-router required");
assert(adminWebPkg.dependencies.pinia, "pinia required");

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const script of ["admin:dev", "admin:build", "admin:preview", "admin:test", "admin:test:e2e"]) {
  assert(rootPkg.scripts[script], `missing root script ${script}`);
}

const client = fs.readFileSync(path.join(root, "admin-web/src/shared/api/client.ts"), "utf8");
assert(client.includes("X-Fosu-CSRF"), "API client must send CSRF header");
assert(client.includes("credentials: 'include'"), "API client must include cookies");

const logo = fs.readFileSync(path.join(root, "admin-web/src/app/components/AppLogo.vue"), "utf8");
assert(logo.includes('referrerpolicy="no-referrer"'), "logo must set no-referrer");
assert(logo.includes("logo-fallback"), "logo must have local fallback");

console.log("Admin SPA shell contract tests passed.");
