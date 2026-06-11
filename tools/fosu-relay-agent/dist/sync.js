var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../fosu-sync-client/diagnose.js
var require_diagnose = __commonJS({
  "../fosu-sync-client/diagnose.js"(exports2, module2) {
    var dns = require("dns").promises;
    var axios2 = require("axios");
    require("dotenv").config();
    var FOSU_BASE_URL2 = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
    var FOSU_AUTH_URL = process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn";
    function isInternalIp(ip) {
      if (!ip) return false;
      if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
      if (ip.startsWith("172.")) {
        const parts = ip.split(".").map(Number);
        if (parts.length >= 2) {
          return parts[1] >= 16 && parts[1] <= 31;
        }
      }
      return ip.startsWith("172.");
    }
    async function diagnose2() {
      console.log("=== \u5F00\u59CB\u8BCA\u65AD\u4F5B\u5927\u6559\u52A1\u7F51\u8FDE\u63A5\u72B6\u6001 ===");
      console.log(`\u76EE\u6807\u6559\u52A1\u7F51: ${FOSU_BASE_URL2}`);
      console.log(`\u76EE\u6807\u7EDF\u4E00\u8BA4\u8BC1: ${FOSU_AUTH_URL}`);
      let hostname;
      try {
        hostname = new URL(FOSU_BASE_URL2).hostname;
      } catch (e2) {
        console.error(`\u274C FOSU_BASE_URL \u683C\u5F0F\u4E0D\u6B63\u786E: ${e2.message}`);
        process.exit(1);
      }
      console.log(`
1. \u6B63\u5728\u89E3\u6790 DNS: ${hostname} ...`);
      let addresses = [];
      let easyConnectLikelyConnected = false;
      try {
        const result = await dns.lookup(hostname, { all: true });
        addresses = result.map((r) => r.address);
        console.log(`   \u89E3\u6790\u6210\u529F\uFF01\u89E3\u6790\u5230\u4EE5\u4E0B IP \u5730\u5740:`);
        addresses.forEach((addr) => {
          const isInternal = isInternalIp(addr);
          if (isInternal) {
            easyConnectLikelyConnected = true;
          }
          console.log(`   - ${addr} [${isInternal ? "\u6821\u5185\u5185\u7F51 IP" : "\u5916\u7F51/\u516C\u7F51 IP"}]`);
        });
      } catch (error) {
        console.error(`\u274C DNS \u89E3\u6790\u5931\u8D25: ${error.message}`);
        console.log(`\u26A0\uFE0F  \u63D0\u793A: \u65E0\u6CD5\u89E3\u6790\u57DF\u540D\u3002\u8BF7\u5148\u8FDE\u63A5\u201C\u4F5B\u5927 EasyConnect\u201D\u6216\u8EAB\u5904\u201C\u4F5B\u5927\u6821\u56ED\u7F51\u201D\u73AF\u5883\u5185\u518D\u8BD5\uFF01`);
        return false;
      }
      if (!easyConnectLikelyConnected) {
        console.warn(`\u26A0\uFE0F  \u8B66\u544A: DNS \u89E3\u6790\u6210\u529F\u4F46\u672A\u5339\u914D\u5230\u6821\u5185\u5185\u7F51 IP \u8303\u56F4\u3002`);
      }
      console.log(`
2. \u6B63\u5728\u5C1D\u8BD5\u901A\u8FC7 Node.js \u8BBF\u95EE HTTPS ${FOSU_BASE_URL2} ...`);
      let httpsSuccess = false;
      let tlsHandshakeFailed = false;
      try {
        const response = await axios2.get(FOSU_BASE_URL2, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpsSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpsSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTPS \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
          const errStr = (error.message || "") + (error.code || "");
          if (errStr.includes("TLS") || errStr.includes("handshake") || errStr.includes("SSL") || errStr.includes("disconnected") || error.code === "ECONNRESET") {
            tlsHandshakeFailed = true;
          }
        }
      }
      let httpSuccess = false;
      const httpUrl = FOSU_BASE_URL2.replace(/^https:/i, "http:");
      console.log(`
3. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE HTTP \u7AEF\u53E3 ${httpUrl} ...`);
      try {
        const response = await axios2.get(httpUrl, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTP \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
        }
      }
      console.log(`
4. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1 ${FOSU_AUTH_URL} ...`);
      let authSuccess = false;
      try {
        await axios2.get(FOSU_AUTH_URL, {
          timeout: 8e3
        });
        console.log(`   \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u54CD\u5E94\u6B63\u5E38\u3002`);
        authSuccess = true;
      } catch (error) {
        console.log(`\u26A0\uFE0F  \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u8BBF\u95EE\u8B66\u544A (\u53EF\u80FD\u4E0D\u5F71\u54CD\u4F7F\u7528): ${error.message}`);
      }
      console.log(`
===================================`);
      if (httpsSuccess || httpSuccess) {
        console.log(`\u{1F389} \u8BCA\u65AD\u7ED3\u679C: \u672C\u673A\u6821\u5185\u7F51\u73AF\u5883\u6B63\u5E38\uFF01\u5DF2\u6210\u529F\u8FDE\u63A5\u5230\u6559\u52A1\u7F51\u3002`);
        console.log(`\u60A8\u53EF\u4EE5\u7EE7\u7EED\u8FD0\u884C 'npm run login' \u8FDB\u884C\u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected && tlsHandshakeFailed) {
        console.log(`\u2139\uFE0F  [NODE_TLS_HANDSHAKE_FAILED]`);
        console.log(`\u63D0\u793A: Node.js \u4E0E\u5B66\u6821\u5185\u7F51 HTTPS \u670D\u52A1\u63E1\u624B\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185 IP\uFF0C\u53EF\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u6D4F\u89C8\u5668\u767B\u5F55\u3002`);
        console.log(`\u8BF7\u8FD0\u884C 'npm run login'\uFF0CPlaywright \u6D4F\u89C8\u5668\u80FD\u591F\u5FFD\u7565\u6B64 TLS \u63E1\u624B\u95EE\u9898\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected) {
        console.log(`\u2139\uFE0F  \u63D0\u793A: \u867D\u7136 Node.js \u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185\u5185\u7F51 IP\uFF0C\u5141\u8BB8\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      console.error(`\u274C \u8BCA\u65AD\u7ED3\u679C: \u65E0\u6CD5\u8FDE\u63A5\u5230\u5B66\u6821\u6559\u52A1\u7F51\uFF01`);
      console.log(`\u{1F4A1} \u63D0\u793A: \u8BF7\u5148\u786E\u8BA4\u5DF2\u542F\u52A8\u5E76\u6210\u529F\u8FDE\u63A5\u4E86 EasyConnect VPN\u3002`);
      console.log(`===================================`);
      return false;
    }
    if (require.main === module2) {
      diagnose2().then((success) => {
        process.exit(success ? 0 : 1);
      });
    }
    module2.exports = diagnose2;
  }
});

// ../../server/src/shared/syncPlan.js
var require_syncPlan = __commonJS({
  "../../server/src/shared/syncPlan.js"(exports2, module2) {
    "use strict";
    var ALL_SCOPES2 = Object.freeze([
      "classSchedules",
      "teacherSchedules",
      "classroomSchedules",
      "courseSchedules",
      "classrooms",
      "teachers",
      "courses"
    ]);
    var DYNAMIC_SCOPES = Object.freeze([
      "classSchedules",
      "teacherSchedules",
      "classroomSchedules",
      "courseSchedules"
    ]);
    var SOURCE_MODES = Object.freeze([
      "network-direct",
      "derived-current-run",
      "cache-explicit",
      "imported",
      "contributed"
    ]);
    var CATALOG_POLICIES = Object.freeze(["network-only", "reuse-validated", "cache-only"]);
    var SCHEDULE_POLICIES = Object.freeze(["network-only", "cache-only"]);
    var PROGRESS_POLICIES = Object.freeze(["ignore", "resume"]);
    var NEGATIVE_CACHE_POLICIES = Object.freeze(["ignore", "use", "revalidate"]);
    var LEGACY_ACTIONS = Object.freeze({
      fresh: "sync:daily",
      quick: "sync:daily",
      all: "sync:daily",
      release: "sync:daily",
      resources: "sync:scopes",
      "upload-cache": "sync:upload-staging",
      "local-upload": "sync:upload-staging"
    });
    function parseCliArgs2(argv) {
      const args = Array.isArray(argv) ? argv : [];
      let action = "all";
      const params = {};
      args.forEach((arg) => {
        if (typeof arg !== "string") return;
        if (arg.startsWith("--")) {
          const match2 = arg.match(/^--([^=]+)=(.*)$/);
          if (match2) {
            params[match2[1]] = match2[2];
          } else {
            params[arg.slice(2)] = true;
          }
        } else if (!arg.startsWith("-")) {
          action = arg;
        }
      });
      return { action, params };
    }
    function validateTermId2(term) {
      const value = String(term || "").trim();
      const match2 = value.match(/^(\d{4})-(\d{4})-([12])$/);
      return {
        valid: Boolean(match2 && Number(match2[2]) === Number(match2[1]) + 1),
        term: value
      };
    }
    function parseList(value) {
      if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
      return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    }
    function normalizeScope(scope) {
      const aliases = {
        classes: "classSchedules",
        class: "classSchedules",
        teachers: "teacherSchedules",
        teacher: "teacherSchedules",
        classrooms: "classroomSchedules",
        classroom: "classroomSchedules",
        courses: "courseSchedules",
        course: "courseSchedules"
      };
      const value = String(scope || "").trim();
      return aliases[value] || value;
    }
    function expandScopeCompanions(scopes) {
      const result = new Set(scopes || []);
      if (result.has("teacherSchedules")) result.add("teachers");
      if (result.has("classroomSchedules")) result.add("classrooms");
      if (result.has("courseSchedules")) result.add("courses");
      return Array.from(result);
    }
    function getDynamicScopes(scopes) {
      const set = new Set(scopes || []);
      return DYNAMIC_SCOPES.filter((scope) => set.has(scope));
    }
    function getResourceTypesFromScopes(scopes) {
      const set = new Set(scopes || []);
      const types = [];
      if (set.has("teacherSchedules") || set.has("teachers")) types.push("teacher");
      if (set.has("classroomSchedules") || set.has("classrooms")) types.push("classroom");
      if (set.has("courseSchedules") || set.has("courses")) types.push("course");
      return types;
    }
    function includeClassSeedForResourceScopes(scopes, profile) {
      if (profile === "upload-staging" || profile === "resume") return scopes;
      const next = new Set(scopes || []);
      const needsCurrentRunSeed = next.has("teacherSchedules") || next.has("classroomSchedules") || next.has("courseSchedules");
      if (needsCurrentRunSeed) next.add("classSchedules");
      return Array.from(next);
    }
    function boolParam(params, names, fallback) {
      const list = Array.isArray(names) ? names : [names];
      for (const name of list) {
        if (params[name] === true || params[name] === "true" || params[name] === "1") return true;
        if (params[name] === false || params[name] === "false" || params[name] === "0") return false;
      }
      return Boolean(fallback);
    }
    function normalizePolicy(value, allowed, fallback) {
      const raw2 = String(value || "").trim();
      return allowed.includes(raw2) ? raw2 : fallback;
    }
    function profileForAction(action) {
      const normalized = String(action || "").trim();
      const map = {
        daily: "daily",
        "daily:classes": "daily-classes",
        "daily:teachers": "daily-teachers",
        "daily:classrooms": "daily-classrooms",
        "daily:courses": "daily-courses",
        scopes: "scopes",
        "new-term": "new-term",
        "crawl:daily": "crawl-daily",
        "crawl:scopes": "crawl-scopes",
        "upload-staging": "upload-staging",
        resume: "resume"
      };
      return map[normalized] || normalized;
    }
    function defaultScopesForProfile(profile, params) {
      if (profile === "daily") return ALL_SCOPES2.slice();
      if (profile === "daily-classes") return ALL_SCOPES2.slice();
      if (profile === "daily-teachers") return ["teacherSchedules", "teachers"];
      if (profile === "daily-classrooms") return ["classroomSchedules", "classrooms"];
      if (profile === "daily-courses") return ["courseSchedules", "courses"];
      if (profile === "new-term") return ALL_SCOPES2.slice();
      if (profile === "crawl-daily") return ALL_SCOPES2.slice();
      if (profile === "scopes" || profile === "crawl-scopes") {
        const include = parseList(params.include).map(normalizeScope);
        return expandScopeCompanions(include.length ? include : DYNAMIC_SCOPES);
      }
      if (profile === "upload-staging") return [];
      if (profile === "resume") return [];
      return ALL_SCOPES2.slice();
    }
    function defaultScopeSources(scopes, params, profile) {
      const allowDerived = boolParam(params, "allow-derived", false);
      const sourceModeParam = String(params["resource-source"] || params.resourceSource || "").trim().toLowerCase();
      const directRequested = sourceModeParam === "direct" || sourceModeParam === "network-direct";
      const sources = {};
      (scopes || []).forEach((scope) => {
        if (scope === "classSchedules") {
          sources[scope] = {
            mode: "network-direct",
            endpointFamily: "class-schedule"
          };
        } else if (profile === "daily-classes" && DYNAMIC_SCOPES.includes(scope)) {
          sources[scope] = {
            mode: "derived-current-run",
            endpointFamily: "class-schedule"
          };
        } else if (scope === "teacherSchedules") {
          sources[scope] = {
            mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
            endpointFamily: directRequested || !allowDerived ? "teacher-schedule" : "class-schedule"
          };
        } else if (scope === "classroomSchedules") {
          sources[scope] = {
            mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
            endpointFamily: directRequested || !allowDerived ? "classroom-schedule" : "class-schedule"
          };
        } else if (scope === "courseSchedules") {
          sources[scope] = {
            mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
            endpointFamily: directRequested || !allowDerived ? "course-schedule" : "class-schedule"
          };
        }
      });
      return sources;
    }
    function buildSyncPlan2(action, params = {}, env = process.env) {
      const rawAction = String(action || "all");
      const deprecatedTarget = LEGACY_ACTIONS[rawAction] || "";
      const effectiveAction = deprecatedTarget ? deprecatedTarget.replace(/^sync:/, "") : rawAction;
      const profile = profileForAction(effectiveAction);
      const isUploadOnly = profile === "upload-staging";
      const isResume = profile === "resume";
      const isCrawlOnly = profile === "crawl-daily" || profile === "crawl-scopes";
      const isNewTerm = profile === "new-term";
      const term = String(params.term || params.semester || env.PREFERRED_SEMESTER || "").trim();
      const scopes = includeClassSeedForResourceScopes(
        expandScopeCompanions(defaultScopesForProfile(profile, params)),
        profile
      );
      const dynamicScopes = getDynamicScopes(scopes);
      const catalogPolicy = normalizePolicy(
        params["catalog-policy"] || params.catalogPolicy,
        CATALOG_POLICIES,
        isNewTerm ? "network-only" : isUploadOnly || isResume ? "cache-only" : "reuse-validated"
      );
      const schedulePolicy = normalizePolicy(
        params["schedule-policy"] || params.schedulePolicy,
        SCHEDULE_POLICIES,
        isUploadOnly ? "cache-only" : "network-only"
      );
      const progressPolicy = normalizePolicy(
        params["progress-policy"] || params.progressPolicy,
        PROGRESS_POLICIES,
        isResume ? "resume" : "ignore"
      );
      const negativeCachePolicy = normalizePolicy(
        params["negative-cache-policy"] || params.negativeCachePolicy,
        NEGATIVE_CACHE_POLICIES,
        "ignore"
      );
      const upload = !isCrawlOnly && !boolParam(params, ["no-upload"], false) && !isResume;
      const buildRelease = upload && !isUploadOnly && !boolParam(params, ["no-publish", "crawl-only"], false);
      const activate = isNewTerm ? boolParam(params, "activate", false) : buildRelease && !boolParam(params, ["no-activate"], false);
      const plan = {
        schemaVersion: 1,
        action: rawAction,
        mappedAction: effectiveAction,
        profile,
        term,
        termValid: validateTermId2(term).valid,
        runId: String(params["run-id"] || params.runId || `${profile}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
        deprecated: Boolean(deprecatedTarget),
        deprecatedTarget,
        scopes,
        dynamicScopes,
        resourceTypes: getResourceTypesFromScopes(scopes),
        catalogPolicy,
        schedulePolicy,
        progressPolicy,
        negativeCachePolicy,
        mergeOldData: boolParam(params, "merge-old-data", false),
        crawl: !isUploadOnly,
        upload,
        buildRelease,
        activate,
        verifyClient: buildRelease && !boolParam(params, ["no-verify-client"], false),
        allowPartial: boolParam(params, "allow-partial", false),
        allowDerived: boolParam(params, "allow-derived", false),
        forceRefresh: schedulePolicy === "network-only" && !isUploadOnly,
        ignoreProgress: progressPolicy === "ignore",
        ignoreNoScheduleCache: negativeCachePolicy === "ignore",
        cacheOnlyExplicit: schedulePolicy === "cache-only" || catalogPolicy === "cache-only",
        filters: {
          grades: parseList(params.grades || env.SYNC_CLASS_GRADES || env.SYNC_GRADES),
          collegeCodes: parseList(params["college-codes"] || env.SYNC_CLASS_COLLEGE_CODES),
          majorCodes: parseList(params["major-codes"] || env.SYNC_CLASS_MAJOR_CODES)
        },
        termConfig: {
          term,
          termStartDate: String(params["term-start-date"] || params.start || env.SYNC_TERM_START_DATE || "").trim(),
          totalWeeks: params["total-weeks"] ? Number(params["total-weeks"]) : env.SYNC_TOTAL_WEEKS ? Number(env.SYNC_TOTAL_WEEKS) : 0,
          weekStart: String(params["week-start"] || env.SYNC_WEEK_START || "monday").trim().toLowerCase()
        },
        sourceRequirements: defaultScopeSources(scopes, params, profile),
        warnings: []
      };
      if (plan.deprecated) {
        plan.warnings.push(`Deprecated command '${rawAction}' mapped to '${deprecatedTarget}'.`);
      }
      if (/\b(fresh|daily|crawl|sync)\b/.test(rawAction) && schedulePolicy === "cache-only" && !isUploadOnly) {
        plan.warnings.push("Cache-only is explicit and should not be used for fresh/daily/crawl actions.");
      }
      if (isNewTerm) {
        if (!plan.termConfig.termStartDate) plan.warnings.push("new-term requires --term-start-date.");
        if (!plan.termConfig.totalWeeks) plan.warnings.push("new-term requires --total-weeks.");
      }
      return plan;
    }
    function applyPlanToParams2(plan, params = {}) {
      const next = Object.assign({}, params);
      next.term = plan.term || next.term;
      next.includeScopes = plan.scopes.slice();
      next.forceRefresh = Boolean(plan.forceRefresh);
      next.fresh = Boolean(plan.forceRefresh);
      next.ignoreProgress = Boolean(plan.ignoreProgress);
      next.ignoreNoScheduleCache = Boolean(plan.ignoreNoScheduleCache);
      next.mergeOldData = Boolean(plan.mergeOldData);
      next.crawlMode = plan.schedulePolicy === "network-only" ? "full-fresh" : "cache-only";
      next.freshRunId = plan.runId;
      next.catalogPolicy = plan.catalogPolicy;
      next.schedulePolicy = plan.schedulePolicy;
      next.progressPolicy = plan.progressPolicy;
      next.negativeCachePolicy = plan.negativeCachePolicy;
      next.resourceSource = plan.profile === "daily-classes" || plan.allowDerived ? "derived" : "direct";
      next.allowDerived = plan.allowDerived;
      next.allowPartial = plan.allowPartial;
      next["term-start-date"] = next["term-start-date"] || plan.termConfig.termStartDate;
      next["total-weeks"] = next["total-weeks"] || (plan.termConfig.totalWeeks || "");
      next["week-start"] = next["week-start"] || plan.termConfig.weekStart;
      return next;
    }
    function printablePlan2(plan) {
      return {
        term: plan.term,
        profile: plan.profile,
        scopes: plan.scopes,
        catalogPolicy: plan.catalogPolicy,
        schedulePolicy: plan.schedulePolicy,
        progressPolicy: plan.progressPolicy,
        negativeCachePolicy: plan.negativeCachePolicy,
        mergeOldData: plan.mergeOldData,
        crawl: plan.crawl,
        upload: plan.upload,
        buildRelease: plan.buildRelease,
        activate: plan.activate,
        verifyClient: plan.verifyClient,
        allowPartial: plan.allowPartial,
        allowDerived: plan.allowDerived,
        runId: plan.runId,
        sourceRequirements: plan.sourceRequirements,
        filters: plan.filters,
        warnings: plan.warnings
      };
    }
    function renderPowerShellCommand(task, options = {}) {
      const term = options.term || "2025-2026-2";
      const start = options.termStartDate || options.start || "YYYY-MM-DD";
      const weeks = options.totalWeeks || "TOTAL_WEEKS";
      const scopes = Array.isArray(options.scopes) && options.scopes.length ? options.scopes.join(",") : "classSchedules,teacherSchedules,classroomSchedules,courseSchedules";
      const base = `npm run ${task}`;
      if (task === "sync:new-term") {
        return `${base} -- --term=${term} --term-start-date=${start} --total-weeks=${weeks} --week-start=${options.weekStart || "monday"}`;
      }
      if (task === "sync:scopes" || task === "crawl:scopes") {
        return `${base} -- --term=${term} --include=${scopes}`;
      }
      if (task === "sync:upload-staging") {
        return `$file = (Resolve-Path ".\\staging\\${term}-full.json").Path
${base} -- --file="$file" --term=${term}`;
      }
      if (task === "sync:resume") {
        return `${base} -- --run-id=${options.runId || "RUN_ID"}`;
      }
      return `${base} -- --term=${term}`;
    }
    var OPERATION_ZH = Object.freeze({
      "sync:daily": ["\u65E5\u5E38\u540C\u6B65\uFF1A\u5168\u90E8\u52A8\u6001\u8BFE\u8868", "\u65E5\u5E38\u5168\u6821\u52A8\u6001\u8BFE\u8868\u66F4\u65B0"],
      "sync:daily:classes": ["\u65E5\u5E38\u540C\u6B65\uFF1A\u73ED\u7EA7\u8BFE\u8868", "\u73ED\u7EA7\u8BFE\u8868\u53D8\u5316\u540C\u6B65"],
      "sync:daily:teachers": ["\u65E5\u5E38\u540C\u6B65\uFF1A\u6559\u5E08\u8BFE\u8868", "\u6559\u5E08\u7EF4\u5EA6\u8BFE\u8868\u5237\u65B0"],
      "sync:daily:classrooms": ["\u65E5\u5E38\u540C\u6B65\uFF1A\u6559\u5BA4\u8BFE\u8868", "\u6559\u5BA4\u7EF4\u5EA6\u8BFE\u8868\u5237\u65B0"],
      "sync:daily:courses": ["\u65E5\u5E38\u540C\u6B65\uFF1A\u8BFE\u7A0B\u8BFE\u8868", "\u8BFE\u7A0B\u7EF4\u5EA6\u8BFE\u8868\u5237\u65B0"],
      "sync:scopes": ["\u81EA\u5B9A\u4E49\u540C\u6B65\u8303\u56F4", "\u6309\u52FE\u9009\u8303\u56F4\u6267\u884C\u53D7\u63A7\u5237\u65B0"],
      "sync:new-term": ["\u65B0\u5B66\u671F\u5168\u91CF\u91C7\u96C6", "\u65B0\u5B66\u671F\u9996\u8F6E\u5168\u91CF\u5EFA\u6863"],
      "sync:upload-staging": ["\u4E0A\u4F20\u672C\u5730\u6682\u5B58\u6587\u4EF6", "\u4E0A\u4F20\u5DF2\u751F\u6210\u7684 Staging JSON"],
      "sync:resume": ["\u6062\u590D\u4E2D\u65AD\u4EFB\u52A1", "\u7EE7\u7EED\u6307\u5B9A runId \u7684\u4E2D\u65AD\u4EFB\u52A1"]
    });
    function riskDisplay(risk) {
      return {
        low: "\u4F4E",
        medium: "\u4E2D",
        high: "\u9AD8"
      }[risk] || risk || "\u4E2D";
    }
    function requestScaleDisplay(code) {
      return {
        "full-campus": "\u5168\u6821\u8303\u56F4",
        "scope-dependent": "\u6309\u540C\u6B65\u8303\u56F4"
      }[code] || code || "\u6309\u540C\u6B65\u8303\u56F4";
    }
    function getRecommendedOperations2(options = {}) {
      const term = options.term || "2025-2026-2";
      const termStartDate = options.termStartDate || "YYYY-MM-DD";
      const totalWeeks = options.totalWeeks || "TOTAL_WEEKS";
      const operations = [
        ["sync:daily", "daily_all_dynamic", true, true, false, true, true, true, "medium", "daily_all"],
        ["sync:daily:classes", "daily_classes", true, true, false, true, true, true, "medium", "class_changes"],
        ["sync:daily:teachers", "daily_teachers", true, true, false, true, true, true, "medium", "teacher_refresh"],
        ["sync:daily:classrooms", "daily_classrooms", true, true, false, true, true, true, "medium", "classroom_refresh"],
        ["sync:daily:courses", "daily_courses", true, true, false, true, true, true, "medium", "course_refresh"],
        ["sync:scopes", "selected_scopes", true, true, false, true, true, true, "medium", "controlled_partial"],
        ["sync:new-term", "new_term_full", true, false, false, true, true, false, "high", "new_semester"],
        ["sync:upload-staging", "upload_staging", false, false, true, true, false, false, "low", "upload_file"],
        ["sync:resume", "resume_run", true, true, false, true, true, true, "medium", "resume_run"]
      ];
      return operations.map(([id, name, intranetRequired, catalogCache, dynamicCache, upload, publish, activate, risk, scene]) => {
        const zh = OPERATION_ZH[id] || [name, scene];
        const estimatedRequestsCode = id === "sync:new-term" || id === "sync:daily" ? "full-campus" : "scope-dependent";
        return {
          id,
          name: zh[0],
          nameEn: name,
          displayName: zh[0],
          displayScene: zh[1],
          intranetRequired,
          usesCatalogCache: catalogCache,
          usesDynamicCache: dynamicCache,
          upload,
          publish,
          activate,
          risk,
          riskDisplay: riskDisplay(risk),
          estimatedRequests: requestScaleDisplay(estimatedRequestsCode),
          estimatedRequestsCode,
          estimatedDuration: intranetRequired ? "8-30 min" : "15-60 sec",
          scene,
          sceneCode: scene,
          command: renderPowerShellCommand(id, { term, termStartDate, totalWeeks })
        };
      });
    }
    module2.exports = {
      ALL_SCOPES: ALL_SCOPES2,
      CATALOG_POLICIES,
      DYNAMIC_SCOPES,
      LEGACY_ACTIONS,
      NEGATIVE_CACHE_POLICIES,
      PROGRESS_POLICIES,
      SCHEDULE_POLICIES,
      SOURCE_MODES,
      applyPlanToParams: applyPlanToParams2,
      buildSyncPlan: buildSyncPlan2,
      expandScopeCompanions,
      getDynamicScopes,
      getRecommendedOperations: getRecommendedOperations2,
      getResourceTypesFromScopes,
      parseCliArgs: parseCliArgs2,
      printablePlan: printablePlan2,
      renderPowerShellCommand,
      validateTermId: validateTermId2
    };
  }
});

// ../../shared/syncPlan.js
var require_syncPlan2 = __commonJS({
  "../../shared/syncPlan.js"(exports2, module2) {
    "use strict";
    module2.exports = require_syncPlan();
  }
});

// ../../shared/syncCacheStore.js
var require_syncCacheStore = __commonJS({
  "../../shared/syncCacheStore.js"(exports2, module2) {
    "use strict";
    var crypto2 = require("crypto");
    var fs2 = require("fs");
    var path2 = require("path");
    var SCHEDULE_DIR_BY_SCOPE = Object.freeze({
      classSchedules: "class",
      teacherSchedules: "teacher",
      classroomSchedules: "classroom",
      courseSchedules: "course"
    });
    function safeTerm(term) {
      return String(term || "").trim().replace(/[^0-9A-Za-z._-]/g, "_") || "unknown-term";
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function cacheRoot(baseDir, term) {
      return path2.join(baseDir, ".cache", safeTerm(term));
    }
    function ensureTermCache(baseDir, term) {
      const root = cacheRoot(baseDir, term);
      [
        "catalog",
        "progress",
        "negative",
        "staging",
        "reports",
        path2.join("schedules", "class"),
        path2.join("schedules", "teacher"),
        path2.join("schedules", "classroom"),
        path2.join("schedules", "course")
      ].forEach((segment) => ensureDir(path2.join(root, segment)));
      return root;
    }
    function hashJson(value) {
      return crypto2.createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs2.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      try {
        if (process.platform === "win32" && fs2.existsSync(filePath)) {
          try {
            fs2.unlinkSync(filePath);
          } catch (error) {
          }
        }
        fs2.renameSync(tmp, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        try {
          fs2.unlinkSync(tmp);
        } catch (cleanupError) {
        }
      }
    }
    function readJson(filePath, fallback) {
      if (!filePath || !fs2.existsSync(filePath)) return fallback;
      try {
        return JSON.parse(fs2.readFileSync(filePath, "utf-8"));
      } catch (error) {
        return fallback;
      }
    }
    function scheduleDir(baseDir, term, scope) {
      const kind = SCHEDULE_DIR_BY_SCOPE[scope] || scope;
      return path2.join(ensureTermCache(baseDir, term), "schedules", kind);
    }
    function scheduleLatestPath(baseDir, term, scope) {
      return path2.join(scheduleDir(baseDir, term, scope), "latest.json");
    }
    function scheduleMetadataPath(baseDir, term, scope) {
      return path2.join(scheduleDir(baseDir, term, scope), "metadata.json");
    }
    function buildMetadata(input = {}) {
      const itemCount = Number(input.itemCount || (Array.isArray(input.items) ? input.items.length : 0));
      const items2 = input.items === void 0 ? null : input.items;
      return {
        schemaVersion: 1,
        term: String(input.term || ""),
        scope: String(input.scope || ""),
        source: input.source || "100.fosu.edu.cn",
        acquisition: input.acquisition || "network",
        sourceMode: input.sourceMode || "network-direct",
        endpointFamily: input.endpointFamily || "",
        crawledAt: input.crawledAt || (/* @__PURE__ */ new Date()).toISOString(),
        command: input.command || "",
        runId: input.runId || "",
        itemCount,
        hash: input.hash || hashJson(items2),
        sessionFingerprint: input.sessionFingerprint || "",
        fresh: input.fresh !== false,
        partial: Boolean(input.partial),
        cacheHits: Number(input.cacheHits || 0),
        requested: Number(input.requested || itemCount),
        succeeded: Number(input.succeeded || itemCount),
        failed: Number(input.failed || 0),
        derived: Number(input.derived || 0)
      };
    }
    function writeScheduleLatest(baseDir, term, scope, items2, metadataInput = {}) {
      const dir = scheduleDir(baseDir, term, scope);
      const runId = metadataInput.runId || `run-${Date.now()}`;
      const payload = {
        success: true,
        type: scope,
        semester: term,
        term,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        itemCount: Array.isArray(items2) ? items2.length : 0,
        items: Array.isArray(items2) ? items2 : []
      };
      const metadata = buildMetadata(Object.assign({}, metadataInput, {
        term,
        scope,
        items: payload.items,
        itemCount: payload.itemCount
      }));
      const runDir = path2.join(dir, "runs");
      ensureDir(runDir);
      writeJsonAtomic(path2.join(runDir, `${runId}.json`), payload);
      writeJsonAtomic(path2.join(runDir, `${runId}.meta.json`), metadata);
      writeJsonAtomic(path2.join(dir, "latest.json"), payload);
      writeJsonAtomic(path2.join(dir, "metadata.json"), metadata);
      return {
        latestPath: path2.join(dir, "latest.json"),
        metadataPath: path2.join(dir, "metadata.json"),
        runPath: path2.join(runDir, `${runId}.json`),
        metadata
      };
    }
    function readScheduleLatest(baseDir, term, scope) {
      const payload = readJson(scheduleLatestPath(baseDir, term, scope), null);
      const metadata = readJson(scheduleMetadataPath(baseDir, term, scope), null);
      const items2 = Array.isArray(payload) ? payload : payload && Array.isArray(payload.items) ? payload.items : [];
      return {
        payload,
        metadata,
        items: items2,
        filePath: scheduleLatestPath(baseDir, term, scope)
      };
    }
    function progressPath(baseDir, term, scope, runId) {
      const name = runId ? `${scope}-${runId}.json` : `${scope}.json`;
      return path2.join(ensureTermCache(baseDir, term), "progress", name);
    }
    function negativePath(baseDir, term, scope, runId) {
      const name = runId ? `no-${scope}-${runId}.json` : `no-${scope}.json`;
      return path2.join(ensureTermCache(baseDir, term), "negative", name);
    }
    function stagingPath(baseDir, term, name) {
      return path2.join(ensureTermCache(baseDir, term), "staging", name || "latest.json");
    }
    function reportPath(baseDir, term, prefix) {
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      return path2.join(ensureTermCache(baseDir, term), "reports", `${prefix || "sync-report"}-${stamp}.json`);
    }
    module2.exports = {
      SCHEDULE_DIR_BY_SCOPE,
      buildMetadata,
      cacheRoot,
      ensureTermCache,
      hashJson,
      negativePath,
      progressPath,
      readJson,
      readScheduleLatest,
      reportPath,
      safeTerm,
      scheduleLatestPath,
      scheduleMetadataPath,
      stagingPath,
      writeJsonAtomic,
      writeScheduleLatest
    };
  }
});

// ../../server/src/utils/parser.js
var require_parser = __commonJS({
  "../../server/src/utils/parser.js"(exports2, module2) {
    var DEFAULT_TOTAL_WEEKS = 20;
    var TITLE_SUFFIXES = [
      "\u8BB2\u5E08\uFF08\u9AD8\u6821\uFF09",
      "\u8BB2\u5E08(\u9AD8\u6821)",
      "\u52A9\u7406\u7814\u7A76\u5458",
      "\u52A9\u7406\u5B9E\u9A8C\u5E08",
      "\u9AD8\u7EA7\u5B9E\u9A8C\u5E08",
      "\u7814\u7A76\u9986\u5458",
      "\u526F\u7814\u7A76\u5458",
      "\u9AD8\u7EA7\u5DE5\u7A0B\u5E08",
      "\u526F\u6559\u6388",
      "\u7814\u7A76\u5458",
      "\u5B9E\u9A8C\u5E08",
      "\u5DE5\u7A0B\u5E08",
      "\u6559\u6388",
      "\u8BB2\u5E08",
      "\u52A9\u6559",
      "\u8001\u5E08"
    ].sort((a, b) => b.length - a.length);
    var HTML_ENTITIES = {
      amp: "&",
      lt: "<",
      gt: ">",
      nbsp: " ",
      quot: '"',
      apos: "'"
    };
    function range(start, end) {
      const values = [];
      for (let value = start; value <= end; value += 1) {
        values.push(value);
      }
      return values;
    }
    function uniqueNumbers(numbers) {
      const seen = {};
      return numbers.filter((number) => {
        if (!number || seen[number]) {
          return false;
        }
        seen[number] = true;
        return true;
      }).sort((a, b) => a - b);
    }
    function decodeHtmlEntities(text) {
      return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match2, entity) => {
        const key = String(entity).toLowerCase();
        if (key[0] === "#") {
          const isHex = key[1] === "x";
          const code = parseInt(key.slice(isHex ? 2 : 1), isHex ? 16 : 10);
          return Number.isFinite(code) ? String.fromCharCode(code) : match2;
        }
        return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match2;
      });
    }
    function normalizeFullWidthDigits(text) {
      return String(text || "").replace(/[０-９]/g, (char) => {
        return String(char.charCodeAt(0) - 65296);
      });
    }
    function normalizeLineBreaks(text) {
      return decodeHtmlEntities(String(text || "")).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<hr\b[^>]*>/gi, "\n-----\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\r/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
    }
    function normalizeDash(text) {
      return String(text || "").replace(/[－—–~～至]/g, "-");
    }
    function stripTeacherTitle(name) {
      let value = String(name || "").trim();
      let changed = true;
      while (changed) {
        changed = false;
        TITLE_SUFFIXES.forEach((suffix) => {
          if (value.endsWith(suffix)) {
            value = value.slice(0, -suffix.length).trim();
            changed = true;
          }
        });
      }
      return value.trim();
    }
    function detectWeekType(rawText) {
      if (/双周|双/.test(rawText)) {
        return "even";
      }
      if (/单周|单/.test(rawText)) {
        return "odd";
      }
      return "all";
    }
    function filterWeekType(weeks, weekType) {
      return weeks.filter((week) => {
        if (weekType === "odd") {
          return week % 2 === 1;
        }
        if (weekType === "even") {
          return week % 2 === 0;
        }
        return true;
      });
    }
    function parseWeekText(text, options) {
      const config = options || {};
      const raw2 = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
      const weekType = detectWeekType(raw2);
      const defaultWeeks = range(config.defaultStartWeek || 1, config.defaultEndWeek || DEFAULT_TOTAL_WEEKS);
      const numericMatch = raw2.match(/[0-9]+(?:\s*-\s*[0-9]+)?(?:\s*[,，、]\s*[0-9]+(?:\s*-\s*[0-9]+)?)*\s*周?/);
      const clean = (numericMatch ? numericMatch[0] : raw2).replace(/第/g, "").replace(/周/g, "").replace(/[单双]/g, "").replace(/[()（）]/g, "").replace(/\s/g, "");
      const weeks = [];
      clean.split(/[，,、]/).forEach((part) => {
        if (!part) {
          return;
        }
        const rangeParts = part.split("-").filter(Boolean);
        if (rangeParts.length === 2) {
          const start = Number(rangeParts[0]);
          const end = Number(rangeParts[1]);
          if (start && end) {
            for (let week2 = start; week2 <= end; week2 += 1) {
              weeks.push(week2);
            }
          }
          return;
        }
        const week = Number(part);
        if (week) {
          weeks.push(week);
        }
      });
      const filteredWeeks = uniqueNumbers(filterWeekType(weeks.length ? weeks : defaultWeeks, weekType));
      return {
        startWeek: filteredWeeks[0] || 1,
        endWeek: filteredWeeks[filteredWeeks.length - 1] || 1,
        weeks: filteredWeeks,
        weekText: raw2 || config.defaultWeekText || "\u672A\u6807\u660E\u5468\u6B21",
        weekType
      };
    }
    function parseSectionText(text) {
      const value = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
      const match2 = value.match(/([\s\S]*?)[\[［【]([0-9\s,，、\-]+)[\]］】]\s*节?/);
      if (!match2) {
        return {
          classroom: value.replace(/^(教室|地点)[:：]/, "").trim(),
          startSection: 1,
          endSection: 1,
          hasSection: false
        };
      }
      const sections = match2[2].split(/[^0-9]+/).map((item) => Number(item.trim())).filter(Boolean);
      return {
        classroom: (match2[1] || "").replace(/^(教室|地点)[:：]/, "").trim(),
        startSection: sections[0] || 1,
        endSection: sections[sections.length - 1] || sections[0] || 1,
        hasSection: sections.length > 0
      };
    }
    function splitCourseBlocks(text) {
      return normalizeLineBreaks(text).split(/\n?\s*(?:-{5,}|—{3,}|─{3,}|={4,}|_{4,})\s*\n?/g).map((block) => block.trim()).filter(Boolean);
    }
    function isWeekLine(line) {
      return /([0-9０-９]+.*周|单周|双周)/.test(line);
    }
    function isSectionLine(line) {
      return /[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]\s*节?/.test(line);
    }
    function cleanCourseName(line) {
      return String(line || "").replace(/^(课程|课程名称)[:：]/, "").trim();
    }
    function cleanRemark(line) {
      return String(line || "").replace(/^备注[:：]?/, "").trim();
    }
    function dedupeStrings(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = String(value || "").trim();
        if (!text || seen[text]) {
          return;
        }
        seen[text] = true;
        result.push(text);
      });
      return result;
    }
    function getClassNameMatches(text) {
      const value = normalizeFullWidthDigits(decodeHtmlEntities(String(text || ""))).replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
      const matches = [];
      const pattern = /(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g;
      let match2 = null;
      while ((match2 = pattern.exec(value)) !== null) {
        matches.push(match2[0]);
      }
      return dedupeStrings(matches);
    }
    function splitClassNames(text) {
      const value = normalizeFullWidthDigits(decodeHtmlEntities(String(text || ""))).replace(/(?:上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]/g, " ").replace(/[；;,，、/／|]+/g, " ").replace(/\s+/g, " ").trim();
      return dedupeStrings(getClassNameMatches(value));
    }
    function getHiddenInputText(rawHtml) {
      const values = [];
      String(rawHtml || "").replace(/<input\b([^>]*)>/gi, (match2, attrText) => {
        const attrs = parseAttributes(attrText);
        const value = attrs.value || attrs.title || attrs.alt || "";
        if (value) {
          values.push(value);
        }
        return match2;
      });
      return values.join("\n");
    }
    function extractClassInfoFromText(rawText, options) {
      const config = options || {};
      const pieces = [
        rawText,
        config.className,
        config.cellTitle,
        config.hiddenInputText,
        config.nearbyText
      ].filter(Boolean);
      const text = normalizeLineBreaks(pieces.join("\n"));
      const labelMatches = [];
      const fieldMap = {};
      const labelPattern = /(上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]\s*([^\n\r<>{}]+)/g;
      let labelMatch = null;
      while ((labelMatch = labelPattern.exec(text)) !== null) {
        const label = labelMatch[1];
        const value = String(labelMatch[2] || "").trim();
        if (!value || /节次/.test(value)) {
          continue;
        }
        labelMatches.push(`${label}\uFF1A${value}`);
        const names = splitClassNames(value);
        if (/授课对象|上课对象/.test(label)) {
          fieldMap.audience = value;
        } else if (/教学班|上课班级/.test(label)) {
          fieldMap.teachingClass = value;
        } else if (/行政班|班级/.test(label)) {
          fieldMap.adminClass = value;
        }
        if (names.length) {
          fieldMap.classNames = (fieldMap.classNames || []).concat(names);
        }
      }
      const classNames = dedupeStrings((fieldMap.classNames || []).concat(splitClassNames(text)));
      return {
        className: classNames[0] || "",
        classNames,
        audience: fieldMap.audience || "",
        teachingClass: fieldMap.teachingClass || "",
        adminClass: fieldMap.adminClass || "",
        rawClassText: labelMatches.join("\n") || classNames.join("\u3001")
      };
    }
    function isClassNameLine(line) {
      const value = String(line || "").trim();
      return splitClassNames(value).length > 0 || /^(班级|行政班级|上课班级|授课对象)[:：]/.test(value);
    }
    function isClassInfoLine(line) {
      return /^(班级|行政班级|行政班|上课班级|授课对象|教学班|上课对象)[:：]/.test(String(line || "").trim());
    }
    function looksLikeLocationLine(line) {
      const value = String(line || "").trim();
      if (!value || isWeekLine(value) || isClassInfoLine(value)) {
        return false;
      }
      return /^[A-Za-z]\d[\w-]*|^\d+[A-Za-z]?[-－]\d+|楼|室|报告厅|实验室|语音室|校区|体育馆|操场/.test(value);
    }
    function looksLikeCourseStart(lines, index) {
      const line = String(lines[index] || "").trim();
      if (!line || isWeekLine(line) || isSectionLine(line) || isClassInfoLine(line) || looksLikeLocationLine(line)) {
        return false;
      }
      for (let offset = 1; offset <= 3; offset += 1) {
        if (isWeekLine(lines[index + offset] || "")) {
          return true;
        }
      }
      return false;
    }
    function splitSequentialCourseBlock(block) {
      const lines = String(block || "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 5) {
        return [String(block || "").trim()].filter(Boolean);
      }
      const blocks = [];
      let start = 0;
      while (start < lines.length) {
        const weekIndex = lines.findIndex((line, index) => index > start && isWeekLine(line));
        if (weekIndex < 0) {
          const rest = lines.slice(start).join("\n").trim();
          if (rest) {
            blocks.push(rest);
          }
          break;
        }
        let nextStart = -1;
        for (let index = weekIndex + 1; index < lines.length; index += 1) {
          if (looksLikeCourseStart(lines, index)) {
            nextStart = index;
            break;
          }
        }
        const end = nextStart >= 0 ? nextStart : lines.length;
        const current = lines.slice(start, end).join("\n").trim();
        if (current) {
          blocks.push(current);
        }
        if (nextStart < 0) {
          break;
        }
        start = nextStart;
      }
      return blocks;
    }
    function parseCourseText(rawText, options) {
      const config = options || {};
      return splitCourseBlocks(rawText).reduce((list, block) => list.concat(splitSequentialCourseBlock(block)), []).map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
          return null;
        }
        const weekIndex = lines.findIndex(isWeekLine);
        const sectionIndex = lines.findIndex(isSectionLine);
        const remarkIndexes = {};
        const ignoreIndexes = {};
        lines.forEach((line, lineIndex) => {
          if (/^备注[:：]?/.test(line)) {
            remarkIndexes[lineIndex] = true;
          }
        });
        const courseName = cleanCourseName(lines[0]);
        let teacherName = "";
        let locationLine = "";
        const classInfo = extractClassInfoFromText(block, {
          className: config.className,
          cellTitle: config.cellTitle,
          hiddenInputText: config.hiddenInputText,
          nearbyText: config.nearbyText
        });
        lines.forEach((line, lineIndex) => {
          if (lineIndex === 0 || lineIndex === weekIndex || lineIndex === sectionIndex || remarkIndexes[lineIndex]) {
            return;
          }
          if (isClassInfoLine(line) || isClassNameLine(line)) {
            ignoreIndexes[lineIndex] = true;
          } else if (weekIndex >= 0 && lineIndex > weekIndex && !locationLine) {
            locationLine = line;
          } else if (weekIndex < 0 && looksLikeLocationLine(line) && !locationLine) {
            locationLine = line;
          } else if (lineIndex < weekIndex && !teacherName) {
            teacherName = stripTeacherTitle(line);
          } else if (!teacherName && weekIndex < 0 && !looksLikeLocationLine(line)) {
            teacherName = stripTeacherTitle(line);
          } else if (line !== locationLine) {
            remarkIndexes[lineIndex] = true;
          }
        });
        const weekLine = weekIndex >= 0 ? lines[weekIndex] : "";
        const sectionLine = sectionIndex >= 0 ? lines[sectionIndex] : locationLine;
        const weekInfo = parseWeekText(weekLine, {
          defaultStartWeek: config.defaultStartWeek || 1,
          defaultEndWeek: config.defaultEndWeek || DEFAULT_TOTAL_WEEKS
        });
        const sectionInfo = parseSectionText(sectionLine);
        const remark = lines.filter((line, lineIndex) => remarkIndexes[lineIndex] && !ignoreIndexes[lineIndex]).map(cleanRemark).filter(Boolean).join("\n");
        return Object.assign(
          {
            id: `${config.idPrefix || "parsed-course"}-${index + 1}`,
            source: config.source || "school",
            semester: config.semester || "",
            className: classInfo.className || config.className || "",
            classNames: classInfo.classNames || [],
            audience: classInfo.audience || "",
            teachingClass: classInfo.teachingClass || "",
            adminClass: classInfo.adminClass || "",
            rawClassText: classInfo.rawClassText || "",
            courseName,
            teacherName,
            classroom: sectionInfo.classroom,
            weekday: config.weekday || 1,
            startSection: sectionInfo.hasSection ? sectionInfo.startSection : config.fallbackStartSection || sectionInfo.startSection,
            endSection: sectionInfo.hasSection ? sectionInfo.endSection : config.fallbackEndSection || sectionInfo.endSection,
            startWeek: weekInfo.startWeek,
            endWeek: weekInfo.endWeek,
            weeks: weekInfo.weeks,
            weekText: weekInfo.weekText,
            weekType: weekInfo.weekType,
            color: config.color || "",
            remark,
            rawText: block,
            rawHtml: config.rawHtml || ""
          },
          config.extra || {}
        );
      }).filter((course) => course && course.courseName);
    }
    function parseAttributes(tag) {
      const attrs = {};
      String(tag || "").replace(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (match2, key, raw2, doubleValue, singleValue, bareValue) => {
        attrs[key.toLowerCase()] = decodeHtmlEntities(doubleValue || singleValue || bareValue || "");
        return match2;
      });
      return attrs;
    }
    function extractKbTableHtml(html) {
      const source = String(html || "");
      const tableMatch = source.match(/<table\b[^>]*id=["']?kbtable["']?[^>]*>[\s\S]*?<\/table>/i);
      if (tableMatch) {
        return tableMatch[0];
      }
      const fallback = source.match(/<table\b[\s\S]*?<\/table>/i);
      return fallback ? fallback[0] : "";
    }
    function parseTableRows(tableHtml) {
      const rows = [];
      String(tableHtml || "").replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (rowMatch, rowHtml) => {
        const cells = [];
        rowHtml.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (cellMatch, tagName, attrText, innerHtml) => {
          cells.push({
            tagName: String(tagName || "").toLowerCase(),
            attrs: parseAttributes(attrText),
            html: innerHtml,
            rawHtml: cellMatch,
            text: normalizeLineBreaks(innerHtml).trim()
          });
          return cellMatch;
        });
        rows.push(cells);
        return rowMatch;
      });
      return rows;
    }
    function parseHeaderSectionText(text) {
      const value = normalizeFullWidthDigits(String(text || "")).replace(/\s+/g, "");
      if (!value) {
        return null;
      }
      const bracketMatch = value.match(/[\[［【]?([0-9,，、\-]+)[\]］】]?/);
      const raw2 = bracketMatch ? bracketMatch[1] : value;
      let sections = [];
      if (/^\d{4,}$/.test(raw2) && raw2.length % 2 === 0) {
        sections = raw2.match(/\d{2}/g).map(Number);
      } else {
        sections = raw2.split(/[^0-9]+/).map(Number).filter(Boolean);
      }
      sections = sections.filter(Boolean);
      if (!sections.length) {
        return null;
      }
      return {
        startSection: sections[0],
        endSection: sections[sections.length - 1]
      };
    }
    function isLikelyCourseCell(text) {
      const value = String(text || "").trim();
      if (!value) {
        return false;
      }
      if (/星期|周[一二三四五六日]|节次|上午|下午|晚上|时间/.test(value) && value.length <= 20) {
        return false;
      }
      return /[0-9０-９]+.*周|单周|双周|[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]|教师|教室|班级/.test(value);
    }
    function getColumnGroupSize(rows) {
      const maxCells = rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (maxCells <= 8) {
        return 1;
      }
      return Math.max(1, Math.round((maxCells - 1) / 7));
    }
    function parseScheduleHtml(html, context, parserOptions) {
      const config = parserOptions || {};
      const tableHtml = extractKbTableHtml(html);
      const warnings = [];
      if (!tableHtml) {
        return {
          courses: [],
          warnings: ["\u672A\u627E\u5230 table#kbtable"],
          meta: {
            rowCount: 0,
            columnGroupSize: 1
          }
        };
      }
      const rows = parseTableRows(tableHtml);
      const columnGroupSize = getColumnGroupSize(rows);
      const courses = [];
      const meta2 = {
        rowCount: rows.length,
        firstRowColumnCounts: rows.slice(0, 3).map((row) => row.length),
        columnGroupSize
      };
      rows.forEach((row, rowIndex) => {
        const rowHeader = row[0] ? normalizeLineBreaks(row[0].html || row[0].text).trim() : "";
        const rowClassInfo = extractClassInfoFromText(rowHeader);
        const rowClassName = rowClassInfo.className || "";
        row.forEach((cell, cellIndex) => {
          if (cellIndex === 0 || !isLikelyCourseCell(cell.text)) {
            return;
          }
          try {
            const dataColumnIndex = Math.max(0, cellIndex - 1);
            const weekday = Math.min(7, Math.floor(dataColumnIndex / columnGroupSize) + 1);
            const headerSection = parseHeaderSectionText(rows[1] && rows[1][cellIndex] ? rows[1][cellIndex].text : "");
            const fallbackSection = headerSection ? headerSection.startSection : Math.max(1, rowIndex);
            const fallbackEndSection = headerSection ? headerSection.endSection : fallbackSection;
            const effectiveClassName = rowClassName || context && context.className || "";
            const hiddenInputText = getHiddenInputText(cell.rawHtml);
            const parsed2 = parseCourseText(cell.html, {
              idPrefix: `${config.idPrefix || "schedule"}-${rowIndex}-${cellIndex}`,
              source: config.source || "school",
              semester: context && context.semester,
              className: effectiveClassName,
              cellTitle: cell.attrs.title || "",
              hiddenInputText,
              nearbyText: [rowHeader, cell.attrs.title || ""].filter(Boolean).join("\n"),
              weekday,
              fallbackStartSection: fallbackSection,
              fallbackEndSection,
              rawHtml: cell.rawHtml,
              extra: Object.assign(
                {
                  audienceType: config.audienceType || "student",
                  sourceType: config.sourceType || "class"
                },
                context && context.extra
              )
            }).map((course) => Object.assign({}, course, {
              rawHtml: cell.rawHtml,
              sourceType: config.sourceType || course.sourceType,
              audienceType: config.audienceType || course.audienceType
            }));
            if (!parsed2.length) {
              warnings.push(`\u7B2C${rowIndex + 1}\u884C\u7B2C${cellIndex + 1}\u5217\u672A\u89E3\u6790\u51FA\u8BFE\u7A0B`);
              return;
            }
            courses.push.apply(courses, parsed2);
          } catch (error) {
            warnings.push(`\u7B2C${rowIndex + 1}\u884C\u7B2C${cellIndex + 1}\u5217\u89E3\u6790\u5931\u8D25\uFF1A${error.message}`);
          }
        });
      });
      return {
        courses,
        warnings,
        meta: meta2
      };
    }
    function extractClassNameCandidates(html, context) {
      const source = String(html || "");
      const text = normalizeLineBreaks(source).replace(/\n{3,}/g, "\n\n");
      const keywords = ["\u884C\u653F\u73ED", "\u73ED\u7EA7", "\u4E0A\u8BFE\u73ED\u7EA7", "\u6388\u8BFE\u5BF9\u8C61", "25\u52A8\u7269", "24", "2025"];
      const candidates = [];
      const classNames = [];
      keywords.forEach((keyword) => {
        let start = 0;
        while (start < text.length) {
          const index = text.indexOf(keyword, start);
          if (index < 0) {
            break;
          }
          const snippet = text.slice(Math.max(0, index - 80), Math.min(text.length, index + 180)).replace(/\s+/g, " ").trim();
          const names = splitClassNames(snippet);
          if (snippet) {
            candidates.push({
              source: "keyword",
              keyword,
              text: snippet,
              classNames: names
            });
          }
          classNames.push.apply(classNames, names);
          start = index + keyword.length;
        }
      });
      const tableHtml = extractKbTableHtml(source);
      parseTableRows(tableHtml).forEach((row, rowIndex) => {
        const rowHeader = row[0] ? normalizeLineBreaks(row[0].html || row[0].text).trim() : "";
        const names = splitClassNames(rowHeader);
        if (names.length) {
          candidates.push({
            source: "row-header",
            rowIndex,
            text: rowHeader,
            classNames: names
          });
          classNames.push.apply(classNames, names);
        }
        row.forEach((cell, cellIndex) => {
          const values = [cell.attrs.title || "", getHiddenInputText(cell.rawHtml)].filter(Boolean);
          values.forEach((value) => {
            const namesFromValue = splitClassNames(value);
            if (namesFromValue.length) {
              candidates.push({
                source: "cell-attribute",
                rowIndex,
                cellIndex,
                text: value,
                classNames: namesFromValue
              });
              classNames.push.apply(classNames, namesFromValue);
            }
          });
        });
      });
      return {
        semester: context && context.semester,
        majorCode: context && context.majorCode,
        majorName: context && context.majorName,
        classNames: dedupeStrings(classNames),
        candidates
      };
    }
    function parsePersonalScheduleHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "personal",
        source: "school",
        sourceType: "personal",
        audienceType: "student"
      });
    }
    function parseClassScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "class-ifr",
        source: "school",
        sourceType: "class",
        audienceType: "student"
      });
    }
    function parseTeacherScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "teacher-ifr",
        source: "school",
        sourceType: "teacher",
        audienceType: "teacher"
      });
    }
    function parseClassroomScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "classroom-ifr",
        source: "school",
        sourceType: "classroom",
        audienceType: "classroom"
      });
    }
    function parseCourseScheduleIfrHtml(html, context) {
      return parseScheduleHtml(html, context || {}, {
        idPrefix: "course-ifr",
        source: "school",
        sourceType: "course",
        audienceType: "course"
      });
    }
    function parseOptionTags(selectHtml) {
      const options = [];
      String(selectHtml || "").replace(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi, (match2, attrText, labelHtml) => {
        const attrs = parseAttributes(attrText);
        const name = normalizeLineBreaks(labelHtml).trim();
        const code = attrs.value || attrs.code || "";
        if (code || name) {
          options.push({ code, name });
        }
        return match2;
      });
      return options.filter((item) => item.name && !/^请选择|^全部/.test(item.name));
    }
    function extractSelectOptions(html, patterns) {
      const source = String(html || "");
      const result = [];
      source.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi, (match2, attrText, innerHtml) => {
        const attrs = parseAttributes(attrText);
        const marker = `${attrs.name || ""} ${attrs.id || ""}`.toLowerCase();
        if (patterns.some((pattern) => pattern.test(marker))) {
          result.push.apply(result, parseOptionTags(innerHtml));
        }
        return match2;
      });
      return result;
    }
    function parseSchoolOptionsHtml(html) {
      const semesters = extractSelectOptions(html, [/xnxq/, /xnxqh/, /semester/]);
      const colleges = extractSelectOptions(html, [/skyx/, /xy/, /college/]);
      const grades = extractSelectOptions(html, [/sknj/, /nj/, /grade/]).map((item) => item.code || item.name);
      return {
        semesters,
        colleges,
        grades,
        majors: [],
        warnings: [],
        meta: {
          hasKbtable: Boolean(extractKbTableHtml(html))
        }
      };
    }
    function tryParseJsonLike(text) {
      const raw2 = String(text || "").trim();
      const jsonStart = raw2.search(/[\[{]/);
      const jsonEnd = Math.max(raw2.lastIndexOf("]"), raw2.lastIndexOf("}"));
      const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? raw2.slice(jsonStart, jsonEnd + 1) : raw2;
      try {
        return JSON.parse(jsonText);
      } catch (error) {
        const relaxed = jsonText.replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":');
        return JSON.parse(relaxed);
      }
    }
    function normalizeMajorItem2(item, context) {
      const source = item || {};
      return {
        code: String(source.code || source.value || source.dm || source.zydm || source.zyh || source.id || ""),
        name: String(source.name || source.text || source.label || source.mc || source.zymc || source.zy || ""),
        collegeCode: String(context && context.collegeCode || source.collegeCode || source.skyx || ""),
        grade: String(context && context.grade || source.grade || source.sknj || "")
      };
    }
    function parseMajorAjaxResponse(text, context) {
      const warnings = [];
      let payload = [];
      try {
        payload = tryParseJsonLike(text);
      } catch (error) {
        warnings.push(`\u4E13\u4E1A\u8054\u52A8\u54CD\u5E94\u4E0D\u662F\u6807\u51C6 JSON\uFF1A${error.message}`);
        payload = [];
      }
      const list = Array.isArray(payload) ? payload : payload && (payload.rows || payload.data || payload.list || payload.majors) || [];
      const majors = (Array.isArray(list) ? list : []).map((item) => normalizeMajorItem2(item, context || {})).filter((item) => item.code || item.name);
      return {
        majors,
        warnings,
        meta: {
          count: majors.length
        }
      };
    }
    module2.exports = {
      decodeHtmlEntities,
      normalizeDash,
      normalizeFullWidthDigits,
      normalizeLineBreaks,
      parseClassScheduleIfrHtml,
      parseClassroomScheduleIfrHtml,
      parseCourseText,
      extractClassInfoFromText,
      extractClassNameCandidates,
      parseCourseScheduleIfrHtml,
      parseMajorAjaxResponse,
      parsePersonalScheduleHtml,
      parseSchoolOptionsHtml,
      parseSectionText,
      parseTeacherScheduleIfrHtml,
      parseWeekText,
      splitCourseBlocks,
      stripTeacherTitle
    };
  }
});

// ../../server/src/utils/courseNormalizer.js
var require_courseNormalizer = __commonJS({
  "../../server/src/utils/courseNormalizer.js"(exports2, module2) {
    var UNKNOWN_CLASSROOM_TEXT = "\u5F85\u8865\u5145";
    var MULTI_VENUE_TEXT = "\u591A\u4E2A\u5730\u70B9";
    var MULTI_TEACHER_TEXT = "\u591A\u4E2A\u6559\u5E08";
    var NOTICE_TEACHER_TEXT = "\u89C1\u901A\u77E5";
    var PE_NOTICE_TEXT = "\u4F53\u80B2\u8BFE\u5730\u70B9\u4EE5\u6559\u5E08/\u5B9E\u9645\u9009\u8BFE\u901A\u77E5\u4E3A\u51C6";
    var COURSE_KEYWORDS = [
      "\u5316\u5B66",
      "\u751F\u7269\u5316\u5B66",
      "\u52A8\u7269\u5B66",
      "\u6709\u673A\u5316\u5B66",
      "\u89E3\u5256",
      "\u82F1\u8BED",
      "\u6570\u5B66",
      "\u7269\u7406",
      "\u4F53\u80B2",
      "\u601D\u60F3",
      "\u653F\u6CBB",
      "\u5C31\u4E1A",
      "\u5B9E\u9A8C",
      "\u5DE5\u7A0B",
      "\u8BBE\u8BA1",
      "\u7BA1\u7406",
      "\u6CD5\u5B66",
      "\u533B\u5B66",
      "\u836F\u5B66",
      "\u8BA1\u7B97\u673A",
      "\u4EBA\u5DE5\u667A\u80FD",
      "\u5199\u4F5C",
      "\u9605\u8BFB",
      "\u5FC3\u7406",
      "\u521B\u65B0\u521B\u4E1A",
      "\u751F\u7406",
      "\u75C5\u7406",
      "\u5FAE\u751F\u7269",
      "\u9057\u4F20",
      "\u80B2\u79CD",
      "\u8425\u517B",
      "\u9972\u6599",
      "\u98DF\u54C1",
      "\u5B89\u5168\u6559\u80B2",
      "\u804C\u4E1A\u53D1\u5C55",
      "\u5F62\u52BF\u4E0E\u653F\u7B56",
      "\u519B\u4E8B\u7406\u8BBA",
      "\u52B3\u52A8\u6559\u80B2",
      "\u9A6C\u514B\u601D",
      "\u8FD1\u73B0\u4EE3\u53F2",
      "\u6BDB\u6CFD\u4E1C",
      "\u6982\u8BBA",
      "\u9AD8\u7B49\u6570\u5B66",
      "\u7EBF\u6027\u4EE3\u6570",
      "\u6982\u7387",
      "\u5927\u5B66\u751F",
      "\u5BFC\u8BBA",
      "\u539F\u7406",
      "\u57FA\u7840",
      "\u6280\u672F",
      "\u8BAD\u7EC3",
      "\u5B9E\u8BAD",
      "\u5B9E\u4E60",
      "\u8BFE\u7A0B",
      "\u4E13\u9898",
      "\u901A\u8BC6",
      "\u97F3\u4E50",
      "\u7F8E\u672F",
      "\u7ECF\u6D4E",
      "\u91D1\u878D",
      "\u4F1A\u8BA1",
      "\u7EDF\u8BA1",
      "\u8F6F\u4EF6",
      "\u7F51\u7EDC",
      "\u6570\u636E\u5E93"
    ];
    var STRONG_VENUE_TERMS = [
      "\u4F53\u80B2\u9986",
      "\u8FD0\u52A8\u573A",
      "\u6E38\u6CF3\u6C60",
      "\u7403\u573A",
      "\u7BEE\u7403\u573A",
      "\u8DB3\u7403\u573A",
      "\u7F51\u7403\u573A",
      "\u7FBD\u6BDB\u7403\u9986",
      "\u4E52\u4E53\u7403\u9986",
      "\u5065\u8EAB\u623F",
      "\u821E\u8E48\u5BA4",
      "\u9F99\u821F\u7801\u5934",
      "\u4ED9\u6EAA\u6E56",
      "\u64CD\u573A",
      "\u62A5\u544A\u5385",
      "\u8BED\u97F3\u5BA4",
      "\u673A\u623F",
      "\u4F1A\u8BAE\u5BA4",
      "\u5B9E\u8BAD\u5BA4",
      "\u753B\u5BA4",
      "\u5B9E\u9A8C\u5BA4",
      "\u5728\u7EBF\u8BFE\u7A0B",
      "\u7F51\u7EDC\u6559\u5B66\u5E73\u53F0"
    ];
    var VENUE_TERMS = [
      "\u697C",
      "\u5BA4",
      "\u9986",
      "\u573A",
      "\u6C60",
      "\u7801\u5934",
      "\u6821\u533A",
      "\u4E2D\u5FC3",
      "\u5E73\u53F0",
      "\u5385",
      "\u6559\u5BA4",
      "\u5B9E\u9A8C\u5BA4",
      "\u4ED9\u6EAA",
      "\u6C5F\u6E7E",
      "\u6CB3\u6EE8",
      "\u64CD\u573A",
      "\u7530\u5F84",
      "\u4F53\u80B2"
    ];
    var EMPTY_LIKE_TEXTS = /* @__PURE__ */ new Set([
      "",
      "\u5F85\u8865\u5145",
      "\u6682\u65E0",
      "\u65E0",
      "\u672A\u77E5",
      "\u81EA\u884C\u5B89\u6392",
      "\u5F85\u5B9A",
      "\u672A\u5B89\u6392",
      "\u591A\u4E2A\u5730\u70B9",
      "\u591A\u4E2A\u6559\u5E08",
      "\u89C1\u901A\u77E5",
      "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5"
    ]);
    function toText(value) {
      return String(value == null ? "" : value);
    }
    function toHalfWidth(value) {
      return toText(value).replace(/\u3000/g, " ").replace(
        /[\uff01-\uff5e]/g,
        (char) => String.fromCharCode(char.charCodeAt(0) - 65248)
      );
    }
    function cleanDisplayText(value) {
      return toHalfWidth(value).replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/[，]/g, ",").replace(/[；]/g, ";").replace(/[：]/g, ":").replace(/[【]/g, "[").replace(/[】]/g, "]").replace(/\s+/g, " ").trim();
    }
    function normalizeText(text) {
      return cleanDisplayText(text).replace(/[第周节]/g, "").replace(/[()\[\]{}<>《》「」『』"'`]/g, "").replace(/[.,;:，。；：、/\\|_-]/g, "").replace(/\s+/g, "").trim();
    }
    function isEmptyLike(value) {
      return EMPTY_LIKE_TEXTS.has(cleanDisplayText(value));
    }
    function hasAnyKeyword(text, keywords) {
      const normalized = normalizeText(text);
      return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
    }
    function hasCourseKeyword(text) {
      return hasAnyKeyword(text, COURSE_KEYWORDS);
    }
    function hasVenueSignal(text) {
      return hasAnyKeyword(text, STRONG_VENUE_TERMS) || hasAnyKeyword(text, VENUE_TERMS);
    }
    function isClassroomCodeLike(text) {
      const compact = cleanDisplayText(text).replace(/\s+/g, "");
      return /^[A-Za-z]\d{1,2}[-－—]?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) || /^[A-Za-z]\d{1,2}(?:号)?楼?\d{2,4}[A-Za-z]?(?:\(.+?\))?$/.test(compact) || /^[A-Za-z]{1,3}[-－—]?\d{2,4}(?:教室|室|厅)?$/.test(compact);
    }
    function isStrongVenueText(text) {
      const compact = normalizeText(text);
      if (!compact || isEmptyLike(compact)) {
        return false;
      }
      if (isClassroomCodeLike(text)) {
        return true;
      }
      const matched = STRONG_VENUE_TERMS.some((term) => compact.includes(normalizeText(term)));
      if (!matched) {
        return false;
      }
      if (hasCourseKeyword(text) && /(教育|课程|技术|概论|导论|训练|实训)$/.test(compact)) {
        return false;
      }
      return true;
    }
    function isCourseLike(text) {
      const display = cleanDisplayText(text);
      const compact = normalizeText(display);
      if (!compact || isEmptyLike(display)) {
        return false;
      }
      if (/^(?:大学)?体育[1-4]?$/.test(compact) || /^大学[\u4e00-\u9fa5A-Za-z]+[1-4]$/.test(compact)) {
        return true;
      }
      if (hasCourseKeyword(display)) {
        return true;
      }
      const chineseChars = compact.match(/[\u4e00-\u9fa5]/g) || [];
      const looksLikeLongCourseName = chineseChars.length >= 6 && !hasVenueSignal(display) && !/^[\u4e00-\u9fa5]{2,4}$/.test(compact);
      return looksLikeLongCourseName;
    }
    function isVenueLike(text) {
      const display = cleanDisplayText(text);
      const compact = normalizeText(display);
      if (!compact || isEmptyLike(display)) {
        return false;
      }
      if (isClassroomCodeLike(display) || isStrongVenueText(display)) {
        return true;
      }
      if (!hasAnyKeyword(display, VENUE_TERMS)) {
        return false;
      }
      if (isCourseLike(display)) {
        return false;
      }
      return true;
    }
    function splitPersonNameCandidates(text) {
      return cleanDisplayText(text).split(/[\/,，;；、\s]+/).map((item) => item.trim()).filter(Boolean);
    }
    function isSinglePersonNameLike(text) {
      const compact = normalizeText(text);
      return /^[\u4e00-\u9fa5]{2,4}$/.test(compact) && !hasCourseKeyword(compact) && !isVenueLike(compact);
    }
    function isPersonNameLike(text) {
      const parts = splitPersonNameCandidates(text);
      if (!parts.length) {
        return false;
      }
      return parts.every(isSinglePersonNameLike);
    }
    function isPhysicalEducationLike(course) {
      const item = course || {};
      const values = [
        item.displayCourseName,
        item.canonicalCourseName,
        item.courseName,
        item.name,
        item.title,
        item.teacherName,
        item.teacher,
        item.rawText
      ];
      if (values.some((value) => /大学体育|体育/.test(cleanDisplayText(value)))) {
        return true;
      }
      const rawCourseName = cleanDisplayText(item.courseName || item.name || item.title);
      const rawTeacherName = cleanDisplayText(item.teacherName || item.teacher);
      return isVenueLike(rawCourseName) && isCourseLike(rawTeacherName) && /体育/.test(rawTeacherName);
    }
    function firstText(values) {
      for (const value of values) {
        const text = cleanDisplayText(value);
        if (text) {
          return text;
        }
      }
      return "";
    }
    function splitRawTextCandidates(text) {
      const raw2 = cleanDisplayText(text);
      const candidates = raw2.split(/[\n\r\t|;；,，、]+/).map((item) => item.replace(/^(课程|课程名|名称|教师|老师|地点|教室)[:：]/, "").trim()).filter(Boolean);
      const peMatches = raw2.match(/大学体育[1-4]?|体育[1-4]?/g);
      if (peMatches) {
        candidates.push.apply(candidates, peMatches);
      }
      return candidates;
    }
    function extractCourseNameCandidate(rawCourse, fields) {
      const item = rawCourse || {};
      const candidates = [];
      [fields.teacherName, item.rawText, item.title, item.name].forEach((value) => {
        splitRawTextCandidates(value).forEach((candidate) => candidates.push(candidate));
      });
      for (const candidate of candidates) {
        if (isCourseLike(candidate) && !isVenueLike(candidate)) {
          return cleanDisplayText(candidate);
        }
      }
      return "";
    }
    function normalizeCourseIdentity(rawCourse, context) {
      const source = rawCourse || {};
      const config = context || {};
      const originalCourseName = firstText([source.courseName, source.name, source.title]);
      const originalTeacherName = firstText([source.teacherName, source.teacher]);
      const originalClassroom = firstText([source.classroom]);
      const rawText = firstText([source.rawText, config.rawText]);
      let displayCourseName = originalCourseName;
      let displayClassroom = originalClassroom;
      let displayTeacherName = originalTeacherName;
      let courseIdentityType = "normal";
      let normalizationReason = "normal";
      let isTeacherFieldActuallyCourseName = false;
      const courseNameIsVenue = isVenueLike(originalCourseName);
      const teacherNameIsCourse = isCourseLike(originalTeacherName);
      const teacherNameIsPeCourse = teacherNameIsCourse && /大学体育|体育/.test(originalTeacherName);
      if (courseNameIsVenue && originalTeacherName && (teacherNameIsCourse || teacherNameIsPeCourse)) {
        displayCourseName = originalTeacherName;
        displayClassroom = originalCourseName;
        displayTeacherName = NOTICE_TEACHER_TEXT;
        courseIdentityType = "venue_as_course";
        normalizationReason = "courseName_is_venue_teacherName_is_course";
        isTeacherFieldActuallyCourseName = true;
      } else if (!originalCourseName && teacherNameIsCourse) {
        displayCourseName = originalTeacherName;
        displayTeacherName = "";
        courseIdentityType = "teacher_as_course";
        normalizationReason = "teacherName_used_as_courseName";
        isTeacherFieldActuallyCourseName = true;
      } else if (courseNameIsVenue && !originalClassroom) {
        const extractedCourseName = extractCourseNameCandidate(source, {
          teacherName: originalTeacherName,
          rawText
        });
        if (extractedCourseName && normalizeText(extractedCourseName) !== normalizeText(originalCourseName)) {
          displayCourseName = extractedCourseName;
          displayClassroom = originalCourseName;
          if (normalizeText(originalTeacherName) === normalizeText(extractedCourseName)) {
            displayTeacherName = "";
            isTeacherFieldActuallyCourseName = true;
          }
          courseIdentityType = "venue_promoted_to_classroom";
          normalizationReason = "courseName_is_venue_extracted_courseName";
        }
      }
      if (!displayCourseName) {
        const extractedCourseName = extractCourseNameCandidate(source, {
          teacherName: originalTeacherName,
          rawText
        });
        if (extractedCourseName) {
          displayCourseName = extractedCourseName;
          normalizationReason = normalizationReason === "normal" ? "rawText_used_as_courseName" : normalizationReason;
        }
      }
      if (!displayClassroom && courseNameIsVenue && displayCourseName !== originalCourseName) {
        displayClassroom = originalCourseName;
      }
      const result = Object.assign({}, source, {
        rawCourseName: source.rawCourseName || originalCourseName,
        rawTeacherName: source.rawTeacherName || originalTeacherName,
        rawClassroom: source.rawClassroom || originalClassroom,
        venueCandidates: uniqueTexts([].concat(
          Array.isArray(source.venueCandidates) ? source.venueCandidates : [],
          courseNameIsVenue ? originalCourseName : "",
          isVenueLike(originalClassroom) ? originalClassroom : ""
        )),
        displayCourseName: cleanDisplayText(displayCourseName),
        canonicalCourseName: cleanDisplayText(displayCourseName),
        displayClassroom: cleanDisplayText(displayClassroom),
        canonicalClassroom: cleanDisplayText(displayClassroom),
        displayTeacherName: cleanDisplayText(displayTeacherName),
        canonicalTeacherName: cleanDisplayText(displayTeacherName),
        courseIdentityType,
        normalizationReason,
        isVenueCandidate: courseNameIsVenue,
        isTeacherFieldActuallyCourseName,
        isPhysicalEducationLike: false
      });
      result.isPhysicalEducationLike = isPhysicalEducationLike(result);
      if (result.isPhysicalEducationLike && result.courseIdentityType === "normal") {
        result.courseIdentityType = "physical_education";
      }
      return result;
    }
    function shouldKeepTeacherName(name) {
      const text = cleanDisplayText(name);
      return Boolean(text) && !isEmptyLike(text) && text !== NOTICE_TEACHER_TEXT && text !== MULTI_TEACHER_TEXT && text !== "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5" && !isCourseLike(text);
    }
    function shouldKeepVenueName(name) {
      const text = cleanDisplayText(name);
      return Boolean(text) && !isEmptyLike(text) && text !== UNKNOWN_CLASSROOM_TEXT && text !== MULTI_VENUE_TEXT;
    }
    function uniqueTexts(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = cleanDisplayText(value);
        const key = normalizeText(text);
        if (!text || !key || seen[key]) {
          return;
        }
        seen[key] = true;
        result.push(text);
      });
      return result;
    }
    function toRenderableCourse(course) {
      const normalized = normalizeCourseIdentity(course);
      const title = normalized.displayCourseName || normalized.canonicalCourseName || normalized.courseName || "";
      const classroom = normalized.displayClassroom || normalized.canonicalClassroom || normalized.classroom || "";
      const teacherName = normalized.displayTeacherName || normalized.canonicalTeacherName || normalized.teacherName || "";
      return Object.assign({}, normalized, {
        courseName: title,
        classroom,
        teacherName
      });
    }
    function buildTodayDisplayGroupKey(course, context) {
      const config = context || {};
      const sem = course.semester || config.semester || "";
      const classKey = config.classId || course.classId || config.className || course.className || "";
      const currentWeek = config.currentWeek || "";
      const weekday = config.weekday || course.weekday || "";
      const canonicalCourseName = normalizeText(
        course.canonicalCourseName || course.displayCourseName || course.courseName || ""
      );
      return [
        sem,
        classKey,
        currentWeek,
        weekday,
        course.startSection || "",
        course.endSection || "",
        canonicalCourseName
      ].join("_");
    }
    function mergeCanonicalCoursesForDisplay(courses, context) {
      const config = context || {};
      const normalizedCourses = (courses || []).map(toRenderableCourse);
      const strictSeen = {};
      const strictUniqueCourses = [];
      normalizedCourses.forEach((course) => {
        const strictKey = [
          course.semester || config.semester || "",
          course.classId || config.classId || course.className || config.className || "",
          config.currentWeek || "",
          config.weekday || course.weekday || "",
          course.startSection || "",
          course.endSection || "",
          normalizeText(course.canonicalCourseName || course.courseName || ""),
          normalizeText(course.canonicalClassroom || course.classroom || ""),
          normalizeText(course.canonicalTeacherName || course.teacherName || "")
        ].join("_");
        if (!strictSeen[strictKey]) {
          strictSeen[strictKey] = true;
          strictUniqueCourses.push(course);
        }
      });
      const groups = {};
      const groupKeys = [];
      strictUniqueCourses.forEach((course) => {
        const groupKey = buildTodayDisplayGroupKey(course, config);
        if (!groups[groupKey]) {
          groups[groupKey] = [];
          groupKeys.push(groupKey);
        }
        groups[groupKey].push(course);
      });
      const displayCourses = [];
      const mergedGroups = [];
      groupKeys.forEach((key) => {
        const group = groups[key];
        if (group.length === 1) {
          displayCourses.push(toRenderableCourse(group[0]));
          return;
        }
        const base = toRenderableCourse(group[0]);
        const canonicalCourseName = base.canonicalCourseName || base.displayCourseName || base.courseName;
        const venues = uniqueTexts(group.reduce((items2, item) => {
          if (Array.isArray(item.venueCandidates)) {
            items2.push.apply(items2, item.venueCandidates);
          }
          items2.push(item.displayClassroom || item.canonicalClassroom || item.classroom);
          return items2;
        }, []).filter(shouldKeepVenueName));
        const teachers = uniqueTexts(group.filter((item) => !item.isTeacherFieldActuallyCourseName).map((item) => item.displayTeacherName || item.canonicalTeacherName || item.teacherName).filter(shouldKeepTeacherName));
        const isPe = group.some((item) => item.isPhysicalEducationLike) || isPhysicalEducationLike(base);
        let displayClassroom = base.displayClassroom || base.classroom || "";
        if (venues.length > 1) {
          displayClassroom = MULTI_VENUE_TEXT;
        } else if (venues.length === 1) {
          displayClassroom = venues[0];
        } else {
          displayClassroom = isPe ? MULTI_VENUE_TEXT : "";
        }
        let displayTeacherName = base.displayTeacherName || base.teacherName || "";
        if (teachers.length > 1) {
          displayTeacherName = MULTI_TEACHER_TEXT;
        } else if (teachers.length === 1) {
          displayTeacherName = teachers[0];
        } else {
          displayTeacherName = NOTICE_TEACHER_TEXT;
        }
        const tag = venues.length > 1 || isPe ? "\u591A\u5730\u70B9" : "\u5DF2\u5408\u5E76";
        const merged = Object.assign({}, base, {
          id: key,
          courseName: canonicalCourseName,
          displayCourseName: canonicalCourseName,
          canonicalCourseName,
          classroom: displayClassroom,
          displayClassroom,
          canonicalClassroom: displayClassroom,
          teacherName: displayTeacherName,
          displayTeacherName,
          canonicalTeacherName: displayTeacherName,
          isMerged: true,
          mergedCount: group.length,
          mergedVenues: venues,
          mergedTeachers: teachers,
          mergedItems: group,
          tag,
          remark: isPe ? PE_NOTICE_TEXT : base.remark,
          isPhysicalEducationLike: isPe
        });
        displayCourses.push(merged);
        mergedGroups.push({
          key,
          courseName: canonicalCourseName,
          count: group.length,
          venues,
          teachers,
          isPhysicalEducationLike: isPe,
          items: group.map((item) => ({
            courseName: item.courseName,
            rawCourseName: item.rawCourseName || item.courseName,
            canonicalCourseName: item.canonicalCourseName,
            classroom: item.classroom,
            teacherName: item.teacherName,
            normalizationReason: item.normalizationReason
          }))
        });
      });
      return {
        courses: displayCourses,
        normalizedCourses,
        strictUniqueCourses,
        mergedGroups
      };
    }
    module2.exports = {
      MULTI_TEACHER_TEXT,
      MULTI_VENUE_TEXT,
      NOTICE_TEACHER_TEXT,
      PE_NOTICE_TEXT,
      buildTodayDisplayGroupKey,
      cleanDisplayText,
      isCourseLike,
      isPersonNameLike,
      isPhysicalEducationLike,
      isVenueLike,
      mergeCanonicalCoursesForDisplay,
      normalizeCourseIdentity,
      normalizeText,
      toRenderableCourse
    };
  }
});

// ../../server/src/utils/scheduleNormalizer.js
var require_scheduleNormalizer = __commonJS({
  "../../server/src/utils/scheduleNormalizer.js"(exports2, module2) {
    var { toRenderableCourse } = require_courseNormalizer();
    function toNumber(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    }
    function ensureWeeks(course) {
      if (Array.isArray(course.weeks) && course.weeks.length) {
        return course.weeks.map(Number).filter(Boolean);
      }
      const start = toNumber(course.startWeek, 1);
      const end = toNumber(course.endWeek, start);
      const weeks = [];
      for (let week = start; week <= end; week += 1) {
        weeks.push(week);
      }
      return weeks;
    }
    function compactText(value) {
      return String(value || "").trim().replace(/\s+/g, "").replace(/[【】\[\]（）()《》<>]/g, "");
    }
    var UNRELIABLE_CLASS_NAMES = /* @__PURE__ */ new Set([
      "\u672A\u547D\u540D",
      "\u672A\u547D\u540D\u73ED\u7EA7",
      "\u672A\u77E5",
      "\u672A\u77E5\u73ED\u7EA7",
      "\u6682\u65E0",
      "\u6682\u65E0\u73ED\u7EA7",
      "\u65E0\u73ED\u7EA7"
    ]);
    var COURSE_NAME_KEYWORDS = [
      "\u5927\u5B66\u4F53\u80B2",
      "\u5927\u5B66\u751F\u804C\u4E1A\u53D1\u5C55",
      "\u5F62\u52BF\u4E0E\u653F\u7B56",
      "\u804C\u4E1A\u53D1\u5C55",
      "\u5C31\u4E1A\u6307\u5BFC",
      "\u5B9E\u9A8C\u6280\u672F",
      "\u5927\u5B66\u82F1\u8BED",
      "\u82F1\u8BED",
      "\u6709\u673A\u5316\u5B66",
      "\u5206\u6790\u5316\u5B66",
      "\u52A8\u7269\u89E3\u5256\u5B66",
      "\u52A8\u7269\u751F\u7269\u5316\u5B66",
      "\u52A8\u7269\u673A\u80FD\u5B66",
      "\u52A8\u7269\u5B66",
      "\u519B\u4E8B\u7406\u8BBA",
      "\u521B\u65B0\u521B\u4E1A",
      "\u52B3\u52A8\u6559\u80B2",
      "\u5FC3\u7406\u5065\u5EB7",
      "\u601D\u60F3\u9053\u5FB7",
      "\u9A6C\u514B\u601D\u4E3B\u4E49",
      "\u8FD1\u73B0\u4EE3\u53F2",
      "\u6BDB\u6CFD\u4E1C\u601D\u60F3",
      "\u9AD8\u7B49\u6570\u5B66",
      "\u7EBF\u6027\u4EE3\u6570",
      "\u6982\u7387\u8BBA"
    ];
    function dedupeStrings(values) {
      const seen = {};
      const result = [];
      (values || []).forEach((value) => {
        const text = String(value || "").trim();
        if (!text || seen[text]) {
          return;
        }
        seen[text] = true;
        result.push(text);
      });
      return result;
    }
    function normalizeClassName(name) {
      const compact = compactText(name).replace(/^(班级|行政班级|行政班|上课班级|授课对象|教学班|上课对象)[:：]?/, "").replace(/专业课表$/, "").trim();
      if (/\d$/.test(compact)) {
        return `${compact}\u73ED`;
      }
      return compact;
    }
    function splitClassNameCandidates(value) {
      const raw2 = Array.isArray(value) ? value.join("\u3001") : String(value || "");
      const normalized = raw2.replace(/(?:上课班级|授课对象|行政班级|行政班|班级|教学班|上课对象)\s*[:：]/g, " ").replace(/[；;,，、/／|]+/g, " ");
      const matches = [];
      const pattern = /(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g;
      let match2 = null;
      while ((match2 = pattern.exec(normalized)) !== null) {
        matches.push(normalizeClassName(match2[0]));
      }
      return dedupeStrings(matches);
    }
    function getMajorAliases(majorName) {
      const clean = compactText(majorName).replace(/[（(].*?[）)]/g, "").replace(/专业|方向|微/g, "");
      const aliases = [clean];
      if (clean.includes("\u52A8\u7269\u79D1\u5B66")) {
        aliases.push("\u52A8\u7269\u79D1\u5B66", "\u52A8\u79D1");
      }
      if (clean.includes("\u52A8\u7269\u533B\u5B66")) {
        aliases.push("\u52A8\u7269\u533B\u5B66", "\u52A8\u533B");
      }
      if (clean.includes("\u673A\u68B0\u8BBE\u8BA1\u5236\u9020\u53CA\u5176\u81EA\u52A8\u5316")) {
        aliases.push("\u673A\u68B0\u8BBE\u8BA1", "\u673A\u68B0");
      }
      if (clean.includes("\u6570\u5B66\u4E0E\u5E94\u7528\u6570\u5B66")) {
        aliases.push("\u6570\u5B66", "\u5E94\u7528\u6570\u5B66");
      }
      if (clean.length >= 2) {
        aliases.push(clean.slice(0, 2));
      }
      if (clean.length >= 4) {
        aliases.push(clean.slice(0, 4));
      }
      return dedupeStrings(aliases.filter((item) => item && item.length >= 2));
    }
    function hasClassNameShape(name, context = {}) {
      const compact = compactText(name);
      const hasGradeToken = /(?:^|[^\d])(?:20\d{2}|\d{2})级?/.test(compact) || /^(?:20\d{2}|\d{2})/.test(compact);
      const hasMajorText = /[\u4e00-\u9fa5A-Za-z]{2,}/.test(compact);
      const hasClassNo = /\d{1,2}班?$/.test(compact) || /[一二三四五六七八九十]{1,3}班$/.test(compact);
      const majorAliases = getMajorAliases(context.majorName);
      const hasMajorName = majorAliases.length ? majorAliases.some((alias) => compact.includes(alias)) : true;
      return hasGradeToken && hasMajorText && hasClassNo && hasMajorName;
    }
    function isLikelyClassName(name, context = {}) {
      const compact = compactText(normalizeClassName(name));
      if (!compact || UNRELIABLE_CLASS_NAMES.has(compact)) {
        return false;
      }
      if (/^(未命名|未知|暂无|无).*(班级|行政班|班)?$/.test(compact)) {
        return false;
      }
      const courseName = compactText(context.courseName);
      if (courseName && compact === courseName) {
        return false;
      }
      if (Array.isArray(context.courses)) {
        const cleanClassName = compact.replace(/^(20\d{2}|\d{2})级?/, "").replace(/\d+班$/, "").replace(/班$/, "");
        const isConfused = context.courses.some((course) => {
          if (!course || !course.courseName) return false;
          const cName = compactText(course.courseName);
          const cleanCName = cName.replace(/\d+$/, "");
          if (compact === cName) return true;
          if (cleanClassName && cleanCName) {
            if (cleanClassName === cleanCName) return true;
            if (cleanClassName.includes(cleanCName) || cleanCName.includes(cleanClassName)) {
              if (cleanClassName.length >= 2 && cleanCName.length >= 2) {
                return true;
              }
            }
          }
          return false;
        });
        if (isConfused) {
          return false;
        }
      }
      if (COURSE_NAME_KEYWORDS.some((keyword) => compact.includes(keyword))) {
        return false;
      }
      return hasClassNameShape(compact, context);
    }
    function isReliableClassName(name, options = {}) {
      return isLikelyClassName(name, options);
    }
    function getReliableClassNamesForCourse(course, context = {}) {
      const candidates = [];
      if (Array.isArray(course && course.classNames)) {
        candidates.push.apply(candidates, course.classNames);
      }
      [
        course && course.className,
        course && course.adminClass,
        course && course.teachingClass,
        course && course.audience,
        course && course.rawClassText
      ].forEach((value) => {
        candidates.push.apply(candidates, splitClassNameCandidates(value));
      });
      return dedupeStrings(candidates.map(normalizeClassName)).filter(
        (className) => isLikelyClassName(className, {
          courseName: course && course.courseName,
          courses: context.courses,
          majorName: context.majorName
        })
      );
    }
    function buildMajorScheduleName(context = {}) {
      const grade2 = context.grade || "";
      const majorName = context.majorName || "\u672A\u77E5\u4E13\u4E1A";
      return `${grade2}\u7EA7${majorName}\u4E13\u4E1A\u8BFE\u8868`;
    }
    function buildMajorSharedScheduleName(context = {}) {
      const grade2 = context.grade || "";
      const majorName = context.majorName || "\u672A\u77E5\u4E13\u4E1A";
      return `${grade2}\u7EA7${majorName}\u4E13\u4E1A\u5171\u4EAB\u8BFE\u7A0B`;
    }
    function withDisplayClassName(course, className, extra = {}) {
      return Object.assign({}, course, extra, {
        originalClassName: course && course.className ? course.className : "",
        className
      });
    }
    function buildClassScheduleEntries(courses, context = {}) {
      const classGroups = /* @__PURE__ */ new Map();
      const unresolvedCourses = [];
      const config = Object.assign({}, context, { courses });
      (courses || []).forEach((course) => {
        const reliableClassNames = getReliableClassNamesForCourse(course, config);
        if (reliableClassNames.length) {
          reliableClassNames.forEach((className) => {
            if (!classGroups.has(className)) {
              classGroups.set(className, []);
            }
            classGroups.get(className).push(withDisplayClassName(course, className));
          });
        } else {
          unresolvedCourses.push(course);
        }
      });
      if (classGroups.size === 0) {
        if (!courses || courses.length === 0) {
          return [];
        }
        const aggregateName = buildMajorScheduleName(context);
        return [{
          semester: context.semester,
          className: aggregateName,
          displayType: "major-schedule",
          isAggregated: true,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: courses.map((course) => withDisplayClassName(course, aggregateName, {
            sourceClassNameUnreliable: true
          }))
        }];
      }
      const classEntries = Array.from(classGroups.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true })).map(([className, groupedCourses]) => {
        const copiedUnresolved = unresolvedCourses.map((course) => withDisplayClassName(course, className, {
          sourceClassNameUnreliable: true,
          sharedByMajor: true
        }));
        return {
          semester: context.semester,
          className,
          displayType: "class-schedule",
          isAggregated: false,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: groupedCourses.concat(copiedUnresolved)
        };
      });
      if (unresolvedCourses.length) {
        const sharedName = buildMajorSharedScheduleName(context);
        classEntries.push({
          semester: context.semester,
          className: sharedName,
          displayType: "major-shared-schedule",
          isAggregated: true,
          collegeCode: context.collegeCode,
          collegeName: context.collegeName || "",
          grade: context.grade,
          majorCode: context.majorCode,
          majorName: context.majorName,
          courses: unresolvedCourses.map((course) => withDisplayClassName(course, sharedName, {
            sourceClassNameUnreliable: true,
            sharedByMajor: true
          }))
        });
      }
      return classEntries;
    }
    function normalizeCourseItem(course, context) {
      const config = context || {};
      const normalized = Object.assign({}, course);
      normalized.id = normalized.id || `${normalized.sourceType || "course"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      normalized.semester = normalized.semester || config.semester || "2025-2026\u5B66\u5E74\u7B2C\u4E8C\u5B66\u671F";
      normalized.className = normalized.className || config.className || "";
      normalized.classNames = Array.isArray(normalized.classNames) ? normalized.classNames : splitClassNameCandidates(normalized.className);
      normalized.audience = normalized.audience || "";
      normalized.teachingClass = normalized.teachingClass || "";
      normalized.adminClass = normalized.adminClass || "";
      normalized.rawClassText = normalized.rawClassText || "";
      normalized.teacherName = normalized.teacherName || config.teacherName || "";
      normalized.classroom = normalized.classroom || config.classroom || "";
      normalized.courseName = normalized.courseName || "";
      normalized.weekday = toNumber(normalized.weekday, 1);
      const hasNoSections = normalized.startSection === void 0 && normalized.endSection === void 0 && !normalized.sections;
      normalized.startSection = toNumber(normalized.startSection, hasNoSections ? null : 1);
      normalized.endSection = toNumber(normalized.endSection, normalized.startSection);
      const hasNoWeeks = (!normalized.weeks || normalized.weeks.length === 0) && normalized.startWeek === void 0 && normalized.endWeek === void 0;
      normalized.startWeek = toNumber(normalized.startWeek, hasNoWeeks ? null : 1);
      normalized.endWeek = toNumber(normalized.endWeek, normalized.startWeek);
      if (hasNoWeeks) {
        normalized.weeks = [];
        normalized.weekText = "\u5F85\u786E\u8BA4\u5468\u6B21";
      } else {
        normalized.weeks = ensureWeeks(normalized);
        normalized.weekText = normalized.weekText || `${normalized.startWeek}-${normalized.endWeek}\u5468`;
      }
      normalized.weekType = normalized.weekType || "all";
      normalized.source = normalized.source || "school";
      normalized.sourceType = normalized.sourceType || config.sourceType || "class";
      normalized.audienceType = normalized.audienceType || config.audienceType || "student";
      normalized.rawText = normalized.rawText || "";
      normalized.rawHtml = normalized.rawHtml || "";
      return toRenderableCourse(normalized);
    }
    function normalizeCourseList(courses, context) {
      return (courses || []).map((course) => normalizeCourseItem(course, context)).filter((course) => {
        if (!course.courseName) return false;
        if (course.startSection === null || course.endSection === null) {
          console.warn(`\u26A0\uFE0F \u8FC7\u6EE4\u975E\u6CD5\u8BFE\u7A0B: \u8282\u6B21\u4E3A\u7A7A \u300A${course.courseName}\u300B`);
          return false;
        }
        return true;
      });
    }
    function groupCoursesBy(courses, key, fallbackName) {
      const groups = {};
      (courses || []).forEach((course) => {
        const groupName = course[key] || fallbackName || "\u672A\u547D\u540D";
        if (!groups[groupName]) {
          groups[groupName] = [];
        }
        groups[groupName].push(course);
      });
      return groups;
    }
    module2.exports = {
      buildClassScheduleEntries,
      buildMajorScheduleName,
      buildMajorSharedScheduleName,
      groupCoursesBy,
      isLikelyClassName,
      isReliableClassName,
      normalizeCourseItem,
      normalizeCourseList
    };
  }
});

// ../../server/src/utils/safeLogger.js
var require_safeLogger = __commonJS({
  "../../server/src/utils/safeLogger.js"(exports2, module2) {
    var SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization|ticket|execution|captcha)/i;
    function maskStudentId(studentId) {
      const value = String(studentId || "").trim();
      if (!value) {
        return "";
      }
      if (value.length <= 8) {
        if (value.length <= 4) {
          return "****";
        }
        return `${value.slice(0, 2)}****${value.slice(-2)}`;
      }
      return `${value.slice(0, 4)}****${value.slice(-4)}`;
    }
    function redactSecrets(value) {
      if (Array.isArray(value)) {
        return value.map(redactSecrets);
      }
      if (value && typeof value === "object") {
        const output = {};
        Object.keys(value).forEach((key) => {
          const safeMetadataKey = /(Prefix|Masked|Configured|Kid|Mode|Status)$/i.test(key);
          output[key] = SECRET_KEY_PATTERN.test(key) && !safeMetadataKey ? "[REDACTED]" : redactSecrets(value[key]);
        });
        return output;
      }
      if (typeof value === "string") {
        return value.replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]").replace(/(ticket=)[^&\s]+/gi, "$1[REDACTED]").replace(/(password|passwd|pwd|token|authorization|execution|captcha)=([^&\s]+)/gi, "$1=[REDACTED]");
      }
      return value;
    }
    function safeLog(label, payload) {
      console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] [${label}]`, JSON.stringify(redactSecrets(payload || {})));
    }
    module2.exports = {
      maskStudentId,
      redactSecrets,
      safeLog
    };
  }
});

// ../../server/src/utils/stagingFingerprint.js
var require_stagingFingerprint = __commonJS({
  "../../server/src/utils/stagingFingerprint.js"(exports2, module2) {
    var crypto2 = require("crypto");
    var fs2 = require("fs");
    var VOLATILE_KEYS = /* @__PURE__ */ new Set([
      "activatedAt",
      "cacheEpoch",
      "canonicalHash",
      "changed",
      "dataEpoch",
      "forceRefreshToken",
      "generatedAt",
      "hash",
      "id",
      "joinedPath",
      "jsonPath",
      "meta",
      "pack",
      "packHealth",
      "publishedAt",
      "releasePack",
      "releaseVersion",
      "size",
      "stagingUploadId",
      "updatedAt",
      "version"
    ]);
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function getResources(data) {
      const source = data && data.resources && typeof data.resources === "object" ? data.resources : {};
      return {
        teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(data && data.teacherSchedules),
        classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(data && data.classroomSchedules),
        courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(data && data.courseSchedules),
        classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(data && data.classrooms),
        teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(data && data.teachers),
        courses: asArray(source.courses).length ? asArray(source.courses) : asArray(data && data.courses)
      };
    }
    function summarizeStagingData(data) {
      const catalog = data && data.catalog && typeof data.catalog === "object" ? data.catalog : {};
      const resources = getResources(data || {});
      const classSchedules = asArray(data && (data.classSchedules || data.resources && data.resources.classSchedules));
      return {
        colleges: asArray(catalog.colleges || data && data.colleges).length,
        majors: asArray(data && data.majors).length,
        classSchedules: classSchedules.length,
        teacherSchedules: resources.teacherSchedules.length,
        classroomSchedules: resources.classroomSchedules.length,
        courseSchedules: resources.courseSchedules.length,
        classrooms: resources.classrooms.length,
        teachers: resources.teachers.length,
        courses: resources.courses.length
      };
    }
    function stableClone(value) {
      if (Array.isArray(value)) {
        return value.map(stableClone);
      }
      if (!value || typeof value !== "object") {
        return value;
      }
      const output = {};
      Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort().forEach((key) => {
        const next = stableClone(value[key]);
        if (next !== void 0) output[key] = next;
      });
      return output;
    }
    function canonicalPayload(data) {
      const source = data && typeof data === "object" ? data : {};
      return stableClone({
        schemaVersion: source.schemaVersion || "",
        term: source.term || source.semester || "",
        semester: source.semester || source.term || "",
        termStartDate: source.termStartDate || source.sourceStartDate || source.meta && source.meta.startDate || "",
        catalog: source.catalog || {},
        majors: source.majors || [],
        classSchedules: source.classSchedules || source.resources && source.resources.classSchedules || [],
        resources: getResources(source),
        timeTable: source.timeTable || {}
      });
    }
    function stableStringify(value) {
      return JSON.stringify(stableClone(value));
    }
    function sha256(text) {
      return crypto2.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
    }
    function calculateFingerprint2(data) {
      const canonical = canonicalPayload(data);
      const canonicalJson = JSON.stringify(canonical);
      return {
        canonicalHash: sha256(canonicalJson),
        canonicalJson,
        counts: summarizeStagingData(data)
      };
    }
    function calculateFingerprintFromFile(filePath) {
      const raw2 = fs2.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw2);
      const fingerprint = calculateFingerprint2(data);
      return Object.assign(fingerprint, {
        data,
        rawSizeBytes: Buffer.byteLength(raw2, "utf8")
      });
    }
    function buildSidecarMeta2(data, options = {}) {
      const fingerprint = options.fingerprint || calculateFingerprint2(data);
      const previousHash = String(options.previousHash || "").trim();
      const meta2 = data && data.meta && typeof data.meta === "object" ? data.meta : {};
      const termConfig = data && data.termConfig && typeof data.termConfig === "object" ? data.termConfig : meta2.termConfig || null;
      const termConfigHash = termConfig ? sha256(JSON.stringify(termConfig)) : "";
      return {
        term: data && (data.term || data.semester) || "",
        termConfig,
        termConfigHash,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        sourceStartDate: data && (data.termStartDate || data.sourceStartDate) || meta2.startDate || "",
        includeScopes: Array.isArray(meta2.includeScopes) ? meta2.includeScopes : [],
        grades: meta2.grades || data && data.grades || "",
        counts: fingerprint.counts || summarizeStagingData(data),
        rawSizeBytes: Number(options.rawSizeBytes || 0) || 0,
        canonicalHash: fingerprint.canonicalHash,
        previousHash,
        changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
        crawlMode: meta2.crawlMode || "",
        usedProgressCache: Boolean(meta2.usedProgressCache),
        usedNoScheduleCache: Boolean(meta2.usedNoScheduleCache),
        usedClassScheduleCache: Boolean(meta2.usedClassScheduleCache),
        actualNetworkRequestCount: Number(meta2.actualNetworkRequestCount || 0),
        skippedByProgressCount: Number(meta2.skippedByProgressCount || 0),
        skippedByNoScheduleCount: Number(meta2.skippedByNoScheduleCount || 0),
        freshRunId: meta2.freshRunId || "",
        resourceSource: meta2.resourceSource || "",
        partial: Boolean(meta2.partial || data && data.partial),
        failedTargetCount: Number(meta2.failedTargetCount || 0),
        scopeSources: meta2.scopeSources || data && data.scopeSources || {}
      };
    }
    function readSidecarHash2(filePath) {
      try {
        if (!filePath || !fs2.existsSync(filePath)) return "";
        const parsed2 = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        return String(parsed2 && parsed2.canonicalHash || "").trim();
      } catch (error) {
        return "";
      }
    }
    module2.exports = {
      buildSidecarMeta: buildSidecarMeta2,
      calculateFingerprint: calculateFingerprint2,
      calculateFingerprintFromFile,
      canonicalPayload,
      readSidecarHash: readSidecarHash2,
      stableStringify,
      summarizeStagingData
    };
  }
});

// ../../server/src/services/termRegistryService.js
var require_termRegistryService = __commonJS({
  "../../server/src/services/termRegistryService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var crypto2 = require("crypto");
    var { safeLog } = require_safeLogger();
    var STORAGE_DIR = path2.resolve(process.env.FOSU_STORAGE_DIR || path2.join(__dirname, "../../storage"));
    var REGISTRY_PATH = path2.join(STORAGE_DIR, "term-registry.json");
    var BACKUP_DIR = path2.join(STORAGE_DIR, "backups", "term-registry");
    var MIGRATION_REPORT_PATH = path2.join(STORAGE_DIR, "term-registry-migration-report.json");
    var TERMS_DIR = path2.join(STORAGE_DIR, "terms");
    var LEGACY_CURRENT_TERM_CONFIG = Object.freeze({
      term: "2025-2026-2",
      semesterText: "2025-2026\u5B66\u5E74\u7B2C\u4E8C\u5B66\u671F",
      termStartDate: "2026-03-09",
      totalWeeks: 19,
      weekStart: "monday",
      source: "legacy-compatibility-fallback"
    });
    var TERM_STATUSES = /* @__PURE__ */ new Set(["planned", "ready", "current", "archived", "disabled"]);
    var WEEK_STARTS = /* @__PURE__ */ new Set(["monday", "sunday"]);
    var TERM_ID_RE = /^\d{4}-\d{4}-[12]$/;
    var registryCache = null;
    var registryCacheMtimeMs = 0;
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function readJsonFile(filePath, fallback = null) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const parsed2 = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        return parsed2 == null ? fallback : parsed2;
      } catch (error) {
        safeLog("term-registry-read-json-failed", { filePath, error: error.message });
        return fallback;
      }
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs2.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      try {
        if (fs2.existsSync(filePath) && process.platform === "win32") {
          try {
            fs2.unlinkSync(filePath);
          } catch (error) {
          }
        }
        fs2.renameSync(tempPath, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        try {
          fs2.unlinkSync(tempPath);
        } catch (cleanupError) {
        }
      }
    }
    function backupRegistry() {
      if (!fs2.existsSync(REGISTRY_PATH)) return "";
      ensureDir(BACKUP_DIR);
      const stamp = nowIso().replace(/[:.]/g, "-");
      const target = path2.join(BACKUP_DIR, `term-registry-${stamp}.json`);
      fs2.copyFileSync(REGISTRY_PATH, target);
      return target;
    }
    function validateTermId2(term) {
      const value = String(term || "").trim();
      if (!TERM_ID_RE.test(value)) {
        return { valid: false, term: value, error: "TERM_ID_FORMAT" };
      }
      const parts = value.split("-");
      const firstYear = Number(parts[0]);
      const secondYear = Number(parts[1]);
      if (secondYear !== firstYear + 1) {
        return { valid: false, term: value, error: "TERM_YEAR_RANGE" };
      }
      return { valid: true, term: value };
    }
    function assertTermId(term) {
      const result = validateTermId2(term);
      if (!result.valid) {
        const error = new Error(result.error);
        error.code = result.error;
        error.statusCode = 400;
        throw error;
      }
      return result.term;
    }
    function generateSemesterText2(term) {
      const value = assertTermId(term);
      const [startYear, endYear, half] = value.split("-");
      return `${startYear}-${endYear}\u5B66\u5E74${half === "1" ? "\u7B2C\u4E00" : "\u7B2C\u4E8C"}\u5B66\u671F`;
    }
    function normalizeTotalWeeks(value, fallback) {
      const number = Number(value == null || value === "" ? fallback : value);
      return Number.isFinite(number) ? Math.floor(number) : NaN;
    }
    function legacyTotalWeeksForTerm(term) {
      return term === LEGACY_CURRENT_TERM_CONFIG.term ? LEGACY_CURRENT_TERM_CONFIG.totalWeeks : undefined;
    }
    function normalizeTermRecord(record = {}, options = {}) {
      const source = record && typeof record === "object" ? record : {};
      const term = assertTermId(source.term || options.term);
      const now = options.now || nowIso();
      const totalWeeks = normalizeTotalWeeks(source.totalWeeks, options.defaultTotalWeeks);
      return {
        term,
        semesterText: String(source.semesterText || generateSemesterText2(term)).trim(),
        termStartDate: String(source.termStartDate || "").trim(),
        totalWeeks,
        weekStart: WEEK_STARTS.has(source.weekStart) ? source.weekStart : "monday",
        status: TERM_STATUSES.has(source.status) ? source.status : "planned",
        releaseVersion: String(source.releaseVersion || source.activeReleaseVersion || "").trim(),
        dataAvailable: Boolean(source.dataAvailable),
        publishedAt: String(source.publishedAt || "").trim(),
        updatedAt: String(source.updatedAt || now).trim(),
        source: String(source.source || options.source || "admin").trim()
      };
    }
    function isValidDateOnly(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
      const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    function validateTermRecord(record, options = {}) {
      const errors = [];
      const warnings = [];
      let normalized = null;
      try {
        normalized = normalizeTermRecord(record, options);
      } catch (error) {
        errors.push(error.code || error.message);
        return { valid: false, errors, warnings, record: null };
      }
      if (!normalized.semesterText) errors.push("SEMESTER_TEXT_EMPTY");
      if (!Number.isInteger(normalized.totalWeeks) || normalized.totalWeeks < 1 || normalized.totalWeeks > 30) {
        errors.push("TOTAL_WEEKS_INVALID");
      }
      if (!WEEK_STARTS.has(normalized.weekStart)) errors.push("WEEK_START_INVALID");
      if (!TERM_STATUSES.has(normalized.status)) errors.push("TERM_STATUS_INVALID");
      if (normalized.status !== "planned" && !isValidDateOnly(normalized.termStartDate)) {
        errors.push("TERM_START_DATE_REQUIRED");
      }
      if (normalized.status === "current" || normalized.status === "ready" || normalized.dataAvailable) {
        if (!isValidDateOnly(normalized.termStartDate)) errors.push("TERM_CONFIG_INCOMPLETE");
        if (!normalized.releaseVersion) errors.push("RELEASE_VERSION_REQUIRED");
      }
      if (normalized.status === "current" && !normalized.dataAvailable) {
        errors.push("CURRENT_TERM_DATA_UNAVAILABLE");
      }
      return { valid: errors.length === 0, errors, warnings, record: normalized };
    }
    function normalizeRegistry(raw2) {
      const source = raw2 && typeof raw2 === "object" ? raw2 : {};
      const terms = Array.isArray(source.terms) ? source.terms : [];
      const seen = /* @__PURE__ */ new Set();
      const normalizedTerms = [];
      terms.forEach((item) => {
        try {
          const normalized = normalizeTermRecord(item, { now: source.updatedAt || nowIso() });
          if (!seen.has(normalized.term)) {
            seen.add(normalized.term);
            normalizedTerms.push(normalized);
          }
        } catch (error) {
          safeLog("term-registry-skip-invalid-record", { term: item && item.term, error: error.message });
        }
      });
      const currentTerms = normalizedTerms.filter((item) => item.status === "current");
      const sourceActiveTerm = source.activeTerm && validateTermId2(source.activeTerm).valid ? source.activeTerm : "";
      const sourceActiveRecord = sourceActiveTerm ? normalizedTerms.find((item) => item.term === sourceActiveTerm && item.status === "current") : null;
      const activeTerm = sourceActiveRecord ? sourceActiveRecord.term : currentTerms[0] && currentTerms[0].term || "";
      return {
        schemaVersion: 1,
        activeTerm,
        updatedAt: String(source.updatedAt || nowIso()),
        terms: normalizedTerms
      };
    }
    function validateRegistry(registry) {
      const errors = [];
      const normalized = normalizeRegistry(registry);
      const currentTerms = normalized.terms.filter((item) => item.status === "current");
      if (currentTerms.length > 1) errors.push("MULTIPLE_CURRENT_TERMS");
      if (normalized.activeTerm && !normalized.terms.some((item) => item.term === normalized.activeTerm)) {
        errors.push("ACTIVE_TERM_NOT_REGISTERED");
      }
      if (normalized.activeTerm) {
        const active = normalized.terms.find((item) => item.term === normalized.activeTerm);
        if (active && active.status !== "current") errors.push("ACTIVE_TERM_NOT_CURRENT");
      }
      normalized.terms.forEach((item) => {
        const validation = validateTermRecord(item);
        if (!validation.valid) {
          validation.errors.forEach((error) => errors.push(`${item.term}:${error}`));
        }
      });
      return { valid: errors.length === 0, errors, registry: normalized };
    }
    function readLatestBackup() {
      try {
        if (!fs2.existsSync(BACKUP_DIR)) return null;
        const files = fs2.readdirSync(BACKUP_DIR).filter((name) => /^term-registry-.*\.json$/.test(name)).map((name) => path2.join(BACKUP_DIR, name)).sort((left, right) => fs2.statSync(right).mtimeMs - fs2.statSync(left).mtimeMs);
        for (const filePath of files) {
          const candidate = readJsonFile(filePath, null);
          const validation = validateRegistry(candidate);
          if (validation.valid) return validation.registry;
        }
      } catch (error) {
        safeLog("term-registry-backup-read-failed", { error: error.message });
      }
      return null;
    }
    function writeRegistry(registry, options = {}) {
      const normalized = normalizeRegistry(Object.assign({}, registry, { updatedAt: options.updatedAt || nowIso() }));
      const validation = validateRegistry(normalized);
      if (!validation.valid) {
        const error = new Error(`TERM_REGISTRY_INVALID: ${validation.errors.join("; ")}`);
        error.code = "TERM_REGISTRY_INVALID";
        error.errors = validation.errors;
        throw error;
      }
      if (options.backup !== false) {
        try {
          backupRegistry();
        } catch (error) {
          safeLog("term-registry-backup-failed", { error: error.message });
        }
      }
      writeJsonAtomic(REGISTRY_PATH, validation.registry);
      registryCache = validation.registry;
      registryCacheMtimeMs = fs2.existsSync(REGISTRY_PATH) ? fs2.statSync(REGISTRY_PATH).mtimeMs : 0;
      return validation.registry;
    }
    function readRegistryRaw() {
      try {
        if (!fs2.existsSync(REGISTRY_PATH)) return null;
        const stat = fs2.statSync(REGISTRY_PATH);
        if (registryCache && registryCacheMtimeMs === stat.mtimeMs) return registryCache;
        const raw2 = readJsonFile(REGISTRY_PATH, null);
        const validation = validateRegistry(raw2);
        if (!validation.valid) {
          safeLog("term-registry-invalid", { errors: validation.errors });
          return readLatestBackup();
        }
        registryCache = validation.registry;
        registryCacheMtimeMs = stat.mtimeMs;
        return registryCache;
      } catch (error) {
        safeLog("term-registry-read-failed", { error: error.message });
        return readLatestBackup();
      }
    }
    function getReleaseManifest(releaseVersion) {
      const version = String(releaseVersion || "").trim();
      if (!version) return null;
      return readJsonFile(path2.join(STORAGE_DIR, "releases", version, "manifest.json"), null) || readJsonFile(path2.join(STORAGE_DIR, "public", "releases", version, "manifest.json"), null);
    }
    function getActiveReleasePointer() {
      return readJsonFile(path2.join(STORAGE_DIR, "releases", "active.json"), null);
    }
    function resolveLegacyTermConfig(manifest, active) {
      if (manifest && manifest.termConfig && typeof manifest.termConfig === "object") {
        return Object.assign({}, manifest.termConfig);
      }
      const term = manifest && (manifest.term || manifest.semester) || active && (active.term || active.semester) || "";
      if (term === LEGACY_CURRENT_TERM_CONFIG.term) {
        return Object.assign({}, LEGACY_CURRENT_TERM_CONFIG);
      }
      return null;
    }
    function migrateLegacyTermState(options = {}) {
      ensureDir(STORAGE_DIR);
      if (fs2.existsSync(REGISTRY_PATH) && !options.force) {
        const registry = readRegistryRaw();
        return {
          success: Boolean(registry),
          migrated: false,
          reason: "registry-exists",
          registry
        };
      }
      const active = getActiveReleasePointer();
      const releaseVersion = active && (active.releaseVersion || active.version) || "";
      const manifest = getReleaseManifest(releaseVersion);
      const term = manifest && (manifest.term || manifest.semester) || active && (active.term || active.semester) || LEGACY_CURRENT_TERM_CONFIG.term;
      const termConfig = resolveLegacyTermConfig(manifest, active);
      const usedLegacyFallback = Boolean(!manifest || !manifest.termConfig);
      const warnings = [];
      if (!termConfig) {
        warnings.push("active release manifest has no termConfig and no safe legacy fallback");
      }
      if (usedLegacyFallback) {
        warnings.push("used legacy compatibility fallback for 2025-2026-2 termConfig");
      }
      if (!releaseVersion) {
        warnings.push("active release pointer missing");
      }
      try {
        const termRecord = normalizeTermRecord({
          term,
          semesterText: termConfig && termConfig.semesterText || generateSemesterText2(term),
          termStartDate: termConfig && termConfig.termStartDate || "",
          totalWeeks: termConfig && termConfig.totalWeeks || legacyTotalWeeksForTerm(term),
          weekStart: termConfig && termConfig.weekStart || "monday",
          status: releaseVersion && termConfig ? "current" : "planned",
          releaseVersion,
          dataAvailable: Boolean(releaseVersion && termConfig),
          publishedAt: active && (active.activatedAt || active.publishedAt || active.updatedAt) || manifest && (manifest.publishedAt || manifest.updatedAt) || "",
          updatedAt: active && (active.activatedAt || active.updatedAt) || manifest && manifest.updatedAt || nowIso(),
          source: "migrated-active-release"
        });
        const registry = writeRegistry({
          schemaVersion: 1,
          activeTerm: termRecord.status === "current" ? termRecord.term : "",
          updatedAt: nowIso(),
          terms: [termRecord]
        }, { backup: false });
        let copiedLegacyData = null;
        try {
          copiedLegacyData = copyLegacyTermData(termRecord.term, { overwrite: false });
        } catch (copyError) {
          warnings.push(`legacy data copy failed: ${copyError.message}`);
        }
        const report = {
          success: true,
          migrated: true,
          source: manifest ? "active-release-manifest" : "active-release-pointer",
          term: termRecord.term,
          releaseVersion,
          usedLegacyFallback,
          warnings,
          copiedLegacyData,
          storageDir: STORAGE_DIR,
          migratedAt: nowIso()
        };
        writeJsonAtomic(MIGRATION_REPORT_PATH, report);
        return Object.assign({}, report, { registry });
      } catch (error) {
        const report = {
          success: false,
          migrated: false,
          source: manifest ? "active-release-manifest" : "active-release-pointer",
          term,
          releaseVersion,
          usedLegacyFallback,
          warnings: warnings.concat(error.message),
          storageDir: STORAGE_DIR,
          migratedAt: nowIso()
        };
        writeJsonAtomic(MIGRATION_REPORT_PATH, report);
        safeLog("term-registry-migration-failed", { error: error.message, term, releaseVersion });
        return report;
      }
    }
    function readRegistry() {
      const registry = readRegistryRaw();
      if (registry) return registry;
      const migration = migrateLegacyTermState();
      if (migration && migration.registry) return migration.registry;
      return null;
    }
    function listTerms(options = {}) {
      const registry = readRegistry();
      const terms = registry && Array.isArray(registry.terms) ? registry.terms.slice() : [];
      const visible = options.includeDisabled ? terms : terms.filter((item) => item.status !== "disabled");
      return visible.sort((left, right) => {
        const statusOrder = { current: 0, ready: 1, archived: 2, planned: 3, disabled: 4 };
        const orderDiff = (statusOrder[left.status] || 9) - (statusOrder[right.status] || 9);
        if (orderDiff !== 0) return orderDiff;
        return String(right.term).localeCompare(String(left.term));
      });
    }
    function getTerm(term) {
      const id = assertTermId(term);
      const registry = readRegistry();
      return registry && registry.terms.find((item) => item.term === id) || null;
    }
    function getActiveTerm() {
      const registry = readRegistry();
      if (!registry) return null;
      return registry.terms.find((item) => item.term === registry.activeTerm && item.status === "current") || registry.terms.find((item) => item.status === "current") || null;
    }
    function mutateRegistry(mutator) {
      const registry = readRegistry() || { schemaVersion: 1, activeTerm: "", updatedAt: nowIso(), terms: [] };
      const next = normalizeRegistry(registry);
      const result = mutator(next);
      return { registry: writeRegistry(next), result };
    }
    function createPlannedTerm(input = {}) {
      const record = normalizeTermRecord(Object.assign({}, input, {
        status: "planned",
        dataAvailable: false,
        releaseVersion: "",
        publishedAt: "",
        source: input.source || "admin",
        updatedAt: nowIso()
      }));
      const validation = validateTermRecord(record);
      if (!validation.valid) {
        const error = new Error(validation.errors.join("; "));
        error.code = "TERM_RECORD_INVALID";
        error.errors = validation.errors;
        throw error;
      }
      return mutateRegistry((registry) => {
        if (registry.terms.some((item) => item.term === record.term)) {
          const error = new Error("TERM_ALREADY_EXISTS");
          error.code = "TERM_ALREADY_EXISTS";
          error.statusCode = 409;
          throw error;
        }
        registry.terms.push(record);
        return record;
      }).result;
    }
    function updateTerm(term, patch = {}) {
      const id = assertTermId(term);
      return mutateRegistry((registry) => {
        const index = registry.terms.findIndex((item) => item.term === id);
        if (index < 0) {
          const error = new Error("TERM_NOT_FOUND");
          error.code = "TERM_NOT_FOUND";
          error.statusCode = 404;
          throw error;
        }
        const current = registry.terms[index];
        if (current.status === "current" && patch.status && patch.status !== "current") {
          const error = new Error("CURRENT_TERM_STATUS_CHANGE_REQUIRES_ARCHIVE_OR_ACTIVATE");
          error.code = "CURRENT_TERM_STATUS_CHANGE_REQUIRES_ARCHIVE_OR_ACTIVATE";
          error.statusCode = 400;
          throw error;
        }
        const next = normalizeTermRecord(Object.assign({}, current, patch, {
          term: id,
          updatedAt: nowIso()
        }));
        if (next.status === "current") {
          next.dataAvailable = true;
        }
        const validation = validateTermRecord(next);
        if (!validation.valid) {
          const error = new Error(validation.errors.join("; "));
          error.code = "TERM_RECORD_INVALID";
          error.errors = validation.errors;
          throw error;
        }
        registry.terms[index] = next;
        return next;
      }).result;
    }
    function getTermConfigFromManifest(manifest) {
      const source = manifest && typeof manifest === "object" ? manifest : {};
      const config = source.termConfig && typeof source.termConfig === "object" ? source.termConfig : source;
      return normalizeTermRecord({
        term: config.term || source.term || source.semester,
        semesterText: config.semesterText || source.semesterText || "",
        termStartDate: config.termStartDate || source.termStartDate || "",
        totalWeeks: config.totalWeeks || source.totalWeeks || legacyTotalWeeksForTerm(config.term || source.term || source.semester),
        weekStart: config.weekStart || source.weekStart || "monday",
        status: "ready",
        releaseVersion: config.releaseVersion || source.releaseVersion || source.version || "",
        dataAvailable: true,
        publishedAt: source.publishedAt || source.updatedAt || "",
        updatedAt: source.updatedAt || nowIso(),
        source: config.source || source.source || "release-manifest"
      });
    }
    function validateManifestForTerm(term, releaseVersion) {
      const id = assertTermId(term);
      const manifest = getReleaseManifest(releaseVersion);
      const errors = [];
      if (!manifest) errors.push("RELEASE_MANIFEST_MISSING");
      const config = manifest ? getTermConfigFromManifest(manifest) : null;
      if (config && config.term !== id) errors.push(`MANIFEST_TERM_MISMATCH:${config.term}:${id}`);
      if (config && config.releaseVersion && String(config.releaseVersion) !== String(releaseVersion)) {
        errors.push(`MANIFEST_RELEASE_MISMATCH:${config.releaseVersion}:${releaseVersion}`);
      }
      if (config) {
        const validation = validateTermRecord(config);
        if (!validation.valid) errors.push.apply(errors, validation.errors);
      }
      return {
        valid: errors.length === 0,
        errors,
        manifest,
        termConfig: config
      };
    }
    function bindReleaseToTerm(term, releaseVersion, options = {}) {
      const id = assertTermId(term);
      const version = String(releaseVersion || "").trim();
      if (!version) {
        const error = new Error("RELEASE_VERSION_REQUIRED");
        error.code = "RELEASE_VERSION_REQUIRED";
        throw error;
      }
      const manifestCheck = options.skipManifestCheck ? { valid: true, termConfig: null, errors: [] } : validateManifestForTerm(id, version);
      if (!manifestCheck.valid) {
        const error = new Error(`TERM_RELEASE_MISMATCH: ${manifestCheck.errors.join("; ")}`);
        error.code = "TERM_RELEASE_MISMATCH";
        error.errors = manifestCheck.errors;
        throw error;
      }
      return mutateRegistry((registry) => {
        const index = registry.terms.findIndex((item) => item.term === id);
        if (index < 0) {
          const error = new Error("TERM_NOT_FOUND");
          error.code = "TERM_NOT_FOUND";
          error.statusCode = 404;
          throw error;
        }
        const current = registry.terms[index];
        const termConfig = manifestCheck.termConfig || current;
        const next = normalizeTermRecord(Object.assign({}, current, {
          semesterText: termConfig.semesterText || current.semesterText,
          termStartDate: termConfig.termStartDate || current.termStartDate,
          totalWeeks: termConfig.totalWeeks || current.totalWeeks,
          weekStart: termConfig.weekStart || current.weekStart,
          releaseVersion: version,
          status: options.status || (current.status === "current" ? "current" : "ready"),
          dataAvailable: true,
          publishedAt: options.publishedAt || termConfig.publishedAt || nowIso(),
          updatedAt: nowIso(),
          source: options.source || "release-bind"
        }));
        const validation = validateTermRecord(next);
        if (!validation.valid) {
          const error = new Error(validation.errors.join("; "));
          error.code = "TERM_RECORD_INVALID";
          error.errors = validation.errors;
          throw error;
        }
        registry.terms[index] = next;
        return next;
      }).result;
    }
    function activateTerm(term, options = {}) {
      const id = assertTermId(term);
      return mutateRegistry((registry) => {
        const target = registry.terms.find((item) => item.term === id);
        if (!target) {
          const error = new Error("TERM_NOT_FOUND");
          error.code = "TERM_NOT_FOUND";
          error.statusCode = 404;
          throw error;
        }
        if (target.status === "disabled") {
          const error = new Error("TERM_DISABLED");
          error.code = "TERM_DISABLED";
          error.statusCode = 400;
          throw error;
        }
        if (!target.dataAvailable || !target.releaseVersion) {
          const error = new Error("TERM_NOT_PUBLISHED");
          error.code = "TERM_NOT_PUBLISHED";
          error.statusCode = 400;
          throw error;
        }
        const validation = validateTermRecord(Object.assign({}, target, { status: "current", dataAvailable: true }));
        if (!validation.valid) {
          const error = new Error(validation.errors.join("; "));
          error.code = validation.errors.includes("TERM_CONFIG_INCOMPLETE") ? "TERM_CONFIG_INCOMPLETE" : "TERM_RECORD_INVALID";
          error.errors = validation.errors;
          throw error;
        }
        registry.terms = registry.terms.map((item) => {
          if (item.term === id) {
            return normalizeTermRecord(Object.assign({}, item, {
              status: "current",
              dataAvailable: true,
              updatedAt: nowIso(),
              source: options.source || item.source || "admin-activate"
            }));
          }
          if (item.status === "current") {
            return normalizeTermRecord(Object.assign({}, item, {
              status: options.archivePrevious === false ? "ready" : "archived",
              updatedAt: nowIso()
            }));
          }
          return item;
        });
        registry.activeTerm = id;
        return registry.terms.find((item) => item.term === id);
      }).result;
    }
    function archiveTerm(term) {
      const id = assertTermId(term);
      return mutateRegistry((registry) => {
        const index = registry.terms.findIndex((item) => item.term === id);
        if (index < 0) {
          const error = new Error("TERM_NOT_FOUND");
          error.code = "TERM_NOT_FOUND";
          error.statusCode = 404;
          throw error;
        }
        if (registry.terms[index].status === "current") {
          const error = new Error("CANNOT_ARCHIVE_ACTIVE_TERM");
          error.code = "CANNOT_ARCHIVE_ACTIVE_TERM";
          error.statusCode = 400;
          throw error;
        }
        registry.terms[index] = normalizeTermRecord(Object.assign({}, registry.terms[index], {
          status: "archived",
          updatedAt: nowIso()
        }));
        return registry.terms[index];
      }).result;
    }
    function disableTerm(term) {
      const id = assertTermId(term);
      return mutateRegistry((registry) => {
        const index = registry.terms.findIndex((item) => item.term === id);
        if (index < 0) {
          const error = new Error("TERM_NOT_FOUND");
          error.code = "TERM_NOT_FOUND";
          error.statusCode = 404;
          throw error;
        }
        if (registry.terms[index].status === "current") {
          const error = new Error("CANNOT_DISABLE_ACTIVE_TERM");
          error.code = "CANNOT_DISABLE_ACTIVE_TERM";
          error.statusCode = 400;
          throw error;
        }
        registry.terms[index] = normalizeTermRecord(Object.assign({}, registry.terms[index], {
          status: "disabled",
          dataAvailable: false,
          updatedAt: nowIso()
        }));
        return registry.terms[index];
      }).result;
    }
    function getSafeTermDir(term) {
      const id = assertTermId(term);
      const dir = path2.join(TERMS_DIR, id);
      const relative = path2.relative(TERMS_DIR, dir);
      if (!relative || relative.startsWith("..") || path2.isAbsolute(relative)) {
        const error = new Error("TERM_PATH_TRAVERSAL");
        error.code = "TERM_PATH_TRAVERSAL";
        throw error;
      }
      return dir;
    }
    function termDataPath(term, fileName) {
      const allowed = /* @__PURE__ */ new Set(["catalog.json", "majors-index.json", "sync-meta.json", "snapshot-meta.json"]);
      if (!allowed.has(fileName)) {
        const error = new Error("TERM_DATA_FILE_NOT_ALLOWED");
        error.code = "TERM_DATA_FILE_NOT_ALLOWED";
        throw error;
      }
      return path2.join(getSafeTermDir(term), fileName);
    }
    function hashFile(filePath) {
      if (!fs2.existsSync(filePath)) return "";
      return crypto2.createHash("sha256").update(fs2.readFileSync(filePath)).digest("hex");
    }
    function copyLegacyTermData(term, options = {}) {
      const activeTerm = assertTermId(term);
      const termDir = getSafeTermDir(activeTerm);
      ensureDir(termDir);
      const copies = [];
      const mappings = [
        ["catalog.json", "catalog.json"],
        ["majors-index.json", "majors-index.json"],
        ["sync-meta.json", "sync-meta.json"]
      ];
      mappings.forEach(([legacyName, termName]) => {
        const source = path2.join(STORAGE_DIR, legacyName);
        const target = path2.join(termDir, termName);
        if (!fs2.existsSync(source) || fs2.existsSync(target) && !options.overwrite) return;
        fs2.copyFileSync(source, target);
        const parsed2 = readJsonFile(target, null);
        const count = Array.isArray(parsed2) ? parsed2.length : parsed2 && Array.isArray(parsed2.colleges) ? parsed2.colleges.length : parsed2 && Array.isArray(parsed2.majors) ? parsed2.majors.length : 0;
        copies.push({
          file: termName,
          source,
          target,
          hash: hashFile(target),
          count
        });
      });
      if (copies.length) {
        writeJsonAtomic(path2.join(termDir, "snapshot-meta.json"), {
          term: activeTerm,
          copiedFromLegacy: true,
          copiedAt: nowIso(),
          copies
        });
      }
      return { term: activeTerm, termDir, copies };
    }
    function getPublicTerms() {
      return listTerms().filter((item) => item.status !== "disabled").map((item) => ({
        term: item.term,
        semesterText: item.semesterText,
        status: item.status,
        dataAvailable: item.dataAvailable,
        releaseVersion: item.releaseVersion,
        termStartDate: item.termStartDate,
        totalWeeks: item.totalWeeks,
        updatedAt: item.updatedAt
      }));
    }
    function getRegistryEtag(registry) {
      const data = registry || readRegistry() || {};
      const hash = crypto2.createHash("sha1").update(JSON.stringify({
        activeTerm: data.activeTerm || "",
        updatedAt: data.updatedAt || "",
        terms: (data.terms || []).map((item) => [item.term, item.status, item.releaseVersion, item.updatedAt])
      })).digest("hex");
      return `"term-registry-${hash}"`;
    }
    function clearCache() {
      registryCache = null;
      registryCacheMtimeMs = 0;
    }
    module2.exports = {
      BACKUP_DIR,
      LEGACY_CURRENT_TERM_CONFIG,
      MIGRATION_REPORT_PATH,
      REGISTRY_PATH,
      STORAGE_DIR,
      TERMS_DIR,
      TERM_STATUSES,
      activateTerm,
      archiveTerm,
      bindReleaseToTerm,
      clearCache,
      copyLegacyTermData,
      createPlannedTerm,
      disableTerm,
      generateSemesterText: generateSemesterText2,
      getActiveTerm,
      getPublicTerms,
      getRegistryEtag,
      getSafeTermDir,
      getTerm,
      getTermConfigFromManifest,
      listTerms,
      migrateLegacyTermState,
      normalizeTermRecord,
      readRegistry,
      termDataPath,
      updateTerm,
      validateManifestForTerm,
      validateTermId: validateTermId2,
      validateTermRecord,
      writeRegistry
    };
  }
});

// ../../server/src/services/termReleaseIndexService.js
var require_termReleaseIndexService = __commonJS({
  "../../server/src/services/termReleaseIndexService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var termRegistryService2 = require_termRegistryService();
    var { safeLog } = require_safeLogger();
    var STORAGE_DIR = path2.resolve(process.env.FOSU_STORAGE_DIR || path2.join(__dirname, "../../storage"));
    var RELEASES_DIR = path2.join(STORAGE_DIR, "releases");
    var TERM_INDEX_PATH = path2.join(RELEASES_DIR, "term-index.json");
    var cache = null;
    var cacheMtimeMs = 0;
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function readJsonFile(filePath, fallback = null) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const parsed2 = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        return parsed2 == null ? fallback : parsed2;
      } catch (error) {
        safeLog("term-release-index-read-json-failed", { filePath, error: error.message });
        return fallback;
      }
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs2.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      try {
        if (fs2.existsSync(filePath) && process.platform === "win32") {
          try {
            fs2.unlinkSync(filePath);
          } catch (error) {
          }
        }
        fs2.renameSync(tempPath, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        try {
          fs2.unlinkSync(tempPath);
        } catch (cleanupError) {
        }
      }
    }
    function normalizeIndex(raw2) {
      const source = raw2 && typeof raw2 === "object" ? raw2 : {};
      const terms = source.terms && typeof source.terms === "object" ? source.terms : {};
      const normalizedTerms = {};
      Object.keys(terms).forEach((term) => {
        const validation = termRegistryService2.validateTermId(term);
        if (!validation.valid) return;
        const item = terms[term] || {};
        normalizedTerms[term] = {
          activeReleaseVersion: String(item.activeReleaseVersion || "").trim(),
          previousReleaseVersion: String(item.previousReleaseVersion || "").trim(),
          updatedAt: String(item.updatedAt || nowIso())
        };
      });
      const activeTerm = source.activeTerm && termRegistryService2.validateTermId(source.activeTerm).valid ? source.activeTerm : "";
      return {
        schemaVersion: 1,
        activeTerm,
        updatedAt: String(source.updatedAt || nowIso()),
        terms: normalizedTerms
      };
    }
    function readIndex() {
      ensureDir(RELEASES_DIR);
      try {
        if (fs2.existsSync(TERM_INDEX_PATH)) {
          const stat = fs2.statSync(TERM_INDEX_PATH);
          if (cache && cacheMtimeMs === stat.mtimeMs) return cache;
          cache = normalizeIndex(readJsonFile(TERM_INDEX_PATH, {}));
          cacheMtimeMs = stat.mtimeMs;
          return cache;
        }
      } catch (error) {
        safeLog("term-release-index-read-failed", { error: error.message });
      }
      const registry = termRegistryService2.readRegistry();
      const active = registry && registry.terms.find((item) => item.status === "current");
      const initial = normalizeIndex({
        activeTerm: active && active.term || "",
        terms: Object.fromEntries((registry && registry.terms || []).map((item) => [item.term, {
          activeReleaseVersion: item.releaseVersion || "",
          previousReleaseVersion: "",
          updatedAt: item.updatedAt || nowIso()
        }]))
      });
      writeIndex(initial);
      return initial;
    }
    function writeIndex(index) {
      const normalized = normalizeIndex(Object.assign({}, index, { updatedAt: nowIso() }));
      writeJsonAtomic(TERM_INDEX_PATH, normalized);
      cache = normalized;
      cacheMtimeMs = fs2.existsSync(TERM_INDEX_PATH) ? fs2.statSync(TERM_INDEX_PATH).mtimeMs : 0;
      return normalized;
    }
    function getTermRelease(term) {
      const id = termRegistryService2.validateTermId(term).valid ? term : "";
      if (!id) return null;
      const index = readIndex();
      return index.terms[id] || null;
    }
    function getActiveReleaseVersionForTerm(term) {
      const item = getTermRelease(term);
      return item && item.activeReleaseVersion || "";
    }
    function bindRelease(term, releaseVersion, options = {}) {
      const validation = termRegistryService2.validateTermId(term);
      if (!validation.valid) {
        const error = new Error(validation.error);
        error.code = validation.error;
        throw error;
      }
      const version = String(releaseVersion || "").trim();
      if (!version) {
        const error = new Error("RELEASE_VERSION_REQUIRED");
        error.code = "RELEASE_VERSION_REQUIRED";
        throw error;
      }
      const index = readIndex();
      const previous = index.terms[validation.term] || {};
      index.terms[validation.term] = {
        activeReleaseVersion: version,
        previousReleaseVersion: options.previousReleaseVersion !== void 0 ? String(options.previousReleaseVersion || "") : String(previous.activeReleaseVersion || previous.previousReleaseVersion || ""),
        updatedAt: nowIso()
      };
      if (options.activeTerm === true) {
        index.activeTerm = validation.term;
      }
      return writeIndex(index);
    }
    function activateTerm(term, releaseVersion) {
      return bindRelease(term, releaseVersion, { activeTerm: true });
    }
    function listPinnedReleases() {
      const index = readIndex();
      const pinned = /* @__PURE__ */ new Set();
      Object.values(index.terms || {}).forEach((item) => {
        if (item.activeReleaseVersion) pinned.add(item.activeReleaseVersion);
        if (item.previousReleaseVersion) pinned.add(item.previousReleaseVersion);
      });
      return Array.from(pinned);
    }
    function getTermReleaseSummary() {
      const index = readIndex();
      return Object.entries(index.terms || {}).map(([term, item]) => ({
        term,
        activeReleaseVersion: item.activeReleaseVersion || "",
        previousReleaseVersion: item.previousReleaseVersion || "",
        updatedAt: item.updatedAt || "",
        active: index.activeTerm === term
      })).sort((left, right) => String(right.term).localeCompare(String(left.term)));
    }
    function clearCache() {
      cache = null;
      cacheMtimeMs = 0;
    }
    module2.exports = {
      TERM_INDEX_PATH,
      activateTerm,
      bindRelease,
      clearCache,
      getActiveReleaseVersionForTerm,
      getTermRelease,
      getTermReleaseSummary,
      listPinnedReleases,
      readIndex,
      writeIndex
    };
  }
});

// ../../server/src/utils/jsonFileStore.js
var require_jsonFileStore = __commonJS({
  "../../server/src/utils/jsonFileStore.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var crypto2 = require("crypto");
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      const buffer = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
      fs2.writeFileSync(tempPath, buffer);
      try {
        if (process.platform === "win32" && fs2.existsSync(filePath)) {
          try {
            fs2.unlinkSync(filePath);
          } catch (error) {
          }
        }
        fs2.renameSync(tempPath, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, buffer);
        try {
          fs2.unlinkSync(tempPath);
        } catch (cleanupError) {
        }
      }
    }
    function readJsonFile(filePath, fallback = null) {
      try {
        if (!fs2.existsSync(filePath)) return fallback;
        const parsed2 = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        return parsed2 == null ? fallback : parsed2;
      } catch (error) {
        return fallback;
      }
    }
    function readFileBufferIfExists(filePath) {
      try {
        return fs2.existsSync(filePath) ? fs2.readFileSync(filePath) : null;
      } catch (error) {
        return null;
      }
    }
    function restoreFileBuffer(filePath, buffer) {
      ensureDir(path2.dirname(filePath));
      if (buffer == null) {
        if (fs2.existsSync(filePath)) fs2.unlinkSync(filePath);
        return;
      }
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.restore.tmp`;
      fs2.writeFileSync(tempPath, buffer);
      if (process.platform === "win32" && fs2.existsSync(filePath)) {
        try {
          fs2.unlinkSync(filePath);
        } catch (error) {
        }
      }
      fs2.renameSync(tempPath, filePath);
    }
    function statJsonFile(filePath) {
      if (!fs2.existsSync(filePath)) return null;
      const stat = fs2.statSync(filePath);
      return {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        lastModified: stat.mtime.toUTCString(),
        etag: `"${crypto2.createHash("sha1").update(`${filePath}:${stat.mtimeMs}:${stat.size}`).digest("hex")}"`
      };
    }
    var SmallJsonCache = class {
      constructor(options = {}) {
        this.maxEntries = Math.max(10, Number(options.maxEntries || 100) || 100);
        this.cache = /* @__PURE__ */ new Map();
      }
      read(filePath, fallback = null) {
        const stat = statJsonFile(filePath);
        if (!stat) return fallback;
        const key = path2.resolve(filePath);
        const cached = this.cache.get(key);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          cached.usedAt = Date.now();
          return cached.value;
        }
        const value = readJsonFile(filePath, fallback);
        this.cache.set(key, {
          value,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          usedAt: Date.now()
        });
        this.prune();
        return value;
      }
      invalidate(filePath) {
        if (filePath) {
          this.cache.delete(path2.resolve(filePath));
          return;
        }
        this.clear();
      }
      clear() {
        this.cache.clear();
      }
      prune() {
        if (this.cache.size <= this.maxEntries) return;
        Array.from(this.cache.entries()).sort((left, right) => Number(left[1].usedAt || 0) - Number(right[1].usedAt || 0)).slice(0, this.cache.size - this.maxEntries).forEach(([key]) => this.cache.delete(key));
      }
    };
    module2.exports = {
      SmallJsonCache,
      ensureDir,
      readFileBufferIfExists,
      readJsonFile,
      restoreFileBuffer,
      statJsonFile,
      writeJsonAtomic
    };
  }
});

// ../../server/src/services/teachingCalendarService.js
var require_teachingCalendarService = __commonJS({
  "../../server/src/services/teachingCalendarService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var crypto2 = require("crypto");
    var termRegistryService2 = require_termRegistryService();
    var { SmallJsonCache, ensureDir, readJsonFile, statJsonFile, writeJsonAtomic } = require_jsonFileStore();
    var STORAGE_DIR = path2.resolve(process.env.FOSU_STORAGE_DIR || path2.join(__dirname, "../../storage"));
    var TERMS_DIR = path2.join(STORAGE_DIR, "terms");
    var PUBLIC_RELEASES_DIR = path2.join(STORAGE_DIR, "public", "releases");
    var RELEASES_DIR = path2.join(STORAGE_DIR, "releases");
    var TYPE_TEXT = Object.freeze({
      opening: "\u5F00\u5B66\u6559\u5B66\u5468",
      teaching: "\u6B63\u5E38\u6559\u5B66\u5468",
      holiday: "\u8282\u5047\u65E5/\u8C03\u4F11\u5468",
      adjustment: "\u8C03\u6574\u6559\u5B66\u5468",
      midterm: "\u671F\u4E2D\u6559\u5B66\u68C0\u67E5",
      closing: "\u7ED3\u8BFE\u5468",
      review: "\u590D\u4E60\u5468",
      exam: "\u8003\u8BD5\u5468",
      flexible: "\u673A\u52A8\u5468",
      pending: "\u6559\u5B66\u5B89\u6392\u5F85\u7EF4\u62A4"
    });
    var ALLOWED_TYPES = new Set(Object.keys(TYPE_TEXT));
    var cache = new SmallJsonCache({ maxEntries: 80 });
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function pad(number) {
      return String(number).padStart(2, "0");
    }
    function parseDate(value) {
      const parts = String(value || "").split("-").map(Number);
      if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    function formatDate(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    function getTermCalendarPath(term) {
      return path2.join(termRegistryService2.getSafeTermDir(term), "teaching-calendar.json");
    }
    function normalizeWeek(week, termConfig, fallbackTitle) {
      const weekNo = Number(week && (week.weekNo || week.week));
      if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > Number(termConfig.totalWeeks || 30)) return null;
      const type = ALLOWED_TYPES.has(week.type) ? week.type : "teaching";
      const typeText = String(week.typeText || TYPE_TEXT[type] || fallbackTitle || "\u6B63\u5E38\u6559\u5B66\u5468").trim();
      return {
        weekNo,
        startDate: String(week.startDate || "").trim(),
        endDate: String(week.endDate || "").trim(),
        type,
        typeText,
        title: String(week.title || fallbackTitle || typeText || "\u6B63\u5E38\u6559\u5B66\u5468").trim(),
        note: String(week.note || week.notes || "").trim()
      };
    }
    function generateWeeks(termConfig, options = {}) {
      const totalWeeks = Number(termConfig.totalWeeks);
      if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) {
        const error = new Error("TOTAL_WEEKS_REQUIRED");
        error.code = "TOTAL_WEEKS_REQUIRED";
        throw error;
      }
      const start = parseDate(termConfig.termStartDate);
      const weeks = [];
      for (let weekNo = 1; weekNo <= totalWeeks; weekNo += 1) {
        let startDate = "";
        let endDate = "";
        if (start) {
          const weekStart = new Date(start.getTime());
          weekStart.setDate(start.getDate() + (weekNo - 1) * 7);
          const weekEnd = new Date(weekStart.getTime());
          weekEnd.setDate(weekStart.getDate() + 6);
          startDate = formatDate(weekStart);
          endDate = formatDate(weekEnd);
        }
        weeks.push({
          weekNo,
          startDate,
          endDate,
          type: options.type || "pending",
          typeText: TYPE_TEXT[options.type || "pending"] || "\u6559\u5B66\u5B89\u6392\u5F85\u7EF4\u62A4",
          title: options.title || "\u6559\u5B66\u5B89\u6392\u5F85\u7EF4\u62A4",
          note: ""
        });
      }
      return weeks;
    }
    function normalizeCalendar(raw2, termRecord) {
      const source = raw2 && typeof raw2 === "object" ? raw2 : {};
      const term = String(source.term || termRecord && termRecord.term || "").trim();
      if (!term) return null;
      const record = termRecord || termRegistryService2.getTerm(term) || {};
      const termConfig = {
        term,
        semesterText: source.semesterText || record.semesterText || "",
        termStartDate: source.termStartDate || record.termStartDate || "",
        totalWeeks: source.totalWeeks || record.totalWeeks || (term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.totalWeeks : undefined),
        weekStart: source.weekStart || record.weekStart || "monday"
      };
      const defaultWeekTitle = source.defaultWeekTitle || "\u6B63\u5E38\u6559\u5B66\u5468";
      const explicitWeeks = Array.isArray(source.weeks) ? source.weeks : [];
      const generated = generateWeeks(termConfig, { type: record.status === "planned" ? "pending" : "teaching", title: record.status === "planned" ? "\u6559\u5B66\u5B89\u6392\u5F85\u7EF4\u62A4" : defaultWeekTitle });
      const byWeek = new Map(generated.map((item) => [item.weekNo, item]));
      explicitWeeks.forEach((item) => {
        const normalized = normalizeWeek(item, termConfig, defaultWeekTitle);
        if (normalized) byWeek.set(normalized.weekNo, Object.assign({}, byWeek.get(normalized.weekNo), normalized));
      });
      const weeks = Array.from(byWeek.values()).sort((left, right) => left.weekNo - right.weekNo);
      return {
        success: true,
        schemaVersion: 1,
        term,
        semesterText: termConfig.semesterText,
        termStartDate: termConfig.termStartDate,
        totalWeeks: termConfig.totalWeeks,
        weekStart: termConfig.weekStart,
        source: source.source || "admin-maintained",
        updatedAt: source.updatedAt || nowIso(),
        defaultWeekTitle,
        termConfig,
        weeks,
        count: weeks.length
      };
    }
    function readTermCalendar(term) {
      const record = termRegistryService2.getTerm(term);
      if (!record) return null;
      const filePath = getTermCalendarPath(record.term);
      const parsed2 = cache.read(filePath, null);
      if (parsed2) return normalizeCalendar(parsed2, record);
      if (record.status === "planned") {
        return normalizeCalendar({ term: record.term, source: "generated-planned" }, record);
      }
      return normalizeCalendar({ term: record.term, source: "generated-date-range", defaultWeekTitle: "\u6B63\u5E38\u6559\u5B66\u5468" }, record);
    }
    function writeTermCalendar(term, calendar) {
      const record = termRegistryService2.getTerm(term);
      if (!record) {
        const error = new Error("TERM_NOT_FOUND");
        error.code = "TERM_NOT_FOUND";
        throw error;
      }
      const normalized = normalizeCalendar(Object.assign({}, calendar, { term: record.term }), record);
      writeJsonAtomic(getTermCalendarPath(record.term), normalized);
      cache.invalidate(getTermCalendarPath(record.term));
      return normalized;
    }
    function getReleaseCalendarPath(releaseVersion, publicFile = false, options = {}) {
      if (options.releaseDir && !publicFile) return path2.join(options.releaseDir, "calendar.json");
      if (options.publicReleaseDir && publicFile) return path2.join(options.publicReleaseDir, "calendar.json");
      return path2.join(publicFile ? PUBLIC_RELEASES_DIR : RELEASES_DIR, releaseVersion, "calendar.json");
    }
    function writeReleaseCalendar(manifest, options = {}) {
      const term = manifest && (manifest.term || manifest.semester);
      const releaseVersion = manifest && (manifest.releaseVersion || manifest.version);
      if (!term || !releaseVersion) {
        const error = new Error("CALENDAR_RELEASE_CONTEXT_MISSING");
        error.code = "CALENDAR_RELEASE_CONTEXT_MISSING";
        throw error;
      }
      const calendar = options.calendar || readTermCalendar(term);
      if (!calendar || calendar.term !== term) {
        const error = new Error("CALENDAR_TERM_MISMATCH");
        error.code = "CALENDAR_TERM_MISMATCH";
        throw error;
      }
      const releaseCalendar = Object.assign({}, calendar, {
        releaseVersion,
        manifestTerm: term
      });
      [getReleaseCalendarPath(releaseVersion, false, options), getReleaseCalendarPath(releaseVersion, true, options)].forEach((target) => {
        ensureDir(path2.dirname(target));
        writeJsonAtomic(target, releaseCalendar);
        cache.invalidate(target);
      });
      return releaseCalendar;
    }
    function getCalendarHash(calendar) {
      return crypto2.createHash("sha256").update(JSON.stringify(calendar || {}, null, 2)).digest("hex");
    }
    function readReleaseCalendar(releaseVersion) {
      const publicPath = getReleaseCalendarPath(releaseVersion, true);
      const localPath = getReleaseCalendarPath(releaseVersion, false);
      return cache.read(publicPath, null) || cache.read(localPath, null);
    }
    function clearCache() {
      cache.clear();
    }
    module2.exports = {
      ALLOWED_TYPES,
      TYPE_TEXT,
      clearCache,
      generateWeeks,
      getCalendarHash,
      getReleaseCalendarPath,
      getTermCalendarPath,
      normalizeCalendar,
      readReleaseCalendar,
      readTermCalendar,
      statJsonFile,
      writeReleaseCalendar,
      writeTermCalendar
    };
  }
});

// ../../server/src/services/runtimePointerService.js
var require_runtimePointerService = __commonJS({
  "../../server/src/services/runtimePointerService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var termRegistryService2 = require_termRegistryService();
    var { SmallJsonCache, ensureDir, statJsonFile, writeJsonAtomic } = require_jsonFileStore();
    var STORAGE_DIR = path2.resolve(process.env.FOSU_STORAGE_DIR || path2.join(__dirname, "../../storage"));
    var PUBLIC_DIR = path2.join(STORAGE_DIR, "public");
    var RUNTIME_DIR = path2.join(PUBLIC_DIR, "runtime");
    var ACTIVE_RUNTIME_PATH = path2.join(RUNTIME_DIR, "active.json");
    var cache = new SmallJsonCache({ maxEntries: 20 });
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function getReleaseService() {
      return require_releaseService();
    }
    function getTermReleaseIndexService() {
      return require_termReleaseIndexService();
    }
    function pickUrl(value, fallback) {
      return String(value || fallback || "").trim();
    }
    function buildUrls(manifest) {
      const releaseVersion = manifest && (manifest.releaseVersion || manifest.version) || "";
      const staticReleaseUrl = manifest && manifest.staticReleaseUrl || (releaseVersion ? `/static/releases/${releaseVersion}` : "");
      const indexUrls = manifest && manifest.indexUrls || {};
      return {
        staticRelease: staticReleaseUrl,
        manifest: pickUrl(manifest && manifest.manifestUrl, staticReleaseUrl ? `${staticReleaseUrl}/manifest.json` : ""),
        bootstrap: pickUrl(manifest && (manifest.bootstrapUrl || manifest.catalogUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
        catalog: pickUrl(manifest && (manifest.catalogUrl || manifest.bootstrapUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
        schoolCatalog: pickUrl(manifest && (manifest.schoolCatalogUrl || manifest.catalogUrl || manifest.bootstrapUrl), staticReleaseUrl ? `${staticReleaseUrl}/bootstrap.json` : ""),
        calendar: pickUrl(manifest && manifest.calendarUrl, staticReleaseUrl ? `${staticReleaseUrl}/calendar.json` : ""),
        classIndex: pickUrl(indexUrls.class, staticReleaseUrl ? `${staticReleaseUrl}/index/class/all.json` : ""),
        teacherIndex: pickUrl(indexUrls.teacher, staticReleaseUrl ? `${staticReleaseUrl}/index/teacher/all.json` : ""),
        classroomIndex: pickUrl(indexUrls.classroom, staticReleaseUrl ? `${staticReleaseUrl}/index/classroom/all.json` : ""),
        courseIndex: pickUrl(indexUrls.course, staticReleaseUrl ? `${staticReleaseUrl}/index/course/all.json` : ""),
        emptyRoom: pickUrl(manifest && manifest.emptyRoomUrl, staticReleaseUrl ? `${staticReleaseUrl}/empty-room/index.json` : ""),
        detailPattern: pickUrl(manifest && manifest.detailUrlPattern, staticReleaseUrl ? `${staticReleaseUrl}/detail/{type}/{id}.json` : "")
      };
    }
    function normalizePointer(source) {
      const pointer = source && typeof source === "object" ? source : {};
      const activeTerm = String(pointer.activeTerm || pointer.term || pointer.termConfig && pointer.termConfig.term || "").trim();
      const releaseVersion = String(pointer.releaseVersion || pointer.version || pointer.termConfig && pointer.termConfig.releaseVersion || "").trim();
      if (!activeTerm || !releaseVersion) return null;
      const urls = pointer.urls || pointer.staticUrls || {};
      const termConfig = pointer.termConfig || null;
      const semesterText = pointer.semesterText || termConfig && termConfig.semesterText || "";
      return {
        success: pointer.success !== false,
        schemaVersion: 1,
        activeTerm,
        term: activeTerm,
        semester: pointer.semester || activeTerm,
        semesterText,
        releaseVersion,
        updatedAt: pointer.updatedAt || nowIso(),
        cacheEpoch: Number(pointer.cacheEpoch || 0) || 0,
        forceRefreshToken: pointer.forceRefreshToken || "",
        termConfig,
        urls,
        staticUrls: pointer.staticUrls || urls,
        manifestUrl: pointer.manifestUrl || urls.manifest || "",
        calendarUrl: pointer.calendarUrl || urls.calendar || "",
        bootstrapUrl: pointer.bootstrapUrl || urls.bootstrap || urls.catalog || "",
        catalogUrl: pointer.catalogUrl || urls.catalog || urls.bootstrap || "",
        classCatalogUrl: pointer.classCatalogUrl || urls.classIndex || "",
        schoolCatalogUrl: pointer.schoolCatalogUrl || urls.schoolCatalog || urls.catalog || "",
        source: pointer.source || "static-runtime-active"
      };
    }
    function hasCompletePointerPayload(pointer) {
      if (!pointer) return false;
      const termConfig = pointer.termConfig || {};
      const urls = pointer.urls || pointer.staticUrls || {};
      return Boolean(
        pointer.cacheEpoch && termConfig.termStartDate && (termConfig.semesterText || pointer.semesterText) && (pointer.calendarUrl || urls.calendar) && (pointer.bootstrapUrl || pointer.catalogUrl || urls.bootstrap || urls.catalog) && (pointer.classCatalogUrl || urls.classIndex) && (pointer.schoolCatalogUrl || urls.schoolCatalog || urls.catalog)
      );
    }
    function buildPointerFromManifest(manifest) {
      if (!manifest || manifest.success === false) return null;
      const term = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
      const releaseVersion = manifest.releaseVersion || manifest.version || "";
      if (!term || !releaseVersion) return null;
      const termConfig = manifest.termConfig || {
        term,
        semesterText: manifest.semesterText || "",
        termStartDate: manifest.termStartDate || "",
        totalWeeks: manifest.totalWeeks || (term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.totalWeeks : undefined),
        weekStart: manifest.weekStart || "monday"
      };
      return normalizePointer({
        activeTerm: term,
        semester: manifest.semester || term,
        semesterText: termConfig.semesterText || manifest.semesterText || "",
        releaseVersion,
        updatedAt: manifest.updatedAt || manifest.publishedAt || nowIso(),
        cacheEpoch: manifest.cacheEpoch || manifest.dataEpoch || Date.parse(manifest.updatedAt || "") || Date.now(),
        forceRefreshToken: manifest.forceRefreshToken || "",
        termConfig,
        urls: buildUrls(manifest),
        staticUrls: buildUrls(manifest),
        source: "release-manifest"
      });
    }
    function readActivePointer() {
      return normalizePointer(cache.read(ACTIVE_RUNTIME_PATH, null));
    }
    function getActivePointerStats() {
      return statJsonFile(ACTIVE_RUNTIME_PATH);
    }
    function shouldRebuildExistingPointer(pointer, options = {}) {
      if (!pointer || options.force) return true;
      if (!hasCompletePointerPayload(pointer)) return true;
      const activeTerm = termRegistryService2.getActiveTerm();
      if (activeTerm && activeTerm.term) {
        if (pointer.activeTerm !== activeTerm.term) return true;
        if (activeTerm.releaseVersion && pointer.releaseVersion !== activeTerm.releaseVersion) return true;
      }
      if (options.term && pointer.activeTerm !== options.term) return true;
      if (options.releaseVersion && pointer.releaseVersion !== options.releaseVersion) return true;
      return false;
    }
    function resolveActiveRuntimeManifest(options = {}) {
      const releaseService2 = getReleaseService();
      const termReleaseIndexService = getTermReleaseIndexService();
      const activeTerm = termRegistryService2.getActiveTerm();
      const activeRelease = releaseService2.getActiveReleaseInfo && releaseService2.getActiveReleaseInfo() || null;
      const term = String(
        options.term || activeTerm && activeTerm.term || activeRelease && (activeRelease.term || activeRelease.semester) || ""
      ).trim();
      const releaseVersion = String(
        options.releaseVersion || activeTerm && activeTerm.releaseVersion || term && termReleaseIndexService.getActiveReleaseVersionForTerm(term) || activeRelease && (activeRelease.releaseVersion || activeRelease.version) || ""
      ).trim();
      if (!releaseVersion) {
        const error = new Error("ACTIVE_RELEASE_VERSION_MISSING");
        error.code = "ACTIVE_RELEASE_VERSION_MISSING";
        error.term = term;
        throw error;
      }
      const manifest = releaseService2.getReleasePackManifest(releaseVersion, term ? { term } : {});
      if (!manifest || manifest.success === false) {
        const error = new Error(manifest && (manifest.code || manifest.reasonCode) || "ACTIVE_RELEASE_MANIFEST_MISSING");
        error.code = manifest && (manifest.code || manifest.reasonCode) || "ACTIVE_RELEASE_MANIFEST_MISSING";
        error.term = term;
        error.releaseVersion = releaseVersion;
        throw error;
      }
      const manifestTerm = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
      if (term && manifestTerm && manifestTerm !== term) {
        const error = new Error("RUNTIME_POINTER_TERM_MISMATCH");
        error.code = "RUNTIME_POINTER_TERM_MISMATCH";
        error.expectedTerm = term;
        error.actualTerm = manifestTerm;
        error.releaseVersion = releaseVersion;
        throw error;
      }
      return manifest;
    }
    function ensureActivePointer(options = {}) {
      const existing = readActivePointer();
      if (!shouldRebuildExistingPointer(existing, options)) {
        return existing;
      }
      const manifest = resolveActiveRuntimeManifest(options);
      return writeActivePointerForManifest(manifest, {
        allowInactiveTerm: options.allowInactiveTerm
      });
    }
    function writeActivePointerForManifest(manifest, options = {}) {
      if (!manifest || manifest.success === false) {
        const error = new Error("RUNTIME_POINTER_MANIFEST_MISSING");
        error.code = "RUNTIME_POINTER_MANIFEST_MISSING";
        throw error;
      }
      const pointer = buildPointerFromManifest(manifest);
      if (!pointer) {
        const error = new Error("RUNTIME_POINTER_INVALID_MANIFEST");
        error.code = "RUNTIME_POINTER_INVALID_MANIFEST";
        throw error;
      }
      const activeTerm = termRegistryService2.getActiveTerm();
      if (activeTerm && activeTerm.term && activeTerm.term !== pointer.activeTerm && !options.allowInactiveTerm) {
        const error = new Error("RUNTIME_POINTER_TERM_NOT_ACTIVE");
        error.code = "RUNTIME_POINTER_TERM_NOT_ACTIVE";
        error.activeTerm = activeTerm.term;
        error.pointerTerm = pointer.activeTerm;
        throw error;
      }
      ensureDir(RUNTIME_DIR);
      writeJsonAtomic(ACTIVE_RUNTIME_PATH, pointer);
      cache.invalidate(ACTIVE_RUNTIME_PATH);
      return pointer;
    }
    function clearCache() {
      cache.clear();
    }
    module2.exports = {
      ACTIVE_RUNTIME_PATH,
      RUNTIME_DIR,
      buildPointerFromManifest,
      clearCache,
      ensureActivePointer,
      getActivePointerStats,
      readActivePointer,
      resolveActiveRuntimeManifest,
      writeActivePointerForManifest
    };
  }
});

// ../../server/src/shared/resourceCountContract.js
var require_resourceCountContract = __commonJS({
  "../../server/src/shared/resourceCountContract.js"(exports2, module2) {
    var RESOURCE_DIMENSIONS = ["teacher", "classroom", "course"];
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function getResources(snapshot) {
      const source = snapshot && snapshot.resources && typeof snapshot.resources === "object" ? snapshot.resources : {};
      const top = snapshot && typeof snapshot === "object" ? snapshot : {};
      const directoryArray = (key) => {
        if (Array.isArray(source[key])) return source[key];
        if (Array.isArray(top[key])) return top[key];
        return null;
      };
      const scheduleArray = (key) => {
        if (Array.isArray(source[key])) return source[key];
        if (Array.isArray(top[key])) return top[key];
        return [];
      };
      return {
        teachers: directoryArray("teachers"),
        classrooms: directoryArray("classrooms"),
        courses: directoryArray("courses"),
        teacherSchedules: scheduleArray("teacherSchedules"),
        classroomSchedules: scheduleArray("classroomSchedules"),
        courseSchedules: scheduleArray("courseSchedules")
      };
    }
    function firstText(item, keys) {
      for (const key of keys) {
        const value = String(item && item[key] || "").trim();
        if (value) return value;
      }
      return "";
    }
    function countUnique(items2, keys) {
      const values = /* @__PURE__ */ new Set();
      asArray(items2).forEach((item) => {
        const text = firstText(item, keys);
        if (text) values.add(text);
      });
      return values.size;
    }
    function countCourseEvents(items2) {
      return asArray(items2).reduce((sum, item) => {
        if (Array.isArray(item && item.courses)) return sum + item.courses.length;
        const count = Number(item && item.courseCount || 0);
        return sum + (Number.isFinite(count) && count > 0 ? count : 0);
      }, 0);
    }
    function countDirectory(items2, keys) {
      if (!Array.isArray(items2)) {
        return { value: null, status: "not-counted" };
      }
      return { value: countUnique(items2, keys), status: "counted" };
    }
    function scheduleSourceMode(snapshot, scopeName, fallback) {
      const sources = snapshot && (snapshot.scopeSources || snapshot.meta && snapshot.meta.scopeSources) || {};
      const source = sources && sources[scopeName] || {};
      return source.sourceMode || fallback || "unknown";
    }
    function normalizeScopeFilters(snapshot, options = {}) {
      return Object.assign(
        {},
        snapshot && snapshot.scopeFilters || {},
        snapshot && snapshot.meta && snapshot.meta.scopeFilters || {},
        options.scopeFilters || {}
      );
    }
    function normalizeScopeSources(snapshot) {
      return Object.assign(
        {},
        snapshot && snapshot.scopeSources || {},
        snapshot && snapshot.meta && snapshot.meta.scopeSources || {}
      );
    }
    function isInvalidTeacherName2(value) {
      const text = String(value || "").trim();
      if (!text) return true;
      if (/^\d+$/.test(text)) return true;
      const rules = [
        /\u4e34\u73ed/,
        /\u4e13\u4e1a\u8bfe\u8868/,
        /\d{2,}.*\u73ed/,
        /\u73ed$/,
        /\u5927\u5b66/,
        /\u4f53\u80b2/,
        /\u5b9e\u9a8c/,
        /\u5b9e\u8df5/,
        /\u8bfe\u7a0b/,
        /\u6982\u8bba/,
        /\u7406\u8bba/,
        /\u57fa\u7840/,
        /\u8bbe\u8ba1/,
        /\u6784\u6210/,
        /\u62a4\u7406\u5b66/,
        /\u513f\u79d1\u5b66/,
        /\u5149\u5b66/,
        /\u79cd\u690d\u5b66/,
        /\u6210\u578b/,
        /\u6559\u5ba4/,
        /\u5ba4$/,
        /\u697c$/
      ];
      return rules.some((rule) => rule.test(text));
    }
    function buildTeacherQualityDiagnostics(snapshot, teacherSchedules, scopeSources) {
      const names = asArray(teacherSchedules).map((item) => firstText(item, ["teacherName", "name", "displayName", "title"]));
      const invalidNames = names.filter(isInvalidTeacherName2);
      const teacherScope = scopeSources.teacherSchedules || {};
      const diagnostics = [];
      const targetDiscoveryMode = teacherScope.targetDiscoveryMode || teacherScope.source || "";
      const usedCollegeTargets = targetDiscoveryMode === "college-select" || Number(teacherScope.requested || 0) > 0 && Number(teacherScope.requested || 0) <= 30 && !Number.isFinite(Number(teacherScope.discoveredTeacherTargets));
      if (usedCollegeTargets || invalidNames.length > 0 || teacherScope.coverageStatus === "invalid") {
        diagnostics.push({
          code: "ENTITY_NAME_CONTAMINATED",
          severity: "error",
          resource: "teacher",
          message: "\u6559\u5E08\u540D\u79F0\u7591\u4F3C\u88AB\u73ED\u7EA7\u540D\u6216\u8BFE\u7A0B\u540D\u6C61\u67D3\uFF0C\u5F53\u524D\u76F4\u6293\u7ED3\u679C\u4E0D\u53EF\u53D1\u5E03\u3002",
          targetDiscoveryMode: targetDiscoveryMode || (usedCollegeTargets ? "college-select" : "unknown"),
          discoveredTeacherTargets: teacherScope.discoveredTeacherTargets == null ? null : teacherScope.discoveredTeacherTargets,
          requestGroupCount: Number(teacherScope.requestGroupCount || teacherScope.requested || 0) || 0,
          scheduleDocumentCount: asArray(teacherSchedules).length,
          invalidTeacherNameCount: invalidNames.length,
          invalidTeacherNameSamples: invalidNames.slice(0, 12),
          coverageStatus: "invalid",
          publishable: false
        });
      }
      return diagnostics;
    }
    function buildClassCounts(snapshot) {
      const classSchedules = asArray(snapshot && (snapshot.classSchedules || snapshot.resources && snapshot.resources.classSchedules));
      const administrativeClasses = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
      const aggregateSchedules = classSchedules.filter((item) => item.displayType === "major-aggregate" || item.isAggregated).length;
      return {
        scheduleDocuments: classSchedules.length,
        administrativeClasses,
        aggregateSchedules: aggregateSchedules || Math.max(0, classSchedules.length - administrativeClasses),
        courseEvents: countCourseEvents(classSchedules)
      };
    }
    function buildResourceCounts(snapshot, options = {}) {
      const resources = getResources(snapshot);
      const teacherDirectory = countDirectory(
        Array.isArray(resources.teachers) ? resources.teachers : null,
        ["teacherName", "name", "displayName", "id"]
      );
      const classroomDirectory = countDirectory(
        Array.isArray(resources.classrooms) ? resources.classrooms : null,
        ["classroomName", "roomName", "name", "id"]
      );
      const courseDirectory = countDirectory(
        Array.isArray(resources.courses) ? resources.courses : null,
        ["courseName", "name", "title", "id"]
      );
      return {
        teacher: {
          directoryEntities: teacherDirectory.value,
          directoryEntitiesStatus: teacherDirectory.status,
          scheduleDocuments: resources.teacherSchedules.length,
          courseEvents: countCourseEvents(resources.teacherSchedules),
          sourceMode: scheduleSourceMode(snapshot, "teacherSchedules", options.teacherSourceMode)
        },
        classroom: {
          directoryEntities: classroomDirectory.value,
          directoryEntitiesStatus: classroomDirectory.status,
          scheduleDocuments: resources.classroomSchedules.length,
          courseEvents: countCourseEvents(resources.classroomSchedules),
          sourceMode: scheduleSourceMode(snapshot, "classroomSchedules", options.classroomSourceMode)
        },
        course: {
          directoryEntities: courseDirectory.value,
          directoryEntitiesStatus: courseDirectory.status,
          scheduleDocuments: resources.courseSchedules.length,
          courseEvents: countCourseEvents(resources.courseSchedules),
          sourceMode: scheduleSourceMode(snapshot, "courseSchedules", options.courseSourceMode)
        }
      };
    }
    function buildCatalogCounts(snapshot) {
      const catalog = snapshot && snapshot.catalog || {};
      return {
        colleges: asArray(catalog.colleges || snapshot && snapshot.colleges).length,
        grades: asArray(catalog.grades || snapshot && snapshot.grades).length,
        majors: asArray(catalog.majors || snapshot && snapshot.majors).length
      };
    }
    function buildResourceCountContract(snapshot, options = {}) {
      const sourceSnapshot = snapshot || {};
      const scopeSources = normalizeScopeSources(sourceSnapshot);
      const resourceCounts = buildResourceCounts(sourceSnapshot, options);
      const diagnostics = [].concat(asArray(sourceSnapshot.diagnostics)).concat(asArray(sourceSnapshot.meta && sourceSnapshot.meta.diagnostics)).concat(buildTeacherQualityDiagnostics(sourceSnapshot, getResources(sourceSnapshot).teacherSchedules, scopeSources));
      const coverage = Object.assign(
        {},
        sourceSnapshot.coverage || {},
        sourceSnapshot.meta && sourceSnapshot.meta.coverage || {}
      );
      if (diagnostics.some((item) => item.resource === "teacher" && item.coverageStatus === "invalid")) {
        coverage.teacher = Object.assign({}, coverage.teacher || {}, {
          coverageStatus: "invalid",
          publishable: false
        });
      }
      return {
        countSchemaVersion: 2,
        term: sourceSnapshot.term || sourceSnapshot.semester || sourceSnapshot.termConfig && sourceSnapshot.termConfig.term || options.term || "",
        class: buildClassCounts(sourceSnapshot),
        teacher: resourceCounts.teacher,
        classroom: resourceCounts.classroom,
        course: resourceCounts.course,
        catalog: buildCatalogCounts(sourceSnapshot),
        scopeFilters: normalizeScopeFilters(sourceSnapshot, options),
        scopeSources,
        coverage,
        diagnostics,
        derivedFromLegacy: Boolean(options.derivedFromLegacy || sourceSnapshot.derivedFromLegacy)
      };
    }
    function deriveLegacyResourceCountContract(snapshot, manifest = {}) {
      const counts = Object.assign({}, snapshot && snapshot.coverage || {}, manifest && manifest.counts || {});
      const base = buildResourceCountContract(snapshot || {}, {
        derivedFromLegacy: true,
        teacherSourceMode: "legacy-derived",
        classroomSourceMode: "legacy-derived",
        courseSourceMode: "legacy-derived"
      });
      const indexCounts = manifest && manifest.pack && manifest.pack.index || {};
      const teacherCount = Number(counts.teacherScheduleCount || indexCounts.teacher || 0) || base.teacher.scheduleDocuments;
      const classroomCount = Number(counts.classroomScheduleCount || indexCounts.classroom || 0) || base.classroom.scheduleDocuments;
      const courseCount = Number(counts.courseScheduleCount || indexCounts.course || 0) || base.course.scheduleDocuments;
      return Object.assign({}, base, {
        class: Object.assign({}, base.class, {
          scheduleDocuments: Number(counts.classScheduleCount || 0) || base.class.scheduleDocuments,
          administrativeClasses: Number(counts.adminClassCount || 0) || base.class.administrativeClasses,
          aggregateSchedules: Number(counts.majorAggregateCount || 0) || base.class.aggregateSchedules
        }),
        teacher: Object.assign({}, base.teacher, {
          directoryEntities: base.teacher.directoryEntitiesStatus === "counted" ? base.teacher.directoryEntities : teacherCount || null,
          directoryEntitiesStatus: base.teacher.directoryEntitiesStatus === "counted" ? "counted" : teacherCount ? "derived-from-legacy-index" : "not-counted",
          scheduleDocuments: teacherCount,
          sourceMode: "legacy-derived"
        }),
        classroom: Object.assign({}, base.classroom, {
          directoryEntities: base.classroom.directoryEntitiesStatus === "counted" ? base.classroom.directoryEntities : classroomCount || null,
          directoryEntitiesStatus: base.classroom.directoryEntitiesStatus === "counted" ? "counted" : classroomCount ? "derived-from-legacy-index" : "not-counted",
          scheduleDocuments: classroomCount,
          sourceMode: "legacy-derived"
        }),
        course: Object.assign({}, base.course, {
          directoryEntities: base.course.directoryEntitiesStatus === "counted" ? base.course.directoryEntities : courseCount || null,
          directoryEntitiesStatus: base.course.directoryEntitiesStatus === "counted" ? "counted" : courseCount ? "derived-from-legacy-index" : "not-counted",
          scheduleDocuments: courseCount,
          sourceMode: "legacy-derived"
        }),
        catalog: {
          colleges: Number(counts.collegeCount || counts.collegesCount || 0) || base.catalog.colleges,
          grades: base.catalog.grades,
          majors: Number(counts.majorCount || counts.majorsCount || 0) || base.catalog.majors
        },
        derivedFromLegacy: true
      });
    }
    function flattenLegacyCounts(contract) {
      const value = contract || {};
      return {
        collegeCount: value.catalog && value.catalog.colleges || 0,
        collegesCount: value.catalog && value.catalog.colleges || 0,
        majorCount: value.catalog && value.catalog.majors || 0,
        majorsCount: value.catalog && value.catalog.majors || 0,
        gradeCount: value.catalog && value.catalog.grades || 0,
        classScheduleCount: value.class && value.class.scheduleDocuments || 0,
        adminClassCount: value.class && value.class.administrativeClasses || 0,
        majorAggregateCount: value.class && value.class.aggregateSchedules || 0,
        teacherScheduleCount: value.teacher && value.teacher.scheduleDocuments || 0,
        classroomScheduleCount: value.classroom && value.classroom.scheduleDocuments || 0,
        courseScheduleCount: value.course && value.course.scheduleDocuments || 0,
        teacherCount: value.teacher && value.teacher.directoryEntitiesStatus === "counted" ? value.teacher.directoryEntities : 0,
        classroomCount: value.classroom && value.classroom.directoryEntitiesStatus === "counted" ? value.classroom.directoryEntities : 0,
        courseCount: value.course && value.course.directoryEntitiesStatus === "counted" ? value.course.directoryEntities : 0
      };
    }
    function sameJson(left, right) {
      return JSON.stringify(left || {}) === JSON.stringify(right || {});
    }
    function metricDiff(activeValue, stagingValue) {
      const activeNum = Number(activeValue || 0);
      const stagingNum = Number(stagingValue || 0);
      const delta = stagingNum - activeNum;
      return {
        active: activeNum,
        staging: stagingNum,
        delta,
        percent: activeNum ? Number((delta / activeNum * 100).toFixed(2)) : null
      };
    }
    var METRIC_LABELS = {
      "teacher.scheduleDocuments": "\u6559\u5E08\u8BFE\u8868",
      "teacher.directoryEntities": "\u6559\u5E08\u76EE\u5F55",
      "teacher.courseEvents": "\u6559\u5E08\u8BFE\u7A0B\u4E8B\u4EF6",
      "classroom.scheduleDocuments": "\u6559\u5BA4\u8BFE\u8868",
      "classroom.directoryEntities": "\u6559\u5BA4\u76EE\u5F55",
      "classroom.courseEvents": "\u6559\u5BA4\u8BFE\u7A0B\u4E8B\u4EF6",
      "course.scheduleDocuments": "\u8BFE\u7A0B\u8BFE\u8868",
      "course.directoryEntities": "\u8BFE\u7A0B\u76EE\u5F55",
      "course.courseEvents": "\u8BFE\u7A0B\u6392\u8BFE\u4E8B\u4EF6",
      "class.scheduleDocuments": "\u73ED\u7EA7\u8BFE\u8868",
      "class.administrativeClasses": "\u884C\u653F\u73ED",
      "class.aggregateSchedules": "\u4E13\u4E1A\u805A\u5408"
    };
    function compareMetric(active, staging, resource, field) {
      const path2 = `${resource}.${field}`;
      const activeResource = active && active[resource] || {};
      const stagingResource = staging && staging[resource] || {};
      const diff = metricDiff(activeResource[field], stagingResource[field]);
      return Object.assign({
        path: path2,
        resource,
        field,
        label: METRIC_LABELS[path2] || path2
      }, diff);
    }
    function compareResourceCountContracts(active, staging) {
      const blockers = [];
      const warnings = [];
      const comparisons = [];
      const activeVersion = Number(active && active.countSchemaVersion || 0);
      const stagingVersion = Number(staging && staging.countSchemaVersion || 0);
      if (activeVersion !== stagingVersion) {
        blockers.push({
          code: "COUNT_CONTRACT_MISMATCH",
          message: `\u7EDF\u8BA1\u5951\u7EA6\u7248\u672C\u4E0D\u4E00\u81F4\uFF0C\u5F53\u524D\u7EBF\u4E0A v${activeVersion || "\u672A\u77E5"}\uFF0C\u672C\u6B21\u6682\u5B58 v${stagingVersion || "\u672A\u77E5"}\u3002`
        });
      }
      if (active && active.term && (staging && staging.term) && active.term !== staging.term) {
        blockers.push({
          code: "SCOPE_FILTER_MISMATCH",
          message: `\u5B66\u671F\u4E0D\u4E00\u81F4\uFF0C\u5F53\u524D\u7EBF\u4E0A ${active.term}\uFF0C\u672C\u6B21\u6682\u5B58 ${staging.term}\u3002`
        });
      }
      if (!sameJson(active && active.scopeFilters, staging && staging.scopeFilters)) {
        blockers.push({
          code: "SCOPE_FILTER_MISMATCH",
          message: "\u7EDF\u8BA1\u8FC7\u6EE4\u8303\u56F4\u4E0D\u4E00\u81F4\uFF0C\u4E0D\u80FD\u76F4\u63A5\u6BD4\u8F83\u3002"
        });
      }
      RESOURCE_DIMENSIONS.forEach((resource) => {
        const activeMode = active && active[resource] && active[resource].sourceMode || "unknown";
        const stagingMode = staging && staging[resource] && staging[resource].sourceMode || "unknown";
        if (activeMode !== stagingMode) {
          blockers.push({
            code: "SOURCE_MODE_MISMATCH",
            resource,
            message: `${METRIC_LABELS[`${resource}.scheduleDocuments`] || resource} \u6765\u6E90\u53E3\u5F84\u4E0D\u4E00\u81F4\uFF0C\u5F53\u524D\u7EBF\u4E0A ${sourceModeLabel(activeMode)}\uFF0C\u672C\u6B21\u6682\u5B58 ${sourceModeLabel(stagingMode)}\u3002`
          });
        }
        ["directoryEntities", "scheduleDocuments", "courseEvents"].forEach((field) => {
          comparisons.push(compareMetric(active, staging, resource, field));
        });
      });
      ["scheduleDocuments", "administrativeClasses", "aggregateSchedules", "courseEvents"].forEach((field) => {
        comparisons.push(compareMetric(active, staging, "class", field));
      });
      asArray(staging && staging.diagnostics).forEach((diagnostic) => {
        if (diagnostic && diagnostic.publishable === false) {
          blockers.push({
            code: diagnostic.code || "COVERAGE_INVALID",
            resource: diagnostic.resource || "",
            message: diagnostic.message || "\u6570\u636E\u8986\u76D6\u8D28\u91CF\u4E0D\u901A\u8FC7\uFF0C\u7981\u6B62\u53D1\u5E03\u3002",
            diagnostic
          });
        }
      });
      if (staging && staging.coverage && staging.coverage.teacher && staging.coverage.teacher.publishable === false) {
        blockers.push({
          code: "COVERAGE_INVALID",
          resource: "teacher",
          message: "\u6559\u5E08\u6570\u636E\u8986\u76D6\u72B6\u6001\u65E0\u6548\uFF0C\u7981\u6B62\u53D1\u5E03\u3002"
        });
      }
      return {
        allowPublish: blockers.length === 0,
        blockers,
        warnings,
        comparisons
      };
    }
    function sourceModeLabel(value) {
      const key = String(value || "unknown");
      const labels = {
        "legacy-derived": "\u5386\u53F2\u6D3E\u751F\u53E3\u5F84",
        "derived": "\u5386\u53F2\u6D3E\u751F\u53E3\u5F84",
        "derived-current-run": "\u672C\u6B21\u73ED\u7EA7\u8BFE\u8868\u6D3E\u751F",
        "network-direct": "100\u7F51\u76F4\u63A5\u6293\u53D6",
        unknown: "\u672A\u6807\u660E"
      };
      return labels[key] || key;
    }
    function formatResourceMetricValue(metric) {
      if (metric == null || metric === "") return "\u672A\u7EDF\u8BA1";
      const value = typeof metric === "object" && Object.prototype.hasOwnProperty.call(metric, "value") ? metric.value : metric;
      if (value == null) return "\u672A\u7EDF\u8BA1";
      return String(value);
    }
    module2.exports = {
      buildResourceCountContract,
      compareResourceCountContracts,
      deriveLegacyResourceCountContract,
      flattenLegacyCounts,
      formatResourceMetricValue,
      isInvalidTeacherName: isInvalidTeacherName2,
      sourceModeLabel
    };
  }
});

// ../../server/src/utils/buildingNormalizer.js
var require_buildingNormalizer = __commonJS({
  "../../server/src/utils/buildingNormalizer.js"(exports2, module2) {
    var UNKNOWN_BUILDING_CODE = "UNKNOWN";
    var UNKNOWN_BUILDING_NAME = "\u5176\u4ED6/\u672A\u8BC6\u522B";
    var KNOWN_BUILDINGS = [
      { pattern: /会通楼/, code: "\u4F1A\u901A\u697C", name: "\u4F1A\u901A\u697C", campus: "\u4ED9\u6EAA\u6821\u533A", confidence: 0.98 },
      { pattern: /致用楼/, code: "\u81F4\u7528\u697C", name: "\u81F4\u7528\u697C", campus: "\u4ED9\u6EAA\u6821\u533A", confidence: 0.98 }
    ];
    function normalizeText(value) {
      return String(value || "").replace(/[（）]/g, "").replace(/\s+/g, "").trim();
    }
    function normalizeCampus(text, code) {
      if (/江湾/.test(text)) return "\u6C5F\u6E7E\u6821\u533A";
      if (/仙溪/.test(text)) return "\u4ED9\u6EAA\u6821\u533A";
      if (/^[A-H]\d{1,2}$/i.test(code || "")) return "\u4ED9\u6EAA\u6821\u533A";
      return "";
    }
    function normalizeBuilding(roomName) {
      const raw2 = String(roomName || "").trim();
      const text = normalizeText(raw2);
      if (!text) {
        return {
          buildingCode: UNKNOWN_BUILDING_CODE,
          buildingName: UNKNOWN_BUILDING_NAME,
          roomName: raw2,
          campus: "",
          confidence: 0,
          unknown: true
        };
      }
      const known = KNOWN_BUILDINGS.find((item) => item.pattern.test(text));
      if (known) {
        return {
          buildingCode: known.code,
          buildingName: known.name,
          roomName: raw2,
          campus: known.campus,
          confidence: known.confidence,
          unknown: false
        };
      }
      const letterMatch = text.match(/(?:^|校区|区)([A-Ha-h])[-_ ]?(\d{1,2})(?=[-楼栋号室\d]|$)/) || text.match(/^([A-Ha-h])[-_ ]?(\d{1,2})(?=[-楼栋号室\d]|$)/);
      if (letterMatch) {
        const code = `${letterMatch[1].toUpperCase()}${letterMatch[2]}`;
        return {
          buildingCode: code,
          buildingName: code,
          roomName: raw2,
          campus: normalizeCampus(text, code),
          confidence: 0.94,
          unknown: false
        };
      }
      const chineseBuildingMatch = text.match(/([\u4e00-\u9fa5]{2,12}楼)(?=\d|[-_ ]|$)/);
      if (chineseBuildingMatch) {
        const code = chineseBuildingMatch[1];
        return {
          buildingCode: code,
          buildingName: code,
          roomName: raw2,
          campus: normalizeCampus(text, code),
          confidence: 0.9,
          unknown: false
        };
      }
      const prefixMatch = text.match(/^([^-\s_]{1,12})[-_ ]/);
      if (prefixMatch && !/^\d+$/.test(prefixMatch[1])) {
        return {
          buildingCode: prefixMatch[1],
          buildingName: prefixMatch[1],
          roomName: raw2,
          campus: normalizeCampus(text, prefixMatch[1]),
          confidence: 0.55,
          unknown: false
        };
      }
      return {
        buildingCode: UNKNOWN_BUILDING_CODE,
        buildingName: UNKNOWN_BUILDING_NAME,
        roomName: raw2,
        campus: normalizeCampus(text, ""),
        confidence: 0.2,
        unknown: true
      };
    }
    function isUnknownBuilding(normalized) {
      return Boolean(!normalized || normalized.unknown || normalized.buildingCode === UNKNOWN_BUILDING_CODE);
    }
    module2.exports = {
      UNKNOWN_BUILDING_CODE,
      UNKNOWN_BUILDING_NAME,
      normalizeBuilding,
      isUnknownBuilding
    };
  }
});

// ../../server/src/services/releaseService.js
var require_releaseService = __commonJS({
  "../../server/src/services/releaseService.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var zlib = require("zlib");
    var { promisify } = require("util");
    var { safeLog } = require_safeLogger();
    var { calculateFingerprint: calculateFingerprint2 } = require_stagingFingerprint();
    var termRegistryService2 = require_termRegistryService();
    var termReleaseIndexService = require_termReleaseIndexService();
    var teachingCalendarService = require_teachingCalendarService();
    var runtimePointerService = require_runtimePointerService();
    var {
      buildResourceCountContract,
      deriveLegacyResourceCountContract,
      flattenLegacyCounts
    } = require_resourceCountContract();
    var {
      UNKNOWN_BUILDING_CODE,
      UNKNOWN_BUILDING_NAME,
      normalizeBuilding,
      isUnknownBuilding
    } = require_buildingNormalizer();
    var STORAGE_DIR = path2.resolve(process.env.FOSU_STORAGE_DIR || path2.join(__dirname, "../../storage"));
    var RELEASES_DIR = path2.join(STORAGE_DIR, "releases");
    var PUBLIC_RELEASES_DIR = path2.join(STORAGE_DIR, "public", "releases");
    var ACTIVE_RELEASE_PATH = path2.join(RELEASES_DIR, "active.json");
    var SNAPSHOTS_DIR = path2.join(STORAGE_DIR, "snapshots");
    var CURRENT_SNAPSHOT_PATH = path2.join(SNAPSHOTS_DIR, "current.json");
    var CURRENT_SNAPSHOT_GZ_PATH = path2.join(SNAPSHOTS_DIR, "current.json.gz");
    var STATIC_RELEASE_BASE_PATH = "/static/releases";
    var STATIC_RELEASE_BASE_URL = process.env.FOSU_STATIC_RELEASE_BASE_URL || STATIC_RELEASE_BASE_PATH;
    var gzipAsync = promisify(zlib.gzip);
    var brotliCompressAsync = typeof zlib.brotliCompress === "function" ? promisify(zlib.brotliCompress) : null;
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function ensureStorageDirs() {
      ensureDir(STORAGE_DIR);
      ensureDir(RELEASES_DIR);
      ensureDir(PUBLIC_RELEASES_DIR);
      ensureDir(SNAPSHOTS_DIR);
    }
    function readJsonFile(filePath) {
      try {
        if (!fs2.existsSync(filePath)) {
          return null;
        }
        return JSON.parse(fs2.readFileSync(filePath, "utf-8"));
      } catch (error) {
        safeLog("release-read-json-failed", { filePath, error: error.message });
        return null;
      }
    }
    function writeJsonAtomic(filePath, data) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs2.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      try {
        if (fs2.existsSync(filePath) && process.platform === "win32") {
          try {
            fs2.unlinkSync(filePath);
          } catch (e2) {
          }
        }
        fs2.renameSync(tempPath, filePath);
      } catch (error) {
        fs2.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        try {
          fs2.unlinkSync(tempPath);
        } catch (e2) {
        }
      }
    }
    function normalizeVersion(version) {
      return String(version || "").trim().replace(/[:/\\?%*|"<>]/g, "-").replace(/\s+/g, "-");
    }
    function generateReleaseVersion() {
      const now = /* @__PURE__ */ new Date();
      const pad = (value) => String(value).padStart(2, "0");
      return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
      ].join("-") + `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    }
    function getReleaseDir(version) {
      return path2.join(RELEASES_DIR, normalizeVersion(version));
    }
    function getPublicReleaseDir(version) {
      return path2.join(PUBLIC_RELEASES_DIR, normalizeVersion(version));
    }
    function getSafeBuildId(jobId) {
      return String(jobId || `${process.pid}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "-");
    }
    function buildReleaseFiles(version, releaseDir, publicReleaseDir) {
      const indexDir = path2.join(releaseDir, "index");
      const detailDir = path2.join(releaseDir, "detail");
      const emptyRoomDir = path2.join(releaseDir, "empty-room");
      return {
        releaseDir,
        publicReleaseDir,
        bootstrapPath: path2.join(releaseDir, "bootstrap.json"),
        classSchedulesPath: path2.join(releaseDir, "class-schedules.json"),
        resourcesPath: path2.join(releaseDir, "resources.json"),
        snapshotPath: path2.join(releaseDir, "snapshot.json"),
        manifestPath: path2.join(releaseDir, "manifest.json"),
        indexDir,
        detailDir,
        emptyRoomDir,
        classesIndexPath: path2.join(indexDir, "class.json"),
        teachersIndexPath: path2.join(indexDir, "teacher.json"),
        classroomsIndexPath: path2.join(indexDir, "classroom.json"),
        coursesIndexPath: path2.join(indexDir, "course.json"),
        classIndexAllPath: path2.join(indexDir, "class", "all.json"),
        classIndexByCollegeDir: path2.join(indexDir, "class", "by-college"),
        classIndexByMajorDir: path2.join(indexDir, "class", "by-major"),
        teacherIndexAllPath: path2.join(indexDir, "teacher", "all.json"),
        classroomIndexAllPath: path2.join(indexDir, "classroom", "all.json"),
        courseIndexAllPath: path2.join(indexDir, "course", "all.json"),
        classScheduleDir: path2.join(detailDir, "class"),
        teacherScheduleDir: path2.join(detailDir, "teacher"),
        classroomScheduleDir: path2.join(detailDir, "classroom"),
        courseScheduleDir: path2.join(detailDir, "course"),
        emptyRoomIndexPath: path2.join(emptyRoomDir, "index.json"),
        legacyClassesIndexPath: path2.join(releaseDir, "classes-index.json"),
        legacyTeachersIndexPath: path2.join(releaseDir, "teachers-index.json"),
        legacyClassroomsIndexPath: path2.join(releaseDir, "classrooms-index.json"),
        legacyCoursesIndexPath: path2.join(releaseDir, "courses-index.json"),
        legacyClassScheduleDir: path2.join(releaseDir, "schedules", "class"),
        legacyTeacherScheduleDir: path2.join(releaseDir, "schedules", "teacher"),
        legacyClassroomScheduleDir: path2.join(releaseDir, "schedules", "classroom"),
        legacyCourseScheduleDir: path2.join(releaseDir, "schedules", "course"),
        legacyEmptyRoomIndexPath: path2.join(releaseDir, "derived", "empty-room-index.json")
      };
    }
    function getReleaseFiles(version) {
      return buildReleaseFiles(version, getReleaseDir(version), getPublicReleaseDir(version));
    }
    function getBuildingReleaseFiles(version, jobId) {
      const normalizedVersion = normalizeVersion(version);
      const safeJobId = getSafeBuildId(jobId);
      const releaseDir = path2.join(RELEASES_DIR, `${normalizedVersion}.building-${safeJobId}`);
      const publicReleaseDir = path2.join(PUBLIC_RELEASES_DIR, `${normalizedVersion}.building-${safeJobId}`);
      return buildReleaseFiles(normalizedVersion, releaseDir, publicReleaseDir);
    }
    function assertManagedDir(dirPath, baseDir, label) {
      const resolved = path2.resolve(dirPath || "");
      const base = path2.resolve(baseDir);
      const relative = path2.relative(base, resolved);
      if (!relative || relative.startsWith("..") || path2.isAbsolute(relative)) {
        throw new Error(`Refusing to modify unmanaged ${label || "directory"}: ${resolved}`);
      }
      return resolved;
    }
    function assertManagedReleaseDir(dirPath) {
      return assertManagedDir(dirPath, RELEASES_DIR, "release directory");
    }
    function assertManagedPublicReleaseDir(dirPath) {
      return assertManagedDir(dirPath, PUBLIC_RELEASES_DIR, "public release directory");
    }
    function assertBuildingDir(dirPath, baseDir, label) {
      const resolved = assertManagedDir(dirPath, baseDir, label);
      if (!path2.basename(resolved).includes(".building-")) {
        throw new Error(`Refusing to clean non-building ${label || "directory"}: ${resolved}`);
      }
      return resolved;
    }
    function cleanupBuildingReleaseFiles(files) {
      if (!files) return;
      [
        [files.releaseDir, RELEASES_DIR, "release directory"],
        [files.publicReleaseDir, PUBLIC_RELEASES_DIR, "public release directory"]
      ].forEach(([dirPath, baseDir, label]) => {
        try {
          const resolved = assertBuildingDir(dirPath, baseDir, label);
          fs2.rmSync(resolved, { recursive: true, force: true });
        } catch (error) {
          safeLog("release-building-cleanup-failed", { dirPath, error: error.message });
        }
      });
    }
    function promoteManagedDirs(pairs) {
      const stamp = `${process.pid}-${Date.now()}`;
      const prepared = pairs.map((pair, index) => {
        const source = assertManagedDir(pair.source, pair.baseDir, pair.label);
        const target = assertManagedDir(pair.target, pair.baseDir, pair.label);
        if (!fs2.existsSync(source)) {
          throw new Error(`Build ${pair.label || "directory"} does not exist: ${source}`);
        }
        return Object.assign({}, pair, {
          source,
          target,
          previous: `${target}.previous-${stamp}-${index}`,
          targetExisted: fs2.existsSync(target),
          promoted: false
        });
      });
      try {
        prepared.forEach((item) => {
          if (item.targetExisted) {
            fs2.renameSync(item.target, item.previous);
          }
        });
        prepared.forEach((item) => {
          fs2.renameSync(item.source, item.target);
          item.promoted = true;
        });
        prepared.forEach((item) => {
          if (fs2.existsSync(item.previous)) {
            fs2.rmSync(item.previous, { recursive: true, force: true });
          }
        });
      } catch (error) {
        prepared.slice().reverse().forEach((item) => {
          try {
            if (item.promoted && fs2.existsSync(item.target)) {
              fs2.rmSync(item.target, { recursive: true, force: true });
            }
            if (fs2.existsSync(item.previous) && !fs2.existsSync(item.target)) {
              fs2.renameSync(item.previous, item.target);
            }
          } catch (restoreError) {
            safeLog("release-dir-restore-failed", {
              target: item.target,
              previous: item.previous,
              error: restoreError.message
            });
          }
        });
        throw error;
      }
    }
    function replaceReleaseFilesFromBuild(buildFiles, finalFiles) {
      promoteManagedDirs([
        {
          source: assertManagedReleaseDir(buildFiles.releaseDir),
          target: assertManagedReleaseDir(finalFiles.releaseDir),
          baseDir: RELEASES_DIR,
          label: "release directory"
        },
        {
          source: assertManagedPublicReleaseDir(buildFiles.publicReleaseDir),
          target: assertManagedPublicReleaseDir(finalFiles.publicReleaseDir),
          baseDir: PUBLIC_RELEASES_DIR,
          label: "public release directory"
        }
      ]);
    }
    function getReleaseBuildJobId(options = {}) {
      if (options.jobId) return options.jobId;
      try {
        const job = options.job && typeof options.job.getJob === "function" ? options.job.getJob() : null;
        if (job && job.id) return job.id;
      } catch (error) {
        safeLog("release-build-job-id-read-failed", { error: error.message });
      }
      return `${process.pid}-${Date.now()}`;
    }
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function getResources(snapshot) {
      const source = snapshot && snapshot.resources && typeof snapshot.resources === "object" ? snapshot.resources : {};
      const topLevel = snapshot && typeof snapshot === "object" ? snapshot : {};
      return {
        teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(topLevel.teachers),
        classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(topLevel.classrooms),
        courses: asArray(source.courses).length ? asArray(source.courses) : asArray(topLevel.courses),
        teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(topLevel.teacherSchedules),
        classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(topLevel.classroomSchedules),
        courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(topLevel.courseSchedules)
      };
    }
    function readLegacyResourceArray(fileName) {
      const value = readJsonFile(path2.join(STORAGE_DIR, fileName));
      return Array.isArray(value) ? value : [];
    }
    function hydrateLegacySnapshotResources(snapshot) {
      const resources = getResources(snapshot);
      if (resources.teacherSchedules.length || resources.classroomSchedules.length || resources.courseSchedules.length) {
        return Object.assign({}, snapshot, { resources });
      }
      return Object.assign({}, snapshot, {
        resources: Object.assign({}, resources, {
          teacherSchedules: readLegacyResourceArray("teacher-schedules.json"),
          classroomSchedules: readLegacyResourceArray("classroom-schedules.json"),
          courseSchedules: readLegacyResourceArray("course-schedules.json"),
          teachers: readLegacyResourceArray("teachers.json"),
          classrooms: readLegacyResourceArray("classrooms.json"),
          courses: readLegacyResourceArray("courses.json")
        })
      });
    }
    function countRelease(snapshot) {
      return Object.assign(
        flattenLegacyCounts(buildResourceCountContract(snapshot || {})),
        { noScheduleMajorCount: snapshot && snapshot.coverage && snapshot.coverage.noScheduleMajorCount || 0 }
      );
    }
    function readReleaseIndexItems(version, kind) {
      const files = getReleaseFiles(version);
      const paths = {
        teacher: [files.teacherIndexAllPath, files.legacyTeachersIndexPath],
        classroom: [files.classroomIndexAllPath, files.legacyClassroomsIndexPath],
        course: [files.courseIndexAllPath, files.legacyCoursesIndexPath],
        class: [files.classIndexAllPath, files.legacyClassesIndexPath]
      }[kind] || [];
      for (const filePath of paths) {
        const parsed2 = readJsonFile(filePath);
        if (Array.isArray(parsed2)) return parsed2;
        if (Array.isArray(parsed2 && parsed2.items)) return parsed2.items;
        if (Array.isArray(parsed2 && parsed2.data)) return parsed2.data;
      }
      return [];
    }
    function sumIndexCourseCounts(items2) {
      return asArray(items2).reduce((sum, item) => {
        if (Array.isArray(item && item.courses)) return sum + item.courses.length;
        const count = Number(item && item.courseCount || 0);
        return sum + (Number.isFinite(count) && count > 0 ? count : 0);
      }, 0);
    }
    function augmentLegacyContractFromIndexes(contract, version) {
      if (!contract || !version) return contract;
      const next = Object.assign({}, contract, {
        teacher: Object.assign({}, contract.teacher || {}),
        classroom: Object.assign({}, contract.classroom || {}),
        course: Object.assign({}, contract.course || {})
      });
      [
        ["teacher", "\u6559\u5E08"],
        ["classroom", "\u6559\u5BA4"],
        ["course", "\u8BFE\u7A0B"]
      ].forEach(([kind]) => {
        const items2 = readReleaseIndexItems(version, kind);
        if (!items2.length) return;
        next[kind].scheduleDocuments = items2.length;
        next[kind].courseEvents = sumIndexCourseCounts(items2);
        if (next[kind].directoryEntities == null || next[kind].directoryEntitiesStatus === "not-counted") {
          next[kind].directoryEntities = items2.length;
          next[kind].directoryEntitiesStatus = "derived-from-legacy-index";
        }
        if (!next[kind].sourceMode || next[kind].sourceMode === "unknown") {
          next[kind].sourceMode = "legacy-derived";
        }
      });
      return next;
    }
    function getReleaseResourceCounts(version, snapshot) {
      const normalizedVersion = normalizeVersion(version || snapshot && (snapshot.version || snapshot.releaseVersion) || "");
      const files = normalizedVersion ? getReleaseFiles(normalizedVersion) : null;
      const manifest = files ? readJsonFile(files.manifestPath) || readJsonFile(path2.join(files.publicReleaseDir, "manifest.json")) : null;
      if (manifest && manifest.resourceCounts && Number(manifest.resourceCounts.countSchemaVersion) === 2) {
        return manifest.resourceCounts;
      }
      const sourceSnapshot = snapshot || (normalizedVersion ? readReleaseSnapshot(normalizedVersion) : null);
      if (sourceSnapshot && sourceSnapshot.resourceCounts && Number(sourceSnapshot.resourceCounts.countSchemaVersion) === 2) {
        return sourceSnapshot.resourceCounts;
      }
      const derived = sourceSnapshot ? deriveLegacyResourceCountContract(sourceSnapshot, manifest || {}) : deriveLegacyResourceCountContract({}, manifest || {});
      return augmentLegacyContractFromIndexes(derived, normalizedVersion);
    }
    function stableScheduleId(kind, value, index) {
      const key = `${kind}:${String(value || "")}:${index}`;
      return cryptoHash(key).slice(0, 16);
    }
    function cryptoHash(value) {
      return require("crypto").createHash("sha1").update(String(value || "")).digest("hex");
    }
    function cryptoHashBuffer(buffer) {
      return require("crypto").createHash("sha1").update(buffer).digest("hex");
    }
    function getExistingPath(primaryPath, legacyPath) {
      if (primaryPath && fs2.existsSync(primaryPath)) return primaryPath;
      if (legacyPath && fs2.existsSync(legacyPath)) return legacyPath;
      return primaryPath || legacyPath;
    }
    function getExistingDir(primaryDir, legacyDir) {
      if (primaryDir && fs2.existsSync(primaryDir)) return primaryDir;
      if (legacyDir && fs2.existsSync(legacyDir)) return legacyDir;
      return primaryDir || legacyDir;
    }
    function toReleaseRelativePath(files, filePath) {
      return path2.relative(files.releaseDir, filePath).replace(/\\/g, "/");
    }
    function getFileMeta(filePath) {
      if (!filePath || !fs2.existsSync(filePath)) {
        return null;
      }
      const buffer = fs2.readFileSync(filePath);
      return {
        size: buffer.length,
        hash: cryptoHashBuffer(buffer)
      };
    }
    function collectJsonFiles(dirPath) {
      if (!dirPath || !fs2.existsSync(dirPath)) {
        return [];
      }
      const result = [];
      const entries = fs2.readdirSync(dirPath, { withFileTypes: true });
      entries.forEach((entry) => {
        const fullPath = path2.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          result.push.apply(result, collectJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          result.push(fullPath);
        }
      });
      return result;
    }
    function buildReleasePackFilesMeta(files) {
      const meta2 = {};
      [
        files.indexDir,
        files.classScheduleDir,
        files.teacherScheduleDir,
        files.classroomScheduleDir,
        files.courseScheduleDir,
        files.emptyRoomDir
      ].forEach((dirPath) => {
        collectJsonFiles(dirPath).forEach((filePath) => {
          const item = getFileMeta(filePath);
          if (item) {
            meta2[toReleaseRelativePath(files, filePath)] = item;
          }
        });
      });
      return meta2;
    }
    function sumMetaSize(filesMeta) {
      return Object.values(filesMeta || {}).reduce((sum, item) => sum + Number(item && item.size || 0), 0);
    }
    function trimSlashes(value) {
      return String(value || "").replace(/^\/+|\/+$/g, "");
    }
    function joinUrl(base, ...parts) {
      const root = String(base || "").replace(/\/+$/g, "");
      const suffix = parts.map(trimSlashes).filter(Boolean).join("/");
      return suffix ? `${root}/${suffix}` : root || "/";
    }
    function buildStaticReleaseUrls(version, derived) {
      const releaseVersion = normalizeVersion(version);
      const releaseBaseUrl = joinUrl(STATIC_RELEASE_BASE_URL, releaseVersion);
      const toUrl = (relativePath) => joinUrl(releaseBaseUrl, relativePath);
      const shards = derived && derived.shards ? derived.shards : {};
      const classShards = shards.class || {};
      const mapShardUrls = (items2) => Object.fromEntries(Object.entries(items2 || {}).map(([key, relativePath]) => [key, toUrl(relativePath)]));
      return {
        staticBasePath: STATIC_RELEASE_BASE_PATH,
        staticBaseUrl: STATIC_RELEASE_BASE_URL,
        staticReleaseUrl: releaseBaseUrl,
        indexUrls: {
          class: toUrl("index/class/all.json"),
          teacher: toUrl("index/teacher/all.json"),
          classroom: toUrl("index/classroom/all.json"),
          course: toUrl("index/course/all.json"),
          legacy: {
            class: toUrl("index/class.json"),
            teacher: toUrl("index/teacher.json"),
            classroom: toUrl("index/classroom.json"),
            course: toUrl("index/course.json")
          }
        },
        emptyRoomUrl: toUrl("empty-room/index.json"),
        detailUrlPattern: toUrl("detail/{type}/{id}.json"),
        shards: {
          class: {
            all: toUrl(classShards.all || "index/class/all.json"),
            byCollege: mapShardUrls(classShards.byCollege),
            byMajor: mapShardUrls(classShards.byMajor)
          }
        }
      };
    }
    function truthy(value) {
      return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
    }
    function getReleaseCompressionConfig(env = process.env) {
      const precompress = String(env.FOSU_RELEASE_PRECOMPRESS || "gzip").trim().toLowerCase();
      const tokens = new Set(precompress.split(/[,;\s]+/).filter(Boolean));
      const gzip = precompress !== "none" && (tokens.size === 0 || tokens.has("gzip") || tokens.has("all"));
      const brRequested = tokens.has("br") || tokens.has("brotli") || tokens.has("all");
      const brotli = truthy(env.FOSU_RELEASE_BROTLI_ENABLED) && brRequested && Boolean(brotliCompressAsync);
      const rawConcurrency = Number(env.FOSU_RELEASE_COMPRESSION_CONCURRENCY || 1);
      const concurrency = Math.max(1, Math.min(8, Number.isFinite(rawConcurrency) ? Math.floor(rawConcurrency) : 1));
      return { precompress, gzip, br: brotli, concurrency };
    }
    function collectStaticReleaseSourceFiles(version, filesOverride) {
      const files = filesOverride || getReleaseFiles(version);
      const sourceFiles = [];
      if (fs2.existsSync(files.manifestPath)) {
        sourceFiles.push(files.manifestPath);
      }
      if (fs2.existsSync(files.bootstrapPath)) {
        sourceFiles.push(files.bootstrapPath);
      }
      const calendarPath = path2.join(files.releaseDir, "calendar.json");
      if (fs2.existsSync(calendarPath)) {
        sourceFiles.push(calendarPath);
      }
      [files.indexDir, files.detailDir, files.emptyRoomDir].forEach((dirPath) => {
        collectJsonFiles(dirPath).forEach((filePath) => sourceFiles.push(filePath));
      });
      const seen = /* @__PURE__ */ new Set();
      return sourceFiles.filter((filePath) => {
        const key = path2.resolve(filePath);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function estimateStaticReleaseCompression(version, options = {}) {
      const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
      const files = collectStaticReleaseSourceFiles(version, options.files);
      if (options.includeManifest) {
        const manifestPath = (options.files || getReleaseFiles(version)).manifestPath;
        if (!files.some((filePath) => path2.resolve(filePath) === path2.resolve(manifestPath))) {
          files.push(manifestPath);
        }
      }
      return {
        gzip: Boolean(config.gzip && files.length),
        br: Boolean(config.br && files.length),
        files: files.length,
        concurrency: config.concurrency,
        precompress: config.precompress
      };
    }
    function compressStaticJsonFile(filePath, options = {}) {
      const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
      const result = { gzip: false, br: false };
      if (!filePath || !fs2.existsSync(filePath) || !filePath.endsWith(".json")) {
        return result;
      }
      const buffer = fs2.readFileSync(filePath);
      if (config.gzip) {
        fs2.writeFileSync(`${filePath}.gz`, zlib.gzipSync(buffer));
        result.gzip = true;
      }
      if (config.br && typeof zlib.brotliCompressSync === "function") {
        try {
          fs2.writeFileSync(`${filePath}.br`, zlib.brotliCompressSync(buffer));
          result.br = true;
        } catch (error) {
          safeLog("release-brotli-compress-failed", { filePath, error: error.message });
        }
      }
      return result;
    }
    async function compressStaticJsonFileAsync(filePath, options = {}) {
      const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
      const result = { gzip: false, br: false };
      if (!filePath || !fs2.existsSync(filePath) || !filePath.endsWith(".json")) {
        return result;
      }
      const buffer = await fs2.promises.readFile(filePath);
      if (config.gzip) {
        await fs2.promises.writeFile(`${filePath}.gz`, await gzipAsync(buffer));
        result.gzip = true;
      }
      if (config.br && brotliCompressAsync) {
        try {
          await fs2.promises.writeFile(`${filePath}.br`, await brotliCompressAsync(buffer));
          result.br = true;
        } catch (error) {
          safeLog("release-brotli-compress-failed", { filePath, error: error.message });
        }
      }
      return result;
    }
    async function runWithConcurrency(items2, concurrency, worker) {
      let cursor = 0;
      const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (cursor < items2.length) {
          const index = cursor;
          cursor += 1;
          await worker(items2[index], index);
        }
      });
      await Promise.all(runners);
    }
    function mirrorStaticReleaseFiles(version, options = {}) {
      const files = options.files || getReleaseFiles(version);
      ensureDir(files.publicReleaseDir);
      const sourceFiles = collectStaticReleaseSourceFiles(version, files);
      const compression = { gzip: false, br: false, files: 0 };
      sourceFiles.forEach((sourcePath) => {
        const relativePath = toReleaseRelativePath(files, sourcePath);
        const targetPath = path2.join(files.publicReleaseDir, relativePath);
        ensureDir(path2.dirname(targetPath));
        fs2.copyFileSync(sourcePath, targetPath);
        const item = compressStaticJsonFile(targetPath, options);
        compression.gzip = compression.gzip || item.gzip;
        compression.br = compression.br || item.br;
        compression.files += 1;
      });
      compression.concurrency = 1;
      compression.precompress = getReleaseCompressionConfig().precompress;
      return compression;
    }
    async function mirrorStaticReleaseFilesAsync(version, options = {}) {
      const files = options.files || getReleaseFiles(version);
      ensureDir(files.publicReleaseDir);
      const sourceFiles = collectStaticReleaseSourceFiles(version, files);
      const config = Object.assign({}, getReleaseCompressionConfig(), options.compression || {});
      const compression = {
        gzip: false,
        br: false,
        files: 0,
        concurrency: config.concurrency,
        precompress: config.precompress
      };
      let processed = 0;
      await runWithConcurrency(sourceFiles, config.concurrency, async (sourcePath) => {
        const relativePath = toReleaseRelativePath(files, sourcePath);
        const targetPath = path2.join(files.publicReleaseDir, relativePath);
        ensureDir(path2.dirname(targetPath));
        await fs2.promises.copyFile(sourcePath, targetPath);
        const item = await compressStaticJsonFileAsync(targetPath, { compression: config });
        compression.gzip = compression.gzip || item.gzip;
        compression.br = compression.br || item.br;
        compression.files += 1;
        processed += 1;
        if (typeof options.onProgress === "function") {
          options.onProgress({
            processed,
            total: sourceFiles.length,
            relativePath,
            gzip: item.gzip,
            br: item.br
          });
        }
      });
      return compression;
    }
    function safeScheduleId(kind, value, fallbackValue, index) {
      const raw2 = String(value || "").trim();
      const fallback = stableScheduleId(kind, fallbackValue || raw2, index);
      const safe = raw2.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!safe || safe.length > 80) {
        return fallback;
      }
      return safe;
    }
    function getFirstText(item, keys) {
      for (const key of keys) {
        if (item && item[key] !== void 0 && item[key] !== null && String(item[key]).trim()) {
          return String(item[key]).trim();
        }
      }
      return "";
    }
    function summarizeCourses(schedule) {
      const courses = Array.isArray(schedule?.courses) ? schedule.courses : [];
      return {
        courseCount: courses.length,
        firstCourseName: getFirstText(courses[0], ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"])
      };
    }
    function stripDebugCourseFields(course) {
      if (!course || typeof course !== "object") {
        return course;
      }
      const copy = Object.assign({}, course);
      delete copy.rawHtml;
      delete copy.rawCellHtml;
      delete copy.sourceHtml;
      delete copy.debugHtml;
      return copy;
    }
    function dictIndex(dict, value) {
      const text = String(value || "").trim();
      if (!text) return -1;
      const existing = dict.indexOf(text);
      if (existing >= 0) return existing;
      dict.push(text);
      return dict.length - 1;
    }
    function compactWeekValue(course) {
      if (Array.isArray(course.weeks) && course.weeks.length) {
        return course.weeks.join(",");
      }
      if (course.weekMask !== void 0 && course.weekMask !== null) {
        return String(course.weekMask);
      }
      if (course.weekText) {
        return String(course.weekText);
      }
      if (course.startWeek || course.endWeek) {
        return `${course.startWeek || ""}-${course.endWeek || ""}`;
      }
      return "";
    }
    function buildCompactSchedulePayload(payload) {
      const sourceCourses = asArray(payload.courses);
      if (!sourceCourses.length) {
        return null;
      }
      const courseDict = [];
      const teacherDict = [];
      const roomDict = [];
      const classDict = [];
      const collegeDict = [];
      const majorDict = [];
      const scheduleClassIndex = dictIndex(classDict, payload.className || payload.name || "");
      const scheduleCollegeIndex = dictIndex(collegeDict, payload.collegeName || payload.college || "");
      const scheduleMajorIndex = dictIndex(majorDict, payload.majorName || "");
      const courses = sourceCourses.map((course) => ({
        n: dictIndex(courseDict, getFirstText(course, ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"])),
        t: dictIndex(teacherDict, getFirstText(course, ["displayTeacherName", "canonicalTeacherName", "teacherName", "teacher"])),
        r: dictIndex(roomDict, getFirstText(course, ["displayClassroom", "canonicalClassroom", "classroom", "roomName", "location"])),
        c: dictIndex(classDict, course.className || payload.className || payload.name || ""),
        g: dictIndex(collegeDict, course.collegeName || payload.collegeName || payload.college || ""),
        m: dictIndex(majorDict, course.majorName || payload.majorName || ""),
        d: Number(course.weekday || 0) || 0,
        s: Number(course.startSection || 0) || 0,
        e: Number(course.endSection || 0) || 0,
        w: compactWeekValue(course)
      }));
      return {
        schemaVersion: 1,
        fields: ["n", "t", "r", "c", "g", "m", "d", "s", "e", "w"],
        dictionaries: {
          courseDict,
          teacherDict,
          roomDict,
          classDict,
          collegeDict,
          majorDict
        },
        scheduleRefs: {
          className: scheduleClassIndex,
          collegeName: scheduleCollegeIndex,
          majorName: scheduleMajorIndex
        },
        courses
      };
    }
    function buildSchedulePayload(schedule, extra) {
      const payload = Object.assign({}, schedule || {}, extra || {});
      if (Array.isArray(payload.courses)) {
        payload.courses = payload.courses.map(stripDebugCourseFields);
      }
      const compact = buildCompactSchedulePayload(payload);
      if (compact) {
        payload.compact = compact;
      }
      return payload;
    }
    function buildClassDerivedFiles(snapshot, files, onlyIndexes = false) {
      ensureDir(files.classScheduleDir);
      const index = asArray(snapshot.classSchedules).map((item, position) => {
        const name = getFirstText(item, ["className", "title", "name"]) || `class-${position + 1}`;
        const id = safeScheduleId("class", item.classId || item.id, `${snapshot.semester}:${name}`, position);
        const summary = summarizeCourses(item);
        if (!onlyIndexes) {
          const payload = buildSchedulePayload(item, { id });
          writeJsonAtomic(path2.join(files.classScheduleDir, `${id}.json`), payload);
        }
        return {
          id,
          name,
          className: name,
          semester: item.semester || snapshot.semester || "",
          collegeCode: item.collegeCode || "",
          collegeName: item.collegeName || "",
          grade: item.grade || "",
          majorCode: item.majorCode || "",
          majorName: item.majorName || "",
          displayType: item.displayType || "",
          isAggregated: !!item.isAggregated,
          courseCount: summary.courseCount,
          firstCourseName: summary.firstCourseName,
          updatedAt: item.updatedAt || snapshot.updatedAt || ""
        };
      });
      writeJsonAtomic(files.classesIndexPath, index);
      return index;
    }
    function normalizeSearchText(value) {
      return String(value == null ? "" : value).trim().replace(/[\u3000\s]+/g, "").replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/\u3002/g, ".").toLowerCase();
    }
    function compactKeywordList(values) {
      const seen = /* @__PURE__ */ new Set();
      return (values || []).flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value == null ? "" : value).trim()).filter((value) => {
        if (!value) return false;
        const key = normalizeSearchText(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function buildNamedScheduleDerivedFiles(snapshot, files, kind, schedules, names, nameKeys, dirPath, indexPath, onlyIndexes = false) {
      ensureDir(dirPath);
      const scheduleByName = /* @__PURE__ */ new Map();
      asArray(schedules).forEach((schedule, index2) => {
        const name = getFirstText(schedule, nameKeys);
        if (!name) return;
        if (!scheduleByName.has(name)) {
          scheduleByName.set(name, { schedule, index: index2 });
        }
      });
      const seen = /* @__PURE__ */ new Set();
      const index = [];
      const addItem = (source, sourceIndex) => {
        const name = getFirstText(source, nameKeys);
        if (!name || seen.has(name)) return;
        seen.add(name);
        const matched = scheduleByName.get(name);
        const schedule = matched ? matched.schedule : Object.assign({}, source, { courses: [] });
        const id = safeScheduleId(kind, source.id || source[`${kind}Id`] || schedule.id, `${snapshot.semester}:${name}`, sourceIndex);
        const summary = summarizeCourses(schedule);
        const keywords = compactKeywordList([
          source.id,
          schedule.id,
          name,
          source.name,
          source.displayName,
          source.title,
          source.teacherTitle,
          source.professionalTitle,
          source.rawName,
          schedule.name,
          schedule.displayName,
          schedule.title,
          schedule.teacherTitle,
          schedule.professionalTitle,
          schedule.rawName,
          summary.firstCourseName,
          asArray(schedule.courses).slice(0, 20).map((course) => [
            course.teacherName,
            course.displayTeacherName,
            course.canonicalTeacherName,
            course.courseName,
            course.displayCourseName,
            course.canonicalCourseName
          ])
        ]);
        if (!onlyIndexes) {
          writeJsonAtomic(path2.join(dirPath, `${id}.json`), buildSchedulePayload(schedule, { id }));
        }
        index.push({
          id,
          name,
          [`${kind}Name`]: name,
          displayName: source.displayName || schedule.displayName || name,
          rawName: source.rawName || schedule.rawName || "",
          title: source.title || schedule.title || "",
          teacherTitle: source.teacherTitle || schedule.teacherTitle || "",
          professionalTitle: source.professionalTitle || schedule.professionalTitle || "",
          searchableName: normalizeSearchText(name),
          keywords,
          semester: schedule.semester || snapshot.semester || "",
          collegeCode: source.collegeCode || schedule.collegeCode || "",
          collegeName: source.collegeName || schedule.collegeName || "",
          campus: source.campus || schedule.campus || "",
          source: source.source || schedule.source || "derived",
          hasDetail: !onlyIndexes,
          courseCount: summary.courseCount,
          firstCourseName: summary.firstCourseName,
          updatedAt: schedule.updatedAt || snapshot.updatedAt || ""
        });
      };
      asArray(names).forEach(addItem);
      asArray(schedules).forEach((schedule, indexNum) => addItem(schedule, indexNum));
      writeJsonAtomic(indexPath, index);
      return index;
    }
    var MAX_EMPTY_ROOM_SECTION = 14;
    var MAX_EMPTY_ROOM_WEEK = 30;
    function toInteger(value) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
      }
      const match2 = String(value == null ? "" : value).match(/\d+/);
      return match2 ? parseInt(match2[0], 10) : NaN;
    }
    function uniqueNumbers(values, min, max) {
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      (values || []).forEach((value) => {
        const num = toInteger(value);
        if (Number.isFinite(num) && num >= min && num <= max && !seen.has(num)) {
          seen.add(num);
          result.push(num);
        }
      });
      return result.sort((left, right) => left - right);
    }
    function rangeNumbers(start, end, min, max) {
      const first = toInteger(start);
      const last = toInteger(end);
      if (!Number.isFinite(first)) {
        return [];
      }
      if (!Number.isFinite(last)) {
        return uniqueNumbers([first], min, max);
      }
      const low = Math.min(first, last);
      const high = Math.max(first, last);
      const values = [];
      for (let value = low; value <= high; value += 1) {
        values.push(value);
      }
      return uniqueNumbers(values, min, max);
    }
    function allSections() {
      return rangeNumbers(1, MAX_EMPTY_ROOM_SECTION, 1, MAX_EMPTY_ROOM_SECTION);
    }
    function allWeeks() {
      return rangeNumbers(1, MAX_EMPTY_ROOM_WEEK, 1, MAX_EMPTY_ROOM_WEEK);
    }
    function parseChineseWeekday(text) {
      const value = String(text == null ? "" : text);
      const map = { \u4E00: 1, \u4E8C: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u65E5: 7, \u5929: 7 };
      const match2 = value.match(/[一二三四五六日天]/);
      return match2 ? map[match2[0]] : NaN;
    }
    function normalizeWeekday(value, key) {
      const chinese = parseChineseWeekday(value);
      if (Number.isFinite(chinese)) {
        return chinese;
      }
      const num = toInteger(value);
      if (!Number.isFinite(num)) {
        return NaN;
      }
      if (key === "dayIndex" && num >= 0 && num <= 6) {
        return num + 1;
      }
      return num >= 1 && num <= 7 ? num : NaN;
    }
    function parseSectionSequence(text) {
      const source = String(text == null ? "" : text);
      const raw2 = source.match(/\d{1,2}/g) || [];
      const nums = raw2.map((item) => parseInt(item, 10)).filter((num) => Number.isFinite(num));
      if (nums.length === 2 && /[-~～至到]/.test(source)) {
        return rangeNumbers(nums[0], nums[1], 1, MAX_EMPTY_ROOM_SECTION);
      }
      return uniqueNumbers(nums, 1, MAX_EMPTY_ROOM_SECTION);
    }
    function parseSectionText(text) {
      const source = String(text == null ? "" : text);
      const sections = [];
      const patterns = [
        /[\[【(（]\s*(\d{1,2}(?:\s*[-,，、~～至到]\s*\d{1,2})*)\s*[\]】)）]\s*节?/g,
        /第\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/g,
        /(?:^|[^\dA-Za-z])(\d{1,2}(?:\s*[-~～]\s*\d{1,2})+)\s*节/g
      ];
      patterns.forEach((pattern) => {
        let match2;
        while ((match2 = pattern.exec(source)) !== null) {
          if (match2[2]) {
            sections.push(...rangeNumbers(match2[1], match2[2], 1, MAX_EMPTY_ROOM_SECTION));
          } else {
            sections.push(...parseSectionSequence(match2[1]));
          }
        }
      });
      return uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
    }
    function parseWeekText(text) {
      const source = String(text == null ? "" : text);
      if (!source) {
        return [];
      }
      if (source.includes("\u5355\u5468")) {
        return uniqueNumbers(Array.from({ length: 15 }, (_, index) => index * 2 + 1), 1, MAX_EMPTY_ROOM_WEEK);
      }
      if (source.includes("\u53CC\u5468")) {
        return uniqueNumbers(Array.from({ length: 15 }, (_, index) => (index + 1) * 2), 1, MAX_EMPTY_ROOM_WEEK);
      }
      if (!source.includes("\u5468")) {
        return [];
      }
      const weeks = [];
      const re = /(\d{1,2})(?:\s*[-~～至到]\s*(\d{1,2}))?\s*周/g;
      let match2;
      while ((match2 = re.exec(source)) !== null) {
        if (match2[2]) {
          weeks.push(...rangeNumbers(match2[1], match2[2], 1, MAX_EMPTY_ROOM_WEEK));
        } else {
          weeks.push(toInteger(match2[1]));
        }
      }
      return uniqueNumbers(weeks, 1, MAX_EMPTY_ROOM_WEEK);
    }
    function normalizeCourseSlot(course) {
      const source = course && typeof course === "object" ? course : {};
      const weekdayKeys = ["weekday", "weekDay", "dayOfWeek", "day", "xqj", "dayIndex"];
      let weekday = NaN;
      for (const key of weekdayKeys) {
        if (source[key] !== void 0 && source[key] !== null && source[key] !== "") {
          weekday = normalizeWeekday(source[key], key);
          if (Number.isFinite(weekday)) break;
        }
      }
      let sections = [];
      if (Array.isArray(source.sections)) {
        sections = uniqueNumbers(source.sections, 1, MAX_EMPTY_ROOM_SECTION);
      }
      if (sections.length === 0) {
        sections = uniqueNumbers([source.section, source.sectionIndex], 1, MAX_EMPTY_ROOM_SECTION);
      }
      const sectionPairs = [
        ["startSection", "endSection"],
        ["sectionStart", "sectionEnd"],
        ["start", "end"]
      ];
      for (const pair of sectionPairs) {
        if (sections.length) break;
        if (source[pair[0]] !== void 0 || source[pair[1]] !== void 0) {
          sections = rangeNumbers(source[pair[0]], source[pair[1]], 1, MAX_EMPTY_ROOM_SECTION);
        }
      }
      if (sections.length === 0) {
        ["section", "sectionIndex", "sectionText", "sectionsText", "rawSection", "rawSections", "timeText", "period", "periodText", "rawText"].some((key) => {
          sections = parseSectionText(source[key]);
          if (sections.length === 0 && /[-,，、~～至到]/.test(String(source[key] == null ? "" : source[key]))) {
            sections = parseSectionSequence(source[key]);
          }
          return sections.length > 0;
        });
      }
      let weeks = [];
      ["weeks", "weekList", "weekNumbers"].some((key) => {
        if (Array.isArray(source[key])) {
          weeks = uniqueNumbers(source[key], 1, MAX_EMPTY_ROOM_WEEK);
          return weeks.length > 0;
        }
        return false;
      });
      if (weeks.length === 0) {
        const weekPairs = [
          ["startWeek", "endWeek"],
          ["weekStart", "weekEnd"]
        ];
        weekPairs.some((pair) => {
          if (source[pair[0]] !== void 0 || source[pair[1]] !== void 0) {
            weeks = rangeNumbers(source[pair[0]], source[pair[1]], 1, MAX_EMPTY_ROOM_WEEK);
            return weeks.length > 0;
          }
          return false;
        });
      }
      if (weeks.length === 0) {
        ["weeksText", "rawWeeks", "weekRange", "weekText", "rawText"].some((key) => {
          weeks = parseWeekText(source[key]);
          return weeks.length > 0;
        });
      }
      return {
        weekday: Number.isFinite(weekday) ? weekday : null,
        sections,
        weeks: weeks.length ? weeks : allWeeks()
      };
    }
    function getScheduleCourses(schedule) {
      if (!schedule || typeof schedule !== "object") {
        return [];
      }
      const keys = ["courses", "items", "schedule", "lessons", "courseList"];
      for (const key of keys) {
        if (Array.isArray(schedule[key])) {
          return schedule[key];
        }
      }
      return [];
    }
    function getClassroomNameFromSchedule(schedule, index) {
      const name = getFirstText(schedule, ["roomName", "classroomName", "classroom", "name", "title"]);
      return name || `classroom-${index + 1}`;
    }
    function getClassroomNameFromCourse(course) {
      return getFirstText(course, [
        "classroom",
        "displayClassroom",
        "canonicalClassroom",
        "rawClassroom",
        "roomName",
        "room",
        "location",
        "venue"
      ]);
    }
    function deriveClassroomSchedulesFromClassSchedules(classSchedules) {
      const rooms = /* @__PURE__ */ new Map();
      asArray(classSchedules).forEach((schedule) => {
        getScheduleCourses(schedule).forEach((course) => {
          const roomName = getClassroomNameFromCourse(course);
          if (!roomName) return;
          if (!rooms.has(roomName)) {
            rooms.set(roomName, { roomName, courses: [], source: "classSchedules-derived" });
          }
          rooms.get(roomName).courses.push(course);
        });
      });
      return Array.from(rooms.values());
    }
    function inferBuilding(roomName) {
      const normalized = normalizeBuilding(roomName);
      return isUnknownBuilding(normalized) ? UNKNOWN_BUILDING_NAME : normalized.buildingCode;
    }
    function getCourseDisplayName(course) {
      return getFirstText(course, ["displayCourseName", "canonicalCourseName", "courseName", "name", "title"]);
    }
    function normalizeEmptyRoomCourse(course) {
      const slot = normalizeCourseSlot(course);
      if (!slot.weekday || !slot.sections.length) {
        return null;
      }
      return {
        courseName: getCourseDisplayName(course),
        teacherName: getFirstText(course, ["displayTeacherName", "canonicalTeacherName", "teacherName", "teacher"]),
        weekday: slot.weekday,
        weeks: slot.weeks,
        sections: slot.sections,
        startSection: slot.sections[0],
        endSection: slot.sections[slot.sections.length - 1]
      };
    }
    function sanitizeShardName(value) {
      const safe = String(value || "unknown").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return safe || "unknown";
    }
    function buildIndexPayload(type, items2, snapshot) {
      const list = Array.isArray(items2) ? items2 : [];
      const version = normalizeVersion(snapshot.version || snapshot.releaseVersion || "");
      return {
        success: true,
        schemaVersion: 1,
        type,
        term: snapshot.term || snapshot.semester || "",
        semester: snapshot.semester || snapshot.term || "",
        releaseVersion: version,
        version,
        updatedAt: snapshot.updatedAt || snapshot.generatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        total: list.length,
        items: list
      };
    }
    function toLightClassIndexItem(item) {
      return {
        id: item.id,
        name: item.name || item.className || "",
        className: item.className || item.name || "",
        college: item.college || item.collegeName || "",
        collegeCode: item.collegeCode || "",
        collegeName: item.collegeName || item.college || "",
        grade: item.grade || "",
        major: item.major || item.majorName || "",
        majorCode: item.majorCode || "",
        majorName: item.majorName || item.major || "",
        courseCount: Number(item.courseCount || item.count || 0) || 0,
        displayType: item.displayType || "",
        isAggregated: Boolean(item.isAggregated),
        firstCourseName: item.firstCourseName || "",
        semester: item.semester || "",
        updatedAt: item.updatedAt || ""
      };
    }
    function groupBy(items2, getKey) {
      const grouped = /* @__PURE__ */ new Map();
      (items2 || []).forEach((item) => {
        const key = String(getKey(item) || "").trim();
        if (!key) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
      });
      return grouped;
    }
    function writeIndexShardFiles(snapshot, files, indexes) {
      const classes = (indexes.classes || []).map(toLightClassIndexItem);
      const shards = {
        class: {
          all: "index/class/all.json",
          byCollege: {},
          byMajor: {}
        },
        teacher: { all: "index/teacher/all.json" },
        classroom: { all: "index/classroom/all.json" },
        course: { all: "index/course/all.json" }
      };
      writeJsonAtomic(files.classIndexAllPath, buildIndexPayload("class", classes, snapshot));
      writeJsonAtomic(files.teacherIndexAllPath, buildIndexPayload("teacher", indexes.teachers || [], snapshot));
      writeJsonAtomic(files.classroomIndexAllPath, buildIndexPayload("classroom", indexes.classrooms || [], snapshot));
      writeJsonAtomic(files.courseIndexAllPath, buildIndexPayload("course", indexes.courses || [], snapshot));
      groupBy(classes, (item) => item.collegeCode || item.collegeName).forEach((items2, key) => {
        const fileName = `${sanitizeShardName(key)}.json`;
        const relative = `index/class/by-college/${fileName}`;
        writeJsonAtomic(path2.join(files.classIndexByCollegeDir, fileName), buildIndexPayload("class", items2, snapshot));
        shards.class.byCollege[key] = relative;
      });
      groupBy(classes, (item) => [item.collegeCode || item.collegeName, item.grade, item.majorCode || item.majorName].filter(Boolean).join("-")).forEach((items2, key) => {
        const fileName = `${sanitizeShardName(key)}.json`;
        const relative = `index/class/by-major/${fileName}`;
        writeJsonAtomic(path2.join(files.classIndexByMajorDir, fileName), buildIndexPayload("class", items2, snapshot));
        shards.class.byMajor[key] = relative;
      });
      return shards;
    }
    function mergeEmptyRoomSchedules(classroomSchedules, classSchedules) {
      const rooms = /* @__PURE__ */ new Map();
      const addSchedule = (schedule, source, index) => {
        const roomName = getClassroomNameFromSchedule(schedule, index);
        if (!roomName || roomName === "\u672A\u77E5") return;
        const existing = rooms.get(roomName);
        const courses = getScheduleCourses(schedule);
        if (existing) {
          if (existing.source !== "classroomSchedules" && source === "classroomSchedules") {
            existing.source = "classroomSchedules";
            existing.capacity = schedule.capacity || schedule.seatCount || existing.capacity || null;
            existing.roomId = schedule.roomId || schedule.id || existing.roomId || "";
          }
          existing.courses = existing.courses.concat(courses);
          return;
        }
        rooms.set(roomName, {
          roomName,
          roomId: schedule.roomId || schedule.id || "",
          capacity: schedule.capacity || schedule.seatCount || null,
          courses: courses.slice(),
          source
        });
      };
      asArray(classroomSchedules).forEach((schedule, index) => addSchedule(schedule, "classroomSchedules", index));
      deriveClassroomSchedulesFromClassSchedules(classSchedules).forEach((schedule, index) => {
        addSchedule(schedule, "classSchedules-derived", index);
      });
      return Array.from(rooms.values());
    }
    function buildClassroomDetailLookup(classroomIndex) {
      const lookup = /* @__PURE__ */ new Map();
      asArray(classroomIndex).forEach((item) => {
        [
          item.roomName,
          item.classroomName,
          item.displayName,
          item.name,
          item.title
        ].forEach((name) => {
          const key = normalizeSearchText(name);
          if (key && !lookup.has(key)) {
            lookup.set(key, item);
          }
        });
      });
      return lookup;
    }
    function buildEmptyRoomDerivedFiles(snapshot, files, classroomIndex = []) {
      ensureDir(path2.dirname(files.emptyRoomIndexPath));
      const resources = getResources(snapshot);
      const sourceSchedules = mergeEmptyRoomSchedules(resources.classroomSchedules, snapshot.classSchedules);
      const classroomLookup = buildClassroomDetailLookup(classroomIndex);
      const version = normalizeVersion(snapshot.version || snapshot.releaseVersion || "");
      const rooms = asArray(sourceSchedules).map((schedule, index2) => {
        const roomName = getClassroomNameFromSchedule(schedule, index2);
        const roomId = safeScheduleId("empty-room", schedule.roomId || schedule.id || roomName, `${snapshot.semester}:${roomName}`, index2);
        const courses = getScheduleCourses(schedule).map(normalizeEmptyRoomCourse).filter(Boolean);
        const building = normalizeBuilding(roomName);
        const normalizedRoomName = normalizeSearchText(roomName);
        const classroomIndexItem = classroomLookup.get(normalizedRoomName) || null;
        const detailId = classroomIndexItem && classroomIndexItem.id ? classroomIndexItem.id : "";
        return {
          roomId,
          roomName,
          normalizedRoomName,
          classroomId: detailId,
          detailId,
          releaseVersion: version,
          hasScheduleDetail: Boolean(detailId),
          building: isUnknownBuilding(building) ? UNKNOWN_BUILDING_NAME : building.buildingCode,
          buildingCode: building.buildingCode || UNKNOWN_BUILDING_CODE,
          buildingName: building.buildingName || UNKNOWN_BUILDING_NAME,
          campus: schedule.campus || building.campus || "",
          confidence: building.confidence,
          source: schedule.source || "classroomSchedules",
          capacity: schedule.capacity || schedule.seatCount || null,
          courseCount: courses.length,
          courses
        };
      }).filter((room) => room.roomName && room.roomName !== "\u672A\u77E5");
      const buildings = Array.from(new Set(rooms.map((room) => room.building).filter(Boolean))).sort((left, right) => String(left).localeCompare(String(right), "zh-CN"));
      const unknownRooms = rooms.filter((room) => room.buildingCode === UNKNOWN_BUILDING_CODE || room.building === UNKNOWN_BUILDING_NAME);
      const health = {
        classroomCount: rooms.length,
        buildingCount: buildings.length,
        unknownRoomCount: unknownRooms.length,
        unknownRoomSamples: unknownRooms.slice(0, 20).map((room) => room.roomName),
        scheduleDetailCount: rooms.filter((room) => room.hasScheduleDetail).length,
        sources: {
          classroomSchedules: rooms.filter((room) => room.source === "classroomSchedules").length,
          classSchedulesDerived: rooms.filter((room) => room.source === "classSchedules-derived").length
        }
      };
      const index = {
        success: true,
        schemaVersion: 1,
        version,
        releaseVersion: version,
        term: snapshot.term || snapshot.semester || "",
        semester: snapshot.semester || snapshot.term || "",
        termStartDate: snapshot.termStartDate || "",
        updatedAt: snapshot.updatedAt || snapshot.generatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        buildings,
        health,
        rooms
      };
      writeJsonAtomic(files.emptyRoomIndexPath, index);
      return index;
    }
    function writeDerivedIndexes(snapshot, files, onlyIndexes = false) {
      const resources = getResources(snapshot);
      const classes = buildClassDerivedFiles(snapshot, files, onlyIndexes);
      const teachers = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "teacher",
        resources.teacherSchedules,
        resources.teachers,
        ["teacherName", "name", "title"],
        files.teacherScheduleDir,
        files.teachersIndexPath,
        onlyIndexes
      );
      const classrooms = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "classroom",
        resources.classroomSchedules,
        resources.classrooms,
        ["roomName", "classroomName", "classroom", "name"],
        files.classroomScheduleDir,
        files.classroomsIndexPath,
        onlyIndexes
      );
      const courses = buildNamedScheduleDerivedFiles(
        snapshot,
        files,
        "course",
        resources.courseSchedules,
        resources.courses,
        ["courseName", "displayCourseName", "canonicalCourseName", "name", "title"],
        files.courseScheduleDir,
        files.coursesIndexPath,
        onlyIndexes
      );
      const emptyRooms = buildEmptyRoomDerivedFiles(snapshot, files, classrooms);
      const shards = writeIndexShardFiles(snapshot, files, { classes, teachers, classrooms, courses });
      return { classes, teachers, classrooms, courses, emptyRooms, shards };
    }
    function hasCourseTiming(course) {
      return course.weekday !== void 0 || course.dayOfWeek !== void 0 || course.week !== void 0;
    }
    function hasCourseSections(course) {
      return course.startSection !== void 0 && course.endSection !== void 0;
    }
    function hasCourseName(course) {
      return Boolean(
        course.courseName || course.displayCourseName || course.canonicalCourseName || course.name || course.title
      );
    }
    function validateCourse(course, location) {
      if (!course || typeof course !== "object") {
        return `${location}: course must be an object`;
      }
      if (!hasCourseTiming(course)) {
        return `${location}: missing weekday/dayOfWeek`;
      }
      if (!hasCourseSections(course)) {
        return `${location}: missing startSection/endSection`;
      }
      if (!hasCourseName(course)) {
        return `${location}: missing courseName/displayCourseName`;
      }
      return "";
    }
    function validateScheduleList(list, label, requireClassName) {
      const errors = [];
      asArray(list).forEach((schedule, index) => {
        if (!schedule || typeof schedule !== "object") {
          errors.push(`${label}[${index}] must be an object`);
          return;
        }
        if (requireClassName && !(schedule.className || schedule.title || schedule.name)) {
          errors.push(`${label}[${index}] missing className/title`);
        }
        if (!Array.isArray(schedule.courses)) {
          errors.push(`${label}[${index}].courses must be an array`);
          return;
        }
        schedule.courses.forEach((course, courseIndex) => {
          const courseError = validateCourse(course, `${label}[${index}].courses[${courseIndex}]`);
          if (courseError) {
            errors.push(courseError);
          }
        });
      });
      return errors;
    }
    function validateReleaseSnapshot(snapshot) {
      const errors = [];
      if (!snapshot || typeof snapshot !== "object") {
        return {
          valid: false,
          errors: ["snapshot must be an object"],
          counts: {}
        };
      }
      if (!snapshot.catalog || !Array.isArray(snapshot.catalog.colleges) || snapshot.catalog.colleges.length <= 0) {
        errors.push("catalog.colleges.length must be greater than 0");
      }
      if (!Array.isArray(snapshot.majors) || snapshot.majors.length <= 0) {
        errors.push("majorsCount must be greater than 0");
      }
      if (!Array.isArray(snapshot.classSchedules) || snapshot.classSchedules.length <= 0) {
        errors.push("classScheduleCount must be greater than 0");
      }
      const term = snapshot.term || snapshot.semester || snapshot.termConfig && snapshot.termConfig.term || "";
      try {
        const termConfig = termRegistryService2.normalizeTermRecord(Object.assign({}, snapshot.termConfig || {}, {
          term,
          termStartDate: snapshot.termConfig && snapshot.termConfig.termStartDate || snapshot.termStartDate || "",
          totalWeeks: snapshot.termConfig && snapshot.termConfig.totalWeeks || snapshot.totalWeeks || (term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.totalWeeks : undefined),
          weekStart: snapshot.termConfig && snapshot.termConfig.weekStart || snapshot.weekStart || "monday",
          status: "ready",
          releaseVersion: snapshot.version || snapshot.releaseVersion || "",
          dataAvailable: true,
          updatedAt: snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          source: snapshot.source || "release-snapshot"
        }));
        const termValidation = termRegistryService2.validateTermRecord(termConfig);
        if (!termValidation.valid) {
          termValidation.errors.forEach((error) => errors.push(`termConfig.${error}`));
        }
      } catch (error) {
        errors.push(`termConfig.${error.code || error.message}`);
      }
      errors.push.apply(errors, validateScheduleList(snapshot.classSchedules, "classSchedules", true));
      const resources = getResources(snapshot);
      errors.push.apply(errors, validateScheduleList(resources.teacherSchedules, "resources.teacherSchedules", false));
      errors.push.apply(errors, validateScheduleList(resources.classroomSchedules, "resources.classroomSchedules", false));
      errors.push.apply(errors, validateScheduleList(resources.courseSchedules, "resources.courseSchedules", false));
      return {
        valid: errors.length === 0,
        errors,
        counts: countRelease(snapshot)
      };
    }
    function buildBootstrap(snapshot, version, counts, resourceCounts) {
      const updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      return {
        success: true,
        dataSource: "snapshot",
        updatedAt,
        version,
        term: snapshot.term || snapshot.semester,
        semester: snapshot.semester,
        termConfig: snapshot.termConfig || null,
        catalog: snapshot.catalog || {},
        counts,
        resourceCounts,
        versions: {
          snapshot: version,
          catalog: version,
          majors: version,
          classSchedules: version,
          resources: version
        },
        metaDetails: {
          source: snapshot.source || "local-sync-client",
          disclaimer: snapshot.disclaimer || "\u672C\u5DE5\u5177\u4E3A\u4E2A\u4EBA\u5F00\u53D1\uFF0C\u975E\u5B66\u6821\u5B98\u65B9\u670D\u52A1\u3002\u8BFE\u7A0B\u6570\u636E\u7531\u5F00\u53D1\u8005\u6574\u7406\u7EF4\u62A4\u53CA\u7528\u6237\u53CD\u9988\u4FEE\u6B63\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u5177\u4F53\u5B89\u6392\u8BF7\u4EE5\u4EFB\u8BFE\u6559\u5E08\u901A\u77E5\u53CA\u6B63\u5F0F\u901A\u77E5\u4E3A\u51C6\u3002",
          catalogUpdatedAt: updatedAt,
          majorsUpdatedAt: updatedAt,
          classSchedulesUpdatedAt: updatedAt,
          resourcesUpdatedAt: updatedAt
        }
      };
    }
    function buildManifest(snapshot, version, counts, validation, files, derived, calendar) {
      const updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      const filesMeta = files ? buildReleasePackFilesMeta(files) : {};
      const staticUrls = buildStaticReleaseUrls(version, derived);
      const fingerprint = calculateFingerprint2(snapshot);
      const rawTermConfig = snapshot.termConfig && typeof snapshot.termConfig === "object" ? snapshot.termConfig : {};
      const term = snapshot.term || snapshot.semester || rawTermConfig.term || "";
      const legacyTermConfig = term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG : {};
      const termConfig = termRegistryService2.normalizeTermRecord({
        term,
        semesterText: rawTermConfig.semesterText || snapshot.semesterText || legacyTermConfig.semesterText || "",
        termStartDate: rawTermConfig.termStartDate || snapshot.termStartDate || legacyTermConfig.termStartDate || "",
        totalWeeks: rawTermConfig.totalWeeks || snapshot.totalWeeks || legacyTermConfig.totalWeeks,
        weekStart: rawTermConfig.weekStart || snapshot.weekStart || legacyTermConfig.weekStart || "monday",
        status: "ready",
        releaseVersion: version,
        dataAvailable: true,
        publishedAt: snapshot.publishedAt || updatedAt,
        updatedAt,
        source: rawTermConfig.source || snapshot.source || "release-snapshot"
      });
      const resourceCounts = buildResourceCountContract(snapshot);
      const releaseCalendarForHash = calendar ? Object.assign({}, calendar, {
        releaseVersion: version,
        manifestTerm: termConfig.term
      }) : null;
      return {
        success: true,
        schemaVersion: 2,
        releasePackSchemaVersion: 1,
        term: termConfig.term,
        releaseVersion: version,
        version,
        semester: snapshot.semester || snapshot.term || termConfig.term,
        semesterText: termConfig.semesterText,
        termStartDate: termConfig.termStartDate,
        totalWeeks: termConfig.totalWeeks,
        weekStart: termConfig.weekStart,
        termConfig,
        updatedAt,
        cacheEpoch: new Date(updatedAt).getTime() || Date.now(),
        dataEpoch: new Date(updatedAt).getTime() || Date.now(),
        forceRefreshToken: `${version}:${new Date(updatedAt).getTime() || Date.now()}`,
        minClientCacheSchema: 5,
        source: snapshot.source || "local-sync-client",
        scopeSources: snapshot.scopeSources || snapshot.meta?.scopeSources || {},
        resourceCounts,
        partial: Boolean(snapshot.partial || snapshot.meta?.partial),
        canonicalHash: fingerprint.canonicalHash,
        counts,
        files: filesMeta,
        staticBasePath: staticUrls.staticBasePath,
        staticBaseUrl: staticUrls.staticBaseUrl,
        staticReleaseUrl: staticUrls.staticReleaseUrl,
        indexUrls: staticUrls.indexUrls,
        emptyRoomUrl: staticUrls.emptyRoomUrl,
        calendarUrl: joinUrl(staticUrls.staticReleaseUrl, "calendar.json"),
        calendarHash: releaseCalendarForHash ? teachingCalendarService.getCalendarHash(releaseCalendarForHash) : "",
        calendarCount: calendar && Array.isArray(calendar.weeks) ? calendar.weeks.length : 0,
        calendarUpdatedAt: calendar && calendar.updatedAt || "",
        detailUrlPattern: staticUrls.detailUrlPattern,
        shards: staticUrls.shards,
        compression: {
          gzip: true,
          br: typeof zlib.brotliCompressSync === "function"
        },
        size: {
          snapshotBytes: files && fs2.existsSync(files.snapshotPath) ? fs2.statSync(files.snapshotPath).size : 0,
          packBytes: sumMetaSize(filesMeta),
          indexBytes: ["index/class.json", "index/teacher.json", "index/classroom.json", "index/course.json"].reduce((sum, key) => sum + Number(filesMeta[key]?.size || 0), 0),
          detailBytes: Object.keys(filesMeta).filter((key) => key.startsWith("detail/")).reduce((sum, key) => sum + Number(filesMeta[key]?.size || 0), 0),
          emptyRoomBytes: Number(filesMeta["empty-room/index.json"]?.size || 0)
        },
        packHealth: {
          valid: validation.valid,
          errors: validation.errors,
          emptyRoom: derived?.emptyRooms?.health || {},
          teacher: {
            teacherIndexCount: Array.isArray(derived?.teachers) ? derived.teachers.length : 0,
            teacherDetailCount: collectJsonFiles(files?.teacherScheduleDir).length,
            directTeacherScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => item.source === "direct").length : 0,
            derivedTeacherScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => !item.source || item.source === "derived" || item.source === "classSchedules-derived").length : 0,
            teacherSourceMode: snapshot.meta?.resourceSource || "derived",
            teacherUnknownNameCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => !item.teacherName && !item.name).length : 0,
            teacherEmptyScheduleCount: Array.isArray(derived?.teachers) ? derived.teachers.filter((item) => Number(item.courseCount || 0) <= 0).length : 0
          }
        },
        pack: {
          index: {
            class: Array.isArray(derived?.classes) ? derived.classes.length : 0,
            teacher: Array.isArray(derived?.teachers) ? derived.teachers.length : 0,
            classroom: Array.isArray(derived?.classrooms) ? derived.classrooms.length : 0,
            course: Array.isArray(derived?.courses) ? derived.courses.length : 0
          },
          detail: {
            class: collectJsonFiles(files?.classScheduleDir).length,
            teacher: collectJsonFiles(files?.teacherScheduleDir).length,
            classroom: collectJsonFiles(files?.classroomScheduleDir).length,
            course: collectJsonFiles(files?.courseScheduleDir).length
          },
          emptyRoom: {
            exists: Boolean(files && fs2.existsSync(files.emptyRoomIndexPath)),
            rooms: Array.isArray(derived?.emptyRooms?.rooms) ? derived.emptyRooms.rooms.length : 0
          }
        },
        validation: {
          valid: validation.valid,
          errors: validation.errors,
          validatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      };
    }
    function coerceSnapshot(rawSnapshot) {
      const snapshot = Object.assign({}, rawSnapshot || {});
      snapshot.version = normalizeVersion(snapshot.version || generateReleaseVersion());
      snapshot.updatedAt = snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
      const rawTermConfig = snapshot.termConfig && typeof snapshot.termConfig === "object" ? snapshot.termConfig : {};
      const term = snapshot.term || snapshot.semester || rawTermConfig.term || "";
      if (term) {
        const legacyTermConfig = term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG : {};
        const termConfig = termRegistryService2.normalizeTermRecord({
          term,
          semesterText: rawTermConfig.semesterText || snapshot.semesterText || legacyTermConfig.semesterText || "",
          termStartDate: rawTermConfig.termStartDate || snapshot.termStartDate || legacyTermConfig.termStartDate || "",
          totalWeeks: rawTermConfig.totalWeeks || snapshot.totalWeeks || legacyTermConfig.totalWeeks,
          weekStart: rawTermConfig.weekStart || snapshot.weekStart || legacyTermConfig.weekStart || "monday",
          status: "ready",
          releaseVersion: snapshot.version,
          dataAvailable: true,
          publishedAt: snapshot.publishedAt || snapshot.updatedAt,
          updatedAt: snapshot.updatedAt,
          source: rawTermConfig.source || snapshot.source || "release-snapshot"
        });
        snapshot.term = termConfig.term;
        snapshot.semester = snapshot.semester || termConfig.term;
        snapshot.termConfig = termConfig;
        snapshot.termStartDate = snapshot.termStartDate || termConfig.termStartDate;
        snapshot.totalWeeks = snapshot.totalWeeks || termConfig.totalWeeks;
        snapshot.weekStart = snapshot.weekStart || termConfig.weekStart;
      }
      snapshot.resources = getResources(snapshot);
      snapshot.coverage = Object.assign({}, snapshot.coverage || {}, countRelease(snapshot));
      return snapshot;
    }
    function writeReleaseSnapshot(rawSnapshot) {
      ensureStorageDirs();
      const snapshot = coerceSnapshot(rawSnapshot);
      const version = snapshot.version;
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const files = getReleaseFiles(version);
      const resourceCounts = buildResourceCountContract(snapshot);
      const bootstrap = buildBootstrap(snapshot, version, validation.counts, resourceCounts);
      writeJsonAtomic(files.snapshotPath, snapshot);
      writeJsonAtomic(files.bootstrapPath, bootstrap);
      writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
      writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
      const derived = writeDerivedIndexes(snapshot, files);
      const calendar = teachingCalendarService.readTermCalendar(snapshot.term || snapshot.semester);
      const manifest = buildManifest(snapshot, version, validation.counts, validation, files, derived, calendar);
      manifest.compression = Object.assign({}, manifest.compression || {}, estimateStaticReleaseCompression(version, { includeManifest: true }));
      writeJsonAtomic(files.manifestPath, manifest);
      teachingCalendarService.writeReleaseCalendar(manifest, {
        calendar,
        releaseDir: files.releaseDir,
        publicReleaseDir: files.publicReleaseDir
      });
      const compression = mirrorStaticReleaseFiles(version);
      manifest.compression = Object.assign({}, manifest.compression || {}, compression);
      return {
        version,
        releaseDir: files.releaseDir,
        publicReleaseDir: files.publicReleaseDir,
        manifest,
        bootstrap,
        derived,
        snapshot
      };
    }
    async function writeReleaseSnapshotAsync(rawSnapshot, options = {}) {
      ensureStorageDirs();
      if (options.job) options.job.progress(20, "normalizing data");
      const snapshot = coerceSnapshot(rawSnapshot);
      const version = snapshot.version;
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const atomic = options.atomic !== false;
      const finalFiles = getReleaseFiles(version);
      const files = atomic ? getBuildingReleaseFiles(version, getReleaseBuildJobId(options)) : finalFiles;
      let derived = null;
      let manifest = null;
      const resourceCounts = buildResourceCountContract(snapshot);
      const bootstrap = buildBootstrap(snapshot, version, validation.counts, resourceCounts);
      if (atomic) cleanupBuildingReleaseFiles(files);
      try {
        writeJsonAtomic(files.snapshotPath, snapshot);
        writeJsonAtomic(files.bootstrapPath, bootstrap);
        writeJsonAtomic(files.classSchedulesPath, snapshot.classSchedules || []);
        writeJsonAtomic(files.resourcesPath, snapshot.resources || {});
        if (options.job) options.job.progress(30, "building indexes", { releaseVersion: version });
        derived = writeDerivedIndexes(snapshot, files);
        if (options.job) options.job.progress(46, "writing manifest", { releaseVersion: version });
        const calendar = teachingCalendarService.readTermCalendar(snapshot.term || snapshot.semester);
        manifest = buildManifest(snapshot, version, validation.counts, validation, files, derived, calendar);
        manifest.compression = Object.assign(
          {},
          manifest.compression || {},
          estimateStaticReleaseCompression(version, { includeManifest: true, files })
        );
        writeJsonAtomic(files.manifestPath, manifest);
        teachingCalendarService.writeReleaseCalendar(manifest, {
          calendar,
          releaseDir: files.releaseDir,
          publicReleaseDir: files.publicReleaseDir
        });
        const compression = await mirrorStaticReleaseFilesAsync(version, {
          files,
          onProgress: (progress) => {
            if (options.job) {
              const ratio = progress.total ? progress.processed / progress.total : 1;
              options.job.progress(48 + Math.floor(ratio * 14), "compressing gzip", {
                processedFiles: progress.processed,
                totalFiles: progress.total,
                file: progress.relativePath
              });
            }
            if (typeof options.onProgress === "function") options.onProgress(progress);
          }
        });
        manifest.compression = Object.assign({}, manifest.compression || {}, compression);
        if (atomic) {
          if (options.job) options.job.progress(64, "deep validating", { releaseVersion: version });
          const deepStatus = getReleasePackStatus(version, { files });
          if (!deepStatus.healthy) {
            const err = new Error("Release Pack build validation failed");
            err.code = "RELEASE_PACK_BUILD_UNHEALTHY";
            err.status = deepStatus;
            throw err;
          }
          if (typeof options.beforePromote === "function") {
            await options.beforePromote({
              version,
              files,
              finalFiles,
              snapshot,
              manifest,
              bootstrap,
              derived,
              validation,
              status: deepStatus
            });
          }
          if (options.job) options.job.progress(68, "promoting release files", { releaseVersion: version });
          replaceReleaseFilesFromBuild(files, finalFiles);
        }
      } catch (error) {
        if (atomic) cleanupBuildingReleaseFiles(files);
        throw error;
      }
      return {
        version,
        releaseDir: finalFiles.releaseDir,
        publicReleaseDir: finalFiles.publicReleaseDir,
        manifest,
        bootstrap,
        derived,
        snapshot
      };
    }
    function readReleaseSnapshot(version) {
      if (!version) {
        return null;
      }
      const files = getReleaseFiles(version);
      const snapshot = readJsonFile(files.snapshotPath);
      if (snapshot) {
        return snapshot;
      }
      const bootstrap = readJsonFile(files.bootstrapPath);
      const classSchedules = readJsonFile(files.classSchedulesPath);
      const resources = readJsonFile(files.resourcesPath);
      const manifest = readJsonFile(files.manifestPath);
      if (!bootstrap || !Array.isArray(classSchedules)) {
        return null;
      }
      return {
        version: normalizeVersion(version),
        term: bootstrap.term || manifest?.term || manifest?.semester || bootstrap.semester,
        semester: bootstrap.semester || manifest?.semester || manifest?.term,
        termConfig: bootstrap.termConfig || manifest?.termConfig || null,
        termStartDate: manifest?.termStartDate || manifest?.termConfig?.termStartDate || "",
        totalWeeks: manifest?.totalWeeks || manifest?.termConfig?.totalWeeks || (manifest && (manifest.term || manifest.semester) === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term ? termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.totalWeeks : undefined),
        weekStart: manifest?.weekStart || manifest?.termConfig?.weekStart || "monday",
        updatedAt: bootstrap.updatedAt || manifest?.updatedAt,
        source: bootstrap.metaDetails?.source || manifest?.source || "local-sync-client",
        disclaimer: bootstrap.metaDetails?.disclaimer,
        catalog: bootstrap.catalog || {},
        majors: [],
        classSchedules,
        resources: getResources({ resources }),
        coverage: bootstrap.counts || manifest?.counts || {},
        resourceCounts: bootstrap.resourceCounts || manifest?.resourceCounts || null
      };
    }
    function writeCurrentSnapshotCompat(snapshot) {
      ensureStorageDirs();
      writeJsonAtomic(CURRENT_SNAPSHOT_PATH, snapshot);
      fs2.writeFileSync(CURRENT_SNAPSHOT_GZ_PATH, zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), "utf-8")));
    }
    function readFileBufferIfExists(filePath) {
      try {
        return fs2.existsSync(filePath) ? fs2.readFileSync(filePath) : null;
      } catch (error) {
        safeLog("release-activation-backup-read-failed", { filePath, error: error.message });
        return null;
      }
    }
    function restoreFileBuffer(filePath, buffer) {
      try {
        if (buffer == null) {
          if (fs2.existsSync(filePath)) fs2.unlinkSync(filePath);
          return;
        }
        ensureDir(path2.dirname(filePath));
        fs2.writeFileSync(filePath, buffer);
      } catch (error) {
        safeLog("release-activation-rollback-file-failed", { filePath, error: error.message });
      }
    }
    function restoreActivationState(previousState) {
      if (!previousState) return;
      restoreFileBuffer(ACTIVE_RELEASE_PATH, previousState.active);
      restoreFileBuffer(CURRENT_SNAPSHOT_PATH, previousState.currentSnapshot);
      restoreFileBuffer(CURRENT_SNAPSHOT_GZ_PATH, previousState.currentSnapshotGz);
      restoreFileBuffer(termReleaseIndexService.TERM_INDEX_PATH, previousState.termIndex);
      clearDerivedCache();
    }
    function activateReleaseVersion(version) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const snapshot = readReleaseSnapshot(normalizedVersion);
      if (!snapshot) {
        const err = new Error(`Release ${normalizedVersion} not found`);
        err.statusCode = 404;
        throw err;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      try {
        assertHealthyReleasePack(normalizedVersion);
      } catch (error) {
        if (error && error.code === "RELEASE_PACK_UNHEALTHY" && snapshot) {
          rebuildReleasePack(normalizedVersion);
        } else {
          throw error;
        }
      }
      const packStatus = assertHealthyReleasePack(normalizedVersion);
      const fingerprint = calculateFingerprint2(snapshot);
      const cacheEpoch = Date.now();
      const forceRefreshToken = `${normalizedVersion}:${cacheEpoch}`;
      const previousState = {
        active: readFileBufferIfExists(ACTIVE_RELEASE_PATH),
        currentSnapshot: readFileBufferIfExists(CURRENT_SNAPSHOT_PATH),
        currentSnapshotGz: readFileBufferIfExists(CURRENT_SNAPSHOT_GZ_PATH),
        termIndex: readFileBufferIfExists(termReleaseIndexService.TERM_INDEX_PATH)
      };
      const active = {
        version: normalizedVersion,
        releaseVersion: normalizedVersion,
        activatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: snapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        cacheEpoch,
        forceRefreshToken,
        packStatus: {
          healthy: packStatus.healthy,
          manifestExists: packStatus.manifestExists,
          manifestValid: packStatus.manifestValid,
          hashValid: packStatus.hashValid,
          missing: packStatus.missing || [],
          hashErrors: packStatus.hashErrors || []
        },
        term: snapshot.term || snapshot.semester || "",
        semester: snapshot.semester,
        termConfig: snapshot.termConfig || null,
        counts: validation.counts,
        canonicalHash: fingerprint.canonicalHash
      };
      try {
        writeJsonAtomic(ACTIVE_RELEASE_PATH, active);
        writeCurrentSnapshotCompat(Object.assign({}, snapshot, {
          version: normalizedVersion,
          releaseVersion: normalizedVersion,
          coverage: Object.assign({}, snapshot.coverage || {}, validation.counts)
        }));
        const activeTerm = active.term || active.semester || "";
        if (activeTerm) {
          termReleaseIndexService.activateTerm(activeTerm, normalizedVersion);
          const registryTerm = termRegistryService2.getTerm(activeTerm);
          if (registryTerm) {
            if (registryTerm.releaseVersion !== normalizedVersion || registryTerm.status !== "ready") {
              termRegistryService2.bindReleaseToTerm(activeTerm, normalizedVersion, { status: "ready" });
            }
            termRegistryService2.activateTerm(activeTerm, { source: "release-activate" });
          }
        }
        const manifest = getReleasePackManifest(normalizedVersion);
        if (manifest && manifest.success) {
          runtimePointerService.writeActivePointerForManifest(manifest);
        }
      } catch (error) {
        restoreActivationState(previousState);
        error.rollbackApplied = true;
        throw error;
      }
      return {
        active,
        snapshot,
        validation
      };
    }
    function activateReleaseFromSnapshot(rawSnapshot) {
      const written = writeReleaseSnapshot(rawSnapshot);
      const activated = activateReleaseVersion(written.version);
      return Object.assign({}, written, activated);
    }
    function getActiveReleaseInfo() {
      ensureStorageDirs();
      const active = readJsonFile(ACTIVE_RELEASE_PATH);
      if (!active || !active.version) {
        return null;
      }
      const files = getReleaseFiles(active.version);
      const manifest = readJsonFile(files.manifestPath);
      const quickHealth = getReleasePackQuickHealth(active.version);
      const counts = manifest?.counts || active.counts || {};
      const resourceCounts = getReleaseResourceCounts(active.version);
      const semester2 = active.semester || manifest?.semester || manifest?.term || "";
      return Object.assign({}, active, {
        version: active.version,
        releaseVersion: active.version,
        term: semester2,
        semester: semester2,
        termConfig: active.termConfig || manifest?.termConfig || null,
        publishedAt: active.activatedAt || active.updatedAt || "",
        counts,
        resourceCounts,
        canonicalHash: active.canonicalHash || manifest?.canonicalHash || "",
        source: "release",
        status: "active",
        paths: {
          releaseDir: files.releaseDir,
          snapshotPath: files.snapshotPath,
          manifestPath: files.manifestPath,
          classesIndexPath: files.classesIndexPath,
          teachersIndexPath: files.teachersIndexPath,
          classroomsIndexPath: files.classroomsIndexPath,
          coursesIndexPath: files.coursesIndexPath,
          emptyRoomIndexPath: files.emptyRoomIndexPath
        },
        releasePack: quickHealth,
        packStatus: quickHealth,
        snapshot: {
          version: manifest?.version || active.version,
          releaseVersion: manifest?.releaseVersion || manifest?.version || active.version,
          term: manifest?.term || manifest?.semester || semester2,
          semester: semester2,
          termConfig: manifest?.termConfig || active.termConfig || null,
          updatedAt: manifest?.updatedAt || active.updatedAt || "",
          generatedAt: manifest?.generatedAt || "",
          source: manifest?.source || ""
        },
        valid: quickHealth.healthy,
        errors: quickHealth.healthy ? [] : ["Release Pack quick health failed"]
      });
    }
    function readActiveReleaseSnapshot() {
      const active = getActiveReleaseInfo();
      if (!active || !active.version) {
        return null;
      }
      const snapshot = readReleaseSnapshot(active.version);
      if (!snapshot) {
        return null;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        safeLog("active-release-invalid", { version: active.version, errors: validation.errors });
        return null;
      }
      return Object.assign({}, snapshot, {
        version: active.version,
        updatedAt: snapshot.updatedAt || active.updatedAt,
        coverage: Object.assign({}, snapshot.coverage || {}, active.counts || {})
      });
    }
    function readCurrentSnapshotCompat() {
      const current = readJsonFile(CURRENT_SNAPSHOT_PATH);
      if (current) {
        return current;
      }
      try {
        if (fs2.existsSync(CURRENT_SNAPSHOT_GZ_PATH)) {
          return JSON.parse(zlib.gunzipSync(fs2.readFileSync(CURRENT_SNAPSHOT_GZ_PATH)).toString("utf-8"));
        }
      } catch (error) {
        safeLog("release-read-current-gzip-failed", { error: error.message });
      }
      return null;
    }
    function getActiveSnapshotData() {
      const releaseSnapshot = readActiveReleaseSnapshot();
      if (releaseSnapshot) {
        return Object.assign({}, releaseSnapshot, {
          snapshotSource: "release"
        });
      }
      const currentSnapshot = readCurrentSnapshotCompat();
      if (currentSnapshot) {
        return Object.assign({}, currentSnapshot, {
          snapshotSource: "legacy-current"
        });
      }
      return null;
    }
    function getReleaseStatus() {
      const active = getActiveReleaseInfo();
      const snapshot = active ? readReleaseSnapshot(active.version) : null;
      const validation = snapshot ? validateReleaseSnapshot(snapshot) : null;
      const resourceCounts = active ? getReleaseResourceCounts(active.version, snapshot) : null;
      return {
        activeReleaseVersion: active?.version || null,
        activeReleaseUpdatedAt: active?.updatedAt || null,
        activeReleaseActivatedAt: active?.activatedAt || null,
        semester: active?.semester || snapshot?.semester || null,
        term: active?.term || snapshot?.term || active?.semester || snapshot?.semester || null,
        termConfig: active?.termConfig || snapshot?.termConfig || null,
        counts: validation?.counts || active?.counts || {},
        resourceCounts,
        valid: validation ? validation.valid : false,
        errors: validation ? validation.errors : [],
        storagePath: RELEASES_DIR
      };
    }
    function listReleases(limit = 20) {
      ensureStorageDirs();
      const entries = fs2.readdirSync(RELEASES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
        const version = entry.name;
        const files = getReleaseFiles(version);
        const manifest = readJsonFile(files.manifestPath);
        const stat = fs2.statSync(files.releaseDir);
        const releasePack = getReleasePackStatus(version);
        const resourceCounts = getReleaseResourceCounts(version);
        return {
          version,
          updatedAt: manifest?.updatedAt || stat.mtime.toISOString(),
          releaseVersion: manifest?.releaseVersion || version,
          term: manifest?.term || manifest?.semester || "",
          semester: manifest?.semester || manifest?.term || "",
          counts: manifest?.counts || {},
          resourceCounts,
          valid: manifest?.validation?.valid !== false,
          releasePack
        };
      }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      return entries.slice(0, limit);
    }
    function deleteReleaseVersion(version) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const active = getActiveReleaseInfo();
      if (active && active.version === normalizedVersion) {
        const err = new Error("\u4E0D\u80FD\u5220\u9664\u5F53\u524D active release\uFF0C\u8BF7\u5148\u56DE\u6EDA\u6216\u6FC0\u6D3B\u5176\u4ED6\u7248\u672C");
        err.statusCode = 400;
        throw err;
      }
      const files = getReleaseFiles(normalizedVersion);
      const relative = path2.relative(RELEASES_DIR, files.releaseDir);
      if (!relative || relative.startsWith("..") || path2.isAbsolute(relative)) {
        const err = new Error("Invalid release path");
        err.statusCode = 400;
        throw err;
      }
      if (!fs2.existsSync(files.releaseDir)) {
        const err = new Error(`Release ${normalizedVersion} not found`);
        err.statusCode = 404;
        throw err;
      }
      fs2.rmSync(files.releaseDir, { recursive: true, force: true });
      return { version: normalizedVersion, deleted: true };
    }
    function buildReadableFilesMeta(files) {
      const meta2 = {};
      ["class", "teacher", "classroom", "course"].forEach((kind) => {
        const info = getDerivedFileInfo(kind, files);
        const indexMeta = getFileMeta(info && info.indexPath);
        if (indexMeta) {
          const relativePath = toReleaseRelativePath(files, info.indexPath);
          meta2[relativePath] = indexMeta;
        }
        collectJsonFiles(info && info.scheduleDir).forEach((filePath) => {
          const item = getFileMeta(filePath);
          if (item) {
            meta2[toReleaseRelativePath(files, filePath)] = item;
          }
        });
      });
      const emptyPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
      const emptyMeta = getFileMeta(emptyPath);
      if (emptyMeta) {
        meta2[toReleaseRelativePath(files, emptyPath)] = emptyMeta;
      }
      return meta2;
    }
    function getReleasePackQuickHealth(version) {
      const startedAt = Date.now();
      const active = readJsonFile(ACTIVE_RELEASE_PATH);
      const normalizedVersion = normalizeVersion(version || active?.version || "");
      if (!normalizedVersion) {
        return {
          success: false,
          healthy: false,
          code: "NO_ACTIVE_RELEASE",
          reasonCode: "NO_ACTIVE_RELEASE",
          durationMs: Date.now() - startedAt
        };
      }
      const files = getReleaseFiles(normalizedVersion);
      const manifest = readJsonFile(files.manifestPath) || readJsonFile(path2.join(files.publicReleaseDir, "manifest.json"));
      const keyFiles = {
        manifest: files.manifestPath,
        staticManifest: path2.join(files.publicReleaseDir, "manifest.json"),
        classIndex: files.classIndexAllPath,
        legacyClassIndex: files.classesIndexPath,
        teacherIndex: files.teacherIndexAllPath,
        classroomIndex: files.classroomIndexAllPath,
        courseIndex: files.courseIndexAllPath,
        emptyRoom: files.emptyRoomIndexPath,
        staticEmptyRoom: path2.join(files.publicReleaseDir, "empty-room", "index.json")
      };
      const checks = Object.fromEntries(Object.entries(keyFiles).map(([key, filePath]) => [key, {
        exists: Boolean(filePath && fs2.existsSync(filePath)),
        size: filePath && fs2.existsSync(filePath) ? fs2.statSync(filePath).size : 0
      }]));
      const requiredOk = Boolean(manifest && manifest.releaseVersion === normalizedVersion) && checks.manifest.exists && checks.staticManifest.exists && (checks.classIndex.exists || checks.legacyClassIndex.exists) && checks.teacherIndex.exists && checks.classroomIndex.exists && checks.courseIndex.exists && checks.emptyRoom.exists && checks.staticEmptyRoom.exists;
      return {
        success: true,
        version: normalizedVersion,
        releaseVersion: normalizedVersion,
        active: active && active.version === normalizedVersion,
        manifestExists: Boolean(manifest),
        manifestValid: Boolean(manifest && manifest.releaseVersion === normalizedVersion),
        healthy: requiredOk,
        checks,
        counts: manifest?.counts || active?.counts || {},
        resourceCounts: getReleaseResourceCounts(normalizedVersion),
        emptyRoomHealth: manifest?.packHealth?.emptyRoom || manifest?.emptyRoomHealth || {},
        durationMs: Date.now() - startedAt
      };
    }
    function getReleasePackStatus(version, options = {}) {
      const normalizedVersion = normalizeVersion(version);
      const files = options.files || getReleaseFiles(normalizedVersion);
      const manifest = readJsonFile(files.manifestPath);
      const kinds = ["class", "teacher", "classroom", "course"];
      const index = {};
      const detail = {};
      const sampleDetail = {};
      const missing = [];
      let totalBytes = 0;
      kinds.forEach((kind) => {
        const info = getDerivedFileInfo(kind, files);
        const indexPath = info && info.indexPath;
        const indexExists = Boolean(indexPath && fs2.existsSync(indexPath));
        const items2 = indexExists ? readJsonFile(indexPath) : [];
        const detailFiles = collectJsonFiles(info && info.scheduleDir);
        index[kind] = {
          exists: indexExists,
          path: indexPath ? toReleaseRelativePath(files, indexPath) : "",
          count: Array.isArray(items2) ? items2.length : 0,
          size: indexExists ? fs2.statSync(indexPath).size : 0
        };
        detail[kind] = {
          exists: detailFiles.length > 0,
          dir: info && info.scheduleDir ? toReleaseRelativePath(files, info.scheduleDir) : "",
          count: detailFiles.length
        };
        totalBytes += index[kind].size;
        detailFiles.forEach((filePath) => {
          totalBytes += fs2.statSync(filePath).size;
        });
        if (!indexExists) missing.push(`index/${kind}.json`);
        if (!detailFiles.length) missing.push(`detail/${kind}/*.json`);
        if (Array.isArray(items2) && items2[0] && items2[0].id) {
          const detailPath = path2.join(info.scheduleDir, `${safeScheduleId(kind, items2[0].id, items2[0].id, 0)}.json`);
          sampleDetail[kind] = {
            id: items2[0].id,
            readable: fs2.existsSync(detailPath)
          };
          if (!sampleDetail[kind].readable) {
            missing.push(`detail/${kind}/${items2[0].id}.json`);
          }
        } else {
          sampleDetail[kind] = { id: "", readable: false };
        }
      });
      const emptyPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
      const emptyMeta = getFileMeta(emptyPath);
      if (emptyMeta) {
        totalBytes += emptyMeta.size;
      } else {
        missing.push("empty-room/index.json");
      }
      const manifestFiles = manifest && manifest.files && typeof manifest.files === "object" ? manifest.files : {};
      const currentFiles = buildReadableFilesMeta(files);
      const hashErrors = [];
      Object.keys(manifestFiles).forEach((relativePath) => {
        const absolutePath = path2.join(files.releaseDir, relativePath);
        const currentMeta = getFileMeta(absolutePath);
        const expected = manifestFiles[relativePath] || {};
        if (!currentMeta) {
          hashErrors.push(`${relativePath}:missing`);
        } else if (expected.hash && currentMeta.hash !== expected.hash) {
          hashErrors.push(`${relativePath}:hash`);
        } else if (expected.size && Number(currentMeta.size) !== Number(expected.size)) {
          hashErrors.push(`${relativePath}:size`);
        }
      });
      return {
        version: normalizedVersion,
        releaseVersion: normalizedVersion,
        manifestExists: Boolean(manifest),
        manifestValid: Boolean(manifest && manifest.releaseVersion === normalizedVersion && manifest.files),
        index,
        detail,
        detailCounts: Object.fromEntries(kinds.map((kind) => [kind, detail[kind].count])),
        sampleDetail,
        emptyRoom: {
          exists: Boolean(emptyMeta),
          path: emptyPath ? toReleaseRelativePath(files, emptyPath) : "empty-room/index.json",
          size: emptyMeta ? emptyMeta.size : 0
        },
        totalBytes,
        hashValid: hashErrors.length === 0,
        hashErrors,
        missing,
        currentFiles,
        resourceCounts: getReleaseResourceCounts(normalizedVersion),
        healthy: missing.length === 0 && hashErrors.length === 0
      };
    }
    function assertHealthyReleasePack(version) {
      const status = getReleasePackStatus(version);
      const errors = [];
      if (!status.manifestExists) errors.push("manifest missing");
      if (!status.manifestValid) errors.push("manifest invalid");
      ["class", "teacher", "classroom", "course"].forEach((kind) => {
        const indexInfo = status.index && status.index[kind] || {};
        const detailInfo = status.detail && status.detail[kind] || {};
        if (!indexInfo.exists) errors.push(`index/${kind}.json missing`);
        if (Number(indexInfo.count || 0) <= 0) errors.push(`index/${kind}.json empty`);
        if (!detailInfo.exists || Number(detailInfo.count || 0) <= 0) errors.push(`detail/${kind} missing`);
      });
      if (!status.emptyRoom || !status.emptyRoom.exists) errors.push("empty-room/index.json missing");
      if (!status.hashValid) errors.push.apply(errors, status.hashErrors || []);
      if (Array.isArray(status.missing) && status.missing.length) errors.push.apply(errors, status.missing);
      if (errors.length) {
        const err = new Error(`Release Pack health check failed: ${Array.from(new Set(errors)).join("; ")}`);
        err.code = "RELEASE_PACK_UNHEALTHY";
        err.status = status;
        throw err;
      }
      return status;
    }
    function getReleasePackManifest(version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) {
        return termMismatchPayload({}, resolved, { releaseVersion: version });
      }
      const targetVersion = normalizeVersion(resolved.releaseVersion || version || getActiveReleaseInfo()?.version || "");
      if (!targetVersion) {
        return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE" };
      }
      const files = getReleaseFiles(targetVersion);
      const manifest = readJsonFile(files.manifestPath);
      if (manifest && manifest.releaseVersion) {
        const active = getActiveReleaseInfo();
        const isActive = active && active.version === targetVersion;
        const status2 = getReleasePackQuickHealth(targetVersion);
        const resourceCounts = manifest.resourceCounts || getReleaseResourceCounts(targetVersion);
        return Object.assign({ success: true }, manifest, {
          releaseVersion: manifest.releaseVersion || targetVersion,
          version: manifest.version || targetVersion,
          cacheEpoch: isActive ? active.cacheEpoch || manifest.cacheEpoch : manifest.cacheEpoch,
          dataEpoch: isActive ? active.cacheEpoch || manifest.cacheEpoch : manifest.dataEpoch || manifest.cacheEpoch,
          forceRefreshToken: isActive ? active.forceRefreshToken || manifest.forceRefreshToken || `${targetVersion}:${manifest.cacheEpoch || ""}` : manifest.forceRefreshToken || `${targetVersion}:${manifest.cacheEpoch || ""}`,
          packStatus: status2,
          resourceCounts,
          minClientCacheSchema: manifest.minClientCacheSchema || 5
        });
      }
      const snapshot = readReleaseSnapshot(targetVersion);
      if (snapshot) {
        return {
          success: false,
          code: "RELEASE_PACK_MANIFEST_MISSING",
          reasonCode: "RELEASE_PACK_MANIFEST_MISSING",
          releaseVersion: targetVersion,
          message: "Release Pack manifest is missing; rebuild must run as an admin job."
        };
      }
      const status = getReleasePackQuickHealth(targetVersion);
      if (!Object.keys(status.currentFiles || {}).length) {
        return {
          success: false,
          code: "RELEASE_PACK_NOT_FOUND",
          reasonCode: "RELEASE_PACK_NOT_FOUND",
          releaseVersion: targetVersion
        };
      }
      return {
        success: true,
        schemaVersion: 1,
        releasePackSchemaVersion: 1,
        term: "",
        semester: "",
        termConfig: null,
        version: targetVersion,
        releaseVersion: targetVersion,
        updatedAt: "",
        cacheEpoch: Date.now(),
        counts: {},
        files: status.currentFiles,
        size: {
          snapshotBytes: 0,
          packBytes: sumMetaSize(status.currentFiles)
        },
        validation: {
          valid: status.healthy,
          errors: status.missing.concat(status.hashErrors),
          validatedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        legacyCompat: true
      };
    }
    function rebuildReleasePack(version) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const snapshot = readReleaseSnapshot(normalizedVersion);
      if (!snapshot) {
        const err = new Error(`Release ${normalizedVersion} not found or has no rebuildable snapshot`);
        err.statusCode = 404;
        throw err;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const files = getReleaseFiles(normalizedVersion);
      const derived = writeDerivedIndexes(Object.assign({}, snapshot, { version: normalizedVersion }), files, false);
      const calendar = teachingCalendarService.readTermCalendar(snapshot.term || snapshot.semester);
      const manifest = buildManifest(snapshot, normalizedVersion, validation.counts, validation, files, derived, calendar);
      manifest.compression = Object.assign({}, manifest.compression || {}, estimateStaticReleaseCompression(normalizedVersion, { includeManifest: true }));
      writeJsonAtomic(files.manifestPath, manifest);
      teachingCalendarService.writeReleaseCalendar(manifest, {
        calendar,
        releaseDir: files.releaseDir,
        publicReleaseDir: files.publicReleaseDir
      });
      const compression = mirrorStaticReleaseFiles(normalizedVersion);
      manifest.compression = Object.assign({}, manifest.compression || {}, compression);
      clearDerivedCache();
      return {
        success: true,
        version: normalizedVersion,
        releaseVersion: normalizedVersion,
        manifest,
        derived,
        status: getReleasePackStatus(normalizedVersion)
      };
    }
    async function rebuildReleasePackAsync(version, options = {}) {
      ensureStorageDirs();
      const normalizedVersion = normalizeVersion(version);
      const snapshot = readReleaseSnapshot(normalizedVersion);
      if (!snapshot) {
        const err = new Error(`Release ${normalizedVersion} not found or has no rebuildable snapshot`);
        err.statusCode = 404;
        throw err;
      }
      const validation = validateReleaseSnapshot(snapshot);
      if (!validation.valid) {
        const err = new Error(`Release validation failed: ${validation.errors.join("; ")}`);
        err.validation = validation;
        throw err;
      }
      const atomic = options.atomic !== false;
      const finalFiles = getReleaseFiles(normalizedVersion);
      const files = atomic ? getBuildingReleaseFiles(normalizedVersion, getReleaseBuildJobId(options)) : finalFiles;
      const normalizedSnapshot = Object.assign({}, snapshot, { version: normalizedVersion });
      const resourceCounts = buildResourceCountContract(normalizedSnapshot);
      const bootstrap = buildBootstrap(normalizedSnapshot, normalizedVersion, validation.counts, resourceCounts);
      let derived = null;
      let manifest = null;
      if (atomic) cleanupBuildingReleaseFiles(files);
      try {
        writeJsonAtomic(files.snapshotPath, normalizedSnapshot);
        writeJsonAtomic(files.bootstrapPath, bootstrap);
        writeJsonAtomic(files.classSchedulesPath, normalizedSnapshot.classSchedules || []);
        writeJsonAtomic(files.resourcesPath, normalizedSnapshot.resources || {});
        if (options.job) options.job.progress(22, "building indexes", { version: normalizedVersion });
        derived = writeDerivedIndexes(normalizedSnapshot, files, false);
        const manifestSnapshot = Object.assign({}, normalizedSnapshot, {
          updatedAt: normalizedSnapshot.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
        });
        const calendar = teachingCalendarService.readTermCalendar(normalizedSnapshot.term || normalizedSnapshot.semester);
        manifest = buildManifest(manifestSnapshot, normalizedVersion, validation.counts, validation, files, derived, calendar);
        manifest.compression = Object.assign(
          {},
          manifest.compression || {},
          estimateStaticReleaseCompression(normalizedVersion, { includeManifest: true, files })
        );
        writeJsonAtomic(files.manifestPath, manifest);
        teachingCalendarService.writeReleaseCalendar(manifest, {
          calendar,
          releaseDir: files.releaseDir,
          publicReleaseDir: files.publicReleaseDir
        });
        const compression = await mirrorStaticReleaseFilesAsync(normalizedVersion, {
          files,
          onProgress: (progress) => {
            if (options.job) {
              const ratio = progress.total ? progress.processed / progress.total : 1;
              options.job.progress(36 + Math.floor(ratio * 28), "compressing gzip", {
                processedFiles: progress.processed,
                totalFiles: progress.total,
                file: progress.relativePath
              });
            }
            if (typeof options.onProgress === "function") options.onProgress(progress);
          }
        });
        manifest.compression = Object.assign({}, manifest.compression || {}, compression);
        if (atomic) {
          if (options.job) options.job.progress(66, "deep validating", { version: normalizedVersion });
          const deepStatus = getReleasePackStatus(normalizedVersion, { files });
          if (!deepStatus.healthy) {
            const err = new Error("Release Pack rebuild validation failed");
            err.code = "RELEASE_PACK_REBUILD_UNHEALTHY";
            err.status = deepStatus;
            throw err;
          }
          if (options.job) options.job.progress(68, "promoting release files", { version: normalizedVersion });
          replaceReleaseFilesFromBuild(files, finalFiles);
        }
      } catch (error) {
        if (atomic) cleanupBuildingReleaseFiles(files);
        throw error;
      }
      clearDerivedCache();
      return {
        success: true,
        version: normalizedVersion,
        releaseVersion: normalizedVersion,
        manifest,
        derived,
        status: getReleasePackStatus(normalizedVersion)
      };
    }
    var derivedCache = /* @__PURE__ */ new Map();
    function getDerivedFileInfo(kind, files) {
      const map = {
        class: {
          indexPath: getExistingPath(files.classesIndexPath, files.legacyClassesIndexPath),
          writeIndexPath: files.classesIndexPath,
          scheduleDir: getExistingDir(files.classScheduleDir, files.legacyClassScheduleDir),
          writeScheduleDir: files.classScheduleDir
        },
        teacher: {
          indexPath: getExistingPath(files.teachersIndexPath, files.legacyTeachersIndexPath),
          writeIndexPath: files.teachersIndexPath,
          scheduleDir: getExistingDir(files.teacherScheduleDir, files.legacyTeacherScheduleDir),
          writeScheduleDir: files.teacherScheduleDir
        },
        classroom: {
          indexPath: getExistingPath(files.classroomsIndexPath, files.legacyClassroomsIndexPath),
          writeIndexPath: files.classroomsIndexPath,
          scheduleDir: getExistingDir(files.classroomScheduleDir, files.legacyClassroomScheduleDir),
          writeScheduleDir: files.classroomScheduleDir
        },
        course: {
          indexPath: getExistingPath(files.coursesIndexPath, files.legacyCoursesIndexPath),
          writeIndexPath: files.coursesIndexPath,
          scheduleDir: getExistingDir(files.courseScheduleDir, files.legacyCourseScheduleDir),
          writeScheduleDir: files.courseScheduleDir
        }
      };
      return map[kind] || null;
    }
    function assertReleaseRelativePath(baseDir, filePath) {
      const relative = path2.relative(baseDir, filePath);
      return Boolean(relative && !relative.startsWith("..") && !path2.isAbsolute(relative));
    }
    function readStaticReleaseJson(version, relativePath) {
      const normalizedVersion = normalizeVersion(version);
      if (!normalizedVersion || !relativePath) return null;
      const publicDir = getPublicReleaseDir(normalizedVersion);
      const targetPath = path2.join(publicDir, relativePath);
      if (!assertReleaseRelativePath(publicDir, targetPath) || !fs2.existsSync(targetPath)) {
        return null;
      }
      return readJsonFile(targetPath);
    }
    function readReleasePackStaticManifest(version) {
      const normalizedVersion = normalizeVersion(version || getActiveReleaseInfo()?.version || "");
      if (!normalizedVersion) return null;
      return readStaticReleaseJson(normalizedVersion, "manifest.json") || readJsonFile(getReleaseFiles(normalizedVersion).manifestPath);
    }
    function resolveTermAwareReleaseVersion(options = {}) {
      const requestedTerm = String(options.term || options.semester || "").trim();
      const requestedVersion = normalizeVersion(options.releaseVersion || options.version || "");
      if (requestedTerm) {
        const termValidation = termRegistryService2.validateTermId(requestedTerm);
        if (!termValidation.valid) {
          return {
            success: false,
            code: "TERM_NOT_FOUND",
            reasonCode: "TERM_NOT_FOUND",
            term: requestedTerm,
            releaseVersion: requestedVersion
          };
        }
        const term = termRegistryService2.getTerm(termValidation.term);
        if (!term) {
          if (termValidation.term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term) {
            const active = getActiveReleaseInfo() || {};
            const targetVersion2 = requestedVersion || normalizeVersion(active.releaseVersion || active.version || "");
            const manifest2 = targetVersion2 ? readReleasePackStaticManifest(targetVersion2) : null;
            const manifestTerm2 = manifest2 && (manifest2.term || manifest2.semester || manifest2.termConfig && manifest2.termConfig.term) || active.term || active.semester || "";
            if (targetVersion2 && (!manifestTerm2 || manifestTerm2 === termValidation.term)) {
              return {
                success: true,
                term: termValidation.term,
                releaseVersion: targetVersion2,
                termRecord: null,
                legacyCompatibility: true
              };
            }
            const legacySnapshot = readCurrentSnapshotCompat();
            const legacySnapshotTerm = legacySnapshot && (legacySnapshot.term || legacySnapshot.semester) || "";
            if (!requestedVersion && legacySnapshotTerm === termValidation.term) {
              return {
                success: true,
                term: termValidation.term,
                releaseVersion: "",
                termRecord: null,
                legacyCompatibility: true
              };
            }
          }
          return {
            success: false,
            code: "TERM_NOT_FOUND",
            reasonCode: "TERM_NOT_FOUND",
            term: termValidation.term,
            releaseVersion: requestedVersion
          };
        }
        if (term.status === "disabled") {
          return {
            success: false,
            code: "TERM_DISABLED",
            reasonCode: "TERM_DISABLED",
            term: termValidation.term,
            releaseVersion: requestedVersion
          };
        }
        if (!term.dataAvailable || !term.releaseVersion) {
          if (termValidation.term === termRegistryService2.LEGACY_CURRENT_TERM_CONFIG.term) {
            const active = getActiveReleaseInfo() || {};
            const targetVersion2 = requestedVersion || normalizeVersion(active.releaseVersion || active.version || "");
            const manifest2 = targetVersion2 ? readReleasePackStaticManifest(targetVersion2) : null;
            const manifestTerm2 = manifest2 && (manifest2.term || manifest2.semester || manifest2.termConfig && manifest2.termConfig.term) || active.term || active.semester || "";
            if (targetVersion2 && (!manifestTerm2 || manifestTerm2 === termValidation.term)) {
              return {
                success: true,
                term: termValidation.term,
                releaseVersion: targetVersion2,
                termRecord: term,
                legacyCompatibility: true
              };
            }
            const legacySnapshot = readCurrentSnapshotCompat();
            const legacySnapshotTerm = legacySnapshot && (legacySnapshot.term || legacySnapshot.semester) || "";
            if (!requestedVersion && legacySnapshotTerm === termValidation.term) {
              return {
                success: true,
                term: termValidation.term,
                releaseVersion: "",
                termRecord: term,
                legacyCompatibility: true
              };
            }
          }
          return {
            success: false,
            code: "TERM_NOT_PUBLISHED",
            reasonCode: "TERM_NOT_PUBLISHED",
            term: termValidation.term,
            releaseVersion: requestedVersion,
            dataAvailable: false
          };
        }
        const mappedVersion = termReleaseIndexService.getActiveReleaseVersionForTerm(termValidation.term) || term.releaseVersion || "";
        const targetVersion = requestedVersion || mappedVersion;
        if (!targetVersion) {
          return {
            success: false,
            code: "TERM_DATA_MISSING",
            reasonCode: "TERM_DATA_MISSING",
            term: termValidation.term,
            releaseVersion: ""
          };
        }
        const manifest = readReleasePackStaticManifest(targetVersion);
        const manifestTerm = manifest && (manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term) || "";
        if (manifestTerm && manifestTerm !== termValidation.term) {
          return {
            success: false,
            code: "TERM_DATA_MISMATCH",
            reasonCode: "TERM_DATA_MISMATCH",
            term: termValidation.term,
            manifestTerm,
            releaseVersion: targetVersion
          };
        }
        if (requestedVersion && mappedVersion && requestedVersion !== mappedVersion) {
          const requestedManifest = readReleasePackStaticManifest(requestedVersion);
          const requestedManifestTerm = requestedManifest && (requestedManifest.term || requestedManifest.semester || requestedManifest.termConfig && requestedManifest.termConfig.term) || "";
          if (requestedManifestTerm && requestedManifestTerm !== termValidation.term) {
            return {
              success: false,
              code: "TERM_DATA_MISMATCH",
              reasonCode: "TERM_DATA_MISMATCH",
              term: termValidation.term,
              manifestTerm: requestedManifestTerm,
              releaseVersion: requestedVersion
            };
          }
        }
        return {
          success: true,
          term: termValidation.term,
          releaseVersion: targetVersion,
          termRecord: term
        };
      }
      return {
        success: true,
        term: "",
        releaseVersion: requestedVersion,
        termRecord: null
      };
    }
    function termMismatchPayload(base, resolved, fallback = {}) {
      return Object.assign({
        success: false,
        code: resolved.code || "TERM_DATA_MISMATCH",
        reasonCode: resolved.reasonCode || resolved.code || "TERM_DATA_MISMATCH",
        term: resolved.term || fallback.term || "",
        releaseVersion: resolved.releaseVersion || fallback.releaseVersion || ""
      }, base || {}, resolved);
    }
    function normalizeStaticIndexPayload(kind, payload, version) {
      const manifest = readReleasePackStaticManifest(version) || {};
      const items2 = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : null;
      if (!items2) return null;
      const releaseVersion = normalizeVersion(version || manifest.releaseVersion || payload?.releaseVersion || "");
      return Object.assign({}, Array.isArray(payload) ? {} : payload, {
        success: true,
        schemaVersion: payload?.schemaVersion || 1,
        type: kind,
        term: payload?.term || manifest.term || manifest.semester || "",
        semester: payload?.semester || payload?.term || manifest.semester || manifest.term || "",
        releaseVersion,
        version: payload?.version || releaseVersion,
        total: Number(payload?.total || items2.length) || items2.length,
        items: items2,
        dataSource: "static-release-pack"
      });
    }
    function readReleasePackStaticIndex(kind, version, shard = "", options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) return null;
      const normalizedVersion = normalizeVersion(resolved.releaseVersion || version || getActiveReleaseInfo()?.version || "");
      if (!normalizedVersion || !["class", "teacher", "classroom", "course"].includes(kind)) return null;
      const candidates = [];
      if (kind === "class" && shard) {
        candidates.push(`index/class/${shard}`);
      }
      candidates.push(`index/${kind}/all.json`, `index/${kind}.json`);
      for (const relativePath of candidates) {
        const payload = readStaticReleaseJson(normalizedVersion, relativePath);
        const normalized = normalizeStaticIndexPayload(kind, payload, normalizedVersion);
        if (normalized && (!resolved.term || normalized.term === resolved.term || normalized.semester === resolved.term)) return normalized;
      }
      return null;
    }
    function readReleasePackStaticDetail(kind, id, version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) return null;
      const normalizedVersion = normalizeVersion(resolved.releaseVersion || version || getActiveReleaseInfo()?.version || "");
      if (!normalizedVersion || !["class", "teacher", "classroom", "course"].includes(kind) || !id) return null;
      const safeId = safeScheduleId(kind, id, id, 0);
      const schedule = readStaticReleaseJson(normalizedVersion, `detail/${kind}/${safeId}.json`);
      if (!schedule) return null;
      const manifest = readReleasePackStaticManifest(normalizedVersion) || {};
      const term = schedule.term || schedule.semester || manifest.term || "";
      if (resolved.term && term && term !== resolved.term) return null;
      return {
        success: true,
        schemaVersion: 1,
        type: kind,
        id: safeId,
        term,
        semester: schedule.semester || schedule.term || manifest.semester || manifest.term || "",
        releaseVersion: normalizedVersion,
        version: normalizedVersion,
        updatedAt: schedule.updatedAt || manifest.updatedAt || "",
        dataSource: "static-release-pack",
        schedule,
        detail: schedule
      };
    }
    function readReleasePackStaticEmptyRoom(version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) return null;
      const normalizedVersion = normalizeVersion(resolved.releaseVersion || version || getActiveReleaseInfo()?.version || "");
      if (!normalizedVersion) return null;
      const payload = readStaticReleaseJson(normalizedVersion, "empty-room/index.json");
      if (!payload || !Array.isArray(payload.rooms)) return null;
      const term = payload.term || payload.semester || "";
      if (resolved.term && term && term !== resolved.term) return null;
      return Object.assign({}, payload, {
        success: true,
        releaseVersion: payload.releaseVersion || normalizedVersion,
        version: payload.version || payload.releaseVersion || normalizedVersion,
        dataSource: "static-release-pack"
      });
    }
    function getReadableReleaseInfo() {
      const active = getActiveReleaseInfo();
      if (active && active.version) {
        return {
          source: "active-release",
          version: active.version,
          semester: active.semester,
          updatedAt: active.updatedAt,
          snapshot: null
        };
      }
      const snapshot = readCurrentSnapshotCompat();
      if (!snapshot) {
        return null;
      }
      const updatedAt = snapshot.updatedAt || snapshot.generatedAt || "";
      const version = normalizeVersion(
        snapshot.version || snapshot.releaseVersion || `legacy-current-${cryptoHash(`${snapshot.semester || ""}:${updatedAt}`).slice(0, 12)}`
      );
      return {
        source: "legacy-current",
        version,
        semester: snapshot.semester || snapshot.term || "",
        updatedAt,
        snapshot: hydrateLegacySnapshotResources(Object.assign({}, snapshot, { version }))
      };
    }
    function ensureDerivedIndexes(version, fallbackSnapshot) {
      const files = getReleaseFiles(version);
      const allExist = ["class", "teacher", "classroom", "course"].every((kind) => {
        const info = getDerivedFileInfo(kind, files);
        return info && fs2.existsSync(info.indexPath);
      });
      if (allExist) {
        if (fallbackSnapshot) {
          const resources = getResources(fallbackSnapshot);
          const classIndex = readJsonFile(getDerivedFileInfo("class", files).indexPath, []);
          const teacherIndex = readJsonFile(getDerivedFileInfo("teacher", files).indexPath, []);
          const classroomIndex = readJsonFile(getDerivedFileInfo("classroom", files).indexPath, []);
          const courseIndex = readJsonFile(getDerivedFileInfo("course", files).indexPath, []);
          const shouldRefresh = asArray(fallbackSnapshot.classSchedules).length > 0 && asArray(classIndex).length === 0 || resources.teacherSchedules.length > 0 && asArray(teacherIndex).length === 0 || resources.classroomSchedules.length > 0 && asArray(classroomIndex).length === 0 || resources.courseSchedules.length > 0 && asArray(courseIndex).length === 0;
          if (!shouldRefresh) {
            return files;
          }
        } else {
          return files;
        }
      }
      const snapshot = fallbackSnapshot ? coerceSnapshot(Object.assign({}, fallbackSnapshot, { version })) : readReleaseSnapshot(version);
      if (snapshot) {
        writeDerivedIndexes(snapshot, files);
      }
      return files;
    }
    function readActiveIndex(kind, version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) {
        return termMismatchPayload({ items: [] }, resolved, { releaseVersion: version });
      }
      version = resolved.releaseVersion || version;
      let active;
      if (version) {
        const normalized = normalizeVersion(version);
        const snapshot = readReleaseSnapshot(normalized);
        if (snapshot) {
          active = {
            source: "release",
            version: normalized,
            semester: snapshot.semester || snapshot.term || "",
            updatedAt: snapshot.updatedAt || "",
            snapshot
          };
        } else {
          const files2 = getReleaseFiles(normalized);
          const info2 = getDerivedFileInfo(kind, files2);
          if (info2 && fs2.existsSync(info2.indexPath)) {
            active = {
              source: "release",
              version: normalized,
              semester: "",
              updatedAt: "",
              snapshot: null
            };
          } else {
            return {
              success: false,
              code: "RELEASE_NOT_FOUND",
              reasonCode: "RELEASE_NOT_FOUND",
              version: normalized,
              releaseVersion: normalized,
              items: []
            };
          }
        }
      }
      if (!active) {
        active = getReadableReleaseInfo();
      }
      if (!active || !active.version) {
        return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE", items: [] };
      }
      if (resolved.term && active.semester && active.semester !== resolved.term) {
        return termMismatchPayload({ items: [] }, Object.assign({}, resolved, {
          code: "TERM_DATA_MISMATCH",
          reasonCode: "TERM_DATA_MISMATCH",
          manifestTerm: active.semester,
          releaseVersion: active.version
        }));
      }
      const files = ensureDerivedIndexes(active.version, active.snapshot);
      const info = getDerivedFileInfo(kind, files);
      if (!info || !fs2.existsSync(info.indexPath)) {
        return {
          success: false,
          code: "INDEX_NOT_FOUND",
          reasonCode: "INDEX_NOT_FOUND",
          version: active.version,
          releaseVersion: active.version,
          items: []
        };
      }
      const stat = fs2.statSync(info.indexPath);
      const cacheKey = `${active.version}:${kind}:index`;
      const cached = derivedCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.value;
      }
      const items2 = readJsonFile(info.indexPath) || [];
      const value = {
        success: true,
        dataSource: active.source === "legacy-current" ? "legacy-current-index" : version ? "release-isolated-index" : "release-index",
        version: active.version,
        releaseVersion: active.version,
        term: active.semester,
        semester: active.semester,
        updatedAt: active.updatedAt,
        etag: `"${active.version}-${kind}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        items: Array.isArray(items2) ? items2 : []
      };
      derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
      return value;
    }
    function searchActiveIndex(kind, query, options = {}) {
      const version = options.releaseVersion || options.version;
      const index = readActiveIndex(kind, version, options);
      if (!index.success) {
        return index;
      }
      const q = String(query || "").trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(options.limit || "30", 10) || 30, 1), 100);
      const offset = Math.max(parseInt(options.offset || "0", 10) || 0, 0);
      const source = index.items || [];
      const matchesField = (item, optionValue, keys) => {
        const expected = String(optionValue || "").trim();
        if (!expected) return true;
        return keys.some((key) => String(item[key] || "").trim() === expected);
      };
      const scoped = source.filter((item) => {
        if (!matchesField(item, options.semester, ["semester"])) return false;
        if (!matchesField(item, options.collegeCode, ["collegeCode"])) return false;
        if (!matchesField(item, options.collegeName, ["collegeName", "college"])) return false;
        if (!matchesField(item, options.grade, ["grade"])) return false;
        if (!matchesField(item, options.majorCode, ["majorCode"])) return false;
        if (!matchesField(item, options.majorName, ["majorName"])) return false;
        if (!matchesField(item, options.campus, ["campus", "campusName"])) return false;
        return true;
      });
      const filtered = q ? scoped.filter((item) => {
        const haystack = [
          item.id,
          item.name,
          item.className,
          item.teacherName,
          item.roomName,
          item.classroomName,
          item.courseName,
          item.collegeName,
          item.majorName,
          item.grade,
          item.firstCourseName
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      }) : scoped;
      return Object.assign({}, index, {
        query: q,
        total: filtered.length,
        limit,
        offset,
        items: filtered.slice(offset, offset + limit)
      });
    }
    function readActiveSchedule(kind, id, version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) {
        return termMismatchPayload({}, resolved, { releaseVersion: version });
      }
      version = resolved.releaseVersion || version;
      let active;
      if (version) {
        const normalized = normalizeVersion(version);
        const snapshot = readReleaseSnapshot(normalized);
        if (snapshot) {
          active = {
            source: "release",
            version: normalized,
            semester: snapshot.semester || snapshot.term || "",
            updatedAt: snapshot.updatedAt || "",
            snapshot
          };
        } else {
          const files2 = getReleaseFiles(normalized);
          const info2 = getDerivedFileInfo(kind, files2);
          if (info2 && fs2.existsSync(info2.scheduleDir)) {
            active = {
              source: "release",
              version: normalized,
              semester: "",
              updatedAt: "",
              snapshot: null
            };
          } else {
            return { success: false, code: "RELEASE_NOT_FOUND", reasonCode: "RELEASE_NOT_FOUND" };
          }
        }
      }
      if (!active) {
        active = getReadableReleaseInfo();
      }
      if (!active || !active.version) {
        return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE" };
      }
      if (resolved.term && active.semester && active.semester !== resolved.term) {
        return termMismatchPayload({}, Object.assign({}, resolved, {
          code: "TERM_DATA_MISMATCH",
          reasonCode: "TERM_DATA_MISMATCH",
          manifestTerm: active.semester,
          releaseVersion: active.version
        }));
      }
      const files = ensureDerivedIndexes(active.version, active.snapshot);
      const info = getDerivedFileInfo(kind, files);
      if (!info) {
        return { success: false, reasonCode: "INVALID_KIND" };
      }
      const safeId = safeScheduleId(kind, id, id, 0);
      const filePath = path2.join(info.scheduleDir, `${safeId}.json`);
      const relative = path2.relative(info.scheduleDir, filePath);
      if (relative.startsWith("..") || path2.isAbsolute(relative)) {
        return { success: false, reasonCode: "INVALID_ID" };
      }
      const stat = fs2.existsSync(filePath) ? fs2.statSync(filePath) : null;
      if (!stat) {
        return { success: false, reasonCode: "NOT_FOUND" };
      }
      const cacheKey = `${active.version}:${kind}:schedule:${safeId}`;
      const cached = derivedCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.value;
      }
      const schedule = readJsonFile(filePath);
      const value = {
        success: true,
        dataSource: active.source === "legacy-current" ? "legacy-current-index" : version ? "release-isolated-index" : "release-index",
        version: active.version,
        releaseVersion: active.version,
        term: schedule?.term || schedule?.semester || active.semester,
        semester: schedule?.semester || active.semester,
        updatedAt: schedule?.updatedAt || active.updatedAt,
        etag: `"${active.version}-${kind}-${safeId}-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        schedule
      };
      derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
      return value;
    }
    function ensureEmptyRoomIndex(version, fallbackSnapshot) {
      const files = getReleaseFiles(version);
      const existingEmptyRoomPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
      if (existingEmptyRoomPath && fs2.existsSync(existingEmptyRoomPath)) {
        return files;
      }
      const snapshot = fallbackSnapshot ? coerceSnapshot(Object.assign({}, fallbackSnapshot, { version })) : readReleaseSnapshot(version);
      if (snapshot) {
        buildEmptyRoomDerivedFiles(snapshot, files);
      }
      return files;
    }
    function readEmptyRoomIndex(version, options = {}) {
      const resolved = resolveTermAwareReleaseVersion(Object.assign({}, options, { releaseVersion: version || options.releaseVersion || options.version || "" }));
      if (!resolved.success) {
        return termMismatchPayload({ rooms: [], buildings: [] }, resolved, { releaseVersion: version });
      }
      version = resolved.releaseVersion || version;
      let active;
      if (version) {
        const normalized = normalizeVersion(version);
        const snapshot = readReleaseSnapshot(normalized);
        if (snapshot) {
          active = {
            source: "release",
            version: normalized,
            semester: snapshot.semester || snapshot.term || "",
            updatedAt: snapshot.updatedAt || "",
            snapshot
          };
        } else {
          const files2 = getReleaseFiles(normalized);
          if (fs2.existsSync(files2.emptyRoomIndexPath)) {
            active = {
              source: "release",
              version: normalized,
              semester: "",
              updatedAt: "",
              snapshot: null
            };
          } else {
            return {
              success: false,
              code: "RELEASE_NOT_FOUND",
              reasonCode: "RELEASE_NOT_FOUND",
              version: normalized,
              releaseVersion: normalized,
              rooms: []
            };
          }
        }
      }
      if (!active) {
        active = getReadableReleaseInfo();
      }
      if (!active || !active.version) {
        return { success: false, code: "NO_ACTIVE_RELEASE", reasonCode: "NO_ACTIVE_RELEASE", rooms: [] };
      }
      if (resolved.term && active.semester && active.semester !== resolved.term) {
        return termMismatchPayload({ rooms: [], buildings: [] }, Object.assign({}, resolved, {
          code: "TERM_DATA_MISMATCH",
          reasonCode: "TERM_DATA_MISMATCH",
          manifestTerm: active.semester,
          releaseVersion: active.version
        }));
      }
      const files = ensureEmptyRoomIndex(active.version, active.snapshot);
      const emptyRoomIndexPath = getExistingPath(files.emptyRoomIndexPath, files.legacyEmptyRoomIndexPath);
      if (!emptyRoomIndexPath || !fs2.existsSync(emptyRoomIndexPath)) {
        return {
          success: false,
          code: "EMPTY_ROOM_INDEX_NOT_FOUND",
          reasonCode: "EMPTY_ROOM_INDEX_NOT_FOUND",
          version: active.version,
          releaseVersion: active.version,
          rooms: []
        };
      }
      const stat = fs2.statSync(emptyRoomIndexPath);
      const cacheKey = `${active.version}:empty-room:index`;
      const cached = derivedCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.value;
      }
      const index = readJsonFile(emptyRoomIndexPath) || {};
      const value = Object.assign({}, index, {
        success: true,
        dataSource: active.source === "legacy-current" ? "legacy-current-empty-room-index" : version ? "release-isolated-empty-room-index" : "release-empty-room-index",
        version: index.version || active.version,
        releaseVersion: index.releaseVersion || index.version || active.version,
        semester: index.semester || active.semester,
        term: index.term || index.semester || active.semester,
        updatedAt: index.updatedAt || active.updatedAt,
        etag: `"${active.version}-empty-room-${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        rooms: Array.isArray(index.rooms) ? index.rooms : [],
        buildings: Array.isArray(index.buildings) ? index.buildings : []
      });
      derivedCache.set(cacheKey, { mtimeMs: stat.mtimeMs, value });
      return value;
    }
    function parseDateOnly(value) {
      if (value instanceof Date) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
      }
      const text = String(value || "").trim();
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
        const parts = text.split("-").map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
      }
      const date = text ? new Date(text) : /* @__PURE__ */ new Date();
      if (Number.isNaN(date.getTime())) {
        return /* @__PURE__ */ new Date();
      }
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    function formatDateOnly(date) {
      const target = parseDateOnly(date);
      const pad = (value) => String(value).padStart(2, "0");
      return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
    }
    function getWeekdayFromDate(date) {
      const day = parseDateOnly(date).getDay();
      return day === 0 ? 7 : day;
    }
    function getWeekFromDate(date, termStartDate) {
      const start = termStartDate ? parseDateOnly(termStartDate) : null;
      if (!start || Number.isNaN(start.getTime())) {
        return 1;
      }
      const diffDays = Math.floor((parseDateOnly(date).getTime() - start.getTime()) / 864e5);
      return Math.max(1, Math.min(MAX_EMPTY_ROOM_WEEK, Math.floor(diffDays / 7) + 1));
    }
    function normalizeQuerySections(value) {
      const text = String(value || "").trim();
      if (!text) return [];
      const parsed2 = parseSectionSequence(text);
      return parsed2.length ? parsed2 : parseSectionText(text);
    }
    function sectionsOverlapValues(left, right) {
      const set = new Set(left || []);
      return (right || []).some((section) => set.has(section));
    }
    function differenceSections(occupied) {
      const occupiedSet = new Set(occupied || []);
      return allSections().filter((section) => !occupiedSet.has(section));
    }
    function hasContiguousSections(sections, minCount) {
      const min = Math.max(1, Number(minCount) || 1);
      if (min <= 1) {
        return sections.length > 0;
      }
      let run = 0;
      for (const section of allSections()) {
        if ((sections || []).includes(section)) {
          run += 1;
          if (run >= min) return true;
        } else {
          run = 0;
        }
      }
      return false;
    }
    function getNextOccupiedCourse(courses, weekday, week, afterSection) {
      const next = (courses || []).filter((course) => Number(course.weekday) === Number(weekday)).filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(Number(week)) : true).filter((course) => Number(course.startSection) > Number(afterSection)).sort((left, right) => Number(left.startSection) - Number(right.startSection))[0];
      if (!next) return null;
      return {
        courseName: next.courseName || "",
        teacherName: next.teacherName || "",
        sections: next.sections || [],
        sectionText: `\u7B2C${next.startSection}-${next.endSection}\u8282`
      };
    }
    function formatSectionRange(sections) {
      const list = uniqueNumbers(sections, 1, MAX_EMPTY_ROOM_SECTION);
      if (!list.length) return "";
      return list.length === 1 ? `\u7B2C${list[0]}\u8282` : `\u7B2C${list[0]}-${list[list.length - 1]}\u8282`;
    }
    function queryEmptyClassrooms(options = {}) {
      const requestedVersion = options.releaseVersion || options.version || "";
      const index = readEmptyRoomIndex(requestedVersion, options);
      if (!index.success) {
        return Object.assign({}, index, {
          query: {},
          rooms: [],
          total: 0
        });
      }
      const queryDate = formatDateOnly(options.date || /* @__PURE__ */ new Date());
      const weekday = Number(options.weekday || getWeekdayFromDate(queryDate));
      const week = Number(options.week || getWeekFromDate(queryDate, index.termStartDate));
      const requestedSections = normalizeQuerySections(options.sections || options.section || "1-2");
      const building = String(options.building || "").trim();
      const minFreeSections = Math.max(1, Number(options.minFreeSections || 1) || 1);
      const excludeUnknown = options.excludeUnknown === true || options.excludeUnknown === "1" || options.excludeUnknown === "true";
      const commonOnly = options.commonOnly === true || options.commonOnly === "1" || options.commonOnly === "true";
      const normalizedBuilding = building && building !== "\u5168\u90E8" ? building.toLowerCase() : "";
      const requestedSet = requestedSections.length ? requestedSections : allSections();
      const maxRequestedSection = requestedSet[requestedSet.length - 1] || 0;
      const rooms = (index.rooms || []).filter((room) => {
        if (excludeUnknown && (!room.roomName || room.roomName.includes("\u672A\u77E5") || room.building === "\u672A\u77E5")) {
          return false;
        }
        if (commonOnly && !/[A-Za-z]\d|楼/.test(room.roomName || "")) {
          return false;
        }
        if (normalizedBuilding) {
          const buildingText = String(room.building || "").toLowerCase();
          const roomText = String(room.roomName || "").toLowerCase();
          if (buildingText !== normalizedBuilding && !roomText.includes(normalizedBuilding)) {
            return false;
          }
        }
        return true;
      }).map((room) => {
        const occupiedCourses = (room.courses || []).filter((course) => Number(course.weekday) === weekday).filter((course) => Array.isArray(course.weeks) ? course.weeks.includes(week) : true);
        const occupiedSections = uniqueNumbers(
          occupiedCourses.flatMap((course) => course.sections || []),
          1,
          MAX_EMPTY_ROOM_SECTION
        );
        const freeSections = differenceSections(occupiedSections);
        const requestedIsFree = !sectionsOverlapValues(occupiedSections, requestedSet);
        const enoughFree = requestedSections.length ? requestedSet.length >= minFreeSections : hasContiguousSections(freeSections, minFreeSections);
        return {
          roomName: room.roomName,
          roomId: room.roomId,
          building: room.building || inferBuilding(room.roomName),
          buildingCode: room.buildingCode || normalizeBuilding(room.roomName).buildingCode,
          buildingName: room.buildingName || normalizeBuilding(room.roomName).buildingName,
          campus: room.campus || normalizeBuilding(room.roomName).campus || "",
          confidence: room.confidence == null ? normalizeBuilding(room.roomName).confidence : room.confidence,
          source: room.source || "",
          capacity: room.capacity || null,
          capacityText: room.capacity ? `${room.capacity}\u5EA7` : "\u5BB9\u91CF\u672A\u77E5",
          freeText: `${formatSectionRange(requestedSet)}\u7A7A\u95F2`,
          freeSections,
          occupiedSections,
          todayCourses: occupiedCourses.map((course) => ({
            courseName: course.courseName || "",
            teacherName: course.teacherName || "",
            sections: course.sections || [],
            sectionText: `\u7B2C${course.startSection}-${course.endSection}\u8282`
          })),
          courseCount: room.courseCount || 0,
          nextOccupiedCourse: getNextOccupiedCourse(occupiedCourses, weekday, week, maxRequestedSection),
          _matched: requestedIsFree && enoughFree
        };
      }).filter((room) => room._matched).map((room) => {
        const copy = Object.assign({}, room);
        delete copy._matched;
        return copy;
      }).sort((left, right) => {
        const buildingDiff = String(left.building || "").localeCompare(String(right.building || ""), "zh-CN");
        if (buildingDiff !== 0) return buildingDiff;
        return String(left.roomName || "").localeCompare(String(right.roomName || ""), "zh-CN", { numeric: true });
      });
      return {
        success: true,
        dataSource: index.dataSource,
        term: index.term || index.semester || "",
        semester: index.semester || index.term || "",
        releaseVersion: index.releaseVersion || index.version || "",
        version: index.version || index.releaseVersion || "",
        updatedAt: index.updatedAt || "",
        buildings: index.buildings || [],
        query: {
          term: options.term || index.term || index.semester || "",
          releaseVersion: index.releaseVersion || index.version || "",
          date: queryDate,
          week,
          weekday,
          sections: requestedSections.length ? requestedSections.join("-") : "all",
          building: building || "\u5168\u90E8",
          minFreeSections,
          excludeUnknown,
          commonOnly
        },
        total: rooms.length,
        rooms,
        etag: index.etag
      };
    }
    function parseSnapshotBuffer(buffer) {
      const isGzip = buffer.length >= 2 && buffer[0] === 31 && buffer[1] === 139;
      const jsonText = isGzip ? zlib.gunzipSync(buffer).toString("utf-8") : buffer.toString("utf-8");
      return {
        isGzip,
        snapshot: JSON.parse(jsonText),
        size: buffer.length
      };
    }
    function clearDerivedCache() {
      derivedCache.clear();
    }
    module2.exports = {
      ACTIVE_RELEASE_PATH,
      PUBLIC_RELEASES_DIR,
      RELEASES_DIR,
      STATIC_RELEASE_BASE_URL,
      activateReleaseFromSnapshot,
      activateReleaseVersion,
      countRelease,
      getActiveReleaseInfo,
      getActiveSnapshotData,
      getReleaseFiles,
      getReleasePackManifest,
      getReleasePackQuickHealth,
      getReleasePackStatus,
      getReleaseResourceCounts,
      getReleaseCompressionConfig,
      assertHealthyReleasePack,
      getReleaseStatus,
      deleteReleaseVersion,
      readReleasePackStaticDetail,
      readReleasePackStaticEmptyRoom,
      readReleasePackStaticIndex,
      readReleasePackStaticManifest,
      readActiveIndex,
      readActiveSchedule,
      readEmptyRoomIndex,
      queryEmptyClassrooms,
      listReleases,
      normalizeVersion,
      parseSnapshotBuffer,
      readActiveReleaseSnapshot,
      readReleaseSnapshot,
      rebuildReleasePack,
      rebuildReleasePackAsync,
      searchActiveIndex,
      validateReleaseSnapshot,
      writeDerivedIndexes,
      writeReleaseSnapshot,
      writeReleaseSnapshotAsync,
      mirrorStaticReleaseFilesAsync,
      clearDerivedCache
    };
  }
});

// ../fosu-sync-client/upload.js
var require_upload = __commonJS({
  "../fosu-sync-client/upload.js"(exports2, module2) {
    var axios2 = require("axios");
    var crypto2 = require("crypto");
    var fs2 = require("fs");
    var os = require("os");
    var path2 = require("path");
    var { pipeline } = require("stream/promises");
    var zlib = require("zlib");
    var {
      buildSidecarMeta: buildSidecarMeta2,
      calculateFingerprintFromFile,
      readSidecarHash: readSidecarHash2
    } = require_stagingFingerprint();
    var {
      buildResourceCountContract,
      flattenLegacyCounts
    } = require_resourceCountContract();
    function parseArgs(argv) {
      const args = {};
      for (const arg of argv) {
        if (!arg.startsWith("--")) continue;
        const match2 = arg.match(/^--([^=]+)=(.*)$/);
        if (match2) {
          args[match2[1]] = match2[2];
        } else {
          args[arg.slice(2)] = true;
        }
      }
      return args;
    }
    function resolveProjectRoot(startDir) {
      let current = path2.resolve(startDir || process.cwd());
      while (true) {
        const hasServer = fs2.existsSync(path2.join(current, "server"));
        const hasMiniprogram = fs2.existsSync(path2.join(current, "miniprogram"));
        const hasPackage = fs2.existsSync(path2.join(current, "package.json"));
        const hasGit = fs2.existsSync(path2.join(current, ".git"));
        if (hasServer && hasMiniprogram || hasPackage && hasGit) {
          return current;
        }
        const parent = path2.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return path2.resolve(__dirname, "../..");
    }
    function resolveInputFilePath2(fileArg, options = {}) {
      if (!fileArg) {
        return { resolved: null, tried: [] };
      }
      if (path2.isAbsolute(fileArg)) {
        return { resolved: fileArg, tried: [fileArg] };
      }
      const cwd = path2.resolve(options.cwd || process.cwd());
      const projectRoot = options.projectRoot || resolveProjectRoot(cwd);
      const normalized = path2.normalize(fileArg).replace(/\\/g, "/");
      const candidates = [];
      if (normalized.startsWith("tools/fosu-sync-client/")) {
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(cwd, normalized.slice("tools/fosu-sync-client/".length)));
      } else {
        candidates.push(path2.resolve(cwd, fileArg));
        candidates.push(path2.resolve(projectRoot, fileArg));
        candidates.push(path2.resolve(projectRoot, "tools/fosu-sync-client", fileArg));
      }
      const tried = [];
      for (const candidate of candidates) {
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        if (fs2.existsSync(candidate)) {
          return { resolved: candidate, tried };
        }
      }
      return { resolved: null, tried };
    }
    function toBytesMb(value, fallbackMb) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return fallbackMb * 1024 * 1024;
      }
      return Math.floor(num * 1024 * 1024);
    }
    function hashFile(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto2.createHash("sha256");
        const stream = fs2.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
      });
    }
    async function gzipFile(inputPath, outputPath) {
      await pipeline(
        fs2.createReadStream(inputPath),
        zlib.createGzip({ level: 9 }),
        fs2.createWriteStream(outputPath)
      );
      return outputPath;
    }
    function readLeadingText(filePath, maxBytes = 4 * 1024 * 1024) {
      const stat = fs2.statSync(filePath);
      const length = Math.min(stat.size, maxBytes);
      const fd = fs2.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(length);
        fs2.readSync(fd, buffer, 0, length, 0);
        return buffer.toString("utf-8");
      } finally {
        fs2.closeSync(fd);
      }
    }
    function extractJsonMetadata(filePath) {
      const head = readLeadingText(filePath);
      const pick = (key) => {
        const match2 = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        return match2 ? match2[1] : "";
      };
      return {
        term: pick("term") || pick("semester"),
        releaseVersion: pick("releaseVersion") || pick("version"),
        generatedAt: pick("generatedAt") || pick("updatedAt")
      };
    }
    function summarizeLocalSnapshot(filePath) {
      try {
        const data = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
        const resourceCounts = buildResourceCountContract(data);
        const counts = flattenLegacyCounts(resourceCounts);
        return {
          resourceCounts,
          counts,
          totalScheduleDocuments: Number(resourceCounts.class.scheduleDocuments || 0) + Number(resourceCounts.teacher.scheduleDocuments || 0) + Number(resourceCounts.classroom.scheduleDocuments || 0) + Number(resourceCounts.course.scheduleDocuments || 0),
          actualNetworkRequestCount: data.meta && data.meta.actualNetworkRequestCount || data.actualNetworkRequestCount || 0,
          usedClassScheduleCache: Boolean(data.meta && (data.meta.usedClassScheduleCache || data.meta.cacheUsage && data.meta.cacheUsage.usedClassScheduleCache)),
          teacherQualityPass: !(resourceCounts.diagnostics || []).some((item) => item.resource === "teacher" && item.publishable === false)
        };
      } catch (error) {
        return {
          resourceCounts: null,
          counts: {},
          totalScheduleDocuments: 0,
          actualNetworkRequestCount: 0,
          usedClassScheduleCache: false,
          teacherQualityPass: null,
          error: error.message
        };
      }
    }
    function formatMb(bytes) {
      return (Number(bytes || 0) / 1024 / 1024).toFixed(2);
    }
    function getAuthHeaders(mode, token) {
      if (mode === "relay") {
        return {
          "x-relay-token": token,
          Authorization: `Bearer ${token}`
        };
      }
      return {
        "x-admin-token": token,
        Authorization: `Bearer ${token}`
      };
    }
    function shouldRetry(error) {
      if (!error) return false;
      if (!error.response) return true;
      const status = error.response.status;
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }
    function retryDelayMs(attempt) {
      return Math.min(15e3, 700 * Math.pow(2, attempt - 1));
    }
    async function postJson(url, body, headers, timeoutMs) {
      const response = await axios2.post(url, body, {
        headers: Object.assign({ "Content-Type": "application/json" }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return response.data;
    }
    async function getJson(url, headers, timeoutMs) {
      const response = await axios2.get(url, {
        headers: Object.assign({ Accept: "application/json" }, headers),
        timeout: timeoutMs,
        proxy: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      return response.data;
    }
    async function uploadChunkWithRetry(url, buffer, headers, timeoutMs, attemptCount) {
      let lastError;
      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        try {
          const response = await axios2.post(url, buffer, {
            headers: Object.assign({
              "Content-Type": "application/octet-stream",
              "Content-Length": buffer.length,
              "x-chunk-sha256": crypto2.createHash("sha256").update(buffer).digest("hex")
            }, headers),
            timeout: timeoutMs,
            proxy: false,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });
          return response.data;
        } catch (error) {
          lastError = error;
          const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
          console.warn(`chunk upload failed (${attempt}/${attemptCount}): ${detail}`);
          if (!shouldRetry(error) || attempt >= attemptCount) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        }
      }
      throw lastError;
    }
    function readChunk(filePath, start, endInclusive) {
      const length = endInclusive - start + 1;
      const buffer = Buffer.allocUnsafe(length);
      const fd = fs2.openSync(filePath, "r");
      try {
        fs2.readSync(fd, buffer, 0, length, start);
        return buffer;
      } finally {
        fs2.closeSync(fd);
      }
    }
    function normalizeServer(value) {
      return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
    }
    function getSidecarMetaPath2(filePath) {
      return String(filePath || "").replace(/\.json$/i, ".meta.json");
    }
    function isForceUpload(params = {}) {
      return params["force-upload"] === true || params.forceUpload === true || params.force === true || String(params["force-upload"] || params.forceUpload || params.force || "").toLowerCase() === "true";
    }
    async function calculateLocalFingerprint(filePath) {
      const sidecarPath = getSidecarMetaPath2(filePath);
      const previousHash = readSidecarHash2(sidecarPath);
      const fingerprint = calculateFingerprintFromFile(filePath);
      if (!previousHash || previousHash !== fingerprint.canonicalHash || !fs2.existsSync(sidecarPath)) {
        const sidecar = buildSidecarMeta2(fingerprint.data, {
          fingerprint,
          previousHash,
          rawSizeBytes: fingerprint.rawSizeBytes
        });
        fs2.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
      }
      return Object.assign(fingerprint, { sidecarPath, previousHash });
    }
    async function checkServerFingerprint(server, headers, canonicalHash, timeoutMs) {
      const url = `${server}/api/admin/staging/fingerprint?canonicalHash=${encodeURIComponent(canonicalHash)}`;
      return getJson(url, headers, Math.min(timeoutMs, 3e4));
    }
    async function prepareUploadFile(filePath, params) {
      const stat = fs2.statSync(filePath);
      const originalSize = stat.size;
      const originalSha256 = await hashFile(filePath);
      const shouldGzip = params.gzip === true || params.gzip === "true" || params["no-gzip"] !== true;
      if (!shouldGzip) {
        return {
          uploadPath: filePath,
          contentEncoding: "identity",
          originalSize,
          originalSha256
        };
      }
      const gzipPath = path2.resolve(
        params["gzip-output"] || params.gzipOutput || `${filePath}.gz`
      );
      console.log(`gzip: ${filePath}`);
      console.log(`gzip output: ${gzipPath}`);
      await gzipFile(filePath, gzipPath);
      return {
        uploadPath: gzipPath,
        contentEncoding: "gzip",
        originalSize,
        originalSha256
      };
    }
    async function uploadStagingFile(options) {
      const params = options.params || {};
      const filePath = path2.resolve(options.filePath);
      if (!fs2.existsSync(filePath)) {
        throw new Error(`file not found: ${filePath}`);
      }
      const mode = options.authMode || "admin";
      const token = options.token || "";
      if (!token) {
        throw new Error(mode === "relay" ? "missing relay token" : "missing ADMIN_API_TOKEN");
      }
      const server = normalizeServer(options.server);
      const endpointBase = mode === "relay" ? `${server}/api/relay/staging/upload` : `${server}/api/admin/staging/upload`;
      const timeoutMs = Number(params.timeout || params.timeoutMs || process.env.SYNC_UPLOAD_TIMEOUT_MS || 18e4);
      const retryCount = Number(params.retries || process.env.SYNC_UPLOAD_RETRIES || 3);
      const chunkSize = toBytesMb(params["chunk-mb"] || params.chunkMb || process.env.SYNC_LOCAL_UPLOAD_CHUNK_MB, 8);
      const metadata = Object.assign({}, extractJsonMetadata(filePath), options.metadata || {});
      const localSummary = summarizeLocalSnapshot(filePath);
      const headers = getAuthHeaders(mode, token);
      let localFingerprint = null;
      if (mode === "admin") {
        localFingerprint = await calculateLocalFingerprint(filePath);
        console.log(`canonicalHash: ${localFingerprint.canonicalHash}`);
        console.log(`sidecar meta: ${localFingerprint.sidecarPath}`);
        if (!isForceUpload(params)) {
          try {
            const serverFingerprint = await checkServerFingerprint(server, headers, localFingerprint.canonicalHash, timeoutMs);
            if (serverFingerprint.sameAsActive) {
              console.log("\u2705 \u5F53\u524D\u91C7\u96C6\u7ED3\u679C\u4E0E\u7EBF\u4E0A active release \u5B8C\u5168\u4E00\u81F4\uFF0C\u65E0\u9700\u4E0A\u4F20\u3002");
              console.log("\u5982\u9700\u5F3A\u5236\u4E0A\u4F20\uFF0C\u8BF7\u8FFD\u52A0 --force-upload\u3002");
              return {
                success: true,
                skipped: true,
                reason: "active-release",
                canonicalHash: localFingerprint.canonicalHash,
                serverFingerprint
              };
            }
            if (serverFingerprint.sameAsStaging) {
              console.log("\u2705 \u670D\u52A1\u5668\u5DF2\u5B58\u5728\u76F8\u540C staging\uFF0C\u65E0\u9700\u91CD\u590D\u4E0A\u4F20\u3002");
              console.log("\u5982\u9700\u5F3A\u5236\u4E0A\u4F20\uFF0C\u8BF7\u8FFD\u52A0 --force-upload\u3002");
              return {
                success: true,
                skipped: true,
                reason: "staging",
                canonicalHash: localFingerprint.canonicalHash,
                serverFingerprint
              };
            }
          } catch (error) {
            const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data || {})}` : error.message;
            console.warn(`fingerprint precheck failed, continue upload: ${detail}`);
          }
        } else {
          console.log("\u26A0\uFE0F --force-upload \u5DF2\u542F\u7528\uFF0C\u5C06\u5FFD\u7565 active/staging \u6307\u7EB9\u76F8\u540C\u5224\u65AD\u3002");
        }
      }
      const prepared = await prepareUploadFile(filePath, params);
      const uploadStat = fs2.statSync(prepared.uploadPath);
      const uploadSha256 = await hashFile(prepared.uploadPath);
      const totalChunks = Math.ceil(uploadStat.size / chunkSize);
      console.log(`source file: ${filePath}`);
      console.log(`source size: ${formatMb(prepared.originalSize)} MB`);
      console.log(`upload file: ${prepared.uploadPath}`);
      console.log(`upload size: ${formatMb(uploadStat.size)} MB`);
      console.log(`chunk size: ${formatMb(chunkSize)} MB, chunks: ${totalChunks}`);
      console.log(`server: ${server}`);
      const initBody = {
        fileName: path2.basename(filePath),
        term: metadata.term || options.term || "",
        releaseVersion: metadata.releaseVersion || "",
        note: options.note || params.note || "",
        source: options.source || (mode === "relay" ? "relay-agent" : "local-upload-cli"),
        contentEncoding: prepared.contentEncoding,
        contentType: "application/json",
        chunkSize,
        totalChunks,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256,
        canonicalHash: localFingerprint && localFingerprint.canonicalHash || ""
      };
      const init = await postJson(`${endpointBase}/init`, initBody, headers, timeoutMs);
      const uploadId = init.uploadId || init.upload?.uploadId;
      if (!uploadId) {
        throw new Error(`init response missing uploadId: ${JSON.stringify(init)}`);
      }
      const startedAt = Date.now();
      let uploaded = 0;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(uploadStat.size - 1, start + chunkSize - 1);
        const buffer = readChunk(prepared.uploadPath, start, end);
        const chunkUrl = `${endpointBase}/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`;
        await uploadChunkWithRetry(chunkUrl, buffer, headers, timeoutMs, retryCount);
        uploaded += buffer.length;
        const elapsed = Math.max(1, (Date.now() - startedAt) / 1e3);
        const percent = (uploaded / uploadStat.size * 100).toFixed(2);
        const speed = formatMb(uploaded / elapsed);
        console.log(`[${chunkIndex + 1}/${totalChunks}] ${percent}% ${formatMb(uploaded)}/${formatMb(uploadStat.size)} MB, ${speed} MB/s`);
      }
      const finalize = await postJson(`${endpointBase}/finalize`, {
        uploadId,
        uploadSize: uploadStat.size,
        uploadSha256,
        originalSize: prepared.originalSize,
        originalSha256: prepared.originalSha256,
        canonicalHash: localFingerprint && localFingerprint.canonicalHash || "",
        totalChunks,
        note: options.note || params.note || "",
        uploaderNote: options.note || params.note || "",
        environment: options.environment || metadata.environment || ""
      }, headers, timeoutMs);
      const payload = finalize.data || finalize.upload || finalize;
      const serverResourceCounts = payload.resourceCounts || payload.summary && payload.summary.resourceCounts || finalize.resourceCounts || null;
      const serverCounts = payload.counts || payload.summary && payload.summary.counts || finalize.counts || localSummary.counts || {};
      const displayResourceCounts = serverResourceCounts || localSummary.resourceCounts;
      console.log("upload finalized:");
      console.log(JSON.stringify({
        uploadId,
        stagingId: finalize.stagingId || uploadId,
        relayUploadId: payload.relayUploadId || finalize.relayUploadId,
        term: payload.term || finalize.term || metadata.term || "",
        releaseVersion: payload.releaseVersion || finalize.releaseVersion || metadata.releaseVersion || "",
        totalScheduleDocuments: payload.totalScheduleDocuments || payload.summary && payload.summary.totalScheduleDocuments || localSummary.totalScheduleDocuments,
        counts: serverCounts,
        resourceCounts: displayResourceCounts,
        status: payload.status || finalize.status || "pending-review"
      }, null, 2));
      if (displayResourceCounts) {
        const teacherDirectory = displayResourceCounts.teacher.directoryEntities == null ? "\u672A\u786E\u8BA4" : `${displayResourceCounts.teacher.directoryEntities}\u4EBA`;
        console.log("\u4E0A\u4F20\u6458\u8981\uFF1A");
        console.log(`- \u73ED\u7EA7\u8BFE\u8868\uFF1A${displayResourceCounts.class.scheduleDocuments || 0}\u4EFD`);
        console.log(`- \u884C\u653F\u73ED\uFF1A${displayResourceCounts.class.administrativeClasses || 0}\u4E2A`);
        console.log(`- \u4E13\u4E1A\u805A\u5408\uFF1A${displayResourceCounts.class.aggregateSchedules || 0}\u4EFD`);
        console.log(`- \u6559\u5E08\u76EE\u5F55\uFF1A${teacherDirectory}`);
        console.log(`- \u6559\u5E08\u8BFE\u8868\uFF1A${displayResourceCounts.teacher.scheduleDocuments || 0}\u4EFD`);
        console.log(`- \u6559\u5E08\u8BFE\u7A0B\u4E8B\u4EF6\uFF1A${displayResourceCounts.teacher.courseEvents || 0}\u6761`);
        console.log(`- \u6559\u5BA4\u76EE\u5F55\uFF1A${displayResourceCounts.classroom.directoryEntities == null ? "\u672A\u7EDF\u8BA1" : `${displayResourceCounts.classroom.directoryEntities}\u95F4`}`);
        console.log(`- \u6559\u5BA4\u8BFE\u8868\uFF1A${displayResourceCounts.classroom.scheduleDocuments || 0}\u4EFD`);
        console.log(`- \u8BFE\u7A0B\u76EE\u5F55\uFF1A${displayResourceCounts.course.directoryEntities == null ? "\u672A\u7EDF\u8BA1" : `${displayResourceCounts.course.directoryEntities}\u95E8`}`);
        console.log(`- \u8BFE\u7A0B\u8BFE\u8868\uFF1A${displayResourceCounts.course.scheduleDocuments || 0}\u4EFD`);
        console.log(`- \u5B9E\u9645100\u7F51\u8BF7\u6C42\u6570\uFF1A${localSummary.actualNetworkRequestCount || "\u672A\u7EDF\u8BA1"}`);
        console.log(`- \u662F\u5426\u8BFB\u53D6\u65E7\u52A8\u6001\u7F13\u5B58\uFF1A${localSummary.usedClassScheduleCache ? "\u662F" : "\u5426"}`);
        console.log(`- \u6559\u5E08\u6570\u636E\u8D28\u91CF\uFF1A${localSummary.teacherQualityPass === false ? "\u4E0D\u901A\u8FC7" : "\u901A\u8FC7"}`);
      }
      return finalize;
    }
    async function runFromCli(argv = process.argv.slice(2)) {
      const params = parseArgs(argv);
      const fileArg = params.file || params.input;
      const resolved = resolveInputFilePath2(fileArg || "");
      if (!resolved.resolved) {
        throw new Error([
          "Staging JSON file not found.",
          `received: ${fileArg || ""}`,
          `cwd: ${process.cwd()}`,
          `projectRoot: ${resolveProjectRoot(process.cwd())}`,
          "tried:",
          ...resolved.tried.map((item) => `  - ${item}`)
        ].join(os.EOL));
      }
      const mode = params.relay ? "relay" : "admin";
      const token = params.token || (mode === "relay" ? process.env.RELAY_TOKEN : process.env.ADMIN_API_TOKEN);
      return uploadStagingFile({
        filePath: resolved.resolved,
        server: params.server || process.env.FOSU_API_BASE || "https://class.katelya.eu.org",
        token,
        authMode: mode,
        params,
        term: params.term,
        note: params.note
      });
    }
    if (require.main === module2) {
      runFromCli().catch((error) => {
        const response = error.response;
        if (response) {
          console.error(`upload failed: HTTP ${response.status}`);
          console.error(JSON.stringify(response.data || {}, null, 2));
        } else {
          console.error(`upload failed: ${error.stack || error.message}`);
        }
        process.exit(1);
      });
    }
    module2.exports = {
      parseArgs,
      resolveInputFilePath: resolveInputFilePath2,
      resolveProjectRoot,
      runFromCli,
      uploadStagingFile
    };
  }
});

// ../fosu-sync-client/sync.js
var { chromium } = require("playwright");
var fs = require("fs");
var path = require("path");
var axios = require("axios");
var cheerio = require("cheerio");
var crypto = require("crypto");
var diagnose = require_diagnose();
var envPath = path.resolve(__dirname, ".env");
require("dotenv").config({ path: envPath });
var {
  ALL_SCOPES,
  applyPlanToParams,
  buildSyncPlan,
  getRecommendedOperations,
  parseCliArgs,
  printablePlan
} = require_syncPlan2();
var syncCacheStore = require_syncCacheStore();
console.log(`[env] .env path: ${envPath}`);
console.log(`[env] FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
console.log(`[env] PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_GRADE_RANGE: ${process.env.SYNC_GRADE_RANGE || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_GRADES (\u4E13\u4E1A\u540C\u6B65\u4F7F\u7528): ${process.env.SYNC_GRADES || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_CLASS_GRADES (\u73ED\u7EA7\u8BFE\u8868\u540C\u6B65\u4F7F\u7528): ${process.env.SYNC_CLASS_GRADES || "\u672A\u914D\u7F6E"}`);
console.log(`[env] SYNC_UPLOAD_CHUNK_SIZE: ${process.env.SYNC_UPLOAD_CHUNK_SIZE || "10"}`);
console.log(`[env] SYNC_SKIP_NO_SCHEDULE_CACHE: ${process.env.SYNC_SKIP_NO_SCHEDULE_CACHE || "true"}`);
console.log(`[env] SYNC_RECHECK_NO_SCHEDULE: ${process.env.SYNC_RECHECK_NO_SCHEDULE || "false"}`);
console.log(`[env] ADMIN_API_TOKEN: ${process.env.ADMIN_API_TOKEN ? "present" : "missing"}`);
var parser = require_parser();
var normalizer = require_scheduleNormalizer();
var courseIdentity = require_courseNormalizer();
var releaseService = require_releaseService();
var termRegistryService = require_termRegistryService();
var stagingUploader = require_upload();
var {
  isInvalidTeacherName
} = require_resourceCountContract();
var {
  buildSidecarMeta,
  calculateFingerprint,
  readSidecarHash
} = require_stagingFingerprint();
var proxyEnvNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
var detectedProxyEnv = proxyEnvNames.map((name) => [name, process.env[name]]).filter(([, value]) => Boolean(value));
var INITIAL_DETECTED_PROXIES = [...detectedProxyEnv];
var disableProxy = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
if (detectedProxyEnv.length > 0) {
  console.warn(`\u26A0\uFE0F \u68C0\u6D4B\u5230\u4EE3\u7406\u73AF\u5883\u53D8\u91CF: ${detectedProxyEnv.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  if (disableProxy) {
    console.warn("\u26A0\uFE0F \u540C\u6B65\u4E0A\u4F20\u9ED8\u8BA4\u7981\u7528\u73AF\u5883\u4EE3\u7406\uFF0C\u907F\u514D 127.0.0.1:10808 \u7B49\u672C\u5730\u4EE3\u7406\u6C61\u67D3 VPS \u4E0A\u4F20\u3002");
  }
}
if (disableProxy) {
  proxyEnvNames.forEach((name) => {
    delete process.env[name];
  });
  process.env.NO_PROXY = "*";
  process.env.no_proxy = "*";
  axios.defaults.proxy = false;
}
var FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
var FOSU_API_BASE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";
var cachedProjectRoot = null;
function resolveProjectPath() {
  if (cachedProjectRoot) return cachedProjectRoot;
  const startDir = process.cwd();
  let currentDir = startDir;
  while (true) {
    const serverPath = path.join(currentDir, "server");
    const miniprogramPath = path.join(currentDir, "miniprogram");
    if (fs.existsSync(serverPath) && fs.statSync(serverPath).isDirectory() && fs.existsSync(miniprogramPath) && fs.statSync(miniprogramPath).isDirectory()) {
      cachedProjectRoot = currentDir;
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  const fallbackPath = path.resolve(__dirname, "../..");
  cachedProjectRoot = fallbackPath;
  return fallbackPath;
}
var PROJECT_ROOT = resolveProjectPath();
function resolveInputFilePath(fileArg) {
  if (!fileArg) {
    return {
      resolved: null,
      tried: []
    };
  }
  if (path.isAbsolute(fileArg)) {
    return {
      resolved: fileArg,
      tried: [fileArg]
    };
  }
  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const tried = [];
  const normalizedFile = path.normalize(fileArg).replace(/\\/g, "/");
  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    const pRootJoined = path.resolve(projectRoot, fileArg);
    tried.push(pRootJoined);
    if (fs.existsSync(pRootJoined)) {
      return { resolved: pRootJoined, tried };
    }
    const relativePart = normalizedFile.substring("tools/fosu-sync-client/".length);
    const pCwdStripped = path.resolve(cwd, relativePart);
    tried.push(pCwdStripped);
    if (fs.existsSync(pCwdStripped)) {
      return { resolved: pCwdStripped, tried };
    }
  } else {
    const pCwd = path.resolve(cwd, fileArg);
    tried.push(pCwd);
    if (fs.existsSync(pCwd)) {
      return { resolved: pCwd, tried };
    }
    if (projectRoot) {
      const pRoot = path.resolve(projectRoot, fileArg);
      tried.push(pRoot);
      if (fs.existsSync(pRoot)) {
        return { resolved: pRoot, tried };
      }
      const pClient = path.resolve(projectRoot, "tools/fosu-sync-client", fileArg);
      tried.push(pClient);
      if (fs.existsSync(pClient)) {
        return { resolved: pClient, tried };
      }
    }
  }
  return {
    resolved: null,
    tried
  };
}
function resolveOutputFilePath(outputArg) {
  if (!outputArg) return null;
  if (path.isAbsolute(outputArg)) return outputArg;
  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const normalizedFile = path.normalize(outputArg).replace(/\\/g, "/");
  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    return path.resolve(projectRoot, outputArg);
  }
  if (projectRoot) {
    return path.resolve(projectRoot, outputArg);
  }
  return path.resolve(cwd, outputArg);
}
function getSidecarMetaPath(outputPath) {
  return String(outputPath || "").replace(/\.json$/i, ".meta.json");
}
function printLocalCampusPathSummary(params, outputPath) {
  console.log("\u{1F4C1} \u672C\u673A\u91C7\u96C6\u8DEF\u5F84:");
  console.log(`   \u9879\u76EE\u6839\u76EE\u5F55: ${resolveProjectPath()}`);
  console.log(`   sync-client \u76EE\u5F55: ${__dirname}`);
  console.log(`   output \u7EDD\u5BF9\u8DEF\u5F84: ${outputPath}`);
  console.log(`   \u662F\u5426\u4E0A\u4F20 VPS: ${params.upload || params["upload-vps"] ? "\u662F" : "\u5426\uFF0C\u672C\u547D\u4EE4\u4EC5\u751F\u6210\u672C\u5730 staging"}`);
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
var FOSU_SYNC_AUTH_MODE = process.env.FOSU_SYNC_AUTH_MODE || "playwright-manual";
var SESSION_PATH = path.join(__dirname, ".session", "session.json");
function getEnvFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === void 0 || value === "") {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}
function getActiveSyncPlan() {
  return global.SYNC_PLAN || null;
}
function printSyncPlan(plan) {
  if (!plan) return;
  console.log("\n================ [Resolved Sync Plan] ================");
  console.log(JSON.stringify(printablePlan(plan), null, 2));
  if (plan.deprecated) {
    console.warn(`[deprecated] ${plan.action} is mapped to ${plan.deprecatedTarget}. Use the new command name in runbooks.`);
  }
  if (plan.schedulePolicy === "network-only" && plan.dynamicScopes.length) {
    console.log("[policy] Dynamic schedules are network-only. Progress, negative cache, and old schedule merge are disabled.");
  }
  console.log("======================================================\n");
}
function isPlanNetworkOnly() {
  const plan = getActiveSyncPlan();
  return Boolean(plan && plan.schedulePolicy === "network-only" && plan.dynamicScopes.length > 0);
}
function findTermByRunId(runId) {
  const id = String(runId || "").trim();
  if (!id) return "";
  const root = path.join(__dirname, ".cache");
  if (!fs.existsSync(root)) return "";
  const terms = fs.readdirSync(root).filter((name) => fs.statSync(path.join(root, name)).isDirectory());
  for (const term of terms) {
    const progressDir = path.join(root, term, "progress");
    if (!fs.existsSync(progressDir)) continue;
    const files = fs.readdirSync(progressDir);
    if (files.some((file) => file.includes(id))) return term;
  }
  return "";
}
function buildScopeSourceReport(scope, overrides = {}) {
  const plan = getActiveSyncPlan();
  const source = plan && plan.sourceRequirements && plan.sourceRequirements[scope] || {};
  return Object.assign({
    scope,
    sourceMode: source.mode || "derived-current-run",
    endpointFamily: source.endpointFamily || "",
    requested: 0,
    succeeded: 0,
    failed: 0,
    derived: 0,
    cacheHits: 0,
    startedAt: "",
    finishedAt: "",
    hash: ""
  }, overrides);
}
function recordScopeSource(scope, report) {
  global.SCOPE_SOURCE_REPORTS = Object.assign({}, global.SCOPE_SOURCE_REPORTS || {}, {
    [scope]: buildScopeSourceReport(scope, report)
  });
}
async function postAdminJson(pathname, body, label) {
  const url = `${FOSU_API_BASE}${pathname}`;
  const response = await axios.post(url, body || {}, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false,
    timeout: parseInt(process.env.SYNC_ADMIN_POST_TIMEOUT_MS || "30000", 10)
  });
  const data = response.data || {};
  if (data.job && data.job.id) {
    return waitAdminJob(data.job.id, label || pathname);
  }
  return data;
}
function getTermStartDate(term) {
  if (process.env.PREFERRED_TERM_START_DATE) return process.env.PREFERRED_TERM_START_DATE;
  return "";
}
function validateTermId(term) {
  const value = String(term || "").trim();
  const match2 = value.match(/^(\d{4})-(\d{4})-([12])$/);
  return Boolean(match2 && Number(match2[2]) === Number(match2[1]) + 1);
}
function generateSemesterText(term) {
  const parts = String(term || "").split("-");
  if (parts.length !== 3) return term || "";
  return `${parts[0]}-${parts[1]}\u5B66\u5E74${parts[2] === "1" ? "\u7B2C\u4E00" : "\u7B2C\u4E8C"}\u5B66\u671F`;
}
function normalizeTermConfigRecord(record, source) {
  const item = record && typeof record === "object" ? record : {};
  const term = String(item.term || item.semester || "").trim();
  if (!validateTermId(term)) return null;
  const rawTotalWeeks = item.totalWeeks || item.weeks || item.weekCount;
  const totalWeeks = rawTotalWeeks == null || rawTotalWeeks === "" ? null : Number(rawTotalWeeks);
  return {
    term,
    semesterText: item.semesterText || item.termText || generateSemesterText(term),
    termStartDate: String(item.termStartDate || item.startDate || item.termStart || "").trim(),
    totalWeeks: Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30 ? totalWeeks : null,
    weekStart: item.weekStart || "monday",
    source: source || item.source || "unknown",
    releaseVersion: item.releaseVersion || item.version || ""
  };
}
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
  }
}
function getRelayTermConfigFromEnv() {
  const raw2 = process.env.FOSU_RELAY_TERM_CONFIG || "";
  if (!raw2) return null;
  try {
    return normalizeTermConfigRecord(JSON.parse(raw2), "relay-term-config");
  } catch (error) {
    return null;
  }
}
function getLocalRegistryTermConfig(term) {
  const projectRoot = resolveProjectPath();
  const candidates = [
    path.join(projectRoot, "server", "storage", "term-registry.json"),
    process.env.FOSU_STORAGE_DIR ? path.join(process.env.FOSU_STORAGE_DIR, "term-registry.json") : ""
  ].filter(Boolean);
  for (const filePath of candidates) {
    const registry = readJsonSafe(filePath);
    const terms = registry && Array.isArray(registry.terms) ? registry.terms : [];
    const matched = terms.find((item) => item && item.term === term);
    const config = normalizeTermConfigRecord(matched, "local-term-registry");
    if (config && config.termStartDate) return config;
  }
  return null;
}
function getBundledTermRegistryConfig(term) {
  try {
    const config = termRegistryService.getTerm(term);
    return normalizeTermConfigRecord(config, "term-registry");
  } catch (error) {
    return null;
  }
}
async function getRemoteRegistryTermConfig(term) {
  try {
    const response = await axios.get(`${FOSU_API_BASE}/api/fosu/terms`, {
      timeout: 8e3,
      validateStatus: (status) => status >= 200 && status < 500
    });
    const data = response.data || {};
    const terms = data.terms || data.availableTerms || data.data && data.data.availableTerms || [];
    const matched = Array.isArray(terms) ? terms.find((item) => item && item.term === term) : null;
    return normalizeTermConfigRecord(matched, "remote-term-registry");
  } catch (error) {
    return null;
  }
}
async function resolveTermConfig(activeSemester, cliParams = {}) {
  const explicit = cliParams["term-start-date"] || cliParams.termStartDate || cliParams.start || cliParams.startDate || "";
  const explicitTotalWeeksRaw = cliParams["total-weeks"] || cliParams.totalWeeks || process.env.TOTAL_WEEKS || "";
  const explicitTotalWeeks = explicitTotalWeeksRaw === "" ? null : Number(explicitTotalWeeksRaw);
  const explicitWeekStart = cliParams.weekStart || cliParams["week-start"] || "";
  const overrideTermConfig = Boolean(cliParams["override-term-config"] || cliParams.overrideTermConfig);
  const cliConfig = normalizeTermConfigRecord({
    term: activeSemester,
    semesterText: cliParams.semesterText,
    termStartDate: explicit,
    totalWeeks: explicitTotalWeeks,
    weekStart: explicitWeekStart || "monday"
  }, "cli");
  const registryConfigs = [];
  const bundledRegistryConfig = getBundledTermRegistryConfig(activeSemester);
  if (bundledRegistryConfig && bundledRegistryConfig.termStartDate) registryConfigs.push(bundledRegistryConfig);
  const relayTermConfig = normalizeTermConfigRecord(global.RELAY_TERM_CONFIG, "relay-term-config") || getRelayTermConfigFromEnv();
  if (relayTermConfig && relayTermConfig.term === activeSemester && relayTermConfig.termStartDate) {
    registryConfigs.push(relayTermConfig);
  }
  const localRegistryConfig = getLocalRegistryTermConfig(activeSemester);
  if (localRegistryConfig && localRegistryConfig.termStartDate) {
    registryConfigs.push(localRegistryConfig);
  }
  const remoteRegistryConfig = await getRemoteRegistryTermConfig(activeSemester);
  if (remoteRegistryConfig && remoteRegistryConfig.termStartDate) {
    registryConfigs.push(remoteRegistryConfig);
  }
  const registryConfig = registryConfigs.find((item) => item && item.term === activeSemester && item.termStartDate);
  if (registryConfig) {
    if (cliConfig && explicit && overrideTermConfig) {
      if (!cliConfig.totalWeeks && registryConfig.totalWeeks) cliConfig.totalWeeks = registryConfig.totalWeeks;
      cliConfig.overrideTermConfig = true;
      cliConfig.overriddenRegistryConfig = registryConfig;
      cliConfig.source = "cli-override-term-config";
      return cliConfig;
    }
    if (cliConfig && explicit && (cliConfig.termStartDate !== registryConfig.termStartDate || cliConfig.totalWeeks && cliConfig.totalWeeks !== registryConfig.totalWeeks || explicitWeekStart && cliConfig.weekStart !== registryConfig.weekStart)) {
      console.warn(`[term-config] \u8B66\u544A\uFF1ACLI \u5B66\u671F\u914D\u7F6E\u4E0E Term Registry \u4E0D\u4E00\u81F4\uFF0C\u9ED8\u8BA4\u91C7\u7528 Registry\u3002\u82E5\u786E\u8BA4\u8986\u76D6\uFF0C\u8BF7\u663E\u5F0F\u4F20\u5165 --override-term-config\u3002CLI start=${cliConfig.termStartDate || "-"}, weeks=${cliConfig.totalWeeks || "-"}\uFF1BRegistry start=${registryConfig.termStartDate}, weeks=${registryConfig.totalWeeks || "-"}`);
    }
    return registryConfig;
  }
  if (cliConfig && explicit) {
    return cliConfig;
  }
  const fallback = getTermStartDate(activeSemester);
  if (fallback) {
    return normalizeTermConfigRecord({
      term: activeSemester,
      termStartDate: fallback,
      totalWeeks: explicitTotalWeeks,
      weekStart: explicitWeekStart || "monday"
    }, "env");
  }
  return normalizeTermConfigRecord({
    term: activeSemester,
    termStartDate: "",
    totalWeeks: explicitTotalWeeks,
    weekStart: explicitWeekStart || "monday"
  }, "");
}
async function assertTermConfigBeforeCrawl(activeSemester, cliParams = {}) {
  if (!validateTermId(activeSemester)) {
    throw new Error(`Invalid term id: ${activeSemester}. Expected YYYY-YYYY-1 or YYYY-YYYY-2.`);
  }
  const config = await resolveTermConfig(activeSemester, cliParams);
  if (!config.termStartDate) {
    throw new Error([
      `Missing termStartDate for ${activeSemester}.`,
      "Pass it explicitly before crawling, for example:",
      `npm run sync:local-campus -- --term=${activeSemester} --term-start-date=2026-09-07 --total-weeks=20 --fresh`
    ].join("\n"));
  }
  if (!Number.isInteger(config.totalWeeks) || config.totalWeeks < 1 || config.totalWeeks > 30) {
    throw new Error(`Missing totalWeeks for ${activeSemester}. Use Term Registry or pass --total-weeks=N for new terms; silent default 20 is disabled.`);
  }
  return Object.assign({}, config, {
    semesterText: cliParams.semesterText || config.semesterText || generateSemesterText(activeSemester)
  });
}
function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`\u26A0\uFE0F \u8BFB\u53D6 JSON \u6587\u4EF6\u5931\u8D25\uFF0C\u5C06\u6309\u7A7A\u6570\u7EC4\u5904\u7406: ${filePath} (${error.message})`);
    return [];
  }
}
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function getMajorIdentityKey(major, semester2) {
  return [
    semester2,
    major.collegeCode || "",
    major.grade || "",
    major.code || major.majorCode || ""
  ].join("::");
}
function getLegacyMajorProgressKey(major) {
  return `${major.grade}_${major.code || major.majorCode || ""}`;
}
function hasCompletedMajor(progress, major, semester2) {
  const completed = progress && Array.isArray(progress.completed) ? progress.completed : [];
  return completed.includes(getMajorIdentityKey(major, semester2)) || completed.includes(getLegacyMajorProgressKey(major));
}
function markCompletedMajor(progress, major, semester2) {
  const key = getMajorIdentityKey(major, semester2);
  if (!Array.isArray(progress.completed)) {
    progress.completed = [];
  }
  if (!progress.completed.includes(key)) {
    progress.completed.push(key);
  }
}
function upsertNoScheduleMajor(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}
function removeNoScheduleMajor(records, major, semester2) {
  const key = getMajorIdentityKey(major, semester2);
  return records.filter((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) !== key);
}
function upsertClassNameCandidateRecord(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}
async function waitBetweenClassSyncRequests(isFiltered) {
  const configuredDelay = Number(process.env.SYNC_CLASS_REQUEST_DELAY_MS || 0);
  if (Number.isFinite(configuredDelay) && configuredDelay >= 0 && process.env.SYNC_CLASS_REQUEST_DELAY_MS !== void 0) {
    console.log(`      \u23F3 \u6309 CLI/env \u914D\u7F6E\u7B49\u5F85 ${configuredDelay}ms...`);
    await sleep(configuredDelay);
    return;
  }
  const delayMin = isFiltered ? 800 : 1500;
  const delayMax = isFiltered ? 1500 : 3e3;
  const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
  console.log(`      \u23F3 \u968F\u673A\u7B49\u5F85 ${delay}ms...`);
  await sleep(delay);
}
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const httpUrl = `${FOSU_BASE_URL.replace(/^https:/i, "http:")}${cleanPath}`;
  const httpsUrl = `${FOSU_BASE_URL}${cleanPath}`;
  try {
    await page.goto(httpUrl, options);
  } catch (err) {
    try {
      await page.goto(httpsUrl, options);
    } catch (httpsErr) {
      throw new Error(`\u5BFC\u822A\u5230 ${cleanPath} \u5F7B\u5E95\u5931\u8D25 (HTTP: ${err.message}, HTTPS: ${httpsErr.message})`);
    }
  }
}
function parseCookieString(cookieStr, domain) {
  if (!cookieStr) return [];
  const domainHost = new URL(domain).hostname;
  return cookieStr.split(";").map((pair) => {
    const parts = pair.split("=");
    if (parts.length >= 2) {
      return {
        name: parts[0].trim(),
        value: parts.slice(1).join("=").trim(),
        domain: domainHost,
        path: "/"
      };
    }
    return null;
  }).filter(Boolean);
}
function getRetryDelay(attempt) {
  const base = Math.min(3e4, 1e3 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}
async function uploadToVps(endpoint, data, options = {}) {
  if (getEnvFlag("SYNC_LOCAL_STAGING_ONLY", false)) {
    console.log(`\u2139\uFE0F \u672C\u673A Staging \u6A21\u5F0F\uFF1A\u8DF3\u8FC7 VPS \u5199\u5165 ${endpoint}`);
    return { success: true, skipped: true, endpoint };
  }
  if (!ADMIN_API_TOKEN) {
    console.error("\u274C \u672C\u5730\u672A\u914D\u7F6E ADMIN_API_TOKEN\uFF01\u65E0\u6CD5\u5411 VPS \u5199\u5165\u6570\u636E\u3002");
    throw new Error("Missing ADMIN_API_TOKEN");
  }
  const url = `${FOSU_API_BASE}${endpoint}`;
  console.log(`\u{1F4E4} \u6B63\u5728\u4E0A\u4F20\u6570\u636E\u5230 VPS: ${url} ...`);
  const maxRetries = options.maxRetries === void 0 ? 4 : options.maxRetries;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`\u2705 VPS \u54CD\u5E94: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      const retryable = shouldRetryError(error);
      console.error(`\u274C \u4E0A\u4F20\u5931\u8D25 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
        console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
      }
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   \u23F3 \u7F51\u7EDC\u6296\u52A8\u53EF\u91CD\u8BD5\uFF0C${delay}ms \u540E\u7EE7\u7EED...`);
      await sleep(delay);
    }
  }
}
async function fetchVpsSyncStatus() {
  const url = `${FOSU_API_BASE}/api/admin/sync/status`;
  console.log(`\u{1F50E} \u6B63\u5728\u8BFB\u53D6 VPS \u540C\u6B65\u72B6\u6001: ${url} ...`);
  const response = await axios.get(url, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false,
    // 显式禁用代理
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  return response.data;
}
function generateSnapshotVersion() {
  const now = /* @__PURE__ */ new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}
function normalizeScheduleEntryCourses(entry, fallbackContext = {}) {
  const context = Object.assign({}, fallbackContext, {
    semester: entry.semester || fallbackContext.semester,
    className: entry.className || fallbackContext.className,
    sourceType: entry.sourceType || fallbackContext.sourceType || "class",
    audienceType: entry.audienceType || fallbackContext.audienceType || "student"
  });
  const courses = normalizer.normalizeCourseList(entry.courses || [], context);
  return Object.assign({}, entry, { courses });
}
function parsePositiveLimit(value) {
  const number = parseInt(value || "", 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function isUsableResourceName(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !["\u5F85\u8865\u5145", "\u6682\u65E0", "\u65E0", "\u672A\u77E5", "\u591A\u4E2A\u5730\u70B9", "\u591A\u4E2A\u6559\u5E08", "\u89C1\u901A\u77E5", "\u591A\u4E2A\u6559\u5E08/\u89C1\u901A\u77E5"].includes(text);
}
function limitMapEntries(map, limit) {
  const entries = Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }));
  return limit > 0 ? entries.slice(0, limit) : entries;
}
function pushGroupedCourse(map, key, course) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(course);
}
function buildDirectTeacherQualityReport(collected, targets, resources) {
  const teacherSchedules = resources && resources.teacherSchedules || [];
  const invalidNames = teacherSchedules.map((item) => teacherNameOf(item)).filter((name) => isInvalidTeacherName(name));
  const invalidSamples = Array.from(new Set(invalidNames)).slice(0, 12);
  const usedCollegeDiscovery = collected && collected.source === "college-select";
  const invalid = usedCollegeDiscovery && invalidNames.length > 0;
  return {
    sourceMode: "network-direct",
    endpointFamily: "teacher-schedule",
    requested: targets.length,
    succeeded: teacherSchedules.length,
    failed: 0,
    targetDiscoveryMode: collected && collected.source || "unknown",
    discoveredTeacherTargets: collected && collected.source === "teacher-select" ? targets.length : null,
    requestGroupCount: targets.length,
    scheduleDocumentCount: teacherSchedules.length,
    invalidTeacherNameCount: invalidNames.length,
    invalidTeacherNameSamples: invalidSamples,
    coverageStatus: invalid ? "invalid" : "unknown",
    publishable: !invalid,
    pageHasTeacherSelect: Boolean(collected && collected.dom && collected.dom.teachers && collected.dom.teachers.length),
    pageTeacherOptionCount: collected && collected.dom && collected.dom.teachers ? collected.dom.teachers.length : 0,
    pageCollegeOptionCount: collected && collected.dom && collected.dom.colleges ? collected.dom.colleges.length : 0,
    note: invalid ? "100\u7F51\u6559\u5E08\u9875\u672A\u53D1\u73B0\u6559\u5E08\u4E0B\u62C9\u76EE\u6807\uFF0C\u5F53\u524D\u6309\u5B66\u9662\u8BF7\u6C42\u5F97\u5230\u7684\u6559\u5E08\u540D\u79F0\u7591\u4F3C\u88AB\u73ED\u7EA7\u540D\u6216\u8BFE\u7A0B\u540D\u6C61\u67D3\u3002" : ""
  };
}
function buildSnapshotResources(classSchedules, options = {}) {
  const includeTeachers = options.includeTeachers !== void 0 ? options.includeTeachers : getEnvFlag("SYNC_RESOURCES_TEACHERS", false);
  const includeClassrooms = options.includeClassrooms !== void 0 ? options.includeClassrooms : getEnvFlag("SYNC_RESOURCES_CLASSROOMS", false);
  const includeCourses = options.includeCourses !== void 0 ? options.includeCourses : getEnvFlag("SYNC_RESOURCES_COURSES", false);
  const limit = parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
  const teacherMap = /* @__PURE__ */ new Map();
  const classroomMap = /* @__PURE__ */ new Map();
  const courseMap = /* @__PURE__ */ new Map();
  (classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => {
      const baseCourse = Object.assign({}, course, {
        semester: course.semester || schedule.semester,
        classId: course.classId || schedule.classId || "",
        className: course.className || schedule.className || "",
        collegeCode: course.collegeCode || schedule.collegeCode || "",
        collegeName: course.collegeName || schedule.collegeName || "",
        grade: course.grade || schedule.grade || "",
        majorCode: course.majorCode || schedule.majorCode || "",
        majorName: course.majorName || schedule.majorName || ""
      });
      const courseName = baseCourse.canonicalCourseName || baseCourse.displayCourseName || baseCourse.courseName;
      const teacherName = baseCourse.canonicalTeacherName || baseCourse.displayTeacherName || baseCourse.teacherName;
      const classroom = baseCourse.canonicalClassroom || baseCourse.displayClassroom || baseCourse.classroom;
      if (includeTeachers && isUsableResourceName(teacherName) && !baseCourse.isTeacherFieldActuallyCourseName && !courseIdentity.isCourseLike(teacherName)) {
        pushGroupedCourse(teacherMap, teacherName, baseCourse);
      }
      if (includeClassrooms && isUsableResourceName(classroom)) {
        pushGroupedCourse(classroomMap, classroom, baseCourse);
      }
      if (includeCourses && isUsableResourceName(courseName) && !courseIdentity.isVenueLike(courseName)) {
        pushGroupedCourse(courseMap, courseName, baseCourse);
      }
    });
  });
  const teacherEntries = limitMapEntries(teacherMap, limit);
  const classroomEntries = limitMapEntries(classroomMap, limit);
  const courseEntries = limitMapEntries(courseMap, limit);
  return {
    teachers: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courseCount: courses.length })),
    classrooms: classroomEntries.map(([roomName, courses]) => ({ roomName, courseCount: courses.length })),
    courses: courseEntries.map(([courseName, courses]) => ({ courseName, courseCount: courses.length })),
    teacherSchedules: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courses })),
    classroomSchedules: classroomEntries.map(([roomName, courses]) => ({ roomName, courses })),
    courseSchedules: courseEntries.map(([courseName, courses]) => ({ courseName, courses }))
  };
}
function emptySnapshotResources() {
  return {
    teachers: [],
    classrooms: [],
    courses: [],
    teacherSchedules: [],
    classroomSchedules: [],
    courseSchedules: []
  };
}
function normalizeSnapshotResources(resources) {
  const source = Object.assign(emptySnapshotResources(), resources || {});
  return {
    teachers: source.teachers || [],
    classrooms: source.classrooms || [],
    courses: source.courses || [],
    teacherSchedules: (source.teacherSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "teacher",
      audienceType: "teacher"
    })),
    classroomSchedules: (source.classroomSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "classroom",
      audienceType: "classroom"
    })),
    courseSchedules: (source.courseSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "course",
      audienceType: "course"
    }))
  };
}
function collectSnapshotCourses(snapshot) {
  const result = [];
  (snapshot.classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => result.push({ scheduleType: "class", scheduleName: schedule.className, course }));
  });
  const resources = snapshot.resources || {};
  [
    ["teacher", resources.teacherSchedules || [], "teacherName"],
    ["classroom", resources.classroomSchedules || [], "roomName"],
    ["course", resources.courseSchedules || [], "courseName"]
  ].forEach(([scheduleType, schedules, nameKey]) => {
    schedules.forEach((schedule) => {
      (schedule.courses || []).forEach((course) => result.push({
        scheduleType,
        scheduleName: schedule[nameKey],
        course
      }));
    });
  });
  return result;
}
function buildNormalizeReport(snapshot) {
  const entries = collectSnapshotCourses(snapshot);
  const reasons = {};
  const samples = [];
  let normalizedCourseCount = 0;
  let venueCourseNameCount = 0;
  let teacherFieldCourseNameCount = 0;
  let physicalEducationLikeCount = 0;
  entries.forEach((entry) => {
    const course = entry.course || {};
    const reason = course.normalizationReason || "normal";
    reasons[reason] = (reasons[reason] || 0) + 1;
    const changed = reason !== "normal" || course.rawCourseName && course.canonicalCourseName && course.rawCourseName !== course.canonicalCourseName || course.rawClassroom && course.canonicalClassroom && course.rawClassroom !== course.canonicalClassroom || course.rawTeacherName && course.canonicalTeacherName && course.rawTeacherName !== course.canonicalTeacherName;
    if (changed) {
      normalizedCourseCount++;
      if (samples.length < 30) {
        samples.push({
          scheduleType: entry.scheduleType,
          scheduleName: entry.scheduleName,
          rawCourseName: course.rawCourseName || course.courseName,
          rawTeacherName: course.rawTeacherName || course.teacherName,
          rawClassroom: course.rawClassroom || course.classroom,
          canonicalCourseName: course.canonicalCourseName,
          canonicalClassroom: course.canonicalClassroom,
          canonicalTeacherName: course.canonicalTeacherName,
          normalizationReason: reason
        });
      }
    }
    if (course.isVenueCandidate) {
      venueCourseNameCount++;
    }
    if (course.isTeacherFieldActuallyCourseName) {
      teacherFieldCourseNameCount++;
    }
    if (course.isPhysicalEducationLike) {
      physicalEducationLikeCount++;
    }
  });
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    snapshotVersion: snapshot.version,
    semester: snapshot.semester,
    totalCourseCount: entries.length,
    normalizedCourseCount,
    venueCourseNameCount,
    teacherFieldCourseNameCount,
    physicalEducationLikeCount,
    reasons,
    samples
  };
}
function writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer) {
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json"), snapshotJson, "utf-8");
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json.gz"), compressedBuffer);
  const cliParams = global.CLI_PARAMS || {};
  if (cliParams.output) {
    const outputPath = resolveOutputFilePath(cliParams.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, snapshotJson, "utf-8");
    console.log(`\u{1F4BE} \u5DF2\u6309 output \u53C2\u6570\u5BFC\u51FA\u6570\u636E\u81F3: ${outputPath}`);
  }
  const normalizeReport = buildNormalizeReport(snapshot);
  fs.writeFileSync(path.join(debugDir, "normalize-report-latest.json"), JSON.stringify(normalizeReport, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u89C4\u8303\u5316\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/normalize-report-latest.json\uFF0C\u4FEE\u6B63\u8BFE\u7A0B ${normalizeReport.normalizedCourseCount}/${normalizeReport.totalCourseCount} \u6761`);
  return normalizeReport;
}
function buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, options = {}) {
  const version = generateSnapshotVersion();
  const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const noScheduleCachePath = path.join(__dirname, ".debug", "no-schedule-majors.json");
  const noScheduleMajors = readJsonArray(noScheduleCachePath);
  const md5 = (str) => crypto.createHash("md5").update(str).digest("hex");
  const updatedSchedules = (allClassSchedules || []).map((item) => {
    const classId = item.classId || md5(`${item.semester}_${item.collegeCode}_${item.grade}_${item.majorCode}_${item.className}`);
    const withClassId = Object.assign({}, item, { classId });
    return normalizeScheduleEntryCourses(withClassId, {
      semester: item.semester || activeSemester,
      classId,
      className: item.className,
      sourceType: "class",
      audienceType: "student"
    });
  });
  const syncPlan = getActiveSyncPlan();
  const allowOldResourceFallback = Boolean(syncPlan && syncPlan.mergeOldData);
  let oldResources = { teachers: [], classrooms: [], courses: [], teacherSchedules: [], classroomSchedules: [], courseSchedules: [] };
  const oldResourcesPath = path.join(__dirname, ".debug", "resources-latest.json");
  if (allowOldResourceFallback && fs.existsSync(oldResourcesPath)) {
    try {
      oldResources = JSON.parse(fs.readFileSync(oldResourcesPath, "utf-8"));
    } catch (e2) {
    }
  }
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const resourceIncludeOptions = options.resources || {};
  const derivedResources = buildSnapshotResources(updatedSchedules, resourceIncludeOptions);
  const generatedResources = resourceSchedules || derivedResources;
  const resources = normalizeSnapshotResources({
    teachers: resourceIncludeOptions.includeTeachers ? generatedResources.teachers || [] : oldResources.teachers || [],
    classrooms: resourceIncludeOptions.includeClassrooms ? generatedResources.classrooms || [] : oldResources.classrooms || [],
    courses: resourceIncludeOptions.includeCourses ? generatedResources.courses || [] : oldResources.courses || [],
    teacherSchedules: resourceIncludeOptions.includeTeacherSchedules ? generatedResources.teacherSchedules || [] : oldResources.teacherSchedules || [],
    classroomSchedules: resourceIncludeOptions.includeClassroomSchedules ? generatedResources.classroomSchedules || [] : oldResources.classroomSchedules || [],
    courseSchedules: resourceIncludeOptions.includeCourseSchedules ? generatedResources.courseSchedules || [] : oldResources.courseSchedules || []
  });
  const collegeCount = (catalog.colleges || []).length;
  const majorCount = (majors || []).length;
  const classScheduleCount = updatedSchedules.length;
  const adminClassCount = updatedSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const noScheduleMajorCount = noScheduleMajors.length;
  const teacherScheduleCount = resources.teacherSchedules.length;
  const classroomScheduleCount = resources.classroomSchedules.length;
  const courseScheduleCount = resources.courseSchedules.length;
  const timeTableSections = [
    { section: 1, start: "08:00", end: "08:40" },
    { section: 2, start: "08:45", end: "09:25" },
    { section: 3, start: "09:40", end: "10:20" },
    { section: 4, start: "10:25", end: "11:05" },
    { section: 5, start: "11:10", end: "11:50" },
    { section: 6, start: "13:30", end: "14:10" },
    { section: 7, start: "14:15", end: "14:55" },
    { section: 8, start: "15:10", end: "15:50" },
    { section: 9, start: "15:55", end: "16:35" },
    { section: 10, start: "16:40", end: "17:20" },
    { section: 11, start: "18:30", end: "19:10" },
    { section: 12, start: "19:15", end: "19:55" },
    { section: 13, start: "20:05", end: "20:45" },
    { section: 14, start: "20:50", end: "21:30" }
  ];
  const cliParams = global.CLI_PARAMS || {};
  const generatedCommand = global.GENERATED_COMMAND || `node sync.js local-campus ${process.argv.slice(2).join(" ")}`;
  const termConfig = global.TERM_CONFIG;
  if (!termConfig || !termConfig.termStartDate) {
    throw new Error("TERM_CONFIG_NOT_RESOLVED");
  }
  const termStartDate = termConfig.termStartDate;
  const cacheUsage = global.CLASS_SCHEDULE_CACHE_USAGE || {};
  const crawlStats = global.SYNC_CRAWL_STATS || {};
  const scopeSources = Object.assign({}, global.SCOPE_SOURCE_REPORTS || {});
  const diagnostics = [];
  const coverageQuality = {};
  if (scopeSources.teacherSchedules && scopeSources.teacherSchedules.coverageStatus === "invalid") {
    const teacherQuality = {
      code: "ENTITY_NAME_CONTAMINATED",
      severity: "error",
      resource: "teacher",
      message: "\u6559\u5E08\u540D\u79F0\u7591\u4F3C\u88AB\u73ED\u7EA7\u540D\u6216\u8BFE\u7A0B\u540D\u6C61\u67D3\uFF0C\u5F53\u524D direct teacher crawler \u6682\u4E0D\u5177\u5907\u5168\u6821\u8986\u76D6\u80FD\u529B\u3002",
      targetDiscoveryMode: scopeSources.teacherSchedules.targetDiscoveryMode || "unknown",
      discoveredTeacherTargets: scopeSources.teacherSchedules.discoveredTeacherTargets == null ? null : scopeSources.teacherSchedules.discoveredTeacherTargets,
      requestGroupCount: Number(scopeSources.teacherSchedules.requestGroupCount || 0),
      scheduleDocumentCount: Number(scopeSources.teacherSchedules.scheduleDocumentCount || teacherScheduleCount || 0),
      invalidTeacherNameCount: Number(scopeSources.teacherSchedules.invalidTeacherNameCount || 0),
      invalidTeacherNameSamples: scopeSources.teacherSchedules.invalidTeacherNameSamples || [],
      coverageStatus: "invalid",
      publishable: false
    };
    diagnostics.push(teacherQuality);
    coverageQuality.teacher = {
      coverageStatus: "invalid",
      publishable: false,
      targetDiscoveryMode: teacherQuality.targetDiscoveryMode,
      discoveredTeacherTargets: null,
      requestGroupCount: teacherQuality.requestGroupCount,
      scheduleDocumentCount: teacherQuality.scheduleDocumentCount,
      invalidTeacherNameCount: teacherQuality.invalidTeacherNameCount,
      invalidTeacherNameSamples: teacherQuality.invalidTeacherNameSamples
    };
  }
  const metaWarnings = [];
  if (cacheUsage.warning) {
    metaWarnings.push(cacheUsage.warning);
  }
  const counts = {
    classScheduleCount,
    adminClassCount,
    majorAggregateCount,
    teacherScheduleCount,
    classroomScheduleCount,
    courseScheduleCount,
    classroomCount: resources.classrooms.length,
    teacherCount: resources.teachers.length,
    courseCount: resources.courses.length,
    collegeCount,
    majorCount,
    gradeCount: (catalog.grades || []).length,
    noScheduleMajorCount
  };
  const summaryParts = [];
  if (includeScopes.includes("classSchedules")) summaryParts.push("\u884C\u653F\u73ED\u8BFE\u8868");
  if (includeScopes.includes("teachers")) summaryParts.push("\u6559\u5E08\u5217\u8868");
  if (includeScopes.includes("teacherSchedules")) summaryParts.push("\u6559\u5E08\u8BFE\u8868");
  if (includeScopes.includes("classrooms")) summaryParts.push("\u6559\u5BA4\u5217\u8868");
  if (includeScopes.includes("classroomSchedules")) summaryParts.push("\u6559\u5BA4\u8BFE\u8868");
  if (includeScopes.includes("courses")) summaryParts.push("\u8BFE\u7A0B\u5217\u8868");
  if (includeScopes.includes("courseSchedules")) summaryParts.push("\u8BFE\u7A0B\u8BFE\u8868");
  const scopeSummary = "\u66F4\u65B0: " + summaryParts.join(", ") + "; \u4FDD\u7559\u5176\u4ED6\u5386\u53F2\u6570\u636E";
  return {
    schemaVersion: "1.0",
    releaseVersion: cliParams.version || version,
    term: activeSemester,
    termConfig: Object.assign({}, termConfig, {
      releaseVersion: cliParams.version || version
    }),
    termStartDate,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    version,
    semester: activeSemester,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    releaseNote: cliParams.note || "\u5168\u6821\u8BFE\u8868\u6570\u636E\u5DF2\u66F4\u65B0",
    source: "local-sync-client",
    disclaimer: "\u672C\u5DE5\u5177\u4E3A\u4E2A\u4EBA\u5F00\u53D1\uFF0C\u975E\u5B66\u6821\u5B98\u65B9\u670D\u52A1\u3002\u8BFE\u7A0B\u6570\u636E\u7531\u5F00\u53D1\u8005\u6574\u7406\u7EF4\u62A4\u53CA\u7528\u6237\u53CD\u9988\u4FEE\u6B63\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF0C\u5177\u4F53\u5B89\u6392\u8BF7\u4EE5\u4EFB\u8BFE\u6559\u5E08\u901A\u77E5\u53CA\u6B63\u5F0F\u901A\u77E5\u4E3A\u51C6\u3002",
    // 注入 meta
    meta: {
      term: activeSemester,
      termConfig,
      startDate: termStartDate,
      includeScopes,
      classScope: cliParams.classScope || cliParams["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: cliParams.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(cliParams.forceRefresh || cliParams["force-refresh"]),
      ignoreProgress: Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]),
      crawlMode: crawlStats.crawlMode || cliParams.crawlMode || "incremental",
      usedProgressCache: Boolean(crawlStats.usedProgressCache),
      usedNoScheduleCache: Boolean(crawlStats.usedNoScheduleCache),
      usedClassScheduleCache: Boolean(crawlStats.usedClassScheduleCache || cacheUsage.usedClassScheduleCache || cacheUsage.used),
      actualNetworkRequestCount: Number(crawlStats.actualNetworkRequestCount || 0),
      skippedByProgressCount: Number(crawlStats.skippedByProgressCount || 0),
      skippedByNoScheduleCount: Number(crawlStats.skippedByNoScheduleCount || 0),
      partial: Number(crawlStats.failedTargetCount || 0) > 0,
      failedTargetCount: Number(crawlStats.failedTargetCount || 0),
      failedTargets: crawlStats.failedTargets || [],
      freshRunId: crawlStats.freshRunId || "",
      resourceSource: cliParams.resourceSource || cliParams["resource-source"] || "derived",
      syncPlan: syncPlan ? printablePlan(syncPlan) : null,
      scopeSources,
      diagnostics,
      coverage: coverageQuality,
      scopeSummary,
      generatedCommand,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      counts,
      cacheUsage: {
        usedClassScheduleCache: Boolean(cacheUsage.usedClassScheduleCache || cacheUsage.used),
        cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
        cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null
      },
      warnings: metaWarnings,
      cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
      cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null
    },
    catalog: {
      semesters: catalog.semesters || [],
      colleges: catalog.colleges || [],
      grades: catalog.grades || [],
      weeks: catalog.weeks || [],
      sections: catalog.sections || []
    },
    majors: majors || [],
    classSchedules: updatedSchedules,
    resources,
    scopeSources,
    diagnostics,
    timeTable: {
      sections: timeTableSections
    },
    coverage: Object.assign({
      collegeCount,
      majorCount,
      classScheduleCount,
      adminClassCount,
      majorAggregateCount,
      noScheduleMajorCount,
      teacherScheduleCount,
      classroomScheduleCount,
      courseScheduleCount
    }, coverageQuality)
  };
}
async function uploadSnapshot(buffer) {
  const url = `${FOSU_API_BASE}/api/admin/release/upload`;
  console.log(`\u{1F4E4} \u6B63\u5728\u4E0A\u4F20\u5FEB\u7167 (\u4F53\u79EF: ${(buffer.length / 1024 / 1024).toFixed(2)} MB) to: ${url}...`);
  const maxRetries = 4;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`\u2705 \u5FEB\u7167\u4E0A\u4F20 VPS \u6210\u529F: ${JSON.stringify(response.data)}`);
      if (response.data && response.data.job && response.data.job.id) {
        return await waitAdminJob(response.data.job.id, "release upload");
      }
      return response.data;
    } catch (error) {
      console.error(`\u274C \u5FEB\u7167\u4E0A\u4F20 VPS \u5931\u8D25 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
        console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
      }
      if (!shouldRetryError(error) || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   \u23F3 \u5FEB\u7167\u4E0A\u4F20\u5C06\u5728 ${delay}ms \u540E\u91CD\u8BD5...`);
      await sleep(delay);
    }
  }
}
async function activateSnapshot(version) {
  const url = `${FOSU_API_BASE}/api/admin/release/activate`;
  console.log(`\u{1F514} \u6B63\u5728\u8BF7\u6C42\u6FC0\u6D3B\u5FEB\u7167 (\u7248\u672C: ${version}) to: ${url}...`);
  try {
    const response = await axios.post(url, { version }, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false
      // 显式禁用代理
    });
    if (response.data && response.data.job && response.data.job.id) {
      return await waitAdminJob(response.data.job.id, "release activation");
    }
    return response.data;
  } catch (error) {
    console.error(`\u274C \u5FEB\u7167\u6FC0\u6D3B\u5931\u8D25: ${error.message}`);
    if (error.response) {
      console.error(`   VPS \u9519\u8BEF\u72B6\u6001\u7801: ${error.response.status}`);
      console.error(`   VPS \u9519\u8BEF\u8BE6\u60C5: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}
async function waitAdminJob(jobId, label) {
  const url = `${FOSU_API_BASE}/api/admin/jobs/${encodeURIComponent(jobId)}`;
  console.log(`\u23F3 ${label || "admin job"} \u5DF2\u8FDB\u5165\u540E\u53F0\u4EFB\u52A1: ${jobId}`);
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const response = await axios.get(url, {
      headers: {
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false
    });
    const job = response.data && response.data.job;
    if (job && (job.status === "success" || job.status === "failed")) {
      if (job.status === "failed") {
        throw new Error(`${label || "admin job"} failed: ${job.error && job.error.message || "unknown error"}`);
      }
      return Object.assign({ success: true, job }, job.result || {});
    }
    await sleep(1e3);
  }
  throw new Error(`${label || "admin job"} timed out: ${jobId}`);
}
async function verifyEndpoints() {
  const bootstrapUrl = `${FOSU_API_BASE}/api/fosu/bootstrap`;
  const statusUrl = `${FOSU_API_BASE}/api/admin/sync/status`;
  const releaseStatusUrl = `${FOSU_API_BASE}/api/admin/release/status`;
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1 bootstrap \u63A5\u53E3: ${bootstrapUrl}...`);
  const bRes = await axios.get(bootstrapUrl, { proxy: false });
  console.log(`   \u6210\u529F: ${bRes.data.success}, \u6570\u636E\u6E90: ${bRes.data.dataSource}, \u73ED\u7EA7\u6570: ${bRes.data.counts?.classScheduleCount}`);
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1\u7BA1\u7406\u5458\u72B6\u6001\u63A5\u53E3: ${statusUrl}...`);
  const sRes = await axios.get(statusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   \u5FEB\u7167\u7248\u672C: ${sRes.data.snapshotVersion}, \u5FEB\u7167\u66F4\u65B0\u65F6\u95F4: ${sRes.data.snapshotUpdatedAt}`);
  console.log(`\u{1F50E} \u6B63\u5728\u9A8C\u8BC1 release \u72B6\u6001\u63A5\u53E3: ${releaseStatusUrl}...`);
  const rRes = await axios.get(releaseStatusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   Active release: ${rRes.data.activeReleaseVersion}, updatedAt: ${rRes.data.activeReleaseUpdatedAt}`);
  return {
    bootstrap: bRes.data,
    status: sRes.data,
    releaseStatus: rRes.data
  };
}
function printReleaseSummary(snapshot, uploadResponse, activateResponse, verifyResponse) {
  const coverage = snapshot.coverage || {};
  const dryRun = Boolean(uploadResponse && uploadResponse.dryRun);
  console.log("\n================ [sync:release \u53D1\u5E03\u6458\u8981] ================");
  console.log(`- semester: ${snapshot.semester}`);
  console.log(`- collegesCount: ${coverage.collegeCount || coverage.collegesCount || 0}`);
  console.log(`- majorsCount: ${coverage.majorCount || coverage.majorsCount || 0}`);
  console.log(`- classScheduleCount: ${coverage.classScheduleCount || 0}`);
  console.log(`- teacherScheduleCount: ${coverage.teacherScheduleCount || 0}`);
  console.log(`- classroomScheduleCount: ${coverage.classroomScheduleCount || 0}`);
  console.log(`- courseScheduleCount: ${coverage.courseScheduleCount || 0}`);
  console.log(`- snapshotVersion: ${snapshot.version}`);
  console.log(`- updatedAt: ${snapshot.updatedAt}`);
  console.log(`- upload batches: ${dryRun ? 0 : uploadResponse ? 1 : 0}`);
  console.log(`- failed batches: 0`);
  console.log(`- activeReleaseVersion: ${dryRun ? "(dry-run, not activated)" : activateResponse?.version || verifyResponse?.releaseStatus?.activeReleaseVersion || ""}`);
  console.log("=======================================================\n");
}
function validateLocalReleaseSnapshot(snapshot) {
  const validation = releaseService.validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    console.error("\u274C \u672C\u5730 release \u6821\u9A8C\u5931\u8D25\uFF1A");
    validation.errors.slice(0, 20).forEach((error) => console.error(`   - ${error}`));
    if (validation.errors.length > 20) {
      console.error(`   ... \u8FD8\u6709 ${validation.errors.length - 20} \u4E2A\u9519\u8BEF`);
    }
    throw new Error("Release validation failed");
  }
  console.log(`\u2705 \u672C\u5730 release \u6821\u9A8C\u901A\u8FC7\uFF1AclassScheduleCount=${validation.counts.classScheduleCount}`);
  return validation;
}
function getUploadChunkSize() {
  const parsed2 = parseInt(process.env.SYNC_UPLOAD_CHUNK_SIZE || "10", 10);
  if (Number.isFinite(parsed2) && parsed2 > 0) {
    return parsed2;
  }
  console.warn(`\u26A0\uFE0F SYNC_UPLOAD_CHUNK_SIZE=${process.env.SYNC_UPLOAD_CHUNK_SIZE} \u65E0\u6548\uFF0C\u5DF2\u56DE\u9000\u4E3A 10\u3002`);
  return 10;
}
function getFormattedTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}
function shouldRetryError(error) {
  if (!error) return false;
  if (error.response) {
    const status = error.response.status;
    if ([502, 503, 504].includes(status)) {
      return true;
    }
    if ([400, 401, 403].includes(status)) {
      return false;
    }
  }
  const errCode = error.code || "";
  const errMessage = error.message || "";
  const retryCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
  if (retryCodes.includes(errCode)) {
    return true;
  }
  const retryMessages = [
    "socket hang up",
    "timeout",
    "Client network socket disconnected before secure TLS connection was established",
    "disconnected before secure TLS connection"
  ];
  if (retryMessages.some((msg) => errMessage.includes(msg))) {
    return true;
  }
  return false;
}
async function uploadWithRetry(endpoint, chunk, chunkNumber, totalChunks) {
  const maxRetries = 5;
  const retryDelays = [2e3, 5e3, 1e4, 2e4, 3e4];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await uploadToVps(endpoint, chunk, { maxRetries: 1 });
      if (!Array.isArray(chunk) && Array.isArray(chunk && chunk.items)) {
        chunk.length = chunk.items.length;
      }
      console.log(`   \u2705 [chunk ${chunkNumber}/${totalChunks}] \u4E0A\u4F20\u6210\u529F (\u5171 ${chunk.length} \u6761)`);
      return result;
    } catch (error) {
      const isRetryable = shouldRetryError(error);
      const attemptStr = `[chunk ${chunkNumber}/${totalChunks}] \u7B2C ${attempt} \u6B21\u5C1D\u8BD5\u5931\u8D25.`;
      if (attempt <= maxRetries && isRetryable) {
        const delay = retryDelays[attempt - 1] || 3e4;
        console.warn(`   \u26A0\uFE0F ${attemptStr} \u9519\u8BEF\u53EF\u91CD\u8BD5: ${error.message}\u3002\u5C06\u5728 ${delay / 1e3}s \u540E\u8FDB\u884C\u7B2C ${attempt + 1} \u6B21\u5C1D\u8BD5...`);
        await sleep(delay);
      } else {
        console.error(`   \u274C ${attemptStr} \u53D1\u751F\u4E0D\u53EF\u91CD\u8BD5\u9519\u8BEF\u6216\u91CD\u8BD5\u6B21\u6570\u8D85\u9650\u3002\u9519\u8BEF: ${error.message}`);
        throw error;
      }
    }
  }
}
function readUploadProgress(sourceFilePath) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const forceRestart = getEnvFlag("SYNC_UPLOAD_FORCE_RESTART", false);
  if (forceRestart) {
    console.log("\u2139\uFE0F SYNC_UPLOAD_FORCE_RESTART=true\uFF0C\u5FFD\u7565\u5DF2\u5B58\u5728\u7684\u4E0A\u4F20\u8FDB\u5EA6\uFF0C\u5C06\u4ECE\u5934\u5F00\u59CB\u91CD\u65B0\u4E0A\u4F20\u3002");
    return { uploadedChunkIndexes: [] };
  }
  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      if (progress.sourceFile === sourceFilePath) {
        console.log(`\u2139\uFE0F \u6062\u590D\u4E0A\u6B21\u4E0A\u4F20\u8FDB\u5EA6\uFF0C\u5DF2\u6210\u529F\u4E0A\u4F20\u6279\u6B21: ${progress.uploadedChunkIndexes.join(", ")}`);
        return progress;
      } else {
        console.log(`\u2139\uFE0F \u8FDB\u5EA6\u6587\u4EF6\u4E2D\u7684\u6E90\u6587\u4EF6\u4E0D\u5339\u914D (${progress.sourceFile} vs ${sourceFilePath})\uFF0C\u91CD\u65B0\u5F00\u59CB\u3002`);
      }
    } catch (e2) {
      console.warn("\u26A0\uFE0F \u8BFB\u53D6\u4E0A\u4F20\u8FDB\u5EA6\u6587\u4EF6\u5931\u8D25\uFF0C\u5C06\u91CD\u65B0\u4E0A\u4F20\u3002");
    }
  }
  return { uploadedChunkIndexes: [] };
}
function writeUploadProgress(sourceFilePath, semester2, total, chunkSize, uploadedChunkIndexes) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const progress = {
    sourceFile: sourceFilePath,
    semester: semester2,
    total,
    chunkSize,
    uploadedChunkIndexes,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}
function saveFullClassSchedules(allClassSchedules, semester2) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const payload = {
    success: true,
    type: "class-schedules",
    semester: semester2,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    itemCount: allClassSchedules.length,
    items: allClassSchedules
  };
  const latestPath = path.join(debugDir, "class-schedules-latest.json");
  const timestampPath = path.join(debugDir, `class-schedules-${getFormattedTimestamp()}.json`);
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(timestampPath, JSON.stringify(payload, null, 2), "utf-8");
  try {
    const plan = getActiveSyncPlan();
    const runId = plan && plan.runId || `class-${Date.now()}`;
    const cacheResult = syncCacheStore.writeScheduleLatest(__dirname, semester2, "classSchedules", allClassSchedules, {
      runId,
      command: global.GENERATED_COMMAND || process.argv.join(" "),
      sourceMode: "network-direct",
      endpointFamily: "class-schedule",
      acquisition: "network",
      fresh: Boolean(plan ? plan.schedulePolicy === "network-only" : true),
      requested: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.requestedTargetCount || allClassSchedules.length,
      succeeded: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.succeededTargetCount || allClassSchedules.length,
      failed: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.failedTargetCount || 0
    });
    recordScopeSource("classSchedules", {
      sourceMode: "network-direct",
      endpointFamily: "class-schedule",
      requested: cacheResult.metadata.requested,
      succeeded: cacheResult.metadata.succeeded,
      failed: cacheResult.metadata.failed,
      cacheHits: 0,
      startedAt: cacheResult.metadata.crawledAt,
      finishedAt: cacheResult.metadata.crawledAt,
      hash: cacheResult.metadata.hash
    });
    console.log(`Cache saved: ${cacheResult.latestPath}`);
  } catch (error) {
    console.warn(`Failed to write term cache for classSchedules: ${error.message}`);
  }
  console.log(`\u{1F4BE} \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3:
  - ${latestPath}
  - ${timestampPath}`);
  return { latestPath, timestampPath };
}
async function uploadClassSchedulesInChunks(classSchedules, debugDir, sourceFilePath, semester2) {
  const chunkSize = getUploadChunkSize();
  const totalChunks = Math.ceil(classSchedules.length / chunkSize);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const progress = readUploadProgress(sourceFilePath);
  const uploadedChunkIndexes = progress.uploadedChunkIndexes || [];
  console.log(`\u{1F4E6} \u5F00\u59CB\u5206\u5757\u4E0A\u4F20\u73ED\u7EA7\u8BFE\u8868: ${classSchedules.length} \u6761\uFF0C\u6BCF\u6279 ${chunkSize} \u6761\uFF0C\u5171 ${totalChunks} \u6279\u3002`);
  for (let index = 0; index < totalChunks; index++) {
    const chunkNumber = index + 1;
    if (uploadedChunkIndexes.includes(chunkNumber)) {
      console.log(`\u23ED\uFE0F [chunk ${chunkNumber}/${totalChunks}] \u8BE5\u5206\u5757\u5DF2\u4E0A\u4F20\u8FC7\uFF0C\u81EA\u52A8\u8DF3\u8FC7\u3002`);
      continue;
    }
    const start = index * chunkSize;
    const chunk = classSchedules.slice(start, start + chunkSize);
    try {
      await uploadWithRetry("/api/admin/sync/class-schedules?mode=merge", chunk, chunkNumber, totalChunks);
      uploadedChunkIndexes.push(chunkNumber);
      writeUploadProgress(sourceFilePath, semester2, classSchedules.length, chunkSize, uploadedChunkIndexes);
    } catch (error) {
      const failedPath = path.join(debugDir, `failed-class-schedules-chunk-${chunkNumber}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(chunk, null, 2), "utf-8");
      console.error(`\u274C [chunk ${chunkNumber}/${totalChunks}] \u5386\u7ECF\u591A\u6B21\u91CD\u8BD5\u4E0A\u4F20\u5931\u8D25\uFF0C\u5931\u8D25\u6279\u6B21\u5DF2\u4FDD\u5B58: ${failedPath}`);
      console.error(`\u26A0\uFE0F \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3 .debug/class-schedules-latest.json\uFF0C\u53EF\u7A0D\u540E\u6267\u884C upload-only \u7EE7\u7EED\u4E0A\u4F20\u3002`);
      throw error;
    }
  }
  try {
    const progressPath = path.join(debugDir, "class-upload-progress.json");
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
      console.log("\u{1F389} \u6240\u6709\u5206\u5757\u5DF2\u4E0A\u4F20\u6210\u529F\uFF0C\u5DF2\u6E05\u9664\u65AD\u70B9\u7EED\u4F20\u8FDB\u5EA6\u3002");
    }
  } catch (e2) {
  }
  const status = await fetchVpsSyncStatus();
  console.log("\n\u{1F50D} === [VPS \u540C\u6B65\u72B6\u6001\u9A8C\u8BC1] ===");
  console.log(`- classScheduleCount: ${status.classScheduleCount ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- classSchedulesUpdatedAt: ${status.classSchedulesUpdatedAt ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- storageMounted: ${status.storageMounted ?? "\u672A\u83B7\u53D6"}`);
  console.log(`- storagePath: ${status.storagePath ?? "\u672A\u83B7\u53D6"}`);
  console.log("==============================\n");
  return status;
}
function readClassSchedulesFromFile() {
  const debugDir = path.join(__dirname, ".debug");
  const candidates = [];
  if (process.env.SYNC_CLASS_UPLOAD_FILE) {
    candidates.push(path.resolve(process.env.SYNC_CLASS_UPLOAD_FILE));
  }
  const preferredTerm = String((global.CLI_PARAMS || {}).term || process.env.PREFERRED_SEMESTER || "").trim();
  if (preferredTerm) {
    candidates.push(syncCacheStore.scheduleLatestPath(__dirname, preferredTerm, "classSchedules"));
  }
  candidates.push(path.join(debugDir, "class-schedules-latest.json"));
  candidates.push(path.join(debugDir, "last-class-schedules.json"));
  candidates.push(path.join(debugDir, "last-class-schedules-upload.json"));
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        console.log(`\u{1F4D6} \u6B63\u5728\u4ECE\u672C\u5730\u6587\u4EF6\u8BFB\u53D6\u8BFE\u8868\u6570\u636E: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);
        let items2 = null;
        if (Array.isArray(json)) {
          items2 = json;
        } else if (json && Array.isArray(json.items)) {
          items2 = json.items;
        } else if (json && Array.isArray(json.data)) {
          items2 = json.data;
        } else if (json && Array.isArray(json.classSchedules)) {
          items2 = json.classSchedules;
        }
        if (items2 && items2.length > 0) {
          console.log(`\u2705 \u6210\u529F\u63D0\u53D6\u51FA ${items2.length} \u6761\u8BFE\u8868\u6570\u636E\u3002`);
          return { items: items2, filePath };
        }
      } catch (err) {
        console.warn(`\u26A0\uFE0F \u8BFB\u53D6\u6587\u4EF6\u5931\u8D25\uFF0C\u5C1D\u8BD5\u4E0B\u4E00\u4E2A\u8DEF\u5F84: ${filePath} (${err.message})`);
      }
    }
  }
  const errorMessage = [
    "\u274C \u672A\u627E\u5230\u4EFB\u4F55\u6709\u6548\u7684\u5B8C\u6574\u8BFE\u8868\u7F13\u5B58\u6587\u4EF6\uFF01",
    "\u5DF2\u68C0\u67E5\u7684\u8DEF\u5F84\u5217\u8868\u5982\u4E0B\uFF1A"
  ];
  candidates.forEach((c) => errorMessage.push(`  - ${c}`));
  if (fs.existsSync(debugDir)) {
    const files = fs.readdirSync(debugDir);
    const failedChunks = files.filter((f) => f.startsWith("failed-class-schedules-chunk-"));
    if (failedChunks.length > 0) {
      errorMessage.push(`\u5F53\u524D\u76EE\u5F55\u4E0B\u4EC5\u53D1\u73B0\u5206\u5757\u5931\u8D25\u6587\u4EF6: ${failedChunks.join(", ")}\uFF0C\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u662F\u5B8C\u6574\u6570\u636E\u3002`);
    }
  }
  throw new Error(errorMessage.join("\n"));
}
function tryReadClassSchedulesFromFile() {
  try {
    return readClassSchedulesFromFile();
  } catch (error) {
    return { items: [], filePath: null, error };
  }
}
function readClassScheduleCacheForSemester(semester2) {
  const cache = tryReadClassSchedulesFromFile();
  const items2 = Array.isArray(cache.items) ? cache.items : [];
  if (items2.length === 0) {
    return cache;
  }
  const matchedItems = items2.filter((item) => {
    const itemSemester = item && (item.semester || item.term || item.xnxqh);
    return !itemSemester || !semester2 || itemSemester === semester2;
  });
  if (matchedItems.length === 0) {
    return {
      items: [],
      filePath: cache.filePath,
      error: new Error(`\u5386\u53F2 classSchedules \u7F13\u5B58\u5B58\u5728\uFF0C\u4F46\u6CA1\u6709\u5339\u914D\u5B66\u671F ${semester2} \u7684\u8BFE\u8868\u8BB0\u5F55\u3002`)
    };
  }
  if (matchedItems.length !== items2.length) {
    console.log(`\u2139\uFE0F \u5386\u53F2\u8BFE\u8868\u7F13\u5B58\u6309\u5B66\u671F ${semester2} \u8FC7\u6EE4: ${items2.length} -> ${matchedItems.length} \u6761\u3002`);
  }
  return { items: matchedItems, filePath: cache.filePath };
}
function getClassScheduleIdentity(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  return item.classId || [
    item.semester || item.term || "",
    item.collegeCode || "",
    item.grade || "",
    item.majorCode || item.code || "",
    item.className || item.name || ""
  ].join("::");
}
function mergeClassSchedules(existing, incoming) {
  const merged = /* @__PURE__ */ new Map();
  (existing || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  (incoming || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
}
function printPowerShellCommands() {
  console.log("\n\u{1F4A1} Windows PowerShell \u5E38\u7528\u547D\u4EE4\u6307\u5357\uFF1A");
  console.log("--------------------------------------------------");
  console.log("\u{1F449} \u53EA\u6293\u53D6\u4E0D\u4E0A\u4F20 (Crawl Only):");
  console.log('   $env:SYNC_CLASS_SCOPE="all"');
  console.log('   $env:SYNC_CLASS_GRADES="2025,2024,2023,2022"');
  console.log('   $env:SYNC_CLASS_MAX_CONCURRENCY="1"');
  console.log('   $env:SYNC_CLASS_REQUEST_DELAY_MS="900"');
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY="true"');
  console.log("   npm run sync:class");
  console.log("");
  console.log("\u{1F449} \u53EA\u4E0A\u4F20\u672C\u5730\u7F13\u5B58 (Upload Only):");
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY=""');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:upload-cache");
  console.log("");
  console.log("\u{1F449} \u5F3A\u5236\u91CD\u65B0\u4E0A\u4F20\u672C\u5730\u7F13\u5B58 (Force Restart Upload):");
  console.log('   $env:SYNC_UPLOAD_FORCE_RESTART="true"');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="10"');
  console.log("   npm run sync:class");
  console.log("--------------------------------------------------\n");
}
async function handleUploadOnly() {
  const debugDir = path.join(__dirname, ".debug");
  try {
    const { items: items2, filePath } = readClassSchedulesFromFile();
    const semester2 = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    console.log(`\u{1F680} \u5F00\u59CB\u5728 upload-only \u6A21\u5F0F\u4E0B\u4E0A\u4F20\u6570\u636E\uFF0C\u6570\u636E\u6E90\uFF1A${filePath}\uFF0C\u5171\u8BA1 ${items2.length} \u6761\u3002`);
    await uploadClassSchedulesInChunks(items2, debugDir, filePath, semester2);
    console.log(`\u2705 \u672C\u5730\u7F13\u5B58\u6570\u636E\u4E0A\u4F20\u540C\u6B65\u6210\u529F\uFF01`);
  } catch (error) {
    console.error(`\u274C \u6267\u884C upload-only \u6A21\u5F0F\u5931\u8D25: 
${error.message}`);
    printPowerShellCommands();
    process.exit(1);
  }
}
async function handleOfflineRelease() {
  const zlib = require("zlib");
  console.log("\u{1F680} \u5F00\u59CB\u5728 offline-release \u6A21\u5F0F\u4E0B\u53D1\u5E03\u5FEB\u7167...");
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  const schedPath = path.join(__dirname, ".debug", "class-schedules-latest.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath) || !fs.existsSync(schedPath)) {
    throw new Error("\u79BB\u7EBF\u6A21\u5F0F\u4E0B\uFF0C\u5FC5\u987B\u5B58\u5728 last-catalog.json, last-majors.json \u548C .debug/class-schedules-latest.json \u7F13\u5B58\u6587\u4EF6\uFF01");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  const schedJson = JSON.parse(fs.readFileSync(schedPath, "utf-8"));
  const allClassSchedules = Array.isArray(schedJson) ? schedJson : schedJson.items || [];
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u672C\u5730\u8BFE\u8868\u7F13\u5B58\u6587\u4EF6\u4E2D\u7684\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF\u4E3A 0");
  }
  console.log(`\u{1F4D6} \u6210\u529F\u4ECE\u672C\u5730\u52A0\u8F7D\u57FA\u7840\u914D\u7F6E\u4E0E\u8BFE\u8868\u7F13\u5B58 (\u5171\u8BA1 ${allClassSchedules.length} \u6761\u8BFE\u8868)`);
  const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
    resources: {
      includeTeachers: includeReleaseResources,
      includeClassrooms: includeReleaseResources,
      includeCourses: includeReleaseResources
    }
  });
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
  const compressedBuffer = zlib.gzipSync(snapshotBuffer);
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
  console.log(`
\u{1F4BE} \u672C\u5730\u5FEB\u7167\u5DF2\u751F\u6210\u5E76\u538B\u7F29\uFF1A.debug/snapshot-latest.json \u548C .debug/snapshot-latest.json.gz (\u4F53\u79EF: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
  validateLocalReleaseSnapshot(snapshot);
  if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
    printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
    fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify({
      success: true,
      dryRun: true,
      version: snapshot.version,
      semester: snapshot.semester,
      updatedAt: snapshot.updatedAt,
      coverage: snapshot.coverage,
      normalizeReport,
      uploadSize: compressedBuffer.length
    }, null, 2), "utf-8");
    console.log("\u2139\uFE0F SYNC_RELEASE_DRY_RUN=true\uFF0C\u5DF2\u5B8C\u6210\u672C\u5730 release \u6784\u5EFA\u4E0E\u6821\u9A8C\uFF0C\u672A\u4E0A\u4F20\u6216\u6FC0\u6D3B VPS\u3002");
    return;
  }
  const uploadRes = await uploadSnapshot(compressedBuffer);
  const activateRes = await activateSnapshot(snapshot.version);
  console.log(`\u2705 \u5FEB\u7167\u6FC0\u6D3B\u6210\u529F! \u54CD\u5E94: ${JSON.stringify(activateRes)}`);
  const verifyRes = await verifyEndpoints();
  printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
  const report = {
    success: true,
    version: snapshot.version,
    semester: snapshot.semester,
    updatedAt: snapshot.updatedAt,
    coverage: snapshot.coverage,
    normalizeReport,
    uploadSize: compressedBuffer.length,
    serverStatus: verifyRes
  };
  fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u603B\u7ED3\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/sync-report-latest.json`);
  console.log("\n\u{1F389} [Release] \u79BB\u7EBF\u66B4\u529B\u5FEB\u7167\u53D1\u5E03\u5B8C\u6210\uFF01");
}
async function handleLocalStagingUpload(params) {
  const fileArg = params.file || params.input || "";
  const { resolved: filePath, tried } = resolveInputFilePath(fileArg);
  if (!filePath || !fs.existsSync(filePath)) {
    const errorMsg = [
      "Staging JSON \u6587\u4EF6\u4E0D\u5B58\u5728\u3002",
      `Received file arg: ${fileArg}`,
      `Current working directory (cwd): ${process.cwd()}`,
      `Detected project root: ${resolveProjectPath()}`,
      "Tried candidate paths:",
      ...tried.map((p) => `  - ${p}`)
    ].join("\n");
    throw new Error(errorMsg);
  }
  if (!ADMIN_API_TOKEN) {
    throw new Error("\u7F3A\u5C11 ADMIN_API_TOKEN\uFF0C\u65E0\u6CD5\u4E0A\u4F20\u5230\u540E\u53F0 Staging \u533A");
  }
  console.log(`Staging JSON resolved path: ${filePath}`);
  console.log("sync:upload-staging/local-upload will not access 100.fosu.edu.cn. It only uploads the explicit file.");
  const sidecarPath = getSidecarMetaPath(filePath);
  const sidecar = fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) : null;
  if (sidecar) {
    console.log(JSON.stringify({
      term: sidecar.term || params.term || "",
      generatedAt: sidecar.generatedAt || sidecar.updatedAt || "",
      canonicalHash: sidecar.canonicalHash || "",
      itemCount: sidecar.counts && sidecar.counts.classScheduleCount || sidecar.itemCount || 0,
      crawlMode: sidecar.crawlMode || "",
      actualNetworkRequestCount: sidecar.actualNetworkRequestCount || 0,
      usedClassScheduleCache: Boolean(sidecar.usedClassScheduleCache)
    }, null, 2));
    const freshNetwork = sidecar.crawlMode === "full-fresh" && !sidecar.usedClassScheduleCache && !sidecar.usedProgressCache && !sidecar.usedNoScheduleCache && Number(sidecar.actualNetworkRequestCount || 0) > 0;
    if (!freshNetwork && !(params["allow-cache-source"] || params.allowCacheSource)) {
      throw new Error("UPLOAD_STAGING_REQUIRES_FRESH_NETWORK_META: pass --allow-cache-source only when intentionally uploading cache/imported data.");
    }
  } else if (!(params["allow-cache-source"] || params.allowCacheSource)) {
    throw new Error(`Missing staging sidecar metadata: ${sidecarPath}. Pass --allow-cache-source only for explicit cache/import workflows.`);
  }
  console.log("local-upload uses gzip + chunk upload and only writes pending-review Staging; publishing is a separate step unless the selected Sync Plan asks for it.");
  return stagingUploader.uploadStagingFile({
    filePath,
    server: params.server || FOSU_API_BASE,
    token: ADMIN_API_TOKEN,
    authMode: "admin",
    params,
    term: params.term || process.env.PREFERRED_SEMESTER || "",
    note: params.note || "",
    source: "local-upload-cli"
  });
}
function writeLocalStagingDebugFailure(params, catalog, majors, error) {
  const term = params.term || process.env.PREFERRED_SEMESTER || catalog?.semesters?.[0]?.value || "term";
  const debugPayload = {
    success: false,
    type: "local-campus-staging-debug",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    error: error && (error.stack || error.message) || String(error),
    meta: {
      term,
      startDate: params.start || process.env.SYNC_TERM_START_DATE || "",
      includeScopes: global.CLI_PARAMS?.includeScopes || ALL_SCOPES,
      classScope: params.classScope || params["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: params.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(params.forceRefresh || params["force-refresh"]),
      ignoreProgress: Boolean(params.ignoreProgress || params["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(params.ignoreNoScheduleCache || params["ignore-no-schedule-cache"]),
      generatedCommand: global.GENERATED_COMMAND || process.argv.join(" "),
      counts: {
        collegeCount: catalog?.colleges?.length || 0,
        majorCount: majors?.length || 0,
        classScheduleCount: 0
      },
      cacheUsage: global.CLASS_SCHEDULE_CACHE_USAGE || null,
      warnings: ["\u672A\u751F\u6210\u6B63\u5F0F Staging JSON\uFF0C\u8BF7\u6309 error \u5B57\u6BB5\u5904\u7406\u540E\u91CD\u65B0\u8FD0\u884C\u3002"]
    }
  };
  const output = resolveOutputFilePath(params.debugOutput || path.join("staging", `debug-${term}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(debugPayload, null, 2), "utf-8");
  console.error(`\u{1F9EA} \u5DF2\u751F\u6210 debug JSON\uFF0C\u4E0D\u4F1A\u4F5C\u4E3A\u6B63\u5F0F Staging \u53D1\u5E03: ${output}`);
  return output;
}
function readTermCatalogCache(term) {
  const root = syncCacheStore.ensureTermCache(__dirname, term);
  const catalog = syncCacheStore.readJson(path.join(root, "catalog", "catalog.json"), null);
  const majors = syncCacheStore.readJson(path.join(root, "catalog", "majors.json"), null);
  const catalogMeta = syncCacheStore.readJson(path.join(root, "catalog", "metadata.json"), null);
  const majorsMeta = syncCacheStore.readJson(path.join(root, "catalog", "majors.metadata.json"), null);
  if (!catalog || !Array.isArray(catalog.colleges) || !Array.isArray(catalog.grades) || !Array.isArray(catalog.semesters)) {
    return null;
  }
  if (!Array.isArray(majors) || majors.length === 0) {
    return null;
  }
  if (catalogMeta && catalogMeta.term && catalogMeta.term !== term) return null;
  if (majorsMeta && majorsMeta.term && majorsMeta.term !== term) return null;
  return { catalog, majors, catalogMeta, majorsMeta };
}
async function resolveCatalogForPlan(page, params) {
  const plan = getActiveSyncPlan();
  const term = params.term || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  if (plan && (plan.catalogPolicy === "reuse-validated" || plan.catalogPolicy === "cache-only")) {
    const cached = readTermCatalogCache(term);
    if (cached) {
      console.log(`[catalog] Reusing validated term cache: ${term}`);
      return cached;
    }
    if (plan.catalogPolicy === "cache-only") {
      throw new Error(`CATALOG_CACHE_MISSING: ${term}`);
    }
  }
  const catalog = await syncCatalog(page);
  const majors = await syncMajors(page, catalog);
  return { catalog, majors };
}
async function handleLocalCampusStaging(page, params) {
  console.log("\n================ [\u672C\u673A\u6821\u56ED\u7F51\u91C7\u96C6 Staging] ================");
  process.env.SYNC_LOCAL_STAGING_ONLY = "true";
  process.env.SYNC_CLASS_CRAWL_ONLY = "true";
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map((c) => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map((g) => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);
  if (!isFiltered && includeScopes.includes("classSchedules")) {
    if (!process.env.SYNC_CLASS_SCOPE) {
      process.env.SYNC_CLASS_SCOPE = "all";
    }
  }
  const { catalog, majors } = await resolveCatalogForPlan(page, params);
  let allClassSchedules = [];
  if (includeScopes.includes("classSchedules")) {
    try {
      allClassSchedules = await syncClassSchedules(page, catalog, majors);
    } catch (error) {
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
    if (!allClassSchedules || allClassSchedules.length === 0) {
      const error = new Error("\u672C\u673A\u6821\u56ED\u7F51\u91C7\u96C6\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u672A\u751F\u6210\u6B63\u5F0F Staging JSON");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message}\u3002\u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
  } else {
    console.log("\u2139\uFE0F \u540C\u6B65\u8303\u56F4\u4E0D\u5305\u542B\u884C\u653F\u73ED\u8BFE\u8868 (classSchedules)\u3002\u4ECE\u672C\u5730\u52A0\u8F7D\u5DF2\u6709\u7F13\u5B58\u4EE5\u4FDD\u62A4\u5B66\u751F\u8BFE\u8868\u3002");
    const cache = readClassScheduleCacheForSemester(process.env.PREFERRED_SEMESTER || params.term || catalog.semesters?.[0]?.value);
    allClassSchedules = cache.items || [];
    if (!allClassSchedules.length) {
      const error = cache.error || new Error("\u53EA\u66F4\u65B0\u516C\u5171\u8D44\u6E90\u65F6\u672A\u627E\u5230\u53EF\u5408\u5E76\u7684\u5386\u53F2 classSchedules\uFF0C\u7981\u6B62\u751F\u6210\u4F1A\u6E05\u7A7A\u5B66\u751F\u8BFE\u8868\u7684 Staging\u3002");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
    }
    global.CLASS_SCHEDULE_CACHE_USAGE = {
      usedClassScheduleCache: true,
      cacheSource: cache.filePath,
      cacheWarning: "\u540C\u6B65\u8303\u56F4\u4E0D\u5305\u542B classSchedules\uFF0C\u5DF2\u5408\u5E76\u5386\u53F2\u884C\u653F\u73ED\u8BFE\u8868\u7F13\u5B58\u4EE5\u9632\u6B62\u53D1\u5E03\u540E\u6E05\u7A7A\u5B66\u751F\u8BFE\u8868\u3002"
    };
  }
  const resourceIncludeOptions = buildResourceIncludeOptionsFromScopes(includeScopes);
  const resourceTypesForScopes = getResourceTypesFromIncludeScopes(includeScopes);
  const resourceSchedules = resourceTypesForScopes.length ? await buildResourcesForClassSchedules(allClassSchedules, resourceTypesForScopes, {
    page,
    semester: process.env.PREFERRED_SEMESTER || params.term || catalog.semesters?.[0]?.value
  }) : null;
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, {
    resources: resourceIncludeOptions
  });
  if (includeScopes.includes("classSchedules") && (!snapshot.classSchedules || snapshot.classSchedules.length === 0)) {
    const error = new Error("includeScopes \u5305\u542B classSchedules\uFF0C\u4F46\u6700\u7EC8\u5FEB\u7167 classSchedules \u4E3A 0\uFF0C\u5DF2\u7981\u6B62\u751F\u6210\u6B63\u5F0F Staging\u3002");
    const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
    throw new Error(`${error.message} \u5DF2\u751F\u6210 debug JSON: ${debugPath}`);
  }
  validateLocalReleaseSnapshot(snapshot);
  const defaultOutput = path.join("staging", `${snapshot.semester || params.term || "term"}-full.json`);
  const output = resolveOutputFilePath(params.output || defaultOutput);
  printLocalCampusPathSummary(params, output);
  const sidecarPath = getSidecarMetaPath(output);
  const previousHash = readSidecarHash(sidecarPath);
  const fingerprint = calculateFingerprint(snapshot);
  snapshot.canonicalHash = fingerprint.canonicalHash;
  snapshot.meta = Object.assign({}, snapshot.meta || {}, {
    canonicalHash: fingerprint.canonicalHash,
    previousHash,
    changed: previousHash ? previousHash !== fingerprint.canonicalHash : true
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), "utf-8");
  const rawSizeBytes = fs.statSync(output).size;
  const sidecarMeta = buildSidecarMeta(snapshot, {
    fingerprint,
    previousHash,
    rawSizeBytes
  });
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecarMeta, null, 2), "utf-8");
  console.log(`\u{1F4BE} Staging JSON \u5DF2\u751F\u6210: ${output}`);
  console.log(`\u{1F9FE} Staging meta \u5DF2\u751F\u6210: ${sidecarPath}`);
  console.log(`\u{1F4E6} \u6700\u7EC8 staging \u6587\u4EF6\u5927\u5C0F: ${(rawSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\u{1F510} canonicalHash: ${fingerprint.canonicalHash}`);
  if (sidecarMeta.changed) {
    console.log("\u2705 \u6570\u636E\u6307\u7EB9\u5DF2\u66F4\u65B0\uFF0C\u53EF\u4E0A\u4F20 staging\u3002");
  } else {
    const meta2 = snapshot.meta || {};
    const cacheUsed = Boolean(meta2.usedProgressCache || meta2.usedNoScheduleCache || meta2.usedClassScheduleCache);
    console.log("\u2705 \u6570\u636E\u6CA1\u6709\u53D8\u5316\uFF0C\u672C\u5730\u6587\u4EF6\u4E0E\u4E0A\u6B21 sidecar \u6307\u7EB9\u4E00\u81F4\u3002");
    console.log(`\u2139\uFE0F \u672C\u6B21\u771F\u5B9E\u7F51\u7EDC\u8BF7\u6C42\u4E13\u4E1A\u6570: ${meta2.actualNetworkRequestCount || 0}`);
    console.log(`\u2139\uFE0F \u672C\u6B21\u7F13\u5B58\u4F7F\u7528: progress=${meta2.usedProgressCache ? "\u662F" : "\u5426"}, no-schedule=${meta2.usedNoScheduleCache ? "\u662F" : "\u5426"}, classSchedules=${meta2.usedClassScheduleCache ? "\u662F" : "\u5426"}`);
    if (cacheUsed) {
      console.log("\u26A0\uFE0F \u672C\u6B21\u7ED3\u679C\u53EF\u80FD\u53D7\u672C\u5730\u7F13\u5B58\u5F71\u54CD\uFF1B\u5982\u9700\u91CD\u65B0\u9A8C\u8BC1\u6559\u52A1\u7F51\u5B9E\u65F6\u6570\u636E\uFF0C\u8BF7\u6267\u884C --fresh\u3002");
    }
  }
  console.log(`\u{1F4CA} \u884C\u653F\u73ED\u8BFE\u8868: ${snapshot.coverage.classScheduleCount || 0}, \u6559\u5E08\u8BFE\u8868: ${snapshot.coverage.teacherScheduleCount || 0}, \u6559\u5BA4\u8BFE\u8868: ${snapshot.coverage.classroomScheduleCount || 0}, \u8BFE\u7A0B\u8BFE\u8868: ${snapshot.coverage.courseScheduleCount || 0}`);
  console.log("\u2139\uFE0F \u5F53\u524D\u547D\u4EE4\u4E0D\u4F1A\u4E0A\u4F20\u3001\u4E0D\u4F1A\u53D1\u5E03\uFF1B\u4E0B\u4E00\u6B65\u8FD0\u884C sync:local-upload \u4E0A\u4F20\u5230 VPS Staging\u3002");
  return snapshot;
}
async function ensurePlannedTermIfNeeded(plan) {
  if (!plan || plan.profile !== "new-term") return null;
  if (!plan.termValid) throw new Error(`INVALID_TERM_FORMAT: ${plan.term}`);
  if (!plan.termConfig.termStartDate || !plan.termConfig.totalWeeks) {
    throw new Error("NEW_TERM_REQUIRES_EXPLICIT_CONFIG: pass --term-start-date=YYYY-MM-DD and --total-weeks=N.");
  }
  if (!ADMIN_API_TOKEN) {
    console.warn("[new-term] ADMIN_API_TOKEN missing; planned term creation skipped.");
    return null;
  }
  try {
    return await postAdminJson("/api/admin/terms", {
      term: plan.term,
      semesterText: plan.term,
      termStartDate: plan.termConfig.termStartDate,
      totalWeeks: plan.termConfig.totalWeeks,
      weekStart: plan.termConfig.weekStart || "monday",
      status: "planned",
      source: "sync-new-term"
    }, "create planned term");
  } catch (error) {
    const status = error.response && error.response.status;
    const code = error.response && error.response.data && error.response.data.code;
    if (status === 409 || code === "TERM_ALREADY_EXISTS") {
      console.log(`[new-term] Planned term already exists: ${plan.term}`);
      return null;
    }
    throw error;
  }
}
async function runClientProbeForRelease(result) {
  const version = result && (result.releaseVersion || result.version) || "";
  const term = result && (result.term || result.semester) || "";
  const probe = { term, releaseVersion: version, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), checks: [] };
  const urls = [
    ["/static/runtime/active.json", "runtime pointer"],
    [version ? `/static/releases/${encodeURIComponent(version)}/manifest.json` : "", "manifest"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/class.json` : "", "class index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/teacher.json` : "", "teacher index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/classroom.json` : "", "classroom index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/course.json` : "", "course index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/calendar.json` : "", "calendar"],
    [version ? `/static/releases/${encodeURIComponent(version)}/empty-room/index.json` : "", "empty-room"]
  ].filter(([url]) => Boolean(url));
  for (const [pathname, label] of urls) {
    try {
      const response = await axios.get(`${FOSU_API_BASE}${pathname}`, { proxy: false, timeout: 15e3 });
      probe.checks.push({ label, url: pathname, ok: response.status >= 200 && response.status < 300, status: response.status });
    } catch (error) {
      probe.checks.push({ label, url: pathname, ok: false, status: error.response && error.response.status || 0, message: error.message });
    }
  }
  console.log("[client-probe]");
  console.log(JSON.stringify(probe, null, 2));
  if (!probe.checks.every((item) => item.ok)) throw new Error("CLIENT_PROBE_FAILED");
  return probe;
}
async function publishCurrentStaging(plan, snapshot) {
  if (!plan.buildRelease) return null;
  if (!ADMIN_API_TOKEN) throw new Error("ADMIN_API_TOKEN_REQUIRED_FOR_PUBLISH");
  const result = await postAdminJson("/api/admin/sync/staging/publish", {
    force: Boolean(plan.allowPartial || (global.CLI_PARAMS || {}).force),
    readyOnly: plan.profile === "new-term" && !plan.activate,
    releaseNote: (global.CLI_PARAMS || {}).note || snapshot.releaseNote || ""
  }, "staging publish");
  if (plan.verifyClient && !result.readyOnly) await runClientProbeForRelease(result);
  return result;
}
async function handlePlannedSync(page, params) {
  const plan = getActiveSyncPlan();
  if (!plan) throw new Error("SYNC_PLAN_NOT_RESOLVED");
  if (!plan.termValid) throw new Error(`INVALID_TERM_FORMAT: ${plan.term}`);
  await ensurePlannedTermIfNeeded(plan);
  if (!params.output) params.output = path.join("staging", `${plan.term}-full.json`);
  if (["daily", "new-term", "crawl-daily"].includes(plan.profile)) {
    process.env.SYNC_CLASS_SCOPE = process.env.SYNC_CLASS_SCOPE || "all";
  }
  const snapshot = await handleLocalCampusStaging(page, params);
  if (!plan.upload) {
    syncCacheStore.writeJsonAtomic(syncCacheStore.reportPath(__dirname, plan.term, "crawl-report"), {
      success: true,
      profile: plan.profile,
      runId: plan.runId,
      term: plan.term,
      output: resolveOutputFilePath(params.output),
      uploaded: false,
      published: false,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return snapshot;
  }
  const uploadResult = await handleLocalStagingUpload(Object.assign({}, params, { file: params.output }));
  const publishResult = await publishCurrentStaging(plan, snapshot);
  const report = {
    success: true,
    profile: plan.profile,
    runId: plan.runId,
    term: plan.term,
    output: resolveOutputFilePath(params.output),
    uploaded: true,
    uploadResult,
    published: Boolean(publishResult),
    publishResult,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  syncCacheStore.writeJsonAtomic(syncCacheStore.reportPath(__dirname, plan.term, "publish-report"), report);
  return report;
}
var RESOURCE_SYNC_CONFIGS = {
  teacher: {
    flag: "SYNC_RESOURCES_TEACHERS",
    schedulesKey: "teacherSchedules",
    indexKey: "teachers",
    endpointType: "teacher",
    label: "\u6559\u5E08"
  },
  classroom: {
    flag: "SYNC_RESOURCES_CLASSROOMS",
    schedulesKey: "classroomSchedules",
    indexKey: "classrooms",
    endpointType: "classroom",
    label: "\u6559\u5BA4"
  },
  course: {
    flag: "SYNC_RESOURCES_COURSES",
    schedulesKey: "courseSchedules",
    indexKey: "courses",
    endpointType: "course",
    label: "\u8BFE\u7A0B"
  }
};
function normalizeResourceTypeList(types) {
  const list = Array.isArray(types) && types.length ? types : ["teacher", "classroom", "course"];
  return list.filter((type) => RESOURCE_SYNC_CONFIGS[type]);
}
function getResourceDelayConfig() {
  const requestDelay = parseInt(process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "", 10);
  const min = parseInt(process.env.SYNC_RESOURCE_DELAY_MIN_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "800", 10);
  const max = parseInt(process.env.SYNC_RESOURCE_DELAY_MAX_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "1500", 10);
  return {
    concurrency: parseInt(process.env.SYNC_RESOURCE_MAX_CONCURRENCY || process.env.SYNC_RESOURCE_CONCURRENCY || "1", 10) || 1,
    requestDelayMs: Number.isFinite(requestDelay) && requestDelay >= 0 ? requestDelay : null,
    minDelayMs: Number.isFinite(min) ? min : 800,
    maxDelayMs: Number.isFinite(max) ? max : 1500
  };
}
function getResourceUploadChunkSize() {
  const value = parseInt(process.env.SYNC_RESOURCE_UPLOAD_CHUNK_SIZE || process.env.SYNC_UPLOAD_CHUNK_SIZE || "20", 10);
  return Number.isFinite(value) && value > 0 ? value : 20;
}
function getEffectiveResourceSourceMode() {
  const raw2 = String(process.env.SYNC_RESOURCE_SOURCE || global.CLI_PARAMS?.resourceSource || "derived").trim().toLowerCase();
  if (raw2 === "direct" || raw2 === "both" || raw2 === "derived") return raw2;
  return "derived";
}
function shouldUseDirectTeacherResources(resourceTypes) {
  const types = normalizeResourceTypeList(resourceTypes);
  if (!types.includes("teacher")) return false;
  const mode = getEffectiveResourceSourceMode();
  return mode === "direct" || mode === "both" || getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false);
}
function shouldUseDirectResource(type, resourceTypes) {
  const types = normalizeResourceTypeList(resourceTypes);
  if (!types.includes(type)) return false;
  const mode = getEffectiveResourceSourceMode();
  return mode === "direct" || mode === "both" || getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false);
}
function teacherNameOf(item) {
  return String(item && (item.teacherName || item.name || item.displayName || item.rawName) || "").trim();
}
function getCourseMergeKey(course) {
  return [
    course.courseName || course.canonicalCourseName || "",
    course.weekday || course.dayOfWeek || "",
    course.startSection || "",
    course.endSection || "",
    course.startWeek || "",
    course.endWeek || "",
    Array.isArray(course.weeks) ? course.weeks.join(",") : "",
    course.classroom || course.canonicalClassroom || "",
    course.className || ""
  ].join("|");
}
function dedupeCourses(courses) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  (courses || []).forEach((course) => {
    const key = getCourseMergeKey(course || {});
    if (seen.has(key)) return;
    seen.add(key);
    result.push(course);
  });
  return result;
}
function buildTeacherResourcesFromSchedules(schedules) {
  const teacherSchedules = (schedules || []).map((schedule) => {
    const teacherName = teacherNameOf(schedule);
    if (!teacherName) return null;
    const courses = dedupeCourses(schedule.courses || []);
    return Object.assign({}, schedule, {
      name: teacherName,
      teacherName,
      displayName: schedule.displayName || teacherName,
      source: schedule.source || "direct",
      courses
    });
  }).filter(Boolean).sort((left, right) => String(left.teacherName).localeCompare(String(right.teacherName), "zh-CN"));
  return {
    teachers: teacherSchedules.map((schedule) => ({
      name: schedule.teacherName,
      teacherName: schedule.teacherName,
      displayName: schedule.displayName || schedule.teacherName,
      collegeCode: schedule.collegeCode || "",
      collegeName: schedule.collegeName || schedule.college || "",
      title: schedule.title || schedule.teacherTitle || schedule.professionalTitle || "",
      professionalTitle: schedule.professionalTitle || schedule.title || "",
      source: schedule.source || "direct",
      courseCount: (schedule.courses || []).length,
      firstCourseName: (schedule.courses || [])[0]?.courseName || ""
    })),
    teacherSchedules
  };
}
function mergeTeacherResourceSets(directResources, derivedResources, mode) {
  if (mode === "direct") {
    return buildTeacherResourcesFromSchedules(directResources && directResources.teacherSchedules || []);
  }
  if (mode !== "both") {
    return buildTeacherResourcesFromSchedules(derivedResources && derivedResources.teacherSchedules || []);
  }
  const merged = /* @__PURE__ */ new Map();
  const addSchedules = (schedules, source) => {
    (schedules || []).forEach((schedule) => {
      const teacherName = teacherNameOf(schedule);
      if (!teacherName) return;
      const existing = merged.get(teacherName) || {
        name: teacherName,
        teacherName,
        displayName: schedule.displayName || teacherName,
        collegeCode: "",
        collegeName: "",
        title: "",
        professionalTitle: "",
        source: "",
        sources: [],
        courses: []
      };
      existing.collegeCode = existing.collegeCode || schedule.collegeCode || "";
      existing.collegeName = existing.collegeName || schedule.collegeName || schedule.college || "";
      existing.title = existing.title || schedule.title || schedule.teacherTitle || schedule.professionalTitle || "";
      existing.professionalTitle = existing.professionalTitle || schedule.professionalTitle || schedule.title || "";
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.courses = dedupeCourses(existing.courses.concat(schedule.courses || []));
      existing.source = existing.sources.length > 1 ? "merged" : source;
      merged.set(teacherName, existing);
    });
  };
  addSchedules(directResources && directResources.teacherSchedules || [], "direct");
  addSchedules(derivedResources && derivedResources.teacherSchedules || [], "derived");
  return buildTeacherResourcesFromSchedules(Array.from(merged.values()));
}
function mergeResourcesBySource(derivedResources, directResources, mode) {
  const teacherPart = mergeTeacherResourceSets(directResources, derivedResources, mode);
  return Object.assign({}, derivedResources || emptySnapshotResources(), {
    teachers: teacherPart.teachers,
    teacherSchedules: teacherPart.teacherSchedules
  });
}
async function mapWithConcurrency(items2, concurrency, iteratee) {
  const list = items2 || [];
  const workerCount = Math.max(1, Math.min(Number(concurrency || 1) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
function getDirectTeacherLimit() {
  return parsePositiveLimit(process.env.SYNC_DIRECT_TEACHER_LIMIT) || parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
}
function limitDirectTargets(targets) {
  const limit = getDirectTeacherLimit();
  return limit ? targets.slice(0, limit) : targets;
}
async function collectDirectTeacherTargets(page, derivedResources, semester2) {
  await gotoPage(page, "/kbcx/kbxx_teacher", { waitUntil: "networkidle", timeout: 2e4 });
  try {
    await selectSemester(page, semester2);
  } catch (error) {
    console.warn(`[resources:teacher:direct] semester select fallback: ${error.message}`);
  }
  const html = await page.content();
  const debugDir = path.join(__dirname, ".debug");
  fs.writeFileSync(path.join(debugDir, "direct-teacher-page.html"), html, "utf-8");
  const dom = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const optionList = (select) => Array.from(select.options || []).map((option) => ({
      code: clean(option.value),
      name: clean(option.textContent)
    })).filter((option) => option.name && option.code && !/^请选择|^全部|^--/.test(option.name));
    const result = {
      teachers: [],
      colleges: [],
      titles: [],
      selects: []
    };
    Array.from(document.querySelectorAll("select")).forEach((select) => {
      const marker = `${select.getAttribute("name") || ""} ${select.getAttribute("id") || ""}`.toLowerCase();
      const options = optionList(select);
      result.selects.push({ marker, optionCount: options.length });
      if (/skyx|college|yx/.test(marker)) {
        result.colleges.push(...options);
      } else if (/jszc|title|zc/.test(marker)) {
        result.titles.push(...options);
      } else if (/(^|[^a-z])(js|skjs|teacher|jzg|gh)([^a-z]|$)/.test(marker)) {
        result.teachers.push(...options);
      }
    });
    return result;
  });
  const teacherTargets = (dom.teachers || []).map((item) => ({
    type: "teacher",
    teacherCode: item.code,
    teacherName: item.name
  }));
  if (teacherTargets.length) {
    return {
      targets: limitDirectTargets(teacherTargets),
      dom,
      source: "teacher-select"
    };
  }
  const collegeTargets = (dom.colleges || []).map((item) => ({
    type: "college",
    collegeCode: item.code,
    collegeName: item.name
  }));
  if (collegeTargets.length) {
    return {
      targets: limitDirectTargets(collegeTargets),
      dom,
      source: "college-select"
    };
  }
  const derivedTargets = (derivedResources && derivedResources.teacherSchedules || []).map((item) => teacherNameOf(item)).filter(Boolean).filter((name, index, list) => list.indexOf(name) === index).map((name) => ({
    type: "teacher-name",
    teacherName: name
  }));
  if (derivedTargets.length) {
    return {
      targets: limitDirectTargets(derivedTargets),
      dom,
      source: "derived-teacher-names"
    };
  }
  return {
    targets: [{ type: "all" }],
    dom,
    source: "all-teachers"
  };
}
async function fetchDirectTeacherScheduleHtml(page, target, semester2) {
  return page.evaluate(async (input) => {
    const body = new URLSearchParams({
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      jszc: input.target.titleCode || "",
      js: input.target.teacherCode || "",
      jsid: input.target.teacherCode || "",
      jzgid: input.target.teacherCode || "",
      gh: input.target.teacherCode || "",
      skjs: input.target.teacherCode || "",
      jsxm: input.target.teacherName || "",
      jsmc: input.target.teacherName || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: ""
    }).toString();
    const response = await fetch("/kbcx/kbxx_teacher_ifr", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      credentials: "include",
      body
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  }, { target, semester: semester2 });
}
async function crawlDirectTeacherResources(page, derivedResources = {}, options = {}) {
  const semester2 = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const delayConfig = getResourceDelayConfig();
  const collected = await collectDirectTeacherTargets(page, derivedResources, semester2);
  const targets = collected.targets || [];
  console.log(`[resources:teacher:direct] source=${collected.source}, targets=${targets.length}, concurrency=${delayConfig.concurrency}`);
  const samples = [];
  const errors = [];
  const grouped = /* @__PURE__ */ new Map();
  await mapWithConcurrency(targets, delayConfig.concurrency, async (target, index) => {
    if (index > 0) {
      const delay = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : delayConfig.minDelayMs;
      if (delay > 0) await sleep(delay);
    }
    try {
      const response = await fetchDirectTeacherScheduleHtml(page, target, semester2);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (samples.length < 5) {
        samples.push({
          target,
          responseLength: response.text.length,
          htmlPath: `direct-teacher-sample-${samples.length + 1}.html`
        });
        fs.writeFileSync(path.join(debugDir, `direct-teacher-sample-${samples.length}.html`), response.text, "utf-8");
      }
      const parsed2 = parser.parseTeacherScheduleIfrHtml(response.text, {
        semester: semester2,
        teacherName: target.teacherName || "",
        collegeCode: target.collegeCode || "",
        collegeName: target.collegeName || ""
      });
      const courses = normalizer.normalizeCourseList(parsed2.courses || [], {
        semester: semester2,
        sourceType: "teacher",
        audienceType: "teacher"
      });
      courses.forEach((course) => {
        const teacherName = teacherNameOf(course) || target.teacherName || "\u672A\u77E5\u6559\u5E08";
        if (!isUsableResourceName(teacherName) || courseIdentity.isCourseLike(teacherName)) return;
        const current = grouped.get(teacherName) || {
          teacherName,
          name: teacherName,
          displayName: teacherName,
          collegeCode: target.collegeCode || course.collegeCode || "",
          collegeName: target.collegeName || course.collegeName || "",
          title: target.title || "",
          source: "direct",
          courses: []
        };
        current.courses.push(Object.assign({}, course, {
          teacherName,
          source: "direct",
          sourceType: "teacher",
          audienceType: "teacher"
        }));
        grouped.set(teacherName, current);
      });
    } catch (error) {
      errors.push({
        target,
        message: error.message
      });
      console.warn(`[resources:teacher:direct] target failed (${target.teacherName || target.collegeName || target.type}): ${error.message}`);
    }
  });
  const teacherSchedules = Array.from(grouped.values()).map((item) => Object.assign({}, item, {
    courses: dedupeCourses(item.courses)
  }));
  const resources = buildTeacherResourcesFromSchedules(teacherSchedules);
  const quality = buildDirectTeacherQualityReport(collected, targets, resources);
  const report = {
    success: errors.length < targets.length,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    semester: semester2,
    source: collected.source,
    targetCount: targets.length,
    teacherScheduleCount: resources.teacherSchedules.length,
    courseCount: resources.teacherSchedules.reduce((sum, item) => sum + (item.courses || []).length, 0),
    dom: collected.dom,
    errors: errors.slice(0, 50),
    samples,
    quality
  };
  if (quality.coverageStatus === "invalid") {
    console.warn(`[resources:teacher:direct] \u6570\u636E\u8D28\u91CF\u4E0D\u901A\u8FC7\uFF1AtargetDiscoveryMode=${quality.targetDiscoveryMode}, requestGroupCount=${quality.requestGroupCount}, scheduleDocumentCount=${quality.scheduleDocumentCount}, invalidTeacherNameCount=${quality.invalidTeacherNameCount}`);
  }
  fs.writeFileSync(path.join(debugDir, "direct-teacher-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(path.join(debugDir, "direct-teacher-schedules-latest.json"), JSON.stringify(resources.teacherSchedules, null, 2), "utf-8");
  console.log(`[resources:teacher:direct] schedules=${report.teacherScheduleCount}, courses=${report.courseCount}, errors=${errors.length}`);
  return Object.assign({}, resources, {
    _diagnostics: {
      teacherSchedules: quality
    }
  });
}
function getDirectResourceLimit() {
  return parsePositiveLimit(process.env.SYNC_DIRECT_RESOURCE_LIMIT) || parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
}
function limitDirectResourceTargets(targets) {
  const limit = getDirectResourceLimit();
  return limit ? targets.slice(0, limit) : targets;
}
function getGenericDirectResourceConfig(type) {
  if (type === "classroom") {
    return {
      pagePath: "/kbcx/kbxx_classroom",
      ifrPath: "/kbcx/kbxx_classroom_ifr",
      parse: parser.parseClassroomScheduleIfrHtml,
      targetKey: "roomName",
      schedulesKey: "classroomSchedules",
      indexKey: "classrooms",
      endpointFamily: "classroom-schedule",
      audienceType: "classroom",
      targetFromCourse: (course) => course.canonicalClassroom || course.displayClassroom || course.classroom || course.roomName || ""
    };
  }
  if (type === "course") {
    return {
      pagePath: "/kbcx/kbxx_kc",
      ifrPath: "/kbcx/kbxx_kc_ifr",
      parse: parser.parseCourseScheduleIfrHtml,
      targetKey: "courseName",
      schedulesKey: "courseSchedules",
      indexKey: "courses",
      endpointFamily: "course-schedule",
      audienceType: "course",
      targetFromCourse: (course) => course.canonicalCourseName || course.displayCourseName || course.courseName || ""
    };
  }
  return null;
}
async function collectGenericDirectResourceTargets(page, type, derivedResources, semester2) {
  const config = getGenericDirectResourceConfig(type);
  await gotoPage(page, config.pagePath, { waitUntil: "networkidle", timeout: 2e4 });
  try {
    await selectSemester(page, semester2);
  } catch (error) {
    console.warn(`[resources:${type}:direct] semester select fallback: ${error.message}`);
  }
  const html = await page.content();
  const debugDir = path.join(__dirname, ".debug");
  fs.writeFileSync(path.join(debugDir, `direct-${type}-page.html`), html, "utf-8");
  const dom = await page.evaluate((resourceType) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const optionList = (select) => Array.from(select.options || []).map((option) => ({ code: clean(option.value), name: clean(option.textContent) })).filter((option) => option.name && option.code && !/^请选择|^全部|^--/.test(option.name));
    const result = { colleges: [], campuses: [], buildings: [], courses: [], selects: [] };
    Array.from(document.querySelectorAll("select")).forEach((select) => {
      const marker = `${select.getAttribute("name") || ""} ${select.getAttribute("id") || ""}`.toLowerCase();
      const options = optionList(select);
      result.selects.push({ marker, optionCount: options.length });
      if (/skyx|college|yx|kkyx/.test(marker)) result.colleges.push(...options);
      if (/xqid|campus|xq/.test(marker)) result.campuses.push(...options);
      if (/jzwid|building|jxl|jzw/.test(marker)) result.buildings.push(...options);
      if (resourceType === "course" && /kc|course|zzdkcsx/.test(marker)) result.courses.push(...options);
    });
    return result;
  }, type);
  if (type === "classroom") {
    const buildingTargets = (dom.buildings || []).map((item) => ({
      type: "building",
      buildingId: item.code,
      buildingName: item.name
    }));
    if (buildingTargets.length) return { targets: limitDirectResourceTargets(buildingTargets), dom, source: "building-select" };
    const campusTargets = (dom.campuses || []).map((item) => ({
      type: "campus",
      campusId: item.code,
      campusName: item.name
    }));
    if (campusTargets.length) return { targets: limitDirectResourceTargets(campusTargets), dom, source: "campus-select" };
  }
  if (type === "course") {
    const courseTargets = (dom.courses || []).map((item) => ({
      type: "course",
      courseCode: item.code,
      courseName: item.name
    }));
    if (courseTargets.length) return { targets: limitDirectResourceTargets(courseTargets), dom, source: "course-select" };
  }
  const derivedTargets = (derivedResources && derivedResources[config.schedulesKey] || []).map((schedule) => String(schedule && schedule[config.targetKey] || "").trim()).filter(Boolean).filter((name, index, list) => list.indexOf(name) === index).map((name) => ({
    type: `${type}-name`,
    name,
    roomName: type === "classroom" ? name : "",
    courseName: type === "course" ? name : ""
  }));
  if (derivedTargets.length) return { targets: limitDirectResourceTargets(derivedTargets), dom, source: "derived-names" };
  const collegeTargets = (dom.colleges || []).map((item) => ({
    type: "college",
    collegeCode: item.code,
    collegeName: item.name
  }));
  if (collegeTargets.length) return { targets: limitDirectResourceTargets(collegeTargets), dom, source: "college-select" };
  return { targets: [{ type: "all" }], dom, source: "all" };
}
async function fetchGenericDirectScheduleHtml(page, type, target, semester2) {
  const config = getGenericDirectResourceConfig(type);
  return page.evaluate(async (input) => {
    const bodyData = input.type === "classroom" ? {
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      xqid: input.target.campusId || "",
      jzwid: input.target.buildingId || "",
      jsid: input.target.roomId || "",
      jsmc: input.target.roomName || input.target.name || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: ""
    } : {
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      kkyx: input.target.openCollegeCode || input.target.collegeCode || "",
      zzdKcSX: input.target.courseAttr || "",
      kc: input.target.courseCode || input.target.courseName || input.target.name || "",
      kcmc: input.target.courseName || input.target.name || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: ""
    };
    const response = await fetch(input.ifrPath, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      credentials: "include",
      body: new URLSearchParams(bodyData).toString()
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }, { type, target, semester: semester2, ifrPath: config.ifrPath });
}
function buildGenericResourcesFromSchedules(type, schedules) {
  const config = getGenericDirectResourceConfig(type);
  const key = config.targetKey;
  const scheduleList = (schedules || []).map((item) => Object.assign({}, item, {
    courses: dedupeCourses(item.courses || []),
    source: "direct"
  })).filter((item) => isUsableResourceName(item[key]));
  return Object.assign(emptySnapshotResources(), {
    [config.schedulesKey]: scheduleList,
    [config.indexKey]: scheduleList.map((item) => ({
      [key]: item[key],
      name: item[key],
      courseCount: (item.courses || []).length,
      source: "direct"
    }))
  });
}
async function crawlGenericDirectResources(type, page, derivedResources = {}, options = {}) {
  const config = getGenericDirectResourceConfig(type);
  if (!config) throw new Error(`Unsupported direct resource type: ${type}`);
  const semester2 = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const delayConfig = getResourceDelayConfig();
  const collected = await collectGenericDirectResourceTargets(page, type, derivedResources, semester2);
  const targets = collected.targets || [];
  console.log(`[resources:${type}:direct] source=${collected.source}, targets=${targets.length}, concurrency=${delayConfig.concurrency}`);
  const grouped = /* @__PURE__ */ new Map();
  const errors = [];
  const samples = [];
  await mapWithConcurrency(targets, delayConfig.concurrency, async (target, index) => {
    if (index > 0) {
      const delay = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : delayConfig.minDelayMs;
      if (delay > 0) await sleep(delay);
    }
    try {
      const response = await fetchGenericDirectScheduleHtml(page, type, target, semester2);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (samples.length < 5) {
        const sampleName = `direct-${type}-sample-${samples.length + 1}.html`;
        samples.push({ target, responseLength: response.text.length, htmlPath: sampleName });
        fs.writeFileSync(path.join(debugDir, sampleName), response.text, "utf-8");
      }
      const parsed2 = config.parse(response.text, {
        semester: semester2,
        collegeCode: target.collegeCode || "",
        collegeName: target.collegeName || ""
      });
      const courses = normalizer.normalizeCourseList(parsed2.courses || [], {
        semester: semester2,
        sourceType: type,
        audienceType: config.audienceType
      });
      courses.forEach((course) => {
        const name = config.targetFromCourse(course) || target.roomName || target.courseName || target.name || "";
        if (!isUsableResourceName(name)) return;
        const current = grouped.get(name) || { [config.targetKey]: name, name, source: "direct", courses: [] };
        current.courses.push(Object.assign({}, course, {
          source: "direct",
          sourceType: type,
          audienceType: config.audienceType
        }));
        grouped.set(name, current);
      });
    } catch (error) {
      errors.push({ target, message: error.message });
      console.warn(`[resources:${type}:direct] target failed (${target.name || target.courseName || target.roomName || target.collegeName || target.type}): ${error.message}`);
    }
  });
  const resources = buildGenericResourcesFromSchedules(type, Array.from(grouped.values()));
  const report = {
    success: errors.length < targets.length,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    semester: semester2,
    source: collected.source,
    targetCount: targets.length,
    scheduleCount: resources[config.schedulesKey].length,
    courseCount: resources[config.schedulesKey].reduce((sum, item) => sum + (item.courses || []).length, 0),
    dom: collected.dom,
    errors: errors.slice(0, 50),
    samples
  };
  fs.writeFileSync(path.join(debugDir, `direct-${type}-report-latest.json`), JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(path.join(debugDir, `direct-${type}-schedules-latest.json`), JSON.stringify(resources[config.schedulesKey], null, 2), "utf-8");
  console.log(`[resources:${type}:direct] schedules=${report.scheduleCount}, courses=${report.courseCount}, errors=${errors.length}`);
  return resources;
}
async function buildResourcesForClassSchedules(classSchedules, resourceTypes, options = {}) {
  const types = normalizeResourceTypeList(resourceTypes);
  const semester2 = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course")
  };
  const normalizedClassSchedules = (classSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
    semester: item.semester || semester2,
    sourceType: "class",
    audienceType: "student"
  }));
  const derivedResources = buildSnapshotResources(normalizedClassSchedules, includeOptions);
  const mode = getEffectiveResourceSourceMode();
  const directTypes = types.filter((type) => shouldUseDirectResource(type, types));
  if (directTypes.length === 0) {
    types.forEach((type) => {
      const config = RESOURCE_SYNC_CONFIGS[type];
      if (config) {
        recordScopeSource(config.schedulesKey, {
          sourceMode: "derived-current-run",
          endpointFamily: "class-schedule",
          requested: (derivedResources[config.schedulesKey] || []).length,
          succeeded: (derivedResources[config.schedulesKey] || []).length,
          derived: (derivedResources[config.schedulesKey] || []).length,
          hash: crypto.createHash("sha256").update(JSON.stringify(derivedResources[config.schedulesKey] || [])).digest("hex"),
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    return derivedResources;
  }
  if (!options.page) {
    if (global.CLI_PARAMS && global.CLI_PARAMS.allowDerived) {
      console.warn(`[resources] resource-source=${mode} requested but no browser page is available; falling back to derived resources because --allow-derived is set.`);
      return derivedResources;
    }
    throw new Error(`RESOURCE_DIRECT_CRAWL_REQUIRED: ${directTypes.join(",")} requested but no browser page is available.`);
  }
  let result = Object.assign({}, derivedResources);
  for (const type of directTypes) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    try {
      const directResources = type === "teacher" ? await crawlDirectTeacherResources(options.page, derivedResources, { semester: semester2 }) : await crawlGenericDirectResources(type, options.page, derivedResources, { semester: semester2 });
      if (type === "teacher") {
        result = mergeResourcesBySource(result, directResources, getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false) && mode === "derived" ? "both" : mode);
      } else {
        result = Object.assign({}, result, {
          [config.indexKey]: directResources[config.indexKey] || [],
          [config.schedulesKey]: directResources[config.schedulesKey] || []
        });
      }
      syncCacheStore.writeScheduleLatest(__dirname, semester2, config.schedulesKey, result[config.schedulesKey] || [], {
        runId: getActiveSyncPlan() && getActiveSyncPlan().runId || `resource-${Date.now()}`,
        command: global.GENERATED_COMMAND || process.argv.join(" "),
        sourceMode: "network-direct",
        endpointFamily: `${type}-schedule`,
        acquisition: "network",
        fresh: true
      });
      recordScopeSource(config.schedulesKey, {
        sourceMode: "network-direct",
        endpointFamily: `${type}-schedule`,
        requested: (result[config.schedulesKey] || []).length,
        succeeded: (result[config.schedulesKey] || []).length,
        failed: 0,
        cacheHits: 0,
        hash: crypto.createHash("sha256").update(JSON.stringify(result[config.schedulesKey] || [])).digest("hex"),
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        finishedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const diagnostic = directResources && directResources._diagnostics && directResources._diagnostics[config.schedulesKey];
      if (diagnostic) {
        recordScopeSource(config.schedulesKey, diagnostic);
      }
    } catch (error) {
      if (global.CLI_PARAMS && global.CLI_PARAMS.allowDerived) {
        console.warn(`[resources:${type}] direct crawl failed; using derived-current-run because --allow-derived is set: ${error.message}`);
        recordScopeSource(config.schedulesKey, {
          sourceMode: "derived-current-run",
          endpointFamily: "class-schedule",
          requested: (derivedResources[config.schedulesKey] || []).length,
          succeeded: (derivedResources[config.schedulesKey] || []).length,
          derived: (derivedResources[config.schedulesKey] || []).length,
          hash: crypto.createHash("sha256").update(JSON.stringify(derivedResources[config.schedulesKey] || [])).digest("hex"),
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        result[config.indexKey] = derivedResources[config.indexKey] || [];
        result[config.schedulesKey] = derivedResources[config.schedulesKey] || [];
      } else {
        throw error;
      }
    }
  }
  return result;
}
function buildResourceIncludeOptionsFromScopes(includeScopes) {
  const scopes = Array.isArray(includeScopes) ? includeScopes : [];
  return {
    includeTeachers: scopes.includes("teachers"),
    includeClassrooms: scopes.includes("classrooms"),
    includeCourses: scopes.includes("courses"),
    includeTeacherSchedules: scopes.includes("teacherSchedules"),
    includeClassroomSchedules: scopes.includes("classroomSchedules"),
    includeCourseSchedules: scopes.includes("courseSchedules")
  };
}
function getResourceTypesFromIncludeScopes(includeScopes) {
  const scopes = Array.isArray(includeScopes) ? includeScopes : [];
  const types = [];
  if (scopes.includes("teachers") || scopes.includes("teacherSchedules")) {
    types.push("teacher");
  }
  if (scopes.includes("classrooms") || scopes.includes("classroomSchedules")) {
    types.push("classroom");
  }
  if (scopes.includes("courses") || scopes.includes("courseSchedules")) {
    types.push("course");
  }
  return types;
}
function getResourceTypesForAction(action) {
  if (action === "resources") return ["teacher", "classroom", "course"];
  const typeMap = {
    teachers: "teacher",
    classrooms: "classroom",
    courses: "course"
  };
  return typeMap[action] ? [typeMap[action]] : [];
}
function buildResourceUploadId(type) {
  return `${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}
async function uploadResourceSchedules(resources, resourceTypes, semester2) {
  const results = {};
  const chunkSize = getResourceUploadChunkSize();
  const delayConfig = getResourceDelayConfig();
  const requestDelayMs = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : Math.max(0, delayConfig.minDelayMs);
  for (const type of normalizeResourceTypeList(resourceTypes)) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    const items2 = resources[config.schedulesKey] || [];
    const totalChunks = Math.max(1, Math.ceil(items2.length / chunkSize));
    const uploadId = buildResourceUploadId(type);
    console.log(`[resources] uploading ${type}: ${items2.length} items, ${chunkSize} per chunk, ${totalChunks} chunks`);
    let finalResult = null;
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkNumber = index + 1;
      const chunk = items2.slice(index * chunkSize, (index + 1) * chunkSize);
      const payload = {
        resourceType: type,
        semester: semester2,
        uploadId,
        chunkIndex: chunkNumber,
        totalChunks,
        chunkItemCount: chunk.length,
        items: chunk,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      finalResult = await uploadWithRetry(`/api/admin/sync/resources?type=${config.endpointType}`, payload, chunkNumber, totalChunks);
      if (chunkNumber < totalChunks && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }
    results[type] = Object.assign({
      resourceType: type,
      uploadId,
      chunkSize,
      totalChunks
    }, finalResult || {});
  }
  return results;
}
async function handleResourcesSync(resourceTypes, options = {}) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  if (!fs.existsSync(manifestPath)) {
    console.error("\u274C \u6CA1\u6709\u627E\u5230\u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\uFF0Csync:resources \u53EA\u80FD\u57FA\u4E8E\u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u6D3E\u751F\u8D44\u6E90\u3002\u8BF7\u5148\u8FD0\u884C npm run sync:class \u6216 npm run sync:fresh\u3002");
    throw new Error("Missing class-schedules-manifest.json");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    console.error(`\u274C \u8BFB\u53D6\u6216\u89E3\u6790\u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u5931\u8D25: ${err.message}`);
    throw err;
  }
  if (manifest.semester !== preferredSemester) {
    const allowStale = getEnvFlag("SYNC_RESOURCES_ALLOW_STALE", false);
    if (!allowStale) {
      console.error(`\u274C \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u7684\u5B66\u671F [${manifest.semester}] \u4E0E\u5F53\u524D\u914D\u7F6E\u7684 Preferred Semester [${preferredSemester}] \u4E0D\u4E00\u81F4\uFF01`);
      console.error('\u{1F4A1} \u63D0\u793A: \u5DF2\u963B\u6B62\u6267\u884C\u4EE5\u9632\u6B62\u6D3E\u751F\u9519\u8BEF\u6570\u636E\u3002\u5982\u679C\u60A8\u786E\u5B9E\u9700\u8981\uFF0C\u8BF7\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF: $env:SYNC_RESOURCES_ALLOW_STALE="true"\u3002');
      throw new Error("Semester mismatch in manifest");
    } else {
      console.warn(`\u26A0\uFE0F \u8B66\u544A: \u73ED\u7EA7\u8BFE\u8868\u5B66\u671F [${manifest.semester}] \u4E0E\u914D\u7F6E\u7684 [${preferredSemester}] \u4E0D\u4E00\u81F4\uFF0C\u4F46\u5DF2\u8BBE\u7F6E SYNC_RESOURCES_ALLOW_STALE=true\uFF0C\u5C06\u7EE7\u7EED\u6267\u884C\u3002`);
    }
  }
  const crawledTime = new Date(manifest.crawledAt).getTime();
  const nowTime = Date.now();
  const diffHours = (nowTime - crawledTime) / (1e3 * 60 * 60);
  if (diffHours > 24) {
    console.warn(`\u26A0\uFE0F \u5F3A\u8B66\u544A: \u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u751F\u6210\u65F6\u95F4 [${manifest.crawledAt}] \u8DDD\u4ECA\u5DF2\u8D85\u8FC7 ${diffHours.toFixed(1)} \u5C0F\u65F6\uFF0C\u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u53EF\u80FD\u4E0D\u662F\u6700\u65B0\u6570\u636E\u3002`);
  }
  const requireFresh = getEnvFlag("SYNC_RESOURCES_REQUIRE_FRESH", false);
  if (requireFresh && diffHours > 6) {
    console.error(`\u274C \u672C\u5730\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u5DF2\u8FC7\u671F\uFF01\u751F\u6210\u65F6\u95F4\u8DDD\u4ECA\u5DF2\u8D85\u8FC7 6 \u5C0F\u65F6 (${diffHours.toFixed(1)} \u5C0F\u65F6)\uFF0C\u4E14\u8BBE\u7F6E\u4E86 SYNC_RESOURCES_REQUIRE_FRESH=true\u3002`);
    throw new Error("Class schedules cache is stale (exceeded 6 hours)");
  }
  const { items: items2, filePath } = readClassSchedulesFromFile();
  let fileMtime = "\u672A\u77E5";
  try {
    const stat = fs.statSync(filePath);
    fileMtime = stat.mtime.toISOString();
  } catch (e2) {
  }
  console.log("\n=================== [sync:resources \u5F00\u59CB\u6D3E\u751F\u8D44\u6E90] ===================");
  console.log(`- \u5F53\u524D\u8BFB\u53D6\u7684 class-schedules-latest.json \u8DEF\u5F84: ${filePath}`);
  console.log(`- \u8BE5\u6587\u4EF6\u5B9E\u9645\u4FEE\u6539\u65F6\u95F4 (mtime): ${fileMtime}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u5B66\u671F (manifest semester): ${manifest.semester}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u751F\u6210\u65F6\u95F4 (manifest crawledAt): ${manifest.crawledAt}`);
  console.log(`- \u6293\u53D6\u6E05\u5355\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF (classScheduleCount): ${manifest.classScheduleCount || items2.length}`);
  console.log(`- resourceSource: ${getEffectiveResourceSourceMode()}${shouldUseDirectTeacherResources(resourceTypes) ? " (teacher direct crawl enabled)" : " (derived from class schedules)"}`);
  console.log(shouldUseDirectTeacherResources(resourceTypes) ? "- \u8BF4\u660E\uFF1A\u6559\u5E08\u8D44\u6E90\u4F1A\u8BBF\u95EE\u6559\u52A1 100 \u7F51\u76F4\u6293 teacher endpoint\uFF0C\u6559\u5BA4/\u8BFE\u7A0B\u4ECD\u57FA\u4E8E\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u6D3E\u751F\u3002" : "- \u8BF4\u660E\uFF1A\u6B64\u547D\u4EE4\u4E0D\u4F1A\u8BBF\u95EE\u6559\u52A1 100 \u7F51\uFF0C\u53EA\u4F1A\u57FA\u4E8E\u521A\u624D\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u7F13\u5B58\u6D3E\u751F\u6559\u5E08/\u6559\u5BA4/\u8BFE\u7A0B\u7EF4\u5EA6\u3002");
  console.log("===================================================================\n");
  const types = normalizeResourceTypeList(resourceTypes);
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course")
  };
  const semester2 = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const resources = await buildResourcesForClassSchedules(items2, types, {
    page: options.page,
    semester: semester2
  });
  const resourcesPath = path.join(debugDir, "resources-latest.json");
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), "utf-8");
  const uploadResults = await uploadResourceSchedules(resources, types, semester2);
  types.forEach((type) => {
    const config = RESOURCE_SYNC_CONFIGS[type];
    fs.writeFileSync(
      path.join(debugDir, `${type}-schedules-latest.json`),
      JSON.stringify({
        resourceType: type,
        semester: semester2,
        items: resources[config.schedulesKey] || []
      }, null, 2),
      "utf-8"
    );
  });
  const report = {
    success: true,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceFile: filePath,
    resourceTypes: types,
    resourceRequestPolicy: getResourceDelayConfig(),
    flags: {
      SYNC_RESOURCES_TEACHERS: includeOptions.includeTeachers,
      SYNC_RESOURCES_CLASSROOMS: includeOptions.includeClassrooms,
      SYNC_RESOURCES_COURSES: includeOptions.includeCourses,
      SYNC_RESOURCE_LIMIT: parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT),
      SYNC_RESOURCE_SOURCE: getEffectiveResourceSourceMode(),
      SYNC_FORCE_RESOURCE_CRAWL: getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false)
    },
    counts: {
      teachers: resources.teachers.length,
      classrooms: resources.classrooms.length,
      courses: resources.courses.length,
      teacherSchedules: resources.teacherSchedules.length,
      classroomSchedules: resources.classroomSchedules.length,
      courseSchedules: resources.courseSchedules.length
    },
    uploadResults
  };
  fs.writeFileSync(path.join(debugDir, "resources-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u8D44\u6E90\u7EF4\u5EA6\u6570\u636E\u5DF2\u751F\u6210: ${resourcesPath}`);
  console.log(`\u{1F4CA} resources counts: ${JSON.stringify(report.counts)}`);
  let resourcesChecksum = "";
  try {
    const fileContent = fs.readFileSync(resourcesPath, "utf-8");
    resourcesChecksum = crypto.createHash("md5").update(fileContent).digest("hex");
  } catch (e2) {
  }
  const resourcesManifest = {
    semester: semester2,
    generatedAt: report.generatedAt,
    source: path.basename(filePath),
    teacherScheduleCount: resources.teacherSchedules.length,
    classroomScheduleCount: resources.classroomSchedules.length,
    courseScheduleCount: resources.courseSchedules.length,
    checksum: resourcesChecksum
  };
  const resourcesManifestPath = path.join(debugDir, "resources-manifest.json");
  fs.writeFileSync(resourcesManifestPath, JSON.stringify(resourcesManifest, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u8D44\u6E90\u7EF4\u5EA6\u6E05\u5355\u5DF2\u4FDD\u5B58\u81F3: ${resourcesManifestPath}`);
  return resources;
}
async function initBrowserContext() {
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--no-proxy-server"
  ];
  let browser;
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false,
        // 设为 false 以确保与系统通道的最大兼容性，并且能够直观展示同步过程
        args: launchArgs
      };
      if (channel) {
        config.channel = channel;
        console.log(`\u5C1D\u8BD5\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u901A\u9053: ${channel} ...`);
      } else {
        console.log("\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668 ...");
      }
      browser = await chromium.launch(config);
      break;
    } catch (e2) {
      console.warn(`\u26A0\uFE0F \u6D4F\u89C8\u5668\u901A\u9053 ${channel || "\u5185\u7F6E"} \u542F\u52A8\u5931\u8D25: ${e2.message}`);
      if (channel === null) {
        console.error("\n\u{1F4A1} \u63D0\u793A: \u5982\u679C\u60A8\u60F3\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668\uFF0C\u8BF7\u5148\u8FD0\u884C\u4EE5\u4E0B\u547D\u4EE4\u5B89\u88C5\uFF1A");
        console.error("   npx playwright install chromium");
      }
    }
  }
  if (!browser) {
    console.error("\u274C \u65E0\u6CD5\u542F\u52A8\u4EFB\u4F55\u6D4F\u89C8\u5668\uFF01\u8BF7\u68C0\u67E5 Playwright \u5B89\u88C5\u662F\u5426\u5B8C\u6574\u3002");
    process.exit(1);
  }
  let context;
  if (FOSU_SYNC_AUTH_MODE === "playwright-manual") {
    if (!fs.existsSync(SESSION_PATH)) {
      console.error("\u274C \u672C\u5730\u672A\u627E\u5230 session.json \u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\uFF01");
      console.error(getExpiredSessionTip());
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      storageState: SESSION_PATH,
      ignoreHTTPSErrors: true
    });
  } else if (FOSU_SYNC_AUTH_MODE === "manual-cookie") {
    if (!process.env.FOSU_MANUAL_COOKIE) {
      console.error("\u274C \u9009\u62E9\u4E86 manual-cookie \u6A21\u5F0F\uFF0C\u4F46\u672A\u5728 .env \u4E2D\u914D\u7F6E FOSU_MANUAL_COOKIE\uFF01");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true
    });
    const cookies = parseCookieString(process.env.FOSU_MANUAL_COOKIE, FOSU_BASE_URL);
    await context.addCookies(cookies);
    console.log(`\u{1F511} \u5DF2\u4ECE .env \u4E2D\u6CE8\u5165 ${cookies.length} \u4E2A Cookie \u81F3\u6D4F\u89C8\u5668\u4F1A\u8BDD\u3002`);
  } else {
    console.error(`\u274C \u672A\u77E5\u7684\u767B\u5F55\u6A21\u5F0F: ${FOSU_SYNC_AUTH_MODE}`);
    await browser.close();
    process.exit(1);
  }
  return { browser, context };
}
function getExpiredSessionTip() {
  const invocationCwd = path.resolve(process.env.INIT_CWD || process.cwd());
  const isProjectRoot = invocationCwd === PROJECT_ROOT;
  const rootPackageJson = path.join(PROJECT_ROOT, "package.json");
  const hasRootLoginScript = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPackageJson, "utf-8"));
      return Boolean(pkg.scripts && pkg.scripts.login);
    } catch (error) {
      return false;
    }
  })();
  const lines = [
    "\u8BF7\u5728\u9879\u76EE\u6839\u76EE\u5F55\u6267\u884C npm run login\uFF0C\u767B\u5F55\u6210\u529F\u540E\u91CD\u65B0\u8FD0\u884C\u5F53\u524D\u540C\u6B65\u547D\u4EE4\u3002"
  ];
  if (!isProjectRoot) {
    lines.push("\u4F60\u53EF\u80FD\u4E0D\u5728\u9879\u76EE\u6839\u76EE\u5F55\uFF0C\u8BF7\u5148 cd \u5230 FosuClass \u6839\u76EE\u5F55\u3002");
  }
  if (!hasRootLoginScript) {
    lines.push("\u5F53\u524D\u6839\u76EE\u5F55 package.json \u672A\u68C0\u6D4B\u5230 login script\uFF0C\u8BF7\u8865\u5145\u540E\u518D\u91CD\u8BD5\u3002");
  }
  return lines.join("\n");
}
async function checkSession(page) {
  console.log("\u{1F512} \u6B63\u5728\u6821\u9A8C\u4F1A\u8BDD\u6709\u6548\u6027...");
  try {
    await gotoPage(page, "/framework/xsMain.jsp", { waitUntil: "networkidle" });
  } catch (error) {
    console.error(`\u274C \u5BFC\u822A\u81F3\u6559\u52A1\u9875\u5931\u8D25\uFF0C\u53EF\u80FD\u672A\u8FDE\u5185\u7F51\u6216\u63E1\u624B\u5F7B\u5E95\u5931\u8D25: ${error.message}`);
    console.error(getExpiredSessionTip());
    return false;
  }
  const currentUrl = page.url();
  if (currentUrl.includes("authserver.fosu.edu.cn") || currentUrl.includes("login")) {
    console.error("\u274C \u4F1A\u8BDD\u5DF2\u8FC7\u671F\u6216\u65E0\u6548\uFF01\u88AB\u91CD\u5B9A\u5411\u5230\u4E86\u767B\u5F55\u9875\u9762\u3002");
    console.error(getExpiredSessionTip());
    return false;
  }
  const content = await page.content();
  if (content.includes("\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1") || content.includes("\u5BC6\u7801\u767B\u5F55")) {
    console.error("\u274C \u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF01\u9875\u9762\u5305\u542B\u767B\u5F55\u6807\u8BC6\u3002");
    console.error(getExpiredSessionTip());
    return false;
  }
  console.log("\u{1F389} \u4F1A\u8BDD\u6709\u6548\uFF0C\u6559\u52A1\u7CFB\u7EDF\u4E3B\u9875\u52A0\u8F7D\u6B63\u5E38\u3002");
  return true;
}
function inferPreferredSemester() {
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 1 && month <= 8) {
    return `${year - 1}-${year}-2`;
  } else {
    return `${year}-${year}-1`;
  }
}
async function selectSemester(page, preferredSemester) {
  if (!preferredSemester) {
    return null;
  }
  console.log(`\u914D\u7F6E\u5B66\u671F\uFF1A${preferredSemester}`);
  const selectResult = await page.evaluate((prefSem) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (let sIdx = 0; sIdx < selects.length; sIdx++) {
      const sel = selects[sIdx];
      const name = sel.getAttribute("name") || "";
      const id = sel.getAttribute("id") || "";
      for (let oIdx = 0; oIdx < sel.options.length; oIdx++) {
        const opt = sel.options[oIdx];
        const val = opt.value || "";
        const txt = opt.textContent || "";
        if (val.includes(prefSem) || txt.includes(prefSem)) {
          return {
            selectIndex: sIdx,
            selectName: name,
            selectId: id,
            optionValue: val,
            optionText: txt.trim()
          };
        }
      }
    }
    return null;
  }, preferredSemester);
  if (!selectResult) {
    const allSemOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const debugInfo = [];
      selects.forEach((sel) => {
        const name = sel.getAttribute("name") || sel.getAttribute("id") || "unnamed";
        if (/xnxq/i.test(name)) {
          const opts = Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent.trim() }));
          debugInfo.push({ name, opts });
        }
      });
      return debugInfo;
    });
    console.error(`\u274C \u65E0\u6CD5\u5728\u6559\u52A1\u7CFB\u7EDF\u4E2D\u5339\u914D\u5230\u76EE\u6807\u5B66\u671F: ${preferredSemester}`);
    if (allSemOptions.length > 0) {
      console.error("\u6559\u52A1\u7CFB\u7EDF\u4E2D\u5B66\u671F\u4E0B\u62C9\u6846\u7684\u53EF\u9009\u503C\u5982\u4E0B\uFF1A");
      allSemOptions.forEach((sel) => {
        sel.opts.forEach((opt) => {
          console.error(`  - \u503C: ${opt.value}, \u6587\u672C: ${opt.text}`);
        });
      });
    }
    throw new Error(`\u672A\u627E\u5230\u5339\u914D\u7684\u5B66\u671F: ${preferredSemester}`);
  }
  let selector = "";
  if (selectResult.selectName) {
    selector = `select[name="${selectResult.selectName}"]`;
  } else if (selectResult.selectId) {
    selector = `select[id="${selectResult.selectId}"]`;
  } else {
    selector = `select:nth-of-type(${selectResult.selectIndex + 1})`;
  }
  console.log(`\u9875\u9762\u5339\u914D\u5B66\u671F\uFF1A${selectResult.optionText}`);
  await page.selectOption(selector, selectResult.optionValue);
  await page.waitForTimeout(1500);
  const finalValue = await page.$eval(selector, (el) => el.value);
  if (!finalValue.includes(preferredSemester)) {
    throw new Error(`\u9009\u62E9\u5B66\u671F\u540E\u6821\u9A8C\u5931\u8D25\uFF1A\u6700\u7EC8\u9009\u4E2D\u7684\u503C ${finalValue} \u4E0E\u671F\u671B\u503C ${preferredSemester} \u4E0D\u5339\u914D\uFF01`);
  }
  console.log(`\u6700\u7EC8\u4F7F\u7528\u5B66\u671F\uFF1A${preferredSemester}`);
  return {
    value: selectResult.optionValue,
    label: selectResult.optionText
  };
}
function getCollegeSlug(collegeName2) {
  const map = {
    "\u4EBA\u6587": "human",
    "\u4F20": "college",
    "\u52A8\u7269": "animal",
    "\u52A8\u79D1": "animal",
    "\u751F\u547D": "life",
    "\u5546": "business",
    "\u6CD5": "law",
    "\u533B": "medical",
    "\u5DE5": "engineering",
    "\u7406": "science",
    "\u6750\u6599": "materials",
    "\u7535\u4FE1": "telecom",
    "\u673A\u7535": "mechatronic",
    "\u8BA1\u7B97\u673A": "computer",
    "\u6570\u5B66": "math",
    "\u7269\u7406": "physics",
    "\u5316\u5B66": "chemistry",
    "\u73AF\u5883": "env",
    "\u571F\u6728": "civil",
    "\u98DF\u54C1": "food",
    "\u8BBE\u8BA1": "design",
    "\u827A\u672F": "art",
    "\u4F53\u80B2": "sports",
    "\u9A6C\u514B\u601D": "marx",
    "\u56FD\u9645": "intl",
    "\u7EE7\u6559": "continue"
  };
  let slug = "college";
  for (const [key, val] of Object.entries(map)) {
    if (collegeName2.includes(key)) {
      slug = val;
      break;
    }
  }
  return slug;
}
var savedSampleCount = 0;
function saveMajorResponseSample(rawText, meta2, parsedCount, emptyNameCount) {
  if (savedSampleCount >= 3) return;
  savedSampleCount++;
  const sampleDir = path.join(__dirname, ".debug", "major-response-samples");
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }
  const slug = getCollegeSlug(meta2.collegeName);
  const safeName = `${meta2.collegeCode}-${meta2.grade}-${slug}-college`;
  const rawPath = path.join(sampleDir, `${safeName}.raw.txt`);
  const metaPath = path.join(sampleDir, `${safeName}.meta.json`);
  let sanitizedRaw = rawText;
  sanitizedRaw = sanitizedRaw.replace(/JSESSIONID=[a-zA-Z0-9.\-_]+/gi, "JSESSIONID=REDACTED");
  sanitizedRaw = sanitizedRaw.replace(/cookie/gi, "REDACTED");
  fs.writeFileSync(rawPath, sanitizedRaw, "utf-8");
  const metaData = {
    collegeCode: meta2.collegeCode,
    collegeName: meta2.collegeName,
    grade: meta2.grade,
    semester: meta2.semester,
    requestUrl: meta2.requestUrl,
    method: meta2.method || "GET",
    status: meta2.status || 200,
    contentType: meta2.contentType || (rawText.trim().startsWith("<") ? "text/html" : "application/json"),
    rawLength: rawText.length,
    parsedCount,
    emptyNameCount
  };
  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
  console.log(`\u{1F4BE} \u5DF2\u4FDD\u5B58\u539F\u59CB\u54CD\u5E94\u6837\u672C\u53CA\u5143\u6570\u636E\u81F3: ${rawPath}`);
}
function parseMajorOptionsFromResponse(raw, meta) {
  if (!raw) return [];
  const { collegeCode = "", collegeName = "", grade = "", semester = "", requestUrl = "" } = meta || {};
  const rawStr = String(raw).trim();
  const items = [];
  const formatItem = (codeVal, nameVal) => {
    const code = typeof codeVal === "string" ? codeVal.trim() : codeVal ? String(codeVal).trim() : "";
    const name = typeof nameVal === "string" ? nameVal.trim() : nameVal ? String(nameVal).trim() : "";
    if (!code && !name) return null;
    return {
      code,
      name,
      majorCode: code,
      majorName: name,
      rawLabel: name,
      collegeCode,
      collegeName,
      grade,
      semester
    };
  };
  try {
    let parsed = null;
    if (rawStr.startsWith("[") || rawStr.startsWith("{")) {
      parsed = JSON.parse(rawStr);
    } else {
      const jsonRegex = /\[\s*\{[\s\S]*\}\s*\]/;
      const match = rawStr.match(jsonRegex);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          try {
            parsed = eval(`(${match[0]})`);
          } catch (evalErr) {
          }
        }
      }
    }
    if (parsed) {
      const list = Array.isArray(parsed) ? parsed : parsed.rows || parsed.data || parsed.list || parsed.majors || parsed.items || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item) continue;
          const codeVal = item.majorCode || item.code || item.value || item.id || item.dm || item.DM || item.zyh || item.ZYH || item.bh || item.BH;
          const nameVal = item.majorName || item.name || item.label || item.text || item.mc || item.MC || item.zymc || item.ZYMC || item.dmmc || item.DMMC || item.title;
          const formatted = formatItem(codeVal, nameVal);
          if (formatted) items.push(formatted);
        }
      }
    }
  } catch (jsonErr) {
  }
  if (items.length === 0) {
    try {
      const $ = cheerio.load(rawStr, { decodeEntities: false });
      $("option").each((_, el) => {
        const val = $(el).val() || $(el).attr("value") || "";
        const text = $(el).text().trim();
        if (val) {
          const formatted = formatItem(val, text);
          if (formatted) items.push(formatted);
        }
      });
    } catch (htmlErr) {
    }
  }
  if (items.length === 0) {
    const optionRegex = /<option\s+[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match2;
    while ((match2 = optionRegex.exec(rawStr)) !== null) {
      const val = match2[1];
      const text = match2[2].replace(/<[^>]+>/g, "").trim();
      if (val) {
        const formatted = formatItem(val, text);
        if (formatted) items.push(formatted);
      }
    }
  }
  return items;
}
function normalizeMajorItem(item) {
  const majorCodeRaw = item.majorCode || item.code || item.value;
  const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;
  const majorName = typeof majorNameRaw === "string" ? majorNameRaw.trim() : majorNameRaw ? String(majorNameRaw).trim() : "";
  let majorCode = typeof majorCodeRaw === "string" ? majorCodeRaw.trim() : majorCodeRaw ? String(majorCodeRaw).trim() : "";
  if (!majorCode && !majorName) {
    return { status: "drop_empty", item };
  }
  if (!majorName) {
    return { status: "drop_empty", item };
  }
  const placeholders = ["\u8BF7\u9009\u62E9", "\u5168\u90E8", "\u5168\u90E8\u4E13\u4E1A", "--\u8BF7\u9009\u62E9--", "\u8BF7\u9009\u62E9\u4E13\u4E1A"];
  if (placeholders.includes(majorName)) {
    return { status: "drop_placeholder", item };
  }
  let generated = false;
  if (!majorCode) {
    majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
    generated = true;
  }
  return {
    status: "keep",
    generated,
    normalized: {
      code: majorCode,
      name: majorName,
      majorCode,
      majorName,
      collegeCode: item.collegeCode,
      grade: item.grade
    }
  };
}
function cleanMajorsPayload(rawItems) {
  const cleaned = [];
  const droppedEmpty = [];
  const droppedPlaceholder = [];
  let generatedCount = 0;
  for (const item of rawItems) {
    const res = normalizeMajorItem(item);
    if (res.status === "keep") {
      cleaned.push(res.normalized);
      if (res.generated) {
        generatedCount++;
      }
    } else if (res.status === "drop_empty") {
      droppedEmpty.push(res.item);
    } else if (res.status === "drop_placeholder") {
      droppedPlaceholder.push(res.item);
    }
  }
  return {
    cleaned,
    droppedEmpty,
    droppedPlaceholder,
    generatedCount
  };
}
async function syncCatalog(page) {
  console.log("\n=== [\u6B65\u9AA4 1] \u5F00\u59CB\u6293\u53D6 Catalog ===");
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  html = await page.content();
  $ = cheerio.load(html);
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });
  const matchedOption = semesters.find((s) => s.value === semResult.value) || semResult;
  const reorderedSemesters = [
    matchedOption,
    ...semesters.filter((s) => s.value !== matchedOption.value)
  ];
  const collegeMap = /* @__PURE__ */ new Map();
  function addCollegesFromSelect(selectHtml) {
    const $select = cheerio.load(selectHtml);
    $select("select[name='skyx'] option").each((_, el) => {
      const val = $select(el).attr("value");
      const text = $select(el).text().trim();
      if (val && !text.includes("\u8BF7\u9009\u62E9") && !text.includes("\u5168\u90E8")) {
        const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
        if (!collegeMap.has(val)) {
          collegeMap.set(val, { code: val, name: cleanName, rawLabel: text });
        }
      }
    });
  }
  addCollegesFromSelect(html);
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("\u9009\u62E9")) {
      grades.push(val);
    }
  });
  const extraPages = [
    { name: "\u6559\u5E08\u8BFE\u8868", path: "/kbcx/kbxx_teacher" },
    { name: "\u6559\u5BA4\u8BFE\u8868", path: "/kbcx/kbxx_classroom" },
    { name: "\u8BFE\u7A0B\u8BFE\u8868", path: "/kbcx/kbxx_kc" }
  ];
  for (const item of extraPages) {
    try {
      console.log(`   \u6B63\u5728\u8BBF\u95EE ${item.name} (${item.path}) \u8865\u5145\u9662\u7CFB\u9009\u9879...`);
      await gotoPage(page, item.path, { waitUntil: "networkidle" });
      const pageHtml = await page.content();
      addCollegesFromSelect(pageHtml);
    } catch (e2) {
      console.warn(`   \u26A0\uFE0F \u8865\u5145\u8BBF\u95EE ${item.name} \u5931\u8D25: ${e2.message} (\u5C06\u5FFD\u7565\u5E76\u7EE7\u7EED)`);
    }
  }
  const colleges = Array.from(collegeMap.values());
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    value: String(i + 1),
    label: `\u7B2C${i + 1}\u5468`
  }));
  const catalogPayload = {
    colleges,
    semesters: reorderedSemesters,
    grades,
    weeks,
    sections: []
  };
  console.log(`\u{1F4CA} \u6293\u53D6\u5B8C\u6BD5: \u5B66\u9662 ${colleges.length} \u4E2A, \u5B66\u671F ${reorderedSemesters.length} \u4E2A, \u5E74\u7EA7 ${grades.length} \u4E2A`);
  await uploadToVps("/api/admin/sync/catalog", catalogPayload);
  fs.writeFileSync(path.join(__dirname, "last-catalog.json"), JSON.stringify(catalogPayload, null, 2), "utf-8");
  const catalogTerm = process.env.PREFERRED_SEMESTER || catalogPayload.semesters && catalogPayload.semesters[0] && catalogPayload.semesters[0].value || inferPreferredSemester();
  const catalogCacheDir = path.join(syncCacheStore.ensureTermCache(__dirname, catalogTerm), "catalog");
  syncCacheStore.writeJsonAtomic(path.join(catalogCacheDir, "catalog.json"), catalogPayload);
  syncCacheStore.writeJsonAtomic(path.join(catalogCacheDir, "metadata.json"), syncCacheStore.buildMetadata({
    term: catalogTerm,
    scope: "catalog",
    sourceMode: "network-direct",
    endpointFamily: "catalog",
    acquisition: "network",
    command: global.GENERATED_COMMAND || process.argv.join(" "),
    runId: getActiveSyncPlan() && getActiveSyncPlan().runId || "",
    itemCount: (catalogPayload.colleges || []).length,
    items: catalogPayload
  }));
  console.log("\u{1F4BE} Catalog \u4E34\u65F6\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3\u672C\u5730 last-catalog.json");
  return catalogPayload;
}
function getActiveGradesBySemester(semester2, options = {}) {
  const { originalGrades = [], activeGradeCount = 5 } = options;
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || "active";
  const syncGradesEnv = process.env.SYNC_GRADES;
  const confirmFullSync = process.env.CONFIRM_FULL_SYNC === "true";
  const match2 = semester2.match(/^(\d{4})/);
  if (!match2) {
    throw new Error(`\u65E0\u6CD5\u4ECE\u5B66\u671F\u6807\u8BC6 "${semester2}" \u4E2D\u63D0\u53D6\u5B66\u5E74\u8D77\u59CB\u5E74\u4EFD\uFF0C\u8BF7\u68C0\u67E5\u5B66\u671F\u683C\u5F0F\u3002`);
  }
  const startYear = parseInt(match2[1], 10);
  let targetGrades = [];
  if (gradeRangeEnv === "active") {
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === "recent4") {
    for (let i = 3; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === "custom") {
    if (!syncGradesEnv) {
      throw new Error("\u68C0\u6D4B\u5230 SYNC_GRADE_RANGE=custom\uFF0C\u4F46\u672A\u8BBE\u7F6E SYNC_GRADES \u73AF\u5883\u53D8\u91CF\u3002");
    }
    targetGrades = syncGradesEnv.split(",").map((g) => g.trim()).filter(Boolean);
  } else if (gradeRangeEnv === "all") {
    if (!confirmFullSync) {
      console.error("\u274C \u68C0\u6D4B\u5230 SYNC_GRADE_RANGE=all\uFF0C\u4F46\u672A\u8BBE\u7F6E CONFIRM_FULL_SYNC=true\u3002\u4E3A\u907F\u514D\u540C\u6B65\u8FC7\u591A\u5386\u53F2\u5E74\u7EA7\uFF0C\u5DF2\u4E2D\u6B62\u3002");
      process.exit(1);
    }
    return originalGrades;
  } else {
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  }
  return originalGrades.filter((g) => targetGrades.includes(g));
}
async function syncMajors(page, catalog) {
  console.log("\n=== [\u6B65\u9AA4 2] \u5F00\u59CB\u6293\u53D6 Majors \u4E13\u4E1A\u8054\u52A8 ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Catalog \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:catalog");
      return;
    }
  }
  const { colleges, grades } = catalog;
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  const activeSemester = preferredSemester;
  const startYear = parseInt(activeSemester.match(/^(\d{4})/)?.[1] || "2025", 10);
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || "active";
  let filteredGrades = [];
  try {
    filteredGrades = getActiveGradesBySemester(activeSemester, { originalGrades: grades });
  } catch (err) {
    console.error(`\u274C \u5E74\u7EA7\u8FC7\u6EE4\u5931\u8D25: ${err.message}`);
    process.exit(1);
  }
  console.log(`\u5F53\u524D\u5B66\u671F\uFF1A${activeSemester}`);
  console.log(`\u5B66\u5E74\u8D77\u59CB\u5E74\u4EFD\uFF1A${startYear}`);
  console.log(`\u5E74\u7EA7\u8FC7\u6EE4\u6A21\u5F0F\uFF1A${gradeRangeEnv}`);
  console.log(`\u672C\u6B21\u540C\u6B65\u5E74\u7EA7\uFF1A${filteredGrades.join(", ")}`);
  console.log(`\u539F\u59CB\u5E74\u7EA7\u6570\u91CF\uFF1A${grades.length}`);
  console.log(`\u8FC7\u6EE4\u540E\u5E74\u7EA7\u6570\u91CF\uFF1A${filteredGrades.length}`);
  console.log(`\u672C\u6B21\u8054\u52A8\u8BF7\u6C42\u6570\uFF1A${colleges.length} \xD7 ${filteredGrades.length} = ${colleges.length * filteredGrades.length}`);
  const allMajors = [];
  let count = 0;
  for (const college of colleges) {
    for (const grade2 of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] \u6293\u53D6\u4E2D: ${college.name} - ${grade2}\u7EA7 ...`);
      let responseText = "";
      let success = false;
      let dropdownHtml = "";
      try {
        responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade: grade2 });
        success = true;
      } catch (ajaxErr) {
        console.warn(`      \u26A0\uFE0F  Ajax \u6293\u53D6\u4E13\u4E1A\u5931\u8D25 (${ajaxErr.message})\uFF0C\u5C1D\u8BD5\u4F7F\u7528 DOM \u8054\u52A8 Fallback...`);
      }
      let majors = [];
      if (success && responseText) {
        try {
          majors = parseMajorOptionsFromResponse(responseText, {
            collegeCode: college.code,
            collegeName: college.name,
            grade: grade2,
            semester: activeSemester,
            requestUrl: `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade2}`
          });
        } catch (e2) {
          console.warn(`      \u26A0\uFE0F  Ajax \u54CD\u5E94\u89E3\u6790\u5931\u8D25: ${e2.message}\uFF0C\u5C06\u5C1D\u8BD5 DOM Fallback...`);
          success = false;
        }
      }
      if (!success || majors.length === 0) {
        try {
          await page.selectOption("select[name='skyx']", college.code);
          await page.selectOption("select[name='sknj']", grade2);
          await page.waitForTimeout(800);
          dropdownHtml = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            return sel ? sel.outerHTML : "";
          });
          if (dropdownHtml) {
            majors = parseMajorOptionsFromResponse(dropdownHtml, {
              collegeCode: college.code,
              collegeName: college.name,
              grade: grade2,
              semester: activeSemester,
              requestUrl: "DOM_SELECT_skzy"
            });
          }
        } catch (domErr) {
          console.error(`      \u274C DOM \u8054\u52A8 Fallback \u4E5F\u5F7B\u5E95\u5931\u8D25: ${domErr.message}`);
        }
      }
      if (majors.length > 0) {
        const rawCount = majors.length;
        const emptyNameCount = majors.filter((m) => !String(m.name || m.majorName || m.rawLabel || "").trim()).length;
        const validCount = rawCount - emptyNameCount;
        console.log(`      \u539F\u59CB\u9009\u9879\u6570\uFF1A${rawCount}`);
        console.log(`      \u6709\u6548\u4E13\u4E1A\u6570\uFF1A${validCount}`);
        console.log(`      \u7A7A\u540D\u79F0\u6570\uFF1A${emptyNameCount}`);
        if (emptyNameCount === rawCount) {
          console.warn(`      \u26A0\uFE0F \u4E25\u91CD\u8B66\u544A\uFF1A\u672C\u6B21\u8054\u52A8\u53EA\u89E3\u6790\u5230\u4E13\u4E1A code\uFF0C\u6CA1\u6709\u89E3\u6790\u5230\u4E13\u4E1A\u540D\u79F0\uFF0C\u8BF7\u68C0\u67E5 parser \u6216 raw response \u6837\u672C\u3002`);
        }
        if (savedSampleCount < 3) {
          saveMajorResponseSample(
            responseText || dropdownHtml,
            {
              collegeCode: college.code,
              collegeName: college.name,
              grade: grade2,
              semester: activeSemester,
              requestUrl: responseText ? `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade2}` : "DOM_SELECT_skzy",
              method: responseText ? "GET" : "DOM_INTERACTION",
              status: 200,
              contentType: responseText ? responseText.trim().startsWith("<") ? "text/html" : "application/json" : "text/html"
            },
            rawCount,
            emptyNameCount
          );
        }
        allMajors.push(...majors);
      } else {
        console.log(`      \u6CA1\u6709\u4E13\u4E1A\u6570\u636E\u3002`);
      }
      await sleep(300);
    }
  }
  console.log(`\u{1F4CA} \u4E13\u4E1A\u8054\u52A8\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5171\u6574\u7406\u51FA ${allMajors.length} \u4E2A\u539F\u59CB\u4E13\u4E1A\u6570\u636E\u3002`);
  const { cleaned, droppedEmpty, droppedPlaceholder, generatedCount } = cleanMajorsPayload(allMajors);
  const sampleDroppedItems = [...droppedEmpty, ...droppedPlaceholder].slice(0, 10);
  console.log("\n\u{1F9F9} === [\u4E13\u4E1A\u6E05\u6D17\u6570\u636E\u7EDF\u8BA1] ===");
  console.log(`- rawMajorsCount: ${allMajors.length}`);
  console.log(`- cleanedMajorsCount: ${cleaned.length}`);
  console.log(`- droppedEmptyNameCount: ${droppedEmpty.length}`);
  console.log(`- droppedPlaceholderCount: ${droppedPlaceholder.length}`);
  console.log(`- generatedMajorCodeCount: ${generatedCount}`);
  console.log(`- sampleDroppedItems (\u524D 10 \u6761):`, JSON.stringify(sampleDroppedItems, null, 2));
  console.log("=============================\n");
  if (cleaned.length === 0) {
    console.error(`\u274C \u6CA1\u6709\u6709\u6548\u4E13\u4E1A\u6570\u636E\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002`);
    console.error(`\u8BF7\u68C0\u67E5\uFF1A`);
    console.error(`1. \u5F53\u524D\u5B66\u671F\u662F\u5426\u6B63\u786E\u3002`);
    console.error(`2. major-response-samples \u4E2D\u7684 raw \u54CD\u5E94\u683C\u5F0F\u3002`);
    console.error(`3. parseMajorOptionsFromResponse \u662F\u5426\u6B63\u786E\u89E3\u6790 option text / JSON name \u5B57\u6BB5\u3002`);
    throw new Error("\u6CA1\u6709\u6709\u6548\u4E13\u4E1A\u6570\u636E\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002");
  }
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  fs.writeFileSync(path.join(debugDir, "last-majors-raw.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(cleaned, null, 2), "utf-8");
  const payloadStr = JSON.stringify(cleaned);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  const collegeCodes = new Set(cleaned.map((m) => m.collegeCode));
  const majorGrades = new Set(cleaned.map((m) => m.grade));
  const collegeMajorCounts = {};
  cleaned.forEach((m) => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  const hasEmptyCollegeCode = cleaned.some((m) => !m.collegeCode);
  const hasEmptyMajorCode = cleaned.some((m) => !m.code);
  const seenKeys = /* @__PURE__ */ new Set();
  let hasDuplicateKey = false;
  for (const m of cleaned) {
    const key = `${m.collegeCode}_${m.grade}_${m.code}`;
    if (seenKeys.has(key)) {
      hasDuplicateKey = true;
      break;
    }
    seenKeys.add(key);
  }
  console.log("\n\u{1F4E6} === [\u4E0A\u4F20\u6458\u8981] ===");
  console.log(`- collegesCount: ${collegeCodes.size}`);
  console.log(`- gradesCount: ${majorGrades.size}`);
  console.log(`- majorsCount: ${cleaned.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u7A7A collegeCode: ${hasEmptyCollegeCode ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u7A7A majorCode: ${hasEmptyMajorCode ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log(`- \u662F\u5426\u5B58\u5728\u91CD\u590D key: ${hasDuplicateKey ? "\u26A0\uFE0F \u662F" : "\u5426"}`);
  console.log("=====================\n");
  try {
    await uploadToVps("/api/admin/sync/majors", cleaned);
  } catch (err) {
    console.error(`\u274C Majors \u6570\u636E\u540C\u6B65\u81F3 VPS \u5931\u8D25\uFF01`);
    if (err.response) {
      console.error(`- status: ${err.response.status}`);
      console.error(`- response body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`- error message: ${err.message}`);
    }
    console.error(`- request payload size: ${payloadSizeKB} KB`);
    console.error(`- \u672C\u5730\u8C03\u8BD5\u6587\u4EF6\u8DEF\u5F84: ${debugUploadPath}`);
    throw err;
  }
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(cleaned, null, 2), "utf-8");
  const majorsTerm = process.env.PREFERRED_SEMESTER || catalog && catalog.semesters && catalog.semesters[0] && catalog.semesters[0].value || inferPreferredSemester();
  const majorsCacheDir = path.join(syncCacheStore.ensureTermCache(__dirname, majorsTerm), "catalog");
  syncCacheStore.writeJsonAtomic(path.join(majorsCacheDir, "majors.json"), cleaned);
  syncCacheStore.writeJsonAtomic(path.join(majorsCacheDir, "majors.metadata.json"), syncCacheStore.buildMetadata({
    term: majorsTerm,
    scope: "majors",
    sourceMode: "network-direct",
    endpointFamily: "major-catalog",
    acquisition: "network",
    command: global.GENERATED_COMMAND || process.argv.join(" "),
    runId: getActiveSyncPlan() && getActiveSyncPlan().runId || "",
    itemCount: cleaned.length,
    items: cleaned
  }));
  console.log("\u{1F4BE} Majors \u4E34\u65F6\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3\u672C\u5730 last-majors.json");
  return cleaned;
}
async function getCurrentStudentClass(page) {
  console.log("\u{1F50D} \u6B63\u5728\u5B9A\u4F4D\u5F53\u524D\u767B\u5F55\u5B66\u751F\u7684\u73ED\u7EA7\u4FE1\u606F...");
  try {
    await gotoPage(page, "/xskb/xskb_list.do", { waitUntil: "networkidle" });
    const htmlText = await page.content();
    const $ = cheerio.load(htmlText);
    const bodyText = $("body").text();
    let className = "";
    const match2 = bodyText.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
    if (match2) {
      className = match2[1].trim();
      console.log(`\u{1F389} \u6210\u529F\u8BC6\u522B\u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7: ${className}`);
      return className;
    }
    $("td, th, span, div").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("\u73ED\u7EA7\uFF1A") || text.includes("\u884C\u653F\u73ED\u7EA7\uFF1A") || text.includes("\u73ED\u7EA7:")) {
        const m = text.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
        if (m) {
          className = m[1].trim();
        }
      }
    });
    if (className) {
      console.log(`\u{1F389} \u4ECE\u9875\u9762 DOM \u5339\u914D\u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7: ${className}`);
      return className;
    }
    console.warn("\u26A0\uFE0F \u4E2A\u4EBA\u8BFE\u8868\u9875\u9762\u4E2D\u672A\u63D0\u53D6\u5230\u660E\u786E\u73ED\u7EA7\u6587\u672C\u3002");
    return "";
  } catch (error) {
    console.error(`\u26A0\uFE0F \u6293\u53D6\u5F53\u524D\u5B66\u751F\u73ED\u7EA7\u51FA\u9519: ${error.message}`);
    return "";
  }
}
async function syncClassSchedules(page, catalog, majors) {
  console.log("\n=== [\u6B65\u9AA4 3] \u5F00\u59CB\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868 Class Schedules ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Catalog \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:catalog");
      return;
    }
  }
  if (!majors) {
    if (fs.existsSync(path.join(__dirname, "last-majors.json"))) {
      majors = JSON.parse(fs.readFileSync(path.join(__dirname, "last-majors.json"), "utf-8"));
    } else {
      console.error("\u274C \u627E\u4E0D\u5230 Majors \u6570\u636E\uFF0C\u8BF7\u5148\u8FD0\u884C sync:majors");
      return;
    }
  }
  const debugDir = path.join(__dirname, ".debug");
  const rawPagesDir = path.join(debugDir, "raw-pages");
  if (!fs.existsSync(rawPagesDir)) {
    fs.mkdirSync(rawPagesDir, { recursive: true });
  }
  const relayTermConfig = global.RELAY_TERM_CONFIG || {};
  const activeSemester = String((global.CLI_PARAMS || {}).term || (global.CLI_PARAMS || {}).semester || process.env.PREFERRED_SEMESTER || relayTermConfig.term || "").trim();
  if (!activeSemester) {
    throw new Error("Missing target term. Pass --term=YYYY-YYYY-1 or set PREFERRED_SEMESTER before crawling class schedules.");
  }
  global.TERM_CONFIG = global.TERM_CONFIG || await assertTermConfigBeforeCrawl(activeSemester, global.CLI_PARAMS || {});
  console.log(`\u{1F4C5} \u6293\u53D6\u5B66\u671F: ${activeSemester}`);
  const cliParams = global.CLI_PARAMS || {};
  const forceRefresh = Boolean(cliParams.forceRefresh || cliParams["force-refresh"] || cliParams.fresh);
  const ignoreProgress = forceRefresh || Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]);
  const ignoreNoScheduleCache = forceRefresh || Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]);
  const clearProgress = Boolean(cliParams.clearProgress || cliParams["clear-progress"]);
  const clearNoScheduleCache = Boolean(cliParams.clearNoScheduleCache || cliParams["clear-no-schedule-cache"]);
  const crawlMode = cliParams.crawlMode || (forceRefresh ? "full-fresh" : cliParams.recheckNoSchedule || cliParams["recheck-no-schedule"] ? "revalidate" : "incremental");
  if (crawlMode === "full-fresh") {
    console.log("\u{1F9ED} \u672C\u6B21\u4E3A full-fresh \u6A21\u5F0F\uFF1A\u5FFD\u7565 progress\u3001no-schedule cache \u548C\u5386\u53F2 classSchedules \u7F13\u5B58\u3002");
  } else if (crawlMode === "revalidate") {
    console.log("\u{1F9ED} \u672C\u6B21\u4E3A revalidate \u6A21\u5F0F\uFF1A\u91CD\u65B0\u6821\u9A8C\u65E0\u6392\u8BFE\u4E13\u4E1A\uFF0C\u4E0D\u6309 no-schedule cache \u8DF3\u8FC7\u3002");
  } else {
    console.log("\u{1F9ED} \u672C\u6B21\u4E3A incremental \u6A21\u5F0F\uFF1A\u5141\u8BB8\u4F7F\u7528\u672C\u5730\u8FDB\u5EA6\u4E0E no-schedule cache\u3002");
  }
  const syncPlan = getActiveSyncPlan();
  const runId = syncPlan && syncPlan.runId || cliParams.freshRunId || cliParams["fresh-run-id"] || `class-${Date.now()}`;
  const PROGRESS_PATH = isPlanNetworkOnly() ? syncCacheStore.progressPath(__dirname, activeSemester, "class", runId) : path.join(debugDir, "sync-progress.json");
  if ((clearProgress || forceRefresh) && fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
    console.log(`\u{1F9F9} \u5DF2\u6E05\u7406\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\u6587\u4EF6: ${PROGRESS_PATH}`);
  }
  let progress = { completed: [] };
  if (!ignoreProgress && fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      console.log(`\u2139\uFE0F \u52A0\u8F7D\u5230\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\uFF0C\u5DF2\u5B8C\u6210 ${progress.completed.length} \u4E2A\u4E13\u4E1A\u3002`);
    } catch (e2) {
      console.warn("\u26A0\uFE0F \u8BFB\u53D6\u65AD\u70B9\u8FDB\u5EA6\u5931\u8D25\uFF0C\u5C06\u5168\u65B0\u6293\u53D6");
    }
  } else if (ignoreProgress) {
    console.log("\u2139\uFE0F \u5DF2\u5FFD\u7565\u672C\u5730\u540C\u6B65\u8FDB\u5EA6\u7F13\u5B58\uFF0C\u672C\u8F6E\u4F1A\u91CD\u65B0\u5224\u65AD\u76EE\u6807\u4E13\u4E1A\u3002");
  }
  const currentStudentClass = await getCurrentStudentClass(page);
  if (currentStudentClass) {
    console.log(`\u2139\uFE0F \u5F53\u524D\u767B\u5F55\u5B66\u751F\u73ED\u7EA7\u4EC5\u7528\u4E8E\u8BCA\u65AD\u53C2\u8003: ${currentStudentClass}`);
  }
  const collegeNameByCode = new Map((catalog.colleges || []).map((college) => [String(college.code), college.name]));
  const noScheduleCachePath = isPlanNetworkOnly() ? syncCacheStore.negativePath(__dirname, activeSemester, "class-schedule", runId) : path.join(debugDir, "no-schedule-majors.json");
  const classNameCandidatesPath = path.join(debugDir, "class-name-candidates.json");
  let noScheduleMajors = readJsonArray(noScheduleCachePath);
  if ((clearNoScheduleCache || forceRefresh) && noScheduleMajors.length > 0) {
    const before = noScheduleMajors.length;
    noScheduleMajors = noScheduleMajors.filter((item) => item && item.semester !== activeSemester);
    writeJsonFile(noScheduleCachePath, noScheduleMajors);
    console.log(`\u{1F9F9} \u5DF2\u6E05\u7406\u672C\u5B66\u671F\u65E0\u6392\u8BFE\u7F13\u5B58: ${before - noScheduleMajors.length} \u6761 (${activeSemester})\u3002`);
  }
  let classNameCandidateRecords = readJsonArray(classNameCandidatesPath);
  const skipNoScheduleCache = getEnvFlag("SYNC_SKIP_NO_SCHEDULE_CACHE", true) && !ignoreNoScheduleCache;
  const recheckNoSchedule = getEnvFlag("SYNC_RECHECK_NO_SCHEDULE", false);
  const cachedNoScheduleKeys = new Set(
    skipNoScheduleCache && !recheckNoSchedule ? noScheduleMajors.filter((item) => item && item.semester === activeSemester).map((item) => getMajorIdentityKey({
      collegeCode: item.collegeCode,
      grade: item.grade,
      code: item.majorCode
    }, item.semester)) : []
  );
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map((c) => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map((g) => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);
  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const syncClassScope = global.CLI_PARAMS?.classScope || process.env.SYNC_CLASS_SCOPE || "";
  if (includeScopes.includes("classSchedules")) {
    if (!isFiltered && syncClassScope !== "all") {
      const errMsg = `\u274C \u8FD0\u884C\u7EC8\u6B62\uFF1A\u5F53\u524D includeScopes \u5305\u542B\u884C\u653F\u73ED\u8BFE\u8868\uFF0C\u4F46\u672A\u8BBE\u7F6E SYNC_CLASS_SCOPE=all \u6216 --class-scope=all\uFF0C\u4E14\u6CA1\u6709\u7CBE\u51C6\u8FC7\u6EE4\u6761\u4EF6\u3002\u8BF7\u4F7F\u7528\u540E\u53F0\u540C\u6B65\u4E2D\u5FC3\u751F\u6210\u7684\u5B8C\u6574\u547D\u4EE4\u3002`;
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }
  if (isFiltered) {
    console.log("\u2139\uFE0F \u8BFE\u8868\u540C\u6B65\u5DF2\u542F\u7528\u73AF\u5883\u53D8\u91CF\u9650\u5236\u8FC7\u6EE4\uFF1A");
    if (syncCollegeCodes) console.log(`   - \u5B66\u9662\u9650\u5236: ${syncCollegeCodes.join(", ")}`);
    if (syncGrades) console.log(`   - \u5E74\u7EA7\u9650\u5236: ${syncGrades.join(", ")}`);
    if (syncMajorCodes) console.log(`   - \u4E13\u4E1A\u4EE3\u7801\u9650\u5236: ${syncMajorCodes.join(", ")}`);
  } else {
    console.log("\u2139\uFE0F \u8BFE\u8868\u540C\u6B65\u672A\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF\u9650\u5236\u3002\u9ED8\u8BA4\u4EC5\u540C\u6B65\u5F53\u524D\u5B66\u5E74\u8D77\u6700\u8FD1 5 \u4E2A\u5728\u6821\u6D3B\u8DC3\u5E74\u7EA7\uFF0C\u5E76\u542F\u7528\u9650\u901F\u3002");
  }
  if (skipNoScheduleCache && !recheckNoSchedule) {
    console.log(`\u2139\uFE0F \u5DF2\u542F\u7528\u65E0\u6392\u8BFE\u7F13\u5B58\u8DF3\u8FC7\u7B56\u7565\uFF0C\u672C\u5B66\u671F\u7F13\u5B58\u547D\u4E2D\u5019\u9009 ${cachedNoScheduleKeys.size} \u4E2A\u3002`);
  } else if (recheckNoSchedule) {
    console.log("\u2139\uFE0F SYNC_RECHECK_NO_SCHEDULE=true\uFF0C\u5C06\u91CD\u65B0\u68C0\u67E5\u6B64\u524D\u786E\u8BA4\u65E0\u6392\u8BFE\u7684\u4E13\u4E1A\u3002");
  }
  const isFiveYearMajor = (name) => {
    const n = name || "";
    return n.includes("\u52A8\u7269\u533B\u5B66") || n.includes("\u5EFA\u7B51\u5B66") || n.includes("\u4E34\u5E8A\u533B\u5B66") || n.includes("\u533B\u5B66");
  };
  const targetMajors = majors.filter((major) => {
    if (syncCollegeCodes && !syncCollegeCodes.includes(major.collegeCode)) {
      return false;
    }
    if (syncGrades && !syncGrades.includes(major.grade)) {
      const includeFiveYear = getEnvFlag("SYNC_INCLUDE_FIVE_YEAR", true);
      const isFiveYear = isFiveYearMajor(major.name || major.majorName);
      if (includeFiveYear && isFiveYear && major.grade === "2021") {
      } else {
        return false;
      }
    }
    if (syncMajorCodes && !syncMajorCodes.includes(major.code)) {
      return false;
    }
    if (!isFiltered) {
      if (syncClassScope !== "all") {
        return false;
      }
      let activeGrades = [];
      try {
        activeGrades = getActiveGradesBySemester(activeSemester, { originalGrades: catalog.grades, activeGradeCount: 5 });
      } catch (e2) {
        const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
        for (let i = 4; i >= 0; i--) {
          activeGrades.push(String(currentYear - i));
        }
      }
      if (!activeGrades.includes(major.grade)) {
        return false;
      }
    }
    return true;
  });
  if (!isFiltered && syncClassScope !== "all") {
    console.log("\u26A0\uFE0F \u672A\u68C0\u6D4B\u5230\u7CBE\u51C6\u540C\u6B65\u73AF\u5883\u53D8\u91CF\u9650\u5236 (SYNC_CLASS_COLLEGE_CODES \u7B49)\uFF0C\u4E14\u672A\u663E\u5F0F\u8BBE\u7F6E SYNC_CLASS_SCOPE=all\u3002\u8DF3\u8FC7\u5168\u6821\u540C\u6B65\u3002");
  }
  console.log(`\u{1F3AF} \u5339\u914D\u7684\u76EE\u6807\u4E13\u4E1A\u603B\u8BA1: ${targetMajors.length} \u4E2A\u3002`);
  const effectiveTargetMajors = targetMajors.filter((major) => {
    if (!skipNoScheduleCache || recheckNoSchedule) {
      return true;
    }
    const key = getMajorIdentityKey(major, activeSemester);
    if (cachedNoScheduleKeys.has(key)) {
      console.log(`   \u8DF3\u8FC7\u5DF2\u786E\u8BA4\u65E0\u6392\u8BFE\u4E13\u4E1A: ${major.grade}\u7EA7 - ${major.name} (${major.code})`);
      return false;
    }
    return true;
  });
  if (effectiveTargetMajors.length !== targetMajors.length) {
    console.log(`\u23ED\uFE0F \u5DF2\u6309\u65E0\u6392\u8BFE\u7F13\u5B58\u8DF3\u8FC7 ${targetMajors.length - effectiveTargetMajors.length} \u4E2A\u4E13\u4E1A\uFF0C\u672C\u8F6E\u5B9E\u9645\u5F85\u5224\u65AD ${effectiveTargetMajors.length} \u4E2A\u3002`);
  }
  const pendingMajors = effectiveTargetMajors.filter((major) => !hasCompletedMajor(progress, major, activeSemester));
  const completedProgressCount = effectiveTargetMajors.length - pendingMajors.length;
  const skipNoScheduleCount = targetMajors.length - effectiveTargetMajors.length;
  let cachedClassSchedules = [];
  const crawlStats = {
    crawlMode,
    usedProgressCache: !ignoreProgress && completedProgressCount > 0,
    usedNoScheduleCache: skipNoScheduleCache && !recheckNoSchedule && skipNoScheduleCount > 0,
    usedClassScheduleCache: false,
    actualNetworkRequestCount: 0,
    skippedByProgressCount: completedProgressCount,
    skippedByNoScheduleCount: skipNoScheduleCount,
    freshRunId: cliParams.freshRunId || cliParams["fresh-run-id"] || (forceRefresh ? `fresh-${Date.now()}-${crypto.randomBytes(4).toString("hex")}` : ""),
    requestedTargetCount: pendingMajors.length,
    succeededTargetCount: 0,
    failedTargetCount: 0,
    failedTargets: []
  };
  global.SYNC_CRAWL_STATS = crawlStats;
  global.CLASS_SCHEDULE_CACHE_USAGE = {
    usedClassScheduleCache: false,
    cacheSource: null,
    cacheWarning: null
  };
  if (!forceRefresh && (completedProgressCount > 0 || pendingMajors.length === 0)) {
    const cache = readClassScheduleCacheForSemester(activeSemester);
    if (cache.items && cache.items.length > 0) {
      cachedClassSchedules = cache.items;
      crawlStats.usedClassScheduleCache = true;
      global.SYNC_CRAWL_STATS = crawlStats;
      global.CLASS_SCHEDULE_CACHE_USAGE = {
        usedClassScheduleCache: true,
        cacheSource: cache.filePath,
        cacheWarning: `\u672C\u8F6E\u6709 ${completedProgressCount} \u4E2A\u4E13\u4E1A\u88AB progress \u8DF3\u8FC7\uFF0C\u5DF2\u4ECE\u5386\u53F2 classSchedules \u7F13\u5B58\u6062\u590D ${cachedClassSchedules.length} \u6761\u8BFE\u8868\u3002`
      };
      console.log(`\u267B\uFE0F \u5DF2\u4ECE\u5386\u53F2\u7F13\u5B58\u6062\u590D ${cachedClassSchedules.length} \u6761 classSchedules: ${cache.filePath}`);
    } else if (completedProgressCount > 0) {
      const detail = cache.error ? ` (${cache.error.message})` : "";
      throw new Error(`\u672C\u5730\u8FDB\u5EA6\u7F13\u5B58\u4E0E\u7ED3\u679C\u7F13\u5B58\u4E0D\u4E00\u81F4\uFF1A${completedProgressCount} \u4E2A\u4E13\u4E1A\u5C06\u88AB progress \u8DF3\u8FC7\uFF0C\u4F46\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules${detail}\u3002\u8BF7\u4F7F\u7528 --force-refresh \u6216 --clear-progress \u91CD\u65B0\u6293\u53D6\u3002`);
    }
  }
  console.log(`\u{1F504} \u672C\u8F6E\u5F85\u540C\u6B65\u4E13\u4E1A: ${pendingMajors.length} \u4E2A\u3002`);
  if (pendingMajors.length === 0) {
    if (cachedClassSchedules.length > 0) {
      console.log("\u2139\uFE0F \u672C\u8F6E\u6CA1\u6709\u5F85\u6293\u53D6\u4E13\u4E1A\uFF0C\u76F4\u63A5\u4F7F\u7528\u5386\u53F2 classSchedules \u7F13\u5B58\u6784\u5EFA Staging\u3002");
      return cachedClassSchedules;
    }
    if (completedProgressCount > 0 && skipNoScheduleCount > 0) {
      throw new Error("\u672C\u5730\u8FDB\u5EA6\u7F13\u5B58\u4E0E\u7ED3\u679C\u7F13\u5B58\u4E0D\u4E00\u81F4\uFF1A\u6240\u6709\u4E13\u4E1A\u90FD\u88AB progress/no-schedule cache \u8DF3\u8FC7\uFF0C\u4F46\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules\u3002\u8BF7\u4F7F\u7528 --force-refresh \u6216 --clear-progress \u91CD\u65B0\u6293\u53D6\u3002");
    }
    throw new Error("\u672C\u8F6E\u5F85\u540C\u6B65\u4E13\u4E1A\u4E3A 0\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u4E8E\u6784\u5EFA Staging \u7684\u5386\u53F2 classSchedules\u3002\u8BF7\u4F7F\u7528 --force-refresh \u91CD\u65B0\u6293\u53D6\uFF0C\u6216\u68C0\u67E5 --grades/--college-codes/--major-codes \u8FC7\u6EE4\u6761\u4EF6\u3002");
  }
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let totalCoursesFetched = 0;
  let totalDedupledCount = 0;
  let totalGroupedCount = 0;
  let newNoScheduleCount = 0;
  let allClassSchedules = cachedClassSchedules.slice();
  let count = 0;
  for (const major of pendingMajors) {
    count++;
    console.log(`   [${count}/${pendingMajors.length}] \u6B63\u5728\u6293\u53D6: ${major.grade}\u7EA7 - ${major.name} \u4E13\u4E1A\u8BFE\u8868 ...`);
    try {
      crawlStats.actualNetworkRequestCount += 1;
      global.SYNC_CRAWL_STATS = crawlStats;
      const htmlText = await page.evaluate(async (params) => {
        const formBody = new URLSearchParams({
          xnxqh: params.semester,
          skyx: params.collegeCode,
          sknj: params.grade,
          skzy: params.majorCode,
          zc1: "",
          zc2: "",
          jc1: "",
          jc2: ""
        }).toString();
        const res = await fetch("/kbcx/kbxx_xzb_ifr", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: formBody
        });
        return res.text();
      }, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code
      });
      const rawHtmlPath = path.join(rawPagesDir, `class_${major.grade}_${major.code}.html`);
      fs.writeFileSync(rawHtmlPath, htmlText, "utf-8");
      const candidateResult = parser.extractClassNameCandidates(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      classNameCandidateRecords = upsertClassNameCandidateRecord(classNameCandidateRecords, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
        rawHtmlPath,
        classNames: candidateResult.classNames || [],
        candidates: (candidateResult.candidates || []).slice(0, 80),
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      writeJsonFile(classNameCandidatesPath, classNameCandidateRecords);
      console.log(`      \u73ED\u7EA7\u6587\u672C\u5019\u9009: ${(candidateResult.classNames || []).join(", ") || "\u672A\u53D1\u73B0"}`);
      const parsed2 = parser.parseClassScheduleIfrHtml(htmlText, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      const courses = normalizer.normalizeCourseList(parsed2.courses || [], {
        semester: activeSemester,
        sourceType: "class",
        audienceType: "student"
      });
      totalCoursesFetched += courses.length;
      if (courses.length > 0) {
        const seenKeys = /* @__PURE__ */ new Set();
        const uniqueCourses = courses.filter((c) => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || "",
            c.teacherName || "",
            c.classroom || ""
          ].join("_");
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        const dedupedDiff = courses.length - uniqueCourses.length;
        totalDedupledCount += dedupedDiff;
        const groupMap = {};
        uniqueCourses.forEach((c) => {
          const key = [
            c.courseName || "",
            c.weekday || "",
            c.startSection || "",
            c.endSection || "",
            c.startWeek || "",
            c.endWeek || ""
          ].join("_");
          groupMap[key] = (groupMap[key] || 0) + 1;
        });
        let groupedCoursesNum = 0;
        Object.keys(groupMap).forEach((key) => {
          if (groupMap[key] > 1) {
            groupedCoursesNum++;
          }
        });
        totalGroupedCount += groupedCoursesNum;
      }
      if (courses.length === 0) {
        newNoScheduleCount++;
        const noScheduleRecord = {
          semester: activeSemester,
          collegeCode: major.collegeCode,
          collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
          grade: major.grade,
          majorCode: major.code,
          majorName: major.name,
          checkedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        noScheduleMajors = upsertNoScheduleMajor(noScheduleMajors, noScheduleRecord);
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log(`      \u6CA1\u6709\u6392\u8BFE\u6570\u636E\uFF0C\u5DF2\u8BB0\u5F55\u5230 ${noScheduleCachePath}`);
        markCompletedMajor(progress, major, activeSemester);
        writeJsonFile(PROGRESS_PATH, progress);
        crawlStats.succeededTargetCount += 1;
        global.SYNC_CRAWL_STATS = crawlStats;
        await waitBetweenClassSyncRequests(isFiltered);
        continue;
      }
      const beforeNoScheduleCount = noScheduleMajors.length;
      noScheduleMajors = removeNoScheduleMajor(noScheduleMajors, major, activeSemester);
      if (noScheduleMajors.length !== beforeNoScheduleCount) {
        writeJsonFile(noScheduleCachePath, noScheduleMajors);
        console.log("      \u6B64\u524D\u65E0\u6392\u8BFE\u7F13\u5B58\u5DF2\u5931\u6548\uFF0C\u672C\u6B21\u6293\u5230\u8BFE\u7A0B\u5E76\u5DF2\u79FB\u9664\u7F13\u5B58\u8BB0\u5F55\u3002");
      }
      const classes = normalizer.buildClassScheduleEntries(courses, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name
      });
      if (classes.length > 0) {
        const aggregateCount = classes.filter((item) => item.isAggregated).length;
        const classCount = classes.length - aggregateCount;
        console.log(`      \u6574\u7406\u8BFE\u8868\u6761\u76EE: \u884C\u653F\u73ED ${classCount} \u4E2A\uFF0C\u4E13\u4E1A\u805A\u5408 ${aggregateCount} \u4E2A (${classes.map((c) => c.className).join(", ")})`);
        allClassSchedules = mergeClassSchedules(allClassSchedules, classes);
      }
      markCompletedMajor(progress, major, activeSemester);
      writeJsonFile(PROGRESS_PATH, progress);
      crawlStats.succeededTargetCount += 1;
      global.SYNC_CRAWL_STATS = crawlStats;
    } catch (err) {
      console.error(`      \u26A0\uFE0F  \u6293\u53D6\u5931\u8D25: ${err.message}`);
    }
    await waitBetweenClassSyncRequests(isFiltered);
  }
  console.log(`\u{1F4CA} \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5171\u6574\u7406\u51FA ${allClassSchedules.length} \u4E2A\u884C\u653F\u73ED\u7EA7\u7684\u8BFE\u8868\u3002`);
  const unfinishedTargets = effectiveTargetMajors.filter((major) => !hasCompletedMajor(progress, major, activeSemester));
  if (unfinishedTargets.length > 0) {
    crawlStats.failedTargetCount = Math.max(crawlStats.failedTargetCount || 0, unfinishedTargets.length);
    crawlStats.failedTargets = unfinishedTargets.map((major) => ({
      collegeCode: major.collegeCode,
      grade: major.grade,
      majorCode: major.code,
      majorName: major.name
    }));
    global.SYNC_CRAWL_STATS = crawlStats;
    if (!((global.CLI_PARAMS || {}).allowPartial || (global.CLI_PARAMS || {})["allow-partial"])) {
      throw new Error(`CLASS_SCHEDULE_PARTIAL_FAILURE: ${unfinishedTargets.length} target(s) did not finish. Use --allow-partial only for diagnostic snapshots.`);
    }
  }
  if (allClassSchedules.length > 0) {
    const { latestPath } = saveFullClassSchedules(allClassSchedules, activeSemester);
    const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
    let checksum = "";
    try {
      const fileContent = fs.readFileSync(latestPath, "utf-8");
      checksum = crypto.createHash("md5").update(fileContent).digest("hex");
    } catch (e2) {
      console.warn(`\u26A0\uFE0F \u8BA1\u7B97 class-schedules-latest.json \u7684 checksum \u5931\u8D25: ${e2.message}`);
    }
    let syncClientVersion = "1.0.0";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
      syncClientVersion = pkg.version || "1.0.0";
    } catch (e2) {
    }
    const adminClassCount = allClassSchedules.filter(
      (item) => item.displayType === "class-schedule" && !item.isAggregated
    ).length;
    const majorAggregateCount = allClassSchedules.length - adminClassCount;
    const manifestData = {
      semester: activeSemester,
      grades: syncGrades || (catalog.grades || []),
      crawledAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: "100.fosu.edu.cn",
      classScheduleCount: allClassSchedules.length,
      adminClassCount,
      majorAggregateCount,
      checksum,
      syncClientVersion
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
    console.log(`\u{1F4BE} \u73ED\u7EA7\u8BFE\u8868\u6293\u53D6\u6E05\u5355\u5DF2\u4FDD\u5B58\u81F3: ${manifestPath}`);
    if (getEnvFlag("SYNC_CLASS_CRAWL_ONLY", false)) {
      console.log(`
\u{1F389} [Crawl Only] \u6293\u53D6\u5B8C\u6210\uFF01`);
      console.log(`\u{1F4C1} \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3: ${latestPath}`);
      console.log(`\u{1F4CA} \u5171\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u6570\u91CF (itemCount): ${allClassSchedules.length} \u6761`);
      printPowerShellCommands();
      return allClassSchedules;
    }
    try {
      await uploadClassSchedulesInChunks(allClassSchedules, debugDir, latestPath, activeSemester);
      console.log(`\u2705 \u672C\u8F6E\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6570\u636E\u540C\u6B65\u5B8C\u6210\uFF01`);
    } catch (uploadError) {
      console.error(`\u274C \u540C\u6B65\u81F3 VPS \u5931\u8D25\uFF1A${uploadError.message}`);
      console.error(`\u26A0\uFE0F \u5B8C\u6574\u8BFE\u8868\u6570\u636E\u5DF2\u4FDD\u5B58\u81F3 .debug/class-schedules-latest.json\uFF0C\u53EF\u7A0D\u540E\u6267\u884C upload-only \u7EE7\u7EED\u4E0A\u4F20\u3002`);
      printPowerShellCommands();
      throw uploadError;
    }
  } else {
    console.log("\u2139\uFE0F \u672C\u8F6E\u6CA1\u6709\u65B0\u6293\u53D6\u5230\u4EFB\u4F55\u73ED\u7EA7\u8BFE\u8868\uFF0C\u65E0\u9700\u4E0A\u4F20\u3002");
  }
  const finalAggregateCount = allClassSchedules.filter((item) => item.isAggregated).length;
  const finalClassCount = allClassSchedules.length - finalAggregateCount;
  const finalTotalSkipCount = skipNoScheduleCount + newNoScheduleCount;
  console.log("\n================ [\u540C\u6B65\u4EFB\u52A1\u603B\u7ED3\u62A5\u544A] ================");
  console.log(`- \u884C\u653F\u73ED\u6570\u91CF: ${finalClassCount} \u4E2A`);
  console.log(`- \u4E13\u4E1A\u5171\u4EAB\u8BFE\u8868\u6570\u91CF: ${finalAggregateCount} \u4E2A`);
  console.log(`- \u8BFE\u7A0B\u603B\u6570: ${totalCoursesFetched} \u95E8`);
  console.log(`- \u91CD\u590D\u8BFE\u7A0B\u53BB\u91CD\u6570\u91CF: ${totalDedupledCount} \u95E8`);
  console.log(`- \u5206\u7EC4\u8BFE\u7A0B\u6570\u91CF: ${totalGroupedCount} \u7EC4`);
  console.log(`- \u8DF3\u8FC7\u65E0\u8BFE\u8868\u4E13\u4E1A\u6570\u91CF: ${finalTotalSkipCount} \u4E2A (\u5176\u4E2D\u7F13\u5B58\u8DF3\u8FC7 ${skipNoScheduleCount}\uFF0C\u672C\u6B21\u65B0\u786E\u8BA4 ${newNoScheduleCount})`);
  console.log(`- \u771F\u5B9E\u8BF7\u6C42\u6559\u52A1\u7F51\u4E13\u4E1A\u6570: ${crawlStats.actualNetworkRequestCount}`);
  console.log(`- \u4F7F\u7528 progress: ${crawlStats.usedProgressCache ? "\u662F" : "\u5426"}\uFF0C\u4F7F\u7528 no-schedule cache: ${crawlStats.usedNoScheduleCache ? "\u662F" : "\u5426"}\uFF0C\u5408\u5E76\u65E7\u8BFE\u8868: ${crawlStats.usedClassScheduleCache ? "\u662F" : "\u5426"}`);
  console.log("==================================================\n");
  const allEffectiveTargetsDone = effectiveTargetMajors.every((major) => hasCompletedMajor(progress, major, activeSemester));
  if (allEffectiveTargetsDone) {
    try {
      fs.unlinkSync(PROGRESS_PATH);
      console.log("\u{1F389} \u6240\u6709\u76EE\u6807\u4E13\u4E1A\u5DF2\u540C\u6B65\u5B8C\u6210\uFF0C\u8FDB\u5EA6\u5DF2\u91CD\u7F6E\u3002");
    } catch (e2) {
    }
  }
  return allClassSchedules;
}
function runPreflight() {
  console.log("\n================ [Preflight \u9884\u68C0\u73AF\u5883\u914D\u7F6E] ================");
  console.log(`- .env path: ${envPath}`);
  console.log(`- FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
  console.log(`- PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "\u672A\u914D\u7F6E"}`);
  const syncClassGrades = process.env.SYNC_CLASS_GRADES || "\u672A\u914D\u7F6E";
  const syncGrades = process.env.SYNC_GRADES || "\u672A\u914D\u7F6E";
  console.log(`- SYNC_CLASS_GRADES (\u73ED\u7EA7\u8BFE\u8868\u540C\u6B65\u4F7F\u7528): ${syncClassGrades}`);
  console.log(`- SYNC_GRADES (\u4E13\u4E1A\u540C\u6B65\u4F7F\u7528): ${syncGrades}`);
  const tokenExists = Boolean(process.env.ADMIN_API_TOKEN);
  console.log(`- ADMIN_API_TOKEN: ${tokenExists ? "\u5DF2\u914D\u7F6E" : "\u274C \u672A\u914D\u7F6E\uFF01(\u53EF\u80FD\u4F1A\u5BFC\u81F4 VPS \u6821\u9A8C\u5931\u8D25)"}`);
  if (INITIAL_DETECTED_PROXIES.length > 0) {
    console.warn(`\u26A0\uFE0F \u68C0\u6D4B\u5230\u4EE3\u7406\u73AF\u5883\u53D8\u91CF:`);
    INITIAL_DETECTED_PROXIES.forEach(([name, value]) => {
      console.warn(`   - ${name}=${value}`);
      if (value.includes("127.0.0.1:10808") || value.includes("localhost:10808")) {
        console.warn("   \u26A0\uFE0F \u3010\u8B66\u544A\u3011\u68C0\u6D4B\u5230\u4EE3\u7406\u6307\u5411 127.0.0.1:10808\uFF0C\u53EF\u80FD\u662F v2rayN \u7CFB\u7EDF\u4EE3\u7406\u6B8B\u7559\uFF0C\u4F1A\u5BFC\u81F4\u4E0A\u4F20 VPS \u5931\u8D25\uFF01");
      }
    });
  } else {
    console.log("- \u4EE3\u7406\u73AF\u5883\u53D8\u91CF: \u672A\u68C0\u6D4B\u5230");
  }
  const disableProxy2 = String(process.env.SYNC_DISABLE_PROXY || "true").toLowerCase() !== "false";
  console.log(`- SYNC_DISABLE_PROXY: ${disableProxy2}`);
  if (disableProxy2) {
    console.log("\u2139\uFE0F \u5DF2\u542F\u7528\u5F3A\u5236\u7981\u7528\u4EE3\u7406\u914D\u7F6E\u3002\u6240\u6709\u4E0A\u4F20\u9636\u6BB5\u5C06\u5F3A\u5236\u4E0D\u4F7F\u7528\u4EE3\u7406\u3002");
  }
  console.log("========================================================\n");
}
function printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes) {
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const classScheduleCount = allClassSchedules ? allClassSchedules.length : 0;
  const adminClassCount = allClassSchedules ? allClassSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length : 0;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const teacherScheduleCount = resources && resources.teacherSchedules ? resources.teacherSchedules.length : 0;
  const classroomScheduleCount = resources && resources.classroomSchedules ? resources.classroomSchedules.length : 0;
  const courseScheduleCount = resources && resources.courseSchedules ? resources.courseSchedules.length : 0;
  const snapshotVersion = verifyRes?.status?.snapshotVersion || verifyRes?.releaseStatus?.activeReleaseVersion || "\u672A\u77E5";
  const bootstrapDataSource = verifyRes?.bootstrap?.dataSource || "\u672A\u77E5";
  const isActivated = verifyRes?.bootstrap?.success ? "\u5DF2\u6210\u529F\u53D1\u5E03\u5E76\u6FC0\u6D3B" : "\u274C \u672A\u786E\u8BA4\u6FC0\u6D3B\u6210\u529F";
  const clientDataVersion = verifyRes?.bootstrap?.version || verifyRes?.status?.snapshotVersion || "\u672A\u77E5";
  console.log("\n=================== [\u4E00\u952E\u540C\u6B65\u4EFB\u52A1\u603B\u7ED3\u62A5\u544A] ===================");
  console.log(`- \u5F53\u524D\u5B66\u671F (preferredSemester): ${preferredSemester}`);
  console.log(`- catalog \u5B66\u9662\u6570\u91CF: ${catalog && catalog.colleges ? catalog.colleges.length : 0} \u4E2A`);
  console.log(`- majors \u4E13\u4E1A\u6570\u91CF: ${majors ? majors.length : 0} \u4E2A`);
  console.log(`- classScheduleCount (\u73ED\u7EA7\u8BFE\u8868\u6570): ${classScheduleCount} \u6761`);
  console.log(`- adminClassCount (\u884C\u653F\u73ED\u6570\u91CF): ${adminClassCount} \u4E2A`);
  console.log(`- majorAggregateCount (\u4E13\u4E1A\u5171\u4EAB\u6570\u91CF): ${majorAggregateCount} \u4E2A`);
  console.log(`- teacherScheduleCount (\u6559\u5E08\u8BFE\u8868\u6570): ${teacherScheduleCount} \u6761`);
  console.log(`- classroomScheduleCount (\u6559\u5BA4\u8BFE\u8868\u6570): ${classroomScheduleCount} \u6761`);
  console.log(`- courseScheduleCount (\u8BFE\u7A0B\u8BFE\u8868\u6570): ${courseScheduleCount} \u6761`);
  console.log(`- snapshotVersion (\u7EBF\u4E0A\u5FEB\u7167\u7248\u672C): ${snapshotVersion}`);
  console.log(`- bootstrap dataSource (\u6700\u7EC8\u6570\u636E\u6E90): ${bootstrapDataSource}`);
  console.log(`- \u53D1\u5E03\u72B6\u6001: ${isActivated}`);
  console.log(`- \u5C0F\u7A0B\u5E8F\u5E94\u770B\u5230\u7684\u6570\u636E\u7248\u672C (clientDataVersion): ${clientDataVersion}`);
  console.log("============================================================\n");
}
async function handleFreshSync(page) {
  console.log("\n================ [\u5F00\u59CB\u6267\u884C\u4E00\u952E\u5B8C\u6574\u540C\u6B65 (sync:fresh)] ================");
  const catalog = await syncCatalog(page);
  const majors = await syncMajors(page, catalog);
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u4E00\u952E\u5B8C\u6574\u540C\u6B65\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u540C\u6B65\u4E2D\u65AD\uFF01");
  }
  console.log("\n[sync:fresh] \u6B63\u5728\u57FA\u4E8E\u65B0\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6D3E\u751F\u8D44\u6E90\u7EF4\u5EA6...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"], { page });
  console.log("\n[sync:fresh] \u6B63\u5728\u4EE5\u79BB\u7EBF\u53D1\u5E03\u6A21\u5F0F (SYNC_RELEASE_OFFLINE=true) \u751F\u6210\u53D1\u5E03\u5E76\u6FC0\u6D3B\u7EBF\u4E0A\u5FEB\u7167...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();
  console.log("\n[sync:fresh] \u540C\u6B65\u52A8\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u5F00\u59CB\u6821\u9A8C\u7EBF\u4E0A\u7AEF\u70B9...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`\u26A0\uFE0F \u6821\u9A8C\u7EBF\u4E0A\u63A5\u53E3\u51FA\u73B0\u5F02\u5E38: ${err.message}`);
  }
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}
async function handleQuickSync(page) {
  console.log("\n================ [\u5F00\u59CB\u6267\u884C\u4E00\u952E\u5FEB\u901F\u540C\u6B65 (sync:quick)] ================");
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath)) {
    throw new Error("\u6CA1\u6709\u627E\u5230\u672C\u5730 catalog \u6216 majors \u5386\u53F2\u7F13\u5B58\uFF01\u8BF7\u5148\u8FD0\u884C\u4E00\u6B21 npm run sync:fresh\u3002");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("\u5FEB\u901F\u540C\u6B65\u6293\u53D6\u73ED\u7EA7\u8BFE\u8868\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u540C\u6B65\u4E2D\u65AD\uFF01");
  }
  console.log("\n[sync:quick] \u6B63\u5728\u57FA\u4E8E\u65B0\u6293\u53D6\u7684\u73ED\u7EA7\u8BFE\u8868\u6D3E\u751F\u8D44\u6E90\u7EF4\u5EA6...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"], { page });
  console.log("\n[sync:quick] \u6B63\u5728\u4EE5\u79BB\u7EBF\u53D1\u5E03\u6A21\u5F0F (SYNC_RELEASE_OFFLINE=true) \u751F\u6210\u53D1\u5E03\u5E76\u6FC0\u6D3B\u7EBF\u4E0A\u5FEB\u7167...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();
  console.log("\n[sync:quick] \u540C\u6B65\u52A8\u4F5C\u5DF2\u5B8C\u6210\uFF0C\u5F00\u59CB\u6821\u9A8C\u7EBF\u4E0A\u7AEF\u70B9...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`\u26A0\uFE0F \u6821\u9A8C\u7EBF\u4E0A\u63A5\u53E3\u51FA\u73B0\u5F02\u5E38: ${err.message}`);
  }
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}
async function main() {
  const args = process.argv.slice(2);
  let action = "all";
  const params = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const match2 = arg.match(/^--([^=]+)=(.*)$/);
      if (match2) {
        params[match2[1]] = match2[2];
      } else {
        const flagMatch = arg.match(/^--([^=]+)$/);
        if (flagMatch) {
          params[flagMatch[1]] = true;
        }
      }
    } else if (!arg.startsWith("-")) {
      action = arg;
    }
  }
  const parsed2 = parseCliArgs(args);
  const syncPlan = buildSyncPlan(parsed2.action || action, Object.assign({}, params, parsed2.params || {}), process.env);
  Object.assign(params, applyPlanToParams(syncPlan, Object.assign({}, params, parsed2.params || {})));
  action = parsed2.action || action;
  if (action === "resume" && !params.term) {
    const resumeTerm = findTermByRunId(params["run-id"] || params.runId);
    if (resumeTerm) {
      params.term = resumeTerm;
      syncPlan.term = resumeTerm;
      syncPlan.termValid = true;
    }
  }
  global.SYNC_PLAN = syncPlan;
  printSyncPlan(syncPlan);
  global.GENERATED_COMMAND = `node sync.js ${action} ${args.join(" ")}`;
  params.fresh = Boolean(params.fresh || params["fresh"]);
  params.recheckNoSchedule = Boolean(params["recheck-no-schedule"] || params.recheckNoSchedule);
  params.forceResourceCrawl = Boolean(params["force-resource-crawl"] || params.forceResourceCrawl);
  params.resourceSource = params["resource-source"] || params.resourceSource || "derived";
  params.forceRefresh = Boolean(params["force-refresh"] || params.forceRefresh || params.fresh);
  params.ignoreProgress = Boolean(params["ignore-progress"] || params.ignoreProgress || params.forceRefresh);
  params.ignoreNoScheduleCache = Boolean(params["ignore-no-schedule-cache"] || params.ignoreNoScheduleCache || params.forceRefresh);
  params.clearProgress = Boolean(params["clear-progress"] || params.clearProgress);
  params.clearNoScheduleCache = Boolean(params["clear-no-schedule-cache"] || params.clearNoScheduleCache);
  params.classScope = params["class-scope"] || params.classScope || "";
  params.crawlMode = params["crawl-mode"] || params.crawlMode || (params.fresh ? "full-fresh" : params.forceResourceCrawl ? "resource-fresh" : params.recheckNoSchedule ? "revalidate" : "incremental");
  params.freshRunId = params["fresh-run-id"] || params.freshRunId || (params.fresh ? `fresh-${Date.now()}-${crypto.randomBytes(4).toString("hex")}` : "");
  if (params.crawlMode === "full-fresh") {
    console.log("\u{1F9ED} \u672C\u6B21\u4E3A full-fresh \u6A21\u5F0F");
  }
  if (params.term) {
    process.env.PREFERRED_SEMESTER = params.term;
  }
  if (params.start) {
    process.env.SYNC_TERM_START_DATE = params.start;
  }
  if (params["term-start-date"]) {
    process.env.SYNC_TERM_START_DATE = params["term-start-date"];
  }
  if (params.include) {
    process.env.SYNC_INCLUDE_SCOPES = params.include;
  }
  if (params["class-scope"]) {
    process.env.SYNC_CLASS_SCOPE = params["class-scope"];
  }
  if (params.grades) {
    process.env.SYNC_CLASS_GRADES = params.grades;
    process.env.SYNC_GRADES = params.grades;
  }
  if (params["college-codes"]) {
    process.env.SYNC_CLASS_COLLEGE_CODES = params["college-codes"];
  }
  if (params["major-codes"]) {
    process.env.SYNC_CLASS_MAJOR_CODES = params["major-codes"];
  }
  if (params.concurrency) {
    process.env.SYNC_RESOURCE_MAX_CONCURRENCY = params.concurrency;
    process.env.SYNC_CLASS_MAX_CONCURRENCY = params.concurrency;
  }
  if (params["delay-ms"]) {
    process.env.SYNC_RESOURCE_REQUEST_DELAY_MS = params["delay-ms"];
    process.env.SYNC_CLASS_REQUEST_DELAY_MS = params["delay-ms"];
  }
  if (params.forceRefresh || params.ignoreNoScheduleCache) {
    process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "false";
  }
  if (params.recheckNoSchedule) {
    process.env.SYNC_RECHECK_NO_SCHEDULE = "true";
  }
  if (params.forceResourceCrawl) {
    process.env.SYNC_FORCE_RESOURCE_CRAWL = "true";
  }
  if (params.resourceSource) {
    process.env.SYNC_RESOURCE_SOURCE = params.resourceSource;
  }
  if (params["crawl-only"]) {
    process.env.SYNC_CLASS_CRAWL_ONLY = "true";
  }
  if (params["upload-only"]) {
    process.env.SYNC_CLASS_UPLOAD_ONLY = "true";
  }
  if (params.verbose) {
    process.env.SYNC_VERBOSE = "true";
  }
  const includeStr = params.include || process.env.SYNC_INCLUDE_SCOPES || "";
  const includeScopes = includeStr ? includeStr.split(",").map((x) => x.trim()).filter(Boolean) : ALL_SCOPES;
  params.includeScopes = includeScopes;
  global.CLI_PARAMS = params;
  const requiresTermConfigBeforeCrawl = [
    "fresh",
    "quick",
    "local-campus",
    "class",
    "release",
    "all",
    "daily",
    "daily:classes",
    "daily:teachers",
    "daily:classrooms",
    "daily:courses",
    "scopes",
    "new-term",
    "crawl:daily",
    "crawl:scopes",
    "resume"
  ].includes(action);
  if (requiresTermConfigBeforeCrawl) {
    const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    global.TERM_CONFIG = await assertTermConfigBeforeCrawl(activeSemester, params);
    console.log("[term-config] resolved");
    console.log(`- term: ${global.TERM_CONFIG.term}`);
    console.log(`- semesterText: ${global.TERM_CONFIG.semesterText}`);
    console.log(`- termStartDate: ${global.TERM_CONFIG.termStartDate}`);
    console.log(`- totalWeeks: ${global.TERM_CONFIG.totalWeeks}`);
    console.log(`- source: ${global.TERM_CONFIG.source}`);
  }
  if (params["dry-run"] || params["dry_run"]) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }
  if (params.publish === "false" || params.publish === false) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }
  if (requiresTermConfigBeforeCrawl) {
    runPreflight();
  }
  const uploadOnlyMode = getEnvFlag("SYNC_CLASS_UPLOAD_ONLY", false);
  if (uploadOnlyMode || action === "upload-cache") {
    console.log("\u2139\uFE0F \u5C06\u76F4\u63A5\u6267\u884C\u672C\u5730\u8BFE\u8868\u7F13\u5B58\u4E0A\u4F20\uFF0C\u4E0D\u91CD\u65B0\u6253\u5F00\u6D4F\u89C8\u5668\u6293\u53D6\u3002");
    await handleUploadOnly();
    return;
  }
  if (action === "local-upload" || action === "upload-staging") {
    await handleLocalStagingUpload(params);
    return;
  }
  if (action === "resume" && !params["run-id"] && !params.runId) {
    throw new Error("SYNC_RESUME_REQUIRES_RUN_ID");
  }
  const offlineMode = getEnvFlag("SYNC_RELEASE_OFFLINE", false);
  if (action === "release" && offlineMode) {
    await handleOfflineRelease();
    return;
  }
  const resourceActionTypes = getResourceTypesForAction(action);
  if (resourceActionTypes.length && !shouldUseDirectTeacherResources(resourceActionTypes)) {
    await handleResourcesSync(resourceActionTypes);
    return;
  }
  const isNetOk = await diagnose();
  if (!isNetOk) {
    if (action === "release") {
      console.warn("\u26A0\uFE0F \u672C\u5730\u7F51\u7EDC\u672A\u901A\u8FC7\u6821\u56ED\u7F51/VPN\u8BCA\u65AD\uFF01\u65E0\u6CD5\u5728\u7EBF\u6293\u53D6\u6570\u636E\u3002");
      console.log("\u{1F4A1} \u63D0\u793A: \u68C0\u6D4B\u5230\u5F53\u524D\u975E\u6821\u56ED\u7F51\u73AF\u5883\uFF0C\u4F60\u53EF\u4EE5\u4F7F\u7528\u79BB\u7EBF\u6A21\u5F0F\u76F4\u63A5\u6253\u5305\u672C\u5730\u5DF2\u6293\u53D6\u7684\u7F13\u5B58\u53D1\u5E03\u5FEB\u7167\uFF1A");
      console.log('   PowerShell \u547D\u4EE4: $env:SYNC_RELEASE_OFFLINE="true"; npm run sync:release');
    } else {
      console.error("\u274C \u672C\u5730\u7F51\u7EDC\u672A\u901A\u8FC7\u6821\u56ED\u7F51/VPN\u8BCA\u65AD\uFF0C\u4E2D\u6B62\u540C\u6B65\u4EFB\u52A1\uFF01");
      printPowerShellCommands();
    }
    process.exit(1);
  }
  const { browser, context } = await initBrowserContext();
  const page = await context.newPage();
  try {
    const isSessionOk = await checkSession(page);
    if (!isSessionOk) {
      process.exit(1);
    }
    let catalog, majors;
    if (action === "catalog") {
      await syncCatalog(page);
    } else if (action === "majors") {
      await syncMajors(page);
    } else if (action === "class") {
      await syncClassSchedules(page);
    } else if (action === "fresh") {
      await handleFreshSync(page);
    } else if (action === "quick") {
      await handleQuickSync(page);
    } else if (action === "local-campus") {
      await handleLocalCampusStaging(page, params);
    } else if ([
      "daily",
      "daily:classes",
      "daily:teachers",
      "daily:classrooms",
      "daily:courses",
      "scopes",
      "new-term",
      "crawl:daily",
      "crawl:scopes",
      "resume"
    ].includes(action)) {
      await handlePlannedSync(page, params);
    } else if (resourceActionTypes.length) {
      await handleResourcesSync(resourceActionTypes, { page });
    } else if (action === "release") {
      if (!process.env.SYNC_CLASS_GRADES) {
        process.env.SYNC_CLASS_GRADES = "2025,2024,2023,2022";
      }
      if (process.env.SYNC_INCLUDE_FIVE_YEAR === void 0) {
        process.env.SYNC_INCLUDE_FIVE_YEAR = "true";
      }
      if (process.env.SYNC_SKIP_NO_SCHEDULE_CACHE === void 0) {
        process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "true";
      }
      if (process.env.SYNC_RECHECK_NO_SCHEDULE === void 0) {
        process.env.SYNC_RECHECK_NO_SCHEDULE = "false";
      }
      if (process.env.SYNC_CLASS_SCOPE === void 0) {
        process.env.SYNC_CLASS_SCOPE = "all";
      }
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      process.env.SYNC_CLASS_CRAWL_ONLY = "true";
      const allClassSchedules = await syncClassSchedules(page, catalog, majors);
      if (!allClassSchedules || allClassSchedules.length === 0) {
        throw new Error("\u6CA1\u6709\u6293\u53D6\u5230\u4EFB\u4F55\u73ED\u7EA7\u8BFE\u8868\uFF0C\u5FEB\u7167\u53D1\u5E03\u4E2D\u65AD");
      }
      const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
      const releaseResourceTypes = includeReleaseResources ? ["teacher", "classroom", "course"] : [];
      const releaseResources = includeReleaseResources ? await buildResourcesForClassSchedules(allClassSchedules, releaseResourceTypes, {
        page,
        semester: process.env.PREFERRED_SEMESTER || inferPreferredSemester()
      }) : null;
      const snapshot = buildSnapshot(catalog, majors, allClassSchedules, releaseResources, {
        resources: {
          includeTeachers: includeReleaseResources,
          includeClassrooms: includeReleaseResources,
          includeCourses: includeReleaseResources,
          includeTeacherSchedules: includeReleaseResources,
          includeClassroomSchedules: includeReleaseResources,
          includeCourseSchedules: includeReleaseResources
        }
      });
      const zlib = require("zlib");
      const snapshotJson = JSON.stringify(snapshot, null, 2);
      const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
      const compressedBuffer = zlib.gzipSync(snapshotBuffer);
      const debugDir = path.join(__dirname, ".debug");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
      console.log(`
\u{1F4BE} \u672C\u5730\u5FEB\u7167\u5DF2\u751F\u6210\u5E76\u538B\u7F29\uFF1A.debug/snapshot-latest.json \u548C .debug/snapshot-latest.json.gz (\u4F53\u79EF: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
      validateLocalReleaseSnapshot(snapshot);
      if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
        printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
        const report2 = {
          success: true,
          dryRun: true,
          version: snapshot.version,
          semester: snapshot.semester,
          updatedAt: snapshot.updatedAt,
          coverage: snapshot.coverage,
          normalizeReport,
          uploadSize: compressedBuffer.length
        };
        fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report2, null, 2), "utf-8");
        console.log("\u2139\uFE0F SYNC_RELEASE_DRY_RUN=true\uFF0C\u5DF2\u5B8C\u6210\u672C\u5730 release \u6784\u5EFA\u4E0E\u6821\u9A8C\uFF0C\u672A\u4E0A\u4F20\u6216\u6FC0\u6D3B VPS\u3002");
        return;
      }
      const uploadRes = await uploadSnapshot(compressedBuffer);
      const activateRes = await activateSnapshot(snapshot.version);
      console.log(`\u2705 \u5FEB\u7167\u6FC0\u6D3B\u6210\u529F! \u54CD\u5E94: ${JSON.stringify(activateRes)}`);
      const verifyRes = await verifyEndpoints();
      printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
      const report = {
        success: true,
        version: snapshot.version,
        semester: snapshot.semester,
        updatedAt: snapshot.updatedAt,
        coverage: snapshot.coverage,
        normalizeReport,
        uploadSize: compressedBuffer.length,
        serverStatus: verifyRes
      };
      fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
      console.log(`\u{1F4BE} \u603B\u7ED3\u62A5\u544A\u5DF2\u4FDD\u5B58\u81F3 .debug/sync-report-latest.json`);
      console.log("\n\u{1F389} [Release] \u5168\u6821\u8BFE\u8868\u66B4\u529B\u5FEB\u7167\u53D1\u5E03\u6210\u529F\uFF01");
    } else if (action === "all") {
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      await syncClassSchedules(page, catalog, majors);
      console.log("\n\u{1F389} [\u540C\u6B65\u5927\u6210\u529F] \u672C\u5730\u6240\u6709\u6570\u636E\u5DF2\u5168\u91CF\u540C\u6B65\u81F3 VPS\uFF01");
    } else {
      console.error(`\u274C \u672A\u77E5\u7684\u540C\u6B65\u53C2\u6570: ${action}`);
      console.log("\u652F\u6301\u7684\u53C2\u6570: catalog | majors | class | resources | local-campus | local-upload | release | fresh | quick | all");
    }
  } catch (error) {
    console.error(`\u274C \u6267\u884C\u540C\u6B65\u65F6\u53D1\u751F\u81F4\u547D\u5F02\u5E38: ${error.message}`);
    console.error(error.stack);
    printPowerShellCommands();
  } finally {
    await browser.close();
    console.log("\u6D4F\u89C8\u5668\u5DF2\u5B89\u5168\u5173\u95ED\u3002\u540C\u6B65\u4EFB\u52A1\u7ED3\u675F\u3002");
  }
}
if (require.main === module) {
  main();
} else {
  module.exports = {
    selectSemester,
    getCollegeSlug,
    saveMajorResponseSample,
    parseMajorOptionsFromResponse,
    cleanMajorsPayload,
    normalizeMajorItem,
    resolveInputFilePath,
    resolveOutputFilePath,
    resolveProjectPath,
    getEffectiveResourceSourceMode,
    shouldUseDirectTeacherResources,
    buildResourcesForClassSchedules,
    crawlDirectTeacherResources,
    mergeResourcesBySource,
    getResourceTypesFromIncludeScopes,
    resolveTermConfig,
    assertTermConfigBeforeCrawl
  };
}
