const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-campus-map-assets-"));

process.env.FOSU_STORAGE_DIR = tempRoot;
process.env.FOSU_MAP_SKIP_LEGACY_MIRROR = "true";
process.env.PUBLIC_API_ORIGIN = "https://class.katelya.eu.org";

const assetService = require("../server/src/services/campusMapAssetService");
const versionService = require("../server/src/services/ai/campusMapVersionService");

function exportedDraftFixture() {
  const userDraft = path.join(os.homedir(), "Downloads", "campus-map-draft.json");
  if (fs.existsSync(userDraft)) {
    return JSON.parse(fs.readFileSync(userDraft, "utf8"));
  }
  const current = versionService.loadDraftDocument();
  return Object.assign({}, current, {
    source: "test-exported-draft-fixture",
    places: current.places.slice(0, 8).map((place) => Object.assign({}, place, {
      aliases: Array.isArray(place.aliases) ? place.aliases : [],
      description: place.description || "fixture description",
      verified: place.verified === true,
      reviewStatus: place.verified === true ? "verified" : "needs-review",
    })),
  });
}

const state = versionService.getState();
assert.strictEqual(Object.keys(state.assets).length, 4, "four campus map asset groups should exist");
assert.strictEqual(Object.keys(state.publicConfig.maps).length, 4, "public config should expose four maps");
assert(fs.existsSync(path.join(tempRoot, "campus-map", "assets.json")), "asset metadata should be persisted under storage");

Object.keys(state.assets).forEach((mapKey) => {
  const current = state.assets[mapKey].current;
  assert(current.assetId && current.mapKey === mapKey, `${mapKey} should have current asset`);
  assert(current.oracleUrl.includes("/static/campus-maps/assets/"), "oracle URL should be public static URL");
  assert(current.cloudbaseUrl.includes("/campus-maps/assets/"), "cloudbase URL should be versioned map path");
  assert.strictEqual(current.localStatus.ok, true, `${mapKey} local Oracle copy should be readable`);
  assert(!JSON.stringify(state.publicConfig.maps[mapKey]).includes(tempRoot), "public config must not expose server file path");
});

const beforePublished = versionService.loadPublishedDocument();
const beforePublic = versionService.buildPublicConfig(beforePublished);
const seedFile = path.join(root, "server", "assets", "maps", "campus-map-xianxi-north.jpg");
const duplicate = assetService.importAssetFromFile("xianxiNorth", seedFile, {
  mime: "image/jpeg",
  originalFileName: "campus-map-xianxi-north.jpg",
  source: "test-duplicate",
});
assert.strictEqual(duplicate.duplicate, true, "same SHA-256 upload should reuse existing asset");

const exportedDraft = exportedDraftFixture();
const imported = versionService.importDocument({
  document: exportedDraft,
  options: { preset: "full-replace" },
});
assert.strictEqual(imported.document.places.length, exportedDraft.places.length, "exported draft import should preserve place count");
assert.deepStrictEqual(imported.document.mapAssets, exportedDraft.mapAssets, "exported draft import should preserve mapAssets");
assert(imported.document.places.every((place) => Object.prototype.hasOwnProperty.call(place, "verified")), "import should preserve verified field");
assert(imported.document.places.every((place) => Object.prototype.hasOwnProperty.call(place, "reviewStatus")), "import should preserve reviewStatus field");
assert(imported.document.places.every((place) => Object.prototype.hasOwnProperty.call(place, "mapRegion")), "import should preserve mapRegion field");
assert(fs.existsSync(imported.backup.path), "import should backup current draft before writing");
assert.strictEqual(versionService.loadPublishedDocument().version, beforePublished.version, "importing draft must not change published version");

const draft = versionService.loadDraftDocument();
draft.places = draft.places.concat([{
  id: "test-campus-map-new-place",
  campus: "仙溪校区",
  area: "北区",
  name: "测试地点",
  code: "T1",
  type: "place",
  aliases: ["测试别名"],
  description: "draft only",
  mapRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  verified: false,
  reviewStatus: "needs-review",
}]);
versionService.saveDraft(draft);
assert.strictEqual(versionService.loadPublishedDocument().version, beforePublished.version, "saving draft must not change published version");
assert.strictEqual(versionService.buildPublicConfig(versionService.loadPublishedDocument()).hash, beforePublic.hash, "saving draft must not change public hash");

const pendingPreview = versionService.previewPublish(versionService.loadDraftDocument());
assert.strictEqual(pendingPreview.validation.ok, true, "CloudBase static URL availability should not be a blocker");
assert(!pendingPreview.validation.warnings.some((issue) => issue.code === "CLOUDBASE_ASSET_PENDING"), "CloudBase static URL availability should not produce a pending warning");
assert.strictEqual(pendingPreview.validation.cloudbase.cloudbaseStatus, "synced", "versioned CloudBase URLs should be treated as long-lived synced assets");

const invalidDraft = versionService.loadDraftDocument();
invalidDraft.places = invalidDraft.places.concat([{
  id: "test-campus-map-invalid-verified",
  campus: "仙溪校区",
  area: "北区",
  name: "无红框已核对地点",
  type: "place",
  aliases: [],
  description: "",
  mapRegion: { x: 0, y: 0, width: 0, height: 0 },
  verified: true,
  reviewStatus: "verified",
}]);
assert.throws(
  () => versionService.publishDraft(invalidDraft),
  (error) => error && error.code === "CAMPUS_MAP_PUBLISH_PREFLIGHT_FAILED",
  "verified places without valid regions must block publish"
);
assert.strictEqual(versionService.loadPublishedDocument().version, beforePublished.version, "failed publish must keep previous published version");

const staticPublished = versionService.publishDraft(versionService.loadDraftDocument());
assert(staticPublished.places.some((place) => place.id === "test-campus-map-new-place"), "static map publish should write draft places");
assert.strictEqual(staticPublished.publishMode, "dual-source", "CloudBase static assets should publish as dual-source by default");
assert.strictEqual(versionService.buildPublicConfig(staticPublished).syncStatus.cloudbaseStatus, "synced", "public config should expose synced CloudBase status");

const historyAfterStaticPublish = versionService.listHistory();
assert(historyAfterStaticPublish.length >= 1, "publish should preserve previous published version in history");
const rolledBackStatic = versionService.rollback(historyAfterStaticPublish[0].id);
assert(!rolledBackStatic.places.some((place) => place.id === "test-campus-map-new-place"), "rollback should restore previous published places");

const readyDraft = versionService.loadDraftDocument();
Object.keys(readyDraft.mapAssets).forEach((mapKey) => {
  const asset = assetService.getAsset(readyDraft.mapAssets[mapKey]);
  assetService.markCloudbaseResult(asset.assetId, {
    ok: true,
    statusCode: 200,
    size: asset.size,
    sha256: asset.sha256,
    mime: asset.mime,
  });
  assert.strictEqual(assetService.isCloudbaseSynced(assetService.getAsset(asset.assetId)), true, `${mapKey} synced hash should not require duplicate CloudBase upload`);
});
readyDraft.places = readyDraft.places.concat([{
  id: "test-campus-map-dual-source-place",
  campus: "仙溪校区",
  area: "北区",
  name: "双源测试地点",
  code: "T2",
  type: "place",
  aliases: [],
  description: "dual source",
  mapRegion: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
  verified: true,
  reviewStatus: "verified",
}]);
versionService.saveDraft(readyDraft);
const dualPublished = versionService.publishDraft(versionService.loadDraftDocument(), {
  publishMode: "dual-source",
  cloudbaseStatus: "synced",
});
assert.strictEqual(dualPublished.publishMode, "dual-source", "CloudBase synced publish should be dual-source");
assert.strictEqual(versionService.buildPublicConfig(dualPublished).syncStatus.cloudbaseStatus, "synced", "public config should expose synced CloudBase status");

const verify = versionService.verifyPublishedDocument();
assert.strictEqual(verify.receipt.version, dualPublished.version, "published verify should read latest published");
assert.strictEqual(verify.receipt.mapCount, 4, "published verify should expose four maps");

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("test-campus-map-assets passed");
