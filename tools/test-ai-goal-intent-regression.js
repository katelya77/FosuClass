const toolRegistry = require("../server/src/services/ai/toolRegistry");

const cases = [
  "将24动医1的课表设为当前首页课表",
  "把24动物医学1班设成当前课表",
  "切换首页课表到25汉语言文学1班",
  "把刚刚查到的班级设为我的课表",
  "24动医1的课表",
  "王奕章老师的课表",
  "查一下C7教室",
  "帮我查课表",
];
cases.forEach((msg) => {
  const intent = toolRegistry.resolveIntent(msg, {});
  console.log(JSON.stringify({ msg, intent: intent && { name: intent.name, slots: intent.slots } }));
});

// 唯一匹配后跑工具链
const intent = toolRegistry.resolveIntent("将24动医1的课表设为当前首页课表", {});
console.log("=== plan ===");
console.log(JSON.stringify(toolRegistry.buildPlanForIntent(intent, "将24动医1的课表设为当前首页课表", {})));
console.log("=== runTools ===");
const calls = toolRegistry.runToolsForIntent(intent, "将24动医1的课表设为当前首页课表", {});
console.log(JSON.stringify(calls.map((c) => ({ name: c.name, status: c.status, summary: c.summary, target: c.result && c.result.target }))));
