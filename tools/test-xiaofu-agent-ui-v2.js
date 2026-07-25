#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
const js = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const wxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");
const json = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json");

// 1. Copy no longer centers on 查询记录/新建查询/查询中
assert(!wxml.includes("查询记录"), "UI must not use 查询记录");
assert(!wxml.includes("新建查询"), "UI must not use 新建查询");
assert(!wxml.includes('{{sending ? "查询中" : "查询"}}'), "send button must not use old 查询/查询中 labels");
assert(wxml.includes("icon-send") || wxml.includes("aria-label=\"{{sending ? '处理中' : '发送'}}\""), "send control should use icon/send semantics");
assert(wxml.includes("对话") || wxml.includes("新建对话") || js.includes("新建对话"));
assert(
  wxml.includes("可以直接告诉我你想完成的校园任务")
  || wxml.includes("今天想让小佛帮你完成什么")
  || wxml.includes("今天想完成什么")
  || wxml.includes("empty-welcome")
);

// 2-3. V2 steps consumed; V1 taskSteps still present in pipeline
assert(js.includes("displaySteps") || js.includes("normalizeDisplaySteps"));
assert(js.includes("source.steps") || js.includes("response.steps"));
assert(js.includes("taskSteps"));
assert(json.includes("xiaofu-agent-run"));
assert(wxml.includes("xiaofu-agent-run"));

// 6-8. No provider / hidden reasoning exposure in UI strings
assert(!wxml.includes("DeepSeek"));
assert(!wxml.includes("Hunyuan"));
assert(!wxml.includes("Coze"));
assert(!wxml.includes("competition"));
assert(!wxml.includes("chain-of-thought") && !wxml.includes("思维链"));

// 9. Evidence by type
assert(js.includes("已核验课表数据"));
assert(js.includes("已核验教室占用"));
assert(js.includes("已获取天气数据"));
assert(js.includes("已查询校园地图"));
assert(js.includes("来自已发布校园知识") || js.includes("使用说明"));
assert(js.includes("本地能力结果"));

// 10. Online status not hardcoded — Phase 3 uses readiness chips + status machine
assert(
  wxml.includes("connectionStatusText")
  || wxml.includes("statusChips")
  || wxml.includes("headerStatusLine")
  || wxml.includes("xiaofu-status-line")
  || wxml.includes("xiaofu-chip"),
  "status must be data-driven (chips or connection text)"
);
assert(!/>在线</.test(wxml));
assert(
  js.includes("getNetworkType")
  || js.includes("detectConnectionStatus")
  || js.includes("agentReadinessClient")
  || js.includes("probeAgentStatus")
);

// 11-13. fallback + memory
assert(wxml.includes("fallback-banner") || js.includes("fallbackBanner"));
assert(js.includes("memoryMode") || wxml.includes("memoryStatusText"));
assert(js.includes("cloud_sync"));
assert(json.includes("xiaofu-memory-sheet"));

// 14-16. Composer flex 贴底（禁止 fixed 双占位）+ safe area
const composerBlock = (wxss.match(/\.composer\s*\{[\s\S]*?\n\}/) || [""])[0];
assert(!/position\s*:\s*fixed/.test(composerBlock), "composer must not be fixed");
assert(/flex\s*:\s*0\s+0\s+auto|flex-shrink\s*:\s*0/.test(composerBlock), "composer flex-shrink 0");
assert(wxml.includes("voice-btn") || wxml.includes("voiceInputVisible"));
assert(wxss.includes("safe-area") || wxml.includes("safe-area"));

// Agent run component
const runJs = read("miniprogram/packageXiaofu/components/xiaofu-agent-run/index.js");
assert(runJs.includes("publicToolLabel") || runJs.includes("PUBLIC_TOOL_LABELS"));
assert(runJs.includes("expanded"));
assert(!runJs.includes("system prompt"));

console.log("test-xiaofu-agent-ui-v2 passed");
