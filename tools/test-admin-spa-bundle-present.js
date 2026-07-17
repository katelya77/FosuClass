/**
 * Validate admin SPA bundle is present and index.html references existing assets.
 * Cross-platform Vite content hashes may differ (Windows vs Linux); this check
 * does not require git clean parity after rebuild.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const dir = path.join(ROOT, "server/public/admin-app");
const indexPath = path.join(dir, "index.html");

assert.ok(fs.existsSync(indexPath), "server/public/admin-app/index.html missing");
const html = fs.readFileSync(indexPath, "utf8");
assert.ok(html.includes("<div id=\"app\">") || html.includes("id=\"app\""), "SPA root #app missing");

const refs = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1]);
assert.ok(refs.length >= 1, "index.html must reference hashed assets");

for (const rel of refs) {
  // Support /admin-app/assets/foo.js and assets/foo.js
  const cleaned = rel
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/admin-app\//, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  const assetPath = path.join(dir, cleaned);
  assert.ok(fs.existsSync(assetPath), `missing asset referenced by index.html: ${rel} -> ${cleaned}`);
}

const assetsDir = path.join(dir, "assets");
assert.ok(fs.existsSync(assetsDir), "assets/ directory missing");
const assetFiles = fs.readdirSync(assetsDir);
assert.ok(assetFiles.some((f) => f.endsWith(".js")), "no JS bundle in assets/");
assert.ok(assetFiles.some((f) => f.endsWith(".css")), "no CSS bundle in assets/");

console.log(
  JSON.stringify(
    {
      ok: true,
      index: "server/public/admin-app/index.html",
      refs,
      assetCount: assetFiles.length,
    },
    null,
    2
  )
);
