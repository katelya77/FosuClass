const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const campusMapAssetService = require("../campusMapAssetService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const STORE_DIR = path.join(STORAGE_DIR, "campus-map");
const HISTORY_DIR = path.join(STORE_DIR, "history");
const BACKUP_DIR = path.join(STORE_DIR, "backups");
const DRAFT_PATH = path.join(STORE_DIR, "draft.json");
const PUBLISHED_PATH = path.join(STORE_DIR, "published.json");
const PUBLIC_CONFIG_PATH = path.join(STORE_DIR, "public", "config.json");
const DATA_DIR = path.resolve(__dirname, "../../../data/ai");
const LEGACY_DATA_PATH = path.join(DATA_DIR, "campus-places.json");
const DEFAULT_NOTE = "Q 版地图仅供校园位置参考，具体以学校现场指引为准。";

function nowIso() {
  return new Date().toISOString();
}

function timestampId(prefix) {
  return `${prefix}-${nowIso().replace(/[:.]/g, "-")}`;
}

function ensureDirs() {
  [STORE_DIR, HISTORY_DIR, BACKUP_DIR, path.dirname(PUBLIC_CONFIG_PATH), DATA_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDirs();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function defaultMapAssets() {
  campusMapAssetService.ensureInitialized();
  return campusMapAssetService.getMapDefinitions().reduce((acc, definition) => {
    acc[definition.mapKey] = campusMapAssetService.getLatestAssetIdForMap(definition.mapKey);
    return acc;
  }, {});
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractMapAssets(source = {}) {
  const input = isPlainObject(source) ? source : {};
  const candidates = [input.mapAssets, input.assets, input.maps].filter(isPlainObject);
  for (const candidate of candidates) {
    const output = {};
    let found = false;
    campusMapAssetService.getMapDefinitions().forEach((definition) => {
      const value = candidate[definition.mapKey];
      if (typeof value === "string") {
        output[definition.mapKey] = value;
        found = true;
      } else if (isPlainObject(value)) {
        const assetId = value.assetId ||
          value.currentAssetId ||
          value.draftAssetId ||
          value.current && value.current.assetId ||
          value.public && value.public.assetId;
        if (assetId) {
          output[definition.mapKey] = String(assetId);
          found = true;
        }
      }
    });
    if (found) return output;
  }
  return {};
}

function normalizeMapAssets(source = {}) {
  const input = isPlainObject(source) ? source : {};
  const fallback = defaultMapAssets();
  const output = {};
  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    output[definition.mapKey] = String(input[definition.mapKey] || fallback[definition.mapKey] || "");
  });
  return output;
}

function normalizeRegion(region) {
  const source = isPlainObject(region) ? region : {};
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const x = clamp(source.x);
  const y = clamp(source.y);
  const width = Math.max(0, Math.min(1 - x, clamp(source.width)));
  const height = Math.max(0, Math.min(1 - y, clamp(source.height)));
  return { x, y, width, height };
}

function hasValidRegion(region) {
  const normalized = normalizeRegion(region);
  return normalized.width > 0 && normalized.height > 0;
}

function normalizeReviewStatus(value, verified) {
  if (verified === true) return "verified";
  const text = String(value || "").trim().toLowerCase();
  if (text === "verified" || text === "已核对") return "verified";
  if (["pending", "needs-review", "need-review", "待核对", "review"].includes(text)) return "needs-review";
  return "needs-review";
}

function normalizePlace(place = {}) {
  const source = isPlainObject(place) ? place : {};
  const reviewStatus = normalizeReviewStatus(source.reviewStatus, source.verified === true);
  const verified = source.verified === true || reviewStatus === "verified";
  const normalized = {
    id: String(source.id || "").trim().slice(0, 80),
    campus: String(source.campus || "").trim().slice(0, 40),
    area: String(source.area || "").trim().slice(0, 40),
    name: String(source.name || "").trim().slice(0, 80),
    code: String(source.code || "").trim().slice(0, 24),
    type: String(source.type || "place").trim().slice(0, 40),
    aliases: Array.isArray(source.aliases)
      ? source.aliases.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
      : [],
    description: String(source.description || "").trim().slice(0, 260),
    mapRegion: normalizeRegion(source.mapRegion),
    confidence: Math.max(0, Math.min(1, Number(source.confidence || 0) || 0)),
    verified,
    reviewStatus: verified ? "verified" : "needs-review",
    neighbors: Array.isArray(source.neighbors) ? source.neighbors.slice(0, 12).map((item) => String(item).slice(0, 80)) : [],
    updatedAt: source.updatedAt || nowIso(),
  };
  if (source.mapKey) normalized.mapKey = String(source.mapKey).trim().slice(0, 40);
  if (source.mapAsset) normalized.mapAsset = String(source.mapAsset).trim().slice(0, 160);
  if (source.sourceId) normalized.sourceId = String(source.sourceId).trim().slice(0, 80);
  return normalized;
}

function normalizeDocument(input = {}, patch = {}) {
  const source = isPlainObject(input) ? input : {};
  const places = Array.isArray(source.places) ? source.places.map(normalizePlace) : [];
  const schemaVersion = Number(source.schemaVersion || patch.schemaVersion || 2) || 2;
  return Object.assign({
    schemaVersion,
    version: source.version || patch.version || timestampId("campus-map"),
    updatedAt: source.updatedAt || nowIso(),
    publishedAt: source.publishedAt || "",
    note: source.note || DEFAULT_NOTE,
    source: source.source || patch.source || "",
    publishMode: source.publishMode || patch.publishMode || "",
    cloudbaseStatus: source.cloudbaseStatus || patch.cloudbaseStatus || "",
    mapAssets: normalizeMapAssets(extractMapAssets(source)),
    places,
  }, patch);
}

function readLegacyDocument() {
  return normalizeDocument(readJson(LEGACY_DATA_PATH, { places: [] }), {
    schemaVersion: 2,
    version: "legacy-campus-places",
    mapAssets: defaultMapAssets(),
  });
}

function ensureInitialDocuments() {
  ensureDirs();
  campusMapAssetService.ensureInitialized();
  const initial = readLegacyDocument();
  let published = readJson(PUBLISHED_PATH, null);
  let draft = readJson(DRAFT_PATH, null);
  if (!published) {
    published = normalizeDocument(initial, {
      version: initial.version || timestampId("campus-map-seed"),
      publishedAt: initial.updatedAt || nowIso(),
      source: "seed",
      publishMode: "dual-source",
    });
    writeJsonAtomic(PUBLISHED_PATH, published);
    writePublicConfig(published);
  }
  if (!draft) {
    draft = normalizeDocument(published, {
      source: "published-fallback",
    });
    writeJsonAtomic(DRAFT_PATH, draft);
  }
}

function loadPublishedDocument() {
  ensureInitialDocuments();
  return normalizeDocument(readJson(PUBLISHED_PATH, null) || readLegacyDocument(), {
    source: fs.existsSync(PUBLISHED_PATH) ? "published" : "legacy-fallback",
  });
}

function loadDraftDocument() {
  ensureInitialDocuments();
  return normalizeDocument(readJson(DRAFT_PATH, null) || loadPublishedDocument(), {
    source: fs.existsSync(DRAFT_PATH) ? "draft" : "published-fallback",
  });
}

function makeIssue(level, code, message, action, details = {}) {
  return { level, code, message, action: action || "", details };
}

function summarizeCloudbase(mapAssets = {}) {
  const items = campusMapAssetService.getMapDefinitions().map((definition) => {
    const assetId = mapAssets[definition.mapKey];
    const asset = campusMapAssetService.getAssetForMap(definition.mapKey, assetId);
    if (!asset) {
      return {
        mapKey: definition.mapKey,
        title: definition.title,
        assetId: assetId || "",
        oracle: { ok: false, status: 0, message: "缺少底图引用" },
        cloudbase: { ok: false, status: "pending", message: "缺少底图引用" },
      };
    }
    const local = campusMapAssetService.getLocalStatus(asset);
    const cloudbase = asset.cloudbase || {};
    const cloudbaseUrl = String(asset.cloudbaseUrl || "");
    const cloudbaseOk = campusMapAssetService.isCloudbaseSynced(asset) || Boolean(cloudbaseUrl);
    return {
      mapKey: definition.mapKey,
      title: definition.title,
      assetId: asset.assetId,
      oracle: {
        ok: local.ok,
        status: local.status,
        mime: local.mime || asset.mime || "",
        size: local.size || asset.size || 0,
        sha256: local.sha256 || asset.sha256 || "",
        message: local.reason || "",
        url: asset.oracleUrl,
      },
      cloudbase: {
        ok: cloudbaseOk,
        status: cloudbase.status || "pending",
        statusCode: cloudbase.statusCode || 0,
        mime: cloudbase.mime || "",
        size: cloudbase.size || 0,
        sha256: cloudbase.sha256 || "",
        message: cloudbaseOk ? "" : (cloudbase.message || "CloudBase 还没同步或校验不一致"),
        url: cloudbaseUrl,
      },
    };
  });
  const oracleOk = items.filter((item) => item.oracle.ok).length;
  const cloudbaseOk = items.filter((item) => item.cloudbase.ok).length;
  return {
    oracleStatus: oracleOk === items.length ? "ready" : "blocked",
    cloudbaseStatus: cloudbaseOk === items.length ? "synced" : "pending",
    oracleOk,
    cloudbaseOk,
    total: items.length,
    pendingCloudbase: items.length - cloudbaseOk,
    items,
  };
}

function repairMapAssets(mapAssets = {}) {
  const input = isPlainObject(mapAssets) ? mapAssets : {};
  const output = {};
  const repairs = [];
  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    const requested = String(input[definition.mapKey] || "");
    const requestedAsset = requested ? campusMapAssetService.getAssetForMap(definition.mapKey, requested) : null;
    if (requestedAsset) {
      output[definition.mapKey] = requestedAsset.assetId;
      return;
    }
    const fallback = campusMapAssetService.getLatestAssetIdForMap(definition.mapKey);
    output[definition.mapKey] = fallback || "";
    repairs.push({
      mapKey: definition.mapKey,
      title: definition.title,
      before: requested,
      after: fallback || "",
      message: requested
        ? `${definition.title} 的底图引用不存在，已改回当前可用底图。`
        : `${definition.title} 缺少底图引用，已补上当前可用底图。`,
    });
  });
  return { mapAssets: output, repairs };
}

function repairDocument(input = {}) {
  const document = normalizeDocument(input);
  const repaired = repairMapAssets(document.mapAssets);
  document.mapAssets = repaired.mapAssets;
  return { document, repairs: repaired.repairs };
}

function validateDocument(document, options = {}) {
  const repair = repairDocument(document);
  const doc = repair.document;
  const blockers = [];
  const warnings = [];
  const info = [];
  const ids = new Set();

  if (!doc.places.length) {
    blockers.push(makeIssue(
      "blocker",
      "PLACES_EMPTY",
      "草稿里没有地点数据，小程序无法展示校园地图地点。",
      "请重新导入 JSON，或先新增至少一个地点。"
    ));
  }

  doc.places.forEach((place, index) => {
    const label = place.name || place.id || `第 ${index + 1} 个地点`;
    if (!place.id) {
      blockers.push(makeIssue("blocker", "PLACE_ID_REQUIRED", `第 ${index + 1} 个地点缺少 id。`, "请给每个地点填写唯一 id。", { index }));
    } else if (ids.has(place.id)) {
      blockers.push(makeIssue("blocker", "PLACE_ID_DUPLICATE", `地点 id 重复：${place.id}。`, "请修改重复地点的 id。", { id: place.id }));
    }
    ids.add(place.id);
    if (!place.name) blockers.push(makeIssue("blocker", "PLACE_NAME_REQUIRED", `${label} 缺少名称。`, "请填写地点名称。", { id: place.id }));
    if (!place.campus) blockers.push(makeIssue("blocker", "PLACE_CAMPUS_REQUIRED", `${label} 缺少校区。`, "请选择仙溪校区、江湾校区或河滨校区。", { id: place.id }));
    if (!place.area) blockers.push(makeIssue("blocker", "PLACE_AREA_REQUIRED", `${label} 缺少区域。`, "请填写北区、南区或校区区域。", { id: place.id }));
    if (!place.type) warnings.push(makeIssue("warning", "PLACE_TYPE_DEFAULTED", `${label} 没有类型，已按普通地点处理。`, "需要更精确分类时可在地点属性里修改。", { id: place.id }));
    if (place.verified && !hasValidRegion(place.mapRegion)) {
      blockers.push(makeIssue(
        "blocker",
        "VERIFIED_PLACE_REGION_INVALID",
        `${label} 已标记为已核对，但没有有效红框。`,
        "请选中该地点，在地图上拖出有效红框，或先改为待核对。",
        { id: place.id }
      ));
    } else if (!place.verified) {
      warnings.push(makeIssue(
        "warning",
        "PLACE_NEEDS_REVIEW",
        `${label} 仍是待核对地点，发布后不会显示精确红框。`,
        "如果坐标已经确认，可批量标记为已核对。",
        { id: place.id }
      ));
    }
  });

  repair.repairs.forEach((item) => {
    warnings.push(makeIssue("warning", "MAP_ASSET_REF_REPAIRED", item.message, "保存草稿或自动修复后会写入新引用。", item));
  });

  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    const assetId = doc.mapAssets[definition.mapKey];
    const asset = campusMapAssetService.getAssetForMap(definition.mapKey, assetId);
    if (!asset) {
      blockers.push(makeIssue(
        "blocker",
        "MAP_ASSET_MISSING",
        `${definition.title} 缺少底图资产，小程序无法显示这张地图。`,
        "请到底图管理选择或上传该校区底图。",
        { mapKey: definition.mapKey, assetId }
      ));
      return;
    }
    const local = campusMapAssetService.getLocalStatus(asset);
    if (!local.ok) {
      blockers.push(makeIssue(
        "blocker",
        "ORACLE_ASSET_UNREADABLE",
        `${definition.title} Oracle 底图不可读。`,
        "请点击“修复底图”，或重新上传这张底图。",
        { mapKey: definition.mapKey, assetId: asset.assetId, reason: local.reason || local.status }
      ));
    }
    const cloudbaseOk = campusMapAssetService.isCloudbaseSynced(asset) || Boolean(asset.cloudbaseUrl);
    if (!cloudbaseOk && options.requireCloudbase === true) {
      blockers.push(makeIssue(
        "blocker",
        "CLOUDBASE_ASSET_PENDING",
        `${definition.title} CloudBase 还没同步，但 Oracle 已可用。`,
        "可以先发布 Oracle 版本，稍后再补 CDN；也可以点击“同步底图到 CloudBase”。",
        { mapKey: definition.mapKey, assetId: asset.assetId }
      ));
    }
  });

  if (!String(doc.note || "").trim()) {
    warnings.push(makeIssue(
      "warning",
      "NOTE_MISSING",
      "历史版本缺少说明文案。",
      "建议补一句给小程序用户看的地图说明。"
    ));
  }

  if (options.diff) {
    const summary = options.diff.summary || {};
    if (summary.coordinateChanges && !summary.assetChanges) {
      info.push(makeIssue("info", "COORDINATE_ONLY_CHANGE", "这次只是修改地点坐标，不需要重新上传底图。", ""));
    }
    if (summary.added) info.push(makeIssue("info", "PLACES_ADDED", `本次新增 ${summary.added} 个地点。`, ""));
    if (summary.modified) info.push(makeIssue("info", "PLACES_MODIFIED", `本次修改 ${summary.modified} 个地点。`, ""));
    if (summary.removed) info.push(makeIssue("info", "PLACES_REMOVED", `本次删除 ${summary.removed} 个地点。`, ""));
    if (summary.assetChanges) info.push(makeIssue("info", "MAP_ASSETS_CHANGED", `本次底图引用变化 ${summary.assetChanges} 张。`, ""));
  }

  const issues = blockers.concat(warnings, info);
  return {
    ok: blockers.length === 0,
    canPublish: blockers.length === 0,
    blockers,
    warnings,
    info,
    issues,
    errors: blockers.map((item) => item.message),
    summary: {
      blocker: blockers.length,
      warning: warnings.length,
      info: info.length,
      places: doc.places.length,
      verified: doc.places.filter((place) => place.verified).length,
      needsReview: doc.places.filter((place) => !place.verified).length,
    },
    cloudbase: summarizeCloudbase(doc.mapAssets),
    document: doc,
  };
}

function sanitizePlaceForPublic(place = {}) {
  const verified = place.verified === true;
  return {
    id: String(place.id || "").slice(0, 80),
    campus: String(place.campus || "").slice(0, 40),
    area: String(place.area || "").slice(0, 40),
    name: String(place.name || "").slice(0, 80),
    code: String(place.code || "").slice(0, 24),
    type: String(place.type || "place").slice(0, 40),
    aliases: Array.isArray(place.aliases) ? place.aliases.slice(0, 8).map((item) => String(item).slice(0, 40)) : [],
    description: String(place.description || "").slice(0, 240),
    mapKey: getMapKey(place),
    mapRegion: verified ? normalizeRegion(place.mapRegion) : null,
    confidence: Math.max(0, Math.min(1, Number(place.confidence || 0) || 0)),
    verified,
    reviewStatus: verified ? "verified" : "needs-review",
    updatedAt: place.updatedAt || "",
    neighbors: Array.isArray(place.neighbors) ? place.neighbors.slice(0, 8).map((item) => String(item).slice(0, 80)) : [],
  };
}

function getMapKey(place = {}) {
  if (place.mapKey) return place.mapKey;
  if (place.campus === "河滨校区") return "hebin";
  if (place.campus === "江湾校区") return "jiangwan";
  if (place.campus === "仙溪校区") return place.area === "南区" ? "xianxiSouth" : "xianxiNorth";
  return "xianxiNorth";
}

function buildPublicMaps(mapAssets = {}) {
  return campusMapAssetService.getMapDefinitions().reduce((acc, definition) => {
    const asset = campusMapAssetService.getAssetForMap(definition.mapKey, mapAssets[definition.mapKey]);
    if (asset) acc[definition.mapKey] = campusMapAssetService.publicAsset(asset);
    return acc;
  }, {});
}

function buildPublicConfig(document) {
  const doc = normalizeDocument(document);
  const maps = buildPublicMaps(doc.mapAssets);
  const places = doc.places.map(sanitizePlaceForPublic);
  const cloudbase = summarizeCloudbase(doc.mapAssets);
  const computedCloudbaseStatus = cloudbase.cloudbaseStatus;
  const computedPublishMode = computedCloudbaseStatus === "synced" ? "dual-source" : "oracle-only";
  const basePayload = {
    schemaVersion: 2,
    version: doc.version,
    updatedAt: doc.publishedAt || doc.updatedAt,
    note: doc.note || DEFAULT_NOTE,
    maps,
    places,
    syncStatus: {
      publishMode: computedCloudbaseStatus === "synced" ? computedPublishMode : (doc.publishMode || computedPublishMode),
      oracleStatus: cloudbase.oracleStatus,
      cloudbaseStatus: computedCloudbaseStatus === "synced" ? computedCloudbaseStatus : (doc.cloudbaseStatus || computedCloudbaseStatus),
      pendingCloudbase: cloudbase.pendingCloudbase,
    },
  };
  const hash = hashObject(basePayload);
  return Object.assign({}, basePayload, {
    hash,
    etag: `"${doc.version}-${hash.slice(0, 16)}"`,
  });
}

function writePublicConfig(document) {
  const config = buildPublicConfig(document);
  writeJsonAtomic(PUBLIC_CONFIG_PATH, config);
  return config;
}

function listHistory() {
  ensureDirs();
  return fs.readdirSync(HISTORY_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(HISTORY_DIR, name);
      const stat = fs.statSync(filePath);
      const doc = normalizeDocument(readJson(filePath, {}));
      return {
        id: name.replace(/\.json$/, ""),
        filename: name,
        version: doc.version || "",
        publishedAt: doc.publishedAt || stat.mtime.toISOString(),
        placeCount: Array.isArray(doc.places) ? doc.places.length : 0,
        publishMode: doc.publishMode || "",
        cloudbaseStatus: doc.cloudbaseStatus || "",
        hash: buildPublicConfig(doc).hash,
      };
    })
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))
    .slice(0, 50);
}

function mapPlacesById(document) {
  const map = new Map();
  (document.places || []).forEach((place) => map.set(place.id, place));
  return map;
}

function sameRegion(a = {}, b = {}) {
  return ["x", "y", "width", "height"].every((key) => Number(a[key] || 0).toFixed(5) === Number(b[key] || 0).toFixed(5));
}

function computeDiff(previousInput, nextInput) {
  const previous = normalizeDocument(previousInput || {});
  const next = normalizeDocument(nextInput || {});
  const previousMap = mapPlacesById(previous);
  const nextMap = mapPlacesById(next);
  const added = [];
  const removed = [];
  const modified = [];
  const coordinateChanges = [];

  next.places.forEach((place) => {
    const before = previousMap.get(place.id);
    if (!before) {
      added.push(place);
      return;
    }
    const beforeComparable = Object.assign({}, before);
    const afterComparable = Object.assign({}, place);
    delete beforeComparable.updatedAt;
    delete afterComparable.updatedAt;
    if (JSON.stringify(beforeComparable) !== JSON.stringify(afterComparable)) {
      modified.push({ before, after: place });
    }
    if (!sameRegion(before.mapRegion, place.mapRegion)) {
      coordinateChanges.push({
        id: place.id,
        name: place.name,
        before: before.mapRegion,
        after: place.mapRegion,
      });
    }
  });
  previous.places.forEach((place) => {
    if (!nextMap.has(place.id)) removed.push(place);
  });

  const assetChanges = [];
  campusMapAssetService.getMapDefinitions().forEach((definition) => {
    const beforeId = previous.mapAssets[definition.mapKey] || "";
    const afterId = next.mapAssets[definition.mapKey] || "";
    if (beforeId !== afterId) {
      assetChanges.push({
        mapKey: definition.mapKey,
        title: definition.title,
        before: beforeId,
        after: afterId,
      });
    }
  });

  return {
    added,
    removed,
    modified,
    coordinateChanges,
    assetChanges,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      coordinateChanges: coordinateChanges.length,
      assetChanges: assetChanges.length,
    },
  };
}

function buildStatus(published, draft) {
  const diff = computeDiff(published, draft);
  const validation = validateDocument(draft, { diff });
  const publishedCloudbase = summarizeCloudbase(published.mapAssets);
  const draftCloudbase = summarizeCloudbase(draft.mapAssets);
  const computedPublishedCloudbaseStatus = publishedCloudbase.cloudbaseStatus;
  const computedPublishedPublishMode = computedPublishedCloudbaseStatus === "synced" ? "dual-source" : "oracle-only";
  return {
    draft: {
      version: draft.version || "",
      updatedAt: draft.updatedAt || "",
      placeCount: draft.places.length,
      validation: validation.summary,
      canPublish: validation.canPublish,
    },
    published: {
      version: published.version || "",
      publishedAt: published.publishedAt || "",
      placeCount: published.places.length,
      publishMode: computedPublishedCloudbaseStatus === "synced" ? computedPublishedPublishMode : (published.publishMode || computedPublishedPublishMode),
      cloudbaseStatus: computedPublishedCloudbaseStatus === "synced" ? computedPublishedCloudbaseStatus : (published.cloudbaseStatus || computedPublishedCloudbaseStatus),
    },
    oracle: {
      status: draftCloudbase.oracleStatus,
      ok: draftCloudbase.oracleStatus === "ready",
      okCount: draftCloudbase.oracleOk,
      total: draftCloudbase.total,
    },
    cloudbase: {
      status: draftCloudbase.cloudbaseStatus,
      ok: draftCloudbase.cloudbaseStatus === "synced",
      okCount: draftCloudbase.cloudbaseOk,
      pending: draftCloudbase.pendingCloudbase,
      total: draftCloudbase.total,
    },
    diff: diff.summary,
    message: validation.canPublish
      ? (draftCloudbase.cloudbaseStatus === "synced" ? "草稿可发布，CloudBase 与 Oracle 都可用。" : "CloudBase 还没同步，但 Oracle 已可用。")
      : "草稿还有会影响小程序地图可用性的问题，请先修复 blocker。",
  };
}

function getState() {
  const published = loadPublishedDocument();
  const draft = loadDraftDocument();
  const diff = computeDiff(published, draft);
  return {
    published,
    draft,
    publicConfig: buildPublicConfig(published),
    assets: campusMapAssetService.listAdminAssets(draft.mapAssets, published.mapAssets),
    history: listHistory(),
    diff,
    validation: validateDocument(draft, { diff }),
    status: buildStatus(published, draft),
    paths: {
      draft: DRAFT_PATH,
      published: PUBLISHED_PATH,
      publicConfig: PUBLIC_CONFIG_PATH,
      assets: campusMapAssetService.ASSET_STORE_PATH,
    },
  };
}

function throwValidationError(code, validation) {
  const error = new Error(code);
  error.code = code;
  error.errors = validation.errors || [];
  error.issues = validation.issues || [];
  error.validation = validation;
  throw error;
}

function saveDraft(payload = {}) {
  const patched = normalizeDocument(payload, {
    version: payload.version || timestampId("draft"),
    updatedAt: nowIso(),
    publishedAt: "",
    source: payload.source || "draft",
  });
  const repair = repairDocument(patched);
  const validation = validateDocument(repair.document);
  if (!validation.ok) {
    throwValidationError("CAMPUS_MAP_DRAFT_INVALID", validation);
  }
  writeJsonAtomic(DRAFT_PATH, validation.document);
  return validation.document;
}

function setDraftMapAsset(mapKey, assetId) {
  const draft = loadDraftDocument();
  const asset = campusMapAssetService.getAssetForMap(mapKey, assetId);
  if (!asset) {
    const error = new Error("Campus map asset was not found for the selected map.");
    error.code = "CAMPUS_MAP_ASSET_NOT_FOUND";
    throw error;
  }
  draft.mapAssets[mapKey] = asset.assetId;
  draft.version = timestampId("draft");
  draft.updatedAt = nowIso();
  return saveDraft(draft);
}

function writeLegacyMirror(document) {
  if (process.env.FOSU_MAP_SKIP_LEGACY_MIRROR === "true") return;
  const legacy = {
    schemaVersion: document.schemaVersion || 2,
    version: document.version,
    updatedAt: document.publishedAt || document.updatedAt,
    publishedAt: document.publishedAt || "",
    note: document.note,
    source: document.source || "published",
    publishMode: document.publishMode || "",
    cloudbaseStatus: document.cloudbaseStatus || "",
    mapAssets: document.mapAssets,
    places: document.places,
  };
  writeJsonAtomic(LEGACY_DATA_PATH, legacy);
}

function publishDraft(payload, options = {}) {
  const source = payload && Array.isArray(payload.places) ? payload : loadDraftDocument();
  const cloudbase = summarizeCloudbase(source.mapAssets || {});
  const publishMode = options.publishMode || (cloudbase.cloudbaseStatus === "synced" ? "dual-source" : "oracle-only");
  const nextDocument = normalizeDocument(source, {
    version: options.version || timestampId("campus-map"),
    updatedAt: nowIso(),
    publishedAt: nowIso(),
    source: "published",
    publishMode,
    cloudbaseStatus: options.cloudbaseStatus || cloudbase.cloudbaseStatus,
    syncResult: options.syncResult || undefined,
  });
  const validation = validateDocument(nextDocument, {
    requireCloudbase: options.requireCloudbase === true,
  });
  if (!validation.ok) {
    throwValidationError("CAMPUS_MAP_PUBLISH_PREFLIGHT_FAILED", validation);
  }
  const current = fs.existsSync(PUBLISHED_PATH) ? loadPublishedDocument() : null;
  if (current && current.places.length) {
    writeJsonAtomic(path.join(HISTORY_DIR, `${timestampId("history")}.json`), current);
  }
  writeJsonAtomic(PUBLISHED_PATH, validation.document);
  writeJsonAtomic(DRAFT_PATH, validation.document);
  writePublicConfig(validation.document);
  writeLegacyMirror(validation.document);
  return validation.document;
}

function rollback(historyId) {
  const safeId = path.basename(String(historyId || "")).replace(/\.json$/, "");
  const filePath = path.join(HISTORY_DIR, `${safeId}.json`);
  const document = readJson(filePath, null);
  if (!document) {
    const error = new Error("CAMPUS_MAP_HISTORY_NOT_FOUND");
    error.code = "CAMPUS_MAP_HISTORY_NOT_FOUND";
    throw error;
  }
  return publishDraft(document, {
    version: timestampId("rollback"),
    publishMode: "rollback",
  });
}

function createBackup(label = "manual", options = {}) {
  ensureDirs();
  const safeLabel = String(label || "manual").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "manual";
  const document = options.document ? normalizeDocument(options.document) : (options.source === "published" ? loadPublishedDocument() : loadDraftDocument());
  const source = options.source || (options.document ? "provided" : "draft");
  const filePath = path.join(BACKUP_DIR, `${timestampId(safeLabel)}.json`);
  writeJsonAtomic(filePath, document);
  return {
    filename: path.basename(filePath),
    path: filePath,
    source,
    version: document.version || "",
    placeCount: document.places.length,
    mapAssetCount: Object.keys(document.mapAssets || {}).filter((key) => document.mapAssets[key]).length,
    createdAt: nowIso(),
  };
}

function decodeImportOptions(input = {}) {
  const preset = String(input.preset || input.importPreset || input.importMode || "").toLowerCase();
  let scope = String(input.scope || input.importScope || "").toLowerCase();
  let mode = String(input.mode || input.mergeMode || "").toLowerCase();
  if (preset) {
    if (preset.includes("places")) scope = "places-only";
    if (preset.includes("asset") || preset.includes("full")) scope = "places-and-assets";
    if (preset.includes("merge")) mode = "merge";
    if (preset.includes("replace") || preset.includes("overwrite")) mode = "replace";
  }
  if (!["places-only", "places-and-assets"].includes(scope)) scope = "places-and-assets";
  if (!["merge", "replace"].includes(mode)) mode = "replace";
  return { scope, mode, preset: preset || `${scope}:${mode}` };
}

function collectImportFieldWarnings(raw) {
  const warnings = [];
  if (!isPlainObject(raw)) {
    return [makeIssue("warning", "IMPORT_PAYLOAD_SHAPE", "导入内容不是对象。", "请粘贴完整的 campus-map-draft.json。")];
  }
  if (!raw.schemaVersion) warnings.push(makeIssue("warning", "IMPORT_SCHEMA_VERSION_MISSING", "JSON 缺少 schemaVersion，已按 v2 处理。", ""));
  if (!raw.version) warnings.push(makeIssue("warning", "IMPORT_VERSION_MISSING", "JSON 缺少 version，保存后会生成草稿版本号。", ""));
  if (!Array.isArray(raw.places)) warnings.push(makeIssue("warning", "IMPORT_PLACES_MISSING", "JSON 缺少 places 数组。", "请确认导出的文件是完整草稿。"));
  if (!isPlainObject(raw.mapAssets) && !isPlainObject(raw.maps) && !isPlainObject(raw.assets)) {
    warnings.push(makeIssue("warning", "IMPORT_MAP_ASSETS_MISSING", "JSON 缺少 mapAssets，导入时会继续使用当前草稿底图。", ""));
  }
  (Array.isArray(raw.places) ? raw.places : []).forEach((place, index) => {
    const label = place && (place.name || place.id) || `第 ${index + 1} 个地点`;
    if (!place || typeof place !== "object") {
      warnings.push(makeIssue("warning", "IMPORT_PLACE_INVALID", `${label} 不是有效地点对象。`, "请检查 places 数组。", { index }));
      return;
    }
    ["id", "name", "campus", "area"].forEach((field) => {
      if (!place[field]) warnings.push(makeIssue("warning", `IMPORT_${field.toUpperCase()}_MISSING`, `${label} 缺少 ${field}。`, "导入后校验会提示具体修复位置。", { index }));
    });
    if (!Array.isArray(place.aliases)) warnings.push(makeIssue("warning", "IMPORT_ALIASES_NOT_ARRAY", `${label} 的 aliases 不是数组，导入时会转为空数组。`, "", { index }));
    if (!place.description) warnings.push(makeIssue("warning", "IMPORT_DESCRIPTION_MISSING", `${label} 缺少 description，发布不受影响。`, "", { index }));
  });
  return warnings;
}

function mergePlaces(currentPlaces, importedPlaces) {
  const next = Array.isArray(currentPlaces) ? currentPlaces.map((place) => Object.assign({}, place)) : [];
  importedPlaces.forEach((place) => {
    const index = next.findIndex((item) => item.id === place.id);
    if (index >= 0) next[index] = Object.assign({}, next[index], place, { updatedAt: place.updatedAt || nowIso() });
    else next.push(place);
  });
  return next;
}

function importDocument(payload = {}, options = {}) {
  const rawWrapper = isPlainObject(payload) ? payload : {};
  const raw = isPlainObject(rawWrapper.document) ? rawWrapper.document : rawWrapper;
  const importOptions = decodeImportOptions(Object.assign({}, options, rawWrapper.options || {}, rawWrapper.importOptions || {}, rawWrapper));
  const before = loadDraftDocument();
  const backup = createBackup("import-before", { source: "draft", document: before });
  const fieldWarnings = collectImportFieldWarnings(raw);
  const imported = normalizeDocument(raw, {
    version: raw.version || timestampId("draft-import"),
    updatedAt: nowIso(),
    publishedAt: "",
    source: raw.source || "import",
  });
  const base = importOptions.mode === "merge" ? clone(before) : normalizeDocument(imported);
  base.places = importOptions.mode === "merge" ? mergePlaces(before.places, imported.places) : imported.places;
  base.mapAssets = importOptions.scope === "places-only" ? before.mapAssets : imported.mapAssets;
  base.schemaVersion = imported.schemaVersion || 2;
  base.version = imported.version || timestampId("draft-import");
  base.updatedAt = nowIso();
  base.publishedAt = "";
  base.note = imported.note || before.note || DEFAULT_NOTE;
  base.source = imported.source || "import";
  const repair = repairDocument(base);
  const diff = computeDiff(before, repair.document);
  const validation = validateDocument(repair.document, { diff });
  validation.warnings = fieldWarnings.concat(validation.warnings);
  validation.issues = validation.blockers.concat(validation.warnings, validation.info);
  validation.summary.warning = validation.warnings.length;
  if (!validation.ok) {
    const error = new Error("CAMPUS_MAP_IMPORT_INVALID");
    error.code = "CAMPUS_MAP_IMPORT_INVALID";
    error.errors = validation.errors;
    error.issues = validation.issues;
    error.validation = validation;
    error.backup = backup;
    throw error;
  }
  writeJsonAtomic(DRAFT_PATH, validation.document);
  return {
    document: validation.document,
    backup,
    diff,
    validation,
    importOptions,
    summary: Object.assign({}, diff.summary, {
      pendingReview: validation.document.places.filter((place) => !place.verified).length,
      mapAssetChanges: diff.summary.assetChanges,
      fieldWarnings: fieldWarnings.length,
    }),
  };
}

function autoRepairDraft(payload) {
  const source = payload && Array.isArray(payload.places) ? payload : loadDraftDocument();
  const repair = repairDocument(source);
  const validation = validateDocument(repair.document);
  if (!validation.ok) throwValidationError("CAMPUS_MAP_REPAIR_BLOCKED", validation);
  writeJsonAtomic(DRAFT_PATH, validation.document);
  return {
    document: validation.document,
    repairs: repair.repairs,
    validation,
  };
}

function previewPublish(payload) {
  const draft = repairDocument(payload && Array.isArray(payload.places) ? payload : loadDraftDocument()).document;
  const published = loadPublishedDocument();
  const diff = computeDiff(published, draft);
  const validation = validateDocument(draft, { diff });
  return {
    validation,
    diff,
    publicConfig: buildPublicConfig(draft),
    status: buildStatus(published, draft),
  };
}

function verifyPublishedDocument() {
  const published = loadPublishedDocument();
  const validation = validateDocument(published);
  const publicConfig = buildPublicConfig(published);
  const computedCloudbaseStatus = validation.cloudbase.cloudbaseStatus;
  return {
    validation,
    publicConfig,
    status: buildStatus(published, loadDraftDocument()),
    receipt: {
      version: published.version,
      hash: publicConfig.hash,
      publishedAt: published.publishedAt || "",
      publishMode: publicConfig.syncStatus.publishMode || published.publishMode || "",
      cloudbaseStatus: computedCloudbaseStatus === "synced" ? computedCloudbaseStatus : (published.cloudbaseStatus || computedCloudbaseStatus),
      placeCount: publicConfig.places.length,
      mapCount: Object.keys(publicConfig.maps || {}).length,
    },
  };
}

module.exports = {
  BACKUP_DIR,
  DRAFT_PATH,
  HISTORY_DIR,
  LEGACY_DATA_PATH,
  PUBLISHED_PATH,
  PUBLIC_CONFIG_PATH,
  autoRepairDraft,
  buildPublicConfig,
  buildStatus,
  computeDiff,
  createBackup,
  getMapKey,
  getState,
  importDocument,
  listHistory,
  loadDraftDocument,
  loadPublishedDocument,
  previewPublish,
  publishDraft,
  repairDocument,
  rollback,
  saveDraft,
  setDraftMapAsset,
  summarizeCloudbase,
  validateDocument,
  verifyPublishedDocument,
  writePublicConfig,
};
