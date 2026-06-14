const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const releaseService = require("../../server/src/services/releaseService");
const runtimePointerService = require("../../server/src/services/runtimePointerService");

const ENV_ID = cloudbaseConfig.ENV_ID;
const DEFAULT_KEEP_LATEST = 3;
const INDEX_TYPES = ["class", "teacher", "classroom", "course"];

const TEXT_SCAN_EXTENSIONS = new Set([".json", ".txt", ".md", ".csv", ".tsv"]);
const BLOCKED_BINARY_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm", ".har"]);

const PRIVACY_RULES = [
  { name: "password", pattern: /["']?(?:password|passwd|pwd|密码|口令)["']?\s*[:：=]\s*["']?[^"',\s，。；;]{3,}/i },
  { name: "authorization", pattern: /["']?(?:authorization|bearer)["']?\s*[:：=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i },
  { name: "cookie", pattern: /["']?(?:cookie|set-cookie)["']?\s*[:：=]\s*["']?[^"',\s，。；;]{6,}/i },
  { name: "jsessionid", pattern: /["']?JSESSIONID["']?\s*[:：=]\s*["']?[A-Za-z0-9._-]{6,}/i },
  { name: "api-key", pattern: /(?:["']?(?:api[-_\s]?key|secret(?:id|key)?|access[-_\s]?token)["']?\s*[:：=]\s*["']?[A-Za-z0-9._~+/=-]{8,}|(?:^|[^A-Za-z0-9_])["']?token["']?\s*[:：=]\s*["']?[A-Za-z0-9._~+/=-]{8,})/i },
  { name: "student-id", pattern: /["']?(?:学号|student(?:id|_id|number)?|xh)["']?\s*[:：=]\s*["']?\d{6,16}/i },
  { name: "id-card", pattern: /\b\d{17}[\dXx]\b/ },
  { name: "phone", pattern: /\b1[3-9]\d{9}\b/ },
  { name: "student-name-list", pattern: /"(?:studentName|studentNames|studentList|students)"\s*:/i },
  { name: "admin-info", pattern: /(?:admin(?:Password|Token|ApiToken|Secret)|管理员信息)\s*[:：=]/i },
];

function parseArgs(argv) {
  const args = {};
  (argv || []).forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      args[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
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

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sha1(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function listFiles(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const result = [];
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push.apply(result, listFiles(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  });
  return result;
}

function fileMeta(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return { size: buffer.length, hash: sha1(buffer) };
}

function getPublicReleaseRoot(options = {}) {
  return path.resolve(options.publicRoot || process.env.RELEASE_PACK_SRC || releaseService.PUBLIC_RELEASES_DIR);
}

function getReleaseDir(releaseVersion, options = {}) {
  return path.join(getPublicReleaseRoot(options), String(releaseVersion || ""));
}

function collectPrivacyFindings(rootDir) {
  const findings = [];
  listFiles(rootDir).forEach((filePath) => {
    const relativePath = toPosixPath(path.relative(rootDir, filePath));
    const ext = path.extname(filePath).toLowerCase();
    if (BLOCKED_BINARY_EXTENSIONS.has(ext)) {
      findings.push({ file: relativePath, rule: "raw-upload-file", sample: ext });
      return;
    }
    if (!TEXT_SCAN_EXTENSIONS.has(ext)) return;
    const text = fs.readFileSync(filePath, "utf8");
    PRIVACY_RULES.forEach((rule) => {
      const match = text.match(rule.pattern);
      if (match) {
        findings.push({
          file: relativePath,
          rule: rule.name,
          sample: String(match[0] || "").slice(0, 120),
        });
      }
    });
  });
  return findings;
}

function scanPrivacy(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const findings = collectPrivacyFindings(resolvedRoot);
  if (findings.length) {
    const error = new Error(`CloudBase public Release Pack privacy scan failed: ${findings.map((item) => `${item.file}:${item.rule}`).join("; ")}`);
    error.code = "CLOUDBASE_PRIVACY_SCAN_FAILED";
    error.findings = findings;
    throw error;
  }
  return { success: true, rootDir: resolvedRoot, findings: [] };
}

function assertJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    const error = new Error(`${label} missing: ${filePath}`);
    error.code = "CLOUDBASE_RELEASE_FILE_MISSING";
    throw error;
  }
  try {
    return readJson(filePath);
  } catch (error) {
    error.code = "CLOUDBASE_RELEASE_JSON_INVALID";
    error.filePath = filePath;
    throw error;
  }
}

function resolveIndexPath(releaseDir, type) {
  const modern = path.join(releaseDir, "index", type, "all.json");
  if (fs.existsSync(modern)) return modern;
  return path.join(releaseDir, "index", `${type}.json`);
}

function getIndexItems(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload && payload.items) ? payload.items : []);
}

function getItemId(item) {
  return item && (item.id || item.detailId || item.classId || item.teacherId || item.classroomId || item.courseId || item.name || item.className || item.teacherName || item.roomName || item.courseName) || "";
}

function resolveSampleDetailPath(releaseDir, type, indexPayload) {
  const detailDir = path.join(releaseDir, "detail", type);
  const firstItem = getIndexItems(indexPayload)[0] || {};
  const id = getItemId(firstItem);
  if (id) {
    const encoded = `${encodeURIComponent(String(id))}.json`;
    const direct = path.join(detailDir, encoded);
    if (fs.existsSync(direct)) return direct;
  }
  const candidates = listFiles(detailDir).filter((filePath) => path.extname(filePath).toLowerCase() === ".json");
  return candidates[0] || path.join(detailDir, id ? `${encodeURIComponent(String(id))}.json` : "__missing__.json");
}

function verifyManifestFileMeta(releaseDir, manifest) {
  const files = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  const checked = [];
  Object.keys(files).forEach((relativePath) => {
    const expected = files[relativePath] || {};
    const absolutePath = path.join(releaseDir, relativePath);
    const actual = fileMeta(absolutePath);
    if (!actual) {
      const error = new Error(`manifest file missing: ${relativePath}`);
      error.code = "CLOUDBASE_RELEASE_FILE_MISSING";
      throw error;
    }
    if (expected.hash && expected.hash !== actual.hash) {
      const error = new Error(`manifest hash mismatch: ${relativePath}`);
      error.code = "CLOUDBASE_RELEASE_HASH_MISMATCH";
      throw error;
    }
    if (expected.size && Number(expected.size) !== Number(actual.size)) {
      const error = new Error(`manifest size mismatch: ${relativePath}`);
      error.code = "CLOUDBASE_RELEASE_SIZE_MISMATCH";
      throw error;
    }
    checked.push(relativePath);
  });
  return checked;
}

function verifyLocalReleasePack(options = {}) {
  const releaseVersion = String(options.releaseVersion || "").trim();
  if (!releaseVersion) {
    const error = new Error("releaseVersion is required");
    error.code = "CLOUDBASE_RELEASE_VERSION_REQUIRED";
    throw error;
  }
  const releaseDir = getReleaseDir(releaseVersion, options);
  const manifest = assertJsonFile(path.join(releaseDir, "manifest.json"), "manifest.json");
  if (manifest.releaseVersion !== releaseVersion && manifest.version !== releaseVersion) {
    const error = new Error(`manifest releaseVersion mismatch: expected ${releaseVersion}, got ${manifest.releaseVersion || manifest.version || ""}`);
    error.code = "CLOUDBASE_RELEASE_VERSION_MISMATCH";
    throw error;
  }

  const samples = [];
  INDEX_TYPES.forEach((type) => {
    const indexPath = resolveIndexPath(releaseDir, type);
    const indexPayload = assertJsonFile(indexPath, `${type} index`);
    const items = getIndexItems(indexPayload);
    if (!items.length) {
      const error = new Error(`${type} index empty`);
      error.code = "CLOUDBASE_RELEASE_INDEX_EMPTY";
      throw error;
    }
    if ((indexPayload.releaseVersion || indexPayload.version || releaseVersion) !== releaseVersion) {
      const error = new Error(`${type} index releaseVersion mismatch`);
      error.code = "CLOUDBASE_RELEASE_VERSION_MISMATCH";
      throw error;
    }
    const detailPath = resolveSampleDetailPath(releaseDir, type, indexPayload);
    const detailPayload = assertJsonFile(detailPath, `${type} detail sample`);
    if ((detailPayload.releaseVersion || detailPayload.version || releaseVersion) !== releaseVersion) {
      const error = new Error(`${type} detail releaseVersion mismatch`);
      error.code = "CLOUDBASE_RELEASE_VERSION_MISMATCH";
      throw error;
    }
    samples.push({
      type,
      index: toPosixPath(path.relative(releaseDir, indexPath)),
      detail: toPosixPath(path.relative(releaseDir, detailPath)),
      id: getItemId(items[0]),
    });
  });

  const emptyRoom = assertJsonFile(path.join(releaseDir, "empty-room", "index.json"), "empty-room/index.json");
  if (!Array.isArray(emptyRoom.rooms)) {
    const error = new Error("empty-room/index.json should contain rooms array");
    error.code = "CLOUDBASE_RELEASE_EMPTY_ROOM_INVALID";
    throw error;
  }

  const checkedFiles = verifyManifestFileMeta(releaseDir, manifest);
  return {
    success: true,
    releaseVersion,
    releaseDir,
    manifest,
    samples,
    checkedFiles,
    emptyRoomCount: emptyRoom.rooms.length,
  };
}

function buildCloudbasePointer(manifest, options = {}) {
  const releaseVersion = manifest.releaseVersion || manifest.version || options.releaseVersion || "";
  const term = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  const baseUrl = String(options.hostingBaseUrl || "").trim().replace(/\/+$/g, "");
  const releaseUrl = baseUrl ? joinUrl(baseUrl, "releases", releaseVersion) : "";
  const urlFor = (relativePath) => releaseUrl ? joinUrl(releaseUrl, relativePath) : "";
  return {
    success: true,
    schemaVersion: 1,
    activeTerm: term,
    term,
    semester: manifest.semester || term,
    semesterText: manifest.semesterText || manifest.termConfig && manifest.termConfig.semesterText || "",
    releaseVersion,
    version: releaseVersion,
    updatedAt: manifest.updatedAt || new Date().toISOString(),
    cacheEpoch: manifest.cacheEpoch || Date.parse(manifest.updatedAt || "") || Date.now(),
    forceRefreshToken: manifest.forceRefreshToken || `${releaseVersion}:${manifest.cacheEpoch || ""}`,
    termConfig: Object.assign({}, manifest.termConfig || {}, {
      term,
      releaseVersion,
    }),
    urls: {
      manifest: urlFor("manifest.json"),
      classIndex: urlFor("index/class/all.json"),
      teacherIndex: urlFor("index/teacher/all.json"),
      classroomIndex: urlFor("index/classroom/all.json"),
      courseIndex: urlFor("index/course/all.json"),
      emptyRoom: urlFor("empty-room/index.json"),
      calendar: urlFor("calendar.json"),
      bootstrap: urlFor("bootstrap.json"),
      catalog: urlFor("bootstrap.json"),
      schoolCatalog: urlFor("bootstrap.json"),
    },
    source: "cloudbase-hosting-runtime-active",
  };
}

async function fetchJsonWithText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${url}`);
    error.code = "CLOUDBASE_REMOTE_VERIFY_HTTP";
    throw error;
  }
  const text = await response.text();
  return { text, json: JSON.parse(text), meta: { size: Buffer.byteLength(text), hash: sha1(Buffer.from(text)) } };
}

async function verifyRemoteReleasePack(options = {}) {
  const releaseVersion = String(options.releaseVersion || "").trim();
  const baseUrl = String(options.hostingBaseUrl || options.remoteBaseUrl || "").trim().replace(/\/+$/g, "");
  if (!releaseVersion || !baseUrl) {
    const error = new Error("releaseVersion and hostingBaseUrl are required for remote verification");
    error.code = "CLOUDBASE_REMOTE_VERIFY_CONFIG_REQUIRED";
    throw error;
  }
  const local = verifyLocalReleasePack(options);
  const releaseUrl = joinUrl(baseUrl, "releases", releaseVersion);
  const manifestResponse = await fetchJsonWithText(joinUrl(releaseUrl, "manifest.json"));
  if ((manifestResponse.json.releaseVersion || manifestResponse.json.version) !== releaseVersion) {
    const error = new Error("remote manifest releaseVersion mismatch");
    error.code = "CLOUDBASE_REMOTE_VERIFY_VERSION_MISMATCH";
    throw error;
  }

  const remoteSamples = [];
  const paths = [
    "manifest.json",
    "index/class/all.json",
    "index/teacher/all.json",
    "index/classroom/all.json",
    "index/course/all.json",
    "empty-room/index.json",
  ].concat(local.samples.map((item) => item.detail));
  for (const relativePath of paths) {
    const item = await fetchJsonWithText(joinUrl(releaseUrl, relativePath));
    const expected = relativePath === "manifest.json"
      ? fileMeta(path.join(local.releaseDir, "manifest.json"))
      : local.manifest.files && local.manifest.files[relativePath];
    if (expected && expected.hash && expected.hash !== item.meta.hash) {
      const error = new Error(`remote hash mismatch: ${relativePath}`);
      error.code = "CLOUDBASE_REMOTE_VERIFY_HASH_MISMATCH";
      throw error;
    }
    if (expected && expected.size && Number(expected.size) !== Number(item.meta.size)) {
      const error = new Error(`remote size mismatch: ${relativePath}`);
      error.code = "CLOUDBASE_REMOTE_VERIFY_SIZE_MISMATCH";
      throw error;
    }
    remoteSamples.push(relativePath);
  }
  return { success: true, releaseVersion, releaseUrl, samples: remoteSamples };
}

function runTcbHostingDeploy(localPath, cloudPath, options = {}) {
  const envId = options.envId || ENV_ID;
  const args = [
    "hosting",
    "deploy",
    localPath,
    cloudPath,
    "-e",
    envId,
    "--concurrency",
    String(options.concurrency || 5),
    "--retry-count",
    String(options.retryCount || 3),
  ];
  const command = process.platform === "win32" ? "tcb.cmd" : "tcb";
  const result = spawnSync(command, args, { stdio: options.stdio || "inherit" });
  if (result.error || result.status !== 0) {
    const error = new Error(`tcb hosting deploy failed for ${cloudPath}`);
    error.code = "CLOUDBASE_TCB_DEPLOY_FAILED";
    error.status = result.status;
    error.originalError = result.error || null;
    throw error;
  }
  return { command, args, status: result.status };
}

function runTcbHostingDelete(cloudPath, options = {}) {
  const envId = options.envId || ENV_ID;
  const args = ["hosting", "delete", cloudPath, "-e", envId];
  if (options.dryRun !== false) args.push("--dry-run");
  const command = process.platform === "win32" ? "tcb.cmd" : "tcb";
  const result = spawnSync(command, args, { stdio: options.stdio || "inherit" });
  if (result.error || result.status !== 0) {
    const error = new Error(`tcb hosting delete failed for ${cloudPath}`);
    error.code = "CLOUDBASE_TCB_DELETE_FAILED";
    error.status = result.status;
    error.originalError = result.error || null;
    throw error;
  }
  return { command, args, status: result.status };
}

async function deployReleasePack(options = {}) {
  const activeInfo = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || {};
  const releaseVersion = String(options.releaseVersion || activeInfo.releaseVersion || activeInfo.version || "").trim();
  const dryRun = options.execute === true ? false : options.dryRun !== false;
  const verification = verifyLocalReleasePack(Object.assign({}, options, { releaseVersion }));
  const privacy = scanPrivacy(verification.releaseDir);
  const releaseCloudPath = `releases/${releaseVersion}`;
  const pointer = buildCloudbasePointer(verification.manifest, {
    releaseVersion,
    hostingBaseUrl: options.hostingBaseUrl || options.remoteBaseUrl || "",
  });
  const planned = [
    { action: "deploy", localPath: verification.releaseDir, cloudPath: releaseCloudPath },
    { action: "deploy", localPath: "runtime/active.json", cloudPath: "runtime/active.json" },
  ];
  if (dryRun) {
    return { success: true, dryRun: true, releaseVersion, verification, privacy, pointer, planned };
  }
  const remoteBaseUrl = String(options.hostingBaseUrl || options.remoteBaseUrl || "").trim();
  if (!remoteBaseUrl && options.skipRemoteVerify !== true) {
    const error = new Error("hostingBaseUrl is required before executing CloudBase active pointer update");
    error.code = "CLOUDBASE_HOSTING_BASE_URL_REQUIRED";
    throw error;
  }

  const commandRunner = options.commandRunner || runTcbHostingDeploy;
  const commands = [];
  commands.push(commandRunner(verification.releaseDir, releaseCloudPath, options));
  if (options.verifyRemote !== false) {
    const verifier = options.remoteVerifier || verifyRemoteReleasePack;
    await verifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fosu-cloudbase-pointer-${process.pid}-`));
  const pointerPath = path.join(tmpDir, "active.json");
  writeJson(pointerPath, pointer);
  try {
    commands.push(commandRunner(pointerPath, "runtime/active.json", options));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { success: true, dryRun: false, releaseVersion, verification, privacy, pointer, commands };
}

function listLocalReleaseVersions(options = {}) {
  const root = getPublicReleaseRoot(options);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes(".building-"))
    .map((entry) => {
      const manifestPath = path.join(root, entry.name, "manifest.json");
      let updatedAt = "";
      try {
        updatedAt = readJson(manifestPath).updatedAt || "";
      } catch (error) {
        updatedAt = "";
      }
      return {
        releaseVersion: entry.name,
        updatedAt,
        mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs,
      };
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || "") || left.mtimeMs || 0;
      const rightTime = Date.parse(right.updatedAt || "") || right.mtimeMs || 0;
      return rightTime - leftTime;
    });
}

function getProtectedReleaseVersions(options = {}) {
  const keep = new Set((options.keep || []).filter(Boolean));
  const activePointer = runtimePointerService.readActivePointer && runtimePointerService.readActivePointer();
  const activeInfo = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || {};
  [
    activePointer && activePointer.releaseVersion,
    activeInfo.releaseVersion,
    activeInfo.version,
    options.activeReleaseVersion,
    options.lastGoodReleaseVersion,
  ].forEach((item) => {
    if (item) keep.add(String(item));
  });
  return keep;
}

function planPruneReleasePack(options = {}) {
  const keepLatest = Number(options.keepLatest || DEFAULT_KEEP_LATEST) || DEFAULT_KEEP_LATEST;
  const protectedVersions = getProtectedReleaseVersions(options);
  const releases = options.releases || listLocalReleaseVersions(options);
  releases.slice(0, keepLatest).forEach((item) => protectedVersions.add(item.releaseVersion));
  const deletions = releases
    .map((item) => item.releaseVersion)
    .filter((version) => !protectedVersions.has(version));
  return {
    success: true,
    dryRun: options.dryRun !== false,
    keepLatest,
    protectedVersions: Array.from(protectedVersions),
    deletions,
  };
}

function pruneReleasePack(options = {}) {
  const plan = planPruneReleasePack(options);
  if (plan.dryRun) return plan;
  const commandRunner = options.deleteRunner || runTcbHostingDelete;
  const commands = plan.deletions.map((version) => commandRunner(`releases/${version}`, Object.assign({}, options, { dryRun: false })));
  return Object.assign({}, plan, { commands });
}

module.exports = {
  DEFAULT_KEEP_LATEST,
  ENV_ID,
  buildCloudbasePointer,
  collectPrivacyFindings,
  deployReleasePack,
  fileMeta,
  getPublicReleaseRoot,
  getReleaseDir,
  joinUrl,
  listLocalReleaseVersions,
  parseArgs,
  planPruneReleasePack,
  pruneReleasePack,
  readJson,
  runTcbHostingDelete,
  runTcbHostingDeploy,
  scanPrivacy,
  verifyLocalReleasePack,
  verifyRemoteReleasePack,
  writeJson,
};
