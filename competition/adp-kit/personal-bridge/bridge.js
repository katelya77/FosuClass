"use strict";
// CSF P4 个人课表导入/同步桥接（2026-08-19）
// ADP 环境无安全直连个人课表导入能力（无已验证 Session / 无 x-fosu-session 通道）：
// 本模块只做 意图识别 + 安全导航 + 诚实状态查询，绝不伪造导入成功。
// 凭据永不进入对话 / 知识库 / 日志 / 测试快照；写操作一律 L3 确认。
const PERSONAL_SYNC_WRITE_INTENTS = Object.freeze([
  "import",
  "bind",
  "resync",
  "change_source",
]);
const PERSONAL_SYNC_READ_INTENTS = Object.freeze(["status"]);
const ALL_INTENTS = Object.freeze([...PERSONAL_SYNC_WRITE_INTENTS, ...PERSONAL_SYNC_READ_INTENTS]);

const INTENT_KEYWORDS = Object.freeze({
  import: ["导入课表", "导入课程", "导课表", "导入"],
  bind: ["绑定", "绑定账号", "绑定学号"],
  resync: ["重新同步", "同步课表", "更新课表", "刷新课表"],
  change_source: ["换个来源", "更换来源", "换来源", "换方式", "改导入方式", "换班级课表", "来源导入"],
  status: ["同步了吗", "导入了吗", "绑定状态", "有没有绑定", "导入状态", "同步状态"],
});

const INTENT_HINTS = Object.freeze({
  import: "导入个人课表",
  bind: "绑定账号",
  resync: "重新同步个人课表",
  change_source: "更换导入来源",
  status: "查看导入/绑定状态",
});

function classifyPersonalScheduleIntent(text) {
  if (!text || typeof text !== "string") return { intent: null, requiresConfirm: false };
  let best = null;
  let bestLen = 0;
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw) && kw.length > bestLen) {
        best = intent;
        bestLen = kw.length;
      }
    }
  }
  if (!best) return { intent: null, requiresConfirm: false };
  return {
    intent: best,
    requiresConfirm: PERSONAL_SYNC_WRITE_INTENTS.includes(best),
  };
}

function resolveAuthority(intent) {
  if (intent === "status") return "L1";
  if (PERSONAL_SYNC_WRITE_INTENTS.includes(intent)) return "L3";
  return null;
}

function buildBridgeMessage(intent, { hasBound = false } = {}) {
  if (!ALL_INTENTS.includes(intent)) {
    return {
      ok: false,
      text: "个人课表相关操作由小程序端的「个人同步」页提供：导入、绑定、重新同步、更换来源与状态查看都在那里完成。需要我引导你先打开该页面吗？",
    };
  }
  if (resolveAuthority(intent) === "L3") {
return {
        ok: false,
        requiresConfirm: true,
        text:
          `「${INTENT_HINTS[intent]}」属于个人课表的写操作，需要你明确确认后才会执行。` +
          `请在小程序端「个人同步」页完成操作；凭据只在该页面的加密通道中填写，不要在本对话中提供任何凭据。` +
          `完成后告诉我，我可以帮你继续核对课表结果。`,
      };
  }
  if (intent === "status") {
    const boundText = hasBound === true
      ? "你的个人课表当前已绑定，绑定状态以小程序端为准。"
      : "我无法直接读取你的本地绑定状态；请在小程序端「个人同步」页查看。";
    return {
      ok: false,
      readOnly: true,
      text: `${boundText}绑定状态、最近导入时间以小程序端实际状态为准，我不会代替它宣称结果。`,
    };
  }
  return { ok: false, text: "该意图暂无法在本环境直接执行，请回到小程序端「个人同步」页完成。" };
}

module.exports = {
  ALL_INTENTS,
  PERSONAL_SYNC_WRITE_INTENTS,
  PERSONAL_SYNC_READ_INTENTS,
  classifyPersonalScheduleIntent,
  resolveAuthority,
  buildBridgeMessage,
};