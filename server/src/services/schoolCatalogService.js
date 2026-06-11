const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;

const { FosuQiangzhiAdapter } = require("./fosuQiangzhiAdapter");
const releaseService = require("./releaseService");
const termRegistryService = require("./termRegistryService");
const { SmallJsonCache } = require("../utils/jsonFileStore");
const config = require("../config");
const { parseSchoolOptionsHtml, parseMajorAjaxResponse } = require("../utils/parser");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const FILE_MAP = {
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  majors: path.join(STORAGE_DIR, "majors-index.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
};
const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const CURRENT_SNAPSHOT_PATH = path.join(SNAPSHOTS_DIR, "current.json");

let snapshotCache = null;
let snapshotCacheTime = 0;
const smallJsonCache = new SmallJsonCache({ maxEntries: 120 });

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    safeLog("read-json-file-error", { filePath, error: error.message });
    return null;
  }
}

function getMeta(key, term) {
  const requestedTerm = String(term || "").trim();
  if (requestedTerm) {
    const termMeta = readTermJson(requestedTerm, "sync-meta", { allowLegacyFallback: true }).data || {};
    if (termMeta && termMeta[key]) return termMeta[key];
    if (requestedTerm !== termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term) return {};
  }
  const meta = readJsonFile(FILE_MAP["sync-meta"]);
  return meta && meta[key] ? meta[key] : {};
}

function normalizeTermOrActive(term) {
  const requested = String(term || "").trim();
  if (requested) {
    const validation = termRegistryService.validateTermId(requested);
    if (!validation.valid) {
      const error = new Error("TERM_NOT_FOUND");
      error.code = "TERM_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    return validation.term;
  }
  const active = termRegistryService.getActiveTerm();
  return active && active.term || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term;
}

function getTermRecordOrError(term) {
  const id = normalizeTermOrActive(term);
  const record = termRegistryService.getTerm(id);
  if (!record) {
    const error = new Error("TERM_NOT_FOUND");
    error.code = "TERM_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  if (record.status === "disabled") {
    const error = new Error("TERM_DISABLED");
    error.code = "TERM_DISABLED";
    error.statusCode = 403;
    throw error;
  }
  return record;
}

function termFilePath(term, key) {
  const fileNameMap = {
    catalog: "catalog.json",
    majors: "majors-index.json",
    "sync-meta": "sync-meta.json",
  };
  return termRegistryService.termDataPath(term, fileNameMap[key]);
}

function readTermJson(term, key, options = {}) {
  const termPath = termFilePath(term, key);
  const data = readJsonFile(termPath);
  if (data) return { data, source: "term-storage", path: termPath };
  if (options.allowLegacyFallback && term === termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term) {
    const legacy = readJsonFile(FILE_MAP[key]);
    if (legacy) return { data: legacy, source: "legacy-current", path: FILE_MAP[key] };
  }
  return { data: null, source: "", path: termPath };
}

function buildTermError(record, code) {
  return {
    success: false,
    code,
    reasonCode: code,
    term: record && record.term || "",
    semester: record && record.term || "",
    releaseVersion: record && record.releaseVersion || "",
    dataAvailable: Boolean(record && record.dataAvailable),
    updatedAt: record && record.updatedAt || "",
    message: code,
  };
}

function getDemoCatalog(term, totalWeeks) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    semesters: [{ value: term, label: `${term} (Demo)` }],
    colleges: [
      { code: "02", name: "Demo College A", rawLabel: "Demo College A" },
      { code: "04", name: "Demo College B", rawLabel: "Demo College B" },
    ],
    grades: ["2022", "2023", "2024", "2025"],
    weeks: Array.from({ length: Number(totalWeeks) || 0 }, (_, index) => ({
      value: String(index + 1),
      label: `Week ${index + 1}`,
    })),
    sections: [],
  };
}

function getDemoMajors() {
  return [
    { code: "0401", name: "Demo Major A" },
    { code: "0402", name: "Demo Major B" },
  ];
}

async function checkDns(hostname) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch (error) {
    return false;
  }
}

async function getCatalog(semester) {
  let record;
  try {
    record = getTermRecordOrError(semester);
  } catch (error) {
    return buildTermError({ term: semester }, error.code || "TERM_NOT_FOUND");
  }

  if (config.DATA_SOURCE_MODE === "disabled") {
    return buildTermError(record, "TERM_DISABLED");
  }

  if (config.DATA_SOURCE_MODE === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    if (!await checkDns(host)) {
      return buildTermError(record, "FOSU_INTRANET_ONLY");
    }
    try {
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchClassOptionsPage();
      if (res.statusCode !== 200) throw new Error(`catalog page failed: ${res.statusCode}`);
      const parsed = parseSchoolOptionsHtml(res.text);
      const colleges = (parsed.colleges || [])
        .map((item) => {
          const rawLabel = item.name || "";
          return {
            code: item.code,
            name: rawLabel.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim(),
            rawLabel,
          };
        })
        .filter((item) => item.code && item.name);
      const semesters = (parsed.semesters || [])
        .map((item) => ({ value: item.code, label: item.name }))
        .filter((item) => item.value);
      if (!semesters.some((item) => item.value === record.term)) {
        semesters.unshift({ value: record.term, label: record.semesterText || record.term });
      }
      return {
        success: true,
        term: record.term,
        semester: record.term,
        releaseVersion: record.releaseVersion || "",
        dataAvailable: record.dataAvailable,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        semesters,
        colleges,
        grades: (parsed.grades || []).map((item) => String(item).trim()).filter((item) => /^\d{4}$/.test(item)),
        weeks: Array.from({ length: Number(record.totalWeeks) || 0 }, (_, index) => ({ value: String(index + 1), label: `Week ${index + 1}` })),
        sections: [],
      };
    } catch (error) {
      safeLog("catalog-realtime-failed", { term: record.term, error: error.message });
      return buildTermError(record, "FOSU_INTRANET_ONLY");
    }
  }

  if (!record.dataAvailable && record.status === "planned") {
    return buildTermError(record, "TERM_NOT_PUBLISHED");
  }

  const termCatalog = readTermJson(record.term, "catalog", { allowLegacyFallback: true });
  if (termCatalog.data) {
    const meta = getMeta("catalog", record.term);
    return {
      success: true,
      term: record.term,
      semester: record.term,
      releaseVersion: record.releaseVersion || "",
      dataAvailable: record.dataAvailable,
      dataSource: termCatalog.source === "legacy-current" ? "legacy-current-cache" : "term-cache",
      updatedAt: meta.updatedAt || record.updatedAt || new Date().toISOString(),
      syncSource: meta.syncSource || "local-sync-client",
      itemCount: meta.itemCount || (termCatalog.data.colleges || []).length,
      semesters: termCatalog.data.semesters || [{ value: record.term, label: record.semesterText }],
      colleges: termCatalog.data.colleges || [],
      grades: termCatalog.data.grades || [],
      weeks: termCatalog.data.weeks || [],
      sections: termCatalog.data.sections || [],
    };
  }

  if (config.NODE_ENV !== "production") {
    return Object.assign(getDemoCatalog(record.term, record.totalWeeks), {
      term: record.term,
      semester: record.term,
      releaseVersion: record.releaseVersion || "",
      dataAvailable: false,
    });
  }

  return buildTermError(record, record.dataAvailable ? "TERM_DATA_MISSING" : "TERM_NOT_PUBLISHED");
}

async function getMajors(collegeCode, grade, semester) {
  if (!collegeCode || !grade) {
    return { success: false, message: "collegeCode and grade are required", majors: [] };
  }

  let record;
  try {
    record = getTermRecordOrError(semester);
  } catch (error) {
    return Object.assign(buildTermError({ term: semester }, error.code || "TERM_NOT_FOUND"), {
      collegeCode,
      grade,
      majors: [],
    });
  }

  if (config.DATA_SOURCE_MODE === "disabled") {
    return Object.assign(buildTermError(record, "TERM_DISABLED"), { collegeCode, grade, majors: [] });
  }

  if (config.DATA_SOURCE_MODE === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    if (!await checkDns(host)) {
      return Object.assign(buildTermError(record, "FOSU_INTRANET_ONLY"), { collegeCode, grade, majors: [] });
    }
    try {
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchMajorOptions({ collegeCode, grade });
      if (res.statusCode !== 200) throw new Error(`majors ajax failed: ${res.statusCode}`);
      const parsed = parseMajorAjaxResponse(res.text, { collegeCode, grade });
      return {
        success: true,
        term: record.term,
        semester: record.term,
        releaseVersion: record.releaseVersion || "",
        dataAvailable: record.dataAvailable,
        collegeCode,
        grade,
        majors: (parsed.majors || []).map((item) => ({ code: item.code, name: item.name })).filter((item) => item.code && item.name),
        updatedAt: new Date().toISOString(),
        dataSource: "fosu-realtime",
      };
    } catch (error) {
      safeLog("majors-realtime-failed", { term: record.term, error: error.message });
      return Object.assign(buildTermError(record, "FOSU_INTRANET_ONLY"), { collegeCode, grade, majors: [] });
    }
  }

  if (!record.dataAvailable && record.status === "planned") {
    return Object.assign(buildTermError(record, "TERM_NOT_PUBLISHED"), { collegeCode, grade, majors: [] });
  }

  const termMajors = readTermJson(record.term, "majors", { allowLegacyFallback: true });
  const majorsIndex = termMajors.data;
  if (majorsIndex && Array.isArray(majorsIndex.colleges)) {
    const college = majorsIndex.colleges.find((item) => String(item.collegeCode) === String(collegeCode));
    let filtered = [];
    if (college && Array.isArray(college.grades)) {
      const gradeObj = college.grades.find((item) => String(item.grade) === String(grade));
      if (gradeObj && Array.isArray(gradeObj.majors)) {
        filtered = gradeObj.majors.map((item) => ({
          code: item.majorCode,
          name: item.majorName,
        }));
      }
    }
    const meta = getMeta("majors", record.term);
    return {
      success: true,
      term: record.term,
      semester: record.term,
      releaseVersion: record.releaseVersion || "",
      dataAvailable: record.dataAvailable,
      collegeCode,
      grade,
      majors: filtered,
      updatedAt: majorsIndex.updatedAt || meta.updatedAt || record.updatedAt || new Date().toISOString(),
      dataSource: termMajors.source === "legacy-current" ? "legacy-current-cache" : "term-cache",
      syncSource: meta.syncSource || "local-sync-client",
      itemCount: filtered.length,
    };
  }

  if (config.NODE_ENV !== "production") {
    return {
      success: true,
      term: record.term,
      semester: record.term,
      releaseVersion: record.releaseVersion || "",
      dataAvailable: false,
      collegeCode,
      grade,
      majors: getDemoMajors(),
      updatedAt: new Date().toISOString(),
      dataSource: "demo",
    };
  }

  return Object.assign(buildTermError(record, record.dataAvailable ? "TERM_DATA_MISSING" : "TERM_NOT_PUBLISHED"), {
    collegeCode,
    grade,
    majors: [],
  });
}

function getSnapshot() {
  const activeReleaseSnapshot = releaseService.readActiveReleaseSnapshot();
  if (activeReleaseSnapshot) return activeReleaseSnapshot;

  if (fs.existsSync(CURRENT_SNAPSHOT_PATH)) {
    try {
      const stat = fs.statSync(CURRENT_SNAPSHOT_PATH);
      if (snapshotCache && snapshotCacheTime === stat.mtimeMs) return snapshotCache;
      snapshotCache = JSON.parse(fs.readFileSync(CURRENT_SNAPSHOT_PATH, "utf-8"));
      snapshotCacheTime = stat.mtimeMs;
      return snapshotCache;
    } catch (error) {
      safeLog("read-snapshot-error", { error: error.message });
      return null;
    }
  }
  return null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

async function getBootstrap(semester) {
  let record;
  try {
    record = getTermRecordOrError(semester);
  } catch (error) {
    return buildTermError({ term: semester }, error.code || "TERM_NOT_FOUND");
  }
  if (!record.dataAvailable && record.status === "planned") {
    return buildTermError(record, "TERM_NOT_PUBLISHED");
  }

  const requestedVersion = record.releaseVersion || "";
  if (requestedVersion) {
    const files = releaseService.getReleaseFiles(requestedVersion);
    const bootstrap = smallJsonCache.read(files.bootstrapPath, null);
    const manifest = smallJsonCache.read(files.manifestPath, null);
    const catalogFile = smallJsonCache.read(termRegistryService.termDataPath(record.term, "catalog.json"), null);
    const sourceTerm = (bootstrap && (bootstrap.term || bootstrap.semester)) ||
      (manifest && (manifest.term || manifest.semester)) ||
      record.term;
    if (sourceTerm === record.term && (bootstrap || manifest || catalogFile)) {
      const updatedAt = (bootstrap && bootstrap.updatedAt) || (manifest && manifest.updatedAt) || record.updatedAt || new Date().toISOString();
      const catalog = bootstrap && bootstrap.catalog || catalogFile || {};
      const counts = Object.assign({}, manifest && manifest.counts || {}, bootstrap && bootstrap.counts || {});
      const warning = bootstrap ? "" : "BOOTSTRAP_FILE_MISSING_USED_LIGHT_FALLBACK";
      return {
        success: true,
        dataSource: bootstrap ? "release-bootstrap" : "release-light-fallback",
        warning,
        term: record.term,
        semester: record.term,
        releaseVersion: requestedVersion,
        dataAvailable: record.dataAvailable,
        updatedAt,
        version: requestedVersion,
        termConfig: (bootstrap && bootstrap.termConfig) || (manifest && manifest.termConfig) || null,
        catalog: {
          semesters: catalog.semesters || [],
          colleges: catalog.colleges || [],
          grades: catalog.grades || [],
          weeks: catalog.weeks || [],
          sections: catalog.sections || [],
        },
        counts,
        versions: {
          snapshot: requestedVersion,
          catalog: requestedVersion,
          majors: requestedVersion,
          classSchedules: requestedVersion,
          resources: requestedVersion,
        },
        metaDetails: Object.assign({
          source: manifest && manifest.source || "release-light",
          disclaimer: bootstrap && bootstrap.metaDetails && bootstrap.metaDetails.disclaimer || "",
          catalogUpdatedAt: updatedAt,
          majorsUpdatedAt: updatedAt,
          classSchedulesUpdatedAt: updatedAt,
          resourcesUpdatedAt: updatedAt,
        }, bootstrap && bootstrap.metaDetails || {}),
      };
    }
    safeLog("bootstrap-lightweight-fallback", {
      term: record.term,
      releaseVersion: requestedVersion,
      reason: "light-files-missing-or-term-mismatch",
    });
  }

  const catalog = await getCatalog(record.term);
  if (!catalog.success) return catalog;
  const meta = getMeta("snapshot", record.term);
  return {
    success: catalog.success,
    dataSource: catalog.dataSource === "empty" ? "empty" : "legacy",
    term: record.term,
    semester: record.term,
    releaseVersion: record.releaseVersion || "",
    dataAvailable: record.dataAvailable,
    updatedAt: catalog.updatedAt,
    catalog: {
      semesters: catalog.semesters || [],
      colleges: catalog.colleges || [],
      grades: catalog.grades || [],
      weeks: catalog.weeks || [],
      sections: catalog.sections || [],
    },
    counts: {
      collegeCount: (catalog.colleges || []).length,
      majorCount: meta.majors?.itemCount || 0,
      classScheduleCount: meta["class-schedules"]?.itemCount || 0,
      adminClassCount: meta["class-schedules"]?.adminClassCount || 0,
      majorAggregateCount: meta["class-schedules"]?.majorAggregateCount || 0,
      teacherScheduleCount: meta["teacher-schedules"]?.itemCount || 0,
      classroomScheduleCount: meta["classroom-schedules"]?.itemCount || 0,
      courseScheduleCount: meta["course-schedules"]?.itemCount || 0,
    },
    versions: {
      legacy: meta.version || "1.0.0",
      resources: meta.snapshot?.version || meta.version || "1.0.0",
    },
    metaDetails: {
      disclaimer: "",
      catalogUpdatedAt: meta.catalog?.updatedAt || catalog.updatedAt || null,
      majorsUpdatedAt: meta.majors?.updatedAt || null,
      classSchedulesUpdatedAt: meta["class-schedules"]?.updatedAt || null,
      resourcesUpdatedAt: meta["teacher-schedules"]?.updatedAt || meta["classroom-schedules"]?.updatedAt || meta["course-schedules"]?.updatedAt || null,
    },
  };
}

async function getClasses(query = {}) {
  const semester = normalizeTermOrActive(query.semester || query.term);
  const collegeCode = query.collegeCode;
  const grade = query.grade;
  const majorCode = query.majorCode;
  if (!collegeCode || !grade || !majorCode) {
    return {
      success: false,
      code: "INVALID_FILTER",
      message: "collegeCode, grade and majorCode are required",
      term: semester,
      adminClasses: [],
      majorAggregates: [],
    };
  }

  const record = getTermRecordOrError(semester);
  if (!record.dataAvailable && record.status === "planned") {
    return Object.assign(buildTermError(record, "TERM_NOT_PUBLISHED"), {
      adminClasses: [],
      majorAggregates: [],
    });
  }

  let schedules = [];
  if (record.releaseVersion) {
    const index = releaseService.readActiveIndex("class", record.releaseVersion, { term: record.term });
    if (index && index.success && Array.isArray(index.items)) {
      schedules = index.items;
    }
  } else if (record.term === termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term) {
    schedules = readJsonFile(path.join(STORAGE_DIR, "class-schedules.json")) || [];
  }

  const filtered = schedules.filter((item) =>
    String(item.semester || item.term || "") === String(semester) &&
    String(item.collegeCode || "") === String(collegeCode) &&
    String(item.grade || "") === String(grade) &&
    String(item.majorCode || "") === String(majorCode)
  );

  const adminClasses = [];
  const majorAggregates = [];
  filtered.forEach((item) => {
    const decodedName = safeDecode(item.className || "");
    const classObj = {
      classId: item.classId || item.className,
      className: decodedName,
      displayType: item.displayType,
      isAggregated: Boolean(item.isAggregated),
    };
    if (item.displayType === "class-schedule" && !item.isAggregated) {
      adminClasses.push(classObj);
    } else {
      majorAggregates.push(classObj);
    }
  });

  return {
    success: true,
    term: record.term,
    releaseVersion: record.releaseVersion || "",
    dataAvailable: record.dataAvailable,
    adminClasses,
    majorAggregates,
  };
}

module.exports = {
  getBootstrap,
  getCatalog,
  getClasses,
  getMajors,
  getSnapshot,
};
