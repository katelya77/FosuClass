const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-campus-map-assets-"));

process.env.FOSU_STORAGE_DIR = tempRoot;
process.env.FOSU_MAP_SKIP_LEGACY_MIRROR = "true";
process.env.FOSU_MAP_REQUIRE_CLOUDBASE_SYNC = "true";
process.env.PUBLIC_API_ORIGIN = "https://class.katelya.eu.org";

const assetService = require("../server/src/services/campusMapAssetService");
const versionService = require("../server/src/services/ai/campusMapVersionService");

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

const draft = versionService.loadDraftDocument();
draft.places = draft.places.concat([{
  id: "test-campus-map-new-place",
  campus: "仙溪校区",
  area: "北区",
  name: "测试地点",
  code: "T1",
  type: "place",
  aliases: [],
  description: "draft only",
  mapRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  verified: false,
}]);
versionService.saveDraft(draft);
assert.strictEqual(versionService.loadPublishedDocument().version, beforePublished.version, "saving draft must not change published version");
assert.strictEqual(versionService.buildPublicConfig(versionService.loadPublishedDocument()).hash, beforePublic.hash, "saving draft must not change public hash");

assert.throws(
  () => versionService.publishDraft(versionService.loadDraftDocument()),
  (error) => error && error.code === "CAMPUS_MAP_CLOUDBASE_PENDING",
  "publish should be blocked when CloudBase mirror is not verified"
);
assert.strictEqual(versionService.loadPublishedDocument().version, beforePublished.version, "failed publish must keep previous published version");

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

const published = versionService.publishDraft(readyDraft);
assert(published.places.some((place) => place.id === "test-campus-map-new-place"), "verified publish should write draft places");
const afterPublic = versionService.buildPublicConfig(published);
assert.notStrictEqual(afterPublic.hash, beforePublic.hash, "published public hash should change after publish");

const history = versionService.listHistory();
assert(history.length >= 1, "publish should preserve previous published version in history");
const rolledBack = versionService.rollback(history[0].id);
assert(!rolledBack.places.some((place) => place.id === "test-campus-map-new-place"), "rollback should restore previous published places");

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("test-campus-map-assets passed");
