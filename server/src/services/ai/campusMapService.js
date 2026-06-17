const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../../../data/ai/campus-places.json");
const SOURCE_ID = "campus-map:v2";
const ROUTE_LIMIT_TEXT = "目前可帮助定位校区和区域，暂不提供精确步行路线。";

const FALLBACK_PLACES = [
  {
    id: "campus-xianxi",
    campus: "仙溪校区",
    area: "全区",
    name: "仙溪校区",
    code: "",
    type: "campus",
    aliases: ["仙溪", "仙溪北区", "仙溪南区"],
    description: "仙溪校区包含北区和南区。",
    mapRegion: { x: 0.34, y: 0.18, width: 0.64, height: 0.78 },
    confidence: 0.9,
    verified: true,
    neighbors: [],
  },
  {
    id: "campus-jiangwan",
    campus: "江湾校区",
    area: "江湾校区",
    name: "江湾校区",
    code: "",
    type: "campus",
    aliases: ["江湾"],
    description: "江湾校区校园位置参考。",
    mapRegion: { x: 0.02, y: 0.08, width: 0.96, height: 0.88 },
    confidence: 0.9,
    verified: true,
    neighbors: [],
  },
  {
    id: "campus-hebin",
    campus: "河滨校区",
    area: "河滨校区",
    name: "河滨校区",
    code: "",
    type: "campus",
    aliases: ["河滨"],
    description: "河滨校区校园位置参考。",
    mapRegion: { x: 0.02, y: 0.08, width: 0.96, height: 0.88 },
    confidence: 0.9,
    verified: true,
    neighbors: [],
  },
  {
    id: "xianxi-c7-medical-teaching",
    campus: "仙溪校区",
    area: "南区",
    name: "C7 医学教学楼",
    code: "C7",
    type: "teaching_building",
    aliases: ["C7", "C7楼", "C7教学楼"],
    description: "仙溪南区 C7 医学教学楼。",
    mapRegion: { x: 0.78, y: 0.43, width: 0.16, height: 0.19 },
    confidence: 0.9,
    verified: true,
    neighbors: [],
  },
  {
    id: "xianxi-b8-building",
    campus: "仙溪校区",
    area: "南区",
    name: "B8 教学楼",
    code: "B8",
    type: "teaching_building",
    aliases: ["B8", "B8楼", "B8教学楼"],
    description: "仙溪南区 B8 教学楼。",
    mapRegion: { x: 0.78, y: 0.65, width: 0.13, height: 0.12 },
    confidence: 0.9,
    verified: true,
    neighbors: [],
  },
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function loadPlaces() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
      if (Array.isArray(parsed.places) && parsed.places.length) return parsed.places;
    }
  } catch (error) {
    return FALLBACK_PLACES;
  }
  return FALLBACK_PLACES;
}

function getMapKey(place = {}) {
  if (place.campus === "河滨校区") return "hebin";
  if (place.campus === "仙溪校区") return place.area === "南区" ? "xianxiSouth" : "xianxiNorth";
  return "jiangwan";
}

function buildMapActionUrl(place = {}) {
  const params = new URLSearchParams();
  params.set("map", getMapKey(place));
  if (place.id) params.set("placeId", place.id);
  if (place.name) params.set("q", place.code || place.name);
  return `/pages/campus-map/campus-map?${params.toString()}`;
}

function scorePlace(place, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const aliases = Array.isArray(place.aliases) ? place.aliases : [];
  const exactValues = [place.id, place.name, place.code].concat(aliases).map(normalizeText).filter(Boolean);
  const searchable = [
    place.id,
    place.campus,
    place.area,
    place.name,
    place.code,
    place.type,
    place.description,
  ].concat(aliases).map(normalizeText).filter(Boolean);
  if (exactValues.some((item) => item === q)) return 120;
  if (searchable.some((item) => item === q)) return 100;
  if (searchable.some((item) => item.includes(q))) return 78;
  if (searchable.some((item) => q.includes(item) && item.length >= 2)) return 56;
  const campus = normalizeText(place.campus);
  const area = normalizeText(place.area);
  let score = 0;
  if (campus && q.includes(campus)) score += 34;
  if (area && q.includes(area)) score += 22;
  if (place.type === "campus" && /校区|校园|主要地点/.test(query)) score += 12;
  if (score > 0 && /(图书馆|饭堂|食堂|宿舍|体育馆|校门|医院|教学楼|楼|地点|哪里|在哪)/.test(query)) score += 18;
  return score;
}

function sanitizeRegion(region) {
  if (!region || typeof region !== "object" || Array.isArray(region)) return null;
  return {
    x: Math.max(0, Math.min(1, safeNumber(region.x))),
    y: Math.max(0, Math.min(1, safeNumber(region.y))),
    width: Math.max(0, Math.min(1, safeNumber(region.width))),
    height: Math.max(0, Math.min(1, safeNumber(region.height))),
  };
}

function sanitizePlace(place = {}) {
  const mapKey = getMapKey(place);
  const verified = place.verified === true;
  const reviewStatus = place.reviewStatus || (verified ? "verified" : "needs-review");
  return {
    id: String(place.id || "").slice(0, 80),
    campus: String(place.campus || "").slice(0, 40),
    area: String(place.area || "").slice(0, 40),
    name: String(place.name || "").slice(0, 80),
    code: String(place.code || "").slice(0, 24),
    type: String(place.type || "place").slice(0, 40),
    aliases: Array.isArray(place.aliases) ? place.aliases.slice(0, 8).map((item) => String(item).slice(0, 40)) : [],
    description: String(place.description || "").slice(0, 240),
    mapKey,
    mapRegion: verified ? sanitizeRegion(place.mapRegion) : null,
    confidence: Math.max(0, Math.min(1, safeNumber(place.confidence))),
    verified,
    reviewStatus,
    sourceId: place.sourceId || "campus-q-map-2026",
    updatedAt: place.updatedAt || "2026-06-17",
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 8) : [],
    actionUrl: buildMapActionUrl(place),
  };
}

function searchCampusPlace(input = {}) {
  const query = input.q || input.place || input.message || input.campus || "";
  const limit = Math.max(1, Math.min(20, Number(input.limit || 8) || 8));
  const places = loadPlaces()
    .map((place) => ({ place, score: scorePlace(place, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.place.name).localeCompare(String(right.place.name)))
    .slice(0, limit)
    .map((item) => sanitizePlace(item.place));
  return {
    success: true,
    q: String(query || "").slice(0, 80),
    sourceId: SOURCE_ID,
    updatedAt: "2026-06-17",
    items: places,
    total: places.length,
    ambiguous: places.length > 1,
    summary: places.length
      ? `找到 ${places.length} 个校园地点候选。Q 版地图仅供位置参考，具体以学校现场指引为准。`
      : "没有找到已维护的校园地点。",
  };
}

function findByIdOrQuery(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const places = loadPlaces();
  const direct = places.find((place) => place.id === text || normalizeText(place.code) === normalizeText(text));
  if (direct) return direct;
  const result = searchCampusPlace({ q: text, limit: 1 });
  return result.items[0] || null;
}

function getCampusRoute(input = {}) {
  const from = findByIdOrQuery(input.from || input.fromPlace || "");
  const to = findByIdOrQuery(input.to || input.toPlace || input.place || input.message || "");
  if (!to && !from) {
    return {
      success: false,
      code: "PLACE_NOT_FOUND",
      sourceId: SOURCE_ID,
      summary: "没有找到起点或终点。请先输入校区、楼栋代码或地点名。",
      candidates: searchCampusPlace({ q: input.to || input.message || "" }).items,
    };
  }
  return {
    success: false,
    code: "ROUTE_DATA_INCOMPLETE",
    sourceId: SOURCE_ID,
    from: from ? sanitizePlace(from) : null,
    to: to ? sanitizePlace(to) : null,
    summary: ROUTE_LIMIT_TEXT,
  };
}

function extractBuildingCode(room) {
  const text = String(room || "").trim();
  const match = text.match(/\b([A-Z]\d{1,2})(?:[-\s]?\d{0,4})?/i);
  return match ? match[1].toUpperCase() : text;
}

function getClassroomLocation(input = {}) {
  const room = String(input.classroom || input.roomName || input.message || "").trim();
  const building = extractBuildingCode(room);
  const result = searchCampusPlace({ q: building, limit: 5 });
  const first = result.items[0];
  return Object.assign({}, result, {
    classroom: room,
    building,
    routeAvailable: false,
    summary: first
      ? `${room || building} 可先查看${first.campus}${first.area && first.area !== "全区" ? first.area : ""}地图中的 ${first.name}。${ROUTE_LIMIT_TEXT}`
      : "没有找到该教室对应的楼栋位置。",
  });
}

function getMapStatus() {
  const places = loadPlaces().map(sanitizePlace);
  return {
    sourceId: SOURCE_ID,
    updatedAt: "2026-06-17",
    placeCount: places.length,
    verifiedCount: places.filter((item) => item.verified).length,
    needsAdminData: places.some((item) => !item.verified),
  };
}

module.exports = {
  DATA_PATH,
  ROUTE_LIMIT_TEXT,
  getCampusRoute,
  getClassroomLocation,
  getMapStatus,
  loadPlaces,
  searchCampusPlace,
};
