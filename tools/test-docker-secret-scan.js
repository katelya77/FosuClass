/**
 * Ensure sensitive/runtime paths are excluded by dockerignore files.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const rootIgnore = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8");
const serverIgnore = fs.readFileSync(path.join(ROOT, "server/.dockerignore"), "utf8");
const combined = `${rootIgnore}\n${serverIgnore}`;

const mustExclude = [".env", "storage", "node_modules", "output", "test-results", "coverage"];
for (const pattern of mustExclude) {
  assert.ok(
    combined.includes(pattern),
    `.dockerignore must exclude ${pattern}`
  );
}

// Dockerfile must not COPY .env
const dockerfile = fs.readFileSync(path.join(ROOT, "server/Dockerfile"), "utf8");
assert.ok(!/COPY\s+\.env/.test(dockerfile), "Dockerfile must not COPY .env");
assert.ok(!dockerfile.includes("admin-builder"), "retired admin SPA builder must stay removed");
assert.ok(!dockerfile.includes("admin-web"), "Dockerfile must not depend on admin-web");
assert.ok(!dockerfile.includes("admin-app"), "Dockerfile must not copy admin-app");
assert.ok(dockerfile.includes("chromium"), "Chromium decision documented in image");

console.log(JSON.stringify({ ok: true, excludes: mustExclude }, null, 2));
