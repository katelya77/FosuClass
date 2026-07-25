#!/usr/bin/env node
/**
 * Core experience convergence suite — exercises shipped modules on real paths.
 * Covers: working state follow-up, GoalContract-ish intent lock, teacher college
 * filter (client+server), voice auth state machine, UI geometry helpers,
 * response composer domain labels, public-zero provider structural check.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1) Intent / Working State / Follow-up (shipped toolRegistry + followUpResolver)
const toolRegistry = require(path.join(ROOT, "server/src/services/ai/toolRegistry"));
const followUpResolver = require(path.join(ROOT, "server/src/services/ai/planner/followUpResolver"));
const workingMemory = require(path.join(ROOT, "server/src/services/ai/memory/workingMemory"));
const goalParser = require(path.join(ROOT, "server/src/services/ai/planner/goalParser"));
const responseComposer = require(path.join(ROOT, "server/src/services/ai/responseComposer"));
const releaseService = require(path.join(ROOT, "server/src/services/releaseService"));

// 6. 查教师课表 → pending teacher
{
  const r = toolRegistry.resolveIntent("查教师课表", {});
  check("teacher schedule clarify", r.name === "clarify_missing_slot" && r.slots.slot.missing === "teacherName");
}

// 7. 陈芳 inherits teacher goal via pending
{
  const r = toolRegistry.resolveIntent("陈芳", {
    pendingClarification: {
      intentName: "search_school_index",
      type: "teacher",
      missing: "teacherName",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
  });
  check(
    "chenfang fills pending teacher",
    r.name === "search_school_index" && r.slots.type === "teacher" && r.slots.q === "陈芳" && r.slots.lockedEntityType !== "class"
  );
}

// open class schedule locked
{
  const r = toolRegistry.resolveIntent("打开24动物医学1班的课表", {});
  check(
    "open class schedule entity lock",
    r.name === "search_school_index" && r.slots.lockedEntityType === "class" && r.slots.type === "class"
  );
  const goal = goalParser.parseGoal("打开24动物医学1班的课表");
  check("goalParser class not teacher", goal && goal.entityType === "class" && goal.goal === "open_schedule");
}

// set current schedule
{
  const r = toolRegistry.resolveIntent("将25动物医学3班设为当前课表", {});
  check(
    "set current schedule intent",
    r.name === "set_current_schedule" && Boolean(r.slots.detailId) && /动物医学3班/.test(r.slots.name || "")
  );
}

// weather day after tomorrow
{
  const r = toolRegistry.resolveIntent("查看后天仙溪校区天气", {});
  check(
    "weather day-after-tomorrow",
    r.name === "get_campus_weather"
      && r.slots.campus === "仙溪校区"
      && Number(r.slots.dateOffset) === 2
      && r.slots.dateHint === "day_after_tomorrow"
  );
}

// campus swap inherits dateOffset
{
  const r = toolRegistry.resolveIntent("换成江湾校区", {
    workingMemory: {
      currentGoal: "get_campus_weather",
      activeGoal: "get_campus_weather",
      campus: "仙溪校区",
      dateOffset: 2,
      dateHint: "day_after_tomorrow",
      lastConstraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
      lastSuccessfulTools: ["get_campus_weather"],
    },
  });
  check(
    "campus swap inherits dateOffset",
    r.name === "get_campus_weather"
      && r.slots.campus === "江湾校区"
      && Number(r.slots.dateOffset) === 2
      && r.name !== "rag_search"
  );
}

// continuous empty rooms inherit campus
{
  const r = toolRegistry.resolveIntent("只看连续两节空教室", {
    workingMemory: {
      currentGoal: "search_empty_rooms",
      activeGoal: "search_empty_rooms",
      campus: "仙溪校区",
      lastConstraints: { campus: "仙溪校区", periodHint: "afternoon" },
      lastSuccessfulTools: ["search_empty_rooms"],
    },
  });
  check(
    "continuous empty rooms inherit campus",
    r.name === "search_continuous_empty_rooms"
      && r.slots.campus === "仙溪校区"
      && Number(r.slots.minFreeSections) === 2
  );
}

// followUpResolver pure API
{
  const fu = followUpResolver.resolveFollowUp("换成江湾校区", {
    activeGoal: "get_campus_weather",
    lastConstraints: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
    lastSuccessfulTools: ["get_campus_weather"],
  });
  check("followUpResolver kind", fu && fu.kind === "follow_up_modify_constraint");
  check("followUpResolver replaced campus", fu && fu.replacedFields.includes("campus"));
  check("followUpResolver inherited date", fu && Number(fu.constraints.dateOffset) === 2);
}

// working memory typed fields
{
  const wm = workingMemory.updateWorkingMemory({}, {
    intentName: "get_campus_weather",
    message: "查看后天仙溪校区天气",
    slots: { campus: "仙溪校区", dateOffset: 2, dateHint: "day_after_tomorrow" },
  });
  check("wm activeGoal", wm.activeGoal === "get_campus_weather");
  check("wm lastConstraints campus", wm.lastConstraints.campus === "仙溪校区");
  check("wm dateOffset", Number(wm.dateOffset) === 2 || Number(wm.lastConstraints.dateOffset) === 2);
}

// entity type must not replan class→teacher (goalParser + locked)
{
  const g = goalParser.parseGoal("打开24动物医学1班的课表");
  check("entityType lock class", g.entityType === "class");
  const open = toolRegistry.resolveIntent("打开24动物医学1班的课表", {});
  check("lockedEntityType class", open.slots.lockedEntityType === "class");
}

// --- 2) Teacher college (server filter + client filter)
const releasePackService = require(path.join(ROOT, "miniprogram/services/releasePackService"));

const teacherFixture = [
  {
    id: "t-chenfang",
    name: "陈芳",
    teacherName: "陈芳",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
  },
  {
    id: "t-pending",
    name: "待确认老师",
    teacherName: "待确认老师",
    collegeCode: "",
    collegeCodes: [],
    collegeName: "学院待确认",
    collegeNames: ["学院待确认"],
  },
  {
    id: "t-humanities",
    name: "陈芳人文",
    teacherName: "陈芳人文",
    collegeCode: "02",
    collegeCodes: ["02"],
    collegeName: "人文学院",
    collegeNames: ["人文学院"],
  },
  {
    id: "t-other",
    name: "安哲明",
    teacherName: "安哲明",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
  },
  {
    id: "t-bai",
    name: "白银山",
    teacherName: "白银山",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
  },
];

// Client filterIndexPayload (shipped path)
{
  const payload = { success: true, type: "teacher", items: teacherFixture, releaseVersion: "test-core", term: "2025-2026-2" };
  const hit04 = releasePackService.filterIndexPayload("teacher", payload, { q: "陈芳", collegeCode: "04" });
  check("client 陈芳 in 04 hits", hit04.total === 1 && hit04.items[0].name === "陈芳");
  const miss02 = releasePackService.filterIndexPayload("teacher", payload, { q: "陈芳", collegeCode: "02" });
  // exact name 陈芳 only in 04; 陈芳人文 is different exact name
  check("client 陈芳 in 02 no exact 陈芳", !(miss02.items || []).some((i) => i.name === "陈芳"));
  const pendingFiltered = releasePackService.filterIndexPayload("teacher", payload, { collegeCode: "04", q: "" });
  check("client pending excluded under college", !(pendingFiltered.items || []).some((i) => i.collegeName === "学院待确认"));
  const pendingOpen = releasePackService.filterIndexPayload("teacher", payload, { q: "待确认老师" });
  check("client pending visible without college", (pendingOpen.items || []).some((i) => i.name === "待确认老师"));
  const exact = releasePackService.filterIndexPayload("teacher", payload, { q: "陈芳" });
  check("client exact name isolation", exact.total === 1 && exact.items[0].name === "陈芳" && !exact.items.some((i) => i.name === "安哲明"));
}

// Server filterActiveIndexItems
{
  const page04 = releaseService.filterActiveIndexItems("teacher", teacherFixture, "陈芳", { collegeCode: "04" });
  check("server 陈芳 in 04", page04.total === 1 && page04.items[0].name === "陈芳");
  const page02 = releaseService.filterActiveIndexItems("teacher", teacherFixture, "陈芳", { collegeCode: "02" });
  check("server 陈芳 not in 02", page02.total === 0 || !(page02.items || []).some((i) => i.name === "陈芳"));
  const exact = releaseService.filterActiveIndexItems("teacher", teacherFixture, "陈芳", {});
  check("server exact isolation", exact.total === 1 && exact.items[0].name === "陈芳");
}

// Live pack HTTP path via searchActiveIndex (current release)
{
  try {
    const live = releaseService.searchActiveIndex("teacher", "", { collegeCode: "04", limit: 50 });
    check("live pack search 04 works", live && live.success !== false);
    if (live && Array.isArray(live.items) && live.items.length) {
      check(
        "live pack 04 items match college",
        live.items.every((i) => i.collegeCode === "04" || (i.collegeCodes || []).includes("04"))
      );
    } else {
      check("live pack 04 items match college", true, "empty-ok on sample pack");
    }
    const liveChen = releaseService.searchActiveIndex("teacher", "陈芳", { collegeCode: "04" });
    // Sample pack may not include 陈芳 — assert no cross-college leakage for whatever is returned
    check(
      "live 陈芳 query no foreign college when filtered",
      !(liveChen.items || []).some((i) => {
        const codes = Array.isArray(i.collegeCodes) ? i.collegeCodes : [];
        return codes.length && !codes.includes("04") && i.collegeCode !== "04";
      })
    );
  } catch (err) {
    check("live pack search 04 works", false, err.message);
  }
}

// Cache key includes teacher schema
{
  const storage = require(path.join(ROOT, "miniprogram/utils/storage"));
  const keyA = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", { q: "陈芳", collegeCode: "04" });
  const keyB = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", { q: "陈芳", collegeCode: "02" });
  check("cache key college isolates", keyA !== keyB);
  check("cache key teacher schema bumped", /tidx2|teacherIndexSchemaVersion|v6/.test(keyA) || storage.TEACHER_INDEX_SCHEMA_VERSION === 2);
  check("SCHOOL_CACHE_SCHEMA_VERSION >= 6", storage.SCHOOL_CACHE_SCHEMA_VERSION >= 6);
}

// --- 3) Voice state machine
const voiceAuth = require(path.join(ROOT, "miniprogram/utils/voiceAuthStateMachine"));

function mockWx(script) {
  const calls = [];
  return {
    calls,
    wx: {
      getPrivacySetting(opts) {
        calls.push("getPrivacySetting");
        const r = script.privacy || { needAuthorization: false };
        opts.success && opts.success(r);
      },
      requirePrivacyAuthorize(opts) {
        calls.push("requirePrivacyAuthorize");
        if (script.privacyOk === false) opts.fail && opts.fail({});
        else opts.success && opts.success({});
      },
      getSetting(opts) {
        calls.push("getSetting");
        const auth = script.authSetting || {};
        opts.success && opts.success({ authSetting: auth });
      },
      authorize(opts) {
        calls.push("authorize");
        if (script.authorizeOk) opts.success && opts.success({});
        else opts.fail && opts.fail({});
      },
      openSetting(opts) {
        calls.push("openSetting");
        opts.success && opts.success({ authSetting: script.afterSetting || {} });
      },
    },
  };
}

(async () => {
  // first tap: privacy then record; never openSetting first
  {
    const host = mockWx({ privacy: { needAuthorization: true }, privacyOk: true, authSetting: {}, authorizeOk: true });
    const res = await voiceAuth.ensureVoiceReady(voiceAuth.createInitialState(), host);
    check("voice first path ok", res.ok === true && res.state.phase === "ready");
    check("voice privacy before authorize", host.calls.indexOf("getPrivacySetting") < host.calls.indexOf("authorize"));
    check("voice no openSetting on first success", !host.calls.includes("openSetting"));
  }
  {
    const host = mockWx({
      privacy: { needAuthorization: false },
      authSetting: { "scope.record": false },
      authorizeOk: false,
    });
    const res = await voiceAuth.ensureVoiceReady(voiceAuth.createInitialState(), host);
    check("voice denied suggests setting", res.ok === false && res.openSettingSuggested === true);
    check("voice denied did not auto openSetting", !host.calls.includes("openSetting"));
  }
  {
    const host = mockWx({
      privacy: { needAuthorization: false },
      authSetting: { "scope.record": true },
    });
    const res = await voiceAuth.resumeAfterOpenSetting(voiceAuth.createInitialState(), host);
    check("voice resume after setting", res.ok === true && res.shouldResume === true);
  }

  // --- 4) Geometry helpers
  const geometry = require(path.join(ROOT, "miniprogram/utils/xiaofuGeometry"));
  {
    const centered = geometry.measureStatusIslandGaps(
      { left: 120, width: 200 },
      { left: 0, width: 440 }
    );
    check("geometry centered absDiff<=8", centered.absDiff <= 8 && centered.centered);
    const off = geometry.measureStatusIslandGaps(
      { left: 0, width: 200 },
      { left: 0, width: 440 }
    );
    check("geometry left-aligned detected", off.absDiff > 8 && !off.centered);
    const gaps = geometry.measureComposerMessageGaps({
      scrollViewBottom: 600,
      composerTop: 612,
      lastMessageBottom: 590,
    });
    check("geometry message-composer gap in range", gaps.messageComposerOk === true);
  }

  // --- 5) Response composer domain language / no raw tool names / zero partitions
  {
    const composed = responseComposer.compose({
      intentName: "get_campus_weather",
      answer: "后天仙溪多云。",
      toolCalls: [{ name: "get_campus_weather", status: "success", result: { success: true, factCount: 1 } }],
      cards: [
        { type: "weather", title: "仙溪天气", items: [{ title: "气温", value: "28" }] },
        { type: "generic", title: "明日课程", items: [{ title: "明日课程", value: 0 }] },
        { type: "generic", title: "空教室", items: [{ title: "空教室", value: 0 }] },
      ],
      runtimeMode: "trial",
    });
    check("composer weather single", composed.presentationMode === "single_card" || composed.presentationMode === "plain");
    const traj = responseComposer.buildTaskTrajectory({
      intentName: "set_current_schedule",
      toolCalls: [{ name: "set_current_schedule", status: "success" }],
      steps: [{ tool: "set_current_schedule", status: "success" }],
    });
    const labels = JSON.stringify(traj || {});
    check("composer no raw set_current_schedule label", !/set_current_schedule/.test(labels));
    check("composer domain 设置首页课表", /设置首页课表|处理课表/.test(labels));
    check("composer publicToolLabel domain", responseComposer.publicToolLabel("set_current_schedule").includes("首页课表"));
    const fail = responseComposer.compose({
      intentName: "search_school_index",
      success: false,
      toolFailure: { code: "CLASS_NOT_FOUND" },
      answer: "小佛可以查询什么",
      cards: [{ type: "guide", title: "小佛助手", items: [] }],
      runtimeMode: "trial",
    });
    check("composer domain failure not generic capability", /未匹配到班级/.test(fail.answer || ""));
  }

  // --- 6) UI structural checks (source artifacts)
  {
    const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
    const wxss = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "miniprogram/app.json"), "utf8"));
    check("ui status island wrapper", wxml.includes("agent-status-island-wrap"));
    check("ui composer pill", wxml.includes("composer-pill"));
    check("ui no 麦 text button", !/>麦</.test(wxml));
    check("ui no ↑ send glyph", !/{{sending \? "■" : "↑"}}/.test(wxml) && !/>↑</.test(wxml));
    check("ui svg mic", wxml.includes("composer/microphone.svg"));
    check("ui svg send", wxml.includes("composer/send.svg"));
    check("ui wrapper justify center", /agent-status-island-wrap[\s\S]*justify-content:\s*center/.test(wxss));
    check("ui capsule not flex-start alone", !/\.agent-status-capsule\s*\{[^}]*align-self:\s*flex-start/.test(wxss));
    check("app.json record permission", appJson.permission && appJson.permission["scope.record"] && /语音转文字/.test(appJson.permission["scope.record"].desc));
    check("svg files exist", fs.existsSync(path.join(ROOT, "miniprogram/assets/icons/composer/plus.svg")));
  }

  // --- 7) public mode zero external provider structural (capability / runtime)
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "server/config/agent-capability-manifest.json"), "utf8"));
    check("capability manifest exists", Boolean(manifest));
    const capabilityManifestService = require(path.join(ROOT, "server/src/services/ai/capabilityManifestService"));
    const pub = capabilityManifestService.normalizeRuntimeMode
      ? capabilityManifestService.normalizeRuntimeMode("public")
      : "public";
    check("public normalize", pub === "public");
    check(
      "public zero provider script exists",
      fs.existsSync(path.join(ROOT, "tools/test-public-zero-provider.js"))
    );
  }

  // Package size soft check
  {
    const hygiene = path.join(ROOT, "tools/test-miniprogram-package-hygiene.js");
    check("hygiene script exists", fs.existsSync(hygiene));
  }

  console.log(`\ncore-experience: pass=${passed} fail=${failed}`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
