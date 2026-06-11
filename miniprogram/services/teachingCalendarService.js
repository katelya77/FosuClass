const request = require("../utils/request");
const { STATIC_RELEASE_BASE_URL } = require("../config/api");
const releasePackService = require("./releasePackService");
const { formatWeekRange, getTermCalendarWeeks, isValidDate } = require("../utils/week");
const { BUILTIN_TERM_CONFIG, getBuiltinTeachingCalendar } = require("../data/builtinTeachingCalendar");

const CACHE_PREFIX = "fosu:v6:teaching-calendar";
const LAST_GOOD_PREFIX = `${CACHE_PREFIX}:last-good`;
const TERM_CALENDAR_CACHE_SCHEMA = 2;
const FAST_CALENDAR_TIMEOUT_MS = 2500;
const FAST_POINTER_TIMEOUT_MS = 2000;
const TYPE_TEXT = {
  opening: "开学教学周",
  teaching: "正常教学周",
  holiday: "节假日/调休周",
  adjustment: "调整教学周",
  midterm: "期中教学检查",
  closing: "结课周",
  review: "复习周",
  exam: "考试周",
  flexible: "机动周",
  pending: "教学安排待维护",
};

function cachePart(value, fallback = "unknown") {
  return encodeURIComponent(String(value || fallback));
}

function getCacheKey(term, releaseVersion) {
  return `${CACHE_PREFIX}:${cachePart(term)}:${cachePart(releaseVersion)}`;
}

function getLastGoodCacheKey(term) {
  return `${LAST_GOOD_PREFIX}:${cachePart(term || BUILTIN_TERM_CONFIG.term)}`;
}

function readCache(term, releaseVersion) {
  try {
    const entry = wx.getStorageSync(getCacheKey(term, releaseVersion)) || null;
    if (entry && isStaleCalendarEntry(entry)) {
      wx.removeStorageSync(getCacheKey(term, releaseVersion));
      return null;
    }
    return entry;
  } catch (error) {
    return null;
  }
}

function readLastGoodCalendar(term) {
  try {
    const key = getLastGoodCacheKey(term);
    const entry = wx.getStorageSync(key) || null;
    if (entry && isStaleCalendarEntry(entry)) {
      wx.removeStorageSync(key);
      return null;
    }
    return entry && entry.calendar || null;
  } catch (error) {
    return null;
  }
}

function writeCache(calendar) {
  if (!calendar || !calendar.term || !calendar.releaseVersion) return calendar;
  try {
    const entry = {
      savedAt: Date.now(),
      schemaVersion: TERM_CALENDAR_CACHE_SCHEMA,
      calendar,
    };
    wx.setStorageSync(getCacheKey(calendar.term, calendar.releaseVersion), entry);
    if (isUsableCalendar(calendar)) {
      wx.setStorageSync(getLastGoodCacheKey(calendar.term), entry);
    }
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
  const type = source.type || "pending";
  const typeText = source.typeText || TYPE_TEXT[type] || fallbackTitle || "教学安排待维护";
  const title = source.title || source.note || source.notes || fallbackTitle || typeText || "教学安排待维护";
  return {
    weekNo: Number(source.weekNo || source.week || 0),
    startDate: source.startDate || "",
    endDate: source.endDate || "",
    type,
    typeText,
    title,
    note: source.note || source.notes || "",
    notes: source.note || source.notes || "",
    rangeText: source.startDate && source.endDate ? formatWeekRange(source.startDate, source.endDate) : "",
  };
}

function hasBadCalendarDates(calendar) {
  const weeks = Array.isArray(calendar && calendar.weeks) ? calendar.weeks : [];
  if (!weeks.length) return true;
  return weeks.some((week) => {
    const text = `${week.startDate || ""}${week.endDate || ""}${week.rangeText || ""}`;
    return text.includes("NaN") ||
      !week.startDate ||
      !week.endDate ||
      !isValidDate(week.startDate) ||
      !isValidDate(week.endDate);
  });
}

function isStaleCalendar(calendar) {
  if (!calendar || typeof calendar !== "object") return true;
  const termConfig = calendar.termConfig || {};
  if (!Array.isArray(calendar.weeks) || calendar.weeks.length < 1) return true;
  if (String(calendar.term || termConfig.term || "") === BUILTIN_TERM_CONFIG.term) {
    if (Number(termConfig.totalWeeks || calendar.totalWeeks || 0) !== BUILTIN_TERM_CONFIG.totalWeeks) return true;
    if (String(termConfig.termStartDate || calendar.termStartDate || "") !== BUILTIN_TERM_CONFIG.termStartDate) return true;
    if (String(termConfig.weekStart || calendar.weekStart || "") !== BUILTIN_TERM_CONFIG.weekStart) return true;
    if (calendar.weeks.length !== BUILTIN_TERM_CONFIG.totalWeeks) return true;
  }
  return hasBadCalendarDates(calendar);
}

function isStaleCalendarEntry(entry) {
  if (!entry || typeof entry !== "object") return true;
  if (entry.schemaVersion !== TERM_CALENDAR_CACHE_SCHEMA) return true;
  return isStaleCalendar(entry.calendar || entry);
}

function readStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {}
}

function getStorageKeys() {
  try {
    const info = wx.getStorageInfoSync();
    return Array.isArray(info.keys) ? info.keys : [];
  } catch (error) {
    return [];
  }
}

function cleanLegacyCalendarCaches() {
  const removed = [];
  let foundStaleDateCache = false;
  const keys = getStorageKeys();
  keys.forEach((key) => {
    if (key.startsWith(CACHE_PREFIX)) {
      const entry = readStorage(key);
      if (!entry || isStaleCalendarEntry(entry)) {
        removeStorage(key);
        removed.push(key);
        foundStaleDateCache = true;
      }
      return;
    }
    if (key === "FOSU_APP_CONFIG_CACHE") {
      const cached = readStorage(key);
      const config = cached && cached.config || {};
      const termConfig = config.termConfig || {};
      if (
        termConfig.term === BUILTIN_TERM_CONFIG.term &&
        (Number(termConfig.totalWeeks || 0) === 20 || !termConfig.termStartDate)
      ) {
        removeStorage(key);
        removed.push(key);
        foundStaleDateCache = true;
      }
    }
  });
  if (foundStaleDateCache) {
    ["FOSU_CURRENT_WEEK_DERIVED_CACHE", "FOSU_RUNTIME_TERM_CONFIG_CACHE"].forEach((key) => {
      if (keys.includes(key)) {
        removeStorage(key);
        removed.push(key);
      }
    });
  }
  return removed;
}

function normalizeCalendar(payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) return null;
  const term = source.term || fallback.term || "";
  const releaseVersion = source.releaseVersion || fallback.releaseVersion || "";
  const defaultWeekTitle = source.defaultWeekTitle || fallback.defaultWeekTitle || "正常教学周";
  const fallbackTermConfig = fallback.termConfig || {};
  const termConfig = Object.assign({}, fallbackTermConfig, {
    termStartDate: source.termStartDate || source.startDate || source.termStart,
    totalWeeks: source.totalWeeks || source.weekCount,
    weekStart: source.weekStart,
  }, source.termConfig || {}, {
    term: source.term || fallback.term || (fallback.termConfig && fallback.termConfig.term) || "",
    semesterText: source.semesterText || fallback.semesterText || fallback.termConfig && fallback.termConfig.semesterText || "",
    releaseVersion,
  });
  termConfig.termStartDate = termConfig.termStartDate || fallbackTermConfig.termStartDate || "";
  termConfig.totalWeeks = Number(termConfig.totalWeeks || fallbackTermConfig.totalWeeks || BUILTIN_TERM_CONFIG.totalWeeks) || BUILTIN_TERM_CONFIG.totalWeeks;
  termConfig.weekStart = termConfig.weekStart || fallbackTermConfig.weekStart || "monday";
  const generatedWeeks = getTermCalendarWeeks(termConfig);
  const generatedByWeek = {};
  generatedWeeks.forEach((week) => {
    generatedByWeek[week.weekNo] = normalizeWeek(Object.assign({}, week, {
      type: fallback.planned ? "pending" : "teaching",
      typeText: fallback.planned ? TYPE_TEXT.pending : TYPE_TEXT.teaching,
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
    schemaVersion: TERM_CALENDAR_CACHE_SCHEMA,
    term,
    releaseVersion,
    calendarRevision: source.calendarRevision || fallback.calendarRevision || "",
    semesterText: source.semesterText || fallback.semesterText || "",
    source: source.source || fallback.source || "calendar",
    updatedAt: source.updatedAt || "",
    defaultWeekTitle,
    termConfig,
    weeks: Object.keys(generatedByWeek)
      .map((key) => generatedByWeek[key])
      .sort((left, right) => Number(left.weekNo) - Number(right.weekNo)),
  };
}

function isUsableCalendar(calendar) {
  return Boolean(calendar && Array.isArray(calendar.weeks) && calendar.weeks.length >= 1 && !isStaleCalendar(calendar));
}

function getBuiltinCalendar(reason, extra = {}) {
  return Object.assign({}, normalizeCalendar(getBuiltinTeachingCalendar(), {
    term: BUILTIN_TERM_CONFIG.term,
    releaseVersion: "",
    calendarRevision: BUILTIN_TERM_CONFIG.calendarRevision,
    semesterText: BUILTIN_TERM_CONFIG.semesterText,
    termConfig: BUILTIN_TERM_CONFIG,
  }), {
    fallback: true,
    builtin: true,
    fallbackReason: reason || "builtin-calendar",
    source: extra.source || "builtin-fallback",
  });
}

function getEmptyCalendar(term, releaseVersion, reason) {
  return {
    success: false,
    schemaVersion: TERM_CALENDAR_CACHE_SCHEMA,
    term: term || "",
    releaseVersion: releaseVersion || "",
    semesterText: "",
    source: "empty",
    fallback: true,
    fallbackReason: reason || "calendar-unavailable",
    termConfig: Object.assign({}, BUILTIN_TERM_CONFIG, {
      term: term || "",
      releaseVersion: releaseVersion || "",
      termStartDate: "",
      totalWeeks: 0,
    }),
    weeks: [],
  };
}

function getLocalFallbackCalendar(term, reason) {
  const requestedTerm = term || BUILTIN_TERM_CONFIG.term;
  const lastGood = readLastGoodCalendar(requestedTerm);
  if (isUsableCalendar(lastGood)) {
    return Object.assign({}, lastGood, {
      fromStorage: true,
      fallback: true,
      fallbackReason: reason || "last-good-calendar",
    });
  }
  if (requestedTerm !== BUILTIN_TERM_CONFIG.term) {
    return getEmptyCalendar(requestedTerm, "", reason);
  }
  return getBuiltinCalendar(reason || "builtin-calendar");
}

function getImmediateActiveCalendar(options = {}) {
  cleanLegacyCalendarCaches();
  const optionTerm = options.term || "";
  const local = releasePackService.getLocalActiveRelease(optionTerm || BUILTIN_TERM_CONFIG.term) ||
    (!optionTerm ? releasePackService.getLocalActiveRelease(BUILTIN_TERM_CONFIG.term) : null);
  const term = optionTerm || local && local.term || BUILTIN_TERM_CONFIG.term;
  const releaseVersion = options.releaseVersion || local && local.releaseVersion || "";
  const cached = readCache(term, releaseVersion);
  if (cached && isUsableCalendar(cached.calendar)) {
    return Object.assign({}, cached.calendar, {
      fromStorage: true,
      source: cached.calendar.source || "calendar-cache",
    });
  }
  const lastGood = readLastGoodCalendar(term);
  if (isUsableCalendar(lastGood)) {
    return Object.assign({}, lastGood, {
      fromStorage: true,
      fallback: true,
      fallbackReason: "last-good-calendar",
      source: lastGood.source || "last-good-calendar",
    });
  }
  if ((term || BUILTIN_TERM_CONFIG.term) === BUILTIN_TERM_CONFIG.term) {
    return getBuiltinCalendar("immediate-builtin", { source: "builtin-immediate" });
  }
  return getEmptyCalendar(term, releaseVersion, "calendar-unavailable");
}

function resolveCalendarUrl(manifest, term, releaseVersion) {
  if (manifest && manifest.calendarUrl) return manifest.calendarUrl;
  const version = releaseVersion || manifest && manifest.releaseVersion || "";
  return version ? joinUrl(STATIC_RELEASE_BASE_URL, version, "calendar.json") : "";
}

function fastTimeout(value, fallback) {
  const number = Number(value || fallback) || fallback;
  return Math.max(1000, Math.min(fallback, number));
}

function loadTeachingCalendar(options = {}) {
  const manifest = options.manifest || null;
  const term = options.term || manifest && manifest.term || "";
  const releaseVersion = options.releaseVersion || manifest && manifest.releaseVersion || "";
  const cached = readCache(term, releaseVersion);
  if (cached && isUsableCalendar(cached.calendar) && !options.forceNetwork) {
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
      timeout: fastTimeout(options.calendarTimeout || options.timeout, FAST_CALENDAR_TIMEOUT_MS),
      retries: options.retries === undefined ? 0 : options.retries,
      skipSession: true,
      suppressWarn: true,
    })
    : Promise.reject(Object.assign(new Error("CALENDAR_URL_MISSING"), { code: "CALENDAR_URL_MISSING" }));
  return loadStatic
    .catch((staticError) => request.get("/api/fosu/teaching-calendar", { term, releaseVersion }, {
      showLoading: false,
      silentError: true,
      timeout: fastTimeout(options.calendarTimeout || options.timeout, FAST_CALENDAR_TIMEOUT_MS),
      retries: 0,
      skipSession: true,
      suppressWarn: true,
    }).catch(() => {
      throw staticError;
    }))
    .then((payload) => {
      const normalized = normalizeCalendar(payload, fallback);
      if (!isUsableCalendar(normalized)) {
        const error = new Error("CALENDAR_WEEKS_EMPTY");
        error.code = "CALENDAR_WEEKS_EMPTY";
        throw error;
      }
      return writeCache(normalized);
    })
    .catch((error) => {
      const reason = error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError");
      if (cached && isUsableCalendar(cached.calendar)) {
        return Object.assign({}, cached.calendar, { fromStorage: true, fallback: true, fallbackReason: reason });
      }
      if ((term || BUILTIN_TERM_CONFIG.term) === BUILTIN_TERM_CONFIG.term) {
        return getLocalFallbackCalendar(term, reason);
      }
      const generated = normalizeCalendar({
        term,
        releaseVersion,
        semesterText: fallback.semesterText,
        weeks: [],
        source: fallback.planned ? "generated-planned" : "generated-date-range",
      }, fallback);
      if (isUsableCalendar(generated) && generated.weeks.some((week) => week.startDate && week.title)) {
        return Object.assign({}, generated, { fallback: true, fallbackReason: reason });
      }
      return getLocalFallbackCalendar(term, reason);
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
  const fromPointer = () => releasePackService.resolveRuntimePointer({
    timeout: fastTimeout(options.pointerTimeout, FAST_POINTER_TIMEOUT_MS),
    retries: 0,
    skipSession: true,
  })
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
  const fromActiveManifest = () => releasePackService.getActiveManifest({
    term: options.term || "",
    timeout: fastTimeout(options.manifestTimeout, FAST_CALENDAR_TIMEOUT_MS),
    retries: 0,
    skipSession: true,
    suppressWarn: true,
  }).then((manifest) => loadTeachingCalendar(Object.assign({}, options, {
    term: manifest.term,
    releaseVersion: manifest.releaseVersion,
    manifest,
  })));
  return fromPointer()
    .catch(() => fromActiveManifest())
    .catch((error) => getLocalFallbackCalendar(options.term || BUILTIN_TERM_CONFIG.term, error && (error.code || error.message)));
}

module.exports = {
  BUILTIN_TERM_CONFIG,
  TERM_CALENDAR_CACHE_SCHEMA,
  cleanLegacyCalendarCaches,
  getCacheKey,
  getBuiltinCalendar,
  getImmediateActiveCalendar,
  loadActiveTeachingCalendar,
  loadTeachingCalendar,
  normalizeCalendar,
  readCache,
  readLastGoodCalendar,
};
