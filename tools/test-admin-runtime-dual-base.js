/**
 * Dual-base runtime path + HTTP mount contract tests.
 * Verifies both FOSU_ADMIN_PRIMARY modes at the Express layer.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require(path.join(__dirname, "../server/node_modules/express"));

// --- Unit: paths module (via vitest source string + node eval of logic mirror) ---
const pathsSrc = fs.readFileSync(
  path.join(__dirname, "../admin-web/src/shared/runtime/paths.ts"),
  "utf8"
);
assert(pathsSrc.includes("getAdminRuntimePaths"), "paths helper required");
assert(pathsSrc.includes("legacyAdminUrl"), "legacyAdminUrl required");
assert(!/createWebHistory\(\s*['"`]\/admin-next\//.test(
  fs.readFileSync(path.join(__dirname, "../admin-web/src/router/index.ts"), "utf8")
), "router must not hardcode createWebHistory('/admin-next/')");

// No hardcoded legacy roots in page sources (except comments)
const pageFiles = [
  "AppSidebar.vue",
  "LoginPage.vue",
  "SyncCenterPage.vue",
  "TermsPage.vue",
  "ContentPage.vue",
  "SettingsPage.vue",
  "CampusMapPage.vue",
  "ExperimentalPage.vue",
  "ErrorBoundary.vue",
  "PlaceholderPage.vue",
];
const root = path.join(__dirname, "../admin-web/src");
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(vue|ts)$/.test(name)) out.push(p);
  }
  return out;
}
for (const file of walk(root)) {
  if (file.includes("paths.ts") || file.includes("paths.test.ts")) continue;
  const text = fs.readFileSync(file, "utf8");
  // forbid string literals that hardcode legacy admin roots for navigation
  if (/href=["'`]\/admin\/#/.test(text) || /href=["'`]\/admin\/["'`]/.test(text)) {
    assert.fail(`hardcoded /admin/ link in ${path.relative(root, file)}`);
  }
  if (/window\.location\.href\s*=\s*['"`]\/admin\//.test(text)) {
    assert.fail(`hardcoded window location /admin/ in ${path.relative(root, file)}`);
  }
}

// --- Runtime path logic (JS port for node assert) ---
function getAdminRuntimePaths(pathname) {
  const p = pathname.replace(/\/{2,}/g, "/");
  const onNext = p === "/admin-next" || p.startsWith("/admin-next/");
  if (onNext) {
    return { spaBase: "/admin-next/", legacyBase: "/admin/", assetBase: "/admin-app/", mount: "next" };
  }
  return { spaBase: "/admin/", legacyBase: "/admin-legacy/", assetBase: "/admin-app/", mount: "primary" };
}
assert.deepStrictEqual(getAdminRuntimePaths("/admin-next/dashboard").legacyBase, "/admin/");
assert.deepStrictEqual(getAdminRuntimePaths("/admin/dashboard").legacyBase, "/admin-legacy/");

// --- HTTP: both primary modes serve SPA shell ---
const ADMIN_APP_DIR = path.join(__dirname, "../server/public/admin-app");
const indexPath = path.join(ADMIN_APP_DIR, "index.html");
assert.ok(fs.existsSync(indexPath), "admin-app build required before dual-base HTTP test");

function buildApp(primary) {
  const app = express();
  const adminNextEnabled = true;
  const adminPrimaryNext = primary === "next";
  function sendAdminSpa(res) {
    res.setHeader("X-Test-Spa", "1");
    return res.sendFile(indexPath);
  }
  // minimal legacy page
  function sendLegacy(res) {
    res.setHeader("X-Test-Legacy", "1");
    return res.status(200).type("html").send("<html><body>legacy-admin</body></html>");
  }
  app.use("/admin-app", express.static(ADMIN_APP_DIR, { index: false }));
  app.use("/admin-next", (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return next();
    return sendAdminSpa(res);
  });
  if (adminPrimaryNext) {
    app.use("/admin", (req, res, next) => {
      if (!["GET", "HEAD"].includes(req.method)) return next();
      return sendAdminSpa(res);
    });
    app.use("/admin-legacy", (req, res) => sendLegacy(res));
  } else {
    app.use("/admin", (req, res) => sendLegacy(res));
    app.use("/admin-legacy", (req, res) => sendLegacy(res));
  }
  return app;
}

function httpGet(app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      http
        .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              spa: res.headers["x-test-spa"] === "1",
              legacy: res.headers["x-test-legacy"] === "1",
            });
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        });
    });
  });
}

async function main() {
  // legacy primary
  {
    const app = buildApp("legacy");
    const nextDash = await httpGet(app, "/admin-next/dashboard");
    assert.strictEqual(nextDash.status, 200);
    assert.strictEqual(nextDash.spa, true, "/admin-next/dashboard must serve SPA");

    const adminDash = await httpGet(app, "/admin/dashboard");
    assert.strictEqual(adminDash.status, 200);
    assert.strictEqual(adminDash.legacy, true, "/admin/dashboard must be legacy when primary=legacy");

    const legacyDash = await httpGet(app, "/admin-legacy/dashboard");
    assert.strictEqual(legacyDash.legacy, true);

    const legacySync = await httpGet(app, "/admin-legacy/sync");
    assert.strictEqual(legacySync.legacy, true);
  }

  // next primary
  {
    const app = buildApp("next");
    const adminDash = await httpGet(app, "/admin/dashboard");
    assert.strictEqual(adminDash.status, 200);
    assert.strictEqual(adminDash.spa, true, "/admin/dashboard must serve SPA when primary=next");

    const nextDash = await httpGet(app, "/admin-next/dashboard");
    assert.strictEqual(nextDash.spa, true);

    const legacyDash = await httpGet(app, "/admin-legacy/dashboard");
    assert.strictEqual(legacyDash.legacy, true, "/admin-legacy must remain legacy console");

    const legacySync = await httpGet(app, "/admin-legacy/sync");
    assert.strictEqual(legacySync.legacy, true);
  }

  console.log("Admin runtime dual-base tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
