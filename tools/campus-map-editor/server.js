const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const {
  applyToMiniprogram,
  createBackup,
  readCampusPlaces,
  readDraft,
  saveDraft,
  validateCampusPlaces,
} = require("./lib");

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.CAMPUS_MAP_EDITOR_PORT || 0) || 0;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = decoded === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, decoded.replace(/^\/+/, ""));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

function sendFile(res, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType(file) });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/data") {
    sendJson(res, 200, { success: true, data: readCampusPlaces(), draft: readDraft() });
    return;
  }
  if (req.method === "GET" && pathname === "/api/draft") {
    sendJson(res, 200, { success: true, draft: readDraft() });
    return;
  }
  if (req.method === "POST" && pathname === "/api/draft") {
    const body = await parseBody(req);
    const file = saveDraft(body.data || body);
    sendJson(res, 200, { success: true, file, draftPath: file });
    return;
  }
  if (req.method === "POST" && pathname === "/api/validate") {
    const body = await parseBody(req);
    sendJson(res, 200, { success: true, validation: validateCampusPlaces(body.data || body) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/apply") {
    const body = await parseBody(req);
    try {
      const result = applyToMiniprogram(body.data || body);
      sendJson(res, 200, {
        success: true,
        backup: result.backup,
        backupPath: result.backup && result.backup.path || result.backup,
        serviceBackupPath: result.backup && result.backup.servicePath || "",
        data: result.data,
        publishedVersion: result.data && result.data.version || "",
        validation: result.validation,
      });
    } catch (error) {
      sendJson(res, 422, { success: false, code: error.message, validation: error.validation || null });
    }
    return;
  }
  if (req.method === "POST" && pathname === "/api/backup") {
    const file = createBackup(readCampusPlaces());
    sendJson(res, 200, {
      success: true,
      file: file && file.path || file,
      backup: file,
      serviceBackupPath: file && file.servicePath || "",
    });
    return;
  }
  if (req.method === "GET" && pathname.startsWith("/assets/")) {
    const file = path.resolve(ROOT, "miniprogram", pathname.replace(/^\/+/, ""));
    if (!file.startsWith(path.join(ROOT, "miniprogram", "assets"))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    sendFile(res, file);
    return;
  }
  sendJson(res, 404, { success: false, code: "NOT_FOUND" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) {
    handleApi(req, res, url.pathname).catch((error) => {
      sendJson(res, 500, { success: false, code: error.message || "SERVER_ERROR" });
    });
    return;
  }
  sendFile(res, safeStaticPath(url.pathname));
});

server.listen(PORT, "127.0.0.1", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Campus map editor: ${url}`);
  if (process.env.CAMPUS_MAP_EDITOR_NO_OPEN !== "1") {
    const command = process.platform === "win32"
      ? `start "" "${url}"`
      : (process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`);
    exec(command, () => {});
  }
});
