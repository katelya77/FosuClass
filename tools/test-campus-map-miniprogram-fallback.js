const assert = require("assert");
const path = require("path");

const servicePath = path.resolve(__dirname, "../miniprogram/services/campusMapDataService.js");
const requestPath = path.resolve(__dirname, "../miniprogram/utils/request.js");
const pagePath = path.resolve(__dirname, "../miniprogram/pages/campus-map/campus-map.js");

function resetModule(filePath) {
  delete require.cache[require.resolve(filePath)];
}

function installWx(storage = {}) {
  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    getImageInfo() {},
    previewImage() {},
    navigateTo() {},
  };
  return storage;
}

async function testDataServiceCacheAndEtag() {
  const storage = installWx({});
  const calls = [];
  const requestMock = {
    get(url, params, options) {
      calls.push({ url, params, options });
      return Promise.resolve({
        success: true,
        data: {
          version: "campus-map-test",
          hash: "hash-test",
          etag: "\"campus-map-test-hash\"",
          updatedAt: "2026-06-21T00:00:00.000Z",
          maps: {
            xianxiNorth: {
              cloudbaseUrl: "https://cloud.example.com/campus-map-xianxi-north.jpg",
              oracleUrl: "https://oracle.example.com/campus-map-xianxi-north.jpg",
              sha256: "abc",
              assetVersion: "sha256-abc",
            },
          },
          places: [
            {
              id: "place-a",
              campus: "仙溪校区",
              area: "北区",
              name: "A",
              verified: true,
              mapRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
            },
          ],
        },
      });
    },
  };

  resetModule(requestPath);
  resetModule(servicePath);
  require.cache[require.resolve(requestPath)] = { exports: requestMock };
  const service = require(servicePath);

  const first = await service.loadPublishedMapData();
  assert.strictEqual(first.version, "campus-map-test", "published map data should normalize nested data payload");
  assert.strictEqual(
    first.maps.xianxiNorth.cdnUrl,
    "https://cloud.example.com/campus-map-xianxi-north.jpg",
    "cloudbase URL should become the CDN primary URL",
  );
  assert.strictEqual(
    first.maps.xianxiNorth.fallbackUrl,
    "https://oracle.example.com/campus-map-xianxi-north.jpg",
    "oracle URL should become fallback URL",
  );
  assert.strictEqual(calls[0].options.header["If-None-Match"], undefined, "first request should not send ETag");

  requestMock.get = (url, params, options) => {
    calls.push({ url, params, options });
    return Promise.reject({ statusCode: 304 });
  };
  const cached = await service.loadPublishedMapData();
  assert.strictEqual(cached.version, "campus-map-test", "304 should reuse cached campus map config");
  assert.strictEqual(
    calls[1].options.header["If-None-Match"],
    "\"campus-map-test-hash\"",
    "subsequent request should send cached ETag",
  );
  assert(storage.FOSU_CAMPUS_MAP_PUBLISHED_CACHE, "published config should be cached in wx storage");
}

function testPageImageFallbackChain() {
  installWx({});
  resetModule(pagePath);
  resetModule(servicePath);

  const pageData = {
    note: "test",
    maps: {
      xianxiNorth: {
        title: "North",
        cdnUrl: "https://cloud.example.com/map.jpg",
        fallbackUrl: "https://oracle.example.com/map.jpg",
        packageUrl: "/assets/maps/campus-map-xianxi-north.jpg",
        assetVersion: "sha256-test",
        sha256: "abc",
      },
    },
    places: [],
  };
  require.cache[require.resolve(servicePath)] = {
    exports: {
      getFallbackData: () => pageData,
      loadPublishedMapData: () => Promise.resolve(pageData),
    },
  };

  let definition = null;
  global.Page = (config) => {
    definition = config;
  };
  require(pagePath);
  assert(definition, "campus map page definition should be registered");

  const instance = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      this.data = Object.assign({}, this.data, patch);
      if (typeof callback === "function") callback();
    },
  });

  instance.updateMapData("xianxiNorth", null);
  assert.strictEqual(instance.data.mapInfo.assetSource, "cloudbase", "CloudBase CDN should be primary");
  assert.strictEqual(instance.data.mapInfo.asset, "https://cloud.example.com/map.jpg");

  instance.onMapImageError();
  assert.strictEqual(instance.data.mapInfo.assetSource, "oracle", "CloudBase failure should fall back to Oracle");
  assert.strictEqual(instance.data.mapInfo.asset, "https://oracle.example.com/map.jpg");

  instance.onMapImageError();
  assert.strictEqual(instance.data.mapInfo.assetSource, "package", "Oracle failure should fall back to package image");
  assert.strictEqual(instance.data.mapInfo.asset, "/assets/maps/campus-map-xianxi-north.jpg");

  instance.onMapImageError();
  assert.strictEqual(instance.data.imageError, true, "package image failure should surface image error");
}

(async () => {
  await testDataServiceCacheAndEtag();
  testPageImageFallbackChain();
  console.log("test-campus-map-miniprogram-fallback passed");
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
