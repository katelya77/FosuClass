const UI_BLOCK_TYPES = Object.freeze([
  "text",
  "markdown",
  "plan",
  "tool_progress",
  "list",
  "detail",
  "schedule",
  "clarification",
  "confirmation",
  "action_receipt",
  "warning",
  "error",
]);

const UI_BLOCK_TYPE_SET = new Set(UI_BLOCK_TYPES);
const STEP_STATUS = new Set(["pending", "running", "done", "failed", "skipped", "cancelled"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function text(value, maxLength = 4000) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maxLength);
}

function id(value, fallback) {
  return text(value || fallback, 128);
}

function status(value, fallback = "pending") {
  const normalized = text(value, 24).toLowerCase();
  if (normalized === "success" || normalized === "completed") return "done";
  return STEP_STATUS.has(normalized) ? normalized : fallback;
}

function base(block, index) {
  return {
    type: text(block.type, 32),
    id: id(block.id, `${block.type}_${index + 1}`),
    schemaVersion: "ui.v1",
  };
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 24).map((step, index) => ({
    id: id(step && (step.id || step.key), `step_${index + 1}`),
    label: text(step && (step.label || step.title), 240),
    status: status(step && step.status),
  }));
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 100).map((item, index) => ({
    id: id(item && item.id, `item_${index + 1}`),
    title: text(item && item.title, 300),
    subtitle: text(item && item.subtitle, 500),
    value: text(item && item.value, 1000),
  }));
}

function normalizeBlock(type, block, index) {
  const common = base(block, index);
  if (block.title) common.title = text(block.title, 240);
  switch (type) {
    case "text":
      return Object.freeze(Object.assign(common, { text: text(block.text, 12000) }));
    case "markdown":
      return Object.freeze(Object.assign(common, { markdown: text(block.markdown, 20000) }));
    case "plan":
      return Object.freeze(Object.assign(common, { steps: Object.freeze(normalizeSteps(block.steps)) }));
    case "tool_progress":
      return Object.freeze(Object.assign(common, {
        toolId: text(block.toolId, 120),
        status: status(block.status, "running"),
        label: text(block.label, 240),
      }));
    case "list":
      return Object.freeze(Object.assign(common, { items: Object.freeze(normalizeItems(block.items)) }));
    case "detail":
      return Object.freeze(Object.assign(common, {
        fields: Object.freeze((Array.isArray(block.fields) ? block.fields : []).slice(0, 60).map((field) => ({
          label: text(field && field.label, 160),
          value: text(field && field.value, 2000),
        }))),
      }));
    case "schedule":
      return Object.freeze(Object.assign(common, {
        entries: Object.freeze((Array.isArray(block.entries) ? block.entries : []).slice(0, 120).map((entry, entryIndex) => ({
          id: id(entry && entry.id, `entry_${entryIndex + 1}`),
          title: text(entry && entry.title, 300),
          subtitle: text(entry && entry.subtitle, 500),
          start: text(entry && entry.start, 80),
          end: text(entry && entry.end, 80),
          location: text(entry && entry.location, 300),
        }))),
      }));
    case "clarification":
      return Object.freeze(Object.assign(common, {
        prompt: text(block.prompt, 1000),
        options: Object.freeze((Array.isArray(block.options) ? block.options : []).slice(0, 12).map((option, optionIndex) => ({
          id: id(option && option.id, `option_${optionIndex + 1}`),
          label: text(option && option.label, 240),
          value: text(option && option.value, 500),
        }))),
      }));
    case "confirmation":
      return Object.freeze(Object.assign(common, {
        prompt: text(block.prompt, 1000),
        confirmLabel: text(block.confirmLabel || "确认", 80),
        cancelLabel: text(block.cancelLabel || "取消", 80),
      }));
    case "action_receipt":
      return Object.freeze(Object.assign(common, {
        command: text(block.command, 120),
        status: text(block.status, 80),
        receiptId: text(block.receiptId, 160),
      }));
    case "warning":
      return Object.freeze(Object.assign(common, {
        message: text(block.message, 2000),
        code: text(block.code, 120),
      }));
    case "error":
      return Object.freeze(Object.assign(common, {
        message: text(block.message, 2000),
        code: text(block.code, 120),
        retryable: block.retryable === true,
      }));
    default:
      throw codedError("UI_BLOCK_TYPE_UNSUPPORTED", type);
  }
}

function normalizeUiBlocks(blocks) {
  return Object.freeze((Array.isArray(blocks) ? blocks : []).slice(0, 100).map((block, index) => {
    const type = text(block && block.type, 32);
    if (!UI_BLOCK_TYPE_SET.has(type)) throw codedError("UI_BLOCK_TYPE_UNSUPPORTED", type);
    return normalizeBlock(type, block || {}, index);
  }));
}

function scheduleBlockFromCard(card, index) {
  return {
    type: "schedule",
    id: id(card.id, `schedule_${index + 1}`),
    title: text(card.title, 240),
    entries: (Array.isArray(card.items) ? card.items : []).map((item, itemIndex) => ({
      id: id(item && item.id, `entry_${itemIndex + 1}`),
      title: text(item && item.title, 300),
      subtitle: text(item && item.subtitle, 500),
      start: text(item && item.start || item && item.subtitle, 80),
      end: text(item && item.end, 80),
      location: text(item && item.location || item && item.value, 300),
    })),
  };
}

function genericBlockFromCard(card, index) {
  const items = Array.isArray(card.items) ? card.items : [];
  if (items.length > 1) {
    return {
      type: "list",
      id: id(card.id, `list_${index + 1}`),
      title: text(card.title, 240),
      items,
    };
  }
  return {
    type: "detail",
    id: id(card.id, `detail_${index + 1}`),
    title: text(card.title, 240),
    fields: items.length ? [
      { label: text(items[0].title || "详情", 160), value: text(items[0].value || items[0].subtitle, 2000) },
    ] : [],
  };
}

function blocksFromAgentResult(result = {}) {
  if (result.ui && Array.isArray(result.ui.blocks)) return normalizeUiBlocks(result.ui.blocks);
  const blocks = [];
  const steps = Array.isArray(result.taskSteps) && result.taskSteps.length
    ? result.taskSteps
    : (Array.isArray(result.steps) ? result.steps : []);
  if (steps.length) blocks.push({ type: "plan", id: "plan_main", steps });
  if (result.answer) blocks.push({ type: "text", id: "text_answer", text: result.answer });
  (Array.isArray(result.cards) ? result.cards : []).forEach((card, index) => {
    const cardType = text(card && (card.type || card.cardType), 80).toLowerCase();
    blocks.push(cardType.includes("schedule") ? scheduleBlockFromCard(card || {}, index) : genericBlockFromCard(card || {}, index));
  });
  if (!blocks.length && Array.isArray(result.errors) && result.errors.length) {
    const error = result.errors[0] || {};
    blocks.push({ type: "error", id: "error_result", code: error.code || "AGENT_FAILED", message: error.message || "请求失败" });
  }
  return normalizeUiBlocks(blocks);
}

module.exports = {
  UI_BLOCK_TYPES,
  normalizeUiBlocks,
  blocksFromAgentResult,
};
