#!/usr/bin/env node

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const zlib = require("zlib");
const {
  buildSidecarMeta,
  calculateFingerprintFromFile,
  readSidecarHash,
} = require("../../server/src/utils/stagingFingerprint");
const {
  buildResourceCountContract,
  flattenLegacyCounts,
} = require("../../server/src/shared/resourceCountContract");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("./syncEnv");

loadSyncClientEnv();
prepareDirectNetworkEnvironment(process.env, { axios });

function parseArgs(argv) {
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
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    const hasServer = fs.existsSync(path.join(current, "server"));
    const hasMiniprogram = fs.existsSync(path.join(current, "miniprogram"));
    const hasPackage = fs.existsSync(path.join(current, "package.json"));
    const hasGit = fs.existsSync(path.join(current, ".git"));
    if ((hasServer && hasMiniprogram) || (hasPackage && hasGit)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(__dirname, "../..");
}

function resolveInputFilePath(fileArg, options = {}) {
  if (!fileArg) {
    return { resolved: null, tried: [] };
  }
  if (path.isAbsolute(fileArg)) {
    return { resolved: fileArg, tried: [fileArg] };
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const projectRoot = options.projectRoot || resolveProjectRoot(cwd);
  const normalized = path.normalize(fileArg).replace(/\\/g, "/");
  const candidates = [];

  if (normalized.startsWith("tools/fosu-sync-client/")) {
    candidates.push(path.resolve(projectRoot, fileArg));
    candidates.push(path.resolve(cwd, normalized.slice("tools/fosu-sync-client/".length)));
  } else {
    candidates.push(path.resolve(cwd, fileArg));
    candidates.push(path.resolve(projectRoot, fileArg));
    candidates.push(path.resolve(projectRoot, "tools/fosu-sync-client", fileArg));
  }

  const tried = [];
  for (const candidate of candidates) {
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    if (fs.existsSync(candidate)) {
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
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function gzipFile(inputPath, outputPath) {
  await pipeline(
    fs.createReadStream(inputPath),
    zlib.createGzip({ level: 9 }),
    fs.createWriteStream(outputPath)
  );
  return outputPath;
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

function extractJsonMetadata(filePath) {
  const head = readLeadingText(filePath);
  const pick = (key) => {
    const match = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return match ? match[1] : "";
  };
  return {
    term: pick("term") || pick("semester"),
    releaseVersion: pick("releaseVersion") || pick("version"),
    generatedAt: pick("generatedAt") || pick("updatedAt"),
  };
}

function summarizeLocalSnapshot(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const resourceCounts = buildResourceCountContract(data);
    const counts = flattenLegacyCounts(resourceCounts);
    return {
      resourceCounts,
      counts,
      totalScheduleDocuments:
        Number(resourceCounts.class.scheduleDocuments || 0) +
        Number(resourceCounts.teacher.scheduleDocuments || 0) +
        Number(resourceCounts.classroom.scheduleDocuments || 0) +
        Number(resourceCounts.course.scheduleDocuments || 0),
      actualNetworkRequestCount: data.meta && data.meta.actualNetworkRequestCount || data.actualNetworkRequestCount || 0,
      usedClassScheduleCache: Boolean(data.meta && (data.meta.usedClassScheduleCache || data.meta.cacheUsage && data.meta.cacheUsage.usedClassScheduleCache)),
      teacherQualityPass: !((resourceCounts.diagnostics || []).some((item) => item.resource === "teacher" && item.publishable === false)),
    };
  } catch (error) {
    return {
      resourceCounts: null,
      counts: {},
      totalScheduleDocuments: 0,
      actualNetworkRequestCount: 0,
      usedClassScheduleCache: false,
      teacherQualityPass: null,
      error: error.message,
    };
  }
}

function formatMb(bytes) {
  return (Number(bytes || 0) / 1024 / 1024).toFixed(2);
}

function getAuthHeaders(mode, token) {
  if (mode === "relay") {
    return {
      "x-relay-token": token,
      Authorization: `Bearer ${token}`,
    };
  }
  return {
    "x-admin-token": token,
    Authorization: `Bearer ${token}`,
  };
}

function shouldRetry(error) {
  if (!error) return false;
  if (!error.response) return true;
  const status = error.response.status;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempt) {
  return Math.min(15000, 700 * Math.pow(2, attempt - 1));
}

async function postJson(url, body, headers, timeoutMs) {
  const response = await axios.post(url, body, {
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    timeout: timeoutMs,
    proxy: false,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return response.data;
}

async function getJson(url, headers, timeoutMs) {
  const response = await axios.get(url, {
    headers: Object.assign({ Accept: "application/json" }, headers),
    timeout: timeoutMs,
    proxy: false,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
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
          "x-chunk-sha256": crypto.createHash("sha256").update(buffer).digest("hex"),
        }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
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
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeServer(value) {
  return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
}

function getSidecarMetaPath(filePath) {
  return String(filePath || "").replace(/\.json$/i, ".meta.json");
}

function isForceUpload(params = {}) {
  return params["force-upload"] === true ||
    params.forceUpload === true ||
    params.force === true ||
    String(params["force-upload"] || params.forceUpload || params.force || "").toLowerCase() === "true";
}

async function calculateLocalFingerprint(filePath) {
  const sidecarPath = getSidecarMetaPath(filePath);
  const previousHash = readSidecarHash(sidecarPath);
  const fingerprint = calculateFingerprintFromFile(filePath);
  if (!previousHash || previousHash !== fingerprint.canonicalHash || !fs.existsSync(sidecarPath)) {
    const sidecar = buildSidecarMeta(fingerprint.data, {
      fingerprint,
      previousHash,
      rawSizeBytes: fingerprint.rawSizeBytes,
    });
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
  }
  return Object.assign(fingerprint, { sidecarPath, previousHash });
}

async function checkServerFingerprint(server, headers, canonicalHash, timeoutMs) {
  const url = `${server}/api/admin/staging/fingerprint?canonicalHash=${encodeURIComponent(canonicalHash)}`;
  return getJson(url, headers, Math.min(timeoutMs, 30000));
}

async function prepareUploadFile(filePath, params) {
  const stat = fs.statSync(filePath);
  const originalSize = stat.size;
  const originalSha256 = await hashFile(filePath);
  const shouldGzip = params.gzip === true || params.gzip === "true" || params["no-gzip"] !== true;
  if (!shouldGzip) {
    return {
      uploadPath: filePath,
      contentEncoding: "identity",
      originalSize,
      originalSha256,
    };
  }

  const gzipPath = path.resolve(
    params["gzip-output"] || params.gzipOutput || `${filePath}.gz`
  );
  console.log(`gzip: ${filePath}`);
  console.log(`gzip output: ${gzipPath}`);
  await gzipFile(filePath, gzipPath);
  return {
    uploadPath: gzipPath,
    contentEncoding: "gzip",
    originalSize,
    originalSha256,
  };
}

async function uploadStagingFile(options) {
  const params = options.params || {};
  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }

  const mode = options.authMode || "admin";
  const token = options.token || "";
  if (!token) {
    throw new Error(mode === "relay" ? "missing relay token" : "missing ADMIN_API_TOKEN");
  }

  const server = normalizeServer(options.server);
  const endpointBase = mode === "relay"
    ? `${server}/api/relay/staging/upload`
    : `${server}/api/admin/staging/upload`;
  const timeoutMs = Number(params.timeout || params.timeoutMs || process.env.SYNC_UPLOAD_TIMEOUT_MS || 180000);
  const retryCount = Number(params.retries || process.env.SYNC_UPLOAD_RETRIES || 3);
  const chunkSize = toBytesMb(params["chunk-mb"] || params.chunkMb || process.env.SYNC_LOCAL_UPLOAD_CHUNK_MB, 8);
  const metadata = Object.assign({}, extractJsonMetadata(filePath), options.metadata || {});
  const localSummary = summarizeLocalSnapshot(filePath);
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
          console.log("✅ 当前采集结果与线上 active release 完全一致，无需上传。");
          console.log("如需强制上传，请追加 --force-upload。");
          return {
            success: true,
            skipped: true,
            reason: "active-release",
            canonicalHash: localFingerprint.canonicalHash,
            serverFingerprint,
          };
        }
        if (serverFingerprint.sameAsStaging) {
          console.log("✅ 服务器已存在相同 staging，无需重复上传。");
          console.log("如需强制上传，请追加 --force-upload。");
          return {
            success: true,
            skipped: true,
            reason: "staging",
            canonicalHash: localFingerprint.canonicalHash,
            serverFingerprint,
          };
        }
      } catch (error) {
        const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
        console.warn(`fingerprint precheck failed, continue upload: ${detail}`);
      }
    } else {
      console.log("⚠️ --force-upload 已启用，将忽略 active/staging 指纹相同判断。");
    }
  }

  const prepared = await prepareUploadFile(filePath, params);
  const uploadStat = fs.statSync(prepared.uploadPath);
  const uploadSha256 = await hashFile(prepared.uploadPath);
  const totalChunks = Math.ceil(uploadStat.size / chunkSize);

  console.log(`source file: ${filePath}`);
  console.log(`source size: ${formatMb(prepared.originalSize)} MB`);
  console.log(`upload file: ${prepared.uploadPath}`);
  console.log(`upload size: ${formatMb(uploadStat.size)} MB`);
  console.log(`chunk size: ${formatMb(chunkSize)} MB, chunks: ${totalChunks}`);
  console.log(`server: ${server}`);

  const initBody = {
    fileName: path.basename(filePath),
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
    canonicalHash: localFingerprint && localFingerprint.canonicalHash || "",
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
    const elapsed = Math.max(1, (Date.now() - startedAt) / 1000);
    const percent = ((uploaded / uploadStat.size) * 100).toFixed(2);
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
    environment: options.environment || metadata.environment || "",
  }, headers, timeoutMs);

  const payload = finalize.data || finalize.upload || finalize;
  const serverResourceCounts = payload.resourceCounts || payload.summary && payload.summary.resourceCounts || finalize.resourceCounts || null;
  const serverCounts = payload.counts || payload.summary && payload.summary.counts || finalize.counts || localSummary.counts || {};
  const displayResourceCounts = serverResourceCounts || localSummary.resourceCounts;
  console.log("upload finalized:");
  console.log(JSON.stringify({
    uploadId,
    stagingId: finalize.stagingId || uploadId,
    relayUploadId: payload.relayUploadId || finalize.relayUploadId,
    term: payload.term || finalize.term || metadata.term || "",
    releaseVersion: payload.releaseVersion || finalize.releaseVersion || metadata.releaseVersion || "",
    totalScheduleDocuments: payload.totalScheduleDocuments || payload.summary && payload.summary.totalScheduleDocuments || localSummary.totalScheduleDocuments,
    counts: serverCounts,
    resourceCounts: displayResourceCounts,
    status: payload.status || finalize.status || "pending-review",
  }, null, 2));
  if (displayResourceCounts) {
    const teacherDirectory = displayResourceCounts.teacher.directoryEntities == null ? "未确认" : `${displayResourceCounts.teacher.directoryEntities}人`;
    console.log("上传摘要：");
    console.log(`- 班级课表：${displayResourceCounts.class.scheduleDocuments || 0}份`);
    console.log(`- 行政班：${displayResourceCounts.class.administrativeClasses || 0}个`);
    console.log(`- 专业聚合：${displayResourceCounts.class.aggregateSchedules || 0}份`);
    console.log(`- 教师目录：${teacherDirectory}`);
    console.log(`- 教师课表：${displayResourceCounts.teacher.scheduleDocuments || 0}份`);
    console.log(`- 教师课程事件：${displayResourceCounts.teacher.courseEvents || 0}条`);
    console.log(`- 教室目录：${displayResourceCounts.classroom.directoryEntities == null ? "未统计" : `${displayResourceCounts.classroom.directoryEntities}间`}`);
    console.log(`- 教室课表：${displayResourceCounts.classroom.scheduleDocuments || 0}份`);
    console.log(`- 课程目录：${displayResourceCounts.course.directoryEntities == null ? "未统计" : `${displayResourceCounts.course.directoryEntities}门`}`);
    console.log(`- 课程课表：${displayResourceCounts.course.scheduleDocuments || 0}份`);
    console.log(`- 实际100网请求数：${localSummary.actualNetworkRequestCount || "未统计"}`);
    console.log(`- 是否读取旧动态缓存：${localSummary.usedClassScheduleCache ? "是" : "否"}`);
    console.log(`- 教师数据质量：${localSummary.teacherQualityPass === false ? "不通过" : "通过"}`);
  }
  return finalize;
}

async function runFromCli(argv = process.argv.slice(2)) {
  const params = parseArgs(argv);
  const fileArg = params.file || params.input;
  const resolved = resolveInputFilePath(fileArg || "");
  if (!resolved.resolved) {
    throw new Error([
      "Staging JSON file not found.",
      `received: ${fileArg || ""}`,
      `cwd: ${process.cwd()}`,
      `projectRoot: ${resolveProjectRoot(process.cwd())}`,
      "tried:",
      ...resolved.tried.map((item) => `  - ${item}`),
    ].join(os.EOL));
  }
  const mode = params.relay ? "relay" : "admin";
  const token = params.token || (mode === "relay" ? process.env.RELAY_TOKEN : process.env.ADMIN_API_TOKEN);
  return uploadStagingFile({
    filePath: resolved.resolved,
    server: params.server || process.env.FOSU_API_BASE || "https://class.katelya.eu.org",
    token,
    authMode: mode,
    params,
    term: params.term,
    note: params.note,
  });
}

if (require.main === module) {
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

module.exports = {
  parseArgs,
  resolveInputFilePath,
  resolveProjectRoot,
  runFromCli,
  uploadStagingFile,
};
