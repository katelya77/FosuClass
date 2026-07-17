/**
 * Real Express route-level scope matrix for admin write APIs.
 * Isolates all writes into temporary FOSU_STORAGE_DIR / FOSU_DATA_DIR.
 */
const assert = require("assert");
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const express = require(path.join(__dirname, "../server/node_modules/express"));

const tempRoot = path.join(
  os.tmpdir(),
  `fosu-scope-matrix-${process.pid}-${Date.now()}`
);
const storageDir = path.join(tempRoot, "storage");
const dataDir = path.join(tempRoot, "data");
fs.mkdirSync(storageDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "matrix-admin-password";
process.env.ADMIN_API_TOKEN = "matrix-admin-full-token";
process.env.FOSU_STORAGE_DIR = storageDir;
process.env.FOSU_DATA_DIR = dataDir;
process.env.ADMIN_SERVICE_TOKENS = JSON.stringify([
  { name: "stager", token: "tok-staging-init", scopes: ["staging:init"] },
  { name: "relay", token: "tok-relay-manage", scopes: ["relay:manage"] },
  { name: "publisher", token: "tok-release-publish", scopes: ["release:publish"] },
]);

function clearServerModules() {
  for (const key of Object.keys(require.cache)) {
    const norm = key.replace(/\\/g, "/");
    if (norm.includes("/server/src/")) {
      delete require.cache[key];
    }
  }
}

clearServerModules();
const adminRouter = require("../server/src/routes/admin");

function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRouter);
  return app;
}

function request(app, { method, path: urlPath, token, body }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body == null ? null : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            "content-type": "application/json",
            "x-admin-token": token,
            "x-fosu-client": "service",
            ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch (_) {
              json = { raw: text };
            }
            resolve({ status: res.statusCode, json });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function listRuntimeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.name !== ".gitkeep")
    .map((d) => d.name);
}

function assertNoRuntimePollution() {
  // Writes must stay under tempRoot, not the real tracked storage/data trees.
  const root = path.join(__dirname, "..");
  const realRelay = path.join(root, "server/storage/relay");
  const realStaging = path.join(root, "server/storage/staging-uploads");
  const realBackups = path.join(root, "server/data/backups");

  assert.deepStrictEqual(
    listRuntimeFiles(realRelay),
    [],
    `real relay storage polluted: ${listRuntimeFiles(realRelay).join(",")}`
  );
  assert.deepStrictEqual(
    listRuntimeFiles(realStaging),
    [],
    `real staging-uploads polluted: ${listRuntimeFiles(realStaging).join(",")}`
  );
  if (fs.existsSync(realBackups)) {
    const backups = listRuntimeFiles(realBackups).filter((n) => n.includes("scope-matrix") || n.startsWith("notices-"));
    // Allow pre-existing backups; ensure our temp-isolated run didn't require writing here.
    // Strong check: data dir used by process must be temp.
    assert.ok(String(process.env.FOSU_DATA_DIR || "").includes(tempRoot), "FOSU_DATA_DIR must be temp");
    assert.ok(String(process.env.FOSU_STORAGE_DIR || "").includes(tempRoot), "FOSU_STORAGE_DIR must be temp");
  }

  // Optional: git status should not introduce NEW untracked runtime dumps under those dirs.
  const status = spawnSync("git", ["status", "--short", "--", "server/storage/relay", "server/storage/staging-uploads", "server/data/backups"], {
    cwd: root,
    encoding: "utf8",
  });
  const out = status.stdout || "";
  const untrackedRuntime = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("??") && !l.includes(".gitkeep"));
  assert.deepStrictEqual(untrackedRuntime, [], `unexpected untracked runtime files:\n${out}`);
}

async function main() {
  try {
    const app = createApp();

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/relay/tasks",
        token: "tok-staging-init",
        body: { term: "2025-2026-2" },
      });
      assert.strictEqual(res.status, 403, `staging→relay expected 403 got ${res.status}`);
      assert.strictEqual(res.json && res.json.code, "ADMIN_SCOPE_DENIED");
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/staging/upload/init",
        token: "tok-staging-init",
        body: {
          fileName: "x.json",
          term: "2025-2026-2",
          source: "scope-matrix-test",
          contentEncoding: "identity",
          contentType: "application/json",
          chunkSize: 1024,
          totalChunks: 1,
          uploadSize: 10,
          originalSize: 10,
        },
      });
      assert.notStrictEqual(res.status, 403, `staging init must not be scope-denied: ${JSON.stringify(res.json)}`);
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/relay/tasks",
        token: "tok-relay-manage",
        body: { term: "2025-2026-2" },
      });
      assert.notStrictEqual(res.status, 403, `relay manage should pass scope: ${JSON.stringify(res.json)}`);
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/ai-provider/config",
        token: "tok-relay-manage",
        body: { provider: "mock" },
      });
      assert.strictEqual(res.status, 403, `relay→provider expected 403 got ${res.status}`);
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/notices",
        token: "tok-release-publish",
        body: { title: "x", content: "y" },
      });
      assert.strictEqual(res.status, 403, `publish→notices expected 403 got ${res.status}`);
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/notices",
        token: "matrix-admin-full-token",
        body: { title: "scope-matrix", content: "ok", status: "draft" },
      });
      assert.notStrictEqual(res.status, 403, `admin:full notices must not be scope-denied`);
    }

    {
      const res = await request(app, {
        method: "POST",
        path: "/api/admin/relay/tasks",
        token: "matrix-admin-full-token",
        body: { term: "2025-2026-2" },
      });
      assert.notStrictEqual(res.status, 403, `admin:full relay must not be scope-denied`);
    }

    // Writes stayed in temp dirs
    assert.ok(fs.existsSync(storageDir));
    assert.ok(fs.existsSync(dataDir));
    assertNoRuntimePollution();

    console.log("Service token route matrix tests passed.");
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
    clearServerModules();
  }
}

main().catch((err) => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (_) {}
  console.error(err);
  process.exit(1);
});
