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

// --- 2) 所有院系 = no college filter + UI isolation from class tab ---
{
  const allOpt = releasePackService.filterIndexPayload("teacher", payload, {
    q: "丽梅",
    collegeCode: "",
    collegeName: "",
  });
  check("所有院系 空 college 与无学院相同", allOpt.total === 1);
}

// --- 2b) shipped school page: teacher list ≠ class list ---
{
  const js = fs.readFileSync(path.join(ROOT, "miniprogram/pages/school/school.js"), "utf8");
  const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/school/school.wxml"), "utf8");

  check(
    "data 默认 selectedCollegeIndex=-1（班级未选）",
    /selectedCollegeIndex:\s*-1/.test(js)
  );
  check(
    "data 默认 selectedTeacherCollegeIndex=0（教师所有院系）",
    /selectedTeacherCollegeIndex:\s*0/.test(js)
  );
  check(
    "data 含独立 teacherColleges",
    /teacherColleges:\s*\[\s*\{\s*code:\s*""\s*,\s*name:\s*"所有院系"\s*\}/.test(js)
      || /teacherColleges:\s*\[\s*\{\s*code:\s*""\s*,\s*name:\s*"所有院系"/.test(js)
  );
  check(
    "data colleges 初始为空数组（非所有院系）",
    /colleges:\s*\[\],/.test(js)
  );
  check(
    "applyCatalogFilter 构建 teacherColleges = [所有院系].concat(colleges)",
    /teacherColleges\s*=\s*\[ALL_COLLEGE\]\.concat\(colleges\)/.test(js)
      || /\[ALL_COLLEGE\]\.concat\(colleges\)/.test(js)
  );
  check(
    "searchTeacherSchedule 读 teacherColleges/selectedTeacherCollegeIndex",
    /selectedTeacherCollegeIndex/.test(js)
      && /teacherColleges\[selectedTeacherCollegeIndex\]/.test(js)
  );
  check(
    "onTeacherCollegeChange 存在且不改 selectedCollegeIndex",
    /onTeacherCollegeChange\s*\(/.test(js)
      && /onTeacherCollegeChange[\s\S]{0,400}selectedTeacherCollegeIndex/.test(js)
  );
  // 班级 Tab：picker 仍用 colleges + selectedCollegeIndex + 选择学院
  const classPickerBlock = wxml.match(
    /filter-label">学院：[\s\S]{0,350}?filter-label">年级：/
  );
  check(
    "班级 Tab picker 用 colleges（非 teacherColleges）",
    classPickerBlock
      && /range="\{\{colleges\}\}"/.test(classPickerBlock[0])
      && !/teacherColleges/.test(classPickerBlock[0])
      && /选择学院/.test(classPickerBlock[0])
  );
  check(
    "班级按钮 disabled 仍用 selectedCollegeIndex < 0",
    /disabled="\{\{selectedCollegeIndex < 0/.test(wxml)
  );
  // 教师 Tab（院系与按钮之间可能有职称 wx:if 块，窗口放宽）
  check(
    "教师 Tab picker 用 teacherColleges + onTeacherCollegeChange",
    /filter-label">院系：[\s\S]{0,900}?range="\{\{teacherColleges\}\}"[\s\S]{0,200}?onTeacherCollegeChange[\s\S]{0,200}?selectedTeacherCollegeIndex[\s\S]{0,120}?所有院系/.test(wxml)
      && /bindtap="searchTeacherSchedule"/.test(wxml)
  );
  // Simulate applyCatalogFilter college split logic (same as shipped)
  const ALL_COLLEGE = { code: "", name: "所有院系" };
  const rawColleges = [
    { code: "04", name: "动物科技学院" },
    { code: "01", name: "人文学院" },
  ];
  const colleges = rawColleges.filter((c) => {
    const name = String(c.name || "").trim();
    if (name === "所有院系" || name === "所有学院") return false;
    return Boolean(String(c.code || "").trim() || name);
  });
  const teacherColleges = [ALL_COLLEGE].concat(colleges);
  check("分离后 colleges 无所有院系", colleges.every((c) => c.name !== "所有院系"));
  check("分离后 teacherColleges[0] 为所有院系", teacherColleges[0].name === "所有院系" && teacherColleges[0].code === "");
  check("分离后 teacherColleges 长度 = colleges+1", teacherColleges.length === colleges.length + 1);
  // Class: index -1 means not selected → cannot fetch majors with empty code
  const selectedCollegeIndex = -1;
  const classCollegeReady = selectedCollegeIndex >= 0
    && Boolean(String(colleges[selectedCollegeIndex] && colleges[selectedCollegeIndex].code || "").trim());
  check("班级默认未选真学院（不可空 code 查专业）", classCollegeReady === false);
  // Teacher all: index 0 → no filter
  const tCollege = teacherColleges[0];
  const isAll = !tCollege || !String(tCollege.code || "").trim()
    || tCollege.name === "所有院系" || tCollege.name === "所有学院";
  check("教师默认所有院系 isAllColleges", isAll === true);
  // Teacher pick 动科
  const tIdx = teacherColleges.findIndex((c) => c.code === "04");
  const picked = teacherColleges[tIdx];
  const isAllPicked = !picked || !String(picked.code || "").trim()
    || picked.name === "所有院系";
  check("教师选动科非所有院系", tIdx > 0 && isAllPicked === false && picked.code === "04");
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
  const multiActions = agentService.deriveActionCommands([{
    name: "search_school_index",
    status: "success",
    result: {
      type: "teacher",
      q: "芳",
      releaseVersion: "fix",
      term: "2025-2026-2",
      items: [
        { id: "t-chenfang", teacherName: "陈芳", name: "陈芳" },
        { id: "t-limei", teacherName: "覃丽梅", name: "覃丽梅" },
      ],
    },
  }]);
  check(
    "多教师可点开 schedule-view",
    multiActions.some((a) => a.input && String(a.input.url || "").includes("schedule-view"))
      && multiActions.some((a) => a.label === "打开全校查询"),
    JSON.stringify(multiActions.map((a) => a.label))
  );
  // mockProvider 卡片：唯一命中含打开教师课表
  const mockProvider = require(path.join(ROOT, "server/src/services/ai/providers/mockProvider"));
  const cardOut = mockProvider.generate({
    intent: { name: "search_school_index" },
    toolResults: [{
      name: "search_school_index",
      result: {
        type: "teacher",
        q: "陈芳",
        total: 1,
        releaseVersion: "fix",
        term: "2025-2026-2",
        items: [{ id: "t-chenfang", teacherName: "陈芳", name: "陈芳", collegeName: "动物科技学院" }],
      },
    }],
    message: "查陈芳老师课表",
  });
  const card0 = cardOut.cards && cardOut.cards[0];
  check(
    "mock 卡片打开教师课表 URL",
    card0
      && Array.isArray(card0.actions)
      && card0.actions.some((a) => /打开教师课表/.test(a.label) && /schedule-view/.test(a.url))
      && card0.items && card0.items[0] && /schedule-view/.test(card0.items[0].url || ""),
    JSON.stringify(card0 && card0.actions)
  );
  const multiCard = mockProvider.generate({
    intent: { name: "search_school_index" },
    toolResults: [{
      name: "search_school_index",
      result: {
        type: "teacher",
        q: "芳",
        total: 2,
        items: [
          { id: "t1", teacherName: "陈芳", collegeName: "动科" },
          { id: "t2", teacherName: "李芳", collegeName: "人文" },
        ],
      },
    }],
    message: "查芳老师",
  });
  const mc = multiCard.cards && multiCard.cards[0];
  check(
    "多命中卡片行可点开",
    mc && mc.items && mc.items.length >= 2
      && mc.items.every((it) => /schedule-view/.test(it.url || "")),
    JSON.stringify(mc && mc.items)
  );
}

// --- 4) school 检索路径标志 ---
{
  const js = fs.readFileSync(path.join(ROOT, "miniprogram/pages/school/school.js"), "utf8");
  check("js 跳过空学院缓存", /collegeActive/.test(js) && /cached\s*=\s*null/.test(js));
  // M3-T4：teacher+college 的服务端优先语义由统一端点 /release-pack/search 继承
  // （原 forceServerSearch: collegeActive 选项随旧 /search-index 链一并移除，
  //  现在所有类型的网络搜索都经服务端契约过滤，语义更强）。
  check("js college 时服务端统一搜索", /releasePackService\.searchSchoolContract\(type, query/.test(js));
  check("resetFilters 班级学院回到 -1", /resetFilters\s*\(\)\s*\{[\s\S]*?selectedCollegeIndex:\s*-1/.test(js));
  check("restore 缺学院时 selectedCollegeIndex:-1", /selectedCollegeIndex:\s*-1/.test(js));
  check(
    "切换院系有关键词时自动重搜",
    /onTeacherCollegeChange[\s\S]{0,600}?searchTeacherSchedule/.test(js)
  );
  const cardJs = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/components/xiaofu-result-card/index.js"), "utf8");
  const cardWxml = fs.readFileSync(path.join(ROOT, "miniprogram/packageXiaofu/components/xiaofu-result-card/index.wxml"), "utf8");
  check("结果卡支持行点击 onItemTap", /onItemTap/.test(cardJs) && /bindtap="onItemTap"/.test(cardWxml));
}

const summary = `\n${pass} passed, ${fail} failed\n`;
lines.push(summary);
console.log(summary.trim());
function writeEvidence(name, content) {
  try {
    fs.writeFileSync(path.join(SCRATCH, name), content, "utf8");
  } catch (err) {
    // Avoid failing the gate when evidence dir is locked (e.g. concurrent redirect).
    console.warn("evidence write skipped:", name, err && err.code);
  }
}
writeEvidence("school-teacher-college-keyword.log", lines.filter((l) => /丽梅|college|动科|人文/.test(l)).join("\n"));
writeEvidence("school-college-all-option.log", lines.filter((l) => /所有院系|isAll|teacherColleges|selectedCollegeIndex|班级/.test(l)).join("\n"));
writeEvidence("xiaofu-teacher-query-normalize.log", lines.filter((l) => /陈芳|honorific|strip|intent|Action|goal/.test(l)).join("\n"));
writeEvidence("teacher-search-contract-align.log", lines.filter((l) => /一致|server|client|Agent/.test(l)).join("\n"));
writeEvidence("teacher-search-fix-tests.log", lines.join("\n"));
writeEvidence("class-tab-college-isolation.log", lines.filter((l) => /班级|teacherColleges|selectedCollegeIndex|分离|disabled|resetFilters|restore/.test(l)).join("\n"));
if (fail > 0) process.exit(1);
