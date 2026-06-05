const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const { safeLog } = require("../utils/safeLogger");
const { calculateFingerprint } = require("../utils/stagingFingerprint");
const {
  UNKNOWN_BUILDING_CODE,
  UNKNOWN_BUILDING_NAME,
  normalizeBuilding,
  isUnknownBuilding,
} = require("../utils/buildingNormalizer");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const RELEASES_DIR = path.join(STORAGE_DIR, "releases");
const PUBLIC_RELEASES_DIR = path.join(STORAGE_DIR, "public", "releases");
const ACTIVE_RELEASE_PATH = path.join(RELEASES_DIR, "active.json");
const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const CURRENT_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, "current.json");
const CURRENT_SNAPSHOT_GZ_PATH = path.join(SNAPSHOTS_DIR, "current.json.gz");
const STATIC_RELEASE_BASE_PATH = "/static/releases";
const STATIC_RELEASE_BASE_URL = process.env.FOSU_STATIC_RELEASE_BASE_URL || STATIC_RELEASE_BASE_PATH;
const gzipAsync = promisify(zlib.gzip);
const brotliCompressAsync = typeof zlib.brotliCompress === "function"
  ? promisify(zlib.brotliCompress)
  : null;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorageDirs() {
  ensureDir(STORAGE_DIR);
  ensureDir(RELEASES_DIR);
  ensureDir(PUBLIC_RELEASES_DIR);
  ensureDir(SNAPSHOTS_DIR);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    safeLog("release-read-json-failed", { filePath, error: error.message });
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/[:/\\?%*|"<>]/g, "-")
    .replace(/\s+/g, "-");
}

function generateReleaseVersion() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-") + `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function getReleaseDir(version) {
  return path.join(RELEASES_DIR, normalizeVersion(version));
}

function getPublicReleaseDir(version) {
  return path.join(PUBLIC_RELEASES_DIR, normalizeVersion(version));
}

function getSafeBuildId(jobId) {
  return String(jobId || `${process.pid}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function buildReleaseFiles(version, releaseDir, publicReleaseDir) {
  const indexDir = path.join(releaseDir, "index");
  const detailDir = path.join(releaseDir, "detail");
  const emptyRoomDir = path.join(releaseDir, "empty-room");
  return {
    releaseDir,
    publicReleaseDir,
    bootstrapPath: path.join(releaseDir, "bootstrap.json"),
    classSchedulesPath: path.join(releaseDir, "class-schedules.json"),
    resourcesPath: path.join(releaseDir, "resources.json"),
    snapshotPath: path.join(releaseDir, "snapshot.json"),
    manifestPath: path.join(releaseDir, "manifest.json"),
    indexDir,
    detailDir,
    emptyRoomDir,
    classesIndexPath: path.join(indexDir, "class.json"),
    teachersIndexPath: path.join(indexDir, "teacher.json"),
    classroomsIndexPath: path.join(indexDir, "classroom.json"),
    coursesIndexPath: path.join(indexDir, "course.json"),
    classIndexAllPath: path.join(indexDir, "class", "all.json"),
    classIndexByCollegeDir: path.join(indexDir, "class", "by-college"),
    classIndexByMajorDir: path.join(indexDir, "class", "by-major"),
    teacherIndexAllPath: path.join(indexDir, "teacher", "all.json"),
    classroomIndexAllPath: path.join(indexDir, "classroom", "all.json"),
    courseIndexAllPath: path.join(indexDir, "course", "all.json"),
    classScheduleDir: path.join(detailDir, "class"),
    teacherScheduleDir: path.join(detailDir, "teacher"),
    classroomScheduleDir: path.join(detailDir, "classroom"),
    courseScheduleDir: path.join(detailDir, "course"),
    emptyRoomIndexPath: path.join(emptyRoomDir, "index.json"),
    legacyClassesIndexPath: path.join(releaseDir, "classes-index.json"),
    legacyTeachersIndexPath: path.join(releaseDir, "teachers-index.json"),
    legacyClassroomsIndexPath: path.join(releaseDir, "classrooms-index.json"),
    legacyCoursesIndexPath: path.join(releaseDir, "courses-index.json"),
    legacyClassScheduleDir: path.join(releaseDir, "schedules", "class"),
    legacyTeacherScheduleDir: path.join(releaseDir, "schedules", "teacher"),
    legacyClassroomScheduleDir: path.join(releaseDir, "schedules", "classroom"),
    legacyCourseScheduleDir: path.join(releaseDir, "schedules", "course"),
    legacyEmptyRoomIndexPath: path.join(releaseDir, "derived", "empty-room-index.json"),
  };
}

function getReleaseFiles(version) {
  return buildReleaseFiles(version, getReleaseDir(version), getPublicReleaseDir(version));
}

function getBuildingReleaseFiles(version, jobId) {
  const normalizedVersion = normalizeVersion(version);
  const safeJobId = getSafeBuildId(jobId);
  const releaseDir = path.join(RELEASES_DIR, `${normalizedVersion}.building-${safeJobId}`);
  const publicReleaseDir = path.join(PUBLIC_RELEASES_DIR, `${normalizedVersion}.building-${safeJobId}`);
  return buildReleaseFiles(normalizedVersion, releaseDir, publicReleaseDir);
}

function assertManagedDir(dirPath, baseDir, label) {
  const resolved = path.resolve(dirPath || "");
  const base = path.resolve(baseDir);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify unmanaged ${label || "directory"}: ${resolved}`);
  }
  return resolved;
}

function assertManagedReleaseDir(dirPath) {
  return assertManagedDir(dirPath, RELEASES_DIR, "release directory");
}

function assertManagedPublicReleaseDir(dirPath) {
  return assertManagedDir(dirPath, PUBLIC_RELEASES_DIR, "public release directory");
}

function assertBuildingDir(dirPath, baseDir, label) {
  const resolved = assertManagedDir(dirPath, baseDir, label);
  if (!path.basename(resolved).includes(".building-")) {
    throw new Error(`Refusing to clean non-building ${label || "directory"}: ${resolved}`);
  }
  return resolved;
}

function cleanupBuildingReleaseFiles(files) {
  if (!files) return;
  [
    [files.releaseDir, RELEASES_DIR, "release directory"],
    [files.publicReleaseDir, PUBLIC_RELEASES_DIR, "public release directory"],
  ].forEach(([dirPath, baseDir, label]) => {
    try {
      const resolved = assertBuildingDir(dirPath, baseDir, label);
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch (error) {
      safeLog("release-building-cleanup-failed", { dirPath, error: error.message });
    }
  });
}

function promoteManagedDirs(pairs) {
  const stamp = `${process.pid}-${Date.now()}`;
  const prepared = pairs.map((pair, index) => {
    const source = assertManagedDir(pair.source, pair.baseDir, pair.label);
    const target = assertManagedDir(pair.target, pair.baseDir, pair.label);
    if (!fs.existsSync(source)) {
      throw new Error(`Build ${pair.label || "directory"} does not exist: ${source}`);
    }
    return Object.assign({}, pair, {
      source,
      target,
      previous: `${target}.previous-${stamp}-${index}`,
      targetExisted: fs.existsSync(target),
      promoted: false,
    });
  });

  try {
    prepared.forEach((item) => {
      if (item.targetExisted) {
        fs.renameSync(item.target, item.previous);
      }
    });
    prepared.forEach((item) => {
      fs.renameSync(item.source, item.target);
      item.promoted = true;
    });
    prepared.forEach((item) => {
      if (fs.existsSync(item.previous)) {
        fs.rmSync(item.previous, { recursive: true, force: true });
      }
    });
  } catch (error) {
    prepared.slice().reverse().forEach((item) => {
      try {
        if (item.promoted && fs.existsSync(item.target)) {
          fs.rmSync(item.target, { recursive: true, force: true });
        }
        if (fs.existsSync(item.previous) && !fs.existsSync(item.target)) {
          fs.renameSync(item.previous, item.target);
        }
      } catch (restoreError) {
        safeLog("release-dir-restore-failed", {
          target: item.target,
          previous: item.previous,
          error: restoreError.message,
        });
      }
    });
    throw error;
  }
}

function replaceReleaseDirFromBuild(buildDir, finalDir) {
  promoteManagedDirs([{
    source: assertManagedReleaseDir(buildDir),
    target: assertManagedReleaseDir(finalDir),
    baseDir: RELEASES_DIR,
    label: "release directory",
  }]);
}

function replaceReleaseFilesFromBuild(buildFiles, finalFiles) {
  promoteManagedDirs([
    {
      source: assertManagedReleaseDir(buildFiles.releaseDir),
      target: assertManagedReleaseDir(finalFiles.releaseDir),
      baseDir: RELEASES_DIR,
      label: "release directory",
    },
    {
      source: assertManagedPublicReleaseDir(buildFiles.publicReleaseDir),
      target: assertManagedPublicReleaseDir(finalFiles.publicReleaseDir),
      baseDir: PUBLIC_RELEASES_DIR,
      label: "public release directory",
    },
  ]);
}

function getReleaseBuildJobId(options = {}) {
  if (options.jobId) return options.jobId;
  try {
    const job = options.job && typeof options.job.getJob === "function" ? options.job.getJob() : null;
    if (job && job.id) return job.id;
  } catch (error) {
    safeLog("release-build-job-id-read-failed", { error: error.message });
  }
  return `${process.pid}-${Date.now()}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getResources(snapshot) {
  const source = snapshot && snapshot.resources && typeof snapshot.resources === "object"
    ? snapshot.resources
    : {};
  const topLevel = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(topLevel.teachers),
    classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(topLevel.classrooms),
    courses: asArray(source.courses).length ? asArray(source.courses) : asArray(topLevel.courses),
    teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(topLevel.teacherSchedules),
    classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(topLevel.classroomSchedules),
    courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(topLevel.courseSchedules),
  };
}

function readLegacyResourceArray(fileName) {
  const value = readJsonFile(path.join(STORAGE_DIR, fileName));
  return Array.isArray(value) ? value : [];
}

function hydrateLegacySnapshotResources(snapshot) {
  const resources = getResources(snapshot);
  if (resources.teacherSchedules.length || resources.classroomSchedules.length || resources.courseSchedules.length) {
    return Object.assign({}, snapshot, { resources });
  }
  return Object.assign({}, snapshot, {
    resources: Object.assign({}, resources, {
      teacherSchedules: readLegacyResourceArray("teacher-schedules.json"),
      classroomSchedules: readLegacyResourceArray("classroom-schedules.json"),
      courseSchedules: readLegacyResourceArray("course-schedules.json"),
      teachers: readLegacyResourceArray("teachers.json"),
      classrooms: readLegacyResourceArray("classrooms.json"),
      courses: readLegacyResourceArray("courses.json"),
    }),
  });
}

function countRelease(snapshot) {
  const catalog = snapshot.catalog || {};
  const resources = getResources(snapshot);
  const classSchedules = asArray(snapshot.classSchedules);
  const adminClassCount = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
  return {
    collegeCount: asArray(catalog.colleges).length,
    collegesCount: asArray(catalog.colleges).length,
    majorCount: asArray(snapshot.majors).length,
    majorsCount: asArray(snapshot.majors).length,
    classScheduleCount: classSchedules.length,
    adminClassCount,
    majorAggregateCount: classSchedules.length - adminClassCount,
    noScheduleMajorCount: snapshot.coverage?.noScheduleMajorCount || 0,
    teacherScheduleCount: resources.teacherSchedules.length,
    classroomScheduleCount: resources.classroomSchedules.length,
    courseScheduleCount: resources.courseSchedules.length,
  };
}

function stableScheduleId(kind, value, index) {
  const key = `${kind}:${String(value || "")}:${index}`;
  return cryptoHash(key).slice(0, 16);
}

function cryptoHash(value) {
  return require("crypto").createHash("sha1").update(String(value || "")).digest("hex");
}

function cryptoHashBuffer(buffer) {
  return require("crypto").createHash("sha1").update(buffer).digest("hex");
}

function getExistingPath(primaryPath, legacyPath) {
  if (primaryPath && fs.existsSync(primaryPath)) return primaryPath;
  if (legacyPath && fs.existsSync(legacyPath)) return legacyPath;
  return primaryPath || legacyPath;
}

function getExistingDir(primaryDir, legacyDir) {
  if (primaryDir && fs.existsSync(primaryDir)) return primaryDir;
  if (legacyDir && fs.existsSync(legacyDir)) return legacyDir;
  return primaryDir || legacyDir;
}

function toReleaseRelativePath(files, filePath) {
  return path.relative(files.releaseDir, filePath).replace(/\\/g, "/");
}

function getFileMeta(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  return {
    size: buffer.length,
    hash: cryptoHashBuffer(buffer),
  };
}

function collectJsonFiles(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return [];
  }
  const result = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push.apply(result, collectJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  });
  return result;
}

function buildReleasePackFilesMeta(files) {
  const meta = {};
  [
    files.indexDir,
    files.classScheduleDir,
    files.teacherScheduleDir,
    files.classroomScheduleDir,
    files.courseScheduleDir,
    files.emptyRoomDir,
  ].forEach((dirPath) => {
    collectJsonFiles(dirPath).forEach((filePath) => {
      const item = getFileMeta(filePath);
      if (item) {
        meta[toReleaseRelativePath(files, filePath)] = item;
      }
    });
  });
  return meta;
}

function sumMetaSize(filesMeta) {
  return Object.values(filesMeta || {}).reduce((sum, item) => sum + Number(item && item.size || 0), 0);
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root || "/";
}

function buildStaticReleaseUrls(version, derived) {
  const releaseVersion = normalizeVersion(version);
  const releaseBaseUrl = joinUrl(STATIC_RELEASE_BASE_URL, releaseVersion);
  const toUrl = (relativePath) => joinUrl(releaseBaseUrl, relativePath);
  const shards = derived && derived.shards ? derived.shards : {};
  const classShards = shards.class || {};
  const mapShardUrls = (items) => Object.fromEntries(Object.entries(items || {}).map(([key, relativePath]) => [key, toUrl(relativePath)]));
  return {
    staticBasePath: STATIC_RELEASE_BASE_PATH,
    staticBaseUrl: STATIC_RELEASE_BASE_URL,
    staticReleaseUrl: releaseBaseUrl,
    indexUrls: {
      class: toUrl("index/class/all.json"),
      teacher: toUrl("index/teacher/all.json"),
      classroom: toUrl("index/classroom/all.json"),
      course: toUrl("index/course/all.json"),
      legacy: {
        class: toUrl("index/class.json"),
        teacher: toUrl("index/teacher.json"),
        classroom: toUrl("index/classroom.json"),
        course: toUrl("index/course.json"),
      },
    },
    emptyRoomUrl: toUrl("empty-room/index.json"),
    detailUrlPattern: toUrl("detail/{type}/{id}.json"),
    shards: {
      class: {
        all: toUrl(classShards.all || "index/class/all.json"),
        byCollege: mapShardUrls(classShards.byCollege),
        byMajor: mapShardUrls(classShards.byMajor),
      },
    },
  };
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getReleaseCompressionConfig(env = process.env) {
  const precompress = String(env.FOSU_RELEASE_PRECOMPRESS || "gzip").trim().toLowerCase();
  const tokens = new Set(precompress.split(/[,;\s]+/).filter(Boolean));
  const gzip = precompress !== "none" && (tokens.size === 0 || tokens.has("gzip") || tokens.has("all"));
  const brRequested = tokens.has("br") || tokens.has("brotli") || tokens.has("all");
  const brotli = truthy(env.FOSU_RELEASE_BROTLI_ENABLED) && brRequested && Boolean(brotliCompressAsync);
  const rawConcurrency = Number(env.FOSU_RELEASE_COMPRESSION_CONCURRENCY || 1);
  const concurrency = Math.max(1, Math.min(8, Number.isFinite(rawConcurrency) ? Math.floor(rawConcurrency) : 1));
  return { precompress, gzip, br: brotli, concurrency };
}

function collectStaticReleaseSourceFiles(version, filesOverride) {
  const files = filesOverride || getReleaseFiles(version);
  const sourceFiles = [];
  if (fs.existsSync(files.manifestPath)) {
    sourceFiles.push(files.manifestPath);
  }
  [files.indexDir, files.detailDir, files.emptyRoomDir].forEach((dirPath) => {
    collectJsonFiles(dirPath).forEach((filePath) => sourceFiles.push(filePath));
  });
  const seen = new Set();
  return sourceFiles.filter((filePath) => {
    const key = path.resolve(filePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateStaticReleaseCompression(version, options = {}) {
  const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
  const files = collectStaticReleaseSourceFiles(version, options.files);
  if (options.includeManifest) {
    const manifestPath = (options.files || getReleaseFiles(version)).manifestPath;
    if (!files.some((filePath) => path.resolve(filePath) === path.resolve(manifestPath))) {
      files.push(manifestPath);
    }
  }
  return {
    gzip: Boolean(config.gzip && files.length),
    br: Boolean(config.br && files.length),
    files: files.length,
    concurrency: config.concurrency,
    precompress: config.precompress,
  };
}

function compressStaticJsonFile(filePath, options = {}) {
  const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
  const result = { gzip: false, br: false };
  if (!filePath || !fs.existsSync(filePath) || !filePath.endsWith(".json")) {
    return result;
  }
  const buffer = fs.readFileSync(filePath);
  if (config.gzip) {
    fs.writeFileSync(`${filePath}.gz`, zlib.gzipSync(buffer));
    result.gzip = true;
  }
  if (config.br && typeof zlib.brotliCompressSync === "function") {
    try {
      fs.writeFileSync(`${filePath}.br`, zlib.brotliCompressSync(buffer));
      result.br = true;
    } catch (error) {
      safeLog("release-brotli-compress-failed", { filePath, error: error.message });
    }
  }
  return result;
}

async function compressStaticJsonFileAsync(filePath, options = {}) {
  const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
  const result = { gzip: false, br: false };
  if (!filePath || !fs.existsSync(filePath) || !filePath.endsWith(".json")) {
    return result;
  }
  const buffer = await fs.promises.readFile(filePath);
  if (config.gzip) {
    await fs.promises.writeFile(`${filePath}.gz`, await gzipAsync(buffer));
    result.gzip = true;
  }
  if (config.br && brotliCompressAsync) {
    try {
      await fs.promises.writeFile(`${filePath}.br`, await brotliCompressAsync(buffer));
      result.br = true;
    } catch (error) {
      safeLog("release-brotli-compress-failed", { filePath, error: error.message });
    }
  }
  return result;
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function mirrorStaticReleaseFiles(version, options = {}) {
  const files = options.files || getReleaseFiles(version);
  ensureDir(files.publicReleaseDir);
  const sourceFiles = collectStaticReleaseSourceFiles(version, files);

  const compression = { gzip: false, br: false, files: 0 };
  sourceFiles.forEach((sourcePath) => {
    const relativePath = toReleaseRelativePath(files, sourcePath);
    const targetPath = path.join(files.publicReleaseDir, relativePath);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    const item = compressStaticJsonFile(targetPath, options);
    compression.gzip = compression.gzip || item.gzip;
    compression.br = compression.br || item.br;
    compression.files += 1;
  });
  compression.concurrency = 1;
  compression.precompress = getReleaseCompressionConfig().precompress;
  return compression;
}

async function mirrorStaticReleaseFilesAsync(version, options = {}) {
  const files = options.files || getReleaseFiles(version);
  ensureDir(files.publicReleaseDir);
  const sourceFiles = collectStaticReleaseSourceFiles(version, files);
  const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
  const compression = {
    gzip: false,
    br: false,
    files: 0,
    concurrency: config.concurrency,
    precompress: config.precompress,
  };
  let processed = 0;
  await runWithConcurrency(sourceFiles, config.concurrency, async (sourcePath) => {
    const relativePath = toReleaseRelativePath(files, sourcePath);
    const targetPath = path.join(files.publicReleaseDir, relativePath);
    ensureDir(path.dirname(targetPath));
    await fs.promises.copyFile(sourcePath, targetPath);
    const item = await compressStaticJsonFileAsync(targetPath, { compression: config });
    compression.gzip = compression.gzip || item.gzip;
    compression.br = compression.br || item.br;
    compression.files += 1;
    processed += 1;
    if (typeof options.onProgress === "function") {
      options.onProgress({
        processed,
        total: sourceFiles.length,
        relativePath,
        gzip: item.gzip,
        br: item.br,
      });
    }
  });
  return compression;
}

function safeScheduleId(kind, value, fallbackValue, index) {
  const raw = String(value || "").trim();
  const fallback = stableScheduleId(kind, fallbackValue || raw, index);
  const safe = raw
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!safe || safe.length > 80) {
    return fallback;
  }
  return safe;
}

function getFirstText(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
      return String(item[key]).trim();
    }
  }
  return "";
}

function summarizeCourses(schedule) {
  const courses = Array.isArray(schedule?.courses) ? schedule.courses : [];
  return {
    courseCount: courses.length,
    firstCourseName: getFirstText(courses[0], ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"]),
  };
}

function stripDebugCourseFields(course) {
  if (!course || typeof course !== "object") {
    return course;
  }
  const copy = Object.assign({}, course);
  delete copy.rawHtml;
  delete copy.rawCellHtml;
  delete copy.sourceHtml;
  delete copy.debugHtml;
  return copy;
}

function dictIndex(dict, value) {
  const text = String(value || "").trim();
  if (!text) return -1;
  const existing = dict.indexOf(text);
  if (existing >= 0) return existing;
  dict.push(text);
  return dict.length - 1;
}

function compactWeekValue(course) {
  if (Array.isArray(course.weeks) && course.weeks.length) {
    return course.weeks.join(",");
  }
  if (course.weekMask !== undefined && course.weekMask !== null) {
    return String(course.weekMask);
  }
  if (course.weekText) {
    return String(course.weekText);
  }
  if (course.startWeek || course.endWeek) {
    return `${course.startWeek || ""}-${course.endWeek || ""}`;
  }
  return "";
}

function buildCompactSchedulePayload(payload) {
  const sourceCourses = asArray(payload.courses);
  if (!sourceCourses.length) {
    return null;
  }
  const courseDict = [];
  const teacherDict = [];
  const roomDict = [];
  const classDict = [];
  const collegeDict = [];
  const majorDict = [];
  const scheduleClassIndex = dictIndex(classDict, payload.className || payload.name || "");
  const scheduleCollegeIndex = dictIndex(collegeDict, payload.collegeName || payload.college || "");
  const scheduleMajorIndex = dictIndex(majorDict, payload.majorName || "");
  const courses = sourceCourses.map((course) => ({
    n: dictIndex(courseDict, getFirstText(course, ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"])),
    t: dictIndex(teacherDict, getFirstText(course, ["displayTeacherName", "canonicalTeacherName", "teacherName", "teacher"])),
    r: dictIndex(roomDict, getFirstText(course, ["displayClassroom", "canonicalClassroom", "classroom", "roomName", "location"])),
    c: dictIndex(classDict, course.className || payload.className || payload.name || ""),
    g: dictIndex(collegeDict, course.collegeName || payload.collegeName || payload.college || ""),
    m: dictIndex(majorDict, course.majorName || payload.majorName || ""),
    d: Number(course.weekday || 0) || 0,
    s: Number(course.startSection || 0) || 0,
    e: Number(course.endSection || 0) || 0,
    w: compactWeekValue(course),
  }));
  return {
    schemaVersion: 1,
    fields: ["n", "t", "r", "c", "g", "m", "d", "s", "e", "w"],
    dictionaries: {
      courseDict,
      teacherDict,
      roomDict,
      classDict,
      collegeDict,
      majorDict,
    },
    scheduleRefs: {
      className: scheduleClassIndex,
      collegeName: scheduleCollegeIndex,
      majorName: scheduleMajorIndex,
    },
    courses,
  };
}

function buildSchedulePayload(schedule, extra) {
  const payload = Object.assign({}, schedule || {}, extra || {});
  if (Array.isArray(payload.courses)) {
    payload.courses = payload.courses.map(stripDebugCourseFields);
  }
  const compact = buildCompactSchedulePayload(payload);
  if (compact) {
    payload.compact = compact;
  }
  return payload;
}

function buildClassDerivedFiles(snapshot, files, onlyIndexes = false) {
  ensureDir(files.classScheduleDir);
  const index = asArray(snapshot.classSchedules).map((item, position) => {
    const name = getFirstText(item, ["className", "title", "name"]) || `class-${position + 1}`;
    const id = safeScheduleId("class", item.classId || item.id, `${snapshot.semester}:${name}`, position);
    const summary = summarizeCourses(item);
    if (!onlyIndexes) {
      const payload = buildSchedulePayload(item, { id });
      writeJsonAtomic(path.join(files.classScheduleDir, `${id}.json`), payload);
    }
    return {
      id,
      name,
      className: name,
      semester: item.semester || snapshot.semester || "",
      collegeCode: item.collegeCode || "",
      collegeName: item.collegeName || "",
      grade: item.grade || "",
      majorCode: item.majorCode || "",
      majorName: item.majorName || "",
      displayType: item.displayType || "",
      isAggregated: !!item.isAggregated,
      courseCount: summary.courseCount,
      firstCourseName: summary.firstCourseName,
      updatedAt: item.updatedAt || snapshot.updatedAt || "",
    };
  });
  writeJsonAtomic(files.classesIndexPath, index);
  return index;
}

function normalizeSearchText(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3002/g, ".")
    .toLowerCase();
}

function compactKeywordList(values) {
  const seen = new Set();
  return (values || [])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value == null ? "" : value).trim())
    .filter((value) => {
      if (!value) return false;
      const key = normalizeSearchText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildNamedScheduleDerivedFiles(snapshot, files, kind, schedules, names, nameKeys, dirPath, indexPath, onlyIndexes = false) {
  ensureDir(dirPath);
  const scheduleByName = new Map();
  asArray(schedules).forEach((schedule, index) => {
    const name = getFirstText(schedule, nameKeys);
    if (!name) return;
    if (!scheduleByName.has(name)) {
      scheduleByName.set(name, { schedule, index });
    }
  });

  const seen = new Set();
  const index = [];
  const addItem = (source, sourceIndex) => {
    const name = getFirstText(source, nameKeys);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const matched = scheduleByName.get(name);
    const schedule = matched ? matched.schedule : Object.assign({}, source, { courses: [] });
    const id = safeScheduleId(kind, source.id || source[`${kind}Id`] || schedule.id, `${snapshot.semester}:${name}`, sourceIndex);
    const summary = summarizeCourses(schedule);
    const keywords = compactKeywordList([
      source.id,
      schedule.id,
      name,
      source.name,
      source.displayName,
      source.title,
      source.teacherTitle,
      source.professionalTitle,
      source.rawName,
      schedule.name,
      schedule.displayName,
      schedule.title,
      schedule.teacherTitle,
      schedule.professionalTitle,
      schedule.rawName,
      summary.firstCourseName,
      asArray(schedule.courses).slice(0, 20).map((course) => [
        course.teacherName,
        course.displayTeacherName,
        course.canonicalTeacherName,
        course.courseName,
        course.displayCourseName,
        course.canonicalCourseName,
      ]),
    ]);
    if (!onlyIndexes) {
      writeJsonAtomic(path.join(dirPath, `${id}.json`), buildSchedulePayload(schedule, { id }));
    }
    index.push({
      id,
      name,
      [`${kind}Name`]: name,
      displayName: source.displayName || schedule.displayName || name,
      rawName: source.rawName || schedule.rawName || "",
      title: source.title || schedule.title || "",
      teacherTitle: source.teacherTitle || schedule.teacherTitle || "",
      professionalTitle: source.professionalTitle || schedule.professionalTitle || "",
      searchableName: normalizeSearchText(name),
      keywords,
      semester: schedule.semester || snapshot.semester || "",
      collegeCode: source.collegeCode || schedule.collegeCode || "",
      collegeName: source.collegeName || schedule.collegeName || "",
      campus: source.campus || schedule.campus || "",
      source: source.source || schedule.source || "derived",
      hasDetail: !onlyIndexes,
      courseCount: summary.courseCount,
      firstCourseName: summary.firstCourseName,
      updatedAt: schedule.updatedAt || snapshot.updatedAt || "",
    });
  };

  asArray(names).forEach(addItem);
  asArray(schedules).forEach((schedule, indexNum) => addItem(schedule, indexNum));
  writeJsonAtomic(indexPath, index);
  return index;
}

const MAX_EMPTY_ROOM_SECTION = 14;
const MAX_EMPTY_ROOM_WEEK = 30;

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value == null ? "" : value).match(/\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

function uniqueNumbers(values, min, max) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const num = toInteger(value);
    if (Number.isFinite(num) && num >= min && num <= max && !seen.has(num)) {
      seen.add(num);
      result.push(num);
    }
  });
  return result.sort((left, right) => left - right);
}

function rangeNumbers(start, end, min, max) {
  const first = toInteger(start);
  const last = toInteger(end);
  if (!Number.isFinite(first)) {
    return [];
  }
  if (!Number.isFinite(last)) {
    return uniqueNumbers([first], min, max);
  }
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  const values = [];
  for (let value = low; value <= high; value += 1) {
    values.push(value);
  }
  return uniqueNumbers(values, min, max);
}

function allSections() {
  return rangeNumbers(1, MAX_EMPTY_ROOM_SECTION, 1, MAX_EMPTY_ROOM_SECTION);
}

function allWeeks() {
  return rangeNumbers(1, MAX_EMPTY_ROOM_WEEK, 1, MAX_EMPTY_ROOM_WEEK);
}

function parseChineseWeekday(text) {
  const value = String(text == null ? "" : text);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const match = value.match(/[一二三四五六日天]/);
  return match ? map[match[0]] : NaN;
}

function normalizeWeekday(value, key) {
  const chinese = parseChineseWeekday(value);
  if (Number.isFinite(chinese)) {
    return chinese;
  }
  const num = toInteger(value);
  if (!Number.isFinite(num)) {
    return NaN;
  }
  if (key === "dayIndex" && num >= 0 && num <= 6) {
    return num + 1;
  }
  return num >= 1 && num <= 7 ? num : NaN;
}

function parseSectionSequence(text) {
  const source = String(text == null ? "" : text);
  const raw = source.match(/\d{1,2}/g) || [];
  const nums = raw.map((item) => parseInt(item, 10)).filter((num) => Number.isFinite(num));
  if (nums.length === 2 && /[-~～至到]/.test(source)) {
    return rangeNumbers(nums[0], nums[1], 1, MAX_EMPTY_ROOM_SECTION);
  }
  return uniqueNumbers(nums, 1, MAX_EMPTY_ROOM_SECTION);
}

function parseSectionText(text) {
  const source = String(text == null ? "" : text);
  const sections = [];
  const patterns = [
    /[\[【(（]\s*(\d{1,2}(?:\s*[-,，、~～至到]\s*\d{1,2})*)\s*[\]】)）]\s*节?/g,
    /第\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/g,
    /(?:^|[^\dA-Za-z])(\d{1,2}(?:\s*[-~～]\s*\d{1,2})+)\s*节/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[2]) {
        sections.push(...rangeNumbers(match[1], match[2], 1, MAX_EMPTY_ROOM_SECTION));
      } else {
        sections.push(...parseSectionSequence(match[1]));
      }
    }
  });
  return uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
}

function parseWeekText(text) {
  const source = String(text == null ? "" : text);
  if (!source) {
    return [];
  }
  if (source.includes("单周")) {
    return uniqueNumbers(Array.from({ length: 15 }, (_, index) => index * 2 + 1), 1, MAX_EMPTY_ROOM_WEEK);
  }
  if (source.includes("双周")) {
    return uniqueNumbers(Array.from({ length: 15 }, (_, index) => (index + 1) * 2), 1, MAX_EMPTY_ROOM_WEEK);
  }
  if (!source.includes("周")) {
    return [];
  }

  const weeks = [];
  const re = /(\d{1,2})(?:\s*[-~～至到]\s*(\d{1,2}))?\s*周/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[2]) {
      weeks.push(...rangeNumbers(match[1], match[2], 1, MAX_EMPTY_ROOM_WEEK));
    } else {
      weeks.push(toInteger(match[1]));
    }
  }
  return uniqueNumbers(weeks, 1, MAX_EMPTY_ROOM_WEEK);
}

function normalizeCourseSlot(course) {
  const source = course && typeof course === "object" ? course : {};
  const weekdayKeys = ["weekday", "weekDay", "dayOfWeek", "day", "xqj", "dayIndex"];
  let weekday = NaN;
  for (const key of weekdayKeys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      weekday = normalizeWeekday(source[key], key);
      if (Number.isFinite(weekday)) break;
    }
  }

  let sections = [];
  if (Array.isArray(source.sections)) {
    sections = uniqueNumbers(source.sections, 1, MAX_EMPTY_ROOM_SECTION);
  }
  if (sections.length === 0) {
    sections = uniqueNumbers([source.section, source.sectionIndex], 1, MAX_EMPTY_ROOM_SECTION);
  }
  const sectionPairs = [
    ["startSection", "endSection"],
    ["sectionStart", "sectionEnd"],
    ["start", "end"],
  ];
  for (const pair of sectionPairs) {
    if (sections.length) break;
    if (source[pair[0]] !== undefined || source[pair[1]] !== undefined) {
      sections = rangeNumbers(source[pair[0]], source[pair[1]], 1, MAX_EMPTY_ROOM_SECTION);
    }
  }
  if (sections.length === 0) {
    ["section", "sectionIndex", "sectionText", "sectionsText", "rawSection", "rawSections", "timeText", "period", "periodText", "rawText"].some((key) => {
      sections = parseSectionText(source[key]);
      if (sections.length === 0 && /[-,，、~～至到]/.test(String(source[key] == null ? "" : source[key]))) {
        sections = parseSectionSequence(source[key]);
      }
      return sections.length > 0;
    });
  }

  let weeks = [];
  ["weeks", "weekList", "weekNumbers"].some((key) => {
    if (Array.isArray(source[key])) {
      weeks = uniqueNumbers(source[key], 1, MAX_EMPTY_ROOM_WEEK);
      return weeks.length > 0;
    }
    return false;
  });
  if (weeks.length === 0) {
    const weekPairs = [
      ["startWeek", "endWeek"],
      ["weekStart", "weekEnd"],
    ];
    weekPairs.some((pair) => {
      if (source[pair[0]] !== undefined || source[pair[1]] !== undefined) {
        weeks = rangeNumbers(source[pair[0]], source[pair[1]], 1, MAX_EMPTY_ROOM_WEEK);
        return weeks.length > 0;
      }
      return false;
    });
  }
  if (weeks.length === 0) {
    ["weeksText", "rawWeeks", "weekRange", "weekText", "rawText"].some((key) => {
      weeks = parseWeekText(source[key]);
      return weeks.length > 0;
    });
  }

  return {
    weekday: Number.isFinite(weekday) ? weekday : null,
    sections,
    weeks: weeks.length ? weeks : allWeeks(),
  };
}

function getScheduleCourses(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return [];
  }
  const keys = ["courses", "items", "schedule", "lessons", "courseList"];
  for (const key of keys) {
    if (Array.isArray(schedule[key])) {
      return schedule[key];
    }
  }
  return [];
}

function getClassroomNameFromSchedule(schedule, index) {
  const name = getFirstText(schedule, ["roomName", "classroomName", "classroom", "name", "title"]);
  return name || `classroom-${index + 1}`;
}

function getClassroomNameFromCourse(course) {
  return getFirstText(course, [
    "classroom",
    "displayClassroom",
    "canonicalClassroom",
    "rawClassroom",
    "roomName",
    "room",
    "location",
    "venue",
  ]);
}

function deriveClassroomSchedulesFromClassSchedules(classSchedules) {
  const rooms = new Map();
  asArray(classSchedules).forEach((schedule) => {
    getScheduleCourses(schedule).forEach((course) => {
      const roomName = getClassroomNameFromCourse(course);
      if (!roomName) return;
      if (!rooms.has(roomName)) {
        rooms.set(roomName, { roomName, courses: [], source: "classSchedules-derived" });
      }
      rooms.get(roomName).courses.push(course);
    });
  });
  return Array.from(rooms.values());
}

function inferBuilding(roomName) {
  const normalized = normalizeBuilding(roomName);
  return isUnknownBuilding(normalized) ? UNKNOWN_BUILDING_NAME : normalized.buildingCode;
}

function getCourseDisplayName(course) {
  return getFirstText(course, ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"]);
}

function normalizeEmptyRoomCourse(course) {
  const slot = normalizeCourseSlot(course);
  if (!slot.weekday || !slot.sections.length) {
    return null;
  }
  return {
    courseName: getCourseDisplayName(course),
    teacherName: getFirstText(course, ["displayTeacherName", "canonicalTeacherName", "teacherName", "teacher"]),
    weekday: slot.weekday,
    weeks: slot.weeks,
    sections: slot.sections,
    startSection: slot.sections[0],
    endSection: slot.sections[slot.sections.length - 1],
  };
}

function sanitizeShardName(value) {
  const safe = String(value || "unknown")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "unknown";
}

function buildIndexPayload(type, items, snapshot) {
  const list = Array.isArray(items) ? items : [];
  const version = normalizeVersion(snapshot.version || snapshot.releaseVersion || "");
  return {
    success: true,
    schemaVersion: 1,
    type,
    term: snapshot.term || snapshot.semester || "",
    semester: snapshot.semester || snapshot.term || "",
    releaseVersion: version,
    version,
    updatedAt: snapshot.updatedAt || snapshot.generatedAt || new Date().toISOString(),
    total: list.length,
    items: list,
  };
}

function toLightClassIndexItem(item) {
  return {
    id: item.id,
    name: item.name || item.className || "",
    className: item.className || item.name || "",
    college: item.college || item.collegeName || "",
    collegeCode: item.collegeCode || "",
    collegeName: item.collegeName || item.college || "",
    grade: item.grade || "",
    major: item.major || item.majorName || "",
    majorCode: item.majorCode || "",
    majorName: item.majorName || item.major || "",
    courseCount: Number(item.courseCount || item.count || 0) || 0,
    displayType: item.displayType || "",
    isAggregated: Boolean(item.isAggregated),
    firstCourseName: item.firstCourseName || "",
    semester: item.semester || "",
    updatedAt: item.updatedAt || "",
  };
}

function groupBy(items, getKey) {
  const grouped = new Map();
  (items || []).forEach((item) => {
    const key = String(getKey(item) || "").trim();
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });
  return grouped;
}

function writeIndexShardFiles(snapshot, files, indexes) {
  const classes = (indexes.classes || []).map(toLightClassIndexItem);
  const shards = {
    class: {
      all: "index/class/all.json",
      byCollege: {},
      byMajor: {},
    },
    teacher: { all: "index/teacher/all.json" },
    classroom: { all: "index/classroom/all.json" },
    course: { all: "index/course/all.json" },
  };

  writeJsonAtomic(files.classIndexAllPath, buildIndexPayload("class", classes, snapshot));
  writeJsonAtomic(files.teacherIndexAllPath, buildIndexPayload("teacher", indexes.teachers || [], snapshot));
  writeJsonAtomic(files.classroomIndexAllPath, buildIndexPayload("classroom", indexes.classrooms || [], snapshot));
  writeJsonAtomic(files.courseIndexAllPath, buildIndexPayload("course", indexes.courses || [], snapshot));

  groupBy(classes, (item) => item.collegeCode || item.collegeName).forEach((items, key) => {
    const fileName = `${sanitizeShardName(key)}.json`;
    const relative = `index/class/by-college/${fileName}`;
    writeJsonAtomic(path.join(files.classIndexByCollegeDir, fileName), buildIndexPayload("class", items, snapshot));
    shards.class.byCollege[key] = relative;
  });

  groupBy(classes, (item) => [item.collegeCode || item.collegeName, item.grade, item.majorCode || item.majorName].filter(Boolean).join("-"))
    .forEach((items, key) => {
      const fileName = `${sanitizeShardName(key)}.json`;
      const relative = `index/class/by-major/${fileName}`;
      writeJsonAtomic(path.join(files.classIndexByMajorDir, fileName), buildIndexPayload("class", items, snapshot));
      shards.class.byMajor[key] = relative;
    });

  return shards;
}

function mergeEmptyRoomSchedules(classroomSchedules, classSchedules) {
  const rooms = new Map();
  const addSchedule = (schedule, source, index) => {
    const roomName = getClassroomNameFromSchedule(schedule, index);
    if (!roomName || roomName === "未知") return;
    const existing = rooms.get(roomName);
    const courses = getScheduleCourses(schedule);
    if (existing) {
      if (existing.source !== "classroomSchedules" && source === "classroomSchedules") {
        existing.source = "classroomSchedules";
        existing.capacity = schedule.capacity || schedule.seatCount || existing.capacity || null;
        existing.roomId = schedule.roomId || schedule.id || existing.roomId || "";
      }
      existing.courses = existing.courses.concat(courses);
      return;
    }
    rooms.set(roomName, {
      roomName,
      roomId: schedule.roomId || schedule.id || "",
      capacity: schedule.capacity || schedule.seatCount || null,
      courses: courses.slice(),
      source,
    });
  };

  asArray(classroomSchedules).forEach((schedule, index) => addSchedule(schedule, "classroomSchedules", index));
  deriveClassroomSchedulesFromClassSchedules(classSchedules).forEach((schedule, index) => {
    addSchedule(schedule, "classSchedules-derived", index);
  });
  return Array.from(rooms.values());
}

function buildClassroomDetailLookup(classroomIndex) {
  const lookup = new Map();
  asArray(classroomIndex).forEach((item) => {
    [
      item.roomName,
      item.classroomName,
      item.displayName,
      item.name,
      item.title,
    ].forEach((name) => {
      const key = normalizeSearchText(name);
      if (key && !lookup.has(key)) {
        lookup.set(key, item);
      }
    });
  });
  return lookup;
}

function buildEmptyRoomDerivedFiles(snapshot, files, classroomIndex = []) {
  ensureDir(path.dirname(files.emptyRoomIndexPath));
  const resources = getResources(snapshot);
  const sourceSchedules = mergeEmptyRoomSchedules(resources.classroomSchedules, snapshot.classSchedules);
  const classroomLookup = buildClassroomDetailLookup(classroomIndex);
  const version = normalizeVersion(snapshot.version || snapshot.releaseVersion || "");

  const rooms = asArray(sourceSchedules).map((schedule, index) => {
    const roomName = getClassroomNameFromSchedule(schedule, index);
    const roomId = safeScheduleId("empty-room", schedule.roomId || schedule.id || roomName, `${snapshot.semester}:${roomName}`, index);
    const courses = getScheduleCourses(schedule)
      .map(normalizeEmptyRoomCourse)
      .filter(Boolean);
    const building = normalizeBuilding(roomName);
    const normalizedRoomName = normalizeSearchText(roomName);
    const classroomIndexItem = classroomLookup.get(normalizedRoomName) || null;
    const detailId = classroomIndexItem && classroomIndexItem.id ? classroomIndexItem.id : "";
    return {
      roomId,
      roomName,
      normalizedRoomName,
      classroomId: detailId,
      detailId,
      releaseVersion: version,
      hasScheduleDetail: Boolean(detailId),
      building: isUnknownBuilding(building) ? UNKNOWN_BUILDING_NAME : building.buildingCode,
      buildingCode: building.buildingCode || UNKNOWN_BUILDING_CODE,
      buildingName: building.buildingName || UNKNOWN_BUILDING_NAME,
      campus: schedule.campus || building.campus || "",
      confidence: building.confidence,
      source: schedule.source || "classroomSchedules",
      capacity: schedule.capacity || schedule.seatCount || null,
      courseCount: courses.length,
      courses,
    };
  }).filter((room) => room.roomName && room.roomName !== "未知");

  const buildings = Array.from(new Set(rooms.map((room) => room.building).filter(Boolean)))
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"));
  const unknownRooms = rooms.filter((room) => room.buildingCode === UNKNOWN_BUILDING_CODE || room.building === UNKNOWN_BUILDING_NAME);
  const health = {
    classroomCount: rooms.length,
    buildingCount: buildings.length,
    unknownRoomCount: unknownRooms.length,
    unknownRoomSamples: unknownRooms.slice(0, 20).map((room) => room.roomName),
    scheduleDetailCount: rooms.filter((room) => room.hasScheduleDetail).length,
    sources: {
      classroomSchedules: rooms.filter((room) => room.source === "classroomSchedules").length,
      classSchedulesDerived: rooms.filter((room) => room.source === "classSchedules-derived").length,
    },
  };
  const index = {
    success: true,
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: snapshot.term || snapshot.semester || "",
    semester: snapshot.semester || snapshot.term || "",
    termStartDate: snapshot.termStartDate || "",
    updatedAt: snapshot.updatedAt || snapshot.generatedAt || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    buildings,
    health,
    rooms,
  };
  writeJsonAtomic(files.emptyRoomIndexPath, index);
  return index;
}

function writeDerivedIndexes(snapshot, files, onlyIndexes = false) {
  const resources = getResources(snapshot);
  const classes = buildClassDerivedFiles(snapshot, files, onlyIndexes);
  const teachers = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "teacher",
    resources.teacherSchedules,
    resources.teachers,
    ["teacherName", "name", "title"],
    files.teacherScheduleDir,
    files.teachersIndexPath,
    onlyIndexes
  );
  const classrooms = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "classroom",
    resources.classroomSchedules,
    resources.classrooms,
    ["roomName", "classroomName", "classroom", "name"],
    files.classroomScheduleDir,
    files.classroomsIndexPath,
    onlyIndexes
  );
  const courses = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "course",
    resources.courseSchedules,
    resources.courses,
    ["courseName", "displayCourseName", "canonicalCourseName", "name", "title"],
    files.courseScheduleDir,
    files.coursesIndexPath,
    onlyIndexes
  );
  const emptyRooms = buildEmptyRoomDerivedFiles(snapshot, files, classrooms);
  const shards = writeIndexShardFiles(snapshot, files, { classes, teachers, classrooms, courses });
  return { classes, teachers, classrooms, courses, emptyRooms, shards };
}

function hasCourseTiming(course) {
  return course.weekday !== undefined ||
    course.dayOfWeek !== undefined ||
    course.week !== undefined;
}

function hasCourseSections(course) {
  return course.startSection !== undefined &&
    course.endSection !== undefined;
}

function hasCourseName(course) {
  return Boolean(
    course.courseName ||
    course.displayCourseName ||
    course.canonicalCourseName ||
    course.name ||
    course.title
  );
}

function validateCourse(course, location) {
  if (!course || typeof course !== "object") {
    return `${location}: course must be an object`;
  }
  if (!hasCourseTiming(course)) {
    return `${location}: missing weekday/dayOfWeek`;
  }
  if (!hasCourseSections(course)) {
    return `${location}: missing startSection/endSection`;
  }
  if (!hasCourseName(course)) {
    return `${location}: missing courseName/displayCourseName`;
  }
  return "";
}

function validateScheduleList(list, label, requireClassName) {
  const errors = [];
  asArray(list).forEach((schedule, index) => {
    if (!schedule || typeof schedule !== "object") {
      errors.push(`${label}[${index}] must be an object`);
      return;
    }
    if (requireClassName && !(schedule.className || schedule.title || schedule.name)) {
      errors.push(`${label}[${index}] missing className/title`);
    }
    if (!Array.isArray(schedule.courses)) {
      errors.push(`${label}[${index}].courses must be an array`);
      return;
    }
    schedule.courses.forEach((course, courseIndex) => {
      const courseError = validateCourse(course, `${label}[${index}].courses[${courseIndex}]`);
      if (courseError) {
        errors.push(courseError);
      }
    });
  });
  return errors;
}

function validateReleaseSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== "object") {
    return {
      valid: false,
      errors: ["snapshot must be an object"],
      counts: {},
    };
  }

  if (!snapshot.catalog || !Array.isArray(snapshot.catalog.colleges) || snapshot.catalog.colleges.length <= 0) {
    errors.push("catalog.colleges.length must be greater than 0");
  }
  if (!Array.isArray(snapshot.majors) || snapshot.majors.length <= 0) {
    errors.push("majorsCount must be greater than 0");
  }
  if (!Array.isArray(snapshot.classSchedules) || snapshot.classSchedules.length <= 0) {
    errors.push("classScheduleCount must be greater than 0");
  }

  errors.push.apply(errors, validateScheduleList(snapshot.classSchedules, "classSchedules", true));

  const resources = getResources(snapshot);
  errors.push.apply(errors, validateScheduleList(resources.teacherSchedules, "resources.teacherSchedules", false));
  errors.push.apply(errors, validateScheduleList(resources.classroomSchedules, "resources.classroomSchedules", false));
  errors.push.apply(errors, validateScheduleList(resources.courseSchedules, "resources.courseSchedules", false));

  return {
    valid: errors.length === 0,
    errors,
    counts: countRelease(snapshot),
  };
}

function buildBootstrap(snapshot, version, counts) {
  const updatedAt = snapshot.updatedAt || new Date().toISOString();
  return {
    success: true,
    dataSource: "snapshot",
    updatedAt,
    version,
    semester: snapshot.semester,
    catalog: snapshot.catalog || {},
    counts,
    versions: {
      snapshot: version,
      catalog: version,
      majors: version,
      classSchedules: version,
      resources: version,
    },
    metaDetails: {
      source: snapshot.source || "local-sync-client",
      disclaimer: snapshot.disclaimer || "本工具为个人开发，非学校官方服务。课程数据由开发者整理维护及用户反馈修正，仅供参考，具体安排请以任课教师通知及正式通知为准。",
      catalogUpdatedAt: updatedAt,
      majorsUpdatedAt: updatedAt,
      classSchedulesUpdatedAt: updatedAt,
      resourcesUpdatedAt: updatedAt,
    },
  };
}

function buildManifest(snapshot, version, counts, validation, files, derived) {
  const updatedAt = snapshot.updatedAt || new Date().toISOString();
  const filesMeta = files ? buildReleasePackFilesMeta(files) : {};
  const staticUrls = buildStaticReleaseUrls(version, derived);
  const fingerprint = calculateFingerprint(snapshot);
  return {
    success: true,
    schemaVersion: 2,
    releasePackSchemaVersion: 1,
    term: snapshot.term || snapshot.semester || "",
    releaseVersion: version,
    version,
    semester: snapshot.semester || snapshot.term || "",
    updatedAt,
    cacheEpoch: new Date(updatedAt).getTime() || Date.now(),
    dataEpoch: new Date(updatedAt).getTime() || Date.now(),
    forceRefreshToken: `${version}:${new Date(updatedAt).getTime() || Date.now()}`,
    minClientCacheSchema: 5,
    source: snapshot.source || "local-sync-client",
    canonicalHash: fingerprint.canonicalHash,
    counts,
    files: filesMeta,
    staticBasePath: staticUrls.staticBasePath,
    staticBaseUrl: staticUrls.staticBaseUrl,
    staticReleaseUrl: staticUrls.staticReleaseUrl,
    indexUrls: staticUrls.indexUrls,
    emptyRoomUrl: staticUrls.emptyRoomUrl,
    detailUrlPattern: staticUrls.detailUrlPattern,
    shards: staticUrls.shards,
    compression: {
      gzip: true,
      br: typeof zlib.brotliCompressSync === "function",
    },
    size: {
      snapshotBytes: files && fs.existsSync(files.snapshotPath) ? fs.statSync(files.snapshotPath).size : 0,
      packBytes: sumMetaSize(filesMeta),
      indexBytes: ["index/class.json", "index/teacher.json", "index/classroom.json", "index/course.json"]
        .reduce((sum, key) => sum + Number(filesMeta[key]?.size || 0), 0),
      detailBytes: Object.keys(filesMeta)
        .filter((key) => key.startsWith("detail/"))
        .reduce((sum, key) => sum + Number(filesMeta[key]?.size || 0), 0),
      emptyRoomBytes: Number(filesMeta["empty-room/index.json"]?.size || 0),
    },
    packHealth: {
      valid: validation.valid,
      errors: validation.errors,
      emptyRoom: derived?.emptyRooms?.health || {},
      teacher: {
        teacherIndexCount: Array.isArray(derived?.teachers) ? derived.teachers.length : 0,
        teacherDetailCount: collectJsonFiles(files?.teacherScheduleDir).length,
        directTeacherScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => item.source === "direct").length : 0,
        derivedTeacherScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => !item.source || item.source === "derived" || item.source === "classSchedules-derived").length : 0,
        teacherSourceMode: snapshot.meta?.resourceSource || "derived",
        teacherUnknownNameCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => !item.teacherName && !item.name).length : 0,
        teacherEmptyScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => Number(item.courseCount || 0) <= 0).length : 0,
      },
    },
    pack: {
      index: {
        class: Array.isArray(derived?.classes) ? derived.classes.length : 0,
        teacher: Array.isArray(derived?.teachers) ? derived.teachers.length : 0,
        classroom: Array.isArray(derived?.classrooms) ? derived.classrooms.length : 0,
        course: Array.isArray(derived?.courses) ? derived.courses.length : 0,
      },
      detail: {
        class: collectJsonFiles(files?.classScheduleDir).length,
        teacher: collectJsonFiles(files?.teacherScheduleDir).length,
        classroom: collectJsonFiles(files?.classroomScheduleDir).length,
        course: collectJsonFiles(files?.courseScheduleDir).length,
      },
      emptyRoom: {
        exists: Boolean(files && fs.existsSync(files.emptyRoomIndexPath)),
        rooms: Array.isArray(derived?.emptyRooms?.rooms) ? derived.emptyRooms.rooms.length : 0,
      },
    },
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      validatedAt: new Date().toISOString(),
    },
  };
}

function coerceSnapshot(rawSnapshot) {
  const snapshot = Object.assign({}, rawSnapshot || {});
  snapshot.version = normalizeVersion(snapshot.version || generateReleaseVersion());
  snapshot.updatedAt = snapshot.updatedAt || new Date().toISOString();
  snapshot.resources = getResources(snapshot);
  snapshot.coverage = Object.assign({}, snapshot.coverage || {}, countRelease(snapshot));
  return snapshot;
}

function writeReleaseSnapshot(rawSnapshot) {
  ensureStorageDirs();
  const snapshot = coerceSnapshot(rawSnapshot);
  const version = snapshot.version;
  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
    err.validation = validation;
    throw err;
  }

  const files = getReleaseFiles(version);
  const bootstrap = buildBootstrap(snapshot, version, validation.counts);
  writeJsonAtomic(files.snapshotPath, snapshot);
  writeJsonAtomic(files.bootstrapPath, bootstrap);
  writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
  writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
  const derived = writeDerivedIndexes(snapshot, files);
  const manifest = buildManifest(snapshot, version, validation.counts, validation, files, derived);
  manifest.compression = Object.assign({}, manifest.compression || {}, estimateStaticReleaseCompression(version, { includeManifest: true }));
  writeJsonAtomic(files.manifestPath, manifest);
  const compression = mirrorStaticReleaseFiles(version);
  manifest.compression = Object.assign({}, manifest.compression || {}, compression);

  return {
    version,
    releaseDir: files.releaseDir,
    publicReleaseDir: files.publicReleaseDir,
    manifest,
    bootstrap,
    derived,
    snapshot,
  };
}

async function writeReleaseSnapshotAsync(rawSnapshot, options = {}) {
  ensureStorageDirs();
  if (options.job) options.job.progress(20, "normalizing data");
  const snapshot = coerceSnapshot(rawSnapshot);
  const version = snapshot.version;
  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
    err.validation = validation;
    throw err;
  }

  const atomic = options.atomic !== false;
  const finalFiles = getReleaseFiles(version);
  const files = atomic ? getBuildingReleaseFiles(version, getReleaseBuildJobId(options)) : finalFiles;
  let derived = null;
  let manifest = null;
  const bootstrap = buildBootstrap(snapshot, version, validation.counts);

  if (atomic) cleanupBuildingReleaseFiles(files);

  try {
    writeJsonAtomic(files.snapshotPath, snapshot);
    writeJsonAtomic(files.bootstrapPath, bootstrap);
    writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
    writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
    if (options.job) options.job.progress(30, "building indexes", { releaseVersion: version });
    derived = writeDerivedIndexes(snapshot, files);
    if (options.job) options.job.progress(46, "writing manifest", { releaseVersion: version });
    manifest = buildManifest(snapshot, version, validation.counts, validation, files, derived);
    manifest.compression = Object.assign(
      {},
      manifest.compression || {},
      estimateStaticReleaseCompression(version, { includeManifest: true, files })
    );
    writeJsonAtomic(files.manifestPath, manifest);
    const compression = await mirrorStaticReleaseFilesAsync(version, {
      files,
      onProgress: (progress) => {
        if (options.job) {
          const ratio = progress.total ? progress.processed / progress.total : 1;
          options.job.progress(48 + Math.floor(ratio * 14), "compressing gzip", {
            processedFiles: progress.processed,
            totalFiles: progress.total,
            file: progress.relativePath,
          });
        }
        if (typeof options.onProgress === "function") options.onProgress(progress);
      },
    });
    manifest.compression = Object.assign({}, manifest.compression || {}, compression);

    if (atomic) {
      if (options.job) options.job.progress(64, "deep validating", { releaseVersion: version });
      const deepStatus = getReleasePackStatus(version, { files });
      if (!deepStatus.healthy) {
        const err = new Error("Release Pack build validation failed");
        err.code = "RELEASE_PACK_BUILD_UNHEALTHY";
        err.status = deepStatus;
        throw err;
      }
      if (options.job) options.job.progress(68, "promoting release files", { releaseVersion: version });
      replaceReleaseFilesFromBuild(files, finalFiles);
    }
  } catch (error) {
    if (atomic) cleanupBuildingReleaseFiles(files);
    throw error;
  }

  return {
    version,
    releaseDir: finalFiles.releaseDir,
    publicReleaseDir: finalFiles.publicReleaseDir,
    manifest,
    bootstrap,
    derived,
    snapshot,
  };
}

function readReleaseSnapshot(version) {
  if (!version) {
    return null;
  }
  const files = getReleaseFiles(version);
  const snapshot = readJsonFile(files.snapshotPath);
  if (snapshot) {
    return snapshot;
  }

  const bootstrap = readJsonFile(files.bootstrapPath);
  const classSchedules = readJsonFile(files.classSchedulesPath);
  const resources = readJsonFile(files.resourcesPath);
  const manifest = readJsonFile(files.manifestPath);
  if (!bootstrap || !Array.isArray(classSchedules)) {
    return null;
  }
  return {
    version: normalizeVersion(version),
    semester: bootstrap.semester || manifest?.semester,
    updatedAt: bootstrap.updatedAt || manifest?.updatedAt,
    source: bootstrap.metaDetails?.source || manifest?.source || "local-sync-client",
    disclaimer: bootstrap.metaDetails?.disclaimer,
    catalog: bootstrap.catalog || {},
    majors: [],
    classSchedules,
    resources: getResources({ resources }),
    coverage: bootstrap.counts || manifest?.counts || {},
  };
}

function writeCurrentSnapshotCompat(snapshot) {
  ensureStorageDirs();
  writeJsonAtomic(CURRENT_SNAPSHOT_PATH, snapshot);
  fs.writeFileSync(CURRENT_SNAPSHOT_GZ_PATH, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), "utf-8")));
}

function activateReleaseVersion(version) {
  ensureStorageDirs();
  const normalizedVersion = normalizeVersion(version);
  const snapshot = readReleaseSnapshot(normalizedVersion);
  if (!snapshot) {
    const err = new Error(`Release ${normalizedVersion} not found`);
    err.statusCode = 404;
    throw err;
  }

  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
    err.validation = validation;
    throw err;
  }

  try {
    assertHealthyReleasePack(normalizedVersion);
  } catch (error) {
    if (error && error.code === "RELEASE_PACK_UNHEALTHY" && snapshot) {
      rebuildReleasePack(normalizedVersion);
    } else {
      throw error;
    }
  }
  const packStatus = assertHealthyReleasePack(normalizedVersion);
  const fingerprint = calculateFingerprint(snapshot);
  const cacheEpoch = Date.now();
  const forceRefreshToken = `${normalizedVersion}:${cacheEpoch}`;
  const active = {
    version: normalizedVersion,
    releaseVersion: normalizedVersion,
    activatedAt: new Date().toISOString(),
    updatedAt: snapshot.updatedAt || new Date().toISOString(),
    cacheEpoch,
    forceRefreshToken,
    packStatus: {
      healthy: packStatus.healthy,
      manifestExists: packStatus.manifestExists,
      manifestValid: packStatus.manifestValid,
      hashValid: packStatus.hashValid,
      missing: packStatus.missing || [],
      hashErrors: packStatus.hashErrors || [],
    },
    term: snapshot.term || snapshot.semester || "",
    semester: snapshot.semester,
    counts: validation.counts,
    canonicalHash: fingerprint.canonicalHash,
  };
  writeJsonAtomic(ACTIVE_RELEASE_PATH, active);
  writeCurrentSnapshotCompat(Object.assign({}, snapshot, {
    version: normalizedVersion,
    coverage: Object.assign({}, snapshot.coverage || {}, validation.counts),
  }));

  return {
    active,
    snapshot,
    validation,
  };
}

function activateReleaseFromSnapshot(rawSnapshot) {
  const written = writeReleaseSnapshot(rawSnapshot);
  const activated = activateReleaseVersion(written.version);
  return Object.assign({}, written, activated);
}

function getActiveReleaseInfo() {
  ensureStorageDirs();
  const active = readJsonFile(ACTIVE_RELEASE_PATH);
  if (!active || !active.version) {
    return null;
  }

  const files = getReleaseFiles(active.version);
  const manifest = readJsonFile(files.manifestPath);
  const quickHealth = getReleasePackQuickHealth(active.version);
  const counts = manifest?.counts || active.counts || {};
  const semester = active.semester || manifest?.semester || manifest?.term || "";

  return Object.assign({}, active, {
    version: active.version,
    releaseVersion: active.version,
    term: semester,
    semester,
    publishedAt: active.activatedAt || active.updatedAt || "",
    counts,
    canonicalHash: active.canonicalHash || manifest?.canonicalHash || "",
    source: "release",
    status: "active",
    paths: {
      releaseDir: files.releaseDir,
      snapshotPath: files.snapshotPath,
      manifestPath: files.manifestPath,
      classesIndexPath: files.classesIndexPath,
      teachersIndexPath: files.teachersIndexPath,
      classroomsIndexPath: files.classroomsIndexPath,
      coursesIndexPath: files.coursesIndexPath,
      emptyRoomIndexPath: files.emptyRoomIndexPath,
    },
    releasePack: quickHealth,
    packStatus: quickHealth,
    snapshot: {
      version: manifest?.version || active.version,
      releaseVersion: manifest?.releaseVersion || manifest?.version || active.version,
      term: manifest?.term || manifest?.semester || semester,
      semester,
      updatedAt: manifest?.updatedAt || active.updatedAt || "",
      generatedAt: manifest?.generatedAt || "",
      source: manifest?.source || "",
    },
    valid: quickHealth.healthy,
    errors: quickHealth.healthy ? [] : ["Release Pack quick health failed"],
  });
}

function readActiveReleaseSnapshot() {
  const active = getActiveReleaseInfo();
  if (!active || !active.version) {
    return null;
  }
  const snapshot = readReleaseSnapshot(active.version);
  if (!snapshot) {
    return null;
  }
  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    safeLog("active-release-invalid", { version: active.version, errors: validation.errors });
    return null;
  }
  return Object.assign({}, snapshot, {
    version: active.version,
    updatedAt: snapshot.updatedAt || active.updatedAt,
    coverage: Object.assign({}, snapshot.coverage || {}, active.counts || {}),
  });
}

function readCurrentSnapshotCompat() {
  const current = readJsonFile(CURRENT_SNAPSHOT_PATH);
  if (current) {
    return current;
  }

  try {
    if (fs.existsSync(CURRENT_SNAPSHOT_GZ_PATH)) {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(CURRENT_SNAPSHOT_GZ_PATH)).toString("utf-8"));
    }
  } catch (error) {
    safeLog("release-read-current-gzip-failed", { error: error.message });
  }
  return null;
}

function getActiveSnapshotData() {
  const releaseSnapshot = readActiveReleaseSnapshot();
  if (releaseSnapshot) {
    return Object.assign({}, releaseSnapshot, {
      snapshotSource: "release",
    });
  }

  const currentSnapshot = readCurrentSnapshotCompat();
  if (currentSnapshot) {
    return Object.assign({}, currentSnapshot, {
      snapshotSource: "legacy-current",
    });
  }
  return null;
}

function getReleaseStatus() {
  const active = getActiveReleaseInfo();
  const snapshot = active ? readReleaseSnapshot(active.version) : null;
  const validation = snapshot ? validateReleaseSnapshot(snapshot) : null;
  return {
    activeReleaseVersion: active?.version || null,
    activeReleaseUpdatedAt: active?.updatedAt || null,
    activeReleaseActivatedAt: active?.activatedAt || null,
    semester: active?.semester || snapshot?.semester || null,
    counts: validation?.counts || active?.counts || {},
    valid: validation ? validation.valid : false,
    errors: validation ? validation.errors : [],
    storagePath: RELEASES_DIR,
  };
}

function listReleases(limit = 20) {
  ensureStorageDirs();
  const entries = fs.readdirSync(RELEASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const version = entry.name;
      const files = getReleaseFiles(version);
      const manifest = readJsonFile(files.manifestPath);
      const stat = fs.statSync(files.releaseDir);
      const releasePack = getReleasePackStatus(version);
      return {
        version,
        updatedAt: manifest?.updatedAt || stat.mtime.toISOString(),
        releaseVersion: manifest?.releaseVersion || version,
        term: manifest?.term || manifest?.semester || "",
        semester: manifest?.semester || manifest?.term || "",
        counts: manifest?.counts || {},
        valid: manifest?.validation?.valid !== false,
        releasePack,
      };
    })
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return entries.slice(0, limit);
}

function deleteReleaseVersion(version) {
  ensureStorageDirs();
  const normalizedVersion = normalizeVersion(version);
  const active = getActiveReleaseInfo();
  if (active && active.version === normalizedVersion) {
    const err = new Error("不能删除当前 active release，请先回滚或激活其他版本");
    err.statusCode = 400;
    throw err;
  }

  const files = getReleaseFiles(normalizedVersion);
  const relative = path.relative(RELEASES_DIR, files.releaseDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    const err = new Error("Invalid release path");
    err.statusCode = 400;
    throw err;
  }
  if (!fs.existsSync(files.releaseDir)) {
    const err = new Error(`Release ${normalizedVersion} not found`);
    err.statusCode = 404;
    throw err;
  }
  fs.rmSync(files.releaseDir, { recursive: true, force: true });
  return { version: normalizedVersion, deleted: true };
}

function buildReadableFilesMeta(files) {
  const meta = {};
  ["class", "teacher", "classroom", "course"].forEach((kind) => {
    const info = getDerivedFileInfo(kind, files);
    const indexMeta = getFileMeta(info && info.indexPath);
    if (indexMeta) {
      const relativePath = toReleaseRelativePath(files, info.indexPath);
      meta[relativePath] = indexMeta;
    }
    collectJsonFiles(info && info.scheduleDir).forEach((filePath) => {
      const item = getFileMeta(filePath);
      if (item) {
        meta[toReleaseRelativePath(files, filePath)] = item;
      }
    });
  });
  const emptyPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
  const emptyMeta = getFileMeta(emptyPath);
  if (emptyMeta) {
    meta[toReleaseRelativePath(files, emptyPath)] = emptyMeta;
  }
  return meta;
}

function getReleasePackQuickHealth(version) {
  const startedAt = Date.now();
  const active = readJsonFile(ACTIVE_RELEASE_PATH);
  const normalizedVersion = normalizeVersion(version || active?.version || "");
  if (!normalizedVersion) {
    return {
      success: false,
      healthy: false,
      code: "NO_ACTIVE_RELEASE",
      reasonCode: "NO_ACTIVE_RELEASE",
      durationMs: Date.now() - startedAt,
    };
  }

  const files = getReleaseFiles(normalizedVersion);
  const manifest = readJsonFile(files.manifestPath) || readJsonFile(path.join(files.publicReleaseDir, "manifest.json"));
  const keyFiles = {
    manifest: files.manifestPath,
    staticManifest: path.join(files.publicReleaseDir, "manifest.json"),
    classIndex: files.classIndexAllPath,
    legacyClassIndex: files.classesIndexPath,
    teacherIndex: files.teacherIndexAllPath,
    classroomIndex: files.classroomIndexAllPath,
    courseIndex: files.courseIndexAllPath,
    emptyRoom: files.emptyRoomIndexPath,
    staticEmptyRoom: path.join(files.publicReleaseDir, "empty-room", "index.json"),
  };
  const checks = Object.fromEntries(Object.entries(keyFiles).map(([key, filePath]) => [key, {
    exists: Boolean(filePath && fs.existsSync(filePath)),
    size: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
  }]));
  const requiredOk =
    Boolean(manifest && manifest.releaseVersion === normalizedVersion) &&
    checks.manifest.exists &&
    checks.staticManifest.exists &&
    (checks.classIndex.exists || checks.legacyClassIndex.exists) &&
    checks.teacherIndex.exists &&
    checks.classroomIndex.exists &&
    checks.courseIndex.exists &&
    checks.emptyRoom.exists &&
    checks.staticEmptyRoom.exists;

  return {
    success: true,
    version: normalizedVersion,
    releaseVersion: normalizedVersion,
    active: active && active.version === normalizedVersion,
    manifestExists: Boolean(manifest),
    manifestValid: Boolean(manifest && manifest.releaseVersion === normalizedVersion),
    healthy: requiredOk,
    checks,
    counts: manifest?.counts || active?.counts || {},
    emptyRoomHealth: manifest?.packHealth?.emptyRoom || manifest?.emptyRoomHealth || {},
    durationMs: Date.now() - startedAt,
  };
}

function getReleasePackStatus(version, options = {}) {
  const normalizedVersion = normalizeVersion(version);
  const files = options.files || getReleaseFiles(normalizedVersion);
  const manifest = readJsonFile(files.manifestPath);
  const kinds = ["class", "teacher", "classroom", "course"];
  const index = {};
  const detail = {};
  const sampleDetail = {};
  const missing = [];
  let totalBytes = 0;

  kinds.forEach((kind) => {
    const info = getDerivedFileInfo(kind, files);
    const indexPath = info && info.indexPath;
    const indexExists = Boolean(indexPath && fs.existsSync(indexPath));
    const items = indexExists ? readJsonFile(indexPath) : [];
    const detailFiles = collectJsonFiles(info && info.scheduleDir);
    index[kind] = {
      exists: indexExists,
      path: indexPath ? toReleaseRelativePath(files, indexPath) : "",
      count: Array.isArray(items) ? items.length : 0,
      size: indexExists ? fs.statSync(indexPath).size : 0,
    };
    detail[kind] = {
      exists: detailFiles.length > 0,
      dir: info && info.scheduleDir ? toReleaseRelativePath(files, info.scheduleDir) : "",
      count: detailFiles.length,
    };
    totalBytes += index[kind].size;
    detailFiles.forEach((filePath) => {
      totalBytes += fs.statSync(filePath).size;
    });
    if (!indexExists) missing.push(`index/${kind}.json`);
    if (!detailFiles.length) missing.push(`detail/${kind}/*.json`);
    if (Array.isArray(items) && items[0] && items[0].id) {
      const detailPath = path.join(info.scheduleDir, `${safeScheduleId(kind, items[0].id, items[0].id, 0)}.json`);
      sampleDetail[kind] = {
        id: items[0].id,
        readable: fs.existsSync(detailPath),
      };
      if (!sampleDetail[kind].readable) {
        missing.push(`detail/${kind}/${items[0].id}.json`);
      }
    } else {
      sampleDetail[kind] = { id: "", readable: false };
    }
  });

  const emptyPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
  const emptyMeta = getFileMeta(emptyPath);
  if (emptyMeta) {
    totalBytes += emptyMeta.size;
  } else {
    missing.push("empty-room/index.json");
  }

  const manifestFiles = manifest && manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  const currentFiles = buildReadableFilesMeta(files);
  const hashErrors = [];
  Object.keys(manifestFiles).forEach((relativePath) => {
    const absolutePath = path.join(files.releaseDir, relativePath);
    const currentMeta = getFileMeta(absolutePath);
    const expected = manifestFiles[relativePath] || {};
    if (!currentMeta) {
      hashErrors.push(`${relativePath}:missing`);
    } else if (expected.hash && currentMeta.hash !== expected.hash) {
      hashErrors.push(`${relativePath}:hash`);
    } else if (expected.size && Number(currentMeta.size) !== Number(expected.size)) {
      hashErrors.push(`${relativePath}:size`);
    }
  });

  return {
    version: normalizedVersion,
    releaseVersion: normalizedVersion,
    manifestExists: Boolean(manifest),
    manifestValid: Boolean(manifest && manifest.releaseVersion === normalizedVersion && manifest.files),
    index,
    detail,
    detailCounts: Object.fromEntries(kinds.map((kind) => [kind, detail[kind].count])),
    sampleDetail,
    emptyRoom: {
      exists: Boolean(emptyMeta),
      path: emptyPath ? toReleaseRelativePath(files, emptyPath) : "empty-room/index.json",
      size: emptyMeta ? emptyMeta.size : 0,
    },
    totalBytes,
    hashValid: hashErrors.length === 0,
    hashErrors,
    missing,
    currentFiles,
    healthy: missing.length === 0 && hashErrors.length === 0,
  };
}

function assertHealthyReleasePack(version) {
  const status = getReleasePackStatus(version);
  const errors = [];
  if (!status.manifestExists) errors.push("manifest missing");
  if (!status.manifestValid) errors.push("manifest invalid");
  ["class", "teacher", "classroom", "course"].forEach((kind) => {
    const indexInfo = status.index && status.index[kind] || {};
    const detailInfo = status.detail && status.detail[kind] || {};
    if (!indexInfo.exists) errors.push(`index/${kind}.json missing`);
    if (Number(indexInfo.count || 0) <= 0) errors.push(`index/${kind}.json empty`);
    if (!detailInfo.exists || Number(detailInfo.count || 0) <= 0) errors.push(`detail/${kind} missing`);
  });
  if (!status.emptyRoom || !status.emptyRoom.exists) errors.push("empty-room/index.json missing");
  if (!status.hashValid) errors.push.apply(errors, status.hashErrors || []);
  if (Array.isArray(status.missing) && status.missing.length) errors.push.apply(errors, status.missing);
  if (errors.length) {
    const err = new Error(`Release Pack health check failed: ${Array.from(new Set(errors)).join("; ")}`);
    err.code = "RELEASE_PACK_UNHEALTHY";
    err.status = status;
    throw err;
  }
  return status;
}

function getReleasePackManifest(version) {
  const targetVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
  if (!targetVersion) {
    return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE" };
  }
  const files = getReleaseFiles(targetVersion);
  const manifest = readJsonFile(files.manifestPath);
  if (manifest && manifest.releaseVersion) {
    const active = getActiveReleaseInfo();
    const isActive = active && active.version === targetVersion;
    const status = getReleasePackQuickHealth(targetVersion);
    return Object.assign({ success: true }, manifest, {
      releaseVersion: manifest.releaseVersion || targetVersion,
      version: manifest.version || targetVersion,
      cacheEpoch: isActive ? (active.cacheEpoch || manifest.cacheEpoch) : manifest.cacheEpoch,
      dataEpoch: isActive ? (active.cacheEpoch || manifest.cacheEpoch) : (manifest.dataEpoch || manifest.cacheEpoch),
      forceRefreshToken: isActive ? (active.forceRefreshToken || manifest.forceRefreshToken || `${targetVersion}:${manifest.cacheEpoch || ""}`) : (manifest.forceRefreshToken || `${targetVersion}:${manifest.cacheEpoch || ""}`),
      packStatus: status,
      minClientCacheSchema: manifest.minClientCacheSchema || 5,
    });
  }

  const snapshot = readReleaseSnapshot(targetVersion);
  if (snapshot) {
    return {
      success: false,
      code: "RELEASE_PACK_MANIFEST_MISSING",
      reasonCode: "RELEASE_PACK_MANIFEST_MISSING",
      releaseVersion: targetVersion,
      message: "Release Pack manifest is missing; rebuild must run as an admin job.",
    };
  }

  const status = getReleasePackQuickHealth(targetVersion);
  if (!Object.keys(status.currentFiles || {}).length) {
    return {
      success: false,
      code: "RELEASE_PACK_NOT_FOUND",
      reasonCode: "RELEASE_PACK_NOT_FOUND",
      releaseVersion: targetVersion,
    };
  }
  return {
    success: true,
    schemaVersion: 1,
    releasePackSchemaVersion: 1,
    term: "",
    semester: "",
    version: targetVersion,
    releaseVersion: targetVersion,
    updatedAt: "",
    cacheEpoch: Date.now(),
    counts: {},
    files: status.currentFiles,
    size: {
      snapshotBytes: 0,
      packBytes: sumMetaSize(status.currentFiles),
    },
    validation: {
      valid: status.healthy,
      errors: status.missing.concat(status.hashErrors),
      validatedAt: new Date().toISOString(),
    },
    legacyCompat: true,
  };
}

function rebuildReleasePack(version) {
  ensureStorageDirs();
  const normalizedVersion = normalizeVersion(version);
  const snapshot = readReleaseSnapshot(normalizedVersion);
  if (!snapshot) {
    const err = new Error(`Release ${normalizedVersion} not found or has no rebuildable snapshot`);
    err.statusCode = 404;
    throw err;
  }
  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
    err.validation = validation;
    throw err;
  }
  const files = getReleaseFiles(normalizedVersion);
  const derived = writeDerivedIndexes(Object.assign({}, snapshot, { version: normalizedVersion }), files, false);
  const manifest = buildManifest(snapshot, normalizedVersion, validation.counts, validation, files, derived);
  manifest.compression = Object.assign({}, manifest.compression || {}, estimateStaticReleaseCompression(normalizedVersion, { includeManifest: true }));
  writeJsonAtomic(files.manifestPath, manifest);
  const compression = mirrorStaticReleaseFiles(normalizedVersion);
  manifest.compression = Object.assign({}, manifest.compression || {}, compression);
  clearDerivedCache();
  return {
    success: true,
    version: normalizedVersion,
    releaseVersion: normalizedVersion,
    manifest,
    derived,
    status: getReleasePackStatus(normalizedVersion),
  };
}

async function rebuildReleasePackAsync(version, options = {}) {
  ensureStorageDirs();
  const normalizedVersion = normalizeVersion(version);
  const snapshot = readReleaseSnapshot(normalizedVersion);
  if (!snapshot) {
    const err = new Error(`Release ${normalizedVersion} not found or has no rebuildable snapshot`);
    err.statusCode = 404;
    throw err;
  }
  const validation = validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
    err.validation = validation;
    throw err;
  }
  const atomic = options.atomic !== false;
  const finalFiles = getReleaseFiles(normalizedVersion);
  const files = atomic ? getBuildingReleaseFiles(normalizedVersion, getReleaseBuildJobId(options)) : finalFiles;
  const normalizedSnapshot = Object.assign({}, snapshot, { version: normalizedVersion });
  const bootstrap = buildBootstrap(normalizedSnapshot, normalizedVersion, validation.counts);
  let derived = null;
  let manifest = null;

  if (atomic) cleanupBuildingReleaseFiles(files);

  try {
    writeJsonAtomic(files.snapshotPath, normalizedSnapshot);
    writeJsonAtomic(files.bootstrapPath, bootstrap);
    writeJsonAtomic(files.classSchedulesPath, normalizedSnapshot.classSchedules || []);
    writeJsonAtomic(files.resourcesPath, normalizedSnapshot.resources || {});
    if (options.job) options.job.progress(22, "building indexes", { version: normalizedVersion });
    derived = writeDerivedIndexes(normalizedSnapshot, files, false);
    const manifestSnapshot = Object.assign({}, normalizedSnapshot, {
      updatedAt: normalizedSnapshot.updatedAt || new Date().toISOString(),
    });
    manifest = buildManifest(manifestSnapshot, normalizedVersion, validation.counts, validation, files, derived);
    manifest.compression = Object.assign(
      {},
      manifest.compression || {},
      estimateStaticReleaseCompression(normalizedVersion, { includeManifest: true, files })
    );
    writeJsonAtomic(files.manifestPath, manifest);
    const compression = await mirrorStaticReleaseFilesAsync(normalizedVersion, {
      files,
      onProgress: (progress) => {
        if (options.job) {
          const ratio = progress.total ? progress.processed / progress.total : 1;
          options.job.progress(36 + Math.floor(ratio * 28), "compressing gzip", {
            processedFiles: progress.processed,
            totalFiles: progress.total,
            file: progress.relativePath,
          });
        }
        if (typeof options.onProgress === "function") options.onProgress(progress);
      },
    });
    manifest.compression = Object.assign({}, manifest.compression || {}, compression);

    if (atomic) {
      if (options.job) options.job.progress(66, "deep validating", { version: normalizedVersion });
      const deepStatus = getReleasePackStatus(normalizedVersion, { files });
      if (!deepStatus.healthy) {
        const err = new Error("Release Pack rebuild validation failed");
        err.code = "RELEASE_PACK_REBUILD_UNHEALTHY";
        err.status = deepStatus;
        throw err;
      }
      if (options.job) options.job.progress(68, "promoting release files", { version: normalizedVersion });
      replaceReleaseFilesFromBuild(files, finalFiles);
    }
  } catch (error) {
    if (atomic) cleanupBuildingReleaseFiles(files);
    throw error;
  }
  clearDerivedCache();
  return {
    success: true,
    version: normalizedVersion,
    releaseVersion: normalizedVersion,
    manifest,
    derived,
    status: getReleasePackStatus(normalizedVersion),
  };
}

const derivedCache = new Map();

function getDerivedFileInfo(kind, files) {
  const map = {
    class: {
      indexPath: getExistingPath(files.classesIndexPath, files.legacyClassesIndexPath),
      writeIndexPath: files.classesIndexPath,
      scheduleDir: getExistingDir(files.classScheduleDir, files.legacyClassScheduleDir),
      writeScheduleDir: files.classScheduleDir,
    },
    teacher: {
      indexPath: getExistingPath(files.teachersIndexPath, files.legacyTeachersIndexPath),
      writeIndexPath: files.teachersIndexPath,
      scheduleDir: getExistingDir(files.teacherScheduleDir, files.legacyTeacherScheduleDir),
      writeScheduleDir: files.teacherScheduleDir,
    },
    classroom: {
      indexPath: getExistingPath(files.classroomsIndexPath, files.legacyClassroomsIndexPath),
      writeIndexPath: files.classroomsIndexPath,
      scheduleDir: getExistingDir(files.classroomScheduleDir, files.legacyClassroomScheduleDir),
      writeScheduleDir: files.classroomScheduleDir,
    },
    course: {
      indexPath: getExistingPath(files.coursesIndexPath, files.legacyCoursesIndexPath),
      writeIndexPath: files.coursesIndexPath,
      scheduleDir: getExistingDir(files.courseScheduleDir, files.legacyCourseScheduleDir),
      writeScheduleDir: files.courseScheduleDir,
    },
  };
  return map[kind] || null;
}

function assertReleaseRelativePath(baseDir, filePath) {
  const relative = path.relative(baseDir, filePath);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function readStaticReleaseJson(version, relativePath) {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion || !relativePath) return null;
  const publicDir = getPublicReleaseDir(normalizedVersion);
  const targetPath = path.join(publicDir, relativePath);
  if (!assertReleaseRelativePath(publicDir, targetPath) || !fs.existsSync(targetPath)) {
    return null;
  }
  return readJsonFile(targetPath);
}

function readReleasePackStaticManifest(version) {
  const normalizedVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
  if (!normalizedVersion) return null;
  return readStaticReleaseJson(normalizedVersion, "manifest.json") || readJsonFile(getReleaseFiles(normalizedVersion).manifestPath);
}

function normalizeStaticIndexPayload(kind, payload, version) {
  const manifest = readReleasePackStaticManifest(version) || {};
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : null);
  if (!items) return null;
  const releaseVersion = normalizeVersion(version || manifest.releaseVersion || payload?.releaseVersion || "");
  return Object.assign({}, Array.isArray(payload) ? {} : payload, {
    success: true,
    schemaVersion: payload?.schemaVersion || 1,
    type: kind,
    term: payload?.term || manifest.term || manifest.semester || "",
    semester: payload?.semester || payload?.term || manifest.semester || manifest.term || "",
    releaseVersion,
    version: payload?.version || releaseVersion,
    total: Number(payload?.total || items.length) || items.length,
    items,
    dataSource: "static-release-pack",
  });
}

function readReleasePackStaticIndex(kind, version, shard = "") {
  const normalizedVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
  if (!normalizedVersion || !["class", "teacher", "classroom", "course"].includes(kind)) return null;
  const candidates = [];
  if (kind === "class" && shard) {
    candidates.push(`index/class/${shard}`);
  }
  candidates.push(`index/${kind}/all.json`, `index/${kind}.json`);
  for (const relativePath of candidates) {
    const payload = readStaticReleaseJson(normalizedVersion, relativePath);
    const normalized = normalizeStaticIndexPayload(kind, payload, normalizedVersion);
    if (normalized) return normalized;
  }
  return null;
}

function readReleasePackStaticDetail(kind, id, version) {
  const normalizedVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
  if (!normalizedVersion || !["class", "teacher", "classroom", "course"].includes(kind) || !id) return null;
  const safeId = safeScheduleId(kind, id, id, 0);
  const schedule = readStaticReleaseJson(normalizedVersion, `detail/${kind}/${safeId}.json`);
  if (!schedule) return null;
  const manifest = readReleasePackStaticManifest(normalizedVersion) || {};
  return {
    success: true,
    schemaVersion: 1,
    type: kind,
    id: safeId,
    term: schedule.term || schedule.semester || manifest.term || "",
    semester: schedule.semester || schedule.term || manifest.semester || manifest.term || "",
    releaseVersion: normalizedVersion,
    version: normalizedVersion,
    updatedAt: schedule.updatedAt || manifest.updatedAt || "",
    dataSource: "static-release-pack",
    schedule,
    detail: schedule,
  };
}

function readReleasePackStaticEmptyRoom(version) {
  const normalizedVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
  if (!normalizedVersion) return null;
  const payload = readStaticReleaseJson(normalizedVersion, "empty-room/index.json");
  if (!payload || !Array.isArray(payload.rooms)) return null;
  return Object.assign({}, payload, {
    success: true,
    releaseVersion: payload.releaseVersion || normalizedVersion,
    version: payload.version || payload.releaseVersion || normalizedVersion,
    dataSource: "static-release-pack",
  });
}

function getReadableReleaseInfo() {
  const active = getActiveReleaseInfo();
  if (active && active.version) {
    return {
      source: "active-release",
      version: active.version,
      semester: active.semester,
      updatedAt: active.updatedAt,
      snapshot: null,
    };
  }

  const snapshot = readCurrentSnapshotCompat();
  if (!snapshot) {
    return null;
  }
  const updatedAt = snapshot.updatedAt || snapshot.generatedAt || "";
  const version = normalizeVersion(
    snapshot.version ||
    snapshot.releaseVersion ||
    `legacy-current-${cryptoHash(`${snapshot.semester || ""}:${updatedAt}`).slice(0, 12)}`
  );
  return {
    source: "legacy-current",
    version,
    semester: snapshot.semester || snapshot.term || "",
    updatedAt,
    snapshot: hydrateLegacySnapshotResources(Object.assign({}, snapshot, { version })),
  };
}

function ensureDerivedIndexes(version, fallbackSnapshot) {
  const files = getReleaseFiles(version);
  const allExist = ["class", "teacher", "classroom", "course"].every((kind) => {
    const info = getDerivedFileInfo(kind, files);
    return info && fs.existsSync(info.indexPath);
  });
  if (allExist) {
    if (fallbackSnapshot) {
      const resources = getResources(fallbackSnapshot);
      const classIndex = readJsonFile(getDerivedFileInfo("class", files).indexPath, []);
      const teacherIndex = readJsonFile(getDerivedFileInfo("teacher", files).indexPath, []);
      const classroomIndex = readJsonFile(getDerivedFileInfo("classroom", files).indexPath, []);
      const courseIndex = readJsonFile(getDerivedFileInfo("course", files).indexPath, []);
      const shouldRefresh =
        (asArray(fallbackSnapshot.classSchedules).length > 0 && asArray(classIndex).length === 0) ||
        (resources.teacherSchedules.length > 0 && asArray(teacherIndex).length === 0) ||
        (resources.classroomSchedules.length > 0 && asArray(classroomIndex).length === 0) ||
        (resources.courseSchedules.length > 0 && asArray(courseIndex).length === 0);
      if (!shouldRefresh) {
        return files;
      }
    } else {
      return files;
    }
  }
  const snapshot = fallbackSnapshot ? coerceSnapshot(Object.assign({}, fallbackSnapshot, { version })) : readReleaseSnapshot(version);
  if (snapshot) {
    writeDerivedIndexes(snapshot, files);
  }
  return files;
}

function readActiveIndex(kind, version) {
  let active;
  if (version) {
    const normalized = normalizeVersion(version);
    const snapshot = readReleaseSnapshot(normalized);
    if (snapshot) {
      active = {
        source: "release",
        version: normalized,
        semester: snapshot.semester || snapshot.term || "",
        updatedAt: snapshot.updatedAt || "",
        snapshot,
      };
    } else {
      const files = getReleaseFiles(normalized);
      const info = getDerivedFileInfo(kind, files);
      if (info && fs.existsSync(info.indexPath)) {
        active = {
          source: "release",
          version: normalized,
          semester: "",
          updatedAt: "",
          snapshot: null,
        };
      } else {
        return {
          success: false,
          code: "RELEASE_NOT_FOUND",
          reasonCode: "RELEASE_NOT_FOUND",
          version: normalized,
          releaseVersion: normalized,
          items: [],
        };
      }
    }
  }
  if (!active) {
    active = getReadableReleaseInfo();
  }
  if (!active || !active.version) {
    return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE", items: [] };
  }
  const files = ensureDerivedIndexes(active.version, active.snapshot);
  const info = getDerivedFileInfo(kind, files);
  if (!info || !fs.existsSync(info.indexPath)) {
    return {
      success: false,
      code: "INDEX_NOT_FOUND",
      reasonCode: "INDEX_NOT_FOUND",
      version: active.version,
      releaseVersion: active.version,
      items: [],
    };
  }
  const stat = fs.statSync(info.indexPath);
  const cacheKey = `${active.version}:${kind}:index`;
  const cached = derivedCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }
  const items = readJsonFile(info.indexPath) || [];
  const value = {
    success: true,
    dataSource: active.source === "legacy-current" ? "legacy-current-index" : (version ? "release-isolated-index" : "release-index"),
    version: active.version,
    releaseVersion: active.version,
    term: active.semester,
    semester: active.semester,
    updatedAt: active.updatedAt,
    etag: `"${active.version}-${kind}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
    items: Array.isArray(items) ? items : [],
  };
  derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function searchActiveIndex(kind, query, options = {}) {
  const version = options.releaseVersion || options.version;
  const index = readActiveIndex(kind, version);
  if (!index.success) {
    return index;
  }
  const q = String(query || "").trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(options.limit || "30", 10) || 30, 1), 100);
  const offset = Math.max(parseInt(options.offset || "0", 10) || 0, 0);
  const source = index.items || [];
  const matchesField = (item, optionValue, keys) => {
    const expected = String(optionValue || "").trim();
    if (!expected) return true;
    return keys.some((key) => String(item[key] || "").trim() === expected);
  };
  const scoped = source.filter((item) => {
    if (!matchesField(item, options.semester, ["semester"])) return false;
    if (!matchesField(item, options.collegeCode, ["collegeCode"])) return false;
    if (!matchesField(item, options.collegeName, ["collegeName", "college"])) return false;
    if (!matchesField(item, options.grade, ["grade"])) return false;
    if (!matchesField(item, options.majorCode, ["majorCode"])) return false;
    if (!matchesField(item, options.majorName, ["majorName"])) return false;
    if (!matchesField(item, options.campus, ["campus", "campusName"])) return false;
    return true;
  });
  const filtered = q
    ? scoped.filter((item) => {
        const haystack = [
          item.id,
          item.name,
          item.className,
          item.teacherName,
          item.roomName,
          item.classroomName,
          item.courseName,
          item.collegeName,
          item.majorName,
          item.grade,
          item.firstCourseName,
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      })
    : scoped;
  return Object.assign({}, index, {
    query: q,
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
  });
}

function readActiveSchedule(kind, id, version) {
  let active;
  if (version) {
    const normalized = normalizeVersion(version);
    const snapshot = readReleaseSnapshot(normalized);
    if (snapshot) {
      active = {
        source: "release",
        version: normalized,
        semester: snapshot.semester || snapshot.term || "",
        updatedAt: snapshot.updatedAt || "",
        snapshot,
      };
    } else {
      const files = getReleaseFiles(normalized);
      const info = getDerivedFileInfo(kind, files);
      if (info && fs.existsSync(info.scheduleDir)) {
        active = {
          source: "release",
          version: normalized,
          semester: "",
          updatedAt: "",
          snapshot: null,
        };
      } else {
        return { success: false, code: "RELEASE_NOT_FOUND", reasonCode: "RELEASE_NOT_FOUND" };
      }
    }
  }
  if (!active) {
    active = getReadableReleaseInfo();
  }
  if (!active || !active.version) {
    return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE" };
  }
  const files = ensureDerivedIndexes(active.version, active.snapshot);
  const info = getDerivedFileInfo(kind, files);
  if (!info) {
    return { success: false, reasonCode: "INVALID_KIND" };
  }
  const safeId = safeScheduleId(kind, id, id, 0);
  const filePath = path.join(info.scheduleDir, `${safeId}.json`);
  const relative = path.relative(info.scheduleDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { success: false, reasonCode: "INVALID_ID" };
  }
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat) {
    return { success: false, reasonCode: "NOT_FOUND" };
  }
  const cacheKey = `${active.version}:${kind}:schedule:${safeId}`;
  const cached = derivedCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }
  const schedule = readJsonFile(filePath);
  const value = {
    success: true,
    dataSource: active.source === "legacy-current" ? "legacy-current-index" : (version ? "release-isolated-index" : "release-index"),
    version: active.version,
    releaseVersion: active.version,
    term: schedule?.term || schedule?.semester || active.semester,
    semester: schedule?.semester || active.semester,
    updatedAt: schedule?.updatedAt || active.updatedAt,
    etag: `"${active.version}-${kind}-${safeId}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
    schedule,
  };
  derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function ensureEmptyRoomIndex(version, fallbackSnapshot) {
  const files = getReleaseFiles(version);
  const existingEmptyRoomPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
  if (existingEmptyRoomPath && fs.existsSync(existingEmptyRoomPath)) {
    return files;
  }
  const snapshot = fallbackSnapshot ? coerceSnapshot(Object.assign({}, fallbackSnapshot, { version })) : readReleaseSnapshot(version);
  if (snapshot) {
    buildEmptyRoomDerivedFiles(snapshot, files);
  }
  return files;
}

function readEmptyRoomIndex(version) {
  let active;
  if (version) {
    const normalized = normalizeVersion(version);
    const snapshot = readReleaseSnapshot(normalized);
    if (snapshot) {
      active = {
        source: "release",
        version: normalized,
        semester: snapshot.semester || snapshot.term || "",
        updatedAt: snapshot.updatedAt || "",
        snapshot,
      };
    } else {
      const files = getReleaseFiles(normalized);
      if (fs.existsSync(files.emptyRoomIndexPath)) {
        active = {
          source: "release",
          version: normalized,
          semester: "",
          updatedAt: "",
          snapshot: null,
        };
      } else {
        return {
          success: false,
          code: "RELEASE_NOT_FOUND",
          reasonCode: "RELEASE_NOT_FOUND",
          version: normalized,
          releaseVersion: normalized,
          rooms: [],
        };
      }
    }
  }
  if (!active) {
    active = getReadableReleaseInfo();
  }
  if (!active || !active.version) {
    return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE", rooms: [] };
  }

  const files = ensureEmptyRoomIndex(active.version, active.snapshot);
  const emptyRoomIndexPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
  if (!emptyRoomIndexPath || !fs.existsSync(emptyRoomIndexPath)) {
    return {
      success: false,
      code: "EMPTY_ROOM_INDEX_NOT_FOUND",
      reasonCode: "EMPTY_ROOM_INDEX_NOT_FOUND",
      version: active.version,
      releaseVersion: active.version,
      rooms: [],
    };
  }
  const stat = fs.statSync(emptyRoomIndexPath);
  const cacheKey = `${active.version}:empty-room:index`;
  const cached = derivedCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }
  const index = readJsonFile(emptyRoomIndexPath) || {};
  const value = Object.assign({}, index, {
    success: true,
    dataSource: active.source === "legacy-current" ? "legacy-current-empty-room-index" : (version ? "release-isolated-empty-room-index" : "release-empty-room-index"),
    version: index.version || active.version,
    releaseVersion: index.releaseVersion || index.version || active.version,
    semester: index.semester || active.semester,
    term: index.term || index.semester || active.semester,
    updatedAt: index.updatedAt || active.updatedAt,
    etag: `"${active.version}-empty-room-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
    rooms: Array.isArray(index.rooms) ? index.rooms : [],
    buildings: Array.isArray(index.buildings) ? index.buildings : [],
  });
  derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const parts = text.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const date = text ? new Date(text) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateOnly(date) {
  const target = parseDateOnly(date);
  const pad = (value) => String(value).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function getWeekdayFromDate(date) {
  const day = parseDateOnly(date).getDay();
  return day === 0 ? 7 : day;
}

function getWeekFromDate(date, termStartDate) {
  const start = termStartDate ? parseDateOnly(termStartDate) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return 1;
  }
  const diffDays = Math.floor((parseDateOnly(date).getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.min(MAX_EMPTY_ROOM_WEEK, Math.floor(diffDays / 7) + 1));
}

function normalizeQuerySections(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const parsed = parseSectionSequence(text);
  return parsed.length ? parsed : parseSectionText(text);
}

function sectionsOverlapValues(left, right) {
  const set = new Set(left || []);
  return (right || []).some((section) => set.has(section));
}

function differenceSections(occupied) {
  const occupiedSet = new Set(occupied || []);
  return allSections().filter((section) => !occupiedSet.has(section));
}

function hasContiguousSections(sections, minCount) {
  const min = Math.max(1, Number(minCount) || 1);
  if (min <= 1) {
    return sections.length > 0;
  }
  let run = 0;
  for (const section of allSections()) {
    if ((sections || []).includes(section)) {
      run += 1;
      if (run >= min) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function getNextOccupiedCourse(courses, weekday, week, afterSection) {
  const next = (courses || [])
    .filter((course) => Number(course.weekday) === Number(weekday))
    .filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(Number(week)) : true)
    .filter((course) => Number(course.startSection) > Number(afterSection))
    .sort((left, right) => Number(left.startSection) - Number(right.startSection))[0];
  if (!next) return null;
  return {
    courseName: next.courseName || "",
    teacherName: next.teacherName || "",
    sections: next.sections || [],
    sectionText: `第${next.startSection}-${next.endSection}节`,
  };
}

function formatSectionRange(sections) {
  const list = uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
  if (!list.length) return "";
  return list.length === 1 ? `第${list[0]}节` : `第${list[0]}-${list[list.length - 1]}节`;
}

function queryEmptyClassrooms(options = {}) {
  const requestedVersion = options.releaseVersion || options.version || "";
  const index = readEmptyRoomIndex(requestedVersion);
  if (!index.success) {
    return Object.assign({}, index, {
      query: {},
      rooms: [],
      total: 0,
    });
  }

  const queryDate = formatDateOnly(options.date || new Date());
  const weekday = Number(options.weekday || getWeekdayFromDate(queryDate));
  const week = Number(options.week || getWeekFromDate(queryDate, index.termStartDate));
  const requestedSections = normalizeQuerySections(options.sections || options.section || "1-2");
  const building = String(options.building || "").trim();
  const minFreeSections = Math.max(1, Number(options.minFreeSections || 1) || 1);
  const excludeUnknown = options.excludeUnknown === true || options.excludeUnknown === "1" || options.excludeUnknown === "true";
  const commonOnly = options.commonOnly === true || options.commonOnly === "1" || options.commonOnly === "true";
  const normalizedBuilding = building && building !== "全部" ? building.toLowerCase() : "";
  const requestedSet = requestedSections.length ? requestedSections : allSections();
  const maxRequestedSection = requestedSet[requestedSet.length - 1] || 0;

  const rooms = (index.rooms || []).filter((room) => {
    if (excludeUnknown && (!room.roomName || room.roomName.includes("未知") || room.building === "未知")) {
      return false;
    }
    if (commonOnly && !/[A-Za-z]\d|楼/.test(room.roomName || "")) {
      return false;
    }
    if (normalizedBuilding) {
      const buildingText = String(room.building || "").toLowerCase();
      const roomText = String(room.roomName || "").toLowerCase();
      if (buildingText !== normalizedBuilding && !roomText.includes(normalizedBuilding)) {
        return false;
      }
    }
    return true;
  }).map((room) => {
    const occupiedCourses = (room.courses || [])
      .filter((course) => Number(course.weekday) === weekday)
      .filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(week) : true);
    const occupiedSections = uniqueNumbers(
      occupiedCourses.flatMap((course) => course.sections || []),
      1,
      MAX_EMPTY_ROOM_SECTION
    );
    const freeSections = differenceSections(occupiedSections);
    const requestedIsFree = !sectionsOverlapValues(occupiedSections, requestedSet);
    const enoughFree = requestedSections.length
      ? requestedSet.length >= minFreeSections
      : hasContiguousSections(freeSections, minFreeSections);
    return {
      roomName: room.roomName,
      roomId: room.roomId,
      building: room.building || inferBuilding(room.roomName),
      buildingCode: room.buildingCode || normalizeBuilding(room.roomName).buildingCode,
      buildingName: room.buildingName || normalizeBuilding(room.roomName).buildingName,
      campus: room.campus || normalizeBuilding(room.roomName).campus || "",
      confidence: room.confidence == null ? normalizeBuilding(room.roomName).confidence : room.confidence,
      source: room.source || "",
      capacity: room.capacity || null,
      capacityText: room.capacity ? `${room.capacity}座` : "容量未知",
      freeText: `${formatSectionRange(requestedSet)}空闲`,
      freeSections,
      occupiedSections,
      todayCourses: occupiedCourses.map((course) => ({
        courseName: course.courseName || "",
        teacherName: course.teacherName || "",
        sections: course.sections || [],
        sectionText: `第${course.startSection}-${course.endSection}节`,
      })),
      courseCount: room.courseCount || 0,
      nextOccupiedCourse: getNextOccupiedCourse(occupiedCourses, weekday, week, maxRequestedSection),
      _matched: requestedIsFree && enoughFree,
    };
  }).filter((room) => room._matched)
    .map((room) => {
      const copy = Object.assign({}, room);
      delete copy._matched;
      return copy;
    })
    .sort((left, right) => {
      const buildingDiff = String(left.building || "").localeCompare(String(right.building || ""), "zh-CN");
      if (buildingDiff !== 0) return buildingDiff;
      return String(left.roomName || "").localeCompare(String(right.roomName || ""), "zh-CN", { numeric: true });
    });

  return {
    success: true,
    dataSource: index.dataSource,
    term: index.term || index.semester || "",
    semester: index.semester || index.term || "",
    releaseVersion: index.releaseVersion || index.version || "",
    version: index.version || index.releaseVersion || "",
    updatedAt: index.updatedAt || "",
    buildings: index.buildings || [],
    query: {
      term: options.term || index.term || index.semester || "",
      releaseVersion: index.releaseVersion || index.version || "",
      date: queryDate,
      week,
      weekday,
      sections: requestedSections.length ? requestedSections.join("-") : "all",
      building: building || "全部",
      minFreeSections,
      excludeUnknown,
      commonOnly,
    },
    total: rooms.length,
    rooms,
    etag: index.etag,
  };
}

function parseSnapshotBuffer(buffer) {
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const jsonText = isGzip ? zlib.gunzipSync(buffer).toString("utf-8") : buffer.toString("utf-8");
  return {
    isGzip,
    snapshot: JSON.parse(jsonText),
    size: buffer.length,
  };
}

function clearDerivedCache() {
  derivedCache.clear();
}

module.exports = {
  ACTIVE_RELEASE_PATH,
  PUBLIC_RELEASES_DIR,
  RELEASES_DIR,
  STATIC_RELEASE_BASE_URL,
  activateReleaseFromSnapshot,
  activateReleaseVersion,
  countRelease,
  getActiveReleaseInfo,
  getActiveSnapshotData,
  getReleaseFiles,
  getReleasePackManifest,
  getReleasePackQuickHealth,
  getReleasePackStatus,
  getReleaseCompressionConfig,
  assertHealthyReleasePack,
  getReleaseStatus,
  deleteReleaseVersion,
  readReleasePackStaticDetail,
  readReleasePackStaticEmptyRoom,
  readReleasePackStaticIndex,
  readReleasePackStaticManifest,
  readActiveIndex,
  readActiveSchedule,
  readEmptyRoomIndex,
  queryEmptyClassrooms,
  listReleases,
  normalizeVersion,
  parseSnapshotBuffer,
  readActiveReleaseSnapshot,
  readReleaseSnapshot,
  rebuildReleasePack,
  rebuildReleasePackAsync,
  searchActiveIndex,
  validateReleaseSnapshot,
  writeDerivedIndexes,
  writeReleaseSnapshot,
  writeReleaseSnapshotAsync,
  mirrorStaticReleaseFilesAsync,
  clearDerivedCache,
};
