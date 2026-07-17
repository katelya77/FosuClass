const assert = require("assert");
const fs = require("fs");
const path = require("path");

const router = fs.readFileSync(path.join(__dirname, "../admin-web/src/router/index.ts"), "utf8");
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
  assert(router.includes(`path: '${name}'`) || router.includes(`path: \"${name}\"`), `missing deep link route: ${name}`);
}
assert(router.includes("createWebHistory('/admin-next/')"), "history base must be /admin-next/");
assert(router.includes("redirect: to.fullPath"), "login redirect should preserve deep link");

const built = path.join(__dirname, "../server/public/admin-app/index.html");
assert(fs.existsSync(built), "built SPA required for deep links");

console.log("Admin SPA deep link tests passed.");
