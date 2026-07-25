// 第六章：Coze 工具网关联调。用 service 层 overrides 测试钩子注入临时凭据，不依赖 .env、不外发请求。
process.env.AI_AGENT_ENABLED = process.env.AI_AGENT_ENABLED || "false";
const manifest = require("../server/config/agent-capability-manifest.json");
const svc = require("../server/src/services/ai/cozeToolGatewayService");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const TEST_TOKEN = "tmp-gateway-test-" + Date.now();
const OVR = { COZE_TOOL_GATEWAY_ENABLED: "true", COZE_TOOL_GATEWAY_TOKEN: TEST_TOKEN };
const AUTH = { authorization: "Bearer " + TEST_TOKEN };

const FILL = {
  type: "class", q: "24动医1", campus: "江湾校区", keyword: "奖学金", query: "奖学金",
  week: 16, teachingWeek: 16, weekday: 6, date: "2026-07-25", building: "C7",
  term: "2025-2026-2", name: "24动医1", limit: 5,
};

function buildArgs(toolId) {
  const tool = manifest.tools[toolId];
  const schema = (tool && tool.inputSchema) || {};
  const required = schema.required || [];
  const args = {};
  for (const k of required) {
    args[k] = Object.prototype.hasOwnProperty.call(FILL, k) ? FILL[k] : "test";
  }
  return { args, required };
}

(async () => {
  // 安全负向
  const disabled = await svc.executeGatewayCall("get_teaching_week", {}, { authorization: "Bearer x" }, { COZE_TOOL_GATEWAY_ENABLED: "false", COZE_TOOL_GATEWAY_TOKEN: "y" });
  check("disabled -> 503 GATEWAY_DISABLED", disabled.status === 503 && disabled.body.code === "GATEWAY_DISABLED");
  const badToken = await svc.executeGatewayCall("get_teaching_week", {}, { authorization: "Bearer wrong" }, OVR);
  check("wrong token -> 401 GATEWAY_UNAUTHORIZED", badToken.status === 401 && badToken.body.code === "GATEWAY_UNAUTHORIZED");
  const noToken = await svc.executeGatewayCall("get_teaching_week", {}, {}, OVR);
  check("missing token -> 401", noToken.status === 401);
  const unknown = await svc.executeGatewayCall("no_such_tool", {}, AUTH, OVR);
  check("unknown tool -> 404 TOOL_NOT_FOUND", unknown.status === 404);

  // 任务书指定四工具联调
  for (const toolId of ["get_teaching_week", "search_school_index", "search_empty_rooms", "rag_search"]) {
    const tool = manifest.tools[toolId];
    if (!tool) { check(toolId + " in manifest", false, "not found"); continue; }
    const allowed = Array.isArray(tool.runtimeModes) && tool.runtimeModes.includes("trial");
    check(toolId + " runtimeModes 含 trial", allowed, JSON.stringify(tool.runtimeModes));
    if (!allowed) continue;
    const { args, required } = buildArgs(toolId);
    const r = await svc.executeGatewayCall(toolId, args, AUTH, OVR);
    const body = r.body || {};
    const summary = (body.summary || body.code || "").toString().slice(0, 60);
    console.log("  [" + toolId + "] status=" + r.status + " success=" + body.success + " code=" + (body.code || "") + " summary=" + summary);
    check(toolId + " 网关调用返回 200 且业务有响应", r.status === 200 && (body.success === true || Boolean(body.code)), "status=" + r.status + " code=" + body.code);
  }

  console.log("---");
  console.log("pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
