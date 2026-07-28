const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const files = [
  "README.md",
  "docs/ai-agent-compliance.md",
  "docs/ai-agent-demo-guide.md",
  "docs/cloudbase-ai-hunyuan.md",
  "docs/competition-2026-agent-design.md",
  "docs/demo-script-5min.md",
  "docs/fosu-ai-knowledge-base.md",
  "docs/manual-wechat-release-checklist.md",
  "docs/xiaofu-agent/unified-model-first-root-cause.md",
  "miniprogram/app.json",
  "miniprogram/sitemap.json",
  "miniprogram/components/xiaofu-float/index.js",
  "miniprogram/data/fosuKnowledgeBase.js",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml",
  "miniprogram/packageXiaofu/pages/ai-assistant/demo-data.js",
  "miniprogram/pages/index/index.wxml",
  "miniprogram/pages/login/login.wxml",
  "miniprogram/pages/personal-sync/personal-sync.js",
  "miniprogram/pages/personal-sync/personal-sync.wxml",
  "miniprogram/pages/school/school.js",
  "miniprogram/pages/school/school.wxml",
  "miniprogram/pages/settings/settings.js",
  "miniprogram/pages/settings/settings.wxml",
  "miniprogram/pages/today/today.js",
  "miniprogram/pages/today/today.wxml",
  "miniprogram/services/aiAssistantService.js",
  "miniprogram/services/aiTransportRouter.js",
  "miniprogram/services/cloudbaseHunyuanService.js",
  "miniprogram/services/ragAnswerBuilder.js",
  "miniprogram/services/ragRetriever.js",
  "miniprogram/services/scheduleAssistantService.js",
  "miniprogram/services/scheduleIntentParser.js",
  "miniprogram/services/xiaofuAgentRouter.js",
  "server/src/routes/admin.js",
  "server/src/routes/adminPages.js",
  "server/src/routes/ai.js",
];

const oldVisiblePhrases = [
  "AI校园管家",
  "小佛AI",
  "AI 管家",
  "AI管家",
  "AI助手",
  "AI问答",
  "智能问答",
  "AI 摘要",
  "AI Provider 配置已保存",
  "AI Provider 验证完成",
  "AI Provider 配置保存失败",
  "保存 AI 配置",
  "AI Agent 状态",
  "AI 生成内容",
  "生成式问答",
  "未接入生成式AI",
  "未接入大模型",
  "深度合成",
  "这个小程序怎么用",
  "聊天记录",
  "问 AI",
  "发送中",
  ">发送<",
];

const requiredPhrases = [
  "小佛助手",
  // Product experience empty/composer copy (conversation-first)
  "可以直接告诉我你想完成的校园任务",
  "告诉小佛你想完成什么",
  "请勿输入学号、密码",
  "可以查询什么",
  // M5-T3 起本地流水线伪造阶段文案（“正在匹配查询内容/正在查询校园信息”）退役，
  // 离线链路只保留如实的本机处理披露。
  "正在处理本机结果",
  "小佛浮窗",
  "保存查询服务配置",
  "查询链路状态",
  "新建对话",
];

// Phase-2 UI files must not keep the old query-centric labels.
const phase2UiFiles = [
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js",
  "miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.wxml",
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const contents = files.map((file) => ({ file, text: read(file) }));
  const combined = contents.map((item) => item.text).join("\n");

  oldVisiblePhrases.forEach((phrase) => {
    const hits = contents.filter((item) => item.text.includes(phrase)).map((item) => item.file);
    assert.strictEqual(hits.length, 0, `旧对外文案仍存在: ${phrase} in ${hits.join(", ")}`);
  });

  requiredPhrases.forEach((phrase) => {
    assert(combined.includes(phrase), `缺少整改后的关键文案: ${phrase}`);
  });

  phase2UiFiles.forEach((file) => {
    const text = read(file);
    assert(!text.includes("查询记录"), `${file} still contains 查询记录`);
    assert(!text.includes("新建查询"), `${file} still contains 新建查询`);
  });

  console.log("campus assistant copy audit passed");
}

run();
