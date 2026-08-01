// 通用 UI Block → 展示模型适配器（小程序端）。
// 职责：把 packages/ui-schema 定义的 12 种通用 UI Block 映射为页面现有卡片/步骤模型，
// 让任何只产出通用字段的声明式 Skill 无需改动页面即可渲染。
// 边界：
//   1. 只处理通用 Block，不含任何业务语义；业务映射留在页面 normalizeCard（插件角色）。
//   2. 纯函数、无 wx API、绝不抛异常；所有文本经 safeText 裁剪。
//   3. Block 权威来源是 miniprogram/shared/agentSdk.generated.js（由 packages 生成，勿手改）。

const AGENT_SDK = require("../../shared/agentSdk.generated.js");

const UI_BLOCK_TYPES = AGENT_SDK.UI_BLOCK_TYPES || [];
const UI_BLOCK_TYPE_SET = new Set(UI_BLOCK_TYPES);
const normalizeUiBlocks = AGENT_SDK.normalizeUiBlocks || (() => []);
const blocksFromAgentResult = AGENT_SDK.blocksFromAgentResult || (() => []);

// 文本裁剪：去控制字符、修剪首尾空白；保留内部换行（markdown 需要原样结构）。
function safeText(value, maxLength, fallback) {
  let raw = value;
  if (raw && typeof raw === "object") {
    raw = raw.text != null ? raw.text
      : (raw.label != null ? raw.label
        : (raw.title != null ? raw.title : ""));
  }
  const text = String(raw == null ? "" : raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!text || text === "[object Object]") return fallback || "";
  if (maxLength && text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

// 从响应信封推导 UI Block：显式 uiBlocks / ui.blocks 优先，否则由信封通用字段推导。
// 一律过 normalizeUiBlocks；任何异常都降级推导或返回空数组，绝不抛给页面。
function deriveBlocks(response) {
  const source = response && typeof response === "object" && !Array.isArray(response) ? response : {};
  try {
    const explicit = Array.isArray(source.uiBlocks) ? source.uiBlocks
      : (source.ui && Array.isArray(source.ui.blocks) ? source.ui.blocks : null);
    if (explicit) return normalizeUiBlocks(explicit);
    return blocksFromAgentResult(source);
  } catch (err) {
    try {
      return blocksFromAgentResult(source);
    } catch (ignored) {
      return [];
    }
  }
}

// 卡片公共骨架：字段与页面 normalizeCard 消费的形状保持一致。
function baseCard(type, title, items, extra) {
  return Object.assign({
    type,
    typeClass: "generic",
    title: safeText(title, 80),
    subtitle: "",
    badges: [],
    items: safeArray(items),
  }, extra || {});
}

// 列表/详情条目：只搬运输入里存在的字段，不为缺失字段编造文案。
function mapGenericItems(items) {
  return safeArray(items).map((item) => {
    const src = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const mapped = {
      title: safeText(src.title != null ? src.title : src.label, 120),
      subtitle: safeText(src.subtitle, 200),
      description: safeText(src.description != null ? src.description : src.value, 500),
    };
    const url = safeText(src.url || src.actionUrl || src.openUrl, 240);
    if (url) mapped.url = url;
    return mapped;
  }).filter((item) => item.title || item.subtitle || item.description || item.url);
}

// 日程条目：把时间/地点通用映射进 description，不做任何业务推断。
function mapScheduleItems(entries) {
  return safeArray(entries).map((entry) => {
    const src = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const timeText = [safeText(src.start, 80), safeText(src.end, 80)].filter(Boolean).join("-");
    const composed = [timeText, safeText(src.location, 200)].filter(Boolean).join(" · ");
    return {
      title: safeText(src.title, 120),
      subtitle: safeText(src.subtitle, 200),
      description: safeText(src.description != null ? src.description : composed, 500),
    };
  }).filter((item) => item.title || item.subtitle || item.description);
}

function mapPlanSteps(steps) {
  return safeArray(steps).map((step, index) => {
    const src = step && typeof step === "object" && !Array.isArray(step) ? step : {};
    return {
      id: safeText(src.id || src.key, 60) || `step_${index + 1}`,
      label: safeText(src.label != null ? src.label : src.title, 120),
      status: safeText(src.status, 24, "pending"),
    };
  }).filter((step) => step.label);
}

function mapOptions(options) {
  return safeArray(options).map((option) => {
    const src = option && typeof option === "object" && !Array.isArray(option) ? option : { label: option };
    return {
      label: safeText(src.label != null ? src.label : src.title, 120),
      value: safeText(src.value, 200),
    };
  }).filter((option) => option.label);
}

// 未知 Block 的安全降级卡：只放裁剪后的文本摘要，绝不把原始对象塞进 title。
function buildUnknownCard(source) {
  let summary = "";
  if (typeof source === "string") {
    summary = safeText(source, 200);
  } else if (source && typeof source === "object") {
    summary = safeText(source.text || source.message || source.summary || source.title, 200)
      || safeText(source.type, 40);
  }
  return baseCard("text", "结果", [{ title: summary || "未知内容", subtitle: "", description: "" }]);
}

// 通用 Block → 页面展示模型。
// 输入可以是规范化 Block（deriveBlocks 产物）或原始 Block；
// 未知/非法类型计入 unknownCount 并降级为安全文本卡，绝不抛异常。
function mapBlocksToDisplay(blocks) {
  const display = {
    text: "",
    cards: [],
    steps: [],
    plan: null,
    clarification: null,
    confirmation: null,
    receipts: [],
    warnings: [],
    errors: [],
    unknownCount: 0,
  };
  const textParts = [];

  safeArray(blocks).forEach((raw) => {
    const block = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    const type = block ? safeText(block.type, 32) : "";
    if (!block || !UI_BLOCK_TYPE_SET.has(type)) {
      display.unknownCount += 1;
      display.cards.push(buildUnknownCard(raw));
      return;
    }
    switch (type) {
      case "text":
        textParts.push(safeText(block.text, 12000));
        break;
      case "markdown":
        // markdown 原样拼接，交给安全 markdown 组件渲染
        textParts.push(safeText(block.markdown, 20000));
        break;
      case "plan": {
        if (!display.plan) display.plan = { steps: [], summary: "" };
        display.plan.steps = display.plan.steps.concat(mapPlanSteps(block.steps));
        if (!display.plan.summary) display.plan.summary = safeText(block.title, 120);
        break;
      }
      case "tool_progress":
        // 与页面 displaySteps 形状对齐：{label, status, tool, durationMs}
        display.steps.push({
          label: safeText(block.label, 80),
          status: safeText(block.status, 24, "running"),
          tool: safeText(block.toolId != null ? block.toolId : block.tool, 60),
          durationMs: Number(block.durationMs) || 0,
        });
        break;
      case "list":
        display.cards.push(baseCard("list", block.title, mapGenericItems(block.items)));
        break;
      case "detail":
        display.cards.push(baseCard("detail", block.title,
          mapGenericItems(safeArray(block.fields).length ? block.fields : block.items)));
        break;
      case "schedule":
        display.cards.push(baseCard("schedule", block.title, mapScheduleItems(block.entries)));
        break;
      case "clarification": {
        const question = safeText(block.prompt != null ? block.prompt : block.question, 500);
        const options = mapOptions(block.options);
        display.clarification = { question, options };
        display.cards.push(baseCard("clarification", safeText(block.title, 80) || question,
          options.map((option) => ({ title: option.label, subtitle: "", description: option.value }))));
        break;
      }
      case "confirmation": {
        const title = safeText(block.title, 80);
        const description = safeText(block.prompt != null ? block.prompt : block.description, 500);
        const confirmAction = { label: safeText(block.confirmLabel, 40, "确认"), type: "confirm" };
        display.confirmation = { title: title || description, description, confirmAction };
        display.cards.push(baseCard("confirmation", title || description, [], { actions: [confirmAction] }));
        break;
      }
      case "action_receipt":
        display.receipts.push({
          command: safeText(block.command, 120),
          status: safeText(block.status, 80),
          label: safeText(block.title, 80) || safeText(block.command, 80),
        });
        break;
      case "warning": {
        const message = safeText(block.message, 500);
        display.warnings.push({ message, code: safeText(block.code, 60) });
        display.cards.push(baseCard("warning", safeText(block.title, 80) || message, [], { variant: "warning" }));
        break;
      }
      case "error": {
        const message = safeText(block.message, 500);
        display.errors.push({ message, code: safeText(block.code, 60), retryable: block.retryable === true });
        display.cards.push(baseCard("error", safeText(block.title, 80) || message, [], { variant: "error" }));
        break;
      }
      default:
        // UI_BLOCK_TYPE_SET 已覆盖全部已知类型，理论不可达；兜底防回归。
        display.unknownCount += 1;
        display.cards.push(buildUnknownCard(block));
        break;
    }
  });

  display.text = textParts.filter(Boolean).join("\n\n");
  return display;
}

// 便捷入口：一次完成「推导 Block + 映射展示模型」。
function responseToDisplayAugment(response) {
  const blocks = deriveBlocks(response);
  return { blocks, display: mapBlocksToDisplay(blocks) };
}

module.exports = {
  deriveBlocks,
  mapBlocksToDisplay,
  responseToDisplayAugment,
  safeText,
  safeArray,
};
