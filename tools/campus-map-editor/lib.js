const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const DATA_FILE = path.join(ROOT, "miniprogram/data/campusPlaces.js");
const SERVER_DATA_FILE = path.join(ROOT, "server/data/ai/campus-places.json");
const DRAFT_FILE = path.join(ROOT, ".local/campus-map-editor/draft.json");
const BACKUP_DIR = path.join(ROOT, ".local/campus-map-backups");

const VALID_COMBOS = new Set([
  "\u4ed9\u6eaa\u6821\u533a|\u5317\u533a",
  "\u4ed9\u6eaa\u6821\u533a|\u5357\u533a",
  "\u4ed9\u6eaa\u6821\u533a|\u5168\u533a",
  "\u6c5f\u6e7e\u6821\u533a|\u6c5f\u6e7e\u6821\u533a",
  "\u6cb3\u6ee8\u6821\u533a|\u6cb3\u6ee8\u6821\u533a",
  "\u6cb3\u6ee8\u6821\u533a|\u5317\u533a",
  "\u6cb3\u6ee8\u6821\u533a|\u5357\u533a",
]);

function ensureDir(fileOrDir, isDir = false) {
  const target = isDir ? fileOrDir : path.dirname(fileOrDir);
  fs.mkdirSync(target, { recursive: true });
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePlace(place = {}) {
  const verified = place.verified === true;
  return Object.assign({}, place, {
    aliases: normalizeAliases(place.aliases),
    reviewStatus: place.reviewStatus || (verified ? "verified" : "needs-review"),
    verified,
    updatedAt: place.updatedAt || "",
  });
}

function readCampusPlaces() {
  delete require.cache[require.resolve(DATA_FILE)];
  const data = require(DATA_FILE);
  return Object.assign({}, data, {
    places: Array.isArray(data.places) ? data.places.map(normalizePlace) : [],
  });
}

function writeCampusPlaces(data) {
  const normalized = Object.assign({}, data, {
    places: Array.isArray(data.places) ? data.places.map(normalizePlace) : [],
  });
  const content = `module.exports = ${JSON.stringify(normalized, null, 2)};\n`;
  fs.writeFileSync(DATA_FILE, content, "utf8");
  fs.writeFileSync(SERVER_DATA_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function readDraft() {
  if (!fs.existsSync(DRAFT_FILE)) return null;
  return JSON.parse(fs.readFileSync(DRAFT_FILE, "utf8"));
}

function saveDraft(data) {
  ensureDir(DRAFT_FILE);
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(data, null, 2), "utf8");
  return DRAFT_FILE;
}

function createBackup(data) {
  ensureDir(BACKUP_DIR, true);
  const file = path.join(BACKUP_DIR, `${timestamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(data || readCampusPlaces(), null, 2), "utf8");
  return file;
}

function normalizeRegion(region = {}) {
  return {
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
  };
}

function buildValidCombos() {
  const combos = new Set(VALID_COMBOS);
  try {
    readCampusPlaces().places.forEach((place) => {
      const campus = String(place && place.campus || "").trim();
      const area = String(place && place.area || "").trim();
      if (campus && area) combos.add(`${campus}|${area}`);
    });
  } catch (_error) {
    // Keep explicit combos when official data cannot be loaded.
  }
  return combos;
}

function validateCampusPlaces(data) {
  const errors = [];
  const ids = new Set();
  const places = Array.isArray(data && data.places) ? data.places : [];
  const validCombos = buildValidCombos();

  places.forEach((place, index) => {
    const label = place && (place.id || place.name) || `#${index + 1}`;
    const id = String(place && place.id || "").trim();
    if (!id) errors.push(`${label}: id is required`);
    if (ids.has(id)) errors.push(`${label}: duplicate id`);
    ids.add(id);

    const code = String(place && place.code || "").trim();
    if (code && !/^[A-Z][0-9]{1,2}(?:-[A-Z]?[0-9]{1,2})?$/.test(code)) {
      errors.push(`${label}: code should look like C7, B8, or D20-D23`);
    }

    const campus = String(place && place.campus || "").trim();
    const area = String(place && place.area || "").trim();
    if (!validCombos.has(`${campus}|${area}`)) {
      errors.push(`${label}: invalid campus/area combination`);
    }

    const region = normalizeRegion(place && place.mapRegion || {});
    ["x", "y", "width", "height"].forEach((key) => {
      if (!Number.isFinite(region[key])) errors.push(`${label}: mapRegion.${key} is not a number`);
    });
    if (Number.isFinite(region.x) && (region.x < 0 || region.x > 1)) errors.push(`${label}: x is outside 0-1`);
    if (Number.isFinite(region.y) && (region.y < 0 || region.y > 1)) errors.push(`${label}: y is outside 0-1`);
    if (Number.isFinite(region.width) && (region.width <= 0 || region.width > 1)) {
      errors.push(`${label}: width must be > 0 and <= 1`);
    }
    if (Number.isFinite(region.height) && (region.height <= 0 || region.height > 1)) {
      errors.push(`${label}: height must be > 0 and <= 1`);
    }
    if (Number.isFinite(region.x) && Number.isFinite(region.width) && region.x + region.width > 1.000001) {
      errors.push(`${label}: x + width exceeds map bounds`);
    }
    if (Number.isFinite(region.y) && Number.isFinite(region.height) && region.y + region.height > 1.000001) {
      errors.push(`${label}: y + height exceeds map bounds`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    verifiedCount: places.filter((item) => item && item.verified === true).length,
    needsReviewCount: places.filter((item) => !item || item.verified !== true).length,
  };
}

function applyToMiniprogram(data) {
  const validation = validateCampusPlaces(data);
  if (!validation.ok) {
    const error = new Error("VALIDATION_FAILED");
    error.validation = validation;
    throw error;
  }
  const backup = createBackup(readCampusPlaces());
  const written = writeCampusPlaces(data);
  return { backup, data: written, validation };
}

function regionFromPixels(rect, imageRect) {
  const safe = {
    left: Number(imageRect.left) || 0,
    top: Number(imageRect.top) || 0,
    width: Math.max(1, Number(imageRect.width) || 1),
    height: Math.max(1, Number(imageRect.height) || 1),
  };
  const x = (Number(rect.left) - safe.left) / safe.width;
  const y = (Number(rect.top) - safe.top) / safe.height;
  const width = Number(rect.width) / safe.width;
  const height = Number(rect.height) / safe.height;
  return {
    x: Math.max(0, Math.min(1, Number(x.toFixed(6)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(6)))),
    width: Math.max(0, Math.min(1, Number(width.toFixed(6)))),
    height: Math.max(0, Math.min(1, Number(height.toFixed(6)))),
  };
}

module.exports = {
  BACKUP_DIR,
  DATA_FILE,
  DRAFT_FILE,
  SERVER_DATA_FILE,
  applyToMiniprogram,
  createBackup,
  readCampusPlaces,
  readDraft,
  regionFromPixels,
  saveDraft,
  validateCampusPlaces,
};
