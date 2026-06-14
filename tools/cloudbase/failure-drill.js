#!/usr/bin/env node

const mockEnv = require("../mock-env");

mockEnv.clearStorage();

const staticOriginService = require("../../miniprogram/services/staticOriginService");
const releasePackService = require("../../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const releaseVersion = "failure-drill-release-2026-06-14";

function now() {
  return Date.now();
}

function manifest(source) {
  return {
    success: true,
    schemaVersion: 2,
    term,
    semester: term,
    releaseVersion,
    version: releaseVersion,
    updatedAt: "2026-06-14T00:00:00.000Z",
    cacheEpoch: 1,
    forceRefreshToken: `${releaseVersion}:1`,
    staticBaseUrl: `https://${source}.example.com/releases`,
    indexUrls: {
      class: `https://${source}.example.com/releases/${releaseVersion}/index/class/all.json`,
    },
    termConfig: {
      term,
      releaseVersion,
      termStartDate: "2026-03-09",
      semesterText: "2025-2026-2",
    },
  };
}

function classIndex(source) {
  return {
    success: true,
    term,
    releaseVersion,
    type: "class",
    items: [{
      id: "class-1",
      name: `${source}-class`,
      className: "failure drill class",
    }],
  };
}

function installNetwork(mode, calls) {
  global.wx.mockRequest = (options) => {
    const url = new URL(options.url);
    calls.push({ mode, url: options.url, host: url.hostname, at: now() });
    const isCloudbase = url.hostname === "cloud.example.com";
    const isOracle = url.hostname === "class.katelya.eu.org";
    const cloudbaseFailed = mode === "cloudbase-fail" || mode === "both-fail";
    const oracleFailed = mode === "oracle-fail" || mode === "both-fail";
    if ((isCloudbase && cloudbaseFailed) || (isOracle && oracleFailed)) {
      options.fail({ errMsg: "request:fail forced drill failure" });
      return;
    }
    if (url.pathname.endsWith("/manifest.json")) {
      options.success({ statusCode: 200, data: manifest(isCloudbase ? "cloud" : "oracle") });
      return;
    }
    if (url.pathname.endsWith("/index/class/all.json")) {
      options.success({ statusCode: 200, data: classIndex(isCloudbase ? "cloud" : "oracle") });
      return;
    }
    options.fail({ errMsg: "request:fail missing fixture" });
  };
}

async function runPath(label, mode) {
  staticOriginService.__setTestConfig({
    cloudbase: {
      CLOUDBASE_HOSTING_ENABLED: true,
      CLOUDBASE_HOSTING_READY: true,
      CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com",
    },
  });
  const calls = [];
  installNetwork(mode, calls);
  const startedAt = now();
  const result = await releasePackService.switchReleaseSafely({
    term,
    releaseVersion,
    forceNetwork: true,
    warmupTypes: ["class"],
    timeout: 50,
    retries: 0,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  const elapsedMs = now() - startedAt;
  return {
    label,
    mode,
    elapsedMs,
    success: result.success === true,
    switched: result.switched === true,
    fromStorage: result.fromStorage === true,
    releaseVersion: result.releaseVersion,
    fallbackReason: result.fallbackReason || "",
    calls: calls.map((item) => item.host),
  };
}

async function runFailureDrill() {
  staticOriginService.__setTestConfig({
    cloudbase: {
      CLOUDBASE_HOSTING_ENABLED: true,
      CLOUDBASE_HOSTING_READY: true,
      CLOUDBASE_HOSTING_BASE_URL: "https://cloud.example.com",
    },
  });
  const results = [];
  results.push(await runPath("cloudbase-primary-normal", "normal"));
  results.push(await runPath("cloudbase-forced-fail-falls-back-oracle", "cloudbase-fail"));
  results.push(await runPath("oracle-forced-fail-uses-cloudbase", "oracle-fail"));
  results.push(await runPath("both-fail-uses-last-known-good", "both-fail"));

  const last = results[results.length - 1];
  const lastGood = releasePackService.getLastKnownGood(term);
  const assertions = {
    cloudbasePrimaryNormal: results[0].calls[0] === "cloud.example.com" && results[0].success,
    cloudbaseFailureUsesOracle: results[1].calls.includes("class.katelya.eu.org") && results[1].success,
    oracleFailureUsesCloudbase: results[2].calls[0] === "cloud.example.com" && results[2].success,
    bothFailUsesLastKnownGood: last.fromStorage === true && last.releaseVersion === releaseVersion && Boolean(lastGood),
    pageNotCleared: Boolean(lastGood && lastGood.manifest && lastGood.manifest.releaseVersion),
    noInfiniteLoading: results.every((item) => Number(item.elapsedMs) < 5000),
  };
  const success = Object.values(assertions).every(Boolean);
  staticOriginService.__resetForTest();
  return { success, term, releaseVersion, assertions, results };
}

if (require.main === module) {
  runFailureDrill()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error(JSON.stringify({
        success: false,
        code: error.code || "CLOUDBASE_FAILURE_DRILL_FAILED",
        message: error.message,
      }, null, 2));
      process.exit(1);
    });
}

module.exports = {
  runFailureDrill,
};
