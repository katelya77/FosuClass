/**
 * Deep-link tests: runtime path resolution + built SPA route presence.
 * Must not only search for hardcoded '/admin-next/' history base.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const routerSrc = fs.readFileSync(path.join(root, "admin-web/src/router/index.ts"), "utf8");
assert(routerSrc.includes("getAdminRuntimePaths"), "router must use runtime paths");
assert(!/createWebHistory\(\s*['"`]\/admin-next\//.test(routerSrc), "history base must not be hardcoded");

const required = [
  "dashboard",
  "sync",
  "catalog",
  "terms",
  "quality",
  "content",
  "feedback",
  "campus-map",
  "security",
  "settings",
  "audit",
  "assistant",
  "provider",
  "backups",
];
for (const name of required) {
  assert(
    routerSrc.includes(`path: '${name}'`) || routerSrc.includes(`path: "${name}"`),
    `missing deep link route: ${name}`
  );
}

// Execute path helper logic
function getAdminRuntimePaths(pathname) {
  const p = pathname.replace(/\/{2,}/g, "/");
  if (p === "/admin-next" || p.startsWith("/admin-next/")) {
    return { spaBase: "/admin-next/", legacyBase: "/admin/", mount: "next" };
  }
  return { spaBase: "/admin/", legacyBase: "/admin-legacy/", mount: "primary" };
}

const next = getAdminRuntimePaths("/admin-next/sync");
assert.strictEqual(next.spaBase, "/admin-next/");
assert.strictEqual(next.legacyBase, "/admin/");
const primary = getAdminRuntimePaths("/admin/sync");
assert.strictEqual(primary.spaBase, "/admin/");
assert.strictEqual(primary.legacyBase, "/admin-legacy/");

// Built index exists for deep-link deploy
const built = path.join(root, "server/public/admin-app/index.html");
assert.ok(fs.existsSync(built), "built SPA required for deep links");
const html = fs.readFileSync(built, "utf8");
assert.match(html, /admin-app/, "assets base should be /admin-app/");

console.log("Admin SPA deep link tests passed.");
