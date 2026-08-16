#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const functionRoot = path.join(__dirname, "campusflowAdpTools");
const token = "campusflow-http-function-test-token";
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
    assert.equal(health.dataVersion, "competition-demo-v2");
    assert.equal(health.tools, 7);
    assert.equal(health.agentTools, 5, "ADP Agent Tool Façade 数量应为 5");
    assert.equal(health.adpContractVersion, "R49.1.1");

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
    assert.equal(body.dataVersion, "competition-demo-v2");
    assert.equal(body.evidence.verified, true);

    // R49.1.1：部署包内 Agent Tool Façade 真实可用（self 模式无需第二对象）。
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
    console.log("[pass] CloudBase HTTP Function 本地冒烟通过（health、401、确定性工具、Agent Tool Façade）");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  child.kill();
  process.exitCode = 1;
});
