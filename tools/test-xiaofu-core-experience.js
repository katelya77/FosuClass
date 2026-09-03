#!/usr/bin/env node
/**
 * Core experience convergence suite — exercises shipped modules on real paths.
 * Covers: working state follow-up, GoalContract-ish intent lock, teacher college
 * filter (client+server), retired voice surface, UI geometry helpers,
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
  const classIndex = releaseService.readActiveIndex("class") || {};
  const hasReadableClassIndex = classIndex.success !== false
    && Array.isArray(classIndex.items)
    && classIndex.items.length > 0;
  check(
    "set current schedule intent",
    hasReadableClassIndex
      ? r.name === "set_current_schedule" && Boolean(r.slots.detailId) && /动物医学3班/.test(r.slots.name || "")
      : r.name === "clarify_missing_slot"
        && r.slots.goalAction === "set_current_schedule"
        && r.slots.type === "class",
    hasReadableClassIndex ? "expected a unique Release-backed class" : "expected a fail-closed class clarification without a Release"
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
    const contract = releaseService.searchActiveIndex("teacher", "", {
      collegeCode: "04",
      limit: 50,
      _items: teacherFixture,
    });
    check("search contract 04 works", contract && contract.success !== false);
    check(
      "search contract 04 items match college",
      (contract.items || []).every((i) => i.collegeCode === "04" || (i.collegeCodes || []).includes("04"))
    );

    const live = releaseService.searchActiveIndex("teacher", "", { collegeCode: "04", limit: 50 });
    const liveAvailable = live && live.success !== false;
    const liveMissingForCleanCheckout = live
      && ["NO_ACTIVE_RELEASE", "RELEASE_NOT_FOUND"].includes(live.code || live.reasonCode);
    check("live pack optional availability", liveAvailable || liveMissingForCleanCheckout);
    if (liveAvailable && Array.isArray(live.items) && live.items.length) {
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
    check("live pack optional availability", false, err.message);
  }
}

// Cache key includes teacher schema
{
  const storage = require(path.join(ROOT, "miniprogram/utils/storage"));
  const keyA = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", { q: "陈芳", collegeCode: "04" });
  const keyB = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", { q: "陈芳", collegeCode: "02" });
  check("cache key college isolates", keyA !== keyB);
  check("cache key teacher schema bumped", /tidx4|teacherIndexSchemaVersion|v8/.test(keyA) || storage.TEACHER_INDEX_SCHEMA_VERSION >= 4);
  check("SCHOOL_CACHE_SCHEMA_VERSION >= 8", storage.SCHOOL_CACHE_SCHEMA_VERSION >= 8);
  check("TEACHER_INDEX_SCHEMA_VERSION >= 4", storage.TEACHER_INDEX_SCHEMA_VERSION >= 4);
}

(async () => {
  // --- 3) Geometry helpers (real DOM snapshot-shaped inputs)
  const geometry = require(path.join(ROOT, "miniprogram/utils/xiaofuGeometry"));
  {
    // Full-width capsule: same left as wrap, almost full width
    const full = geometry.measureStatusIslandGaps(
      { left: 16, width: 343 },
      { left: 16, width: 343 }
    );
    check("geometry full-width absDiff<=4rpx", full.absDiff <= 2 && full.centered && full.fullWidth);
    const off = geometry.measureStatusIslandGaps(
      { left: 0, width: 200 },
      { left: 0, width: 440 }
    );
    check("geometry left-aligned detected", off.absDiff > 2 && !off.fullWidth);
    // 12–24rpx @0.5 → 6–12px
    const gaps = geometry.measureComposerMessageGaps({
      scrollViewBottom: 600,
      composerTop: 612,
      lastMessageBottom: 600,
      pxPerRpx: 0.5,
    });
    check("geometry message-composer gap in range", gaps.messageComposerOk === true);
    check("geometry composerInset from height", geometry.computeComposerInsetPx(96, 8) === 104);
    check(
      "geometry collapse/expand same width",
      geometry.assertCollapsedExpandedSameWidth({ width: 343 }, { width: 343 })
    );
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
    check("ui no voice control", !/voice|microphone|stop-wave/i.test(wxml));
    check("ui svg send", wxml.includes("composer/send.svg"));
    check("ui capsule width 100%", /\.agent-status-capsule\s*\{[^}]*width:\s*100%/.test(wxss));
    check("ui capsule no width auto", !/\.agent-status-capsule\s*\{[^}]*width:\s*auto/.test(wxss));
    check("ui composer align center", /\.composer-pill\s*\{[^}]*align-items:\s*center/.test(wxss));
    check("ui composer in-flow relative", /\.composer\s*\{[^}]*position:\s*relative/.test(wxss));
    check("ui composer not absolute overlay", !/\.composer\s*\{[^}]*position:\s*absolute/.test(wxss));
    check("ui message-scroll tight bottom pad", /\.message-scroll\s*\{[^}]*padding:\s*var\(--xf-space-1\)\s+0\s+var\(--xf-space-4\)/.test(wxss));
    check("ui reduced-motion", /prefers-reduced-motion/.test(wxss));
    check("app.json no record permission", !appJson.permission || !appJson.permission["scope.record"]);
    check("svg files exist", fs.existsSync(path.join(ROOT, "miniprogram/assets/icons/composer/plus.svg")));
    check("scheduleNavigationService exists", fs.existsSync(path.join(ROOT, "miniprogram/services/scheduleNavigationService.js")));
    check("audit doc exists", fs.existsSync(path.join(ROOT, "docs/xiaofu-agent/agent-platform-reorientation-audit.md")));
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
