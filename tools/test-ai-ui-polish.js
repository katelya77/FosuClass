// 第九章：UI 收敛验证（状态岛样式断言 + 设置课表引导卡 + 卡片不堆叠行为单测）
const fs = require("fs");
const path = require("path");
const presentation = require("../miniprogram/packageXiaofu/services/xiaofuPresentationAdapter");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const wxss = fs.readFileSync(path.join(__dirname, "../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
const pageJs = fs.readFileSync(path.join(__dirname, "../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");

// 1. 状态提示栏（全宽、轻层级、与页面文案左对齐）
const capsuleBlock = (wxss.match(/\.agent-status-capsule \{[\s\S]*?\n\}/) || [""])[0];
const wrapBlock = (wxss.match(/\.agent-status-island-wrap \{[\s\S]*?\n\}/) || [""])[0];
check("状态岛：全宽 wrapper 居中", /justify-content:\s*center/.test(wrapBlock) && /width:\s*100%/.test(wrapBlock));
check("状态岛：真正长胶囊（width: 100%）", /width:\s*100%/.test(capsuleBlock));
check("状态岛：不使用 align-self:flex-start 偏左", !/align-self:\s*flex-start/.test(capsuleBlock));
check("状态栏：使用抬升背景令牌", capsuleBlock.includes("var(--xf-bg-elevated)"));
check("状态岛：黑色胶囊背景已移除", !/background:\s*var\(--xf-text\)/.test(capsuleBlock));
check("状态栏：克制圆角", /border-radius:\s*var\(--xf-radius-md\)/.test(capsuleBlock));
check("状态栏：轻阴影令牌", capsuleBlock.includes("var(--xf-shadow-xs)"));
check("状态岛变体：waiting_confirmation 浅底方案", /\.agent-status-capsule\.waiting_confirmation\s*\{[^}]*rgba\(108, 61, 46, 0\.1\)/.test(wxss));
check("状态岛变体：network_error 浅底方案", /\.agent-status-capsule\.network_error\s*\{[^}]*rgba\(125, 48, 46, 0\.1\)/.test(wxss));

// 2. 设置课表流程文案
check("欢迎卡含「设置我的课表」入口", pageJs.includes('id: "setup"') && pageJs.includes("设置我的课表"));
check("设置课表卡导向导入引导问题", /id:\s*"setup"[^\n]*question:\s*"怎么导入个人课表？"/.test(pageJs));

// 3. 卡片不堆叠行为（limitDisplayCards 真实单测）
const c = (type, title) => ({ type, title: title || "卡片" });
const generic = { type: "generic", title: "小佛助手" };
const real1 = c("schedule", "今日课表");
const real2 = c("empty_room", "空教室");
const real3 = c("weather", "天气");

check("plain 模式不显示任何卡片", presentation.limitDisplayCards([real1], "plain").length === 0);
check("single_card 至多 1 张", presentation.limitDisplayCards([real1, real2], "single_card").length === 1);
check("composite 至多 2 张", presentation.limitDisplayCards([real1, real2, real3], "composite").length === 2);
check("默认模式多卡只留 1 张（不堆叠）", presentation.limitDisplayCards([real1, real2, real3], "").length === 1);
check("generic 无意义卡片被过滤", presentation.limitDisplayCards([generic, real1], "composite").length === 1
  && presentation.limitDisplayCards([generic], "composite").length === 0);

console.log("---");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
