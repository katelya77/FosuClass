"use strict";
const assert = require("assert");
const mock = require("./mock-env");
const service = require("../miniprogram/services/releasePackService");
const origin = require("../miniprogram/services/staticOriginService");
const term = "2026-2027-1", version = "fixture-static-search";
async function main() {
  let count = 0;
  for (const type of ["class", "teacher", "classroom", "course"]) {
    mock.clearStorage(); service.__resetForTest();
    origin.__setTestConfig({ cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true } });
    const key = { class: "className", teacher: "teacherName", classroom: "roomName", course: "courseName" }[type];
    const items = [{ id: type + "-one", name: "测试" + type, [key]: "测试" + type, semester: term, collegeCode: "fixture", collegeCodes: ["fixture"], grade: "2026", majorCode: "fixture-major", campus: "测试校区" }];
    const calls = [];
    global.wx.mockRequest = (options) => {
      calls.push(options.url);
      setTimeout(() => options.success({ statusCode: 200, data: { success: true, type, term, releaseVersion: version, teacherIndexSchemaVersion: 4, items } }), 1);
    };
    const query = { term, releaseVersion: version, q: "测试" };
    const first = await service.searchSchoolContract(type, query);
    assert.equal(first.total, 1); assert.equal(first.decision.detailId, type + "-one");
    assert.ok(calls[0].startsWith("https://cloud.example.com/"));
    assert.ok(calls.every((url) => !url.includes("/api/")));
    const before = calls.length;
    const cached = await service.searchSchoolContract(type, query);
    assert.equal(cached.fromStorage, true); assert.equal(calls.length, before);
    const noMatch = await service.searchSchoolContract(type, Object.assign({}, query, { q: "不存在" }));
    assert.equal(noMatch.total, 0); assert.equal(calls.length, before);
    if (type === "class") {
      assert.equal((await service.searchSchoolContract(type, Object.assign({}, query, { grade: "2025" }))).total, 0);
      assert.equal((await service.searchSchoolContract(type, Object.assign({}, query, { collegeCode: "fixture", grade: "2026", majorCode: "fixture-major" }))).total, 1);
    }
    mock.clearStorage(); service.__resetForTest(); origin.__resetForTest();
    origin.__setTestConfig({ cloudbase: { CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com", CLOUDBASE_HOSTING_READY: true } });
    const fallbackCalls = [];
    global.wx.mockRequest = (options) => {
      fallbackCalls.push(options.url);
      setTimeout(() => options.url.startsWith("https://cloud.example.com/") ? options.fail({ errMsg: "fixture timeout" }) : options.success({ statusCode: 200, data: { success: true, type, term, releaseVersion: version, teacherIndexSchemaVersion: 4, items } }), 1);
    };
    const fallback = await service.searchSchoolContract(type, query);
    assert.equal(fallback.total, 1); assert.ok(fallbackCalls.some((url) => url.startsWith("https://class.katelya.eu.org/")));
    assert.ok(fallbackCalls.every((url) => !url.includes("/api/")));
    count++;
  }
  console.log("school-static-search: " + count + " types PASS (CloudBase first, Oracle static fallback, cache, filters, query isolation; fixtures)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
