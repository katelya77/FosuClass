const ENABLED_KEY = "FOSU_XIAOFU_FLOAT_ENABLED";
const POSITION_KEY = "FOSU_XIAOFU_FLOAT_POSITION";
const HIDDEN_ROUTES_KEY = "FOSU_XIAOFU_FLOAT_HIDDEN_ROUTES";
const PENDING_CONTEXT_KEY = "FOSU_XIAOFU_FLOAT_PENDING_CONTEXT";
const PROACTIVE_INSIGHT_KEY = "FOSU_XIAOFU_PROACTIVE_INSIGHT";

const TABBAR_ROUTES = [
  "pages/index/index",
  "pages/school/school",
  "pages/today/today",
  "pages/calendar/calendar",
  "pages/settings/settings",
];

const HIDDEN_ROUTE_PATTERNS = [
  /pages\/ai-assistant\/ai-assistant/,
  /pages\/login\/login/,
  /pages\/personal-sync\/personal-sync/,
  /pages\/custom-courses\/custom-courses/,
  /pages\/contribute\/contribute/,
];

const DIMMED_ROUTE_PATTERNS = [
  /pages\/campus-map\/campus-map/,
  /packageMaps\/pages\/campus-map\/campus-map/,
  /packageXiaofu\/pages\/ai-assistant\/ai-assistant/,
  /pages\/schedule-view\/schedule-view/,
  /pages\/timetable\/timetable/,
  /pages\/empty-room\/empty-room/,
];

function getWx() {
  return typeof wx !== "undefined" ? wx : null;
}

function readStorage(key, fallback) {
  const wxRef = getWx();
  if (!wxRef) return fallback;
  try {
    const value = wxRef.getStorageSync(key);
    return value === "" || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  const wxRef = getWx();
  if (!wxRef) return false;
  try {
    wxRef.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function removeStorage(key) {
  const wxRef = getWx();
  if (!wxRef) return;
  try {
    wxRef.removeStorageSync(key);
  } catch (error) {
    // best effort
  }
}

function normalizeRoute(route) {
  return String(route || "").replace(/^\/+/, "");
}

function isEnabled() {
  return readStorage(ENABLED_KEY, true) !== false;
}

function setEnabled(enabled) {
  writeStorage(ENABLED_KEY, enabled !== false);
  return enabled !== false;
}

function getHiddenRoutes() {
  const value = readStorage(HIDDEN_ROUTES_KEY, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function setRouteHidden(route, hidden) {
  const key = normalizeRoute(route);
  if (!key) return getHiddenRoutes();
  const routes = Object.assign({}, getHiddenRoutes());
  if (hidden) routes[key] = true;
  else delete routes[key];
  writeStorage(HIDDEN_ROUTES_KEY, routes);
  return routes;
}

function clearHiddenRoutes() {
  removeStorage(HIDDEN_ROUTES_KEY);
  return {};
}

function isRouteHidden(route) {
  const key = normalizeRoute(route);
  const routes = getHiddenRoutes();
  return Boolean(key && routes[key]);
}

function getRoutePolicy(route) {
  const normalized = normalizeRoute(route);
  const hidden = HIDDEN_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
  const dimmed = DIMMED_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
  const tabbar = TABBAR_ROUTES.indexOf(normalized) >= 0;
  return {
    route: normalized,
    hidden,
    dimmed,
    tabbar,
    bottomAvoidPx: tabbar ? 58 : (dimmed ? 42 : 14),
  };
}

function getPosition() {
  const value = readStorage(POSITION_KEY, null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function savePosition(position) {
  const source = position || {};
  const x = Number(source.x);
  const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return writeStorage(POSITION_KEY, {
    x: Math.round(x),
    y: Math.round(y),
    updatedAt: Date.now(),
  });
}

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || 120);
}

function readFirstText(source, keys, maxLength) {
  const object = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  for (let index = 0; index < keys.length; index += 1) {
    const value = safeText(object[keys[index]], maxLength || 120);
    if (value) return value;
  }
  return "";
}

function compactObjectText(value, maxLength) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return readFirstText(value, [
    "title",
    "name",
    "label",
    "className",
    "teacherName",
    "roomName",
    "classroom",
    "courseName",
    "displayName",
  ], maxLength || 80);
}

function inferPageTarget(data) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const objectCandidates = [
    "selectedCourse",
    "selectedRoom",
    "selectedPlace",
    "currentPlace",
    "selectedClassroom",
    "currentClassroom",
    "currentCourse",
    "target",
    "currentTarget",
  ];
  for (let index = 0; index < objectCandidates.length; index += 1) {
    const object = source[objectCandidates[index]];
    const text = compactObjectText(object, 100);
    if (text) return { targetName: text, raw: objectCandidates[index] };
  }
  const direct = readFirstText(source, [
    "selectedScheduleText",
    "selectedCampusName",
    "currentCampus",
    "keyword",
    "searchKeyword",
    "query",
  ], 100);
  return direct ? { targetName: direct, raw: "page-data" } : null;
}

function inferTargetType(route, data, target) {
  const normalized = normalizeRoute(route);
  const source = data || {};
  if (/campus-map/.test(normalized)) return "navigation";
  if (/empty-room/.test(normalized)) return "room";
  if (/schedule-view|timetable|today|index/.test(normalized)) return "schedule";
  if (target && /selectedRoom|classroom/i.test(target.raw || "")) return "room";
  if (source.selectedCourse || source.currentCourse) return "course";
  return "";
}

function buildPageContext(explicitContext) {
  const explicit = explicitContext && typeof explicitContext === "object" && !Array.isArray(explicitContext)
    ? explicitContext
    : {};
  let page = null;
  try {
    const pages = getCurrentPages && getCurrentPages();
    page = pages && pages.length ? pages[pages.length - 1] : null;
  } catch (error) {
    page = null;
  }
  const route = normalizeRoute(explicit.route || page && page.route || "");
  const data = page && page.data || {};
  const inferred = inferPageTarget(Object.assign({}, data, explicit));
  const targetName = safeText(explicit.targetName || inferred && inferred.targetName || "", 100);
  const targetType = safeText(explicit.targetType || inferTargetType(route, data, inferred), 40);
  return {
    route,
    title: safeText(explicit.title || targetName || route, 80),
    targetType,
    targetName,
    query: safeText(explicit.query || "", 160),
    source: "xiaofu-float",
    capturedAt: new Date().toISOString(),
  };
}

function savePendingContext(context) {
  const payload = buildPageContext(context);
  writeStorage(PENDING_CONTEXT_KEY, payload);
  return payload;
}

function consumePendingContext(maxAgeMs) {
  const value = readStorage(PENDING_CONTEXT_KEY, null);
  removeStorage(PENDING_CONTEXT_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capturedAt = Date.parse(value.capturedAt || "");
  const ageLimit = Number(maxAgeMs || 10 * 60 * 1000);
  if (capturedAt && Date.now() - capturedAt > ageLimit) return null;
  return value;
}

function enableEverywhere() {
  setEnabled(true);
  clearHiddenRoutes();
  return true;
}

function setProactiveInsight(insight) {
  const source = insight && typeof insight === "object" && !Array.isArray(insight) ? insight : {};
  const payload = {
    kind: safeText(source.kind, 32),
    eyebrow: safeText(source.eyebrow, 32),
    title: safeText(source.title, 100),
    detail: safeText(source.detail, 160),
    actionLabel: safeText(source.actionLabel, 32),
    actionUrl: safeText(source.actionUrl, 160),
    actionMessage: safeText(source.actionMessage, 160),
    capturedAt: new Date().toISOString(),
  };
  if (!payload.title) {
    removeStorage(PROACTIVE_INSIGHT_KEY);
    return null;
  }
  writeStorage(PROACTIVE_INSIGHT_KEY, payload);
  return payload;
}

function getProactiveInsight(maxAgeMs) {
  const value = readStorage(PROACTIVE_INSIGHT_KEY, null);
  if (!value || typeof value !== "object" || Array.isArray(value) || !safeText(value.title, 100)) return null;
  const capturedAt = Date.parse(value.capturedAt || "");
  const ageLimit = Math.max(60 * 1000, Number(maxAgeMs || 15 * 60 * 1000));
  if (!capturedAt || Date.now() - capturedAt > ageLimit) return null;
  return {
    kind: safeText(value.kind, 32),
    eyebrow: safeText(value.eyebrow, 32),
    title: safeText(value.title, 100),
    detail: safeText(value.detail, 160),
    actionLabel: safeText(value.actionLabel, 32),
    actionUrl: safeText(value.actionUrl, 160),
    actionMessage: safeText(value.actionMessage, 160),
    capturedAt: value.capturedAt,
  };
}

module.exports = {
  ENABLED_KEY,
  HIDDEN_ROUTES_KEY,
  PENDING_CONTEXT_KEY,
  POSITION_KEY,
  PROACTIVE_INSIGHT_KEY,
  buildPageContext,
  clearHiddenRoutes,
  consumePendingContext,
  enableEverywhere,
  getPosition,
  getProactiveInsight,
  getRoutePolicy,
  isEnabled,
  isRouteHidden,
  normalizeRoute,
  savePendingContext,
  savePosition,
  setEnabled,
  setProactiveInsight,
  setRouteHidden,
};
