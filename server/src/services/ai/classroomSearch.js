function normalizeFullWidth(value) {
  return String(value || "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, " ");
}

function normalizeHyphen(value) {
  return String(value || "").replace(/[－—–_]/g, "-");
}

function normalizeRoomText(value) {
  return normalizeHyphen(normalizeFullWidth(value))
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeText(value) {
  return normalizeFullWidth(value).trim().replace(/\s+/g, "").toLowerCase();
}

function stripBuildingSuffix(value) {
  return String(value || "")
    .replace(/教学楼|教室|课室|楼栋/g, "")
    .replace(/楼/g, "")
    .trim();
}

function parseClassroomQuery(value) {
  const raw = normalizeHyphen(normalizeFullWidth(value)).trim();
  const cleaned = stripBuildingSuffix(raw);
  const separated = cleaned.match(/^([A-Z])\s*(\d{1,2})\s*[-\s]\s*(\d{2,4})$/i);
  const compact = cleaned.replace(/\s+/g, "").toUpperCase();
  const exact = separated || compact.match(/^([A-Z])(\d{1,2})-(\d{2,4})$/);
  if (exact) {
    const buildingCode = `${exact[1].toUpperCase()}${Number(exact[2])}`;
    const roomNumber = exact[3];
    return {
      queryType: "exact-room",
      buildingCode,
      roomNumber,
      normalizedQuery: `${buildingCode}-${roomNumber}`,
    };
  }

  const building = compact.match(/^([A-Z])(\d{1,2})$/);
  if (building) {
    const buildingCode = `${building[1]}${Number(building[2])}`;
    return {
      queryType: "building",
      buildingCode,
      roomNumber: "",
      normalizedQuery: buildingCode,
    };
  }

  return {
    queryType: "text",
    buildingCode: "",
    roomNumber: "",
    normalizedQuery: normalizeText(raw),
  };
}

function getRoomName(item = {}) {
  return item.roomName || item.classroomName || item.name || item.displayName || item.title || "";
}

function getAliases(item = {}) {
  const aliases = item.aliases || item.alias || [];
  return Array.isArray(aliases) ? aliases : String(aliases || "").split(/[,，\s]+/);
}

function getBuildingCode(item = {}) {
  const direct = item.buildingCode || item.building || "";
  const directMatch = normalizeRoomText(stripBuildingSuffix(direct)).match(/^([A-Z])(\d{1,2})$/);
  if (directMatch) return `${directMatch[1]}${Number(directMatch[2])}`;
  const name = normalizeRoomText(stripBuildingSuffix(getRoomName(item)));
  const match = name.match(/^([A-Z])(\d{1,2})(?:-|\d{2,4})?/);
  return match ? `${match[1]}${Number(match[2])}` : "";
}

function getRoomNumber(item = {}) {
  const name = normalizeRoomText(getRoomName(item));
  const match = name.match(/^[A-Z]\d{1,2}-?(\d{2,4})/);
  return match ? match[1] : "";
}

function normalizedRoomName(item = {}) {
  const buildingCode = getBuildingCode(item);
  const roomNumber = getRoomNumber(item);
  if (buildingCode && roomNumber) return `${buildingCode}-${roomNumber}`;
  return normalizeRoomText(getRoomName(item));
}

function sameBuilding(item, buildingCode) {
  const code = getBuildingCode(item);
  if (code === buildingCode) return true;
  return normalizedRoomName(item).indexOf(`${buildingCode}-`) === 0;
}

function scoreTextSearch(item, query) {
  const q = normalizeText(query);
  if (!q) return 0;
  const name = normalizeText(getRoomName(item));
  const code = normalizeText(item.code || item.buildingCode || "");
  const aliases = getAliases(item).map(normalizeText).filter(Boolean);
  const description = normalizeText(item.description || item.desc || "");
  if (name === q) return 100;
  if (code && code === q) return 96;
  if (aliases.some((alias) => alias === q)) return 92;
  if (name.startsWith(q)) return 82;
  if (name.includes(q)) return 72;
  if (description.includes(q)) return 40;
  return 0;
}

function roomNumericValue(roomNumber) {
  const num = Number(String(roomNumber || "").replace(/\D/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function naturalRoomCompare(left = {}, right = {}) {
  const leftBuilding = getBuildingCode(left);
  const rightBuilding = getBuildingCode(right);
  const leftPrefix = (leftBuilding.match(/^([A-Z])/) || ["", ""])[1];
  const rightPrefix = (rightBuilding.match(/^([A-Z])/) || ["", ""])[1];
  if (leftPrefix !== rightPrefix) return leftPrefix.localeCompare(rightPrefix);
  const leftBuildingNum = Number((leftBuilding.match(/\d+/) || [0])[0]);
  const rightBuildingNum = Number((rightBuilding.match(/\d+/) || [0])[0]);
  if (leftBuildingNum !== rightBuildingNum) return leftBuildingNum - rightBuildingNum;
  return roomNumericValue(getRoomNumber(left)) - roomNumericValue(getRoomNumber(right));
}

function filterAndSortClassrooms(items, parsedQuery) {
  const parsed = parsedQuery && parsedQuery.queryType ? parsedQuery : parseClassroomQuery(parsedQuery);
  const source = Array.isArray(items) ? items : [];
  if (parsed.queryType === "building") {
    return source
      .filter((item) => sameBuilding(item, parsed.buildingCode))
      .sort(naturalRoomCompare);
  }
  if (parsed.queryType === "exact-room") {
    const exactName = parsed.normalizedQuery;
    const targetRoom = roomNumericValue(parsed.roomNumber);
    return source
      .filter((item) => sameBuilding(item, parsed.buildingCode))
      .map((item) => {
        const room = normalizedRoomName(item);
        const aliases = getAliases(item).map(normalizeRoomText);
        let score = 10;
        if (room === exactName) score = 100;
        else if (aliases.includes(exactName)) score = 90;
        else if (targetRoom && Math.abs(roomNumericValue(getRoomNumber(item)) - targetRoom) <= 2) score = 70;
        return { item, score };
      })
      .sort((left, right) => right.score - left.score || naturalRoomCompare(left.item, right.item))
      .map((entry) => entry.item);
  }
  return source
    .map((item) => ({ item, score: scoreTextSearch(item, parsed.normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || naturalRoomCompare(left.item, right.item))
    .map((entry) => entry.item);
}

module.exports = {
  filterAndSortClassrooms,
  getBuildingCode,
  naturalRoomCompare,
  normalizeRoomText,
  parseClassroomQuery,
};
