const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../../../data/ai/campus-places.json");

const FALLBACK_PLACES = [
  {
    id: "campus-xiangxi",
    campus: "仙溪校区",
    name: "仙溪校区",
    type: "campus",
    aliases: ["仙溪", "仙溪校区"],
    description: "佛山大学仙溪校区。具体楼栋路线以管理员维护的地图数据为准。",
    verified: true,
    lat: 23.0336,
    lng: 113.1222,
    neighbors: [],
  },
  {
    id: "campus-jiangwan",
    campus: "江湾校区",
    name: "江湾校区",
    type: "campus",
    aliases: ["江湾", "江湾校区"],
    description: "佛山大学江湾校区。具体楼栋路线以管理员维护的地图数据为准。",
    verified: true,
    lat: 23.0382,
    lng: 113.1115,
    neighbors: [],
  },
  {
    id: "building-c7",
    campus: "仙溪校区",
    name: "C7",
    type: "teaching_building",
    aliases: ["C7", "c7", "C7楼", "C7教学楼"],
    description: "常用教学楼别名，需后台补充精确楼栋坐标和相邻路径。",
    verified: false,
    neighbors: [],
  },
  {
    id: "building-b8",
    campus: "仙溪校区",
    name: "B8",
    type: "teaching_building",
    aliases: ["B8", "b8", "B8楼", "B8教学楼"],
    description: "常用教学楼别名，需后台补充精确楼栋坐标和相邻路径。",
    verified: false,
    neighbors: [],
  },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function loadPlaces() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
      if (Array.isArray(parsed.places)) return parsed.places;
    }
  } catch (error) {
    return FALLBACK_PLACES;
  }
  return FALLBACK_PLACES;
}

function scorePlace(place, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const names = [place.name, place.id].concat(place.aliases || []).map(normalizeText);
  if (names.some((item) => item === q)) return 100;
  if (names.some((item) => item.includes(q))) return 70;
  if (q.length >= 2 && names.some((item) => q.includes(item))) return 50;
  return 0;
}

function sanitizePlace(place) {
  return {
    id: String(place.id || "").slice(0, 80),
    campus: String(place.campus || "").slice(0, 40),
    name: String(place.name || "").slice(0, 80),
    type: String(place.type || "place").slice(0, 40),
    aliases: Array.isArray(place.aliases) ? place.aliases.slice(0, 8) : [],
    description: String(place.description || "").slice(0, 240),
    verified: place.verified === true,
    lat: Number(place.lat) || null,
    lng: Number(place.lng) || null,
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 8) : [],
  };
}

function searchCampusPlace(input = {}) {
  const query = input.q || input.place || input.message || "";
  const places = loadPlaces()
    .map((place) => ({ place, score: scorePlace(place, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.place.name).localeCompare(String(right.place.name)))
    .slice(0, Number(input.limit || 8) || 8)
    .map((item) => sanitizePlace(item.place));
  return {
    success: true,
    q: String(query || "").slice(0, 80),
    sourceId: "campus-map:v1",
    updatedAt: "2026-06-16",
    items: places,
    total: places.length,
    ambiguous: places.length > 1,
    summary: places.length ? `找到 ${places.length} 个校园地点候选。` : "没有找到已维护的校园地点。",
  };
}

function findByIdOrQuery(value) {
  const text = String(value || "").trim();
  const places = loadPlaces();
  return places.find((place) => place.id === text) ||
    searchCampusPlace({ q: text, limit: 1 }).items[0] ||
    null;
}

function getCampusRoute(input = {}) {
  const from = findByIdOrQuery(input.from || input.fromPlace || "");
  const to = findByIdOrQuery(input.to || input.toPlace || input.place || input.message || "");
  if (!from || !to) {
    return {
      success: false,
      code: "PLACE_NOT_FOUND",
      sourceId: "campus-map:v1",
      summary: "没有找到起点或终点，请先选择地点。",
      candidates: searchCampusPlace({ q: input.to || input.message || "" }).items,
    };
  }
  const safeFrom = sanitizePlace(from);
  const safeTo = sanitizePlace(to);
  if (!safeFrom.verified || !safeTo.verified || !safeFrom.lat || !safeTo.lat) {
    return {
      success: false,
      code: "ROUTE_DATA_INCOMPLETE",
      sourceId: "campus-map:v1",
      from: safeFrom,
      to: safeTo,
      summary: "该地点还没有完整的后台地图坐标，不能生成路线。",
    };
  }
  return {
    success: true,
    sourceId: "campus-map:v1",
    from: safeFrom,
    to: safeTo,
    steps: [
      `从${safeFrom.name}出发。`,
      `前往${safeTo.name}，实际路线以校园道路和现场指引为准。`,
    ],
    summary: `已生成从${safeFrom.name}到${safeTo.name}的简要路线。`,
    actionUrl: `/pages/school/school?type=classroom&q=${encodeURIComponent(safeTo.name)}`,
  };
}

function getClassroomLocation(input = {}) {
  const room = String(input.classroom || input.roomName || input.message || "").trim();
  const building = (room.match(/[ABC]\d{1,2}/i) || [room])[0];
  const result = searchCampusPlace({ q: building, limit: 5 });
  return Object.assign({}, result, {
    classroom: room,
    summary: result.items.length
      ? `${room || building} 可能位于 ${result.items[0].name}，请以后台维护地图和课表详情为准。`
      : "没有找到该教室对应的楼栋位置。",
  });
}

function getMapStatus() {
  const places = loadPlaces().map(sanitizePlace);
  return {
    sourceId: "campus-map:v1",
    updatedAt: "2026-06-16",
    placeCount: places.length,
    verifiedCount: places.filter((item) => item.verified).length,
    needsAdminData: places.some((item) => !item.verified),
  };
}

module.exports = {
  DATA_PATH,
  getCampusRoute,
  getClassroomLocation,
  getMapStatus,
  loadPlaces,
  searchCampusPlace,
};
