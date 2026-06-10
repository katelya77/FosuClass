const request = require("../utils/request");
const { STATIC_RELEASE_BASE_URL } = require("../config/api");
const releasePackService = require("./releasePackService");
const { formatWeekRange, getTermCalendarWeeks } = require("../utils/week");

const CACHE_PREFIX = "fosu:v6:teaching-calendar";

function cachePart(value, fallback = "unknown") {
  return encodeURIComponent(String(value || fallback));
}

function getCacheKey(term, releaseVersion) {
  return `${CACHE_PREFIX}:${cachePart(term)}:${cachePart(releaseVersion)}`;
}

function readCache(term, releaseVersion) {
  try {
    return wx.getStorageSync(getCacheKey(term, releaseVersion)) || null;
  } catch (error) {
    return null;
  }
}

function writeCache(calendar) {
  if (!calendar || !calendar.term || !calendar.releaseVersion) return calendar;
  try {
    wx.setStorageSync(getCacheKey(calendar.term, calendar.releaseVersion), {
      savedAt: Date.now(),
      calendar,
    });
  } catch (error) {}
  return calendar;
}

function joinUrl(base, ...parts) {
  const root = String(base || "").replace(/\/+$/g, "");
  const suffix = parts.map((part) => String(part || "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return suffix ? `${root}/${suffix}` : root;
}

function normalizeWeek(item, fallbackTitle) {
  const source = item || {};
  const title = source.title || source.note || source.notes || fallbackTitle || "教学安排待维护";
  return {
    weekNo: Number(source.weekNo || source.week || 0),
    startDate: source.startDate || "",
    endDate: source.endDate || "",
    type: source.type || "pending",
    title,
    note: source.note || source.notes || "",
    notes: source.note || source.notes || "",
    rangeText: source.startDate && source.endDate ? formatWeekRange(source.startDate, source.endDate) : "",
  };
}

function normalizeCalendar(payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) return null;
  const term = source.term || fallback.term || "";
  const releaseVersion = source.releaseVersion || fallback.releaseVersion || "";
  const defaultWeekTitle = source.defaultWeekTitle || fallback.defaultWeekTitle || "正常教学周";
  const generatedWeeks = getTermCalendarWeeks(fallback.termConfig || source.termConfig || {});
  const generatedByWeek = {};
  generatedWeeks.forEach((week) => {
    generatedByWeek[week.weekNo] = normalizeWeek(Object.assign({}, week, {
      type: fallback.planned ? "pending" : "teaching",
      title: fallback.planned ? "教学安排待维护" : defaultWeekTitle,
    }), defaultWeekTitle);
  });
  (Array.isArray(source.weeks) ? source.weeks : []).forEach((week) => {
    const normalized = normalizeWeek(week, defaultWeekTitle);
    if (normalized.weekNo) {
      generatedByWeek[normalized.weekNo] = Object.assign({}, generatedByWeek[normalized.weekNo] || {}, normalized);
    }
  });
  return {
    success: true,
    schemaVersion: source.schemaVersion || 1,
    term,
    releaseVersion,
    semesterText: source.semesterText || fallback.semesterText || "",
    source: source.source || fallback.source || "calendar",
    updatedAt: source.updatedAt || "",
    defaultWeekTitle,
    weeks: Object.keys(generatedByWeek)
      .map((key) => generatedByWeek[key])
      .sort((left, right) => Number(left.weekNo) - Number(right.weekNo)),
  };
}

function resolveCalendarUrl(manifest, term, releaseVersion) {
  if (manifest && manifest.calendarUrl) return manifest.calendarUrl;
  const version = releaseVersion || manifest && manifest.releaseVersion || "";
  return version ? joinUrl(STATIC_RELEASE_BASE_URL, version, "calendar.json") : "";
}

function loadTeachingCalendar(options = {}) {
  const manifest = options.manifest || null;
  const term = options.term || manifest && manifest.term || "";
  const releaseVersion = options.releaseVersion || manifest && manifest.releaseVersion || "";
  const cached = readCache(term, releaseVersion);
  if (cached && cached.calendar && !options.forceNetwork) {
    return Promise.resolve(Object.assign({}, cached.calendar, { fromStorage: true }));
  }
  const url = resolveCalendarUrl(manifest, term, releaseVersion);
  const fallback = {
    term,
    releaseVersion,
    semesterText: manifest && manifest.semesterText || "",
    termConfig: manifest && manifest.termConfig || options.termConfig || {},
    planned: options.planned === true,
  };
  const loadStatic = url
    ? request.get(url, {}, {
      showLoading: false,
      silentError: true,
      timeout: options.timeout || 8000,
      retries: options.retries === undefined ? 1 : options.retries,
      skipSession: true,
    })
    : Promise.reject(Object.assign(new Error("CALENDAR_URL_MISSING"), { code: "CALENDAR_URL_MISSING" }));
  return loadStatic
    .catch((staticError) => request.get("/api/fosu/teaching-calendar", { term, releaseVersion }, {
      showLoading: false,
      silentError: true,
      timeout: options.timeout || 8000,
      retries: 0,
      skipSession: options.skipSession === true,
    }).catch(() => {
      throw staticError;
    }))
    .then((payload) => writeCache(normalizeCalendar(payload, fallback)))
    .catch((error) => {
      if (cached && cached.calendar) return Object.assign({}, cached.calendar, { fromStorage: true, fallback: true });
      const generated = normalizeCalendar({
        term,
        releaseVersion,
        semesterText: fallback.semesterText,
        weeks: [],
        source: fallback.planned ? "generated-planned" : "generated-date-range",
      }, fallback);
      if (generated) return generated;
      throw error;
    });
}

function loadActiveTeachingCalendar(options = {}) {
  const local = releasePackService.getLocalActiveRelease(options.term || "");
  if (local && local.manifest) {
    return loadTeachingCalendar(Object.assign({}, options, {
      term: local.term,
      releaseVersion: local.releaseVersion,
      manifest: local.manifest,
    }));
  }
  return releasePackService.resolveRuntimePointer({ timeout: options.timeout || 5000 })
    .then((pointer) => loadTeachingCalendar(Object.assign({}, options, {
      term: pointer.activeTerm || pointer.term,
      releaseVersion: pointer.releaseVersion,
      manifest: {
        term: pointer.activeTerm || pointer.term,
        releaseVersion: pointer.releaseVersion,
        semesterText: pointer.termConfig && pointer.termConfig.semesterText,
        termConfig: pointer.termConfig,
        calendarUrl: pointer.urls && pointer.urls.calendar,
      },
    })));
}

module.exports = {
  getCacheKey,
  loadActiveTeachingCalendar,
  loadTeachingCalendar,
  normalizeCalendar,
  readCache,
};
