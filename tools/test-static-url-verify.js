const assert = require("assert");
const http = require("http");

const staticReleaseSyncService = require("../server/src/services/staticReleaseSyncService");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function runHeadScenario() {
  const requests = [];
  const server = await listen((req, res) => {
    requests.push({ method: req.method, url: req.url, range: req.headers.range || "" });
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable",
      etag: '"head-ok"',
    });
    if (req.method !== "HEAD") {
      res.end(JSON.stringify({ shouldNotDownload: true }));
    } else {
      res.end();
    }
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/static/releases`;
    const results = await staticReleaseSyncService.verifyPublicUrls("v-head", baseUrl, {
      timeoutMs: 1000,
      concurrency: 2,
    });
    assert.strictEqual(results.length, 3);
    assert(results.every((item) => item.ok && item.method === "HEAD"), "HEAD scenario should use only HEAD");
    assert.strictEqual(requests.filter((item) => item.method === "GET").length, 0, "HEAD success must not issue GET");
  } finally {
    server.close();
  }
}

async function runRangeFallbackScenario() {
  const requests = [];
  let fullBodyAttempted = false;
  const server = await listen((req, res) => {
    requests.push({ method: req.method, url: req.url, range: req.headers.range || "" });
    if (req.method === "HEAD") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end();
      return;
    }
    if (req.headers.range !== "bytes=0-0") {
      fullBodyAttempted = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("x".repeat(1024 * 1024));
      return;
    }
    res.writeHead(206, {
      "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable",
      "content-range": "bytes 0-0/1048576",
      "last-modified": new Date().toUTCString(),
    });
    res.end("{");
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/static/releases`;
    const results = await staticReleaseSyncService.verifyPublicUrls("v-range", baseUrl, {
      timeoutMs: 1000,
      concurrency: 2,
    });
    assert.strictEqual(results.length, 3);
    assert(results.every((item) => item.ok && item.method === "GET" && item.status === 206), "HEAD fallback should use ranged GET");
    assert.strictEqual(fullBodyAttempted, false, "URL verification must not request a full response body");
    assert.strictEqual(requests.filter((item) => item.method === "GET" && item.range === "bytes=0-0").length, 3);
  } finally {
    server.close();
  }
}

(async () => {
  await runHeadScenario();
  await runRangeFallbackScenario();
  console.log("test-static-url-verify passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
