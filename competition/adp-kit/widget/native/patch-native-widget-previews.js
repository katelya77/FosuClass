#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const inputDir = process.argv[2];
const outputDir = process.argv[3] || inputDir;
if (!inputDir) {
  console.error("usage: node patch-native-widget-previews.js <input-dir> [output-dir]");
  process.exit(2);
}
fs.mkdirSync(outputDir, { recursive: true });

const badge = (label, color = "secondary", variant = "soft") => ({ type: "Badge", label, color, variant, size: "sm", pill: true });
const caption = (value, color = "secondary") => ({ type: "Caption", value, color });
const text = (value, color = "#173F35", weight = "semibold") => ({ type: "Text", value, size: "md", color, weight });
const title = (value) => ({ type: "Title", value, size: "md", color: "#173F35" });
const divider = () => ({ type: "Divider", color: "#E3DDD0", spacing: "4px" });
const row = (children, extra = {}) => ({ type: "Row", children, gap: 2, align: "center", ...extra });
const col = (children, extra = {}) => ({ type: "Col", children, gap: 1, ...extra });
const card = (children, status, background = "#F6F2E8") => ({ type: "Card", children, size: "md", background, ...(status ? { status } : {}) });
const list = (children, status, limit = 5) => ({ type: "ListView", children, limit, ...(status ? { status } : {}) });
const item = (children, align = "start") => ({ type: "ListViewItem", children, gap: "12px", align });
const button = (action, primary = false) => ({
  type: "Button",
  label: action.label,
  style: primary ? "primary" : "secondary",
  color: "primary",
  variant: primary ? "solid" : "outline",
  size: "sm",
  pill: true,
  onClickAction: { type: "sys.chat", payload: { query: action.message } },
});
const actions = (values, primaryId) => row(values.slice(0, 3).map((action) => button(action, action.id === primaryId)), { wrap: "wrap" });

function header(kicker, state, badgeLabel = "已核验", badgeColor = "success") {
  return row([
    col([caption(kicker, "#173F35"), title(state.title), ...(state.subtitle ? [caption(state.subtitle)] : []), ...(state.timeText ? [caption(state.timeText)] : [])], { flex: 1 }),
    badge(badgeLabel, badgeColor),
  ], { align: "start" });
}

function schedule(state) {
  const rows = (state.items || []).slice(0, 5).map((lesson) => item([
    badge(lesson.periodText || "课程", "info", "outline"),
    col([
      text(lesson.courseName || "未命名课程"),
      caption([lesson.campusName, lesson.building, lesson.roomName].filter(Boolean).join(" · ")),
      caption([lesson.startTime && lesson.endTime ? `${lesson.startTime}-${lesson.endTime}` : "", (lesson.teachers || []).join("、")].filter(Boolean).join(" · ")),
    ], { flex: 1 }),
  ]));
  return card([
    header("CAMPUS TASK / SCHEDULE", state),
    divider(),
    row([badge(`${state.summary.totalCount} 条课程`, "info"), badge("时间票据", "secondary", "outline")]),
    list(rows, `显示前 ${state.summary.shownCount} 条`),
    divider(),
    actions(state.actions || [], "schedule-week"),
    caption(`数据版本 ${state.dataVersion} · 查询编号 ${state.queryId}`),
  ], { text: `已核验 · ${state.dataVersion}` });
}

function classroom(state) {
  const chips = (state.filters || []).map((filter) => badge(filter.label, filter.id === "capacity" ? "warning" : "info"));
  const rows = (state.items || []).slice(0, 5).map((room) => item([
    col([
      row([text(room.roomName || "教室"), badge(`${room.capacity || 0}人`, "info", "outline")]),
      caption([room.campusName, room.building, room.roomType].filter(Boolean).join(" · ")),
      caption([room.date, room.periodText].filter(Boolean).join(" · ")),
    ], { flex: 1 }),
  ]));
  const body = [
    header("CAMPUS TASK / CLASSROOM", state),
    divider(),
    row(chips, { wrap: "wrap" }),
    row([badge(state.summary.empty ? "暂无匹配" : `${state.summary.totalCount} 间可用`, state.summary.empty ? "warning" : "success"), badge("空间票据", "secondary", "outline")]),
  ];
  if (state.summary.empty) body.push(card([text("没有找到满足全部条件的空闲教室", "#8A5A00"), caption("可以放宽容量、取消楼栋限制或更换时段。")], null, "#FFF8E8"));
  else body.push(list(rows, `显示前 ${state.summary.shownCount} 间`));
  body.push(divider(), actions(state.actions || [], "classroom-change-campus"), caption(`数据版本 ${state.dataVersion} · 查询编号 ${state.queryId}`));
  return card(body, { text: `已核验 · ${state.dataVersion}` });
}

function conflict(state) {
  const body = [
    header("CAMPUS TASK / RISK CHECK", state),
    divider(),
    row([
      badge(`时间冲突 ${state.summary.conflictCount} 处`, state.summary.conflictCount ? "danger" : "success"),
      badge(`赶场提醒 ${state.summary.rushWarningCount} 条`, state.summary.rushWarningCount ? "warning" : "success"),
    ], { wrap: "wrap" }),
  ];
  if ((state.items || []).length) {
    body.push(caption("时间冲突", "#A54232"));
    body.push(list(state.items.slice(0, 5).map((value) => item([
      badge(value.periodText || "冲突", "danger"),
      col([
        text(`${value.first.courseName || "第一方"} ↔ ${value.second.courseName || "第二方"}`, "#A54232"),
        caption(`${value.date || ""} ${value.weekdayName || ""} · ${value.periodText || ""}`),
        caption(`${value.first.campusName || ""} ${value.first.roomName || ""} / ${value.second.campusName || ""} ${value.second.roomName || ""}`),
      ], { flex: 1 }),
    ])), `共 ${state.summary.conflictCount} 处`));
  }
  if ((state.rushWarnings || []).length) {
    body.push(caption("跨校区赶场", "#8A5A00"));
    body.push(list(state.rushWarnings.slice(0, 5).map((value) => item([
      badge("赶场", "warning"),
      col([
        text(`${value.from.courseName || "前一课程"} → ${value.to.courseName || "后一课程"}`, "#8A5A00"),
        caption(`${value.from.periodText || ""} ${value.from.campusName || ""} · ${value.from.roomName || ""}`),
        caption(`${value.to.periodText || ""} ${value.to.campusName || ""} · ${value.to.roomName || ""} · 间隔约 ${value.gapMinutes || 0} 分钟`),
      ], { flex: 1 }),
    ])), `共 ${state.summary.rushWarningCount} 条`));
  }
  if (!(state.items || []).length && !(state.rushWarnings || []).length) body.push(card([text("当前范围内没有发现时间冲突或赶场风险。")], null, "#EDF6EF"));
  body.push(divider(), actions(state.actions || []), caption(`数据版本 ${state.dataVersion} · 查询编号 ${state.queryId}`));
  return card(body, { text: `已核验 · ${state.dataVersion}` });
}

function dayPlan(state) {
  const rows = (state.items || []).slice(0, 8).map((value) => {
    if (value.type === "lesson") return item([
      badge(value.periodText || "课程", "info", "outline"),
      col([
        text(value.courseName || "课程"),
        caption([value.startTime && value.endTime ? `${value.startTime}-${value.endTime}` : "", value.campusName, value.roomName].filter(Boolean).join(" · ")),
        caption((value.teachers || []).join("、")),
      ], { flex: 1 }),
    ]);
    return item([
      badge("空档", "success", "outline"),
      col([
        text(value.suggestion || "空闲时段"),
        caption(`${value.startTime || ""}-${value.endTime || ""} · ${value.periodText || ""}`),
        caption((value.studyRooms || []).length ? `推荐：${value.studyRooms.join("、")}` : "可继续让小序规划自习"),
      ], { flex: 1 }),
    ]);
  });
  return card([
    header("CAMPUS TASK / DAY PLAN", state),
    divider(),
    row([
      badge(`${state.summary.lessonCount} 节课程`, "info"),
      badge(`${state.summary.gapCount} 个空档`, "success"),
      badge(state.summary.hasCrossCampus ? "存在跨校区" : "动线稳定", state.summary.hasCrossCampus ? "warning" : "success"),
    ], { wrap: "wrap" }),
    list(rows, "今日时间轴", 8),
    divider(),
    actions(state.actions || [], "day-plan-classroom"),
    caption(`数据版本 ${state.dataVersion} · 查询编号 ${state.queryId}`),
  ], { text: `已核验 · ${state.dataVersion}` });
}

function choice(state) {
  const rows = (state.items || []).slice(0, 5).map((value, index) => item([
    badge(String(index + 1), "warning", "outline"),
    col([text(value.name || "候选"), caption([value.type, value.description].filter(Boolean).join(" · "))], { flex: 1 }),
    button({ label: "选择", message: value.action.message }, false),
  ], "center"));
  return card([
    header("CAMPUS TASK / CONFIRM", state, "待确认", "warning"),
    divider(),
    list(rows, "请选择一个候选"),
    divider(),
    actions(state.actions || []),
    caption("选择后会继续刚才的任务，不需要重新输入查询条件。"),
  ], "需要你的确认");
}

function recovery(state) {
  return card([
    header("CAMPUS TASK / RECOVERY", state, "待恢复", "danger"),
    divider(),
    card([text(state.error.message, "#A54232"), caption(`错误类型：${state.error.code}`)], null, "#FFF0EC"),
    caption("小序不会在工具失败时补造动态校园事实。", "#173F35"),
    actions(state.actions || [], "error-retry"),
    caption(`数据版本 ${state.dataVersion} · 查询编号 ${state.queryId}`),
  ], "任务未完成");
}

const builders = [
  [/课表票据/, schedule],
  [/空教室票据/, classroom],
  [/冲突赶场票据/, conflict],
  [/今日校园计划/, dayPlan],
  [/候选确认/, choice],
  [/任务恢复/, recovery],
];

const files = fs.readdirSync(inputDir).filter((name) => name.endsWith(".widget"));
assert.strictEqual(files.length, 6, `expected six .widget files, got ${files.length}`);

for (const file of files) {
  const inputPath = path.join(inputDir, file);
  const widget = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const inner = JSON.parse(Buffer.from(widget.encodedWidget, "base64").toString("utf8"));
  const match = builders.find(([pattern]) => pattern.test(widget.name || file));
  assert(match, `unknown widget type: ${file}`);
  widget.outputJsonPreview = match[1](inner.defaultState);
  const target = path.join(outputDir, file);
  fs.writeFileSync(target, `${JSON.stringify(widget, null, 2)}\n`, "utf8");
}

console.log(`patched ${files.length} native Widget previews in ${outputDir}`);
