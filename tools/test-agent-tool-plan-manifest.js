#!/usr/bin/env node
/**
 * M6-T1：意图→工具映射单源化契约测试。
 * buildPlanForIntent 的规划候选工具集必须严格等于
 * Intent ∩ Skill ∩ Runtime ∩ Principal ∩ Environment 五因子交集（只收不放），
 * 且唯一来源是 capability manifest（server/config/agent-capability-manifest.json）。
 *
 * 纯 Node、无框架、无网络。manifest 单源证据通过子进程注入 fixture manifest
 * （克隆真实 manifest 后仅改 allowedTools，无凭据形态字符串）完成：
 * 改 fixture 即改变计划，无需改代码。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const toolRegistry = require(path.join(ROOT, "server/src/services/ai/toolRegistry.js"));
const capabilityManifestService = require(path.join(ROOT, "server/src/services/ai/capabilityManifestService.js"));
const capabilityRouter = require(path.join(ROOT, "server/src/services/ai/capabilityRouter.js"));
const rawManifest = require(path.join(ROOT, "server/config/agent-capability-manifest.json"));

const { buildPlanForIntent } = toolRegistry;

// ---------- fixture 子进程：注入修改过的 manifest 后再加载 toolRegistry ----------
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-tool-plan-manifest-"));
const childScript = path.join(tempDir, "fixture-child.js");
fs.writeFileSync(childScript, `
const path = require("path");
const fs = require("fs");
const root = process.env.FOSU_TEST_ROOT;
const manifestPath = require.resolve(path.join(root, "server/config/agent-capability-manifest.json"));
const modified = JSON.parse(fs.readFileSync(process.env.FOSU_TEST_MANIFEST, "utf8"));
require.cache[manifestPath] = {
  id: manifestPath,
  filename: manifestPath,
  loaded: true,
  exports: modified,
  paths: module.paths,
};
const toolRegistry = require(path.join(root, "server/src/services/ai/toolRegistry.js"));
const input = JSON.parse(process.env.FOSU_TEST_INPUT);
const plan = toolRegistry.buildPlanForIntent(input.intent, input.message || "", input.context || {});
process.stdout.write(JSON.stringify(plan.map((step) => step.toolName)));
`);

function planWithManifestFixture(mutate, intent, message, context) {
  const fixture = JSON.parse(JSON.stringify(rawManifest));
  mutate(fixture);
  const fixturePath = path.join(tempDir, `fixture-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const result = spawnSync(process.execPath, [childScript], {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      FOSU_TEST_ROOT: ROOT,
      FOSU_TEST_MANIFEST: fixturePath,
      FOSU_TEST_INPUT: JSON.stringify({ intent, message, context: context || {} }),
    }),
  });
  assert.strictEqual(result.status, 0, `fixture child failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function toolNames(plan) {
  return plan.map((step) => step.toolName);
}

// ---------- fixture 子进程：capabilityRouter（M6-T2 兜底路由 manifest 派生证据） ----------
const routerChildScript = path.join(tempDir, "fixture-router-child.js");
fs.writeFileSync(routerChildScript, `
const path = require("path");
const fs = require("fs");
const root = process.env.FOSU_TEST_ROOT;
const manifestPath = require.resolve(path.join(root, "server/config/agent-capability-manifest.json"));
const modified = JSON.parse(fs.readFileSync(process.env.FOSU_TEST_MANIFEST, "utf8"));
require.cache[manifestPath] = {
  id: manifestPath,
  filename: manifestPath,
  loaded: true,
  exports: modified,
  paths: module.paths,
};
const capabilityRouter = require(path.join(root, "server/src/services/ai/capabilityRouter.js"));
const input = JSON.parse(process.env.FOSU_TEST_INPUT);
const route = capabilityRouter.routeCapabilities(input);
process.stdout.write(JSON.stringify({
  candidateTools: route.candidateTools,
  skillIds: route.skillIds,
  routeReason: route.routeReason,
}));
`);

function routeWithManifestFixture(mutate, input) {
  const fixture = JSON.parse(JSON.stringify(rawManifest));
  mutate(fixture);
  const fixturePath = path.join(tempDir, `fixture-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const result = spawnSync(process.execPath, [routerChildScript], {
    cwd: ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      FOSU_TEST_ROOT: ROOT,
      FOSU_TEST_MANIFEST: fixturePath,
      FOSU_TEST_INPUT: JSON.stringify(input || {}),
    }),
  });
  assert.strictEqual(result.status, 0, `router fixture child failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// ---------- 分组运行器 ----------
const groups = [];
function group(name, fn) {
  groups.push({ name, fn });
}

// G1 对外形态与既有编排兼容
group("G1 形态与签名兼容", () => {
  // 签名：context 可省略
  const plan = buildPlanForIntent({ name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.ok(Array.isArray(plan) && plan.length === 1, "context 省略时仍返回计划");
  // 步骤形态：{ toolName: string, args: object, reason: string }
  [
    buildPlanForIntent({ name: "campus_multi_step_advice", slots: {} }, "明天有课吗，顺便看天气和附近地点"),
    buildPlanForIntent({ name: "manage_course_reminders", slots: {} }, "上课前20分钟提醒我"),
    buildPlanForIntent({ name: "course_action_advice", slots: {} }, "下一节课什么时候出发"),
  ].forEach((steps) => {
    steps.forEach((step) => {
      assert.strictEqual(typeof step.toolName, "string", "step.toolName 必须为字符串");
      assert.ok(step.toolName.length > 0, "step.toolName 不能为空");
      assert.ok(step.args && typeof step.args === "object" && !Array.isArray(step.args), "step.args 必须为对象");
      assert.strictEqual(typeof step.reason, "string", "step.reason 必须为字符串");
    });
  });

  // 既有编排序列锁定（与原实现逐条对齐）
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "campus_multi_step_advice", slots: {} }, "今天下午没课想自习")),
    ["get_today_courses", "search_empty_rooms"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "campus_multi_step_advice", slots: {} }, "明天有课吗，顺便看天气和附近地点")),
    ["get_tomorrow_courses", "search_empty_rooms", "get_campus_weather", "search_campus_place"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "next_course_location", slots: {} }, "下一节课在哪里")),
    ["get_next_course", "get_classroom_location"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "course_action_advice", slots: {} }, "下一节课什么时候出发")),
    ["get_next_course", "get_course_route", "navigate_miniprogram_page"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "course_action_advice", slots: { dateHint: "tomorrow", wantsWeather: true } }, "明天课程天气")),
    ["get_tomorrow_courses", "get_course_route", "get_course_weather_advice", "navigate_miniprogram_page"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: {} }, "上课前20分钟提醒我")),
    ["create_course_reminder"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: { operation: "update" } }, "改一下提醒")),
    ["update_course_reminder"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: { operation: "delete" } }, "取消提醒")),
    ["delete_course_reminder"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: { operation: "list" } }, "我有哪些提醒")),
    ["list_course_reminders"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "inspect_schedule_health", slots: {} }, "检查课表冲突")),
    ["inspect_schedule_conflicts"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "detect_schedule_changes", slots: {} }, "课表有变化吗")),
    ["detect_schedule_changes"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "clarify_missing_slot", slots: {} }, "查老师课表")),
    ["clarify_missing_slot"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "set_current_schedule", slots: {} }, "设为当前课表")),
    ["set_current_schedule"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "update_user_preference", slots: {} }, "以后叫我小名")),
    ["update_user_preference"]
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "get_today_courses", slots: {} }, "今天有什么课")),
    ["get_today_courses"]
  );
});

// G2 Intent 因子：不在 manifest 允许集内的工具不得出现
group("G2 Intent 因子", () => {
  assert.deepStrictEqual(toolNames(buildPlanForIntent({ name: "get_today_courses", slots: {} }, "今天有什么课")), ["get_today_courses"], "绿：manifest 允许的工具出现");
  assert.deepStrictEqual(buildPlanForIntent({ name: "unknown_intent_xyz", slots: {} }, "未知"), [], "红：manifest 未声明的 intent 不出现任何工具");
  assert.deepStrictEqual(buildPlanForIntent({ name: "generic", slots: {} }, "闲聊"), [], "红：generic 不出现工具");
  assert.deepStrictEqual(buildPlanForIntent({ name: "project_qa", slots: {} }, "项目是什么"), [], "红：allowedTools 为空的 intent 不出现工具");
  assert.deepStrictEqual(buildPlanForIntent({ name: "conversational_help", slots: {} }, "你好"), [], "红：allowedTools 为空的 intent 不出现工具");
});

// G3 Skill 因子：skill 不允许的工具被剔除（fixture 构造 intent/skill 允许集错位）
group("G3 Skill 因子", () => {
  const plan = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = ["get_tomorrow_courses"];
    fixture.skills.today_schedule.allowedTools = ["get_today_courses"]; // skill 不放行 get_tomorrow_courses
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(plan, [], "红：intent 允许但 skill 不允许 → 交集为空");

  const allowed = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = ["get_tomorrow_courses"];
    fixture.skills.today_schedule.allowedTools = ["get_today_courses", "get_tomorrow_courses"]; // skill 放行
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(allowed, ["get_tomorrow_courses"], "绿：skill 放行后工具进入计划");
});

// G4 Runtime 因子：manifest 声明但未注册执行的工具被剔除
group("G4 Runtime 因子", () => {
  const plan = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = ["ghost_tool_not_registered", "get_today_courses"];
    fixture.skills.today_schedule.allowedTools = ["ghost_tool_not_registered", "get_today_courses"];
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(plan, ["get_today_courses"], "红：未注册执行的工具被剔除，首个可执行工具顶上");
  assert.ok(!plan.includes("ghost_tool_not_registered"), "ghost 工具不得出现在计划中");
});

// G5 Principal 因子：显式未认证 principal 剔除执行需认证的工具
group("G5 Principal 因子", () => {
  const unauth = { principal: { authenticated: false } };
  const auth = { principal: { authenticated: true, principalKey: "test-principal-key" } };
  assert.deepStrictEqual(
    buildPlanForIntent({ name: "manage_course_reminders", slots: {} }, "上课前20分钟提醒我", unauth),
    [],
    "红：未认证 principal 下提醒写工具被剔除"
  );
  assert.deepStrictEqual(
    buildPlanForIntent({ name: "update_user_preference", slots: {} }, "以后叫我小名", unauth),
    [],
    "红：未认证 principal 下偏好写工具被剔除"
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: {} }, "上课前20分钟提醒我", auth)),
    ["create_course_reminder"],
    "绿：已认证 principal 不收窄"
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "manage_course_reminders", slots: {} }, "上课前20分钟提醒我")),
    ["create_course_reminder"],
    "中性：未携带 principal 时维持执行层鉴权语义（不在计划期推断缺省身份）"
  );
  // 读工具不受 principal 因子影响
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "get_today_courses", slots: {} }, "今天有什么课", unauth)),
    ["get_today_courses"],
    "绿：读工具不受未认证 principal 影响"
  );
});

// G6 Environment 因子：runtimeMode 政策剔除不可用工具
group("G6 Environment 因子", () => {
  assert.deepStrictEqual(
    buildPlanForIntent({ name: "generate_image", slots: {} }, "画一只猫", { runtimeMode: "public" }),
    [],
    "红：public 政策下 trial/dev 专属工具被剔除"
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "generate_image", slots: {} }, "画一只猫", { runtimeMode: "trial" })),
    ["generate_image"],
    "绿：trial 政策放行"
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "generate_image", slots: {} }, "画一只猫", { runtimeMode: "dev" })),
    ["generate_image"],
    "绿：dev 政策放行"
  );
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "generate_image", slots: {} }, "画一只猫", { runtimeMode: "competition" })),
    ["generate_image"],
    "绿：competition 归一为 trial 后放行"
  );
  // 缺省 runtimeMode 取最严 public 口径
  assert.deepStrictEqual(
    buildPlanForIntent({ name: "generate_image", slots: {} }, "画一只猫"),
    [],
    "红：缺省 runtimeMode 按 public 最严口径剔除"
  );
});

// G7 并集放大反例锁定：不允许以 intent.name 身份兜底绕过 manifest 允许集
group("G7 并集放大反例锁定", () => {
  // conversation_memory：manifest allowedTools 为空。旧实现 identity 兜底会发出
  // intent.name 幻影步骤（并集放大），新实现必须为空计划。
  assert.deepStrictEqual(
    buildPlanForIntent({ name: "conversation_memory", slots: {} }, "记住我喜欢被叫小名"),
    [],
    "conversation_memory 不得发出 manifest 允许集之外的幻影工具步骤"
  );
  // fixture：intent.name 是已注册工具，但 manifest allowedTools 被置空 → 旧 identity
  // 兜底会发出该工具（并集放大），新实现必须为空计划。
  const plan = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = [];
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(plan, [], "intent.name 是已注册工具也不得以并集兜底放行");
  // search_empty_rooms 的计划不强制并集诊断工具（诊断仍由链执行器按结果驱动追加）
  const emptyRoomsPlan = toolNames(buildPlanForIntent({ name: "search_empty_rooms", slots: {} }, "现在有空教室吗"));
  assert.deepStrictEqual(emptyRoomsPlan, ["search_empty_rooms"], "计划不得把 allowedTools 全集并集为步骤");
  assert.ok(!emptyRoomsPlan.includes("diagnose_data_status"), "诊断工具不得被并集进计划");
  // search_school_index 同理不并集 get_schedule_detail
  assert.deepStrictEqual(
    toolNames(buildPlanForIntent({ name: "search_school_index", slots: {} }, "查王老师课表")),
    ["search_school_index"],
    "详情工具不得被并集进计划"
  );
});

// G8 Manifest 单源证据：改 fixture manifest 即改变计划，无需改代码
group("G8 Manifest 单源证据", () => {
  const baseline = planWithManifestFixture(() => {}, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(baseline, ["get_today_courses"], "基线 fixture 与原计划一致");

  const removed = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = [];
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(removed, [], "manifest 移除工具后计划随之为空（单源派生）");

  const reordered = planWithManifestFixture((fixture) => {
    fixture.intents.get_today_courses.allowedTools = ["get_tomorrow_courses", "get_today_courses"];
    fixture.skills.today_schedule.allowedTools = ["get_today_courses", "get_tomorrow_courses"];
  }, { name: "get_today_courses", slots: {} }, "今天有什么课");
  assert.deepStrictEqual(reordered, ["get_tomorrow_courses"], "计划跟随 manifest 允许集内容与顺序，而非代码内映射");
});

// G9 空计划回退语义：与原实现空计划形态严格一致（空数组，不抛错，不放大）
group("G9 空计划回退语义", () => {
  const emptyCases = [
    [null, "空"],
    [{ name: "generic", slots: {} }, "闲聊"],
    [{ name: "project_qa", slots: {} }, "项目"],
    [{ name: "conversational_help", slots: {} }, "你好"],
    [{ name: "unknown_intent_xyz", slots: {} }, "未知"],
    [{ name: "manage_course_reminders", slots: {} }, "提醒我", { principal: { authenticated: false } }],
    [{ name: "generate_image", slots: {} }, "画图", { runtimeMode: "public" }],
  ];
  emptyCases.forEach(([intent, message, context]) => {
    const plan = buildPlanForIntent(intent, message, context || {});
    assert.ok(Array.isArray(plan) && plan.length === 0, `空计划必须是严格 []：${intent && intent.name}`);
  });
});

// G10 全 manifest 五因子不变量扫描：任何 intent 的计划都不超出交集
group("G10 全 manifest 五因子不变量扫描", () => {
  const executable = new Set(toolRegistry.listToolNames());
  ["public", "trial"].forEach((runtimeMode) => {
    Object.keys(rawManifest.intents).forEach((intentId) => {
      const intent = { name: intentId, slots: {} };
      const plan = buildPlanForIntent(intent, "查询", { runtimeMode });
      const manifestIntent = capabilityManifestService.getIntent(intentId);
      const manifestSkill = capabilityManifestService.getManifest().skills[manifestIntent.skill];
      plan.forEach((step) => {
        assert.ok(manifestIntent.allowedTools.includes(step.toolName), `${runtimeMode}/${intentId}: ${step.toolName} 超出 intent 允许集`);
        assert.ok((manifestSkill.allowedTools || []).includes(step.toolName), `${runtimeMode}/${intentId}: ${step.toolName} 超出 skill 允许集`);
        assert.ok(executable.has(step.toolName), `${runtimeMode}/${intentId}: ${step.toolName} 未注册可执行`);
        assert.ok(capabilityManifestService.isToolAllowedForRuntime(step.toolName, runtimeMode), `${runtimeMode}/${intentId}: ${step.toolName} 超出 environment 政策`);
      });
    });
  });
});

// G11 capabilityRouter 兜底定位与对外形态（M6-T2）
group("G11 capabilityRouter 兜底定位与形态", () => {
  const { routeCapabilities } = capabilityRouter;
  // 对外签名兼容：字段与上限不变
  const route = routeCapabilities({
    message: "明天下午我有没有课？没课的话帮我找两节连续空教室，顺便看看天气。",
    intent: { name: "get_tomorrow_courses", slots: {} },
    runtimeMode: "public",
    workingMemory: {},
  });
  ["skillIds", "skills", "candidateTools", "primarySkillId", "routeReason", "scores"].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(route, key), `route 缺字段 ${key}`);
  });
  assert.ok(route.skillIds.length >= 1 && route.skillIds.length <= 3, "skillIds 仍为 1-3");
  assert.ok(route.candidateTools.length <= 12, "candidateTools 仍 ≤12");

  // 兜底定位：intent 未在 manifest 声明（Understanding 缺省/失败）时，正则兜底层
  // 仍只从 manifest 派生工具——天气消息命中兜底 intent get_campus_weather。
  const fallback = routeCapabilities({
    message: "今天天气怎么样",
    intent: { name: "unknown_intent_xyz", slots: {} },
    runtimeMode: "public",
    workingMemory: {},
  });
  assert.ok(fallback.candidateTools.includes("get_campus_weather"), "兜底命中工具来自 manifest intent 派生");
  fallback.candidateTools.forEach((tool) => {
    assert.ok(capabilityManifestService.getTool(tool), `兜底产出 ${tool} 必须在 manifest tools 内`);
  });

  // 源码级证据：router 内不存在第二份手工工具 id 表
  const routerSrc = fs.readFileSync(path.join(ROOT, "server/src/services/ai/capabilityRouter.js"), "utf8");
  assert.ok(!/tools:\s*\[/.test(routerSrc), "capabilityRouter 不得再有手工 tools: [...] 列举");
  ["INTENT_HINT_WEIGHTS", "MESSAGE_HINTS", "ALWAYS_TOOLS"].forEach((symbol) => {
    assert.ok(!routerSrc.includes(symbol), `capabilityRouter 不得残留 ${symbol}`);
  });
});

// G12 capabilityRouter manifest 派生证据：改 fixture manifest 即改变 router 产出
group("G12 capabilityRouter manifest 派生证据", () => {
  // get_campus_route 仅被 intent get_campus_route 一条映射覆盖（单一映射源工具）
  const input = { message: "C7 怎么走", intent: { name: "unknown_intent_xyz", slots: {} }, runtimeMode: "public", workingMemory: {} };
  const baseline = routeWithManifestFixture(() => {}, input);
  assert.ok(baseline.candidateTools.includes("get_campus_route"), "基线：兜底产出 manifest 声明的路线工具");

  const emptied = routeWithManifestFixture((fixture) => {
    fixture.intents.get_campus_route.allowedTools = [];
  }, input);
  assert.ok(!emptied.candidateTools.includes("get_campus_route"), "manifest 移除工具后兜底产出随之消失（单源派生）");

  // 不旁路已注册执行因子：manifest 声明但未注册的工具不得进入候选
  const ghost = routeWithManifestFixture((fixture) => {
    fixture.intents.search_empty_rooms.allowedTools = ["ghost_tool_not_registered", "search_empty_rooms"];
    fixture.skills.find_empty_room.allowedTools = ["ghost_tool_not_registered", "search_empty_rooms"];
  }, { message: "现在有空教室吗", intent: { name: "unknown_intent_xyz", slots: {} }, runtimeMode: "public", workingMemory: {} });
  assert.ok(!ghost.candidateTools.includes("ghost_tool_not_registered"), "未注册执行的工具被剔除");
  assert.ok(ghost.candidateTools.includes("search_empty_rooms"), "已注册工具不受影响");

  // 不旁路 Skill 因子：intent 允许但 skill 不允许 → 兜底产出同样剔除
  // （get_campus_route 仅经 intent get_campus_route 一条映射，可隔离 skill 因子）
  const skillMismatch = routeWithManifestFixture((fixture) => {
    fixture.skills.campus_place_navigation.allowedTools = ["search_campus_place", "get_classroom_location"];
  }, input);
  assert.ok(!skillMismatch.candidateTools.includes("get_campus_route"), "skill 不允许时兜底不得放行 intent 工具");
  const skillRestored = routeWithManifestFixture((fixture) => {
    fixture.skills.campus_place_navigation.allowedTools = ["search_campus_place", "get_classroom_location", "get_campus_route"];
  }, input);
  assert.ok(skillRestored.candidateTools.includes("get_campus_route"), "skill 放行后工具恢复进入候选");
});

// G13 capabilityRouter 不旁路交集：全输入不变量 + plan 仍收口于 T1
group("G13 capabilityRouter 不旁路交集", () => {
  const { routeCapabilities } = capabilityRouter;
  const registered = new Set(toolRegistry.listToolNames());
  const manifestIntentTools = new Set();
  Object.values(rawManifest.intents).forEach((intent) => {
    (intent.allowedTools || []).forEach((tool) => manifestIntentTools.add(tool));
  });
  const matrix = [
    ["今天有什么课", "get_today_courses"],
    ["明天下午没课的话帮我找空教室顺便看天气", "get_tomorrow_courses"],
    ["上课前20分钟提醒我", "manage_course_reminders"],
    ["课表有冲突吗", "inspect_schedule_health"],
    ["C7 怎么走", "get_campus_route"],
    ["现在第几周", "get_teaching_week"],
    ["随便聊聊", "conversational_help"],
    ["画一只猫", "generate_image"],
  ];
  ["public", "trial"].forEach((runtimeMode) => {
    matrix.forEach(([message, intentName]) => {
      const route = routeCapabilities({ message, intent: { name: intentName, slots: {} }, runtimeMode, workingMemory: {} });
      assert.ok(route.candidateTools.length <= 12, `${runtimeMode}/${intentName} 候选 ≤12`);
      route.candidateTools.forEach((tool) => {
        assert.ok(registered.has(tool), `${runtimeMode}/${intentName}: ${tool} 未注册可执行`);
        assert.ok(capabilityManifestService.isToolAllowedForRuntime(tool, runtimeMode), `${runtimeMode}/${intentName}: ${tool} 超出 environment 政策`);
        assert.ok(manifestIntentTools.has(tool), `${runtimeMode}/${intentName}: ${tool} 游离于 manifest intent 映射之外（第二份手工表反例）`);
      });
      // T1 单点收口：同一输入下 buildPlanForIntent 的计划不得越出 router 候选
      const context = { runtimeMode };
      const planTools = toolNames(buildPlanForIntent({ name: intentName, slots: {} }, message, context));
      planTools.forEach((tool) => {
        assert.ok(route.candidateTools.includes(tool), `${runtimeMode}/${intentName}: 计划工具 ${tool} 越出 router 候选`);
      });
    });
  });
  // Environment 因子在 router 层的显式红绿证据
  const publicImage = routeCapabilities({ message: "画一只猫", intent: { name: "generate_image", slots: {} }, runtimeMode: "public", workingMemory: {} });
  assert.ok(!publicImage.candidateTools.includes("generate_image"), "public 下 trial/dev 专属工具被剔除");
  const trialImage = routeCapabilities({ message: "画一只猫", intent: { name: "generate_image", slots: {} }, runtimeMode: "trial", workingMemory: {} });
  assert.ok(trialImage.candidateTools.includes("generate_image"), "trial 下按 manifest 政策放行");
});

// ---------- 运行 ----------
let failed = 0;
groups.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.stack || error);
  }
});
fs.rmSync(tempDir, { recursive: true, force: true });
console.log(`test-agent-tool-plan-manifest: ${groups.length - failed}/${groups.length} groups PASS`);
if (failed > 0) {
  process.exit(1);
}
console.log("test-agent-tool-plan-manifest: PASS");
