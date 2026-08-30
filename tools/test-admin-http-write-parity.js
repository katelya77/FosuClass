/**
 * Isolated HTTP Legacy vs historical compatibility-client write parity.
 * Uses temporary storage/data dirs — never production.
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-http-parity-"));
const storageDir = path.join(tmp, "storage");
const dataDir = path.join(tmp, "data");
fs.mkdirSync(storageDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });

process.env.NODE_ENV = "test";
process.env.FOSU_STORAGE_DIR = storageDir;
process.env.FOSU_DATA_DIR = dataDir;
process.env.PORT = "0";
process.env.ADMIN_PASSWORD = "parity-test-password-123";
process.env.ADMIN_API_TOKEN = "parity-test-token-12345678";
process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = "content,feedback,audit,backups";
process.env.FOSU_CONFIG_HARD_FAIL = "false";
process.env.FOSU_RELEASE_WORKER_ENABLED = "false";

// Clear cached modules that capture paths
for (const key of Object.keys(require.cache)) {
  if (
    key.includes(`${path.sep}server${path.sep}src${path.sep}`) ||
    key.includes(`${path.sep}appConfigService`) ||
    key.includes(`${path.sep}adminCapabilities`) ||
    key.includes(`${path.sep}backupService`)
  ) {
    delete require.cache[key];
  }
}

const app = require("../server/src/app");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function request(port, method, urlPath, { headers = {}, body, cookie } = {}) {
  const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
  const hdrs = Object.assign(
    {
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
    },
    headers
  );
  if (cookie) hdrs.Cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: hdrs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          const setCookie = res.headers["set-cookie"] || [];
          resolve({ status: res.statusCode, headers: res.headers, json, setCookie, text });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieJar(setCookie, prev = "") {
  const jar = new Map();
  String(prev)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    });
  for (const line of setCookie) {
    const first = String(line).split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function main() {
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    // Login legacy-style
    const login = await request(port, "POST", "/api/admin/login", {
      body: { password: process.env.ADMIN_PASSWORD },
    });
    assert.strictEqual(login.status, 200, `login ${login.status} ${login.text}`);
    assert.strictEqual(login.json.success, true);
    let cookie = cookieJar(login.setCookie);
    const csrf = login.json.csrfToken || (login.json.data && login.json.data.csrfToken);
    assert.ok(csrf, "csrf required");

    const session = await request(port, "GET", "/api/admin/session", { cookie });
    if (session.setCookie.length) cookie = cookieJar(session.setCookie, cookie);

    // Module gate: release write blocked for Vue
    const blocked = await request(port, "POST", "/api/admin/config", {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { appName: "x" },
    });
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.json.code, "MODULE_WRITE_DISABLED");

    // Capabilities
    const caps = await request(port, "GET", "/api/admin/capabilities");
    assert.strictEqual(caps.json.primary, "legacy");
    assert.strictEqual(caps.json.writeModules.content, true);
    assert.strictEqual(caps.json.writeModules.release, false);

    // Create notice via Vue client
    const createVue = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { title: "Vue notice", content: "body", enabled: true },
    });
    assert.strictEqual(createVue.status, 200, createVue.text);
    assert.ok(createVue.json.item.version);

    // Create notice via Legacy (no next header)
    const createLegacy = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: { "X-Fosu-CSRF": csrf },
      body: { title: "Legacy notice", content: "body2", enabled: true },
    });
    assert.strictEqual(createLegacy.status, 200, createLegacy.text);

    const dailyKnowledgeBody = {
      title: "心理小知识",
      content: "先完成眼前最小的一步。",
      category: "mind",
      displayMode: "daily-tip",
      targetPage: "home",
      enabled: true,
    };
    const dailyHeaders = {
      "X-Fosu-CSRF": csrf,
      "Idempotency-Key": "http-daily-knowledge-create-1",
    };
    const createDaily = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: dailyHeaders,
      body: dailyKnowledgeBody,
    });
    assert.strictEqual(createDaily.status, 200, createDaily.text);
    assert.strictEqual(createDaily.json.replayed, false);
    assert.strictEqual(createDaily.json.item.category, "mind");
    const replayDaily = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: dailyHeaders,
      body: dailyKnowledgeBody,
    });
    assert.strictEqual(replayDaily.status, 200, replayDaily.text);
    assert.strictEqual(replayDaily.json.replayed, true);
    assert.strictEqual(replayDaily.json.item.id, createDaily.json.item.id);
    const dailyConflict = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: dailyHeaders,
      body: { ...dailyKnowledgeBody, content: "不同内容" },
    });
    assert.strictEqual(dailyConflict.status, 409, dailyConflict.text);
    const deleteDaily = await request(port, "DELETE", `/api/admin/notices/${createDaily.json.item.id}`, {
      cookie,
      headers: { "X-Fosu-CSRF": csrf },
    });
    assert.strictEqual(deleteDaily.status, 200, deleteDaily.text);
    const replayDeletedDaily = await request(port, "POST", "/api/admin/notices", {
      cookie,
      headers: dailyHeaders,
      body: dailyKnowledgeBody,
    });
    assert.strictEqual(replayDeletedDaily.status, 200, replayDeletedDaily.text);
    assert.strictEqual(replayDeletedDaily.json.replayed, true);
    const afterDeleteList = await request(port, "GET", "/api/admin/notices", { cookie });
    assert.strictEqual(afterDeleteList.json.items.some((entry) => entry.id === createDaily.json.item.id), false);

    const list = await request(port, "GET", "/api/admin/notices", { cookie });
    assert.ok(list.json.items.every((n) => n.version), "all notices need version");

    const item = createVue.json.item;
    // 428 without If-Match for Vue
    const noMatch = await request(port, "PUT", `/api/admin/notices/${item.id}`, {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { title: "no version" },
    });
    assert.strictEqual(noMatch.status, 428, noMatch.text);

    // Happy path update
    const updated = await request(port, "PUT", `/api/admin/notices/${item.id}`, {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
        "If-Match": item.version,
      },
      body: { title: "Vue notice edited", content: "body", enabled: true, expectedVersion: item.version },
    });
    assert.strictEqual(updated.status, 200, updated.text);
    assert.notStrictEqual(updated.json.item.version, item.version);

    // 409 conflict
    const conflict = await request(port, "PUT", `/api/admin/notices/${item.id}`, {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
        "If-Match": item.version,
      },
      body: { title: "stale", expectedVersion: item.version },
    });
    assert.strictEqual(conflict.status, 409, conflict.text);

    // 401 when no session on write
    const unauth = await request(port, "POST", "/api/admin/notices", {
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": "x",
      },
      body: { title: "x" },
    });
    assert.ok([401, 403].includes(unauth.status), `expected 401/403 got ${unauth.status}`);

    // File results: notices.json exists
    const noticesFile = path.join(storageDir, "notices.json");
    assert.ok(fs.existsSync(noticesFile));
    const disk = JSON.parse(fs.readFileSync(noticesFile, "utf8"));
    assert.ok(disk.some((n) => n.title === "Vue notice edited"));

    // Feedback update via both clients (create via service file)
    fs.writeFileSync(
      path.join(storageDir, "feedbacks.json"),
      JSON.stringify([{ id: "fb1", content: "hi", status: "open", type: "bug", createdAt: new Date().toISOString() }], null, 2)
    );
    const fbVue = await request(port, "PUT", "/api/admin/feedbacks/fb1", {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { status: "processing", adminNote: "seen" },
    });
    assert.strictEqual(fbVue.status, 200, fbVue.text);

    // Backup preflight dry-run
    const backupName = "notices-20260718-999999.json";
    fs.writeFileSync(
      path.join(dataDir, "backups", backupName),
      JSON.stringify([{ id: "z", title: "bak" }], null, 2)
    );
    const pf = await request(port, "POST", "/api/admin/backups/preflight", {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { filename: backupName },
    });
    assert.strictEqual(pf.status, 200, pf.text);
    assert.strictEqual(pf.json.preflight.ok, true);

    const dry = await request(port, "POST", "/api/admin/backups/restore", {
      cookie,
      headers: {
        "X-Fosu-Admin-Client": "next",
        "X-Fosu-CSRF": csrf,
      },
      body: { filename: backupName, dryRun: true, confirm: backupName, idempotencyKey: "dry-1" },
    });
    assert.strictEqual(dry.status, 200, dry.text);
    assert.strictEqual(dry.json.dryRun, true);

    console.log(
      JSON.stringify(
        {
          ok: true,
          port,
          checks: [
            "login",
            "module-gate-403",
            "vue-create",
            "legacy-create",
            "daily-knowledge-idempotency",
            "version-list",
            "428",
            "409",
            "feedback-update",
            "backup-dry-run",
          ],
        },
        null,
        2
      )
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
