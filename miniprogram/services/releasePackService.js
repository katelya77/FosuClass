const request = require("../utils/request");

const DEFAULT_TERM = "2025-2026-2";
const CACHE_PREFIX = "fosu:v5";
const INDEX_TYPES = ["class", "teacher", "classroom", "course"];
const INDEX_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const DETAIL_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const EMPTY_ROOM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_EMPTY_ROOM_SECTION = 14;
const MAX_EMPTY_ROOM_WEEK = 30;
const LOCAL_ACTIVE_RELEASE_KEY = `${CACHE_PREFIX}:active-release`;
let activeManifestInflight = null;
let switchReleaseInflight = null;

function cachePart(value, fallback = "unknown") {
  return encodeURIComponent(String(value || fallback));
}

function getManifestCacheKey(term) {
  return `${CACHE_PREFIX}:manifest:${cachePart(term || DEFAULT_TERM)}`;
}

function getIndexCacheKey(term, releaseVersion, type) {
  return `${CACHE_PREFIX}:index:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}:${cachePart(type)}`;
}

function getDetailCacheKey(term, releaseVersion, type, id) {
  return `${CACHE_PREFIX}:detail:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}:${cachePart(type)}:${cachePart(id)}`;
}

function getEmptyRoomCacheKey(term, releaseVersion) {
  return `${CACHE_PREFIX}:empty-room:${cachePart(term || DEFAULT_TERM)}:${cachePart(releaseVersion)}`;
}

function getLastGoodCacheKey(term) {
  return `${CACHE_PREFIX}:last-good:${cachePart(term || DEFAULT_TERM)}`;
}

function readStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    // ignore storage cleanup failures
  }
}

function getStorageKeys() {
  try {
    const info = wx.getStorageInfoSync();
    return Array.isArray(info.keys) ? info.keys : [];
  } catch (error) {
    return [];
  }
}

function normalizeManifest(payload) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) return null;
  const releaseVersion = source.releaseVersion || source.version || "";
  if (!releaseVersion) return null;
  const term = source.term || source.semester || DEFAULT_TERM;
  const updatedAt = source.updatedAt || source.publishedAt || "";
  const cacheEpoch = source.cacheEpoch || source.dataEpoch || Date.parse(updatedAt || "") || Date.now();
  const forceRefreshToken = source.forceRefreshToken || source.dataEpoch || `${releaseVersion}:${cacheEpoch}`;
  return Object.assign({}, source, {
    success: true,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    cacheEpoch,
    dataEpoch: source.dataEpoch || cacheEpoch,
    forceRefreshToken,
    minClientCacheSchema: source.minClientCacheSchema || 5,
    packStatus: source.packStatus || source.pack || {},
  });
}

function assertManifest(manifest) {
  if (!manifest || !manifest.term || !manifest.releaseVersion) {
    const error = new Error("INVALID_RELEASE_PACK_MANIFEST");
    error.code = "INVALID_RELEASE_PACK_MANIFEST";
    throw error;
  }
  return manifest;
}

function markFromStorage(value, extra = {}) {
  return Object.assign({}, value || {}, extra, { fromStorage: true });
}

function getManifestReleaseKey(manifest) {
  const normalized = normalizeManifest(manifest);
  if (!normalized) return "";
  return [
    normalized.term || DEFAULT_TERM,
    normalized.releaseVersion || "",
    normalized.cacheEpoch || "",
    normalized.forceRefreshToken || "",
  ].join(":");
}

function readCachedManifest(term) {
  const cached = readStorage(getManifestCacheKey(term || DEFAULT_TERM));
  const manifest = normalizeManifest(cached && (cached.manifest || cached));
  if (!manifest) return null;
  return markFromStorage(manifest, { savedAt: cached.savedAt || 0 });
}

function writeManifestCache(manifest) {
  const normalized = assertManifest(normalizeManifest(manifest));
  const entry = {
    savedAt: Date.now(),
    term: normalized.term,
    releaseVersion: normalized.releaseVersion,
    manifest: normalized,
  };
  writeStorage(getManifestCacheKey(normalized.term), entry);
  writeStorage(getLastGoodCacheKey(normalized.term), entry);
  writeStorage(LOCAL_ACTIVE_RELEASE_KEY, {
    savedAt: entry.savedAt,
    term: normalized.term,
    releaseVersion: normalized.releaseVersion,
    cacheEpoch: normalized.cacheEpoch,
    forceRefreshToken: normalized.forceRefreshToken,
    releaseKey: getManifestReleaseKey(normalized),
    manifest: normalized,
  });
  return normalized;
}

function scanLastGood() {
  return getStorageKeys()
    .filter((key) => key.startsWith(`${CACHE_PREFIX}:last-good:`))
    .map((key) => readStorage(key))
    .filter(Boolean)
    .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0))[0] || null;
}

function getLastKnownGood(term) {
  const cached = readStorage(getLastGoodCacheKey(term || DEFAULT_TERM)) || scanLastGood();
  if (!cached) return null;
  const manifest = normalizeManifest(cached.manifest || cached);
  if (!manifest) return null;
  return {
    savedAt: cached.savedAt || 0,
    term: manifest.term,
    releaseVersion: manifest.releaseVersion,
    cacheEpoch: manifest.cacheEpoch,
    forceRefreshToken: manifest.forceRefreshToken,
    releaseKey: getManifestReleaseKey(manifest),
    manifest,
  };
}

function getLocalActiveRelease(term) {
  const active = readStorage(LOCAL_ACTIVE_RELEASE_KEY);
  const manifest = normalizeManifest(active && active.manifest);
  if (manifest && (!term || manifest.term === term)) {
    return {
      savedAt: active.savedAt || 0,
      term: manifest.term,
      releaseVersion: manifest.releaseVersion,
      cacheEpoch: manifest.cacheEpoch,
      forceRefreshToken: manifest.forceRefreshToken,
      releaseKey: active.releaseKey || getManifestReleaseKey(manifest),
      manifest,
    };
  }
  return getLastKnownGood(term || DEFAULT_TERM);
}

function normalizeIndexPayload(type, payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false || !Array.isArray(source.items)) {
    const error = new Error("INVALID_RELEASE_PACK_INDEX");
    error.code = "INVALID_RELEASE_PACK_INDEX";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || fallback.term || DEFAULT_TERM;
  return Object.assign({}, source, {
    success: true,
    type,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    total: Number(source.total || source.items.length) || source.items.length,
    items: source.items,
  });
}

function readCachedIndex(type, options = {}) {
  const term = options.term || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion) return null;
  const cached = readStorage(getIndexCacheKey(term, releaseVersion, type));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > INDEX_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeIndexPayload(type, cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeIndexCache(type, payload) {
  const normalized = normalizeIndexPayload(type, payload);
  writeStorage(getIndexCacheKey(normalized.term, normalized.releaseVersion, type), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function fetchManifest(options = {}) {
  const query = {};
  if (options.releaseVersion || options.version) {
    query.releaseVersion = options.releaseVersion || options.version;
  }
  return request.get("/api/fosu/release-pack/manifest", query, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 8000,
    retries: options.retries === undefined ? 1 : options.retries,
  }).then((payload) => assertManifest(normalizeManifest(payload)));
}

function getActiveManifest(options = {}) {
  const cached = readCachedManifest(options.term || DEFAULT_TERM);
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (activeManifestInflight && options.dedupe !== false) {
    return activeManifestInflight;
  }
  activeManifestInflight = fetchManifest(options)
    .then((manifest) => writeManifestCache(manifest))
    .catch((error) => {
      const fallback = cached || (getLastKnownGood(options.term || DEFAULT_TERM) || {}).manifest;
      if (fallback) {
        return markFromStorage(fallback, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    })
    .finally(() => {
      activeManifestInflight = null;
    });
  return activeManifestInflight;
}

function resolveManifest(options = {}) {
  const normalized = normalizeManifest(options.manifest);
  if (normalized) return Promise.resolve(normalized);
  return getActiveManifest(options);
}

function loadIndex(type, params = {}, options = {}) {
  if (!INDEX_TYPES.includes(type)) {
    const error = new Error("INVALID_RELEASE_PACK_INDEX_TYPE");
    error.code = "INVALID_RELEASE_PACK_INDEX_TYPE";
    return Promise.reject(error);
  }
  const manifest = normalizeManifest(options.manifest || params.manifest);
  const term = params.term || params.semester || options.term || (manifest && manifest.term) || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || (manifest && manifest.releaseVersion) || "";
  const cached = readCachedIndex(type, { term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((nextManifest) => {
      return loadIndex(type, Object.assign({}, params, {
        term: nextManifest.term,
        releaseVersion: nextManifest.releaseVersion,
      }), Object.assign({}, options, { manifest: nextManifest }));
    });
  }

  return request.get(`/api/fosu/release-pack/index/${type}`, { term, releaseVersion }, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 25000,
    retries: options.retries === undefined ? 2 : options.retries,
  }).then((payload) => writeIndexCache(type, normalizeIndexPayload(type, payload, { term, releaseVersion })))
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      if (options.allowLastKnownGood !== false && !options.skipFallback) {
        const lastGood = getLastKnownGood(term);
        if (lastGood && lastGood.releaseVersion && lastGood.releaseVersion !== releaseVersion) {
          return loadIndex(type, {
            term: lastGood.term,
            releaseVersion: lastGood.releaseVersion,
          }, {
            allowLastKnownGood: false,
          }).then((payload) => markFromStorage(payload, {
            fallback: true,
            lastKnownGood: true,
            fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
          }));
        }
      }
      throw error;
    });
}

function warmupIndex(types, options = {}) {
  const list = Array.isArray(types) ? types : INDEX_TYPES;
  const manifest = normalizeManifest(options.manifest) || null;
  return Promise.all(list.map((type) => loadIndex(type, {
    term: options.term || (manifest && manifest.term) || DEFAULT_TERM,
    releaseVersion: options.releaseVersion || (manifest && manifest.releaseVersion) || "",
  }, Object.assign({}, options, {
    manifest,
    forceNetwork: Boolean(options.forceNetwork),
    skipFallback: Boolean(options.skipFallback),
  })))).then((indexes) => {
    indexes.forEach((item, index) => {
      if (!item || item.success === false || !Array.isArray(item.items)) {
        const error = new Error(`INVALID_RELEASE_PACK_INDEX:${list[index]}`);
        error.code = "INVALID_RELEASE_PACK_INDEX";
        throw error;
      }
    });
    return indexes;
  });
}

function switchReleaseSafely(options = {}) {
  if (switchReleaseInflight && options.dedupe !== false) {
    return switchReleaseInflight;
  }
  const previous = getLocalActiveRelease(options.term || DEFAULT_TERM) || getLastKnownGood(options.term || DEFAULT_TERM);
  switchReleaseInflight = fetchManifest(options)
    .then((manifest) => {
      const sameRelease = previous && previous.manifest &&
        getManifestReleaseKey(previous.manifest) === getManifestReleaseKey(manifest);
      return warmupIndex(INDEX_TYPES, {
        manifest,
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
        forceNetwork: Boolean(options.forceNetwork && !sameRelease),
        skipFallback: true,
      }).then((indexes) => {
        const normalized = writeManifestCache(manifest);
        clearOldReleaseCaches({
          keepLatestN: options.keepLatestN || 2,
          keepReleases: [normalized.releaseVersion, previous && previous.releaseVersion].filter(Boolean),
        });
        return {
          success: true,
          switched: true,
          term: normalized.term,
          releaseVersion: normalized.releaseVersion,
          manifest: normalized,
          indexes,
        };
      });
    })
    .catch((error) => {
      if (previous && previous.manifest) {
        return {
          success: true,
          switched: false,
          fallback: true,
          fromStorage: true,
          term: previous.term,
          releaseVersion: previous.releaseVersion,
          manifest: previous.manifest,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        };
      }
      throw error;
    })
    .finally(() => {
      switchReleaseInflight = null;
    });
  return switchReleaseInflight;
}

function toComparableText(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function matchesExact(item, expected, keys) {
  const value = String(expected || "").trim();
  if (!value) return true;
  return keys.some((key) => String(item[key] || "").trim() === value);
}

function filterIndexPayload(type, payload, params = {}) {
  const index = normalizeIndexPayload(type, payload);
  const q = toComparableText(params.q || params.keyword);
  const limit = Math.min(Math.max(parseInt(params.limit || "30", 10) || 30, 1), 100);
  const offset = Math.max(parseInt(params.offset || "0", 10) || 0, 0);
  const scoped = (index.items || []).filter((item) => {
    if (!matchesExact(item, params.semester || params.term, ["semester", "term"])) return false;
    if (!matchesExact(item, params.collegeCode, ["collegeCode"])) return false;
    if (!matchesExact(item, params.collegeName, ["collegeName", "college"])) return false;
    if (!matchesExact(item, params.grade, ["grade"])) return false;
    if (!matchesExact(item, params.majorCode, ["majorCode"])) return false;
    if (!matchesExact(item, params.majorName, ["majorName"])) return false;
    if (!matchesExact(item, params.campus, ["campus", "campusName"])) return false;
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

function readCachedSearchIndex(type, params = {}) {
  const term = params.term || params.semester || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || "";
  const cached = readCachedIndex(type, { term, releaseVersion });
  if (!cached) return null;
  return filterIndexPayload(type, cached, params);
}

function searchIndex(type, params = {}, options = {}) {
  return loadIndex(type, params, options)
    .then((payload) => filterIndexPayload(type, payload, params));
}

function normalizeDetailPayload(type, id, payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false) {
    const error = new Error("INVALID_RELEASE_PACK_DETAIL");
    error.code = "INVALID_RELEASE_PACK_DETAIL";
    throw error;
  }
  const schedule = source.detail || source.schedule ||
    (type === "class" && Array.isArray(source.classes) ? source.classes[0] : null) ||
    (type === "teacher" && Array.isArray(source.teachers) ? source.teachers[0] : null) ||
    (type === "classroom" && Array.isArray(source.classrooms) ? source.classrooms[0] : null) ||
    (type === "course" && Array.isArray(source.coursesList) ? source.coursesList[0] : null) ||
    null;
  if (!schedule) {
    const error = new Error("RELEASE_PACK_DETAIL_NOT_FOUND");
    error.code = "RELEASE_PACK_DETAIL_NOT_FOUND";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || schedule.term || schedule.semester || fallback.term || DEFAULT_TERM;
  return Object.assign({}, source, {
    success: true,
    type,
    id: source.id || id,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    detail: schedule,
    schedule,
  });
}

function readCachedDetail(type, id, options = {}) {
  const term = options.term || options.semester || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion || !id) return null;
  const cached = readStorage(getDetailCacheKey(term, releaseVersion, type, id));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > DETAIL_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeDetailPayload(type, id, cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeDetailCache(type, id, payload) {
  const normalized = normalizeDetailPayload(type, id, payload);
  writeStorage(getDetailCacheKey(normalized.term, normalized.releaseVersion, type, normalized.id || id), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function loadDetail(type, id, params = {}, options = {}) {
  const term = params.term || params.semester || options.term || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || "";
  const cached = readCachedDetail(type, id, { term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((manifest) => {
      return loadDetail(type, id, Object.assign({}, params, {
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
      }), options);
    });
  }
  return request.get(`/api/fosu/release-pack/detail/${type}/${encodeURIComponent(id)}`, { term, releaseVersion }, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 20000,
    retries: options.retries === undefined ? 2 : options.retries,
  }).then((payload) => writeDetailCache(type, id, normalizeDetailPayload(type, id, payload, { term, releaseVersion })))
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    });
}

function normalizeEmptyRoomIndex(payload, fallback = {}) {
  const source = payload && payload.data ? payload.data : payload;
  if (!source || source.success === false || !Array.isArray(source.rooms)) {
    const error = new Error("INVALID_RELEASE_PACK_EMPTY_ROOM");
    error.code = "INVALID_RELEASE_PACK_EMPTY_ROOM";
    throw error;
  }
  const releaseVersion = source.releaseVersion || source.version || fallback.releaseVersion || "";
  const term = source.term || source.semester || fallback.term || DEFAULT_TERM;
  return Object.assign({}, source, {
    success: true,
    term,
    semester: source.semester || term,
    releaseVersion,
    version: source.version || releaseVersion,
    buildings: Array.isArray(source.buildings) ? source.buildings : [],
    rooms: source.rooms,
  });
}

function readCachedEmptyRoom(options = {}) {
  const term = options.term || options.semester || DEFAULT_TERM;
  const releaseVersion = options.releaseVersion || options.version || "";
  if (!releaseVersion) return null;
  const cached = readStorage(getEmptyRoomCacheKey(term, releaseVersion));
  if (!cached || Date.now() - Number(cached.savedAt || 0) > EMPTY_ROOM_CACHE_TTL) return null;
  try {
    return markFromStorage(normalizeEmptyRoomIndex(cached.data || cached, { term, releaseVersion }));
  } catch (error) {
    return null;
  }
}

function writeEmptyRoomCache(payload) {
  const normalized = normalizeEmptyRoomIndex(payload);
  writeStorage(getEmptyRoomCacheKey(normalized.term, normalized.releaseVersion), {
    savedAt: Date.now(),
    data: normalized,
  });
  return normalized;
}

function loadEmptyRoom(params = {}, options = {}) {
  const term = params.term || params.semester || options.term || DEFAULT_TERM;
  const releaseVersion = params.releaseVersion || params.version || options.releaseVersion || "";
  const cached = readCachedEmptyRoom({ term, releaseVersion });
  if (cached && !options.forceNetwork) {
    return Promise.resolve(cached);
  }
  if (!releaseVersion) {
    return resolveManifest({ term, forceNetwork: options.forceNetwork }).then((manifest) => {
      return loadEmptyRoom(Object.assign({}, params, {
        term: manifest.term,
        releaseVersion: manifest.releaseVersion,
      }), options);
    });
  }
  return request.get("/api/fosu/release-pack/empty-room", { term, releaseVersion }, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 25000,
    retries: options.retries === undefined ? 2 : options.retries,
  }).then((payload) => writeEmptyRoomCache(normalizeEmptyRoomIndex(payload, { term, releaseVersion })))
    .catch((error) => {
      if (cached) {
        return markFromStorage(cached, {
          fallback: true,
          fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
        });
      }
      throw error;
    });
}

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
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
  if (!Number.isFinite(first)) return [];
  const low = Number.isFinite(last) ? Math.min(first, last) : first;
  const high = Number.isFinite(last) ? Math.max(first, last) : first;
  const values = [];
  for (let value = low; value <= high; value += 1) values.push(value);
  return uniqueNumbers(values, min, max);
}

function allSections() {
  return rangeNumbers(1, MAX_EMPTY_ROOM_SECTION, 1, MAX_EMPTY_ROOM_SECTION);
}

function normalizeQuerySections(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const rangeMatch = text.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  if (rangeMatch) {
    return rangeNumbers(rangeMatch[1], rangeMatch[2], 1, MAX_EMPTY_ROOM_SECTION);
  }
  return uniqueNumbers(text.split(/[,\s，、]+/), 1, MAX_EMPTY_ROOM_SECTION);
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
  if (min <= 1) return sections.length > 0;
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

function inferBuilding(roomName) {
  const name = String(roomName || "").trim();
  if (!name) return "未知";
  const known = ["会通楼", "致用楼"];
  const knownMatch = known.find((item) => name.includes(item));
  if (knownMatch) return knownMatch;
  const letterMatch = name.match(/^([A-Za-z]+\s*\d+)/);
  if (letterMatch) return letterMatch[1].replace(/\s+/g, "").toUpperCase();
  const prefixMatch = name.match(/^([^-\s]+)[-\s]/);
  if (prefixMatch && prefixMatch[1]) return prefixMatch[1];
  return "其他";
}

function formatSectionRange(sections) {
  const list = uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
  if (!list.length) return "";
  return list.length === 1 ? `第${list[0]}节` : `第${list[0]}-${list[list.length - 1]}节`;
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

function filterEmptyRoomIndex(indexPayload, params = {}) {
  const index = normalizeEmptyRoomIndex(indexPayload);
  const weekday = Number(params.weekday || 1);
  const week = Math.max(1, Math.min(MAX_EMPTY_ROOM_WEEK, Number(params.week || 1) || 1));
  const requestedSections = normalizeQuerySections(params.sections || params.section || "1-2");
  const building = String(params.building || "").trim();
  const minFreeSections = Math.max(1, Number(params.minFreeSections || 1) || 1);
  const excludeUnknown = params.excludeUnknown === true || params.excludeUnknown === "1" || params.excludeUnknown === "true";
  const commonOnly = params.commonOnly === true || params.commonOnly === "1" || params.commonOnly === "true";
  const normalizedBuilding = building && building !== "全部" ? building.toLowerCase() : "";
  const requestedSet = requestedSections.length ? requestedSections : allSections();
  const maxRequestedSection = requestedSet[requestedSet.length - 1] || 0;
  const rooms = (index.rooms || []).filter((room) => {
    if (excludeUnknown && (!room.roomName || room.roomName.includes("未知") || room.building === "未知")) return false;
    if (commonOnly && !/[A-Za-z]\d|楼/.test(room.roomName || "")) return false;
    if (normalizedBuilding) {
      const buildingText = String(room.building || "").toLowerCase();
      const roomText = String(room.roomName || "").toLowerCase();
      if (buildingText !== normalizedBuilding && !roomText.includes(normalizedBuilding)) return false;
    }
    return true;
  }).map((room) => {
    const occupiedCourses = (room.courses || [])
      .filter((course) => Number(course.weekday) === weekday)
      .filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(week) : true);
    const occupiedSections = uniqueNumbers(
      occupiedCourses.reduce((list, course) => list.concat(course.sections || []), []),
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

  return Object.assign({}, index, {
    query: {
      term: params.term || index.term || index.semester || "",
      releaseVersion: index.releaseVersion || index.version || "",
      date: params.date || "",
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
  });
}

function queryEmptyRooms(params = {}, options = {}) {
  return loadEmptyRoom(params, options).then((index) => filterEmptyRoomIndex(index, params));
}

function getVersionFromCacheKey(key) {
  const parts = String(key || "").split(":");
  if (parts[0] !== "fosu" || parts[1] !== "v5") return "";
  if (parts[2] === "index" || parts[2] === "detail" || parts[2] === "empty-room") {
    return decodeURIComponent(parts[4] || "");
  }
  return "";
}

function clearOldReleaseCaches(options = {}) {
  const keep = new Set(options.keepReleases || []);
  const keepLatestN = Math.max(1, Number(options.keepLatestN || 2) || 2);
  const versionStats = new Map();
  getStorageKeys().forEach((key) => {
    if (!key.startsWith(`${CACHE_PREFIX}:`)) return;
    const version = getVersionFromCacheKey(key);
    if (!version) return;
    const cached = readStorage(key) || {};
    const current = versionStats.get(version) || 0;
    versionStats.set(version, Math.max(current, Number(cached.savedAt || 0)));
  });
  const lastGood = getLastKnownGood(options.term || DEFAULT_TERM);
  if (lastGood && lastGood.releaseVersion) keep.add(lastGood.releaseVersion);
  Array.from(versionStats.entries())
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, keepLatestN)
    .forEach(([version]) => keep.add(version));

  let removed = 0;
  getStorageKeys().forEach((key) => {
    if (!key.startsWith(`${CACHE_PREFIX}:`)) return;
    const version = getVersionFromCacheKey(key);
    if (version && !keep.has(version)) {
      removeStorage(key);
      removed += 1;
    }
  });
  return { removed, keepReleases: Array.from(keep) };
}

module.exports = {
  CACHE_PREFIX,
  DEFAULT_TERM,
  LOCAL_ACTIVE_RELEASE_KEY,
  getManifestCacheKey,
  getIndexCacheKey,
  getDetailCacheKey,
  getEmptyRoomCacheKey,
  getLastGoodCacheKey,
  getManifestReleaseKey,
  getLocalActiveRelease,
  getActiveManifest,
  loadIndex,
  loadDetail,
  loadEmptyRoom,
  queryEmptyRooms,
  readCachedIndex,
  readCachedSearchIndex,
  readCachedDetail,
  readCachedEmptyRoom,
  searchIndex,
  warmupIndex,
  switchReleaseSafely,
  getLastKnownGood,
  clearOldReleaseCaches,
  filterIndexPayload,
  filterEmptyRoomIndex,
};
