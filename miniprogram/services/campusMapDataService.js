const request = require("../utils/request");
const fallbackData = require("../data/campusPlaces");

const CACHE_KEY = "FOSU_CAMPUS_MAP_PUBLISHED_CACHE";

function normalizeData(data) {
  const source = data && data.data ? data.data : data;
  if (!source || !Array.isArray(source.places) || !source.places.length) return fallbackData;
  return {
    version: source.version || "",
    updatedAt: source.updatedAt || "",
    note: source.note || fallbackData.note,
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
  return readCache() || fallbackData;
}

function loadPublishedMapData() {
  return request.get("/api/ai/campus-map/published", {}, {
    showLoading: false,
    silentError: true,
    timeout: 8000,
    retries: 1,
  }).then((payload) => {
    const data = normalizeData(payload);
    writeCache(data);
    return data;
  }).catch(() => getFallbackData());
}

module.exports = {
  getFallbackData,
  loadPublishedMapData,
  normalizeData,
};
