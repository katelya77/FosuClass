"use strict";

const { BaseAdapter } = require("./base-adapter");
const { parseWeekExpression } = require("../week-expression");
const { validateCanonicalEvent } = require("../validator");

const WEEKDAY_MAP = {
  "一": 1, "1": 1, "1.": 1,
  "二": 2, "2": 2, "2.": 2,
  "三": 3, "3": 3, "3.": 3,
  "四": 4, "4": 4, "4.": 4,
  "五": 5, "5": 5, "5.": 5,
  "六": 6, "6": 6, "6.": 6,
  "日": 7, "天": 7, "7": 7, "7.": 7,
};

function parsePeriods(raw, row, errors, index) {
  const m = String(raw || "").trim().match(/^(\d+)\s*[-~至]\s*(\d+)$/);
  if (!m) {
    errors.push(`第 ${index + 1} 行节次「${raw}」无法解析（需形如 1-2）`);
    return null;
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 12 || end < start) {
    errors.push(`第 ${index + 1} 行节次「${raw}」超出 1..12 或反向`);
    return null;
  }
  return { periodStart: start, periodEnd: end };
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
}

/**
 * portal-family-qz-legacy 适配器（R49.4 边界契约）：
 * - 只接受「已解析的 worksheet 结构」（{ worksheets: [...] }），不接受原始文件字节；
 * - 无 worksheets 或非预期结构 → fail-closed；
 * - 逐行规范化 → canonical event；坏行进 skipped，不影响其余行；
 * - 产出事件必须全部通过 validateCanonicalEvent，且 namespace 为 anonymous/synthetic-example 等中性命名空间。
 * 本适配器绝不联网、绝不读取凭据、绝不导入真实学校数据。
 */
class PortalFamilyQzLegacyAdapter extends BaseAdapter {
  constructor() {
    super({
      id: "portal-family-qz-legacy",
      name: "Portal Family QZ Legacy (normalization contract)",
      capabilities: { detectMagic: ["ole2"], parseWeeks: true, normalizeToCanonical: true },
    });
  }

  validateInput(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, errors: ["输入必须是对象"] };
    }
    if (!Array.isArray(input.worksheets) || input.worksheets.length === 0) {
      return { ok: false, errors: ["缺少已解析的 worksheets 结构（fail-closed：不接受原始字节）"] };
    }
    return { ok: true };
  }

  adapt(input) {
    const inputCheck = this.validateInput(input);
    if (!inputCheck.ok) return inputCheck;

    const skipped = [];
    const events = [];

    for (const ws of input.worksheets) {
      if (ws === null || typeof ws !== "object" || !Array.isArray(ws.rows)) {
        skipped.push({ worksheet: ws && ws.id, errors: ["worksheet 缺少 rows 数组"] });
        continue;
      }
      for (let i = 0; i < ws.rows.length; i += 1) {
        const row = ws.rows[i];
        if (row === null || typeof row !== "object") {
          skipped.push({ worksheet: ws.id, rowIndex: i, errors: ["行不是对象"] });
          continue;
        }
        const errors = [];
        const courseName = pick(row, ["课程名称", "课程", "course"]);
        const teacher = pick(row, ["教师", "教师姓名", "teacher"]);
        const className = pick(row, ["班级", "授课班级", "class"]);
        const room = pick(row, ["地点", "教室", "room"]);
        const campus = pick(row, ["校区", "campus"]);
        const weekdayRaw = pick(row, ["星期", "周几", "weekday"]);
        const weekRaw = pick(row, ["周次", "周数", "weeks"]);

        if (courseName === "") errors.push(`第 ${i + 1} 行缺少课程名称`);
        if (teacher === "") errors.push(`第 ${i + 1} 行缺少教师`);
        if (className === "") errors.push(`第 ${i + 1} 行缺少班级`);
        if (room === "") errors.push(`第 ${i + 1} 行缺少地点`);
        if (campus === "") errors.push(`第 ${i + 1} 行缺少校区`);

        let weekday = null;
        if (weekdayRaw !== "") {
          weekday = WEEKDAY_MAP[weekdayRaw];
          if (weekday === undefined) errors.push(`第 ${i + 1} 行星期「${weekdayRaw}」无法识别`);
        } else {
          errors.push(`第 ${i + 1} 行缺少星期`);
        }

        const periods = parsePeriods(pick(row, ["节次", "时段", "period"]), row, errors, i);

        let weeks = null;
        if (weekRaw !== "") {
          try {
            weeks = parseWeekExpression(weekRaw);
          } catch (e) {
            errors.push(`第 ${i + 1} 行周次「${weekRaw}」无法解析：${e.message}`);
          }
        } else {
          errors.push(`第 ${i + 1} 行缺少周次`);
        }

        if (errors.length > 0) {
          skipped.push({ worksheet: ws.id, rowIndex: i, rowSummary: `${courseName || "?"} / ${teacher || "?"}`, errors });
          continue;
        }

        const event = {
          namespace: input.namespace || "anonymous",
          semesterId: input.semester && input.semester.id ? String(input.semester.id) : "anonymous-semester",
          course: { name: courseName },
          teachers: [teacher],
          classes: [className],
          location: { campus, room },
          weekday,
          periodStart: periods.periodStart,
          periodEnd: periods.periodEnd,
          weeks,
          source: {
            providerFamily: this.id,
            sourceType: "xls-legacy",
            importedAt: input.source && input.source.importedAt ? input.source.importedAt : "synthetic",
            confidence: input.source && typeof input.source.confidence === "number" ? input.source.confidence : 1.0,
          },
        };

        const check = validateCanonicalEvent(event);
        if (!check.ok) {
          skipped.push({ worksheet: ws.id, rowIndex: i, rowSummary: courseName, errors: check.errors });
          continue;
        }
        events.push(event);
      }
    }

    return { ok: true, events, skipped, source: { providerFamily: this.id } };
  }
}

const qzLegacyAdapter = new PortalFamilyQzLegacyAdapter();

module.exports = qzLegacyAdapter;
