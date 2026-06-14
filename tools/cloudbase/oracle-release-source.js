const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  scanPrivacy,
  verifyLocalReleasePack,
} = require("./release-pack-utils");

const DEFAULT_ORACLE_BASE_URL = "https://class.katelya.eu.org";
const DEFAULT_OUTPUT_ROOT = path.resolve(".local", "cloudbase-releases");
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const INDEX_TYPES = ["class", "teacher", "classroom", "course"];

function parseArgs(argv) {
  const args = {};
  (argv || []).forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      args[body] = true;
    }
  });
  return args;
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha1Buffer(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function sha1File(filePath) {
  return sha1Buffer(fs.readFileSync(filePath));
}

function fileMeta(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { size: stat.size, hash: sha1File(filePath) };
}

function writeFileAtomic(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, buffer);
  if (process.platform === "win32" && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.renameSync(tempPath, filePath);
}

function normalizeReleaseVersion(value) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,128}$/.test(text) || text.includes("..") || text.includes("/") || text.includes("\\")) {
    const error = new Error("Invalid releaseVersion from Oracle active pointer");
    error.code = "ORACLE_RELEASE_VERSION_UNSAFE";
    throw error;
  }
  return text;
}

function assertSafeRelativePath(relativePath) {
  const text = String(relativePath || "").replace(/\\/g, "/").trim();
  if (!text || text.startsWith("/") || text.includes("\0")) {
    const error = new Error(`Unsafe release file path: ${relativePath}`);
    error.code = "ORACLE_RELEASE_PATH_TRAVERSAL";
    throw error;
  }
  const normalized = path.posix.normalize(text);
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../") || normalized !== text.replace(/^\.\//, "")) {
    const error = new Error(`Unsafe release file path: ${relativePath}`);
    error.code = "ORACLE_RELEASE_PATH_TRAVERSAL";
    throw error;
  }
  return normalized;
}

function getManifestFiles(manifest) {
  const files = manifest && manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files)
    ? manifest.files
    : null;
  if (!files) {
    const error = new Error("manifest.files is required");
    error.code = "ORACLE_RELEASE_MANIFEST_FILES_REQUIRED";
    throw error;
  }
  return Object.keys(files).map((relativePath) => {
    const safePath = assertSafeRelativePath(relativePath);
    const expected = files[relativePath] || {};
    const size = Number(expected.size || 0) || 0;
    const hash = String(expected.hash || "").trim();
    return { relativePath: safePath, manifestPath: relativePath, size, hash };
  });
}

function assertSizeBudget(files, options = {}) {
  const maxSingle = Number(options.maxSingleFileBytes || DEFAULT_MAX_SINGLE_FILE_BYTES) || DEFAULT_MAX_SINGLE_FILE_BYTES;
  const maxTotal = Number(options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES) || DEFAULT_MAX_TOTAL_BYTES;
  let total = 0;
  files.forEach((item) => {
    if (item.size > maxSingle) {
      const error = new Error(`Release file too large: ${item.relativePath}`);
      error.code = "ORACLE_RELEASE_FILE_TOO_LARGE";
      throw error;
    }
    total += item.size;
  });
  if (total > maxTotal) {
    const error = new Error(`Release pack too large: ${total}`);
    error.code = "ORACLE_RELEASE_TOTAL_TOO_LARGE";
    throw error;
  }
  return { maxSingleFileBytes: maxSingle, maxTotalBytes: maxTotal, expectedTotalBytes: total };
}

function getOracleBaseUrl(options = {}) {
  return String(options.oracleBaseUrl || process.env.ORACLE_API_BASE_URL || process.env.FOSU_ORACLE_API_BASE_URL || DEFAULT_ORACLE_BASE_URL)
    .trim()
    .replace(/\/+$/g, "");
}

function getHeaderToken(name) {
  return String(process.env[name] || "").trim();
}

function buildStaticHeaders(context = {}) {
  const headers = Object.assign({}, context.headers || {});
  const ticket = context.staticTicket || getHeaderToken("ORACLE_STATIC_TICKET") || getHeaderToken("FOSU_STATIC_TICKET");
  if (ticket) headers["X-Fosu-Static-Ticket"] = ticket;
  return headers;
}

async function fetchResponse(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
  });
  return response;
}

async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, options);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${url}`);
    error.code = response.status === 401 || response.status === 403 ? "ORACLE_RELEASE_AUTH_REQUIRED" : "ORACLE_RELEASE_HTTP";
    error.status = response.status;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    error.code = "ORACLE_RELEASE_INVALID_JSON";
    error.url = url;
    throw error;
  }
}

async function requestAdminStaticTicket(context = {}) {
  const token = context.adminToken || getHeaderToken("ORACLE_ADMIN_TOKEN") || getHeaderToken("ADMIN_API_TOKEN");
  if (!token) {
    const error = new Error("Oracle static release requires a ticket, but no legal admin token was provided in environment variables");
    error.code = "ORACLE_RELEASE_AUTH_REQUIRED";
    throw error;
  }
  const releaseVersion = normalizeReleaseVersion(context.releaseVersion);
  const url = joinUrl(context.oracleBaseUrl, "api/admin/static-ticket/create");
  const response = await fetchResponse(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
    },
    body: JSON.stringify({
      releaseVersion,
      pathPrefix: `/static/releases/${releaseVersion}/`,
      ttlSeconds: 900,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Unable to obtain Oracle static ticket: HTTP ${response.status}`);
    error.code = "ORACLE_RELEASE_AUTH_REQUIRED";
    error.status = response.status;
    throw error;
  }
  const payload = JSON.parse(text);
  if (!payload || payload.success === false || !payload.ticket) {
    const error = new Error("Oracle static ticket response did not contain a ticket");
    error.code = "ORACLE_RELEASE_AUTH_REQUIRED";
    throw error;
  }
  context.staticTicket = payload.ticket;
  return payload.ticket;
}

async function fetchStaticResponseWithAuth(url, context = {}, options = {}) {
  const headers = Object.assign({}, buildStaticHeaders(context), options.headers || {});
  let response = await fetchResponse(url, { headers });
  if ((response.status === 401 || response.status === 403) && !context.staticTicket) {
    await requestAdminStaticTicket(context);
    response = await fetchResponse(url, {
      headers: Object.assign({}, buildStaticHeaders(context), options.headers || {}),
    });
  }
  return response;
}

async function fetchStaticJson(url, context = {}) {
  const response = await fetchStaticResponseWithAuth(url, context);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${url}`);
    error.code = response.status === 401 || response.status === 403 ? "ORACLE_RELEASE_AUTH_REQUIRED" : "ORACLE_RELEASE_HTTP";
    error.status = response.status;
    throw error;
  }
  return JSON.parse(text);
}

async function fetchOracleActivePointer(options = {}) {
  const oracleBaseUrl = getOracleBaseUrl(options);
  const staticUrl = joinUrl(oracleBaseUrl, "static/runtime/active.json");
  const apiUrl = joinUrl(oracleBaseUrl, "api/fosu/runtime/active");
  try {
    const pointer = await fetchJson(staticUrl);
    return { source: "oracle-static-runtime", pointer, oracleBaseUrl };
  } catch (staticError) {
    const pointer = await fetchJson(apiUrl);
    return {
      source: "oracle-api-runtime",
      pointer,
      oracleBaseUrl,
      fallbackReason: staticError.code || staticError.message,
    };
  }
}

function extractActiveRelease(input) {
  const pointer = input && input.pointer || input || {};
  const releaseVersion = normalizeReleaseVersion(pointer.releaseVersion || pointer.version || pointer.termConfig && pointer.termConfig.releaseVersion || "");
  const term = String(pointer.activeTerm || pointer.term || pointer.termConfig && pointer.termConfig.term || "").trim();
  if (!term) {
    const error = new Error("Oracle active pointer missing term");
    error.code = "ORACLE_ACTIVE_TERM_MISSING";
    throw error;
  }
  return {
    term,
    releaseVersion,
    cacheEpoch: pointer.cacheEpoch || 0,
    forceRefreshToken: pointer.forceRefreshToken || "",
    pointer,
  };
}

async function fetchOracleManifest(active, options = {}) {
  const oracleBaseUrl = getOracleBaseUrl(options);
  const releaseVersion = normalizeReleaseVersion(active.releaseVersion || active.version);
  const context = Object.assign({}, options, { oracleBaseUrl, releaseVersion });
  const manifestUrl = joinUrl(oracleBaseUrl, "static/releases", releaseVersion, "manifest.json");
  const manifest = await fetchStaticJson(manifestUrl, context);
  const manifestVersion = manifest.releaseVersion || manifest.version || "";
  if (manifestVersion !== releaseVersion) {
    const error = new Error(`Oracle manifest releaseVersion mismatch: ${manifestVersion}`);
    error.code = "ORACLE_RELEASE_VERSION_MISMATCH";
    throw error;
  }
  return { manifest, manifestUrl, releaseVersion, context };
}

async function downloadOneFile(item, options = {}) {
  const releaseVersion = normalizeReleaseVersion(options.releaseVersion);
  const oracleBaseUrl = getOracleBaseUrl(options);
  const url = joinUrl(oracleBaseUrl, "static/releases", releaseVersion, item.relativePath);
  const destPath = path.join(options.releaseDir, item.relativePath);
  const partPath = `${destPath}.part`;
  const existing = fileMeta(destPath);
  if (existing && item.hash && existing.hash === item.hash && (!item.size || existing.size === item.size)) {
    return { relativePath: item.relativePath, status: "skipped", size: existing.size, hash: existing.hash };
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  let lastError = null;
  const retryCount = Math.max(1, Number(options.retryCount || DEFAULT_RETRY_COUNT) || DEFAULT_RETRY_COUNT);
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      const currentPartSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      const headers = currentPartSize > 0 ? { Range: `bytes=${currentPartSize}-` } : {};
      const response = await fetchStaticResponseWithAuth(url, options.context, { headers });
      if (response.status === 416 && currentPartSize > 0) {
        fs.unlinkSync(partPath);
        throw Object.assign(new Error("Range not satisfiable; restarting download"), { code: "ORACLE_RELEASE_RANGE_RESTART" });
      }
      if (!response.ok && response.status !== 206) {
        const error = new Error(`HTTP ${response.status} ${url}`);
        error.code = response.status === 401 || response.status === 403 ? "ORACLE_RELEASE_AUTH_REQUIRED" : "ORACLE_RELEASE_HTTP";
        error.status = response.status;
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (currentPartSize > 0 && response.status === 206) {
        fs.appendFileSync(partPath, buffer);
      } else {
        fs.writeFileSync(partPath, buffer);
      }
      const actual = fileMeta(partPath);
      const maxSingle = Number(options.maxSingleFileBytes || DEFAULT_MAX_SINGLE_FILE_BYTES) || DEFAULT_MAX_SINGLE_FILE_BYTES;
      if (actual.size > maxSingle) {
        const error = new Error(`Downloaded file exceeds max size: ${item.relativePath}`);
        error.code = "ORACLE_RELEASE_FILE_TOO_LARGE";
        throw error;
      }
      if (item.size && actual.size !== item.size) {
        const error = new Error(`size mismatch: ${item.relativePath}`);
        error.code = "ORACLE_RELEASE_SIZE_MISMATCH";
        throw error;
      }
      if (item.hash && actual.hash !== item.hash) {
        const error = new Error(`hash mismatch: ${item.relativePath}`);
        error.code = "ORACLE_RELEASE_HASH_MISMATCH";
        throw error;
      }
      if (process.platform === "win32" && fs.existsSync(destPath)) fs.unlinkSync(destPath);
      fs.renameSync(partPath, destPath);
      return { relativePath: item.relativePath, status: "downloaded", size: actual.size, hash: actual.hash };
    } catch (error) {
      lastError = error;
      if (error.code === "ORACLE_RELEASE_AUTH_REQUIRED" || error.code === "ORACLE_RELEASE_HASH_MISMATCH" || error.code === "ORACLE_RELEASE_SIZE_MISMATCH") {
        break;
      }
      await sleep(150 * attempt);
    }
  }
  throw lastError;
}

async function runPool(items, concurrency, worker) {
  const result = [];
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(Number(concurrency) || DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY)) }, runWorker);
  await Promise.all(workers);
  return result;
}

function verifyDownloadedRelease(options = {}) {
  const local = verifyLocalReleasePack({
    publicRoot: options.outputRoot || DEFAULT_OUTPUT_ROOT,
    releaseVersion: options.releaseVersion,
  });
  const privacy = scanPrivacy(local.releaseDir);
  return { local, privacy };
}

async function downloadReleaseFromOracle(options = {}) {
  const outputRoot = path.resolve(options.outputRoot || process.env.CLOUDBASE_RELEASE_CACHE_DIR || DEFAULT_OUTPUT_ROOT);
  const activeSource = options.activeSource || await fetchOracleActivePointer(options);
  const active = extractActiveRelease(activeSource);
  const manifestInfo = await fetchOracleManifest(active, options);
  const files = getManifestFiles(manifestInfo.manifest);
  const sizeBudget = assertSizeBudget(files, options);
  const releaseDir = path.join(outputRoot, active.releaseVersion);
  fs.mkdirSync(releaseDir, { recursive: true });
  const manifestBuffer = Buffer.from(JSON.stringify(manifestInfo.manifest, null, 2));
  writeFileAtomic(path.join(releaseDir, "manifest.json"), manifestBuffer);

  const context = Object.assign({}, manifestInfo.context, options, {
    oracleBaseUrl: manifestInfo.context.oracleBaseUrl,
    releaseVersion: active.releaseVersion,
  });
  let completed = 0;
  let downloadedBytes = 0;
  const downloaded = await runPool(files, options.concurrency || DEFAULT_CONCURRENCY, async (item) => {
    const result = await downloadOneFile(item, {
      context,
      oracleBaseUrl: manifestInfo.context.oracleBaseUrl,
      releaseVersion: active.releaseVersion,
      releaseDir,
      retryCount: options.retryCount || DEFAULT_RETRY_COUNT,
      maxSingleFileBytes: sizeBudget.maxSingleFileBytes,
    });
    completed += 1;
    downloadedBytes += Number(result.size || 0);
    if (typeof options.onProgress === "function") {
      options.onProgress({
        completed,
        total: files.length,
        downloadedBytes,
        expectedTotalBytes: sizeBudget.expectedTotalBytes,
        relativePath: item.relativePath,
        status: result.status,
      });
    }
    return result;
  });

  const verification = verifyDownloadedRelease({
    outputRoot,
    releaseVersion: active.releaseVersion,
  });
  const totalSize = files.reduce((sum, item) => sum + Number(item.size || 0), 0) + manifestBuffer.length;
  return {
    success: true,
    oracleBaseUrl: manifestInfo.context.oracleBaseUrl,
    pointerSource: activeSource.source,
    term: active.term,
    releaseVersion: active.releaseVersion,
    cacheEpoch: active.cacheEpoch,
    forceRefreshToken: active.forceRefreshToken,
    manifestUrl: manifestInfo.manifestUrl,
    releaseDir,
    outputRoot,
    fileCount: files.length + 1,
    manifestFileCount: files.length,
    totalSize,
    downloaded,
    verification,
    requiredIndexTypes: INDEX_TYPES,
  };
}

module.exports = {
  DEFAULT_ORACLE_BASE_URL,
  DEFAULT_OUTPUT_ROOT,
  assertSafeRelativePath,
  downloadReleaseFromOracle,
  extractActiveRelease,
  fetchOracleActivePointer,
  fetchOracleManifest,
  getManifestFiles,
  joinUrl,
  normalizeReleaseVersion,
  parseArgs,
  verifyDownloadedRelease,
};
