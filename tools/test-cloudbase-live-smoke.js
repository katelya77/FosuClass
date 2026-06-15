const assert = require("assert");
const crypto = require("crypto");
const http = require("http");

const liveSmoke = require("./cloudbase/live-smoke");

function sha1(text) {
  return crypto.createHash("sha1").update(Buffer.from(text)).digest("hex");
}

function jsonText(payload) {
  return JSON.stringify(payload);
}

function buildRelease(version, patch = {}) {
  const term = "2025-2026-2";
  const routes = {};
  const add = (relPath, payload) => {
    const text = jsonText(payload);
    routes[`/releases/${version}/${relPath}`] = text;
    return { hash: sha1(text), size: Buffer.byteLength(text) };
  };
  const files = {};
  ["class", "teacher", "classroom", "course"].forEach((type) => {
    const id = `${type}-1`;
    files[`index/${type}/all.json`] = add(`index/${type}/all.json`, {
      success: true,
      term,
      releaseVersion: version,
      items: [{ id, name: `${type} one` }],
    });
    files[`detail/${type}/${id}.json`] = add(`detail/${type}/${id}.json`, Object.assign({
      success: true,
      term,
      releaseVersion: version,
      id,
      courses: [{ courseName: "Math", weekday: 1, startSection: 1, endSection: 2 }],
    }, patch[`detail/${type}/${id}.json`] || {}));
  });
  files["empty-room/index.json"] = add("empty-room/index.json", {
    success: true,
    term,
    releaseVersion: version,
    rooms: [{ roomId: "A101" }],
  });
  const manifest = {
    success: true,
    schemaVersion: 2,
    term,
    releaseVersion: version,
    version,
    cacheEpoch: 123,
    forceRefreshToken: `${version}:123`,
    files,
  };
  const manifestText = jsonText(manifest);
  routes[`/releases/${version}/manifest.json`] = manifestText;
  routes["/runtime/active.json"] = jsonText({
    success: true,
    term,
    activeTerm: term,
    releaseVersion: version,
    activeReleaseVersion: version,
    cacheEpoch: 123,
    forceRefreshToken: `${version}:123`,
    manifestHash: sha1(manifestText),
    manifestSize: Buffer.byteLength(manifestText),
  });
  return routes;
}

function startServer(routesByPrefix) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    const prefix = parts.shift();
    let relPath = `/${parts.join("/")}`;
    if (prefix === "oracle" && relPath.startsWith("/static/")) {
      relPath = relPath.slice("/static".length);
    }
    const routes = routesByPrefix[prefix] || {};
    const body = routes[relPath];
    if (!body) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  const version = "live-smoke-r1";
  const oracle = buildRelease(version);
  const cloudbase = buildRelease(version);
  const started = await startServer({ oracle, cloudbase });
  try {
    const oracleOnly = await liveSmoke.runOracleOnlySmoke({
      oracleBaseUrl: `${started.baseUrl}/oracle`,
      timeoutMs: 3000,
    });
    assert.strictEqual(oracleOnly.success, true, JSON.stringify(oracleOnly, null, 2));
    assert.strictEqual(oracleOnly.mode, "oracle-only");
    assert.strictEqual(Object.keys(oracleOnly.oracle.indexes).length, 4);
    assert.strictEqual(Object.keys(oracleOnly.oracle.details).length, 4);

    const dual = await liveSmoke.runLiveSmoke({
      oracleBaseUrl: `${started.baseUrl}/oracle`,
      cloudbaseBaseUrl: `${started.baseUrl}/cloudbase`,
      timeoutMs: 3000,
    });
    assert.strictEqual(dual.success, true);
    assert.strictEqual(dual.mode, "dual-source-full");

  } finally {
    await closeServer(started.server);
  }

  const badCloudbase = buildRelease(version, {
    "detail/course/course-1.json": { courses: [{ courseName: "Tampered", weekday: 1, startSection: 1, endSection: 2 }] },
  });
  const badStarted = await startServer({ oracle, cloudbase: badCloudbase });
  try {
    const dualBad = await liveSmoke.runLiveSmoke({
      oracleBaseUrl: `${badStarted.baseUrl}/oracle`,
      cloudbaseBaseUrl: `${badStarted.baseUrl}/cloudbase`,
      timeoutMs: 3000,
    });
    assert.strictEqual(dualBad.success, false);
    assert(dualBad.comparisons.some((item) => (
      item.label === "detail/course" &&
      item.fields.some((field) => field.field === "hash" && field.required === true && field.match === false)
    )), "dual smoke must compare detail hashes");
  } finally {
    await closeServer(badStarted.server);
  }
  console.log("test-cloudbase-live-smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
