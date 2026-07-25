#!/usr/bin/env node
/**
 * Guard: filtered teacher search hits must never replace the full teacher index cache.
 * Regression for “only 陈芳 works on school page after one successful search”.
 */
const assert = require("assert");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "teacher-cache-poison-guard";
const fullIndex = {
  success: true,
  type: "teacher",
  term,
  semester: term,
  releaseVersion: version,
  teacherIndexSchemaVersion: 3,
  items: [
    {
      id: "t-chenfang",
      teacherName: "陈芳",
      name: "陈芳",
      collegeCode: "04",
      collegeCodes: ["04"],
      collegeName: "动物科技学院",
      collegeNames: ["动物科技学院"],
    },
    {
      id: "t-bai",
      teacherName: "白银山",
      name: "白银山",
      collegeCode: "04",
      collegeCodes: ["04"],
      collegeName: "动物科技学院",
      collegeNames: ["动物科技学院"],
    },
    {
      id: "t-cai",
      teacherName: "蔡晨晖",
      name: "蔡晨晖",
      collegeCode: "02",
      collegeCodes: ["02"],
      collegeName: "物理与光电工程学院",
      collegeNames: ["物理与光电工程学院"],
    },
  ],
};

global.wx.setStorageSync(releasePackService.LOCAL_ACTIVE_RELEASE_KEY, {
  savedAt: Date.now(),
  term,
  releaseVersion: version,
  manifest: {
    success: true,
    term,
    releaseVersion: version,
    teacherIndexSchemaVersion: 3,
    indexUrls: {
      teacher: `https://class.katelya.eu.org/static/releases/${version}/index/teacher/all.json`,
    },
  },
});

let serverCalls = 0;
global.wx.mockRequest = (options) => {
  const url = String(options.url || "");
  if (url.includes(`/static/releases/${version}/index/teacher/all.json`)) {
    setTimeout(() => options.success({ statusCode: 200, data: fullIndex }), 1);
    return;
  }
  if (url.includes("/api/fosu/search-index")) {
    serverCalls += 1;
    // Poison payload: only the queried name (what a filtered server response looks like)
    const q = (() => {
      try {
        return new URL(url, "https://class.katelya.eu.org").searchParams.get("q") || "陈芳";
      } catch (e) {
        return "陈芳";
      }
    })();
    const hit = fullIndex.items.filter((i) => i.name === q);
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "teacher",
        term,
        releaseVersion: version,
        teacherIndexSchemaVersion: 3,
        items: hit,
        total: hit.length,
      },
    }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected ${url}` }), 1);
};

async function run() {
  // Search 陈芳 first (historical poison path)
  const first = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    q: "陈芳",
  }, { forceNetwork: true, retries: 0, skipFallback: true });
  assert.strictEqual(first.total, 1);
  assert.strictEqual(first.items[0].name, "陈芳");

  // Full index cache must still contain all teachers (not just 陈芳)
  const cached = releasePackService.readCachedIndex("teacher", { term, releaseVersion: version });
  assert.ok(cached, "full index should be cached after loadIndex");
  assert.ok((cached.items || []).length >= 3, `full index poisoned? count=${(cached.items || []).length}`);

  // Subsequent searches still work for other teachers
  const bai = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    q: "白银山",
  }, { forceNetwork: false, retries: 0, skipFallback: true, allowServerFallback: false });
  assert.strictEqual(bai.total, 1, "白银山 must still hit after 陈芳 search");
  assert.strictEqual(bai.items[0].name, "白银山");

  const college = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    q: "蔡",
    collegeCode: "02",
  }, {
    forceNetwork: false,
    retries: 0,
    skipFallback: true,
    // Prefer local full index for this unit (mock server only exact-matches q)
    preferServerSearch: false,
    allowServerFallback: false,
  });
  assert.strictEqual(college.total, 1, "蔡+college 02 should hit 蔡晨晖 via local filter");
  assert.strictEqual(college.items[0].name, "蔡晨晖");

  const wrongCollege = await releasePackService.searchIndex("teacher", {
    term,
    releaseVersion: version,
    q: "陈芳",
    collegeCode: "02",
  }, {
    forceNetwork: false,
    retries: 0,
    skipFallback: true,
    preferServerSearch: false,
    allowServerFallback: false,
  });
  assert.strictEqual(wrongCollege.total, 0, "陈芳 not in college 02");

  console.log("test-teacher-index-cache-no-poison passed", { serverCalls });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
