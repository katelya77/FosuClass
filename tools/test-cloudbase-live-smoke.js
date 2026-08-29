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
  files["calendar.json"] = add("calendar.json", Object.assign({
    success: true,
    term,
    releaseVersion: version,
    weeks: [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15" }],
  }, patch["calendar.json"] || {}));
  files["bootstrap.json"] = add("bootstrap.json", Object.assign({
    success: true,
    term,
    releaseVersion: version,
    catalog: { colleges: [{ code: "01", name: "test" }] },
  }, patch["bootstrap.json"] || {}));
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

function startServer(routesByPrefix, options = {}) {
  const state = {
    adminTicketRequests: 0,
    cloudbaseTicketHeaders: [],
    oracleReleaseRequests: [],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    const prefix = parts.shift();
    let relPath = `/${parts.join("/")}`;

    if (prefix === "oracle" && relPath === "/api/admin/static-ticket/create") {
      state.adminTicketRequests += 1;
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const auth = req.headers["x-admin-token"] || "";
        if (!auth) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: false, code: "ADMIN_TOKEN_REQUIRED" }));
          return;
        }
        const ticket = typeof options.ticketFactory === "function"
          ? options.ticketFactory(state.adminTicketRequests, body)
          : (options.validTicket || "oracle-ticket");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          ticket,
          headerName: "X-Fosu-Static-Ticket",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }));
      });
      return;
    }

    if (prefix === "oracle" && relPath.startsWith("/static/")) {
      relPath = relPath.slice("/static".length);
    }
    if (prefix === "cloudbase") {
      state.cloudbaseTicketHeaders.push(req.headers["x-fosu-static-ticket"] || "");
    }
    if (prefix === "oracle" && relPath.startsWith("/releases/")) {
      state.oracleReleaseRequests.push({
        path: relPath,
        ticket: req.headers["x-fosu-static-ticket"] || "",
      });
      if (options.requireOracleTicket) {
        const expected = options.validTicket || "oracle-ticket";
        const received = req.headers["x-fosu-static-ticket"] || "";
        if (!received) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: false, code: "STATIC_TICKET_REQUIRED" }));
          return;
        }
        if (received !== expected) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: false, code: "STATIC_TICKET_EXPIRED" }));
          return;
        }
      }
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
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, state });
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
    assert.strictEqual(oracleOnly.oracle.calendar.ok, true);
    assert.strictEqual(oracleOnly.oracle.bootstrap.ok, true);

    const dual = await liveSmoke.runLiveSmoke({
      oracleBaseUrl: `${started.baseUrl}/oracle`,
      cloudbaseBaseUrl: `${started.baseUrl}/cloudbase`,
      timeoutMs: 3000,
    });
    assert.strictEqual(dual.success, true);
    assert.strictEqual(dual.mode, "dual-source-full");
    assert(started.state.cloudbaseTicketHeaders.every((value) => !value), "CloudBase requests must not include Oracle static ticket");

  } finally {
    await closeServer(started.server);
  }

  const missingTicketServer = await startServer({ oracle }, { requireOracleTicket: true, validTicket: "oracle-ticket" });
  try {
    const missingTicket = await liveSmoke.runOracleOnlySmoke({
      oracleBaseUrl: `${missingTicketServer.baseUrl}/oracle`,
      timeoutMs: 3000,
      adminToken: "",
    });
    assert.strictEqual(missingTicket.success, false, "Oracle ticket mode without admin token must fail");
    assert(missingTicket.steps.some((step) => step.status === 401), "missing ticket should be rejected");
  } finally {
    await closeServer(missingTicketServer.server);
  }

  const ticketServer = await startServer({ oracle }, { requireOracleTicket: true, validTicket: "oracle-ticket" });
  try {
    const ticketSmoke = await liveSmoke.runOracleOnlySmoke({
      oracleBaseUrl: `${ticketServer.baseUrl}/oracle`,
      timeoutMs: 3000,
      adminToken: "admin-test-token",
    });
    assert.strictEqual(ticketSmoke.success, true, JSON.stringify(ticketSmoke, null, 2));
    assert.strictEqual(ticketSmoke.oracle.ticketMode, true);
    assert(ticketServer.state.oracleReleaseRequests.every((item) => item.ticket === "oracle-ticket"), "Oracle release files must carry ticket");
    assert(!JSON.stringify(ticketSmoke).includes("oracle-ticket"), "smoke result must not log ticket");
  } finally {
    await closeServer(ticketServer.server);
  }

  const refreshServer = await startServer({ oracle }, {
    requireOracleTicket: true,
    validTicket: "oracle-ticket-2",
    ticketFactory(count) {
      return count === 1 ? "expired-ticket" : "oracle-ticket-2";
    },
  });
  try {
    const refreshed = await liveSmoke.runOracleOnlySmoke({
      oracleBaseUrl: `${refreshServer.baseUrl}/oracle`,
      timeoutMs: 3000,
      adminToken: "admin-test-token",
    });
    assert.strictEqual(refreshed.success, true, JSON.stringify(refreshed, null, 2));
    assert(refreshServer.state.adminTicketRequests >= 2, "expired ticket must refresh once");
  } finally {
    await closeServer(refreshServer.server);
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

  const missingCalendar = buildRelease(version);
  delete missingCalendar[`/releases/${version}/calendar.json`];
  const missingCalendarStarted = await startServer({ oracle, cloudbase: missingCalendar });
  try {
    const result = await liveSmoke.runLiveSmoke({
      oracleBaseUrl: `${missingCalendarStarted.baseUrl}/oracle`,
      cloudbaseBaseUrl: `${missingCalendarStarted.baseUrl}/cloudbase`,
      timeoutMs: 3000,
    });
    assert.strictEqual(result.success, false, "dual smoke must fail when calendar.json is absent from CloudBase");
    assert(result.cloudbase.steps.some((step) => step.label.endsWith("calendar.json") && step.status === 404));
  } finally {
    await closeServer(missingCalendarStarted.server);
  }
  console.log("test-cloudbase-live-smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
