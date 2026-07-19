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
  let express = null;
  let originalExpressListen = null;
  let server = null;
  let cleanupPromise = null;

  function restoreExpressPrototype() {
    if (express && originalExpressListen) {
      express.application.listen = originalExpressListen;
    }
  }

  function restoreEnvironment() {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }

  function removeTemporaryRoot() {
    const tempDir = path.resolve(os.tmpdir());
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(tempDir, resolvedRoot);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `refusing to remove non-temporary root: ${root}`);
    assert.ok(path.basename(resolvedRoot).startsWith(TEMP_PREFIX), `refusing to remove unexpected root: ${root}`);
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const errors = [];
      if (server && server.listening) {
        try {
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } catch (error) {
          errors.push(error);
        }
      }
      try { restoreExpressPrototype(); } catch (error) { errors.push(error); }
      try { clearServerModuleCache(); } catch (error) { errors.push(error); }
      try { restoreEnvironment(); } catch (error) { errors.push(error); }
      try { removeTemporaryRoot(); } catch (error) { errors.push(error); }
      if (errors.length) {
        const error = new Error(`admin HTTP harness cleanup failed: ${errors.map((item) => item.message).join("; ")}`);
        error.causes = errors;
        throw error;
      }
    })();
    return cleanupPromise;
  }

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
    ...(options.environment || {}),
  };
  for (const [key, value] of Object.entries(environment)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  let baseUrl;
  try {
    if (typeof options.onPaths === "function") options.onPaths(paths);
    fs.mkdirSync(paths.storage, { recursive: true });
    fs.mkdirSync(path.join(paths.data, "backups"), { recursive: true });
    fs.writeFileSync(path.join(paths.storage, "admin-config.json"), JSON.stringify({ appName: "C1 seed" }));
    fs.writeFileSync(path.join(paths.storage, "catalog-meta.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(paths.storage, "quality-ignores.json"), JSON.stringify({ rules: [] }));
    assertInsideRoot(root, paths.storage);
    assertInsideRoot(root, paths.data);

    clearServerModuleCache();
    express = require(path.join(ROOT, "server/node_modules/express"));
    originalExpressListen = express.application.listen;
    // Importing the production app must be side-effect-free. This instruments the
    // real Express prototype solely to turn an import-time listener into a clear failure.
    express.application.listen = function importTimeListenForbidden() {
      throw new Error("APP_IMPORT_LISTEN_FORBIDDEN");
    };
    const appPath = path.join(ROOT, "server/src/app");
    const importedApp = typeof options.importApp === "function"
      ? await options.importApp({ appPath, paths })
      : require(appPath);
    restoreExpressPrototype();

    const app = importedApp.default || importedApp;
    server = http.createServer(app);
    if (typeof options.listenServer === "function") {
      await options.listenServer(server, { paths });
    } else {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    }
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }

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
      await cleanup();
    },
  };
}

module.exports = { startAdminHttpHarness, clearServerModuleCache };
