const request = require("../utils/request");
const fallbackData = require("../data/campusPlaces");

const CACHE_KEY = "FOSU_CAMPUS_MAP_PUBLISHED_CACHE";
const PACKAGE_MAPS = {
  jiangwan: {
    mapKey: "jiangwan",
    title: "江湾校区",
    packageUrl: "/assets/maps/campus-map-jiangwan.jpg",
  },
  xianxiNorth: {
    mapKey: "xianxiNorth",
    title: "仙溪校区北区",
    packageUrl: "/assets/maps/campus-map-xianxi-north.jpg",
  },
  xianxiSouth: {
    mapKey: "xianxiSouth",
    title: "仙溪校区南区",
    packageUrl: "/assets/maps/campus-map-xianxi-south.jpg",
  },
  hebin: {
    mapKey: "hebin",
    title: "河滨校区",
    packageUrl: "/assets/maps/campus-map-hebin.jpg",
  },
};

function normalizeMaps(maps) {
  const source = maps && typeof maps === "object" && !Array.isArray(maps) ? maps : {};
  const output = {};
  Object.keys(PACKAGE_MAPS).forEach((key) => {
    output[key] = Object.assign({}, PACKAGE_MAPS[key], source[key] || {});
    output[key].cdnUrl = output[key].cdnUrl || output[key].cloudbaseUrl || "";
    output[key].fallbackUrl = output[key].fallbackUrl || output[key].oracleUrl || "";
  });
  return output;
}

function normalizeData(data) {
  const source = data && data.data ? data.data : data;
  if (!source || !Array.isArray(source.places) || !source.places.length) {
    return Object.assign({}, fallbackData, { maps: normalizeMaps(fallbackData.maps) });
  }
  return {
    version: source.version || "",
    hash: source.hash || "",
    etag: source.etag || "",
    updatedAt: source.updatedAt || "",
    note: source.note || fallbackData.note,
    maps: normalizeMaps(source.maps),
    places: source.places,
  };
}

function readCache() {
  try {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (cached && Array.isArray(cached.places) && cached.places.length) return cached;
  } catch (error) {
    // Cache is best-effort.
  }
  return null;
}

function writeCache(data) {
  try {
    wx.setStorageSync(CACHE_KEY, data);
  } catch (error) {
    // Cache is best-effort.
  }
}

function getFallbackData() {
  const cached = readCache();
  if (cached) return cached;
  return Object.assign({}, fallbackData, {
    maps: normalizeMaps(fallbackData.maps),
  });
}

function loadPublishedMapData() {
  const cached = readCache();
  const header = cached && cached.etag ? { "If-None-Match": cached.etag } : {};
  return request.get("/api/ai/campus-map/published", {}, {
    header,
    showLoading: false,
    silentError: true,
    timeout: 8000,
    retries: 1,
  }).then((payload) => {
    const data = normalizeData(payload);
    writeCache(data);
    return data;
  }).catch((error) => {
    if (cached && (error && (error.statusCode === 304 || error.code === "NETWORK"))) return cached;
    return getFallbackData();
  });
}

module.exports = {
  PACKAGE_MAPS,
  getFallbackData,
  loadPublishedMapData,
  normalizeData,
  normalizeMaps,
};
