#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "acceptance", "widget-payloads");
const OUTPUT = path.join(__dirname, "widget-html");

function esc(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function actions(items) {
  if (!items.length) return "";
  return `<footer>${items.slice(0, 3).map((item, index) =>
    `<button class="${index ? "secondary" : "primary"}">${esc(item.label)}</button>`).join("")}</footer>`;
}

function row(item) {
  return `<div class="row"><div class="rowcopy"><b>${esc(item.label)}</b><span>${esc(item.value)}</span>${item.hint ? `<small>${esc(item.hint)}</small>` : ""}</div>${item.badge ? `<em>${esc(item.badge)}</em>` : ""}</div>`;
}

function sections(payload) {
  return payload.sections.map((section, index) => `<section class="${payload.variant === "overview" && index === 0 ? "metric-grid" : ""}">
    <h2>${esc(section.title)}</h2>${section.note ? `<p class="note">${esc(section.note)}</p>` : ""}
    <div class="rows">${section.rows.map(row).join("")}</div></section>`).join("");
}

function weekBoard(payload) {
  return `<div class="weekboard">${payload.days.map((day) => `<section class="day"><h2>${esc(day.label)}</h2>${day.blocks.map((block) =>
    `<div class="lesson"><span class="time">${esc(block.time)}</span><b>${esc(block.title)}</b><span>${esc(block.location)}</span><small>${esc(block.meta)}</small></div>`).join("")}</section>`).join("")}</div>`;
}

function dayTimeline(payload) {
  const rows = payload.sections.flatMap((section) => section.rows);
  return `<section class="timeline"><h2>当日时间线</h2>${rows.map((item) => `<div class="timeline-row"><span class="clock">${esc(item.badge || item.label)}</span><div class="timeline-copy"><b>${esc(item.value)}</b><small>${esc(item.hint || item.label)}</small></div></div>`).join("")}</section>`;
}

function page(payload) {
  const content = payload.layoutMode === "week-board" ? weekBoard(payload) : payload.variant === "schedule" ? dayTimeline(payload) : sections(payload);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}html,body{margin:0;background:#f1f2ef;color:#18201d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{padding:18px}.phone{width:394px;min-height:760px;margin:0 auto;background:#fbfaf7;border:1px solid #e7eae7;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(24,32,29,.10)}.topbar{height:46px;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #eceeea;font-size:13px;color:#66706b}.topbar i{width:8px;height:8px;border-radius:50%;background:#2f6b59;margin-right:9px}.hero{padding:24px 22px 20px;border-bottom:1px solid #e7eae7;background:#fff}.eyebrow{font-size:12px;letter-spacing:.08em;color:#66706b;text-transform:uppercase;margin-bottom:8px}.hero h1{font-size:23px;line-height:1.25;letter-spacing:-.02em;margin:0 0 10px}.hero p{font-size:16px;line-height:1.55;margin:0;color:#34403b}.hero .context{display:block;margin-top:10px;font-size:12px;color:#77817d}.risk .hero{border-top:4px solid #b97828}.error .hero{border-top:4px solid #b94a48}.space .hero,.collaboration .hero{border-top:4px solid #2f6b59}.ranking .hero{border-top:4px solid #3f6fe5}.overview .hero{border-top:4px solid #18201d}.content{padding:4px 22px 6px}section{padding:17px 0;border-bottom:1px solid #e7eae7}section:last-child{border-bottom:0}h2{font-size:13px;line-height:1.3;margin:0 0 10px;color:#66706b;font-weight:650}.note{font-size:12px;color:#66706b;margin:-4px 0 10px}.row{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;padding:10px 0}.row+.row{border-top:1px solid #eff0ed}.rowcopy{min-width:0;display:flex;flex-direction:column;gap:4px}.row b{font-size:15px;line-height:1.3}.row span{font-size:14px;line-height:1.4;color:#34403b}.row small,.lesson small{font-size:11px;line-height:1.45;color:#7b8580}.row em{white-space:nowrap;font-style:normal;font-size:11px;color:#2f6b59;background:#edf4f1;padding:4px 7px;border-radius:6px}.risk .row em{color:#9a601c;background:#faf0df}.error .row em{color:#9c3e3d;background:#f9e9e8}.metric-grid .rows{display:grid;grid-template-columns:1fr 1fr;gap:8px}.metric-grid .row{display:block;background:#f5f5f2;padding:12px;border-radius:8px}.metric-grid .row+.row{border:0}.metric-grid em{display:none}.weekboard{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 18px 8px}.day{border:1px solid #e7eae7;border-radius:10px;padding:12px;background:#fff}.day h2{font-size:14px;color:#18201d;margin-bottom:9px}.lesson{position:relative;border-left:3px solid #2f6b59;padding:8px 7px 8px 10px;margin-top:8px;background:#f7f8f5;display:flex;flex-direction:column;gap:3px}.lesson .time{font-size:11px;color:#2f6b59;font-weight:650}.lesson b{font-size:14px;line-height:1.3}.lesson>span:not(.time){font-size:12px;color:#4d5853}.timeline{padding-top:18px}.timeline-row{display:grid;grid-template-columns:82px 1fr;gap:10px;align-items:start;margin:10px 0}.clock{font-size:12px;color:#2f6b59;font-weight:650;padding-top:9px}.timeline-copy{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border-left:3px solid #2f6b59;background:#f7f8f5}.timeline-copy b{font-size:15px;line-height:1.35}.timeline-copy small{font-size:11px;color:#66706b;line-height:1.45}footer{padding:15px 22px 20px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #e7eae7;background:#fff}button{appearance:none;border:1px solid #dce1dd;border-radius:8px;padding:9px 12px;font:600 13px inherit;background:#fff;color:#2f6b59}button.primary{background:#2f6b59;color:white;border-color:#2f6b59}.empty .hero,.message .hero{min-height:160px;display:flex;flex-direction:column;justify-content:center}@media(max-width:430px){body{padding:0}.phone{width:100%;border:0;border-radius:0;box-shadow:none}.weekboard{gap:8px;padding:14px}.hero{padding-left:20px;padding-right:20px}.content,footer{padding-left:20px;padding-right:20px}}
  </style></head><body><main class="phone ${esc(payload.variant)}"><div class="topbar"><i></i>校园智序 · 小序</div><header class="hero"><div class="eyebrow">${esc(payload.variant === "risk" ? "教学风险" : payload.variant === "schedule" ? "时间安排" : payload.variant === "space" ? "空间推荐" : payload.variant === "ranking" ? "校园洞察" : "校园任务")}</div><h1>${esc(payload.title)}</h1><p>${esc(payload.summary)}</p>${payload.context ? `<span class="context">${esc(payload.context)}</span>` : ""}</header><div class="content">${content}</div>${actions(payload.actions)}</main></body></html>`;
}

fs.mkdirSync(OUTPUT, { recursive: true });
for (const name of fs.readdirSync(INPUT).filter((name) => name.endsWith(".json"))) {
  const payload = JSON.parse(fs.readFileSync(path.join(INPUT, name), "utf8"));
  fs.writeFileSync(path.join(OUTPUT, name.replace(/\.json$/, ".html")), page(payload), "utf8");
}
process.stdout.write("Final Widget visual evidence HTML generated: 10\n");
