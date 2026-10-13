const assert = require("assert");
const mockEnv = require("./mock-env");
const request = require("../miniprogram/utils/request");
const releasePackService = require("../miniprogram/services/releasePackService");
const securitySessionService = require("../miniprogram/services/securitySessionService");
const staticAccessService = require("../miniprogram/services/staticAccessService");
const { getSchoolCatalogCacheKey } = require("../miniprogram/utils/storage");

// Exercise the real request failure / modal path without a school or Session request.
securitySessionService.buildSessionHeaders = async () => ({});
staticAccessService.buildStaticHeaders = async () => ({});
const realGet = request.get;
request.get = (url, data, options) => realGet(url, data, Object.assign({}, options, { retries: 0 }));
require("../miniprogram/pages/school/school.js");
const term = "2025-2026-2";
const releaseVersion = "network-ux-fixture";
const failures = [];
let passed = 0;
let modals = [];
let paths = [];

function page() {
  mockEnv.clearStorage();
  modals = [];
  paths = [];
  wx.onModal = (options) => modals.push(options);
  wx.mockRequest = (options) => {
    paths.push(new URL(options.url).pathname);
    options.fail({ errMsg: "request:fail connection reset" });
  };
  const instance = mockEnv.createPageInstance();
  instance.data = JSON.parse(JSON.stringify(instance.data));
  instance._activeInitSeq = 1;
  instance._schoolRequestSeq = 0;
  instance.hasSharedQuery = () => false;
  instance.restoreFilterCache = () => {};
  instance.setData({
    dataLoadState: "success",
    activeSnapshot: { term, releaseVersion },
    catalogVersion: releaseVersion,
    semesters: [{ value: term, label: term }],
    selectedSemesterIndex: 0,
    colleges: [{ code: "01", name: "测试学院" }],
    selectedCollegeIndex: 0,
    grades: ["2025"],
    selectedGradeIndex: 0,
    majors: [{ code: "0101", name: "测试专业" }],
    selectedMajorIndex: 0,
  });
  return instance;
}

const catalog = {
  success: true,
  semester: term,
  version: releaseVersion,
  colleges: [{ code: "01", name: "测试学院" }],
  grades: ["2025"],
};
const classIndex = {
  success: true, term, releaseVersion, type: "class",
  items: [{ id: "class-fixture", className: "25测试1班", collegeCode: "01", collegeName: "测试学院", grade: "2025", majorCode: "0101", majorName: "测试专业" }],
};

async function check(name, fn) {
  try { await fn(); passed += 1; console.log("PASS " + name); }
  catch (error) { failures.push(name + ": " + error.message); console.error("FAIL " + failures[failures.length - 1]); }
}

async function run() {
  await check("major list failure leaves a retryable inline error without a modal", async () => {
    const p = page();
    await assert.rejects(p.fetchMajors(), (error) => error.code === "WECHAT_NETWORK_REQUEST_FAILED");
    assert.strictEqual(paths.filter((path) => path.endsWith("/majors")).length, 1);
    assert.strictEqual(modals.length, 0, "background/filter failure must not display the network-layer modal");
    assert.ok(p.data.classFilterError.includes("专业列表"));
    assert.strictEqual(typeof p.retryClassFilters, "function");
    assert.strictEqual(p.data.dataLoadState, "success", "a filter failure must not replace usable catalog data");
  });
  await check("class compatibility fallback failure is inline and keeps catalog available", async () => {
    const p = page();
    p.fetchSearchIndex = () => Promise.reject(Object.assign(new Error("fixture"), { code: "WECHAT_NETWORK_REQUEST_FAILED" }));
    await assert.rejects(p.fetchClasses());
    assert.strictEqual(modals.length, 0);
    assert.ok(p.data.classFilterError.includes("班级列表"));
    assert.strictEqual(p.data.dataLoadState, "success");
  });
  await check("same-version catalog refresh failure ends checking and preserves cache", async () => {
    const p = page();
    wx.setStorageSync(getSchoolCatalogCacheKey(term, releaseVersion), catalog);
    p.loadCatalogData({ term, releaseVersion }, { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(p.data.dataLoadState, "success");
    assert.ok(p.originalCatalogData.colleges.length);
    assert.ok(p.data.restoreHint.includes("更新暂未完成"));
    assert.ok(!p.data.restoreHint.includes("正在"));
    assert.strictEqual(modals.length, 0);
  });
  await check("catalog derived from validated cached class index survives refresh failure", async () => {
    const p = page();
    wx.setStorageSync(releasePackService.getIndexCacheKey(term, releaseVersion, "class"), { savedAt: Date.now(), data: classIndex });
    p.loadCatalogData({ term, releaseVersion }, { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(p.data.dataLoadState, "success");
    assert.ok(p.originalCatalogData.majors.some((major) => major.code === "0101"));
    assert.ok(p.data.restoreHint.includes("更新暂未完成"));
    assert.strictEqual(modals.length, 0);
  });
  await check("cold start without cache remains an explicit recoverable failure", async () => {
    const p = page();
    p.loadCatalogData({ term, releaseVersion }, { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(p.data.dataLoadState, "networkError");
    assert.strictEqual(modals.length, 0);
  });
  await check("another release cannot supply the active catalog", async () => {
    const p = page();
    wx.setStorageSync(getSchoolCatalogCacheKey(term, "older-version"), catalog);
    p.loadCatalogData({ term, releaseVersion }, { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(p.data.dataLoadState, "networkError");
    assert.ok(!p.originalCatalogData);
  });
  await check("mismatched metadata inside an active cache key is rejected", async () => {
    const p = page();
    wx.setStorageSync(getSchoolCatalogCacheKey(term, releaseVersion), Object.assign({}, catalog, { version: "older-version" }));
    p.loadCatalogData({ term, releaseVersion }, { seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(p.data.dataLoadState, "networkError");
    assert.ok(!p.originalCatalogData);
  });
  await check("major selection reuses only the validated active class index", async () => {
    const p = page();
    wx.setStorageSync(releasePackService.getIndexCacheKey(term, releaseVersion, "class"), { savedAt: Date.now(), data: classIndex });
    const majors = await p.fetchMajors();
    assert.strictEqual(majors[0].code, "0101");
    assert.strictEqual(paths.length, 0, "cached class metadata should avoid a needless request");
    assert.strictEqual(p.data.classFilterError, "");
  });
  await check("filter retry only runs after an explicit user action", async () => {
    const p = page();
    p.setData({ selectedMajorIndex: -1 });
    await assert.rejects(p.fetchMajors());
    const before = paths.length;
    wx.mockRequest = (options) => {
      paths.push(new URL(options.url).pathname);
      options.success({ statusCode: 200, data: { success: true, majors: [{ code: "0101", name: "测试专业" }] } });
    };
    await p.retryClassFilters();
    assert.strictEqual(paths.length, before + 1);
    assert.strictEqual(p.data.majors[0].code, "0101");
    assert.strictEqual(p.data.classFilterError, "");
    assert.strictEqual(modals.length, 0);
  });
  if (failures.length) throw new Error(failures.length + " / " + (passed + failures.length) + " failed");
  console.log("school-network-error-ux PASS " + passed + " cases");
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
