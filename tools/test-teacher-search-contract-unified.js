#!/usr/bin/env node
const assert = require("assert");

const serverContract = require("../server/src/shared/teacherSearchContract.generated");
const miniContract = require("../miniprogram/shared/teacherSearchContract.generated");
const releaseService = require("../server/src/services/releaseService");
const releasePackService = require("../miniprogram/services/releasePackService");

function run() {
  assert.deepStrictEqual(serverContract.CONTRACT, miniContract.CONTRACT);
  assert.strictEqual(serverContract.CONTRACT.contractVersion, "teacher-search.v1");
  assert.ok(serverContract.CONTRACT.indexSchemaVersion >= 4);

  const request = {
    type: "teacher",
    keyword: " 陈芳 ",
    collegeCode: "04",
    collegeName: "动物科技学院",
    term: "2025-2026-2",
    releaseVersion: "release-v1",
    limit: 30,
  };
  assert.deepStrictEqual(serverContract.normalizeRequest(request), miniContract.normalizeRequest(request));
  assert.strictEqual(serverContract.buildCacheKey(request), miniContract.buildCacheKey(request));

  const fixture = {
    success: true,
    type: "teacher",
    term: "2025-2026-2",
    releaseVersion: "release-v1",
    items: [{
      id: "teacher-chenfang",
      name: "陈芳",
      collegeCode: "04",
      collegeName: "动物科技学院",
      courseCount: 3,
    }],
  };
  const serverResult = serverContract.normalizeResponse(fixture, request);
  const miniResult = miniContract.normalizeResponse(fixture, request);
  assert.deepStrictEqual(serverResult, miniResult);
  assert.deepStrictEqual(Object.keys(serverResult).sort(), serverContract.CONTRACT.responseFields.slice().sort());
  assert.strictEqual(serverResult.items[0].teacherName, "陈芳");
  assert.strictEqual(serverResult.teacherIndexSchemaVersion, serverContract.CONTRACT.indexSchemaVersion);
  assert.strictEqual(serverResult.cacheKey, serverContract.buildCacheKey(request));

  const indexItems = [{
    id: "teacher-chenfang",
    name: "陈芳",
    teacherName: "陈芳",
    normalizedName: "陈芳",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
  }];
  const baseOptions = {
    term: request.term,
    releaseVersion: request.releaseVersion,
    limit: 30,
  };
  const serverAnimal = releaseService.searchActiveIndex("teacher", "陈芳", Object.assign({
    _items: indexItems,
    collegeCode: "04",
  }, baseOptions));
  const serverHumanities = releaseService.searchActiveIndex("teacher", "陈芳", Object.assign({
    _items: indexItems,
    collegeCode: "07",
  }, baseOptions));
  const serverAll = releaseService.searchActiveIndex("teacher", "陈芳", Object.assign({
    _items: indexItems,
  }, baseOptions));
  assert.strictEqual(serverAnimal.total, 1, "动物科技学院应命中陈芳");
  assert.strictEqual(serverHumanities.total, 0, "人文学院不应命中陈芳");
  assert.strictEqual(serverAll.total, 1, "全校应命中陈芳");

  const miniPayload = {
    success: true,
    type: "teacher",
    term: request.term,
    releaseVersion: request.releaseVersion,
    teacherIndexSchemaVersion: serverContract.CONTRACT.indexSchemaVersion,
    items: indexItems,
  };
  const miniAnimal = releasePackService.filterIndexPayload("teacher", miniPayload, Object.assign({
    q: "陈芳",
    collegeCode: "04",
  }, baseOptions));
  const miniHumanities = releasePackService.filterIndexPayload("teacher", miniPayload, Object.assign({
    q: "陈芳",
    collegeCode: "07",
  }, baseOptions));
  const miniAll = releasePackService.filterIndexPayload("teacher", miniPayload, Object.assign({ q: "陈芳" }, baseOptions));
  assert.strictEqual(miniAnimal.total, serverAnimal.total);
  assert.strictEqual(miniHumanities.total, serverHumanities.total);
  assert.strictEqual(miniAll.total, serverAll.total);
  assert.strictEqual(miniAnimal.cacheKey, serverAnimal.cacheKey, "Agent 与全校页应使用同一语义缓存键");
  assert.deepStrictEqual(Object.keys(miniAnimal).sort(), Object.keys(serverAnimal).sort());

  console.log("test-teacher-search-contract-unified: PASS");
}

run();
