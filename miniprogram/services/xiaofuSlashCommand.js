const { SLASH_COMMANDS } = require("../shared/aiCapabilityRegistry.generated.js");

function normalizeInput(value) {
  return String(value == null ? "" : value).replace(/\u3000/g, " ").trim();
}

function commandCatalog() {
  return (Array.isArray(SLASH_COMMANDS) ? SLASH_COMMANDS : []).map((item) => Object.assign({}, item, {
    command: `/${item.name}`,
  }));
}

function filterCommands(value) {
  const input = normalizeInput(value);
  if (!input.startsWith("/")) return [];
  const query = input.slice(1).split(/\s+/)[0].toLowerCase();
  const list = commandCatalog();
  if (!query) return list;
  const exact = list.find((item) => item.name === query);
  if (exact) return [exact];
  return list.filter((item) => [item.name, item.label, item.description]
    .join(" ")
    .toLowerCase()
    .includes(query));
}

function hasTime(value) {
  return /今天|明天|后天|大后天|本周|下周|周[一二三四五六日天1-7]|上午|中午|下午|晚上|现在|第\s*\d+\s*节|\d+\s*[-~～至到]\s*\d+\s*节/.test(value);
}

function validateArguments(command, args) {
  if (!command || Number(command.minArgs || 0) === 0) return true;
  if (command.name === "teacher") {
    const subject = args.split(/第\s*\d+\s*周|周[一二三四五六日天1-7]|上午|中午|下午|晚上|江湾|仙溪|河滨/)[0].trim();
    return /^[\u3400-\u9fffA-Za-z·]{2,20}$/.test(subject);
  }
  if (command.name === "class") return /班/.test(args) || /\d{2,4}[\u3400-\u9fffA-Za-z]{1,12}\d{1,2}/.test(args);
  if (command.name === "room") return /校区|\b[A-Z]\d{1,2}\b|楼/i.test(args) && hasTime(args);
  if (command.name === "classroom") return /\b[A-Z]\d{1,2}[-－]\w+/i.test(args) && hasTime(args);
  if (command.name === "weather") return /江湾|仙溪|河滨/.test(args) && /今天|明天|后天|大后天/.test(args);
  if (command.name === "course") {
    const subject = args.replace(/第\s*\d+\s*周|本周|下周/g, "").trim();
    return subject.length >= 2;
  }
  return true;
}

function resolveCommand(value) {
  const input = normalizeInput(value);
  if (!input.startsWith("/")) return { isCommand: false, valid: true, message: input };
  const match = input.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  const commandName = String(match && match[1] || "").toLowerCase();
  const command = commandCatalog().find((item) => item.name === commandName);
  if (!command) {
    return {
      isCommand: true,
      valid: false,
      error: "未找到这个命令。输入 / 查看完整列表，或使用 /help。",
    };
  }
  const args = normalizeInput(match && match[2] || "");
  const argCount = args ? args.split(/\s+/).filter(Boolean).length : 0;
  if (argCount < Number(command.minArgs || 0)) {
    return {
      isCommand: true,
      valid: false,
      command,
      error: `参数还不完整，请按示例输入：${command.example || command.usage}`,
    };
  }
  if (!validateArguments(command, args)) {
    return {
      isCommand: true,
      valid: false,
      command,
      error: `参数格式不符合命令约定，请照此修改：${command.example || command.usage}`,
    };
  }
  return {
    isCommand: true,
    valid: true,
    command,
    displayText: input,
    message: command.message || `${command.messagePrefix || ""}${args}`.trim(),
  };
}

module.exports = {
  commandCatalog,
  filterCommands,
  normalizeInput,
  resolveCommand,
  validateArguments,
};
