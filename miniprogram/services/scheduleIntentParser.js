const contextManager = require("./xiaofuContextManager");

const WEEKDAY_MAP = {
  "一": 1,
  "1": 1,
  "二": 2,
  "两": 2,
  "2": 2,
  "三": 3,
  "3": 3,
  "四": 4,
  "4": 4,
  "五": 5,
  "5": 5,
  "六": 6,
  "6": 6,
  "日": 7,
  "天": 7,
  "七": 7,
  "7": 7,
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/[，。！？；：、]/g, " ")
    .replace(/\s+/g, " ");
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function isScheduleStatusText(text) {
  const value = compactText(text);
  if (!value) return false;
  return /课表数据|全校课表.*(最新|更新|准|准确|可靠|状态|来源|版本)|数据.*(最新|更新|准|准确|可靠|状态|来源|版本|缓存|同步)|现在用的是哪个学期|哪个学期数据|什么时候更新|更新到什么时候|数据什么时候|当前.*教学周|现在.*教学周|第几教学周|教学周.*第几/.test(value);
}

function isScheduleHelpText(text) {
  const value = compactText(text);
  if (!value) return false;
  return /^(怎么|如何|怎样).*(查|查询|看).*(课表|课程|班级|老师|教师|教室)|^(能查什么|你能做什么|你可以做什么|我能问你什么|使用说明|帮助|功能介绍)$|^(怎么查课表|如何查课表|全校课表怎么用)/.test(value);
}

function clampWeek(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback || null;
  return Math.max(1, Math.min(30, Math.floor(number)));
}

function parseRelativeDay(text, clientContext = {}) {
  const value = compactText(text);
  const currentWeek = clampWeek(clientContext.currentTeachingWeek || clientContext.currentWeek, null);
  const todayWeekday = Number(clientContext.todayWeekday || 0) || new Date().getDay() || 7;
  const normalizedToday = todayWeekday === 0 ? 7 : todayWeekday;
  let offset = null;
  if (/今天|今日/.test(value)) offset = 0;
  if (/明天|明日/.test(value)) offset = 1;
  if (/后天/.test(value)) offset = 2;
  if (offset === null) return null;
  const rawDay = normalizedToday + offset;
  const weekOffset = Math.floor((rawDay - 1) / 7);
  return {
    weekday: ((rawDay - 1) % 7) + 1,
    week: currentWeek ? currentWeek + weekOffset : null,
    weekdaySource: offset === 0 ? "今天" : (offset === 1 ? "明天" : "后天"),
    weekSource: offset === 0 ? "本周" : "",
  };
}

function parseWeek(text, clientContext = {}) {
  const value = compactText(text);
  const currentWeek = clampWeek(clientContext.currentTeachingWeek || clientContext.currentWeek, null);
  if (/本周|这周|当前周|这一周/.test(value)) {
    return { week: currentWeek, weekSource: "本周" };
  }
  if (/下周|下一周/.test(value)) {
    return { week: currentWeek ? currentWeek + 1 : null, weekSource: "下周" };
  }
  const explicit = value.match(/第?(\d{1,2})周/);
  if (explicit) {
    return { week: clampWeek(explicit[1], null), weekSource: `第${Number(explicit[1])}周` };
  }
  return { week: null, weekSource: "" };
}

function parseWeekday(text) {
  const value = compactText(text);
  const match = value.match(/(?:星期|周|礼拜)([一二两三四五六日天七1-7])/);
  if (!match) return { weekday: null, weekdaySource: "" };
  const weekday = WEEKDAY_MAP[match[1]];
  return {
    weekday,
    weekdaySource: weekday ? `周${["", "一", "二", "三", "四", "五", "六", "日"][weekday]}` : "",
  };
}

function removeTimeWords(text) {
  return compactText(text)
    .replace(/今天|今日|明天|明日|后天/g, "")
    .replace(/本周|这周|当前周|这一周|下周|下一周/g, "")
    .replace(/第?\d{1,2}周/g, "")
    .replace(/(?:星期|周|礼拜)[一二两三四五六日天七1-7]/g, "");
}

function stripIntentWords(text) {
  return removeTimeWords(text)
    .replace(/^(帮我|请|麻烦|小佛|小佛校园助手|查|查询|查看|看|找|打开|跳转|换成|改成|切到|切换到)+/g, "")
    .replace(/(的)?(课表|课程表|课程安排|排课|上课安排|有没有课|有课吗|课|这门课|课程)$/g, "")
    .replace(/^(这个|该|那|再看|继续看)/g, "")
    .trim();
}

function extractRoom(text) {
  const value = compactText(text).toUpperCase();
  const match = value.match(/(?:(仙溪|江湾|河滨)(?:校区)?)?([A-Z]\d{1,2}[-－]?\d{2,4})/);
  if (!match) return null;
  const campus = match[1] ? `${match[1]}校区` : "";
  const roomName = match[2].replace("－", "-");
  return {
    targetType: "classroom",
    targetName: campus ? `${campus}${roomName}` : roomName,
    rawTargetName: roomName,
    campus,
  };
}

function extractTeacher(text) {
  const value = compactText(text);
  const match = value.match(/(?:查|查询|查看|看|找)?([\u4e00-\u9fa5]{2,4})(?:老师|教师|讲师|教授|副教授)/);
  if (match) {
    return {
      targetType: "teacher",
      targetName: match[1],
      rawTargetName: match[1],
    };
  }
  const plain = stripIntentWords(value);
  if (/^(老师|教师|某老师|任课教师)$/.test(plain)) return null;
  if (/老师|教师/.test(value) && /^[\u4e00-\u9fa5]{2,4}$/.test(plain)) {
    return {
      targetType: "teacher",
      targetName: plain,
      rawTargetName: plain,
    };
  }
  return null;
}

function extractClass(text) {
  const value = removeTimeWords(text);
  const match = value.match(/(\d{2,4}[\u4e00-\u9fa5]{1,12}?\d{1,2}班?)/);
  if (!match) return null;
  return {
    targetType: "class",
    targetName: match[1],
    rawTargetName: match[1],
  };
}

function extractCourse(text) {
  const value = compactText(text);
  if (isScheduleStatusText(value) || isScheduleHelpText(value)) return null;
  if (!/(课程|这门课|课表|排课|上课安排)/.test(value)) return null;
  const withoutTime = stripIntentWords(value)
    .replace(/老师|教师|教室|班级|班/g, "")
    .replace(/^(课程|科目)/g, "")
    .replace(/(课程|科目)$/g, "");
  if (/^(数据|课表数据|全校课表|当前学期|学期数据|更新时间|更新情况|准确性|可靠性|状态)$/.test(withoutTime)) return null;
  if (/某|示例|课程安排|课程名称|课程名|这门课程/.test(withoutTime)) return null;
  if (/(是否|是不是|准不准|准确|可靠|最新|更新|什么时候|怎么|如何|能查|什么|状态|来源|版本|缓存)/.test(withoutTime)) return null;
  if (!withoutTime || /\d{2,4}[\u4e00-\u9fa5]{1,12}?\d{1,2}/.test(withoutTime)) return null;
  if (/^[A-Z]\d{1,2}[-－]?\d{2,4}$/i.test(withoutTime)) return null;
  return {
    targetType: "course",
    targetName: withoutTime,
    rawTargetName: withoutTime,
  };
}

function inferRequestedTargetType(text) {
  const value = compactText(text);
  if (!value) return "";
  if (/班级|行政班|自然班|某班/.test(value)) return "class";
  if (/老师|教师|任课教师|某老师/.test(value)) return "teacher";
  if (/教室|课室|空教室|占用|某教室/.test(value)) return "classroom";
  if (/课程|科目|某门课|某课程/.test(value)) return "course";
  return "";
}

function hasScheduleCue(text) {
  const value = compactText(text);
  return /(课表|课程表|排课|上课安排|有没有课|有课吗|查.*课|看.*课|老师.*课|教师.*课|教室.*课|班.*课|这门课|教室.*占用|课程安排)/.test(value);
}

function isFollowupText(text) {
  const value = compactText(text);
  return /^(那|这个|该|继续|再|换成|改成|切到|切换到)/.test(value) ||
    /^(第?\d{1,2}周|周[一二三四五六日天]|星期[一二三四五六日天]|明天|后天|今天).*(呢|吗)?$/.test(value);
}

function parseScheduleIntent(message, contextSlots, clientContext = {}) {
  const text = normalizeText(message);
  if (isScheduleStatusText(text) || isScheduleHelpText(text)) {
    return {
      isScheduleIntent: false,
      rawText: text,
      blockedBy: isScheduleStatusText(text) ? "schedule_status" : "help",
    };
  }
  const compact = compactText(text);
  const weekInfo = parseWeek(text, clientContext);
  const weekdayInfo = parseWeekday(text);
  const relativeDay = parseRelativeDay(text, clientContext);
  const timePatch = {
    week: relativeDay && relativeDay.week ? relativeDay.week : weekInfo.week,
    weekSource: relativeDay && relativeDay.weekSource ? relativeDay.weekSource : weekInfo.weekSource,
    weekday: relativeDay && relativeDay.weekday ? relativeDay.weekday : weekdayInfo.weekday,
    weekdaySource: relativeDay && relativeDay.weekdaySource ? relativeDay.weekdaySource : weekdayInfo.weekdaySource,
  };

  const target =
    extractClass(text) ||
    extractTeacher(text) ||
    extractRoom(text) ||
    extractCourse(text);
  const requestedTargetType = target && target.targetType || inferRequestedTargetType(text);

  const followup = contextManager.getFollowupTarget(contextSlots);
  const inheritsContext = !target && followup && isFollowupText(text);
  const hasCue = hasScheduleCue(text) || Boolean(target) || inheritsContext;
  if (!hasCue) {
    return {
      isScheduleIntent: false,
      rawText: text,
    };
  }

  let resolved = target || null;
  if (!resolved && followup) {
    resolved = {
      targetType: followup.targetType,
      targetName: followup.targetName,
      rawTargetName: followup.targetName,
      inherited: true,
    };
  }

  if (resolved && (compact.indexOf("换成") >= 0 || compact.indexOf("改成") >= 0 || compact.indexOf("切换到") >= 0)) {
    if (!timePatch.week && followup && followup.week) {
      timePatch.week = followup.week;
      timePatch.weekSource = `第${followup.week}周`;
    }
    if (!timePatch.weekday && followup && followup.weekday) {
      timePatch.weekday = followup.weekday;
      timePatch.weekdaySource = getWeekdayLabel(followup.weekday);
    }
  }

  return Object.assign({
    isScheduleIntent: true,
    intentName: "school_schedule_query",
    rawText: text,
    targetType: resolved && resolved.targetType || requestedTargetType || "",
    targetName: resolved && resolved.targetName || "",
    rawTargetName: resolved && resolved.rawTargetName || resolved && resolved.targetName || "",
    inherited: Boolean(resolved && resolved.inherited),
  }, timePatch);
}

function getWeekdayLabel(weekday) {
  const labels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return labels[Number(weekday)] || "";
}

function getTimeSubtitle(parsed, currentWeek) {
  const week = Number(parsed && parsed.week);
  const weekday = Number(parsed && parsed.weekday);
  const parts = [];
  if (Number.isFinite(week) && week > 0) {
    if (week === Number(currentWeek) && (!parsed.weekSource || parsed.weekSource === "本周")) parts.push("本周");
    else parts.push(`第${week}周`);
  } else {
    parts.push("全周");
  }
  if (Number.isFinite(weekday) && weekday > 0) parts.push(getWeekdayLabel(weekday));
  return parts.join(" ");
}

module.exports = {
  getTimeSubtitle,
  getWeekdayLabel,
  hasScheduleCue,
  isScheduleHelpText,
  isScheduleStatusText,
  parseRelativeDay,
  parseScheduleIntent,
  parseWeek,
  parseWeekday,
  stripIntentWords,
};
