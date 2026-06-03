const request = require("../utils/request");
const { SCHOOL_CACHE_SCHEMA_VERSION } = require("../utils/storage");
const { courseTimes } = require("../data/courseTimes");

const EMPTY_ROOM_CACHE_TTL = 30 * 60 * 1000;
const EMPTY_ROOM_FAVORITES_KEY = "FOSU_EMPTY_ROOM_FAVORITES";
const DEFAULT_BUILDINGS = ["全部", "C7", "B8", "会通楼", "致用楼"];

function stableParamHash(params = {}) {
  const normalized = {};
  Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .forEach((key) => {
      normalized[key] = String(params[key]);
    });
  const text = JSON.stringify(normalized);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getEmptyRoomCacheKey(params = {}) {
  const term = encodeURIComponent(String(params.term || "unknown"));
  const releaseVersion = encodeURIComponent(String(params.releaseVersion || params.version || "active"));
  return `school:v${SCHOOL_CACHE_SCHEMA_VERSION}:empty-room:${term}:${releaseVersion}:${stableParamHash(params)}`;
}

function readEmptyRoomCache(params = {}) {
  try {
    const cached = wx.getStorageSync(getEmptyRoomCacheKey(params));
    if (!cached || Date.now() - Number(cached.savedAt || 0) > EMPTY_ROOM_CACHE_TTL) {
      return null;
    }
    return cached.data || null;
  } catch (error) {
    return null;
  }
}

function writeEmptyRoomCache(params = {}, data) {
  if (!data || data.success === false) return;
  try {
    wx.setStorageSync(getEmptyRoomCacheKey(params), {
      savedAt: Date.now(),
      data,
    });
  } catch (error) {
    // 缓存失败不影响在线查询。
  }
}

function minutesOf(timeText) {
  const parts = String(timeText || "").split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function minutesFromDate(date) {
  const target = date || new Date();
  return target.getHours() * 60 + target.getMinutes();
}

function getCurrentSectionNumber(date) {
  const current = minutesFromDate(date);
  const matched = courseTimes.find((item) => current >= minutesOf(item.start) && current <= minutesOf(item.end));
  if (matched) return Number(matched.section);
  const next = courseTimes.find((item) => current < minutesOf(item.start));
  return next ? Number(next.section) : Number(courseTimes[courseTimes.length - 1].section);
}

function getCurrentSectionValue(date) {
  const section = getCurrentSectionNumber(date);
  return `${section}-${section}`;
}

function getNextSectionValue(date) {
  const current = getCurrentSectionNumber(date);
  const next = Math.min(current + 1, Number(courseTimes[courseTimes.length - 1].section));
  return `${next}-${next}`;
}

function getPresetSectionValue(key, date) {
  switch (key) {
    case "current": return getCurrentSectionValue(date);
    case "next": return getNextSectionValue(date);
    case "morning": return "1-5";
    case "afternoon": return "6-10";
    case "evening": return "11-14";
    default: return "3-4";
  }
}

function normalizeFavorites(value) {
  const source = value && typeof value === "object" ? value : {};
  const buildings = Array.isArray(source.buildings) ? source.buildings : [];
  const rooms = Array.isArray(source.rooms) ? source.rooms : [];
  const uniqueBuildings = Array.from(new Set(buildings.map((item) => String(item || "").trim()).filter(Boolean)));
  const seenRooms = new Set();
  const uniqueRooms = rooms
    .map((item) => {
      if (typeof item === "string") {
        return { roomName: item, building: "" };
      }
      return {
        roomName: String((item && item.roomName) || "").trim(),
        building: String((item && item.building) || "").trim(),
      };
    })
    .filter((item) => {
      if (!item.roomName || seenRooms.has(item.roomName)) return false;
      seenRooms.add(item.roomName);
      return true;
    });
  return {
    buildings: uniqueBuildings,
    rooms: uniqueRooms,
  };
}

function readEmptyRoomFavorites() {
  try {
    return normalizeFavorites(wx.getStorageSync(EMPTY_ROOM_FAVORITES_KEY));
  } catch (error) {
    return { buildings: [], rooms: [] };
  }
}

function writeEmptyRoomFavorites(favorites) {
  const normalized = normalizeFavorites(favorites);
  try {
    wx.setStorageSync(EMPTY_ROOM_FAVORITES_KEY, normalized);
  } catch (error) {
    // Favorite state is local convenience only; ignore storage failures.
  }
  return normalized;
}

function setFavoriteBuilding(building, enabled) {
  const text = String(building || "").trim();
  const current = readEmptyRoomFavorites();
  if (!text || text === "全部") {
    return current;
  }
  const buildings = enabled
    ? Array.from(new Set(current.buildings.concat(text)))
    : current.buildings.filter((item) => item !== text);
  return writeEmptyRoomFavorites(Object.assign({}, current, { buildings }));
}

function setFavoriteRoom(roomName, enabled, meta = {}) {
  const text = String(roomName || "").trim();
  const current = readEmptyRoomFavorites();
  if (!text) {
    return current;
  }
  const rooms = current.rooms.filter((item) => item.roomName !== text);
  if (enabled) {
    rooms.unshift({
      roomName: text,
      building: String(meta.building || "").trim(),
    });
  }
  return writeEmptyRoomFavorites(Object.assign({}, current, { rooms }));
}

function isFavoriteBuilding(building, favorites) {
  const text = String(building || "").trim();
  const source = favorites || readEmptyRoomFavorites();
  return Boolean(text && source.buildings.includes(text));
}

function isFavoriteRoom(roomName, favorites) {
  const text = String(roomName || "").trim();
  const source = favorites || readEmptyRoomFavorites();
  return Boolean(text && source.rooms.some((item) => item.roomName === text));
}

function buildBuildingOptions(apiBuildings, favoriteBuildings) {
  const seen = new Set();
  return DEFAULT_BUILDINGS.concat(favoriteBuildings || [], apiBuildings || [])
    .filter((item) => {
      const text = String(item || "").trim();
      if (!text || seen.has(text)) return false;
      seen.add(text);
      return true;
    });
}

function queryEmptyRooms(params = {}, options = {}) {
  const query = Object.assign({}, params);
  const cached = readEmptyRoomCache(query);
  if (cached && !options.forceNetwork) {
    return Promise.resolve(Object.assign({}, cached, { fromStorage: true }));
  }

  return request.get("/api/fosu/empty-classrooms", query, {
    showLoading: false,
    silentError: true,
    timeout: options.timeout || 30000,
  }).then((data) => {
    writeEmptyRoomCache(query, data);
    return data;
  }).catch((error) => {
    if (cached) {
      return Object.assign({}, cached, {
        fromStorage: true,
        fallback: true,
        fallbackReason: error && (error.code || error.reasonCode || error.errMsg || error.message || "networkError"),
      });
    }
    throw error;
  });
}

module.exports = {
  DEFAULT_BUILDINGS,
  EMPTY_ROOM_CACHE_TTL,
  EMPTY_ROOM_FAVORITES_KEY,
  buildBuildingOptions,
  getCurrentSectionNumber,
  getCurrentSectionValue,
  getEmptyRoomCacheKey,
  getNextSectionValue,
  getPresetSectionValue,
  isFavoriteBuilding,
  isFavoriteRoom,
  queryEmptyRooms,
  readEmptyRoomCache,
  readEmptyRoomFavorites,
  setFavoriteBuilding,
  setFavoriteRoom,
  writeEmptyRoomCache,
  writeEmptyRoomFavorites,
};
