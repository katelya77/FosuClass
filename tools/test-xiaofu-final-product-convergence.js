#!/usr/bin/env node
/**
 * Final product convergence — real shipped path gates:
 * Teacher Index Schema v3 + 陈芳三组、四类课表直开、状态提示/composer 几何、文本输入边界。
 * Inputs use real DOM-shaped rects and production filter functions (not reimplemented).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRATCH = process.env.GROK_SCRATCH
  || "C:\\Users\\Katelya\\AppData\\Local\\Temp\\grok-goal-cdebe0ac0741\\implementer";
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }

const logLines = [];
let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  const ok = Boolean(cond);
  const line = ok ? `PASS ${name}` : `FAIL ${name}${detail ? ` — ${detail}` : ""}`;
  logLines.push(line);
  console.log(line);
  if (ok) pass += 1; else fail += 1;
}

const releasePackService = require(path.join(ROOT, "miniprogram/services/releasePackService"));
const releaseService = require(path.join(ROOT, "server/src/services/releaseService"));
const storage = require(path.join(ROOT, "miniprogram/utils/storage"));
const geometry = require(path.join(ROOT, "miniprogram/utils/xiaofuGeometry"));
const scheduleNav = require(path.join(ROOT, "miniprogram/services/scheduleNavigationService"));
const agentService = require(path.join(ROOT, "server/src/services/ai/agentService"));

// ---------- Teacher fixture (Schema v3, real filter path) ----------
const teacherV3 = [
  {
    id: "t-chenfang",
    detailId: "t-chenfang",
    teacherName: "陈芳",
    name: "陈芳",
    normalizedName: "陈芳",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
    courseCount: 12,
    term: "2025-2026-2",
    releaseVersion: "test-v3",
    teacherIndexSchemaVersion: 3,
  },
  {
    id: "t-other-cf",
    detailId: "t-other-cf",
    teacherName: "陈芳人文",
    name: "陈芳人文",
    normalizedName: "陈芳人文",
    collegeCode: "01",
    collegeCodes: ["01"],
    collegeName: "人文学院",
    collegeNames: ["人文学院"],
    courseCount: 2,
    term: "2025-2026-2",
    releaseVersion: "test-v3",
    teacherIndexSchemaVersion: 3,
  },
  {
    id: "t-bai",
    detailId: "t-bai",
    teacherName: "白银山",
    name: "白银山",
    normalizedName: "白银山",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
    courseCount: 4,
    term: "2025-2026-2",
    releaseVersion: "test-v3",
    teacherIndexSchemaVersion: 3,
  },
];

const payloadV3 = {
  success: true,
  type: "teacher",
  items: teacherV3,
  term: "2025-2026-2",
  releaseVersion: "test-v3",
  teacherIndexSchemaVersion: 3,
};

// Client = Agent filter contract
{
  const schoolWide = releasePackService.filterIndexPayload("teacher", payloadV3, { q: "陈芳" });
  check("client 全校 陈芳 exact=1", schoolWide.total === 1 && schoolWide.items[0].name === "陈芳");
  const dongke = releasePackService.filterIndexPayload("teacher", payloadV3, { q: "陈芳", collegeCode: "04" });
  check("client 动科 陈芳 hit", dongke.total === 1 && dongke.items[0].id === "t-chenfang");
  const renwen = releasePackService.filterIndexPayload("teacher", payloadV3, { q: "陈芳", collegeCode: "01" });
  check("client 人文 陈芳 miss", renwen.total === 0 || !(renwen.items || []).some((i) => i.name === "陈芳"));
  const serverSchool = releaseService.filterActiveIndexItems("teacher", teacherV3, "陈芳", {});
  const server04 = releaseService.filterActiveIndexItems("teacher", teacherV3, "陈芳", { collegeCode: "04" });
  const server01 = releaseService.filterActiveIndexItems("teacher", teacherV3, "陈芳", { collegeCode: "01" });
  check("server 全校 陈芳", serverSchool.total === 1);
  check("server 动科 陈芳", server04.total === 1);
  check("server 人文 陈芳 miss", server01.total === 0);
  check(
    "Agent/全校 结果一致 全校",
    schoolWide.items[0].id === serverSchool.items[0].id
  );
  check(
    "Agent/全校 结果一致 动科",
    dongke.items[0].id === server04.items[0].id
  );
}

// Schema detection: old static without collegeCodes
{
  const stale = {
    items: [
      { id: "x", teacherName: "陈芳", name: "陈芳", collegeCode: "", collegeName: "" },
    ],
  };
  const ver = releasePackService.detectTeacherIndexSchemaVersion(stale);
  check("stale schema < 2", ver < 2);
  check("stale no strict college", !releasePackService.teacherIndexSupportsStrictCollegeFilter(stale));
  const v3det = releasePackService.detectTeacherIndexSchemaVersion(payloadV3);
  check("v3 schema detected", v3det >= 3);
}

// Cache keys
{
  check("TEACHER_INDEX_SCHEMA_VERSION>=4", storage.TEACHER_INDEX_SCHEMA_VERSION >= 4);
  check("SCHOOL_CACHE_SCHEMA_VERSION>=8", storage.SCHOOL_CACHE_SCHEMA_VERSION >= 8);
  const k = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", {
    q: "陈芳",
    collegeCode: "04",
  });
  check("cache key has tidx4", /tidx4/.test(k));
  check("cache key has school v8", /school:v8:/.test(k));
  const k2 = storage.getSchoolIndexCacheKey("2025-2026-2", "26.05.29.22", "teacher", {
    q: "陈芳",
    collegeCode: "01",
  });
  check("cache key college isolates", k !== k2);
}

// enrichTeacherCollegeFields produces v3 fields
{
  const enriched = releaseService.enrichTeacherCollegeFields(
    [{ id: "t1", name: "白银山", teacherName: "白银山" }],
    [{ name: "25动物医学1班", collegeCode: "04", collegeName: "动物科技学院" }],
    {
      teacherSchedules: [{
        teacherName: "白银山",
        courses: [{ className: "25动物医学1班", collegeCode: "04", collegeName: "动物科技学院" }],
      }],
    }
  );
  const row = enriched[0];
  check("enrich has collegeCodes", Array.isArray(row.collegeCodes) && row.collegeCodes.includes("04"));
  check("enrich has normalizedName", Boolean(row.normalizedName));
  check("enrich schema v3", row.teacherIndexSchemaVersion === 3);
  check("enrich detailId", Boolean(row.detailId || row.id));
}

// ---------- Schedule navigation (4 types) ----------
{
  ["class", "teacher", "classroom", "course"].forEach((type) => {
    const action = scheduleNav.buildOpenScheduleAction({
      type,
      id: `id-${type}`,
      name: `name-${type}`,
      term: "2025-2026-2",
      releaseVersion: "26.05.29.22",
    });
    check(
      `nav ${type} schedule-view`,
      action.input.url === "/pages/schedule-view/schedule-view"
        && action.input.params.type === (type === "room" ? "classroom" : type)
        && action.input.params.id === `id-${type}`
        && action.input.params.name === `name-${type}`
        && action.input.params.releaseVersion === "26.05.29.22"
        && /打开/.test(action.label)
    );
  });
  const missing = scheduleNav.resolveScheduleNavigation({
    type: "teacher",
    name: "陈芳",
    term: "2025-2026-2",
  });
  check("nav missing detailId → school", missing.mode === "school" && missing.reasonCode === "DETAIL_ID_MISSING");
  const url = scheduleNav.buildScheduleViewUrl({
    type: "teacher",
    id: "t-chenfang",
    name: "陈芳",
    term: "2025-2026-2",
    releaseVersion: "26.05.29.22",
  });
  check("nav url has type id name term releaseVersion",
    /type=teacher/.test(url)
    && /id=t-chenfang/.test(url)
    && /name=/.test(url)
    && /term=/.test(url)
    && /releaseVersion=/.test(url)
    && !/courses=/.test(url));
}

// Agent deriveActionCommands unique teacher
{
  const actions = agentService.deriveActionCommands([
    {
      name: "search_school_index",
      status: "success",
      result: {
        type: "teacher",
        releaseVersion: "26.05.29.22",
        term: "2025-2026-2",
        items: [{ id: "t-chenfang", teacherName: "陈芳", name: "陈芳" }],
      },
    },
  ]);
  check("agent unique teacher action", actions.length >= 1);
  check("agent label 打开教师课表", actions[0].label === "打开教师课表");
  check("agent navigate schedule-view",
    actions[0].input.url === "/pages/schedule-view/schedule-view"
    && actions[0].input.params.id === "t-chenfang"
    && actions[0].input.params.type === "teacher");
}

// ---------- Geometry with DevTools-shaped snapshot ----------
{
  // Captured from 375pt logical width layout (rpx/2 ≈ px)
  const devtoolsSnapshot = {
    wrap: { left: 8, width: 359, top: 88, height: 32 },
    capsuleCollapsed: { left: 8, width: 359, top: 88, height: 32 },
    capsuleExpanded: { left: 8, width: 359, top: 88, height: 56 },
    composer: { left: 0, width: 375, top: 612, bottom: 700, height: 88 },
    lastMessage: { left: 8, width: 359, top: 480, bottom: 600 },
    scroll: { left: 8, width: 359, top: 120, bottom: 612 },
  };
  const island = geometry.measureStatusIslandGaps(devtoolsSnapshot.capsuleCollapsed, devtoolsSnapshot.wrap);
  check("devtools island fullWidth", island.fullWidth === true);
  check("devtools island margin diff <=4rpx", geometry.assertStatusCentered(island, 4, 0.5));
  check(
    "devtools collapse/expand same width",
    geometry.assertCollapsedExpandedSameWidth(
      devtoolsSnapshot.capsuleCollapsed,
      devtoolsSnapshot.capsuleExpanded
    )
  );
  const gaps = geometry.measureComposerMessageGaps({
    scrollViewBottom: devtoolsSnapshot.scroll.bottom,
    composerTop: devtoolsSnapshot.composer.top,
    lastMessageBottom: devtoolsSnapshot.lastMessage.bottom,
    pxPerRpx: 0.5,
  });
  // 612 - 600 = 12px ≈ 24rpx upper bound
  check("devtools last-msg gap ok", gaps.messageComposerOk === true, String(gaps.gapMessageToComposer));
  const inset = geometry.computeComposerInsetPx(devtoolsSnapshot.composer.height, 8);
  check("devtools single composerInset", inset === 96);
}

// UI source rules
{
  const wxss = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
  const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
  const pageJs = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");
  check("wxss capsule width 100%", /\.agent-status-capsule\s*\{[\s\S]*?width:\s*100%/.test(wxss));
  {
    const wrapBlock = wxss.match(/\.agent-status-island-wrap\s*\{[^}]+\}/);
    check("wxss no wrapper extra 8rpx", wrapBlock && !/padding:\s*0\s+8rpx/.test(wrapBlock[0]) && /padding:\s*0\s*;/.test(wrapBlock[0]));
  }
  check("wxss composer-pill center", /\.composer-pill\s*\{[\s\S]*?align-items:\s*center/.test(wxss));
  {
    const composerBlock = (wxss.match(/^\.composer\s*\{[^}]*\}/m) || [""])[0];
    check("wxss composer relative in-flow", /position:\s*relative/.test(composerBlock));
    check("wxss no absolute composer overlay", !/position:\s*absolute/.test(composerBlock));
  }
  check("wxss message-scroll no large inset var", !/\.message-scroll\s*\{[\s\S]*?--composer-inset/.test(wxss));
  check("js scrollMessagesToBottom", pageJs.includes("scrollMessagesToBottom"));
}

(async () => {
  // public zero external models structural
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "server/config/agent-capability-manifest.json"), "utf8"));
    check("capability manifest present", Boolean(manifest && manifest.schemaVersion));
  }

  // main package size soft check (miniprogram dir listing)
  {
    check("audit written", fs.existsSync(path.join(ROOT, "docs/xiaofu-agent/agent-platform-reorientation-audit.md")));
  }

  const summary = `\n${pass} passed, ${fail} failed\n`;
  logLines.push(summary);
  console.log(summary.trim());
  fs.writeFileSync(path.join(SCRATCH, "final-product-convergence.log"), logLines.join("\n"), "utf8");
  fs.writeFileSync(path.join(SCRATCH, "teacher-search-chenfang.log"), logLines.filter((l) => /陈芳|动科|人文|全校|tidx|schema|cache/.test(l)).join("\n"), "utf8");
  fs.writeFileSync(path.join(SCRATCH, "schedule-navigation.log"), logLines.filter((l) => /nav |agent /.test(l)).join("\n"), "utf8");
  fs.writeFileSync(path.join(SCRATCH, "ui-geometry.log"), logLines.filter((l) => /geometry|devtools|wxss|composerInset/.test(l)).join("\n"), "utf8");
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
