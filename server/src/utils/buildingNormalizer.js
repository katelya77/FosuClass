const UNKNOWN_BUILDING_CODE = "UNKNOWN";
const UNKNOWN_BUILDING_NAME = "其他/未识别";

const KNOWN_BUILDINGS = [
  { pattern: /会通楼/, code: "会通楼", name: "会通楼", campus: "仙溪校区", confidence: 0.98 },
  { pattern: /致用楼/, code: "致用楼", name: "致用楼", campus: "仙溪校区", confidence: 0.98 },
];

function normalizeText(value) {
  return String(value || "")
    .replace(/[（）]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeCampus(text, code) {
  if (/江湾/.test(text)) return "江湾校区";
  if (/仙溪/.test(text)) return "仙溪校区";
  if (/^[A-H]\d{1,2}$/i.test(code || "")) return "仙溪校区";
  return "";
}

function normalizeBuilding(roomName) {
  const raw = String(roomName || "").trim();
  const text = normalizeText(raw);
  if (!text) {
    return {
      buildingCode: UNKNOWN_BUILDING_CODE,
      buildingName: UNKNOWN_BUILDING_NAME,
      roomName: raw,
      campus: "",
      confidence: 0,
      unknown: true,
    };
  }

  const known = KNOWN_BUILDINGS.find((item) => item.pattern.test(text));
  if (known) {
    return {
      buildingCode: known.code,
      buildingName: known.name,
      roomName: raw,
      campus: known.campus,
      confidence: known.confidence,
      unknown: false,
    };
  }

  const letterMatch = text.match(/(?:^|校区|区)([A-Ha-h])[-_ ]?(\d{1,2})(?=[-楼栋号室\d]|$)/) ||
    text.match(/^([A-Ha-h])[-_ ]?(\d{1,2})(?=[-楼栋号室\d]|$)/);
  if (letterMatch) {
    const code = `${letterMatch[1].toUpperCase()}${letterMatch[2]}`;
    return {
      buildingCode: code,
      buildingName: code,
      roomName: raw,
      campus: normalizeCampus(text, code),
      confidence: 0.94,
      unknown: false,
    };
  }

  const chineseBuildingMatch = text.match(/([\u4e00-\u9fa5]{2,12}楼)(?=\d|[-_ ]|$)/);
  if (chineseBuildingMatch) {
    const code = chineseBuildingMatch[1];
    return {
      buildingCode: code,
      buildingName: code,
      roomName: raw,
      campus: normalizeCampus(text, code),
      confidence: 0.9,
      unknown: false,
    };
  }

  const prefixMatch = text.match(/^([^-\s_]{1,12})[-_ ]/);
  if (prefixMatch && !/^\d+$/.test(prefixMatch[1])) {
    return {
      buildingCode: prefixMatch[1],
      buildingName: prefixMatch[1],
      roomName: raw,
      campus: normalizeCampus(text, prefixMatch[1]),
      confidence: 0.55,
      unknown: false,
    };
  }

  return {
    buildingCode: UNKNOWN_BUILDING_CODE,
    buildingName: UNKNOWN_BUILDING_NAME,
    roomName: raw,
    campus: normalizeCampus(text, ""),
    confidence: 0.2,
    unknown: true,
  };
}

function isUnknownBuilding(normalized) {
  return Boolean(!normalized || normalized.unknown || normalized.buildingCode === UNKNOWN_BUILDING_CODE);
}

module.exports = {
  UNKNOWN_BUILDING_CODE,
  UNKNOWN_BUILDING_NAME,
  normalizeBuilding,
  isUnknownBuilding,
};
