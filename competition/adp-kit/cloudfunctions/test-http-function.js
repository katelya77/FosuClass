#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const functionRoot = path.join(__dirname, "campusflowAdpTools");
const token = "campusflow-http-function-test-token";
// R50.0 V3 运行时 fixture：从权威 mock-data 真源动态取 lesson/teacher 标识，
// 避免把具体 ID 硬编码进部署冒烟断言。
const fs = require("fs");
const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mock-data", "competition-demo-v3.json"), "utf8"));
const firstLessonId = v3.lessons[0].id;
const firstTwoTeachers = v3.teachers.slice(0, 2).map((t) => ({ type: "teacher", id: t.id, name: t.name }));
const noTokenEnv = { ...process.env };
delete noTokenEnv.CAMPUS_API_TOKEN;
delete noTokenEnv.CAMPUS_API_AUTH_MODE;
const failClosed = spawnSync(process.execPath, ["index.js"], {
  cwd: functionRoot,
  env: noTokenEnv,
  encoding: "utf8",
  timeout: 5000,
});
assert.notEqual(failClosed.status, 0, "HTTP Function 缺少 token 时必须拒绝启动");
assert.match(failClosed.stderr, /CAMPUS_API_TOKEN is required/);

const child = spawn(process.execPath, ["index.js"], {
  cwd: functionRoot,
  env: {
    ...process.env,
    CAMPUS_API_TOKEN: token,
    CAMPUS_API_AUTH_MODE: "token",
    LOG_LEVEL: "error",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9000/health");
      if (response.ok) return response.json();
    } catch (_) {
      // Cold start: retry within the bounded loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP Function 未就绪：${stderr}`);
}

(async () => {
  try {
    const health = await waitForHealth();
    assert.equal(health.status, "ok");
    assert.equal(health.dataVersion, "competition-demo-v3");
    assert.equal(health.dataHash, "sha1:842b7959e808");
    assert.equal(health.tools, 14, "底层 CampusTools 数量应为 14（R50.0）");
    assert.equal(health.agentTools, 13, "ADP Agent Tool Façade 数量应为 13");
    assert.equal(health.adpContractVersion, "R50.0");

    const unauthorized = await fetch("http://127.0.0.1:9000/api/query_schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "teacher", entityName: "教师001", week: 1 }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch("http://127.0.0.1:9000/api/query_schedule", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entityType: "teacher", entityName: "教师001", week: 1 }),
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(body.success, true);
    assert.equal(body.dataVersion, "competition-demo-v3");
    assert.equal(body.evidence.verified, true);

    // R49.2.1：部署包内 Agent Tool Façade 真实可用（self 模式无需第二对象）。
    const risk = await fetch("http://127.0.0.1:9000/api/campus_risk_check", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "self", entityType: "teacher", entityName: "T09", week: 1 }),
    });
    assert.equal(risk.status, 200);
    const riskBody = await risk.json();
    assert.equal(riskBody.success, true);
    assert.equal(riskBody.summary.selfCompare, true);

    // R49.4：新增 Agent Tool Façade 真实可用（教师负载窗口 + 多周课表展开）。
    const load = await fetch("http://127.0.0.1:9000/api/campus_teacher_load_query", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ weekStart: 1, weekEnd: 1, topN: 3 }),
    });
    assert.equal(load.status, 200);
    const loadBody = await load.json();
    assert.equal(loadBody.success, true);
    assert.equal(loadBody.items.length, 3);
    assert.equal(loadBody.items[0].rank, 1);

    const range = await fetch("http://127.0.0.1:9000/api/campus_schedule_range_query", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entityType: "teacher", entityName: "T09", weekStart: 1, weekEnd: 4 }),
    });
    assert.equal(range.status, 200);
    const rangeBody = await range.json();
    assert.equal(rangeBody.success, true);
    assert.ok(rangeBody.items.length > 0);
    for (const it of rangeBody.items) {
      assert.ok(Number.isInteger(it.academicWeek) && it.academicWeek >= 1 && it.academicWeek <= 4);
    }
    // R50.0：6 个新增 Agent Tool Façade 的本地 smoke 等价用例（V3 运行时）。
    const entity = await fetch("http://127.0.0.1:9000/api/campus_entity_search", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "teacher", limit: 5 }),
    });
    assert.equal(entity.status, 200);
    const entityBody = await entity.json();
    assert.equal(entityBody.success, true);
    assert.ok(entityBody.items.length > 0 && entityBody.items[0].type === "teacher");

    const acad = await fetch("http://127.0.0.1:9000/api/campus_academic_context", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: { kind: "future_weeks", count: 4 } }),
    });
    assert.equal(acad.status, 200);
    const acadBody = await acad.json();
    assert.equal(acadBody.success, true);
    assert.ok(acadBody.items[0].temporalContext, "academic_context 应暴露 temporalContext");

    const freeTime = await fetch("http://127.0.0.1:9000/api/campus_common_free_time_query", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entities: firstTwoTeachers, week: 1, minConsecutivePeriods: 1 }),
    });
    assert.equal(freeTime.status, 200);
    const freeTimeBody = await freeTime.json();
    assert.equal(freeTimeBody.success, true);

    const util = await fetch("http://127.0.0.1:9000/api/campus_room_utilization_query", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: 1, weekEnd: 4, sort: "highest", topN: 3 }),
    });
    assert.equal(util.status, 200);
    const utilBody = await util.json();
    assert.equal(utilBody.success, true);
    assert.equal(utilBody.items.length, 3);

    const resch = await fetch("http://127.0.0.1:9000/api/campus_reschedule_feasibility", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceLessonId: firstLessonId, target: { week: 1, weekday: 1, periodStart: 3, periodEnd: 4 } }),
    });
    assert.equal(resch.status, 200);
    const reschBody = await resch.json();
    assert.equal(reschBody.success, true);
    assert.ok(reschBody.summary && typeof reschBody.summary.feasible === "boolean");
    assert.ok(reschBody.decision, "live reschedule handler 应附带 authoritative decision");
    assert.equal(
      reschBody.decision.status,
      reschBody.summary.feasible ? "recommended" : "no_feasible_candidate",
      "调课系统可行性必须控制推荐状态",
    );

    const group = await fetch("http://127.0.0.1:9000/api/campus_group_plan", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entities: firstTwoTeachers, week: 1, minConsecutivePeriods: 1 }),
    });
    assert.equal(group.status, 200);
    const groupBody = await group.json();
    assert.equal(groupBody.success, true);
    assert.ok(groupBody.decision && groupBody.decision.receipt && groupBody.decision.resultCard);
    assert.equal(groupBody.decision.resultCard.layoutMode, "result-card");
    assert.ok(groupBody.decision.resultCard.actions.every((action) => action.type === "sys.chat"));
    assert.ok(groupBody.items.some((item) => `${item.weekdayName} ${item.periodText}` === groupBody.decision.preferred.label));

    const simpleSchedule = await fetch("http://127.0.0.1:9000/api/campus_schedule_query", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "teacher", entityName: v3.teachers[0].name, week: 1 }),
    });
    const simpleScheduleBody = await simpleSchedule.json();
    assert.equal(simpleScheduleBody.success, true);
    assert.equal(Object.hasOwn(simpleScheduleBody, "decision"), false, "简单课表查询不得强行进入 Decision");

    console.log("[pass] CloudBase HTTP Function 本地冒烟通过（health、401、确定性工具、13 个 Agent Tool Façade / V3 runtime）");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  child.kill();
  process.exitCode = 1;
});
