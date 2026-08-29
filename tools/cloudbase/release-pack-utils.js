const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const releaseService = require("../../server/src/services/releaseService");
const runtimePointerService = require("../../server/src/services/runtimePointerService");

const ENV_ID = cloudbaseConfig.ENV_ID;
const DEFAULT_KEEP_LATEST = 2;
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
  ["calendar.json", "bootstrap.json"].forEach((relativePath) => {
    assertJsonFile(path.join(releaseDir, relativePath), relativePath);
    const meta = manifest.files && manifest.files[relativePath];
    if (!meta || !meta.hash || !meta.size) {
      const error = new Error(`manifest.files missing required root file: ${relativePath}`);
      error.code = "CLOUDBASE_RELEASE_REQUIRED_FILE_UNTRACKED";
      throw error;
    }
  });

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

function normalizeCloudbaseUrls(pointer, releaseVersion, baseUrl) {
  const releaseUrl = baseUrl ? joinUrl(baseUrl, "releases", releaseVersion) : "";
  const urlFor = (relativePath) => releaseUrl ? joinUrl(releaseUrl, relativePath) : "";
  const urls = Object.assign({}, pointer.urls || {}, {
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
    detailPattern: releaseUrl ? joinUrl(releaseUrl, "detail/{type}/{id}.json") : "",
  });
  delete urls.staticRelease;
  return urls;
}

function buildCloudbasePointer(manifest, options = {}) {
  const activePointer = options.activePointer && typeof options.activePointer === "object"
    ? options.activePointer
    : null;
  const releaseVersion = manifest.releaseVersion || manifest.version || options.releaseVersion || "";
  const term = activePointer && (activePointer.activeTerm || activePointer.term || activePointer.semester) ||
    manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  const baseUrl = String(options.hostingBaseUrl || "").trim().replace(/\/+$/g, "");
  const basePointer = activePointer ? Object.assign({}, activePointer) : {};
  const pointer = Object.assign({}, basePointer, {
    success: true,
    schemaVersion: basePointer.schemaVersion || 1,
    activeTerm: term,
    term,
    semester: basePointer.semester || manifest.semester || term,
    semesterText: basePointer.semesterText || manifest.semesterText || manifest.termConfig && manifest.termConfig.semesterText || "",
    releaseVersion,
    version: releaseVersion,
    updatedAt: basePointer.updatedAt || manifest.updatedAt || new Date().toISOString(),
    cacheEpoch: basePointer.cacheEpoch || manifest.cacheEpoch || Date.parse(manifest.updatedAt || "") || Date.now(),
    forceRefreshToken: basePointer.forceRefreshToken || manifest.forceRefreshToken || `${releaseVersion}:${manifest.cacheEpoch || ""}`,
    termConfig: Object.assign({}, manifest.termConfig || {}, basePointer.termConfig || {}, {
      term,
      releaseVersion,
    }),
    urls: normalizeCloudbaseUrls(basePointer, releaseVersion, baseUrl),
    source: "cloudbase-hosting-runtime-active",
  });
  delete pointer.staticUrls;
  pointer.manifestUrl = pointer.urls.manifest;
  pointer.calendarUrl = pointer.urls.calendar;
  pointer.bootstrapUrl = pointer.urls.bootstrap;
  pointer.catalogUrl = pointer.urls.catalog;
  pointer.classCatalogUrl = pointer.urls.classIndex;
  pointer.schoolCatalogUrl = pointer.urls.schoolCatalog;
  return pointer;
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
    "calendar.json",
    "bootstrap.json",
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

function addDeployTask(tasks, seen, localPath, cloudPath) {
  const normalizedCloudPath = toPosixPath(cloudPath).replace(/^\/+|\/+$/g, "");
  if (!normalizedCloudPath || seen.has(normalizedCloudPath)) return;
  if (!fs.existsSync(localPath)) {
    const error = new Error(`release deploy source missing: ${localPath}`);
    error.code = "CLOUDBASE_DEPLOY_SOURCE_MISSING";
    throw error;
  }
  seen.add(normalizedCloudPath);
  tasks.push({ action: "deploy", localPath, cloudPath: normalizedCloudPath });
}

function buildCloudbaseDeployPlan(verification) {
  const releaseDir = verification.releaseDir;
  const releaseCloudRoot = `releases/${verification.releaseVersion}`;
  const manifestPaths = Object.keys(verification.manifest.files || {}).sort();
  const tasks = [];
  const seen = new Set();

  addDeployTask(
    tasks,
    seen,
    path.join(releaseDir, "manifest.json"),
    `${releaseCloudRoot}/manifest.json`
  );

  manifestPaths.forEach((relativePath) => {
    const normalized = toPosixPath(relativePath).replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    if (!parts.length) return;
    if (parts.length === 1) {
      addDeployTask(
        tasks,
        seen,
        path.join(releaseDir, normalized),
        `${releaseCloudRoot}/${normalized}`
      );
      return;
    }

    let groupParts = [parts[0]];
    if ((parts[0] === "index" || parts[0] === "detail") && parts[1]) {
      groupParts = [parts[0], parts[1]];
    }
    addDeployTask(
      tasks,
      seen,
      path.join(releaseDir, ...groupParts),
      `${releaseCloudRoot}/${groupParts.join("/")}`
    );
  });

  return tasks;
}

function collectDeployFiles(localDir) {
  const root = path.resolve(localDir);
  const output = [];
  function walk(current) {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (entry.isFile()) output.push(fullPath);
    });
  }
  walk(root);
  return output.sort((left, right) => toPosixPath(path.relative(root, left)).localeCompare(toPosixPath(path.relative(root, right))));
}

function copyDeployChunk(rootDir, files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fosu-cloudbase-deploy-${process.pid}-`));
  files.forEach((filePath) => {
    const relativePath = path.relative(rootDir, filePath);
    const targetPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(filePath, targetPath);
  });
  return tmpDir;
}

async function runDeployFilesFallback(commandRunner, task, options = {}, cause) {
  const stat = fs.existsSync(task.localPath) ? fs.statSync(task.localPath) : null;
  if (!stat || !stat.isDirectory()) throw cause;
  const files = collectDeployFiles(task.localPath);
  if (!files.length) throw cause;
  const chunkSize = Math.max(1, Number(options.fileFallbackChunkSize || process.env.CLOUDBASE_DEPLOY_FILE_FALLBACK_CHUNK_SIZE || 80) || 80);
  const commands = [];
  if (options.quiet !== true) {
    console.error(`[cloudbase] directory deploy failed for ${task.cloudPath}; falling back to ${files.length} files in chunks of ${chunkSize}`);
  }
  for (let offset = 0; offset < files.length; offset += chunkSize) {
    const chunk = files.slice(offset, offset + chunkSize);
    const chunkIndex = Math.floor(offset / chunkSize) + 1;
    const chunkTotal = Math.ceil(files.length / chunkSize);
    const tmpDir = copyDeployChunk(task.localPath, chunk);
    try {
      if (options.quiet !== true) {
        console.error(`[cloudbase] deploying fallback chunk ${chunkIndex}/${chunkTotal}: ${task.cloudPath} (${chunk.length} files)`);
      }
      const result = await runDeployTaskWithRetry(commandRunner, {
        action: "deploy-chunk",
        localPath: tmpDir,
        cloudPath: task.cloudPath,
      }, chunkIndex - 1, chunkTotal, Object.assign({}, options, {
        allowFileFallback: false,
        quiet: true,
      }));
      commands.push(Object.assign({}, result, {
        fallback: "chunk",
        originalCloudPath: task.cloudPath,
        fileCount: chunk.length,
      }));
    } catch (chunkError) {
      if (options.quiet !== true) {
        console.error(`[cloudbase] fallback chunk ${chunkIndex}/${chunkTotal} failed; retrying ${chunk.length} files individually`);
      }
      for (let fileIndex = 0; fileIndex < chunk.length; fileIndex += 1) {
        const filePath = chunk[fileIndex];
        const relativePath = toPosixPath(path.relative(task.localPath, filePath));
        const fileTask = {
          action: "deploy-file",
          localPath: filePath,
          cloudPath: `${task.cloudPath}/${relativePath}`,
        };
        const result = await runDeployTaskWithRetry(commandRunner, fileTask, fileIndex, chunk.length, Object.assign({}, options, {
          allowFileFallback: false,
          quiet: true,
        }));
        commands.push(Object.assign({}, result, {
          fallback: "file",
          originalCloudPath: task.cloudPath,
          fileCount: 1,
        }));
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  return {
    localPath: task.localPath,
    cloudPath: task.cloudPath,
    fallback: "files",
    fileCount: files.length,
    commands,
    failedWith: cause && (cause.code || cause.message) || "",
  };
}

async function runDeployTaskWithRetry(commandRunner, task, index, total, options = {}) {
  const attempts = Math.max(1, Number(options.deployRetries || process.env.CLOUDBASE_DEPLOY_RETRIES || 3) || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (options.quiet !== true) {
        console.error(`[cloudbase] deploying ${index + 1}/${total}: ${task.cloudPath} (attempt ${attempt}/${attempts})`);
      }
      const result = await Promise.resolve(commandRunner(task.localPath, task.cloudPath, options));
      return Object.assign({ localPath: task.localPath, cloudPath: task.cloudPath, attempt }, result || {});
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (options.quiet !== true) {
        console.error(`[cloudbase] deploy retry ${attempt}/${attempts - 1} after ${error.code || error.message || "failure"}`);
      }
    }
  }
  if (options.allowFileFallback !== false) {
    return runDeployFilesFallback(commandRunner, task, options, lastError);
  }
  throw lastError;
}

async function verifyCloudbaseRuntimePointer(options = {}) {
  const releaseVersion = String(options.releaseVersion || "").trim();
  const baseUrl = String(options.hostingBaseUrl || options.remoteBaseUrl || "").trim().replace(/\/+$/g, "");
  if (!releaseVersion || !baseUrl) {
    const error = new Error("releaseVersion and hostingBaseUrl are required for runtime pointer verification");
    error.code = "CLOUDBASE_POINTER_VERIFY_CONFIG_REQUIRED";
    throw error;
  }
  const url = joinUrl(baseUrl, "runtime", `active.json?bucket=${Date.now()}`);
  const response = await fetchJsonWithText(url);
  const actualVersion = response.json.releaseVersion || response.json.version || "";
  if (actualVersion !== releaseVersion) {
    const error = new Error(`CloudBase runtime pointer mismatch: expected ${releaseVersion}, got ${actualVersion}`);
    error.code = "CLOUDBASE_POINTER_VERIFY_VERSION_MISMATCH";
    throw error;
  }
  return { success: true, releaseVersion, url, meta: response.meta, pointer: response.json };
}

function quoteWinArg(value) {
  const text = String(value || "");
  if (/^[a-zA-Z0-9_./\\:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function spawnTcb(args, options = {}) {
  const command = process.platform === "win32" ? "tcb.cmd" : "tcb";
  const useCmd = process.platform === "win32";
  const result = spawnSync(
    useCmd ? "cmd.exe" : command,
    useCmd ? ["/d", "/s", "/c", [command].concat(args).map(quoteWinArg).join(" ")] : args,
    {
      stdio: options.stdio || "inherit",
      encoding: options.encoding,
      maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    }
  );
  return { command, result };
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
  ];
  const spawned = spawnTcb(args, options);
  const command = spawned.command;
  const result = spawned.result;
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
  if (options.dir === true) args.push("--dir");
  if (options.dryRun !== false) args.push("--dry-run");
  const spawned = spawnTcb(args, options);
  const command = spawned.command;
  const result = spawned.result;
  if (result.error || result.status !== 0) {
    const error = new Error(`tcb hosting delete failed for ${cloudPath}`);
    error.code = "CLOUDBASE_TCB_DELETE_FAILED";
    error.status = result.status;
    error.originalError = result.error || null;
    throw error;
  }
  return { command, args, status: result.status };
}

function runTcbHostingList(options = {}) {
  const envId = options.envId || ENV_ID;
  const args = ["hosting", "list", "-e", envId, "--json"];
  const spawned = spawnTcb(args, Object.assign({}, options, {
    stdio: "pipe",
    encoding: "utf8",
  }));
  const result = spawned.result;
  if (result.error || result.status !== 0) {
    const error = new Error("tcb hosting list failed");
    error.code = "CLOUDBASE_TCB_LIST_FAILED";
    error.status = result.status;
    error.stdout = result.stdout || "";
    error.stderr = result.stderr || "";
    throw error;
  }
  return {
    command: spawned.command,
    args,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function deployReleasePack(options = {}) {
  const activeInfo = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || {};
  const releaseVersion = String(options.releaseVersion || activeInfo.releaseVersion || activeInfo.version || "").trim();
  const dryRun = options.execute === true ? false : options.dryRun !== false;
  const verification = verifyLocalReleasePack(Object.assign({}, options, { releaseVersion }));
  const privacy = scanPrivacy(verification.releaseDir);
  const pointer = buildCloudbasePointer(verification.manifest, {
    releaseVersion,
    hostingBaseUrl: options.hostingBaseUrl || options.remoteBaseUrl || "",
  });
  const planned = buildCloudbaseDeployPlan(verification);
  if (dryRun) {
    return { success: true, dryRun: true, releaseVersion, verification, privacy, pointer, planned };
  }
  const remoteBaseUrl = String(options.hostingBaseUrl || options.remoteBaseUrl || "").trim();
  if (!remoteBaseUrl && options.skipRemoteVerify !== true) {
    const error = new Error("hostingBaseUrl is required before executing CloudBase release upload with remote verification");
    error.code = "CLOUDBASE_HOSTING_BASE_URL_REQUIRED";
    throw error;
  }

  const commandRunner = options.commandRunner || runTcbHostingDeploy;
  const commands = [];
  if (options.skipUnchanged === true && remoteBaseUrl && options.verifyRemote !== false) {
    const verifier = options.remoteVerifier || verifyRemoteReleasePack;
    try {
      const remoteBefore = await verifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
      return {
        success: true,
        dryRun: false,
        unchanged: true,
        skipped: true,
        skipReason: "remote-release-identical",
        releaseVersion,
        verification,
        privacy,
        pointer,
        planned,
        commands,
        remote: remoteBefore,
      };
    } catch (error) {
      // Remote diff only skips when the existing release is verified identical.
    }
  }
  for (let index = 0; index < planned.length; index += 1) {
    commands.push(await runDeployTaskWithRetry(commandRunner, planned[index], index, planned.length, options));
  }
  let remote = null;
  if (options.verifyRemote !== false) {
    const verifier = options.remoteVerifier || verifyRemoteReleasePack;
    remote = await verifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
  }
  return { success: true, dryRun: false, releaseVersion, verification, privacy, pointer, commands, remote };
}

async function cutoverReleasePack(options = {}) {
  const confirmation = String(options.confirmation || options.confirm || "").trim();
  if (confirmation !== "CONFIRM_CLOUDBASE_CUTOVER") {
    const error = new Error("Exact confirmation text CONFIRM_CLOUDBASE_CUTOVER is required");
    error.code = "CLOUDBASE_CUTOVER_CONFIRMATION_REQUIRED";
    throw error;
  }

  const activeInfo = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || {};
  const releaseVersion = String(options.releaseVersion || activeInfo.releaseVersion || activeInfo.version || "").trim();
  const remoteBaseUrl = String(options.hostingBaseUrl || options.remoteBaseUrl || "").trim();
  if (!releaseVersion || !remoteBaseUrl) {
    const error = new Error("releaseVersion and hostingBaseUrl are required for cutover");
    error.code = "CLOUDBASE_CUTOVER_CONFIG_REQUIRED";
    throw error;
  }
  if (options.oracleActiveReleaseVersion && String(options.oracleActiveReleaseVersion) !== releaseVersion) {
    const error = new Error(`Oracle active release mismatch: ${options.oracleActiveReleaseVersion}`);
    error.code = "CLOUDBASE_CUTOVER_ORACLE_MISMATCH";
    throw error;
  }
  if (options.gitStatusRecorded !== true && !options.gitStatusText) {
    const error = new Error("Git working tree status must be recorded before cutover");
    error.code = "CLOUDBASE_CUTOVER_GIT_STATUS_REQUIRED";
    throw error;
  }

  const verification = verifyLocalReleasePack(Object.assign({}, options, { releaseVersion }));
  const privacy = scanPrivacy(verification.releaseDir);
  const remoteVerifier = options.remoteVerifier || verifyRemoteReleasePack;
  const remoteBefore = await remoteVerifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
  const pointer = buildCloudbasePointer(verification.manifest, {
    releaseVersion,
    hostingBaseUrl: remoteBaseUrl,
    activePointer: options.activePointerOverride || options.activePointer,
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `fosu-cloudbase-pointer-${process.pid}-`));
  const pointerPath = path.join(tmpDir, "active.json");
  writeJson(pointerPath, pointer);
  const commandRunner = options.commandRunner || runTcbHostingDeploy;
  const commands = [];
  try {
    commands.push(commandRunner(pointerPath, "runtime/active.json", options));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const pointerVerifier = options.runtimePointerVerifier || verifyCloudbaseRuntimePointer;
  const pointerVerification = await pointerVerifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
  const remoteAfter = await remoteVerifier(Object.assign({}, options, { releaseVersion, hostingBaseUrl: remoteBaseUrl }));
  return {
    success: true,
    releaseVersion,
    verification,
    privacy,
    remoteBefore,
    pointer,
    pointerVerification,
    remoteAfter,
    commands,
    readyRecommendation: "CloudBase release, remote verification, and runtime pointer verification passed. CLOUDBASE_HOSTING_READY may now be set to true after production confirmation.",
  };
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

function collectPathsFromJson(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPathsFromJson(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  ["path", "Path", "key", "Key", "filePath", "FilePath", "name", "Name", "fullPath", "FullPath"].forEach((key) => {
    if (typeof value[key] === "string") output.push(value[key]);
  });
  Object.keys(value).forEach((key) => collectPathsFromJson(value[key], output));
  return output;
}

function parseRemoteReleaseVersionsFromHostingList(output) {
  const text = String(output || "");
  const paths = [];
  try {
    collectPathsFromJson(JSON.parse(text), paths);
  } catch (error) {
    // Fall back to text parsing below.
  }
  const releasePattern = /(?:^|[\s"'`])\/?(releases\/([^/\s"'`]+))(?:\/|[\s"'`]|$)/g;
  let match;
  while ((match = releasePattern.exec(text))) {
    paths.push(match[1]);
  }
  const versions = new Map();
  paths.forEach((item) => {
    const normalized = toPosixPath(item).replace(/^\/+/, "");
    const versionMatch = normalized.match(/^releases\/([^/]+)(?:\/|$)/);
    if (!versionMatch || versionMatch[1] === "runtime" || versionMatch[1] === "active.json") return;
    const version = versionMatch[1];
    if (!versions.has(version)) {
      versions.set(version, {
        releaseVersion: version,
        path: `releases/${version}`,
      });
    }
  });
  return Array.from(versions.values()).sort((left, right) => {
    const leftTime = Date.parse(left.releaseVersion.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")) || 0;
    const rightTime = Date.parse(right.releaseVersion.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")) || 0;
    if (leftTime || rightTime) return rightTime - leftTime;
    return String(right.releaseVersion).localeCompare(String(left.releaseVersion));
  });
}

function parseRemoteHostingFilePathsFromList(output) {
  const text = String(output || "");
  const paths = [];
  try {
    collectPathsFromJson(JSON.parse(text), paths);
  } catch (error) {
    // Fall back to text parsing below.
  }
  const releaseFilePattern = /(?:^|[\s"'`])\/?((?:releases|runtime)\/[^"'`\s]+)(?:[\s"'`]|$)/g;
  let match;
  while ((match = releaseFilePattern.exec(text))) {
    paths.push(match[1]);
  }
  return Array.from(new Set(paths
    .map((item) => toPosixPath(item).replace(/^\/+/, ""))
    .filter((item) => item && !item.endsWith("/"))));
}

function readLocalReleaseManifest(releaseVersion, options = {}) {
  const version = String(releaseVersion || "").trim();
  if (!version) return null;
  const manifestPath = path.join(getReleaseDir(version, options), "manifest.json");
  try {
    return readJson(manifestPath);
  } catch (error) {
    return null;
  }
}

function manifestRemotePaths(releaseVersion, manifest) {
  const version = String(releaseVersion || "").trim();
  if (!version || !manifest) return new Set();
  const paths = new Set([`releases/${version}/manifest.json`]);
  const files = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  Object.keys(files).forEach((relativePath) => {
    const normalized = toPosixPath(relativePath).replace(/^\/+/, "");
    if (!normalized) return;
    paths.add(`releases/${version}/${normalized}`);
    paths.add(`releases/${version}/${normalized}.gz`);
    paths.add(`releases/${version}/${normalized}.br`);
  });
  return paths;
}

function planRemoteReleaseOrphanFiles(options = {}) {
  const releaseVersion = String(options.releaseVersion || "").trim();
  const manifest = options.manifest || readLocalReleaseManifest(releaseVersion, options);
  const remoteFiles = options.remoteFiles || [];
  if (!releaseVersion || !manifest || !remoteFiles.length) return [];
  const releasePrefix = `releases/${releaseVersion}/`;
  const referenced = manifestRemotePaths(releaseVersion, manifest);
  return remoteFiles
    .filter((remotePath) => remotePath.startsWith(releasePrefix))
    .filter((remotePath) => !referenced.has(remotePath))
    .map((remotePath) => ({
      releaseVersion,
      path: remotePath,
      type: "orphan-file",
      dir: false,
    }));
}

async function fetchCloudbaseRuntimePointer(options = {}) {
  if (options.activePointer) return options.activePointer;
  const baseUrl = String(options.hostingBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
  if (!baseUrl) return null;
  const response = await fetch(joinUrl(baseUrl, "runtime", `active.json?bucket=${Date.now()}`));
  if (!response.ok) return null;
  return response.json();
}

function planRemotePruneReleasePack(options = {}) {
  const keepLatest = Number(options.keepLatest || DEFAULT_KEEP_LATEST) || DEFAULT_KEEP_LATEST;
  const releases = (options.remoteReleases || []).slice();
  const activePointer = options.activePointer || {};
  const protectedVersions = new Set((options.keep || []).filter(Boolean));
  [
    activePointer.releaseVersion,
    activePointer.version,
    activePointer.lastGoodReleaseVersion,
    activePointer.lastKnownGoodReleaseVersion,
    options.activeReleaseVersion,
    options.lastGoodReleaseVersion,
  ].forEach((item) => {
    if (item) protectedVersions.add(String(item));
  });
  releases.slice(0, keepLatest).forEach((item) => protectedVersions.add(item.releaseVersion));
  const deletions = releases
    .filter((item) => !protectedVersions.has(item.releaseVersion))
    .map((item) => ({
      releaseVersion: item.releaseVersion,
      path: `releases/${item.releaseVersion}`,
      type: "old-release",
      dir: true,
    }))
    .filter((item) => item.path !== "runtime/active.json" && item.path.startsWith("releases/"));
  const activeVersion = activePointer.releaseVersion || activePointer.version || options.activeReleaseVersion || "";
  const orphanDeletions = planRemoteReleaseOrphanFiles(Object.assign({}, options, {
    releaseVersion: activeVersion,
  })).filter((item) => protectedVersions.has(item.releaseVersion));
  deletions.push.apply(deletions, orphanDeletions);
  return {
    success: true,
    scope: "remote-hosting",
    dryRun: options.dryRun !== false,
    keepLatest,
    protectedVersions: Array.from(protectedVersions),
    remoteReleases: releases,
    deletions,
    summary: {
      added: 0,
      updated: 0,
      skipped: 0,
      deleted: deletions.length,
      orphanFiles: orphanDeletions.length,
      keptVersions: protectedVersions.size,
      savedFiles: releases.filter((item) => protectedVersions.has(item.releaseVersion)).length,
    },
  };
}

async function pruneRemoteReleasePack(options = {}) {
  const listResult = options.hostingListOutput
    ? { stdout: options.hostingListOutput, command: "mock", args: [] }
    : runTcbHostingList(options);
  const remoteReleases = parseRemoteReleaseVersionsFromHostingList(listResult.stdout);
  const remoteFiles = options.remoteFiles || parseRemoteHostingFilePathsFromList(listResult.stdout);
  const activePointer = options.activePointer || await fetchCloudbaseRuntimePointer(options);
  const dryRun = options.execute === true ? false : options.dryRun !== false;
  const plan = planRemotePruneReleasePack(Object.assign({}, options, {
    remoteReleases,
    remoteFiles,
    activePointer,
    dryRun,
  }));
  plan.listCommand = {
    command: listResult.command,
    args: listResult.args,
    status: listResult.status,
  };
  plan.activeReleaseVersion = activePointer && (activePointer.releaseVersion || activePointer.version) || "";
  if (plan.dryRun) return plan;
  if (String(options.confirm || options.confirmation || "").trim() !== "CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES") {
    const error = new Error("Exact confirmation text CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES is required");
    error.code = "CLOUDBASE_PRUNE_CONFIRMATION_REQUIRED";
    error.plan = plan;
    throw error;
  }
  const commandRunner = options.deleteRunner || runTcbHostingDelete;
  const commands = plan.deletions.map((item) => commandRunner(item.path, Object.assign({}, options, { dryRun: false, dir: item.dir !== false })));
  return Object.assign({}, plan, { commands });
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
  buildCloudbaseDeployPlan,
  buildCloudbasePointer,
  collectPrivacyFindings,
  cutoverReleasePack,
  deployReleasePack,
  fileMeta,
  getPublicReleaseRoot,
  getReleaseDir,
  joinUrl,
  listLocalReleaseVersions,
  parseRemoteHostingFilePathsFromList,
  parseRemoteReleaseVersionsFromHostingList,
  parseArgs,
  planRemoteReleaseOrphanFiles,
  planPruneReleasePack,
  planRemotePruneReleasePack,
  pruneReleasePack,
  pruneRemoteReleasePack,
  readJson,
  runTcbHostingList,
  runTcbHostingDelete,
  runTcbHostingDeploy,
  scanPrivacy,
  verifyCloudbaseRuntimePointer,
  verifyLocalReleasePack,
  verifyRemoteReleasePack,
  writeJson,
};
