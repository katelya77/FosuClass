const { SLASH_COMMANDS } = require("../shared/aiCapabilityRegistry.generated.js");

const RECENT_COMMANDS_KEY = "FOSU_XIAOFU_RECENT_SLASH_COMMANDS";
const MAX_RECENT_COMMANDS = 5;
const PLACEHOLDER_ARGUMENTS = ["教师姓名", "班级名称", "课程名称", "教室名称", "校区或楼栋", "时间", "日期"];

let memoryRecentCommands = [];

function normalizeInput(value) {
  return String(value == null ? "" : value)
    .replace(/\u3000/g, " ")
    .replace(/^\s*／/, "/")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeCommandToken(value) {
  return String(value || "").trim().toLowerCase().replace(/^[/／]/, "");
}

function normalizeRecentNames(value) {
  const known = new Set((Array.isArray(SLASH_COMMANDS) ? SLASH_COMMANDS : []).map((item) => item.name));
  const output = [];
  (Array.isArray(value) ? value : []).forEach((name) => {
    const normalized = normalizeCommandToken(name);
    if (known.has(normalized) && output.indexOf(normalized) < 0) output.push(normalized);
  });
  return output.slice(0, MAX_RECENT_COMMANDS);
}

function getWx() {
  return typeof wx !== "undefined" ? wx : null;
}

function readRecentCommandNames() {
  const wxRef = getWx();
  if (!wxRef) return normalizeRecentNames(memoryRecentCommands);
  try {
    return normalizeRecentNames(wxRef.getStorageSync(RECENT_COMMANDS_KEY));
  } catch (error) {
    return [];
  }
}

function recordRecentCommand(commandOrName) {
  const name = normalizeCommandToken(commandOrName && commandOrName.name || commandOrName);
  const names = normalizeRecentNames([name].concat(readRecentCommandNames()));
  const wxRef = getWx();
  if (!wxRef) {
    memoryRecentCommands = names;
    return names;
  }
  try {
    wxRef.setStorageSync(RECENT_COMMANDS_KEY, names);
  } catch (error) {
    // Recent ordering is a non-critical, local-only enhancement.
  }
  return names;
}

function resetRecentCommandsForTest() {
  memoryRecentCommands = [];
}

function buildCommandDraft(command, contextSlots) {
  const source = command || {};
  const context = contextSlots && typeof contextSlots === "object" && !Array.isArray(contextSlots)
    ? contextSlots
    : {};
  let value = String(source.example || source.usage || source.command || "");
  const reused = [];
  const week = Number(context.lastWeek);
  if (Number.isFinite(week) && week >= 1 && week <= 30 && /第\s*8\s*周/.test(value)) {
    value = value.replace(/第\s*8\s*周/g, `第${Math.floor(week)}周`);
    reused.push("周次");
  }
  const weekday = Number(context.lastWeekday);
  const weekdayText = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][weekday] || "";
  if (weekdayText && /周三/.test(value)) {
    value = value.replace(/周三/g, weekdayText);
    reused.push("星期");
  }
  return {
    value,
    reusedContext: reused,
  };
}

function commandCatalog(options) {
  const recentNames = normalizeRecentNames(options && options.recentNames !== undefined
    ? options.recentNames
    : readRecentCommandNames());
  const recentRank = new Map(recentNames.map((name, index) => [name, index]));
  return (Array.isArray(SLASH_COMMANDS) ? SLASH_COMMANDS : []).map((item, index) => Object.assign({}, item, {
    command: `/${item.name}`,
    aliases: Array.isArray(item.aliases) ? item.aliases.slice() : [],
    recent: recentRank.has(item.name),
    recentRank: recentRank.has(item.name) ? recentRank.get(item.name) : MAX_RECENT_COMMANDS + index,
  }));
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function scoreCommand(command, query) {
  const token = normalizeCommandToken(query);
  if (!token) return { score: 1, matchKind: command.recent ? "recent" : "all" };
  const name = normalizeCommandToken(command.name);
  const aliases = (command.aliases || []).map(normalizeCommandToken).filter(Boolean);
  if (name === token) return { score: 100, matchKind: "exact" };
  if (aliases.indexOf(token) >= 0) return { score: 96, matchKind: "alias" };
  if (token.length >= 2 && name.startsWith(token)) return { score: 88, matchKind: "prefix" };
  if (token.length >= 2 && aliases.some((alias) => alias.startsWith(token))) return { score: 84, matchKind: "prefix" };
  const searchable = [command.label, command.description].concat(command.aliases || [])
    .join(" ")
    .toLowerCase();
  if (searchable.includes(token)) return { score: 72, matchKind: "keyword" };
  if (/^[a-z0-9-]+$/.test(token) && token.length >= 4) {
    const maxDistance = token.length >= 8 ? 2 : 1;
    const distance = Math.min.apply(null, [name].concat(aliases.filter((alias) => /^[a-z0-9-]+$/.test(alias)))
      .map((candidate) => levenshteinDistance(token, candidate)));
    if (distance <= maxDistance) return { score: 64 - distance, matchKind: "fuzzy" };
  }
  return { score: 0, matchKind: "" };
}

function rankCommands(value, options) {
  const input = normalizeInput(value);
  if (!input.startsWith("/")) return [];
  const query = normalizeCommandToken(input.slice(1).split(/\s+/)[0]);
  return commandCatalog(options)
    .map((item) => Object.assign({}, item, scoreCommand(item, query)))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (!query && left.recent !== right.recent) return left.recent ? -1 : 1;
      if (!query && left.recentRank !== right.recentRank) return left.recentRank - right.recentRank;
      if (right.score !== left.score) return right.score - left.score;
      return left.name.localeCompare(right.name);
    });
}

function filterCommands(value, options) {
  return rankCommands(value, options);
}

function resolveCommandToken(token) {
  const ranked = rankCommands(`/${normalizeCommandToken(token)}`, { recentNames: [] });
  if (!ranked.length) return { command: null, suggestions: [] };
  const top = ranked[0];
  if (top.matchKind === "exact" || top.matchKind === "alias") {
    return { command: top, suggestions: ranked.slice(0, 3) };
  }
  const second = ranked[1];
  const uniquelySafe = ["prefix", "fuzzy"].indexOf(top.matchKind) >= 0
    && (!second || second.score < top.score);
  return {
    command: uniquelySafe ? top : null,
    suggestions: ranked.slice(0, 3),
  };
}

function hasTime(value) {
  return /今天|明天|后天|大后天|本周|下周|周[一二三四五六日天1-7]|上午|中午|下午|晚上|现在|第\s*\d+\s*节|\d+\s*[-~～至到]\s*\d+\s*节/.test(value);
}

function validateArguments(command, args) {
  if (!command || Number(command.minArgs || 0) === 0) return true;
  if (PLACEHOLDER_ARGUMENTS.some((placeholder) => String(args || "").includes(placeholder))) return false;
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
  const matchResult = resolveCommandToken(commandName);
  const command = matchResult.command;
  if (!command) {
    const suggestions = matchResult.suggestions || [];
    return {
      isCommand: true,
      valid: false,
      suggestions,
      error: suggestions.length
        ? `命令不够明确，你可能想用：${suggestions.map((item) => item.command).join("、")}`
        : "未找到这个命令。输入 / 查看完整列表，或使用 /help。",
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
    const hasPlaceholder = PLACEHOLDER_ARGUMENTS.some((placeholder) => args.includes(placeholder));
    return {
      isCommand: true,
      valid: false,
      command,
      error: hasPlaceholder
        ? `请先把示例中的参数占位文字替换完整：${command.usage}`
        : `参数格式不符合命令约定，请照此修改：${command.usage || command.example}`,
    };
  }
  return {
    isCommand: true,
    valid: true,
    command,
    displayText: input,
    canonicalCommand: command.command,
    matchedBy: command.matchKind || "exact",
    message: command.message || `${command.messagePrefix || ""}${args}`.trim(),
  };
}

module.exports = {
  MAX_RECENT_COMMANDS,
  RECENT_COMMANDS_KEY,
  buildCommandDraft,
  commandCatalog,
  filterCommands,
  levenshteinDistance,
  normalizeInput,
  readRecentCommandNames,
  recordRecentCommand,
  resetRecentCommandsForTest,
  resolveCommand,
  resolveCommandToken,
  validateArguments,
};
