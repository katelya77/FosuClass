/**
 * Real Express route-level scope matrix for admin write APIs.
 * Does not only unit-test hasAnyScope().
 */
const assert = require("assert");
const http = require("http");
const path = require("path");
const express = require(path.join(__dirname, "../server/node_modules/express"));

process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "matrix-admin-password";
process.env.ADMIN_API_TOKEN = "matrix-admin-full-token";
process.env.ADMIN_SERVICE_TOKENS = JSON.stringify([
  { name: "stager", token: "tok-staging-init", scopes: ["staging:init"] },
  { name: "relay", token: "tok-relay-manage", scopes: ["relay:manage"] },
  { name: "publisher", token: "tok-release-publish", scopes: ["release:publish"] },
]);

// Fresh modules after env
const loadPaths = [
  "../server/src/config",
  "../server/src/services/serviceTokenService",
  "../server/src/services/adminAuth",
  "../server/src/security/adminRouteScopes",
  "../server/src/routes/admin",
];
for (const p of loadPaths) {
  try {
    delete require.cache[require.resolve(p)];
  } catch (_) {}
}

const adminRouter = require("../server/src/routes/admin");

function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRouter);
  return app;
}

function request(app, { method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body == null ? null : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
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

async function main() {
  const app = createApp();

  // staging:init cannot create relay tasks
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/relay/tasks",
      token: "tok-staging-init",
      body: { term: "2025-2026-2" },
    });
    assert.strictEqual(res.status, 403, `staging→relay expected 403 got ${res.status} ${JSON.stringify(res.json)}`);
    assert.strictEqual(res.json && res.json.code, "ADMIN_SCOPE_DENIED");
  }

  // staging:init can init staging upload (may 400 on body, but not 403)
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
    assert.ok([200, 201, 400, 422, 500].includes(res.status), `unexpected status ${res.status}`);
    // If service accepts, success; if validation fails, still proves scope passed
    if (res.status === 200 || res.status === 201) {
      assert.strictEqual(res.json.success, true);
    }
  }

  // relay:manage can create tasks
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/relay/tasks",
      token: "tok-relay-manage",
      body: { term: "2025-2026-2" },
    });
    assert.notStrictEqual(res.status, 403, `relay manage should pass scope: ${JSON.stringify(res.json)}`);
    assert.ok(res.status < 500 || res.json, "relay create should reach handler");
  }

  // relay:manage cannot write provider config
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/ai-provider/config",
      token: "tok-relay-manage",
      body: { provider: "mock" },
    });
    assert.strictEqual(res.status, 403, `relay→provider expected 403 got ${res.status}`);
  }

  // release:publish cannot create notices
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/notices",
      token: "tok-release-publish",
      body: { title: "x", content: "y" },
    });
    assert.strictEqual(res.status, 403, `publish→notices expected 403 got ${res.status}`);
  }

  // admin:full can reach notices write (may validate body)
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/notices",
      token: "matrix-admin-full-token",
      body: { title: "scope-matrix", content: "ok", status: "draft" },
    });
    assert.notStrictEqual(res.status, 403, `admin:full notices must not be scope-denied`);
  }

  // admin:full can reach relay create
  {
    const res = await request(app, {
      method: "POST",
      path: "/api/admin/relay/tasks",
      token: "matrix-admin-full-token",
      body: { term: "2025-2026-2" },
    });
    assert.notStrictEqual(res.status, 403, `admin:full relay must not be scope-denied`);
  }

  console.log("Service token route matrix tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
