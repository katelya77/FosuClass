const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
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
    classesIndexPath: path.join(releaseDir, "classes-index.json"),
    teachersIndexPath: path.join(releaseDir, "teachers-index.json"),
    classroomsIndexPath: path.join(releaseDir, "classrooms-index.json"),
    coursesIndexPath: path.join(releaseDir, "courses-index.json"),
    classScheduleDir: path.join(releaseDir, "schedules", "class"),
    teacherScheduleDir: path.join(releaseDir, "schedules", "teacher"),
    classroomScheduleDir: path.join(releaseDir, "schedules", "classroom"),
    courseScheduleDir: path.join(releaseDir, "schedules", "course"),
  };
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

function buildSchedulePayload(schedule, extra) {
  const payload = Object.assign({}, schedule || {}, extra || {});
  if (Array.isArray(payload.courses)) {
    payload.courses = payload.courses.map(stripDebugCourseFields);
  }
  return payload;
}

function buildClassDerivedFiles(snapshot, files) {
  ensureDir(files.classScheduleDir);
  const index = asArray(snapshot.classSchedules).map((item, position) => {
    const name = getFirstText(item, ["className", "title", "name"]) || `class-${position + 1}`;
    const id = safeScheduleId("class", item.classId || item.id, `${snapshot.semester}:${name}`, position);
    const summary = summarizeCourses(item);
    const payload = buildSchedulePayload(item, { id });
    writeJsonAtomic(path.join(files.classScheduleDir, `${id}.json`), payload);
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

function buildNamedScheduleDerivedFiles(snapshot, files, kind, schedules, names, nameKeys, dirPath, indexPath) {
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
    writeJsonAtomic(path.join(dirPath, `${id}.json`), buildSchedulePayload(schedule, { id }));
    index.push({
      id,
      name,
      [`${kind}Name`]: name,
      semester: schedule.semester || snapshot.semester || "",
      collegeCode: source.collegeCode || schedule.collegeCode || "",
      collegeName: source.collegeName || schedule.collegeName || "",
      campus: source.campus || schedule.campus || "",
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

function writeDerivedIndexes(snapshot, files) {
  const resources = getResources(snapshot);
  const classes = buildClassDerivedFiles(snapshot, files);
  const teachers = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "teacher",
    resources.teacherSchedules,
    resources.teachers,
    ["teacherName", "name", "title"],
    files.teacherScheduleDir,
    files.teachersIndexPath
  );
  const classrooms = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "classroom",
    resources.classroomSchedules,
    resources.classrooms,
    ["roomName", "classroomName", "classroom", "name"],
    files.classroomScheduleDir,
    files.classroomsIndexPath
  );
  const courses = buildNamedScheduleDerivedFiles(
    snapshot,
    files,
    "course",
    resources.courseSchedules,
    resources.courses,
    ["courseName", "displayCourseName", "canonicalCourseName", "name", "title"],
    files.courseScheduleDir,
    files.coursesIndexPath
  );
  return { classes, teachers, classrooms, courses };
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
  const derived = writeDerivedIndexes(snapshot, files);

  return {
    version,
    releaseDir: files.releaseDir,
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
  const active = readJsonFile(ACTIVE_RELEASE_PATH);
  if (!active || !active.version) {
    return null;
  }

  const files = getReleaseFiles(active.version);
  const snapshot = readReleaseSnapshot(active.version);
  const validation = snapshot ? validateReleaseSnapshot(snapshot) : null;
  const counts = validation?.counts || active.counts || {};
  const semester = active.semester || snapshot?.semester || snapshot?.term || "";

  return Object.assign({}, active, {
    version: active.version,
    releaseVersion: active.version,
    term: semester,
    semester,
    publishedAt: active.activatedAt || active.updatedAt || "",
    counts,
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
    },
    snapshot: snapshot ? {
      version: snapshot.version || active.version,
      releaseVersion: snapshot.releaseVersion || snapshot.version || active.version,
      term: snapshot.term || snapshot.semester || semester,
      semester,
      updatedAt: snapshot.updatedAt || active.updatedAt || "",
      generatedAt: snapshot.generatedAt || "",
      source: snapshot.source || "",
    } : null,
    valid: validation ? validation.valid : false,
    errors: validation ? validation.errors : [],
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

const derivedCache = new Map();

function getDerivedFileInfo(kind, files) {
  const map = {
    class: { indexPath: files.classesIndexPath, scheduleDir: files.classScheduleDir },
    teacher: { indexPath: files.teachersIndexPath, scheduleDir: files.teacherScheduleDir },
    classroom: { indexPath: files.classroomsIndexPath, scheduleDir: files.classroomScheduleDir },
    course: { indexPath: files.coursesIndexPath, scheduleDir: files.courseScheduleDir },
  };
  return map[kind] || null;
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
  const allExist = fs.existsSync(files.classesIndexPath) &&
    fs.existsSync(files.teachersIndexPath) &&
    fs.existsSync(files.classroomsIndexPath) &&
    fs.existsSync(files.coursesIndexPath);
  if (allExist) {
    if (fallbackSnapshot) {
      const resources = getResources(fallbackSnapshot);
      const classIndex = readJsonFile(files.classesIndexPath, []);
      const teacherIndex = readJsonFile(files.teachersIndexPath, []);
      const classroomIndex = readJsonFile(files.classroomsIndexPath, []);
      const courseIndex = readJsonFile(files.coursesIndexPath, []);
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

function readActiveIndex(kind) {
  const active = getReadableReleaseInfo();
  if (!active || !active.version) {
    return { success: false, reasonCode: "NO_RELEASE_DATA", items: [] };
  }
  const files = ensureDerivedIndexes(active.version, active.snapshot);
  const info = getDerivedFileInfo(kind, files);
  if (!info || !fs.existsSync(info.indexPath)) {
    return { success: false, reasonCode: "NO_INDEX", items: [] };
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
    dataSource: active.source === "legacy-current" ? "legacy-current-index" : "release-index",
    version: active.version,
    semester: active.semester,
    updatedAt: active.updatedAt,
    etag: `"${active.version}-${kind}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
    items: Array.isArray(items) ? items : [],
  };
  derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
  return value;
}

function searchActiveIndex(kind, query, options = {}) {
  const index = readActiveIndex(kind);
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

function readActiveSchedule(kind, id) {
  const active = getReadableReleaseInfo();
  if (!active || !active.version) {
    return { success: false, reasonCode: "NO_RELEASE_DATA" };
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
    dataSource: active.source === "legacy-current" ? "legacy-current-index" : "release-index",
    version: active.version,
    semester: schedule?.semester || active.semester,
    updatedAt: schedule?.updatedAt || active.updatedAt,
    etag: `"${active.version}-${kind}-${safeId}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
    schedule,
  };
  derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
  return value;
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
  getActiveReleaseInfo,
  getActiveSnapshotData,
  getReleaseFiles,
  getReleaseStatus,
  deleteReleaseVersion,
  readActiveIndex,
  readActiveSchedule,
  listReleases,
  normalizeVersion,
  parseSnapshotBuffer,
  readActiveReleaseSnapshot,
  searchActiveIndex,
  validateReleaseSnapshot,
  writeDerivedIndexes,
  writeReleaseSnapshot,
};
