#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = __dirname;
const contract = JSON.parse(fs.readFileSync(path.join(root, "action-contract.json"), "utf8"));
const adapterPath = path.join(root, contract.canonicalAdapter);
const adapterSource = fs.readFileSync(adapterPath, "utf8");

const harness = [
  "import json, runpy, sys",
  "main = runpy.run_path(sys.argv[1])['main']",
  "cases = json.load(sys.stdin)",
  "print(json.dumps([main({'tool_body': body}) for body in cases], ensure_ascii=False))",
].join("\n");

function verifiedBody(entity, query) {
  return {
    success: true,
    queryId: "q-action-contract",
    dataVersion: contract.dataVersion,
    resolvedEntity: entity,
    query,
    items: [{
      courseName: "受控测试课程",
      periodText: "第1-2节",
      campusName: "受控校区",
      building: "受控教学楼",
      roomName: "受控教室",
      startTime: "08:00",
      endTime: "09:40",
      teachers: ["受控教师"],
      classes: ["受控班级"],
    }],
    evidence: { verified: true },
  };
}

function invoke(bodies) {
  const result = spawnSync("python", ["-c", harness, adapterPath], {
    input: JSON.stringify(bodies),
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr || "adapter process failed");
  return JSON.parse(result.stdout);
}

function actionsOf(output) {
  return [0, 1, 2].map((index) => ({
    label: output[`action${index}Label`],
    message: output[`action${index}Message`],
  }));
}

function mutate(body, mutation) {
  const copy = JSON.parse(JSON.stringify(body));
  const operations = {
    tool_failure: () => { copy.success = false; },
    unverified: () => { copy.evidence.verified = false; },
    invalid_evidence_shape: () => { copy.evidence = "verified"; },
    empty_items: () => { copy.items = []; },
    missing_entity: () => { copy.resolvedEntity = null; },
    invalid_entity_shape: () => { copy.resolvedEntity = ["teacher", "教师003"]; },
    unsupported_entity: () => { copy.resolvedEntity.type = "user"; },
    missing_query: () => { copy.query = null; },
    invalid_query_shape: () => { copy.query = "第1周周一"; },
    missing_week: () => { copy.query.week = null; },
    week_zero: () => { copy.query.week = 0; },
    week_overflow: () => { copy.query.week = contract.totalWeeks + 1; },
    weekday_overflow: () => { copy.query.weekday = 8; },
  };
  assert(operations[mutation], `unknown guard mutation: ${mutation}`);
  operations[mutation]();
  return copy;
}

const caseBodies = contract.cases.map((testCase) => verifiedBody(testCase.entity, testCase.query));
const outputs = invoke(caseBodies);
const canonical01 = contract.canonical01Patterns.map((pattern) => new RegExp(pattern));
const canonical03 = new RegExp(contract.canonical03TeacherRiskPattern);

outputs.forEach((output, index) => {
  const testCase = contract.cases[index];
  assert.strictEqual(output.route, "widget", `${testCase.name}: expected widget route`);
  assert.deepStrictEqual(actionsOf(output), testCase.expected, `${testCase.name}: action drift`);
  for (const action of actionsOf(output)) {
    assert(action.message.includes(testCase.entity.name), `${testCase.name}: entity lost in ${action.message}`);
    for (const fragment of contract.forbiddenPayloadFragments) {
      assert(!action.message.includes(fragment), `${testCase.name}: fuzzy fragment ${fragment}`);
    }
    const enters01 = canonical01.some((pattern) => pattern.test(action.message));
    const riskMatch = action.message.match(canonical03);
    const enters03 = Boolean(riskMatch);
    assert(enters01 || enters03, `${testCase.name}: payload is not canonical: ${action.message}`);
    if (enters03) {
      assert.strictEqual(testCase.entity.type, "teacher", `${testCase.name}: only teacher self-risk may enter 03`);
      assert(testCase.query.week != null && testCase.query.weekday != null,
        `${testCase.name}: teacher risk lost explicit week/weekday`);
      assert.strictEqual(riskMatch[1], testCase.entity.name, `${testCase.name}: teacher risk entity drift`);
      assert.strictEqual(Number(riskMatch[2]), testCase.query.week, `${testCase.name}: teacher risk week drift`);
      const weekdayNames = ["一", "二", "三", "四", "五", "六", "日"];
      assert.strictEqual(riskMatch[3], weekdayNames[testCase.query.weekday - 1],
        `${testCase.name}: teacher risk weekday drift`);
    }
  }
});

const guardBase = verifiedBody({ type: "teacher", name: "教师003" }, { week: 1, weekday: 1, date: null });
const guardOutputs = invoke(contract.guards.map((guard) => mutate(guardBase, guard.mutation)));
guardOutputs.forEach((output, index) => {
  assert.strictEqual(output.route, "fallback", `${contract.guards[index].name}: must fail closed`);
  for (const action of actionsOf(output)) {
    assert.strictEqual(action.label, "", `${contract.guards[index].name}: fallback label must be empty`);
    assert.strictEqual(action.message, "", `${contract.guards[index].name}: fallback payload must be empty`);
  }
});

const factMutationBodies = [
  verifiedBody({ type: "teacher", name: "教师003" }, { week: 1, weekday: 1, date: null }),
  verifiedBody({ type: "teacher", name: "教师003" }, { week: 1, weekday: 1, date: null }),
];
factMutationBodies[1].items[0] = {
  courseName: "完全不同的课程事实",
  periodText: "第11-12节",
  campusName: "另一个校区",
  teachers: ["另一个教师"],
  classes: ["另一个班级"],
};
const factMutationOutputs = invoke(factMutationBodies);
assert.deepStrictEqual(actionsOf(factMutationOutputs[0]), actionsOf(factMutationOutputs[1]),
  "actions must not infer entity/time facts from lesson items");

assert(adapterSource.includes("def build_actions("), "canonical adapter must own the deterministic builder");
assert(!adapterSource.includes("当前对象"), "adapter must not invent a fallback entity");
assert(!adapterSource.includes("当前查询范围"), "adapter must not emit a fuzzy scope");
const compatibilitySource = fs.readFileSync(path.join(root, "schedule-runtime-adapter.py"), "utf8");
assert(!compatibilitySource.includes("def main("), "legacy path must not maintain a second adapter implementation");
assert(compatibilitySource.includes(contract.canonicalAdapter), "legacy path must delegate to the canonical adapter");

console.log(`Action Contract V1 tests: PASS (${contract.cases.length} cases + ${contract.guards.length} guards)`);
