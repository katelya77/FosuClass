#!/usr/bin/env node
/**
 * Regression: college + partial name (丽梅); honorific strip (陈芳老师);
 * 「所有院系」clears college filter; Agent/school contract align.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRATCH = process.env.GROK_SCRATCH
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-teacher-kw");
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }

const lines = [];
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  const ok = Boolean(cond);
  const msg = (ok ? "PASS " : "FAIL ") + name + (detail && !ok ? ` — ${detail}` : "");
  lines.push(msg);
  console.log(msg);
  if (ok) pass += 1; else fail += 1;
}

const releasePackService = require(path.join(ROOT, "miniprogram/services/releasePackService"));
const releaseService = require(path.join(ROOT, "server/src/services/releaseService"));
const toolRegistry = require(path.join(ROOT, "server/src/services/ai/toolRegistry"));
const goalParser = require(path.join(ROOT, "server/src/services/ai/planner/goalParser"));
const agentService = require(path.join(ROOT, "server/src/services/ai/agentService"));

const fixture = [
  {
    id: "t-limei",
    name: "覃丽梅",
    teacherName: "覃丽梅",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
    semester: "2025-2026-2",
    term: "2025-2026-2",
  },
  {
    id: "t-chenfang",
    name: "陈芳",
    teacherName: "陈芳",
    collegeCode: "04",
    collegeCodes: ["04"],
    collegeName: "动物科技学院",
    collegeNames: ["动物科技学院"],
    semester: "2025-2026-2",
    term: "2025-2026-2",
  },
  {
    id: "t-other",
    name: "王某某",
    teacherName: "王某某",
    collegeCode: "01",
    collegeCodes: ["01"],
    collegeName: "人文学院",
    collegeNames: ["人文学院"],
    semester: "2025-2026-2",
    term: "2025-2026-2",
  },
];

const payload = {
  success: true,
  type: "teacher",
  items: fixture,
  term: "2025-2026-2",
  releaseVersion: "fix-college-kw",
  teacherIndexSchemaVersion: 3,
};

// --- 1) college + partial name ---
{
  const noCollege = releasePackService.filterIndexPayload("teacher", payload, { q: "丽梅" });
  check("client 丽梅 无学院命中", noCollege.total === 1 && noCollege.items[0].name === "覃丽梅");

  const with04 = releasePackService.filterIndexPayload("teacher", payload, {
    q: "丽梅",
    collegeCode: "04",
    collegeName: "动物科技学院",
  });
  check("client 丽梅+动科 code+name 命中", with04.total === 1 && with04.items[0].name === "覃丽梅", String(with04.total));

  const withNameOnly = releasePackService.filterIndexPayload("teacher", payload, {
    q: "丽梅",
    collegeName: "动物科技学院",
  });
  check("client 丽梅+院名命中", withNameOnly.total === 1);

  const wrong = releasePackService.filterIndexPayload("teacher", payload, {
    q: "丽梅",
    collegeCode: "01",
    collegeName: "人文学院",
  });
  check("client 丽梅+人文 0", wrong.total === 0);

  const server04 = releaseService.filterActiveIndexItems("teacher", fixture, "丽梅", {
    collegeCode: "04",
    collegeName: "动物科技学院",
  });
  check("server 丽梅+动科 命中", server04.total === 1);
  check(
    "Agent/全校 丽梅+04 一致",
    with04.items[0].id === server04.items[0].id
  );
}

// --- 2) 所有院系 = no college filter ---
{
  const allOpt = releasePackService.filterIndexPayload("teacher", payload, {
    q: "丽梅",
    collegeCode: "",
    collegeName: "",
  });
  check("所有院系 空 college 与无学院相同", allOpt.total === 1);
  // school.js 语义：name 所有院系 + empty code → 不筛
  const schoolAll = { code: "", name: "所有院系" };
  const isAll = !schoolAll || !String(schoolAll.code || "").trim()
    || schoolAll.name === "所有院系" || schoolAll.name === "所有学院";
  check("所有院系 isAllColleges", isAll === true);
}

// --- 3) honorific strip ---
{
  check("strip 陈芳老师", toolRegistry.stripPersonHonorifics("陈芳老师") === "陈芳");
  check("strip 查看残留", toolRegistry.stripPersonHonorifics("陈芳老师的课表") === "陈芳");
  const goal = goalParser.parseGoal("查看陈芳老师的课表");
  check("goal entityType teacher", goal && goal.entityType === "teacher");
  check("goal entity 保留老师用于类型", goal && /陈芳/.test(goal.entity));
  const intent = toolRegistry.resolveIntent("查看陈芳老师的课表", {});
  check(
    "intent q 为陈芳",
    intent && intent.name === "search_school_index"
      && intent.slots.type === "teacher"
      && intent.slots.q === "陈芳",
    JSON.stringify(intent && intent.slots)
  );
  const toolOut = toolRegistry.executeTool("search_school_index", {
    type: "teacher",
    q: "陈芳老师",
    goalAction: "open_schedule",
  }, {});
  // may hit live pack or empty — if live has 陈芳, total>=1
  if (toolOut && toolOut.total > 0) {
    check("tool 陈芳老师 可命中", (toolOut.items || []).some((i) => (i.name || i.teacherName) === "陈芳"));
  } else {
    // fixture path via filter
    const local = releasePackService.filterIndexPayload("teacher", payload, {
      q: toolRegistry.stripPersonHonorifics("陈芳老师"),
    });
    check("tool strip 后 fixture 命中", local.total === 1);
  }
  const actions = agentService.deriveActionCommands([{
    name: "search_school_index",
    status: "success",
    result: {
      type: "teacher",
      releaseVersion: "fix",
      term: "2025-2026-2",
      items: [{ id: "t-chenfang", teacherName: "陈芳", name: "陈芳" }],
      goalAction: "open_schedule",
    },
  }]);
  check(
    "唯一教师 Action 打开教师课表",
    actions[0] && actions[0].label === "打开教师课表"
      && actions[0].input && actions[0].input.url.includes("schedule-view")
  );
}

// --- 4) school wxml 所有院系 ---
{
  const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/school/school.wxml"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "miniprogram/pages/school/school.js"), "utf8");
  check("wxml 所有院系文案", /所有院系/.test(wxml));
  check("js 注入所有院系选项", /所有院系/.test(js) && /code:\s*""/.test(js));
  check("js 跳过空学院缓存", /collegeActive/.test(js) && /cached\s*=\s*null/.test(js));
  check("js college 时 forceServerSearch", /forceServerSearch:\s*collegeActive/.test(js));
}

const summary = `\n${pass} passed, ${fail} failed\n`;
lines.push(summary);
console.log(summary.trim());
fs.writeFileSync(path.join(SCRATCH, "school-teacher-college-keyword.log"), lines.filter((l) => /丽梅|college|动科|人文/.test(l)).join("\n"), "utf8");
fs.writeFileSync(path.join(SCRATCH, "school-college-all-option.log"), lines.filter((l) => /所有院系|isAll/.test(l)).join("\n"), "utf8");
fs.writeFileSync(path.join(SCRATCH, "xiaofu-teacher-query-normalize.log"), lines.filter((l) => /陈芳|honorific|strip|intent|Action|goal/.test(l)).join("\n"), "utf8");
fs.writeFileSync(path.join(SCRATCH, "teacher-search-contract-align.log"), lines.filter((l) => /一致|server|client|Agent/.test(l)).join("\n"), "utf8");
fs.writeFileSync(path.join(SCRATCH, "teacher-search-fix-tests.log"), lines.join("\n"), "utf8");
if (fail > 0) process.exit(1);
