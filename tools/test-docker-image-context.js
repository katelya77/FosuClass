const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf8");

assert.ok(dockerignore.includes("server/public/admin-app"), "committed admin SPA root is duplicated into runtime-common");
assert.ok(dockerignore.includes("server/public/admin-app/**"), "committed admin SPA assets are duplicated into runtime-common");
assert.ok(!dockerignore.includes("admin-web"), "admin-web source must remain available to admin-builder");

const publicCopy = dockerfile.indexOf("COPY server/public ./public");
const builtAdminCopy = dockerfile.indexOf("COPY --from=admin-builder /src/server/public/admin-app ./public/admin-app");
assert.ok(publicCopy >= 0 && builtAdminCopy > publicCopy, "runtime must copy exactly the freshly built admin SPA after public assets");

console.log(JSON.stringify({ ok: true, duplicateAdminSpaLayer: false }, null, 2));
