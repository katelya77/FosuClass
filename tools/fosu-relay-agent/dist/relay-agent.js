#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../server/src/utils/stagingFingerprint.js
var require_stagingFingerprint = __commonJS({
  "../../server/src/utils/stagingFingerprint.js"(exports2, module2) {
    var crypto = require("crypto");
    var fs2 = require("fs");
    var VOLATILE_KEYS = /* @__PURE__ */ new Set([
      "activatedAt",
      "cacheEpoch",
      "canonicalHash",
      "changed",
      "dataEpoch",
      "forceRefreshToken",
      "generatedAt",
      "hash",
      "id",
      "joinedPath",
      "jsonPath",
      "meta",
      "pack",
      "packHealth",
      "publishedAt",
      "releasePack",
      "releaseVersion",
      "size",
      "stagingUploadId",
      "updatedAt",
      "version"
    ]);
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function getResources(data) {
      const source = data && data.resources && typeof data.resources === "object" ? data.resources : {};
      return {
        teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(data && data.teacherSchedules),
        classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(data && data.classroomSchedules),
        courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(data && data.courseSchedules),
        classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(data && data.classrooms),
        teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(data && data.teachers),
        courses: asArray(source.courses).length ? asArray(source.courses) : asArray(data && data.courses)
      };
    }
    function summarizeStagingData(data) {
      const catalog = data && data.catalog && typeof data.catalog === "object" ? data.catalog : {};
      const resources = getResources(data || {});
      const classSchedules = asArray(data && (data.classSchedules || data.resources && data.resources.classSchedules));
      return {
        colleges: asArray(catalog.colleges || data && data.colleges).length,
        majors: asArray(data && data.majors).length,
        classSchedules: classSchedules.length,
        teacherSchedules: resources.teacherSchedules.length,
        classroomSchedules: resources.classroomSchedules.length,
        courseSchedules: resources.courseSchedules.length,
        classrooms: resources.classrooms.length,
        teachers: resources.teachers.length,
        courses: resources.courses.length
      };
    }
    function stableClone(value) {
      if (Array.isArray(value)) {
        return value.map(stableClone);
      }
      if (!value || typeof value !== "object") {
        return value;
      }
      const output = {};
      Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort().forEach((key) => {
        const next = stableClone(value[key]);
        if (next !== void 0) output[key] = next;
      });
      return output;
    }
    function canonicalPayload(data) {
      const source = data && typeof data === "object" ? data : {};
      return stableClone({
        schemaVersion: source.schemaVersion || "",
        term: source.term || source.semester || "",
        semester: source.semester || source.term || "",
        termStartDate: source.termStartDate || source.sourceStartDate || source.meta && source.meta.startDate || "",
        catalog: source.catalog || {},
        majors: source.majors || [],
        classSchedules: source.classSchedules || source.resources && source.resources.classSchedules || [],
        resources: getResources(source),
        timeTable: source.timeTable || {}
      });
    }
    function stableStringify(value) {
      return JSON.stringify(stableClone(value));
    }
    function sha256(text) {
      return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
    }
    function calculateFingerprint(data) {
      const canonical = canonicalPayload(data);
      const canonicalJson = JSON.stringify(canonical);
      return {
        canonicalHash: sha256(canonicalJson),
        canonicalJson,
        counts: summarizeStagingData(data)
      };
    }
    function calculateFingerprintFromFile(filePath) {
      const raw = fs2.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      const fingerprint = calculateFingerprint(data);
      return Object.assign(fingerprint, {
        data,
        rawSizeBytes: Buffer.byteLength(raw, "utf8")
      });
    }
    function buildSidecarMeta(data, options = {}) {
      const fingerprint = options.fingerprint || calculateFingerprint(data);
      const previousHash = String(options.previousHash || "").trim();
      const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
      const termConfig = data && data.termConfig && typeof data.termConfig === "object" ? data.termConfig : meta.termConfig || null;
      const termConfigHash = termConfig ? sha256(JSON.stringify(termConfig)) : "";
      return {
        term: data && (data.term || data.semester) || "",
        termConfig,
        termConfigHash,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        sourceStartDate: data && (data.termStartDate || data.sourceStartDate) || meta.startDate || "",
        includeScopes: Array.isArray(meta.includeScopes) ? meta.includeScopes : [],
        grades: meta.grades || data && data.grades || "",
        counts: fingerprint.counts || summarizeStagingData(data),
        rawSizeBytes: Number(options.rawSizeBytes || 0) || 0,
        canonicalHash: fingerprint.canonicalHash,
        previousHash,
        changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
        crawlMode: meta.crawlMode || "",
        usedProgressCache: Boolean(meta.usedProgressCache),
        usedNoScheduleCache: Boolean(meta.usedNoScheduleCache),
        usedClassScheduleCache: Boolean(meta.usedClassScheduleCache),
        actualNetworkRequestCount: Number(meta.actualNetworkRequestCount || 0),
        skippedByProgressCount: Number(meta.skippedByProgressCount || 0),
        skippedByNoScheduleCount: Number(meta.skippedByNoScheduleCount || 0),
        freshRunId: meta.freshRunId || "",
        resourceSource: meta.resourceSource || ""
      };
    }
    function readSidecarHash(filePath) {
      try {
        if (!filePath || !fs2.existsSync(filePath)) return "";
        const parsed = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        return String(parsed && parsed.canonicalHash || "").trim();
      } catch (error) {
        return "";
      }
    }
    module2.exports = {
      buildSidecarMeta,
      calculateFingerprint,
      calculateFingerprintFromFile,
      canonicalPayload,
      readSidecarHash,
      stableStringify,
      summarizeStagingData
    };
  }
});

// ../fosu-sync-client/upload.js
var require_upload = __commonJS({
  "../fosu-sync-client/upload.js"(exports2, module2) {
    var axios = require("axios");
    var crypto = require("crypto");
    var fs2 = require("fs");
    var os2 = require("os");
    var path2 = require("path");
    var { pipeline } = require("stream/promises");
    var zlib = require("zlib");
    var {
      buildSidecarMeta,
      calculateFingerprintFromFile,
      readSidecarHash
    } = require_stagingFingerprint();
    function parseArgs2(argv) {
      const args = {};
      for (const arg of argv) {
        if (!arg.startsWith("--")) continue;
        const match = arg.match(/^--([^=]+)=(.*)$/);
        if (match) {
          args[match[1]] = match[2];
        } else {
          args[arg.slice(2)] = true;
        }
      }
      return args;
    }
    function resolveProjectRoot(startDir) {
      let current = path2.resolve(startDir || process.cwd());
      while (true) {
        const hasServer = fs2.existsSync(path2.join(current, "server"));
        const hasMiniprogram = fs2.existsSync(path2.join(current, "miniprogram"));
        const hasPackage = fs2.existsSync(path2.join(current, "package.json"));
        const hasGit = fs2.existsSync(path2.join(current, ".git"));
        if (hasServer && hasMiniprogram || hasPackage && hasGit) {
          return current;
        }
        const parent = path2.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return path2.resolve(__dirname, "../..");
    }
    function resolveInputFilePath2(fileArg, options = {}) {
      if (!fileArg) {
        return { resolved: null, tried: [] };
      }
      if (path2.isAbsolute(fileArg)) {
        return { resolved: fileArg, tried: [fileArg] };
      }
      const cwd = path2.resolve(options.cwd || process.cwd());
      const projectRoot = options.projectRoot || resolveProjectRoot(cwd);
      const normalized = path2.normalize(fileArg).replace(/\\/g, "/");
      const candidates = [];
      if (normalized.startsWith("tools/fosu-sync-client/")) {
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(cwd, normalized.slice("tools/fosu-sync-client/".length)));
      } else {
        candidates.push(path2.resolve(cwd, fileArg));
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(projectRoot, "tools/fosu-sync-client", fileArg));
      }
      const tried = [];
      for (const candidate of candidates) {
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        if (fs2.existsSync(candidate)) {
          return { resolved: candidate, tried };
        }
      }
      return { resolved: null, tried };
    }
    function toBytesMb(value, fallbackMb) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return fallbackMb * 1024 * 1024;
      }
      return Math.floor(num * 1024 * 1024);
    }
    function hashFile(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs2.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
      });
    }
    async function gzipFile(inputPath, outputPath) {
      await pipeline(
        fs2.createReadStream(inputPath),
        zlib.createGzip({ level: 9 }),
        fs2.createWriteStream(outputPath)
      );
      return outputPath;
    }
    function readLeadingText2(filePath, maxBytes = 4 * 1024 * 1024) {
      const stat = fs2.statSync(filePath);
      const length = Math.min(stat.size, maxBytes);
      const fd = fs2.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(length);
        fs2.readSync(fd, buffer, 0, length, 0);
        return buffer.toString("utf-8");
      } finally {
        fs2.closeSync(fd);
      }
    }
    function extractJsonMetadata(filePath) {
      const head = readLeadingText2(filePath);
      const pick = (key) => {
        const match = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        return match ? match[1] : "";
      };
      return {
        term: pick("term") || pick("semester"),
        releaseVersion: pick("releaseVersion") || pick("version"),
        generatedAt: pick("generatedAt") || pick("updatedAt")
      };
    }
    function formatMb(bytes) {
      return (Number(bytes || 0) / 1024 / 1024).toFixed(2);
    }
    function getAuthHeaders(mode, token) {
      if (mode === "relay") {
        return {
          "x-relay-token": token,
          Authorization: `Bearer ${token}`
        };
      }
      return {
        "x-admin-token": token,
        Authorization: `Bearer ${token}`
      };
    }
    function shouldRetry(error) {
      if (!error) return false;
      if (!error.response) return true;
      const status = error.response.status;
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }
    function retryDelayMs(attempt) {
      return Math.min(15e3, 700 * Math.pow(2, attempt - 1));
    }
    async function postJson(url, body, headers, timeoutMs) {
      const response = await axios.post(url, body, {
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return response.data;
    }
    async function getJson(url, headers, timeoutMs) {
      const response = await axios.get(url, {
        headers: Object.assign({ Accept: "application/json" }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return response.data;
    }
    async function uploadChunkWithRetry(url, buffer, headers, timeoutMs, attemptCount) {
      let lastError;
      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        try {
          const response = await axios.post(url, buffer, {
            headers: Object.assign({
              "Content-Type": "application/octet-stream",
              "Content-Length": buffer.length,
              "x-chunk-sha256": crypto.createHash("sha256").update(buffer).digest("hex")
            }, headers),
            timeout: timeoutMs,
            proxy: false,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });
          return response.data;
        } catch (error) {
          lastError = error;
          const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
          console.warn(`chunk upload failed (${attempt}/${attemptCount}): ${detail}`);
          if (!shouldRetry(error) || attempt >= attemptCount) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        }
      }
      throw lastError;
    }
    function readChunk(filePath, start, endInclusive) {
      const length = endInclusive - start + 1;
      const buffer = Buffer.allocUnsafe(length);
      const fd = fs2.openSync(filePath, "r");
      try {
        fs2.readSync(fd, buffer, 0, length, start);
        return buffer;
      } finally {
        fs2.closeSync(fd);
      }
    }
    function normalizeServer2(value) {
      return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
    }
    function getSidecarMetaPath(filePath) {
      return String(filePath || "").replace(/\.json$/i, ".meta.json");
    }
    function isForceUpload(params = {}) {
      return params["force-upload"] === true || params.forceUpload === true || params.force === true || String(params["force-upload"] || params.forceUpload || params.force || "").toLowerCase() === "true";
    }
    async function calculateLocalFingerprint(filePath) {
      const sidecarPath = getSidecarMetaPath(filePath);
      const previousHash = readSidecarHash(sidecarPath);
      const fingerprint = calculateFingerprintFromFile(filePath);
      if (!previousHash || previousHash !== fingerprint.canonicalHash || !fs2.existsSync(sidecarPath)) {
        const sidecar = buildSidecarMeta(fingerprint.data, {
          fingerprint,
          previousHash,
          rawSizeBytes: fingerprint.rawSizeBytes
        });
        fs2.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
      }
      return Object.assign(fingerprint, { sidecarPath, previousHash });
    }
    async function checkServerFingerprint(server, headers, canonicalHash, timeoutMs) {
      const url = `${server}/api/admin/staging/fingerprint?canonicalHash=${encodeURIComponent(canonicalHash)}`;
      return getJson(url, headers, Math.min(timeoutMs, 3e4));
    }
    async function prepareUploadFile(filePath, params) {
      const stat = fs2.statSync(filePath);
      const originalSize = stat.size;
      const originalSha256 = await hashFile(filePath);
      const shouldGzip = params.gzip === true || params.gzip === "true" || params["no-gzip"] !== true;
      if (!shouldGzip) {
        return {
          uploadPath: filePath,
          contentEncoding: "identity",
          originalSize,
          originalSha256
        };
      }
      const gzipPath = path2.resolve(
        params["gzip-output"] || params.gzipOutput || `${filePath}.gz`
      );
      console.log(`gzip: ${filePath}`);
      console.log(`gzip output: ${gzipPath}`);
      await gzipFile(filePath, gzipPath);
      return {
        uploadPath: gzipPath,
        contentEncoding: "gzip",
        originalSize,
        originalSha256
      };
    }
    async function uploadStagingFile2(options) {
      const params = options.params || {};
      const filePath = path2.resolve(options.filePath);
      if (!fs2.existsSync(filePath)) {
        throw new Error(`file not found: ${filePath}`);
      }
      const mode = options.authMode || "admin";
      const token = options.token || "";
      if (!token) {
        throw new Error(mode === "relay" ? "missing relay token" : "missing ADMIN_API_TOKEN");
      }
      const server = normalizeServer2(options.server);
      const endpointBase = mode === "relay" ? `${server}/api/relay/staging/upload` : `${server}/api/admin/staging/upload`;
      const timeoutMs = Number(params.timeout || params.timeoutMs || process.env.SYNC_UPLOAD_TIMEOUT_MS || 18e4);
      const retryCount = Number(params.retries || process.env.SYNC_UPLOAD_RETRIES || 3);
      const chunkSize = toBytesMb(params["chunk-mb"] || params.chunkMb || process.env.SYNC_LOCAL_UPLOAD_CHUNK_MB, 8);
      const metadata = Object.assign({}, extractJsonMetadata(filePath), options.metadata || {});
      const headers = getAuthHeaders(mode, token);
      let localFingerprint = null;
      if (mode === "admin") {
        localFingerprint = await calculateLocalFingerprint(filePath);
        console.log(`canonicalHash: ${localFingerprint.canonicalHash}`);
        console.log(`sidecar meta: ${localFingerprint.sidecarPath}`);
        if (!isForceUpload(params)) {
          try {
            const serverFingerprint = await checkServerFingerprint(server, headers, localFingerprint.canonicalHash, timeoutMs);
            if (serverFingerprint.sameAsActive) {
              console.log("\u2705 \u5F53\u524D\u91C7\u96C6\u7ED3\u679C\u4E0E\u7EBF\u4E0A active release \u5B8C\u5168\u4E00\u81F4\uFF0C\u65E0\u9700\u4E0A\u4F20\u3002");
              console.log("\u5982\u9700\u5F3A\u5236\u4E0A\u4F20\uFF0C\u8BF7\u8FFD\u52A0 --force-upload\u3002");
              return {
                success: true,
                skipped: true,
                reason: "active-release",
                canonicalHash: localFingerprint.canonicalHash,
                serverFingerprint
              };
            }
            if (serverFingerprint.sameAsStaging) {
              console.log("\u2705 \u670D\u52A1\u5668\u5DF2\u5B58\u5728\u76F8\u540C staging\uFF0C\u65E0\u9700\u91CD\u590D\u4E0A\u4F20\u3002");
              console.log("\u5982\u9700\u5F3A\u5236\u4E0A\u4F20\uFF0C\u8BF7\u8FFD\u52A0 --force-upload\u3002");
              return {
                success: true,
                skipped: true,
                reason: "staging",
                canonicalHash: localFingerprint.canonicalHash,
                serverFingerprint
              };
            }
          } catch (error) {
            const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
            console.warn(`fingerprint precheck failed, continue upload: ${detail}`);
          }
        } else {
          console.log("\u26A0\uFE0F --force-upload \u5DF2\u542F\u7528\uFF0C\u5C06\u5FFD\u7565 active/staging \u6307\u7EB9\u76F8\u540C\u5224\u65AD\u3002");
        }
      }
      const prepared = await prepareUploadFile(filePath, params);
      const uploadStat = fs2.statSync(prepared.uploadPath);
      const uploadSha256 = await hashFile(prepared.uploadPath);
      const totalChunks = Math.ceil(uploadStat.size / chunkSize);
      console.log(`source file: ${filePath}`);
      console.log(`source size: ${formatMb(prepared.originalSize)} MB`);
      console.log(`upload file: ${prepared.uploadPath}`);
      console.log(`upload size: ${formatMb(uploadStat.size)} MB`);
      console.log(`chunk size: ${formatMb(chunkSize)} MB, chunks: ${totalChunks}`);
      console.log(`server: ${server}`);
      const initBody = {
        fileName: path2.basename(filePath),
        term: metadata.term || options.term || "",
        releaseVersion: metadata.releaseVersion || "",
        note: options.note || params.note || "",
        source: options.source || (mode === "relay" ? "relay-agent" : "local-upload-cli"),
        contentEncoding: prepared.contentEncoding,
        contentType: "application/json",
        chunkSize,
        totalChunks,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256,
        canonicalHash: localFingerprint && localFingerprint.canonicalHash || ""
      };
      const init = await postJson(`${endpointBase}/init`, initBody, headers, timeoutMs);
      const uploadId = init.uploadId || init.upload?.uploadId;
      if (!uploadId) {
        throw new Error(`init response missing uploadId: ${JSON.stringify(init)}`);
      }
      const startedAt = Date.now();
      let uploaded = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(uploadStat.size - 1, start + chunkSize - 1);
        const buffer = readChunk(prepared.uploadPath, start, end);
        const chunkUrl = `${endpointBase}/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`;
        await uploadChunkWithRetry(chunkUrl, buffer, headers, timeoutMs, retryCount);
        uploaded += buffer.length;
        const elapsed = Math.max(1, (Date.now() - startedAt) / 1e3);
        const percent = (uploaded / uploadStat.size * 100).toFixed(2);
        const speed = formatMb(uploaded / elapsed);
        console.log(`[${chunkIndex + 1}/${totalChunks}] ${percent}% ${formatMb(uploaded)}/${formatMb(uploadStat.size)} MB, ${speed} MB/s`);
      }
      const finalize = await postJson(`${endpointBase}/finalize`, {
        uploadId,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256,
        canonicalHash: localFingerprint && localFingerprint.canonicalHash || "",
        totalChunks,
        note: options.note || params.note || "",
        uploaderNote: options.note || params.note || "",
        environment: options.environment || metadata.environment || ""
      }, headers, timeoutMs);
      const payload = finalize.data || finalize.upload || finalize;
      console.log("upload finalized:");
      console.log(JSON.stringify({
        uploadId,
        stagingId: finalize.stagingId || uploadId,
        relayUploadId: payload.relayUploadId || finalize.relayUploadId,
        term: payload.term || finalize.term || metadata.term || "",
        releaseVersion: payload.releaseVersion || finalize.releaseVersion || metadata.releaseVersion || "",
        counts: payload.counts || payload.summary || finalize.counts || {},
        status: payload.status || finalize.status || "pending-review"
      }, null, 2));
      return finalize;
    }
    async function runFromCli(argv = process.argv.slice(2)) {
      const params = parseArgs2(argv);
      const fileArg = params.file || params.input;
      const resolved = resolveInputFilePath2(fileArg || "");
      if (!resolved.resolved) {
        throw new Error([
          "Staging JSON file not found.",
          `received: ${fileArg || ""}`,
          `cwd: ${process.cwd()}`,
          `projectRoot: ${resolveProjectRoot(process.cwd())}`,
          "tried:",
          ...resolved.tried.map((item) => `  - ${item}`)
        ].join(os2.EOL));
      }
      const mode = params.relay ? "relay" : "admin";
      const token = params.token || (mode === "relay" ? process.env.RELAY_TOKEN : process.env.ADMIN_API_TOKEN);
      return uploadStagingFile2({
        filePath: resolved.resolved,
        server: params.server || process.env.FOSU_API_BASE || "https://class.katelya.eu.org",
        token,
        authMode: mode,
        params,
        term: params.term,
        note: params.note
      });
    }
    if (require.main === module2) {
      runFromCli().catch((error) => {
        const response = error.response;
        if (response) {
          console.error(`upload failed: HTTP ${response.status}`);
          console.error(JSON.stringify(response.data || {}, null, 2));
        } else {
          console.error(`upload failed: ${error.stack || error.message}`);
        }
        process.exit(1);
      });
    }
    module2.exports = {
      parseArgs: parseArgs2,
      resolveInputFilePath: resolveInputFilePath2,
      resolveProjectRoot,
      runFromCli,
      uploadStagingFile: uploadStagingFile2
    };
  }
});

// relay-agent.js
var fs = require("fs");
var os = require("os");
var path = require("path");
var readline = require("readline/promises");
var {
  resolveInputFilePath,
  uploadStagingFile
} = require_upload();
var SECRET_KEY_PATTERN = /(studentId|student_id|password|passwd|pwd|cookie|ticket|execution|session|token|authorization|jsessionid|captcha)/i;
function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    } else {
      args[arg.slice(2)] = true;
    }
  });
  return args;
}
function normalizeServer(value) {
  return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
}
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8e3);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}
async function checkUrl(label, url) {
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", timeoutMs: 8e3 });
    return {
      label,
      ok: res.status > 0 && res.status < 500,
      status: res.status,
      duration: Date.now() - startedAt
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      duration: Date.now() - startedAt,
      error: error.message
    };
  }
}
async function loadTask(server, token) {
  const res = await fetchWithTimeout(`${server}/api/relay/tasks/${encodeURIComponent(token)}`, {
    timeoutMs: 12e3
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || `\u63A5\u529B\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25: HTTP ${res.status}`);
  }
  return data.task;
}
function readLeadingText(filePath, maxBytes = 4 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}
function pickJsonString(head, key) {
  const match = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1] : "";
}
function pickJsonNumber(head, key) {
  const match = head.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}
function extractSummary(filePath) {
  const head = readLeadingText(filePath);
  return {
    term: pickJsonString(head, "term") || pickJsonString(head, "semester"),
    releaseVersion: pickJsonString(head, "releaseVersion") || pickJsonString(head, "version"),
    generatedAt: pickJsonString(head, "generatedAt") || pickJsonString(head, "updatedAt"),
    classScheduleCount: pickJsonNumber(head, "classScheduleCount"),
    teacherScheduleCount: pickJsonNumber(head, "teacherScheduleCount"),
    classroomScheduleCount: pickJsonNumber(head, "classroomScheduleCount"),
    courseScheduleCount: pickJsonNumber(head, "courseScheduleCount"),
    teacherCount: pickJsonNumber(head, "teacherCount"),
    classroomCount: pickJsonNumber(head, "classroomCount"),
    courseCount: pickJsonNumber(head, "courseCount")
  };
}
function scanFileForSensitiveData(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let carry = "";
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = carry + buffer.subarray(0, bytesRead).toString("utf-8");
      if (SECRET_KEY_PATTERN.test(chunk) || /(JSESSIONID|CASTGC|password=|passwd=|ticket=|execution=|Authorization:|Bearer\s+[A-Za-z0-9._-]+)/i.test(chunk)) {
        return true;
      }
      carry = chunk.slice(-200);
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}
function resolveStagingJson(args, task) {
  const fileArg = args.file || args.input || path.join("staging", `${args.term || task.term}-full.json`);
  const resolved = resolveInputFilePath(fileArg, { cwd: process.cwd() });
  const filePath = resolved.resolved || path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    const tried = resolved.tried && resolved.tried.length ? `
\u5C1D\u8BD5\u8DEF\u5F84\uFF1A
${resolved.tried.map((item) => `- ${item}`).join("\n")}` : "";
    throw new Error(`\u672A\u627E\u5230 Staging JSON: ${filePath}
\u8BF7\u5148\u5728\u6821\u56ED\u7F51\u7535\u8111\u751F\u6210\u6587\u4EF6\uFF0C\u6216\u4F7F\u7528 --file=\u8DEF\u5F84 \u6307\u5B9A\u3002${tried}`);
  }
  if (scanFileForSensitiveData(filePath)) {
    throw new Error("Staging JSON \u4E2D\u5305\u542B\u7591\u4F3C\u5BC6\u7801\u3001Cookie\u3001ticket\u3001session \u6216 token \u5B57\u6BB5\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002");
  }
  return { filePath, summary: extractSummary(filePath) };
}
function resolveToolScript(scriptName) {
  const candidates = [
    path.resolve(process.cwd(), scriptName),
    path.resolve(__dirname, scriptName),
    path.resolve(__dirname, "..", "fosu-sync-client", scriptName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`\u672A\u627E\u5230\u63A5\u529B\u91C7\u96C6\u811A\u672C ${scriptName}\uFF0C\u8BF7\u91CD\u65B0\u4E0B\u8F7D\u5B8C\u6574\u63A5\u529B\u5DE5\u5177\u5305\u3002`);
}
async function confirmUpload(args, summary) {
  if (args.yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n\u5C06\u8981\u4E0A\u4F20\u7684\u6570\u636E\u6458\u8981\uFF1A");
    console.log(`- \u5B66\u671F: ${summary.term || "-"}`);
    console.log(`- \u884C\u653F\u73ED\u8BFE\u8868: ${summary.classScheduleCount}`);
    console.log(`- \u6559\u5E08\u8BFE\u8868: ${summary.teacherScheduleCount}`);
    console.log(`- \u6559\u5BA4\u8BFE\u8868: ${summary.classroomScheduleCount}`);
    console.log(`- \u8BFE\u7A0B\u8BFE\u8868: ${summary.courseScheduleCount}`);
    console.log(`- \u6559\u5E08\u6570: ${summary.teacherCount}`);
    console.log(`- \u6559\u5BA4\u6570: ${summary.classroomCount}`);
    console.log(`- \u8BFE\u7A0B\u6570: ${summary.courseCount}`);
    console.log(`- \u751F\u6210\u65F6\u95F4: ${summary.generatedAt || "-"}`);
    const answer = await rl.question("\n\u786E\u8BA4\u4E0A\u4F20\u8BFE\u7A0B\u8868\u516C\u5F00\u6570\u636E\u4E14\u4E0D\u5305\u542B\u4E2A\u4EBA\u5BC6\u7801\uFF1F\u8F93\u5165 yes \u7EE7\u7EED: ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
async function upload(server, token, args, filePath, task) {
  const environment = [
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `hostname=${os.hostname()}`,
    `node=${process.version}`
  ].join("; ");
  return uploadStagingFile({
    filePath,
    server,
    token,
    authMode: "relay",
    params: args,
    term: task.term,
    note: args.note || "",
    environment,
    source: "relay-agent",
    metadata: { term: task.term, environment }
  });
}
function cleanupSession() {
  try {
    const paths = [
      path.resolve(process.cwd(), ".session", "session.json"),
      path.resolve(__dirname, ".session", "session.json")
    ];
    paths.forEach((p) => {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    });
    console.log("\u{1F9F9} \u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\u5DF2\u5B89\u5168\u6E05\u7406\u3002");
  } catch (e) {
    console.warn("\u26A0\uFE0F \u6E05\u7406\u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\u5931\u8D25: " + e.message);
  }
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  let config = {};
  const configPath = path.resolve(process.cwd(), "config.json");
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
    }
  }
  let token = args.token || config.token;
  let server = args.server || config.server || "https://class.katelya.eu.org";
  if (!token) {
    console.log("\u4F5B\u8BFE\u5C0F\u8868\u63A5\u529B\u91C7\u96C6\u5668 - \u521D\u59CB\u5316\u914D\u7F6E");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const serverInput = await rl.question("\u8BF7\u8F93\u5165/\u786E\u8BA4\u540E\u53F0\u670D\u52A1\u5668 URL (\u9ED8\u8BA4 https://class.katelya.eu.org): ");
      if (serverInput.trim()) {
        server = serverInput.trim();
      }
      const tokenInput = await rl.question("\u8BF7\u8F93\u5165\u60A8\u7684\u63A5\u529B Token (\u5FC5\u586B): ");
      token = tokenInput.trim();
      if (!token) {
        console.error("\u274C \u5FC5\u987B\u8F93\u5165\u63A5\u529B Token \u624D\u80FD\u7EE7\u7EED\u8FD0\u884C\u3002");
        process.exit(1);
      }
      fs.writeFileSync(configPath, JSON.stringify({ server, token }, null, 2), "utf-8");
      console.log(`\u2705 \u63A5\u529B\u914D\u7F6E\u5DF2\u4FDD\u5B58\u5230 config.json`);
    } finally {
      rl.close();
    }
  }
  server = normalizeServer(server);
  token = String(token);
  console.log("\n\u4F5B\u8BFE\u5C0F\u8868\u63A5\u529B\u91C7\u96C6\u5668");
  console.log(`\u670D\u52A1\u5668\uFF1A${server}`);
  const task = await loadTask(server, token);
  console.log(`\u5F53\u524D\u4EFB\u52A1\uFF1A${task.term} ${task.description || "\u5168\u6821\u8BFE\u8868\u91C7\u96C6"}`);
  console.log(`\u4EFB\u52A1\u6709\u6548\u671F\uFF1A${task.expiresAt}`);
  console.log("\n\u7F51\u7EDC\u68C0\u6D4B\uFF1A");
  const checks = await Promise.all([
    checkUrl("100.fosu.edu.cn", "https://100.fosu.edu.cn"),
    checkUrl("authserver.fosu.edu.cn", "https://authserver.fosu.edu.cn"),
    checkUrl(new URL(server).hostname, `${server}/api/health`)
  ]);
  checks.forEach((item) => {
    console.log(`- ${item.label}: ${item.ok ? "\u53EF\u8BBF\u95EE" : "\u4E0D\u53EF\u8BBF\u95EE"} (${item.status || item.error || "no response"}, ${item.duration}ms)`);
  });
  if (!checks[0].ok || !checks[1].ok) {
    console.log("\n\u26A0\uFE0F \u8B66\u544A\uFF1A\u65E0\u6CD5\u6B63\u5E38\u8BBF\u95EE\u5B66\u6821\u6559\u52A1\u7F51\uFF0C\u8BF7\u786E\u4FDD\u60A8\u5F53\u524D\u5DF2\u8FDE\u63A5\u4F5B\u5927\u6821\u56ED\u7F51\u6216\u5DF2\u542F\u52A8\u5B66\u6821 VPN \u62E8\u53F7\u3002");
  }
  console.log("\n================ [\u6B65\u9AA4 1\uFF1A\u767B\u5F55\u6559\u52A1\u7CFB\u7EDF] ================");
  console.log("\u5373\u5C06\u4E3A\u60A8\u542F\u52A8\u7CFB\u7EDF\u6D4F\u89C8\u5668\u767B\u5F55\u6559\u52A1\u7CFB\u7EDF\uFF0C\u8BF7\u5728\u5F39\u51FA\u7684\u6D4F\u89C8\u5668\u4E2D\u624B\u52A8\u767B\u5F55\u3002");
  const child_process = require("child_process");
  try {
    const loginScript = resolveToolScript("login.js");
    child_process.execFileSync(process.execPath, [loginScript], {
      cwd: path.dirname(loginScript),
      stdio: "inherit"
    });
    console.log("\u2713 \u767B\u5F55\u6210\u529F\u5E76\u5DF2\u4FDD\u5B58\u672C\u5730\u4F1A\u8BDD\u3002");
  } catch (err) {
    console.error("\n\u274C \u767B\u5F55\u6559\u52A1\u7CFB\u7EDF\u5931\u8D25\uFF1A" + err.message);
    cleanupSession();
    process.exit(1);
  }
  console.log("\n================ [\u6B65\u9AA4 2\uFF1A\u6293\u53D6\u5168\u6821\u8BFE\u8868\u6570\u636E] ================");
  console.log(`\u5F00\u59CB\u6293\u53D6\u5168\u6821\u8BFE\u7A0B\u6570\u636E\uFF08\u5B66\u671F\uFF1A${task.term}\uFF09\uFF0C\u6B64\u8FC7\u7A0B\u7EA6\u9700\u8981 10 \u5206\u949F\u3002\u671F\u95F4\u8BF7\u4E0D\u8981\u5173\u95ED\u6D4F\u89C8\u5668\u7A97\u53E3\u3002`);
  try {
    const syncScript = resolveToolScript("sync.js");
    const syncArgs = [syncScript, "local-campus", `--term=${task.term}`];
    if (task.termConfig && task.termConfig.termStartDate) {
      syncArgs.push(`--term-start-date=${task.termConfig.termStartDate}`);
    }
    if (task.termConfig && task.termConfig.totalWeeks) {
      syncArgs.push(`--total-weeks=${task.termConfig.totalWeeks}`);
    }
    if (task.termConfig && task.termConfig.weekStart) {
      syncArgs.push(`--week-start=${task.termConfig.weekStart}`);
    }
    const childEnv = Object.assign({}, process.env, {
      FOSU_RELAY_TERM_CONFIG: JSON.stringify(task.termConfig || {})
    });
    child_process.execFileSync(process.execPath, syncArgs, {
      cwd: path.dirname(syncScript),
      env: childEnv,
      stdio: "inherit"
    });
    console.log("\u2713 \u5168\u6821\u8BFE\u8868\u6570\u636E\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5DF2\u751F\u6210\u672C\u5730 Staging JSON\u3002");
  } catch (err) {
    console.error("\n\u274C \u6293\u53D6\u5168\u6821\u8BFE\u8868\u5931\u8D25\uFF1A" + err.message);
    cleanupSession();
    process.exit(1);
  }
  const { filePath, summary } = resolveStagingJson(args, task);
  console.log(`
\u5DF2\u8BFB\u53D6 Staging JSON\uFF1A${filePath}`);
  const confirmed = await confirmUpload(args, summary);
  if (!confirmed) {
    console.log("\u5DF2\u53D6\u6D88\u4E0A\u4F20\u3002");
    cleanupSession();
    return;
  }
  const result = await upload(server, token, args, filePath, task);
  console.log("\n\u5DF2\u6210\u529F\u4E0A\u4F20\u63A5\u529B Staging JSON\uFF0C\u7B49\u5F85\u7BA1\u7406\u5458\u5BA1\u6838\u53D1\u5E03\u3002");
  console.log(`\u4E0A\u4F20\u7F16\u53F7\uFF1A${result.upload && result.upload.id ? result.upload.id : "-"}`);
  cleanupSession();
}
main().catch((error) => {
  console.error(`
\u63A5\u529B\u91C7\u96C6\u5668\u6267\u884C\u5931\u8D25\uFF1A${error.message}`);
  cleanupSession();
  process.exit(1);
});
