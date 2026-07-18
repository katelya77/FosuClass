const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SERVER_SRC_MARKER = "/server/src/";
const TEMP_PREFIX = "fosu-admin-c1-http-";

function clearServerModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, "/").includes(SERVER_SRC_MARKER)) delete require.cache[key];
  }
}

function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `path escaped harness root: ${candidate}`);
}

function requestJson(baseUrl, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, baseUrl);
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function startAdminHttpHarness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const paths = {
    root,
    storage: path.join(root, "storage"),
    data: path.join(root, "data"),
  };
  const previousEnv = {};
  const environment = {
    NODE_ENV: "test",
    PORT: "0",
    FOSU_STORAGE_DIR: paths.storage,
    FOSU_DATA_DIR: paths.data,
    ADMIN_PASSWORD: "c1-password",
    ADMIN_API_TOKEN: "c1-admin-full",
    FOSU_ADMIN_NEXT_ENABLED: "true",
    FOSU_ADMIN_PRIMARY: "legacy",
    FOSU_ADMIN_NEXT_WRITE_MODULES: options.enabledModules === undefined ? "catalog,quality,settings" : options.enabledModules,
    FOSU_RELEASE_WORKER_ENABLED: "false",
    FOSU_CONFIG_HARD_FAIL: "false",
    FOSU_ALLOWED_ADMIN_ORIGINS: "http://admin.test",
    FOSU_ALLOWED_PUBLIC_ORIGINS: "http://public.test",
    ADMIN_SERVICE_TOKENS: JSON.stringify([
      { name: "c1-catalog", token: "c1-catalog-token", scopes: ["catalog:write"] },
      { name: "c1-quality", token: "c1-quality-token", scopes: ["quality:write"] },
      { name: "c1-settings", token: "c1-settings-token", scopes: ["settings:write"] },
      { name: "c1-wrong", token: "c1-wrong-token", scopes: ["catalog:write"] },
    ]),
  };
  for (const [key, value] of Object.entries(environment)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  fs.mkdirSync(paths.storage, { recursive: true });
  fs.mkdirSync(path.join(paths.data, "backups"), { recursive: true });
  fs.writeFileSync(path.join(paths.storage, "admin-config.json"), JSON.stringify({ appName: "C1 seed" }));
  fs.writeFileSync(path.join(paths.storage, "catalog-meta.json"), JSON.stringify({}));
  fs.writeFileSync(path.join(paths.storage, "quality-ignores.json"), JSON.stringify({ rules: [] }));
  assertInsideRoot(root, paths.storage);
  assertInsideRoot(root, paths.data);

  clearServerModuleCache();
  const express = require(path.join(ROOT, "server/node_modules/express"));
  const originalListen = express.application.listen;
  let importedApp;
  try {
    // Importing the production app must be side-effect-free. This instruments the
    // real Express prototype solely to turn an import-time listener into a clear failure.
    express.application.listen = function importTimeListenForbidden() {
      throw new Error("APP_IMPORT_LISTEN_FORBIDDEN");
    };
    importedApp = require(path.join(ROOT, "server/src/app"));
  } finally {
    express.application.listen = originalListen;
  }
  const app = importedApp.default || importedApp;
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let closed = false;

  return {
    baseUrl,
    paths,
    request: (urlPath, requestOptions) => requestJson(baseUrl, urlPath, requestOptions),
    async login() {
      const response = await requestJson(baseUrl, "/api/admin/login", {
        method: "POST",
        body: { password: "c1-password" },
      });
      assert.strictEqual(response.status, 200, response.text);
      const setCookie = response.headers["set-cookie"] || [];
      const cookie = setCookie.map((item) => item.split(";")[0]).join("; ");
      assert.ok(cookie.includes("fosu_admin_session="), "login did not issue admin session cookie");
      assert.ok(response.json && response.json.csrfToken, "login did not issue CSRF token");
      return { cookie, csrfToken: response.json.csrfToken };
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      clearServerModuleCache();
      const tempDir = path.resolve(os.tmpdir());
      assert.ok(root.startsWith(tempDir + path.sep), `refusing to remove non-temporary root: ${root}`);
      assert.ok(path.basename(root).startsWith(TEMP_PREFIX), `refusing to remove unexpected root: ${root}`);
      fs.rmSync(root, { recursive: true, force: true });
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}

module.exports = { startAdminHttpHarness, clearServerModuleCache };
