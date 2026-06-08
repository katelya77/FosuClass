const assert = require("assert");
const express = require("../server/node_modules/express");
const personalRouter = require("../server/src/routes/personal");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function requestJson(baseUrl, path, method = "POST", body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function run() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/fosu/personal", personalRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const endpoint of ["/session/start", "/session/verify-slider", "/session/login-and-sync"]) {
      const result = await requestJson(baseUrl, `/api/fosu/personal${endpoint}`);
      assert.strictEqual(result.status, 410, `${endpoint} should return 410`);
      assert.strictEqual(result.data.success, false);
      assert.strictEqual(result.data.code, "XLS_ONLY");
    }

    const diagnose = await requestJson(baseUrl, "/api/fosu/personal/diagnose", "GET");
    assert.strictEqual(diagnose.status, 410);
    assert.strictEqual(diagnose.data.code, "XLS_ONLY");

    const importXls = await requestJson(baseUrl, "/api/fosu/personal/import-xls");
    assert.strictEqual(importXls.status, 200);
    assert.strictEqual(importXls.data.success, false);
    assert.strictEqual(importXls.data.code, "INVALID_PARAMS");
  } finally {
    server.close();
  }

  console.log("test-personal-routes-xls-only-server passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
