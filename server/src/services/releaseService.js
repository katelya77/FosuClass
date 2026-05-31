const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const RELEASES_DIR = path.join(STORAGE_DIR, "releases");
const ACTIVE_RELEASE_PATH = path.join(RELEASES_DIR, "active.json");
const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const CURRENT_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, "current.json");
const CURRENT_SNAPSHOT_GZ_PATH = path.join(SNAPSHOTS_DIR, "current.json.gz");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorageDirs() {
  ensureDir(STORAGE_DIR);
  ensureDir(RELEASES_DIR);
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

function getReleaseFiles(version) {
  const releaseDir = getReleaseDir(version);
  return {
    releaseDir,
    bootstrapPath: path.join(releaseDir, "bootstrap.json"),
    classSchedulesPath: path.join(releaseDir, "class-schedules.json"),
    resourcesPath: path.join(releaseDir, "resources.json"),
    snapshotPath: path.join(releaseDir, "snapshot.json"),
    manifestPath: path.join(releaseDir, "manifest.json"),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getResources(snapshot) {
  const source = snapshot && snapshot.resources && typeof snapshot.resources === "object"
    ? snapshot.resources
    : {};
  return {
    teachers: asArray(source.teachers),
    classrooms: asArray(source.classrooms),
    courses: asArray(source.courses),
    teacherSchedules: asArray(source.teacherSchedules),
    classroomSchedules: asArray(source.classroomSchedules),
    courseSchedules: asArray(source.courseSchedules),
  };
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

function buildManifest(snapshot, version, counts, validation) {
  const updatedAt = snapshot.updatedAt || new Date().toISOString();
  return {
    version,
    semester: snapshot.semester,
    updatedAt,
    source: snapshot.source || "local-sync-client",
    counts,
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
  const manifest = buildManifest(snapshot, version, validation.counts, validation);
  writeJsonAtomic(files.snapshotPath, snapshot);
  writeJsonAtomic(files.bootstrapPath, bootstrap);
  writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
  writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
  writeJsonAtomic(files.manifestPath, manifest);

  return {
    version,
    releaseDir: files.releaseDir,
    manifest,
    bootstrap,
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

  const active = {
    version: normalizedVersion,
    activatedAt: new Date().toISOString(),
    updatedAt: snapshot.updatedAt || new Date().toISOString(),
    semester: snapshot.semester,
    counts: validation.counts,
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
  return readJsonFile(ACTIVE_RELEASE_PATH);
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
      return {
        version,
        updatedAt: manifest?.updatedAt || stat.mtime.toISOString(),
        semester: manifest?.semester || "",
        counts: manifest?.counts || {},
        valid: manifest?.validation?.valid !== false,
      };
    })
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return entries.slice(0, limit);
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

module.exports = {
  ACTIVE_RELEASE_PATH,
  RELEASES_DIR,
  activateReleaseFromSnapshot,
  activateReleaseVersion,
  countRelease,
  getReleaseStatus,
  listReleases,
  normalizeVersion,
  parseSnapshotBuffer,
  readActiveReleaseSnapshot,
  validateReleaseSnapshot,
  writeReleaseSnapshot,
};
