import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = process.env.WORKSPACE_NODE_MODULES || path.resolve(here, "..", "..", "..", "node_modules");
const workspaceRequire = createRequire(path.join(moduleRoot, "package.json"));
const pptxgen = workspaceRequire("pptxgenjs");
const { imageSize } = workspaceRequire("image-size");
const outDir = path.resolve(here, "..");
const repo = path.resolve(here, "..", "..", "..");
const qa = path.join(outDir, "qa", "final-cut");
const brand = path.join(repo, "competition", "demo-portal", "public", "branding");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "校园智序·小序";
pptx.company = "校园智序·小序";
pptx.subject = "比赛答辩 · Evidence-first Final Cut";
pptx.title = "校园智序·小序—答辩";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "Microsoft YaHei",
  bodyFontFace: "Microsoft YaHei",
  lang: "zh-CN",
};
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.defineSlideMaster({
  title: "MASTER",
  background: { color: "FBF8F4" },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.05, fill: { color: "EF5A4C" }, line: { color: "EF5A4C" } } },
    { text: { text: "校园智序·小序", options: { x: 0.52, y: 7.16, w: 2.6, h: 0.16, fontFace: "Microsoft YaHei", fontSize: 8, color: "9C8B84", margin: 0 } } },
  ],
  slideNumber: { x: 12.45, y: 7.12, w: 0.34, h: 0.18, fontFace: "Aptos", fontSize: 8, color: "9C8B84", align: "right", margin: 0 },
});

const C = {
  bg: "FBF8F4",
  paper: "FFFDFC",
  ink: "2B201D",
  mute: "7F6F69",
  coral: "EF5A4C",
  red: "C8342D",
  rose: "F8DDD7",
  peach: "FBE9DA",
  lavender: "EEE7F5",
  green: "237E68",
  warning: "B7652D",
  line: "EADDD7",
};

const SHADOW = { type: "outer", color: "6E4438", opacity: 0.13, blur: 3, angle: 45, distance: 1.5 };
const noLine = { color: C.paper, transparency: 100 };

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || "Microsoft YaHei",
    fontSize: opts.fontSize || 20,
    bold: opts.bold ?? false,
    color: opts.color || C.ink,
    margin: opts.margin ?? 0,
    valign: opts.valign || "mid",
    align: opts.align || "left",
    breakLine: false,
    fit: "shrink",
    ...opts,
  });
}

function rounded(slide, x, y, w, h, fill = C.paper, transparency = 8, radius = 0.18, shadow = true) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: radius,
    fill: { color: fill, transparency },
    line: noLine,
    // PptxGenJS normalizes shadow dimensions in place; clone per shape to avoid
    // repeated EMU multiplication when the same visual token is reused.
    shadow: shadow ? { ...SHADOW } : undefined,
  });
}

function softField(slide, x, y, w, h, color, transparency = 24) {
  slide.addShape(pptx.ShapeType.arc, {
    x, y, w, h,
    adjustPoint: 0.34,
    rotate: x < 5 ? 9 : 180,
    fill: { color, transparency },
    line: noLine,
  });
}

function imgCrop(file, x, y, w, h) {
  const dim = imageSize(file);
  const iw = dim.width || 1;
  const ih = dim.height || 1;
  const imageRatio = iw / ih;
  const boxRatio = w / h;
  if (imageRatio > boxRatio) {
    const sw = ih * boxRatio;
    return { path: file, x, y, w, h, sizing: "crop", crop: { x: (iw - sw) / 2, y: 0, w: sw, h: ih } };
  }
  const sh = iw / boxRatio;
  return { path: file, x, y, w, h, sizing: "crop", crop: { x: 0, y: (ih - sh) / 2, w: iw, h: sh } };
}

function imgContain(file, x, y, w, h) {
  const dim = imageSize(file);
  const iw = dim.width || 1;
  const ih = dim.height || 1;
  const scale = Math.min(w / iw, h / ih);
  const rw = iw * scale;
  const rh = ih * scale;
  return { path: file, x: x + (w - rw) / 2, y: y + (h - rh) / 2, w: rw, h: rh };
}

function addScreen(slide, file, x, y, w, h, crop = true) {
  rounded(slide, x - 0.08, y - 0.08, w + 0.16, h + 0.16, "FFFFFF", 0, 0.22, true);
  slide.addImage(crop ? imgCrop(file, x, y, w, h) : imgContain(file, x, y, w, h));
}

function header(slide, kicker, title, subtitle, page) {
  addText(slide, kicker, 0.56, 0.3, 5.8, 0.25, { fontSize: 10.5, bold: true, color: C.coral, charSpacing: 0.4 });
  addText(slide, title, 0.56, 0.66, 11.95, 0.66, { fontSize: 27, bold: true, color: C.ink, breakLine: false });
  if (subtitle) addText(slide, subtitle, 0.58, 1.34, 11.7, 0.36, { fontSize: 12.5, color: C.mute });
  addText(slide, String(page).padStart(2, "0"), 12.28, 0.28, 0.46, 0.22, { fontFace: "Aptos", fontSize: 9, bold: true, color: C.mute, align: "right" });
}

function tag(slide, text, x, y, w, fill = C.paper, color = C.ink) {
  rounded(slide, x, y, w, 0.36, fill, 0, 0.17, false);
  addText(slide, text, x + 0.12, y + 0.02, w - 0.24, 0.31, { fontSize: 9.5, bold: true, color, align: "center" });
}

function pillStep(slide, y, label, title, body, accent = C.coral) {
  rounded(slide, 9.48, y, 3.25, 0.82, "FFFFFF", 4, 0.18, true);
  tag(slide, label, 9.67, y + 0.2, 0.62, accent, "FFFFFF");
  addText(slide, title, 10.47, y + 0.1, 2.05, 0.28, { fontSize: 12.5, bold: true });
  addText(slide, body, 10.47, y + 0.41, 2.05, 0.28, { fontSize: 9.4, color: C.mute });
}

// 01 — cover / proof
{
  const s = pptx.addSlide("MASTER");
  softField(s, -0.35, 0.5, 5.0, 3.8, C.rose, 24);
  softField(s, 9.2, -0.2, 4.7, 3.9, C.lavender, 27);
  const logo = path.join(brand, "platform-logo.png");
  s.addImage(imgContain(logo, 0.72, 0.78, 1.35, 1.35));
  addText(s, "校园智序·小序", 0.72, 2.05, 7.2, 0.82, { fontSize: 35, bold: true });
  addText(s, "让复杂的校园教学安排，\n简单到一句话就能问。", 0.76, 2.95, 8.2, 1.18, { fontSize: 24, bold: true, color: C.red, breakLine: true });
  addText(s, "真实问题 → Multi-Agent 分工 → CampusTools 核验 → 可核查 Widget", 0.78, 4.25, 9.0, 0.34, { fontSize: 12.2, color: C.mute });
  const proofs = [
    { x: 0.75, n: "1500+", t: "累计真实用户" },
    { x: 4.35, n: "4×13", t: "Agent × CampusTools" },
    { x: 7.95, n: "Verified", t: "关键结果可核验" },
  ];
  proofs.forEach((p, i) => {
    rounded(s, p.x, 5.15, 3.1, 1.2, i === 2 ? "F2EEE9" : "FFFFFF", i === 2 ? 0 : 5, 0.22, true);
    addText(s, p.n, p.x + 0.2, 5.31, 2.7, 0.48, { fontFace: i === 2 ? "Aptos Display" : "Microsoft YaHei", fontSize: 24, bold: true, color: i === 2 ? C.green : C.red });
    addText(s, p.t, p.x + 0.2, 5.86, 2.7, 0.26, { fontSize: 10.5, color: C.mute });
  });
  addText(s, "FINAL CUT · 比赛答辩", 10.98, 6.2, 1.65, 0.25, { fontFace: "Aptos", fontSize: 9, bold: true, color: C.mute, align: "right" });
}

// 02 — 0 ≠ 4
{
  const s = pptx.addSlide("MASTER");
  header(s, "一个真实问题", "课表没有冲突，不代表教学安排没有风险", "同一位教师 · 未来四周 · 冲突为 0，但每周有 4 次跨校区赶场", 2);
  addScreen(s, path.join(qa, "4173-risk-1920x1080.png"), 4.15, 1.88, 8.55, 4.72, true);
  addText(s, "0", 0.72, 2.18, 1.25, 1.25, { fontFace: "Aptos Display", fontSize: 64, bold: true, color: C.green, align: "center" });
  addText(s, "≠", 1.86, 2.24, 0.85, 1.1, { fontSize: 48, bold: true, color: C.mute, align: "center" });
  addText(s, "4", 2.7, 2.18, 1.05, 1.25, { fontFace: "Aptos Display", fontSize: 64, bold: true, color: C.warning, align: "center" });
  addText(s, "课程冲突", 0.78, 3.5, 1.2, 0.32, { fontSize: 12, bold: true, align: "center" });
  addText(s, "跨校区赶场 / 周", 2.25, 3.5, 1.65, 0.5, { fontSize: 12, bold: true, align: "center" });
  rounded(s, 0.72, 4.45, 3.1, 1.25, C.peach, 4, 0.19, false);
  addText(s, "一条真实转场", 0.92, 4.62, 2.7, 0.27, { fontSize: 10, bold: true, color: C.coral });
  addText(s, "10:00 → 10:20", 0.92, 4.94, 2.7, 0.38, { fontFace: "Aptos Display", fontSize: 22, bold: true, color: C.ink });
  addText(s, "校区 A → 校区 B · 仅 20 min", 0.92, 5.36, 2.7, 0.27, { fontSize: 9.8, color: C.warning });
}

// 03 — real adoption
{
  const s = pptx.addSlide("MASTER");
  header(s, "真实落地", "已在真实校园教学服务场景投入使用，累计真实用户 1500+", "真实使用反馈，推动作品从“查询工具”演进为可理解、可核验的教学任务智能体", 3);
  addText(s, "1500+", 0.72, 1.95, 4.0, 1.25, { fontFace: "Aptos Display", fontSize: 64, bold: true, color: C.red });
  addText(s, "真实用户验证", 0.82, 3.18, 3.4, 0.52, { fontSize: 22, bold: true });
  addText(s, "匿名呈现，不展示学校、学院、姓名、学号、邮箱或真实域名。", 0.82, 3.9, 3.25, 1.05, { fontSize: 13.2, color: C.mute, breakLine: true, valign: "top" });
  addScreen(s, path.join(qa, "4174-native-adp-widget-1440x900.png"), 4.55, 1.95, 8.15, 4.66, true);
  tag(s, "真实运行界面", 4.82, 6.05, 1.45, C.paper, C.red);
  tag(s, "已匿名", 6.4, 6.05, 1.04, C.green, "FFFFFF");
}

// 04 — real conversation execution chain
{
  const s = pptx.addSlide("MASTER");
  header(s, "一句话如何变成可核查结果", "一条真实对话，完成两次领域协作与确定性核验", "用户问“未来四周谁最忙，并检查他的赶场风险？”", 4);
  addScreen(s, path.join(qa, "4174-native-adp-widget-1440x900.png"), 8.78, 1.9, 3.92, 4.8, true);
  const nodes = [
    { x: 0.65, y: 2.05, w: 1.18, label: "用户问题", sub: "自然语言" },
    { x: 2.05, y: 2.05, w: 1.25, label: "小序·Main", sub: "理解与协调" },
    { x: 3.55, y: 1.38, w: 1.12, label: "Insight", sub: "负载排名" },
    { x: 4.9, y: 2.05, w: 1.12, label: "Main", sub: "继续分工" },
    { x: 6.25, y: 2.72, w: 1.12, label: "Risk", sub: "赶场核验" },
    { x: 7.58, y: 2.05, w: 1.02, label: "Tools", sub: "确定性事实" },
  ];
  const centers = [];
  nodes.forEach((n, i) => {
    const fill = i === 1 || i === 3 ? C.red : i === 2 ? "E9DFF4" : i === 4 ? C.peach : i === 5 ? "E5F0EC" : "FFFFFF";
    const color = i === 1 || i === 3 ? "FFFFFF" : C.ink;
    rounded(s, n.x, n.y, n.w, 1.08, fill, 0, 0.2, true);
    addText(s, n.label, n.x + 0.08, n.y + 0.23, n.w - 0.16, 0.3, { fontFace: /Insight|Risk|Tools/.test(n.label) ? "Aptos Display" : "Microsoft YaHei", fontSize: 12.3, bold: true, color, align: "center" });
    addText(s, n.sub, n.x + 0.08, n.y + 0.63, n.w - 0.16, 0.22, { fontSize: 8.7, color: i === 1 || i === 3 ? "FFEDE9" : C.mute, align: "center" });
    centers.push({ x: n.x + n.w / 2, y: n.y + 0.54 });
  });
  for (let i = 0; i < centers.length - 1; i += 1) {
    s.addShape(pptx.ShapeType.line, { x: centers[i].x + 0.55, y: centers[i].y, w: Math.max(0.25, centers[i + 1].x - centers[i].x - 1.05), h: centers[i + 1].y - centers[i].y, line: { color: C.coral, width: 1.8, beginArrowType: "none", endArrowType: "triangle" } });
  }
  s.addShape(pptx.ShapeType.line, { x: 8.58, y: 2.58, w: 0.22, h: 0, line: { color: C.green, width: 2.2, endArrowType: "triangle" } });
  tag(s, "Widget", 8.87, 5.96, 0.92, C.green, "FFFFFF");
  addText(s, "Main → Child → Main", 1.95, 4.38, 3.95, 0.42, { fontFace: "Aptos Display", fontSize: 22, bold: true, color: C.red });
  addText(s, "生成模型负责理解任务；CampusTools 负责动态校园事实。", 1.95, 4.95, 5.5, 0.4, { fontSize: 13.2, color: C.mute });
  tag(s, "REAL SSE", 1.95, 5.6, 1.05, C.red, "FFFFFF");
  tag(s, "2 个真实 AgentName", 3.15, 5.6, 1.85, C.paper, C.ink);
  tag(s, "2 次真实工具调用", 5.15, 5.6, 1.75, C.paper, C.ink);
}

// 05 — architecture with logos
{
  const s = pptx.addSlide("MASTER");
  header(s, "系统架构", "4 Agent × 13 CampusTools：主协调只编排，不直接调用动态事实", "14 bindings 保证领域 Agent 可以调用所需工具；协作路径始终回到 Main 统一投影结果", 5);
  const main = path.join(brand, "coordinator-agent.png");
  const agents = [
    { file: path.join(brand, "course-space-agent.png"), x: 4.1, y: 1.82, name: "Schedule", sub: "课表 / 教室 / 调课" },
    { file: path.join(brand, "risk-agent.png"), x: 4.1, y: 4.82, name: "Risk", sub: "冲突 / 赶场 / 约束" },
    { file: path.join(brand, "campus-insight-agent.png"), x: 7.25, y: 4.82, name: "Insight", sub: "负载 / 排名 / 下钻" },
  ];
  rounded(s, 0.72, 2.55, 2.35, 2.35, C.red, 0, 0.3, true);
  s.addImage(imgContain(main, 1.03, 2.78, 1.08, 1.08));
  addText(s, "小序·主协调", 0.92, 3.92, 1.95, 0.34, { fontSize: 15, bold: true, color: "FFFFFF", align: "center" });
  addText(s, "理解 · 分工 · 汇总", 0.92, 4.34, 1.95, 0.25, { fontSize: 9.2, color: "FFE9E5", align: "center" });
  agents.forEach((a) => {
    rounded(s, a.x, a.y, 2.2, 1.58, "FFFFFF", 2, 0.23, true);
    s.addImage(imgContain(a.file, a.x + 0.14, a.y + 0.25, 0.92, 0.92));
    addText(s, a.name, a.x + 1.03, a.y + 0.36, 1.0, 0.32, { fontFace: "Aptos Display", fontSize: 15, bold: true });
    addText(s, a.sub, a.x + 1.03, a.y + 0.76, 1.0, 0.42, { fontSize: 8.8, color: C.mute, breakLine: true });
    s.addShape(pptx.ShapeType.line, { x: 3.08, y: 3.72, w: a.x - 3.08, h: a.y + 0.79 - 3.72, line: { color: C.coral, width: 1.7, endArrowType: "triangle" } });
  });
  rounded(s, 10.2, 2.58, 2.35, 2.7, "FFFFFF", 1, 0.28, true);
  s.addImage(imgContain(path.join(brand, "camptools-plugin.png"), 10.75, 2.86, 1.2, 1.2));
  addText(s, "13 CampusTools", 10.45, 4.05, 1.85, 0.35, { fontFace: "Aptos Display", fontSize: 16, bold: true, color: C.red, align: "center" });
  addText(s, "动态事实 · 确定性计算", 10.45, 4.48, 1.85, 0.27, { fontSize: 9.2, color: C.mute, align: "center" });
  [agents[0], agents[1], agents[2]].forEach(a => s.addShape(pptx.ShapeType.line, { x: a.x + 2.2, y: a.y + 0.79, w: 10.2 - a.x - 2.2, h: 3.93 - a.y - 0.79, line: { color: C.green, width: 1.6, endArrowType: "triangle" } }));
  tag(s, "Main 不直连 Tools", 0.83, 5.38, 2.15, C.paper, C.red);
  addText(s, "14 bindings", 10.56, 5.68, 1.65, 0.31, { fontFace: "Aptos Display", fontSize: 14, bold: true, color: C.mute, align: "center" });
}

function heroSlide({ page, kicker, title, subtitle, screenshot, q, how, result, resultColor = C.red }) {
  const s = pptx.addSlide("MASTER");
  header(s, kicker, title, subtitle, page);
  addScreen(s, screenshot, 0.64, 1.9, 8.42, 4.76, true);
  pillStep(s, 2.02, "问一句", q, "自然语言任务", C.red);
  pillStep(s, 3.06, "怎么做", how, "Agent 分工 + 工具核验", C.coral);
  pillStep(s, 4.1, "得到什么", result, "Verified 结果卡", resultColor);
  return s;
}

// 06 — risk
heroSlide({
  page: 6,
  kicker: "Hero 1 · 教学风险发现",
  title: "没有冲突，不等于没有风险",
  subtitle: "教师025 · 第1–4周 · 系统核验课程冲突与跨校区赶场",
  screenshot: path.join(qa, "4173-risk-1920x1080.png"),
  q: "教师025未来四周有没有风险？",
  how: "Risk → CampusTools",
  result: "0 冲突 / 4 赶场 / 20 min",
  resultColor: C.green,
});

// 07 — collaboration
heroSlide({
  page: 7,
  kicker: "Hero 2 · 多人协同规划",
  title: "三张课表，算出一个共同教学时空",
  subtitle: "教师005、006、014 · 第1周周四上午 · 同时满足 120 座教室约束",
  screenshot: path.join(qa, "4173-collaboration-1920x1080.png"),
  q: "三位老师什么时候都有空？有没有120座教室？",
  how: "Schedule → 共同空闲 → 容量过滤",
  result: "63 → 7 → A1-201",
  resultColor: C.red,
});

// 08 — reschedule
heroSlide({
  page: 8,
  kicker: "Hero 3 · What-if 模拟调课",
  title: "可行，不等于没有提醒",
  subtitle: "周一5–6节 → 周四7–8节 · 逐项核验约束，模拟不写入真实课表",
  screenshot: path.join(qa, "4173-reschedule-1920x1080.png"),
  q: "移动到周四7–8节，可行吗？",
  how: "5 PASS + 1 WARNING",
  result: "feasible=true · mutatedData=false",
  resultColor: C.warning,
});

// 09 — insight
heroSlide({
  page: 9,
  kicker: "Hero 4 · 全局教学洞察",
  title: "排名负责发现，核验负责判断",
  subtitle: "先定位未来四周负载 Top1，再下钻同一对象的跨校区赶场风险",
  screenshot: path.join(qa, "4173-insight-1920x1080.png"),
  q: "未来四周谁最忙？",
  how: "Insight → Main → Risk → Tools",
  result: "Top1 教师025 · 56 / 112 · 0 / 4",
  resultColor: C.green,
});

// 10 — real widget proof
{
  const s = pptx.addSlide("MASTER");
  header(s, "为什么结果可信", "这不是示意图：官方 Widget SDK 正在渲染真实 ADP 返回", "真实 SSE 对话 · 真实 AgentName · 真实 CampusTools 调用 · 真实 Widget.View", 10);
  addScreen(s, path.join(qa, "4174-native-adp-widget-1440x900.png"), 0.64, 1.88, 9.7, 4.86, true);
  const notes = [
    { y: 2.0, label: "Verified", body: "关键结论已核验", color: C.green },
    { y: 3.0, label: "dataVersion", body: "competition-demo-v3", color: C.red },
    { y: 4.0, label: "CampusTools", body: "确定性事实层", color: C.coral },
    { y: 5.0, label: "Evidence", body: "调用与结果可复核", color: C.warning },
  ];
  notes.forEach((n) => {
    rounded(s, 10.65, n.y, 2.05, 0.78, "FFFFFF", 0, 0.18, true);
    addText(s, n.label, 10.87, n.y + 0.13, 1.6, 0.24, { fontFace: "Aptos Display", fontSize: 12.5, bold: true, color: n.color });
    addText(s, n.body, 10.87, n.y + 0.42, 1.6, 0.22, { fontSize: 8.8, color: C.mute });
    s.addShape(pptx.ShapeType.line, { x: 10.34, y: n.y + 0.39, w: 0.3, h: 0, line: { color: n.color, width: 1.5, beginArrowType: "oval" } });
  });
  tag(s, "官方 <adp-widget>", 10.8, 6.1, 1.72, C.green, "FFFFFF");
}

// 11 — evidence pillars
{
  const s = pptx.addSlide("MASTER");
  header(s, "创新、落地、推广价值", "三条可验证证据，支撑一套可复制的校园任务操作系统", "从真实落地、真实协作到真实核验，作品价值不依赖概念口号", 11);
  const cols = [
    { x: 0.8, n: "1500+", title: "真落地", body: "真实校园教学服务\n累计真实用户", color: C.red },
    { x: 4.55, n: "4×13", title: "真协作", body: "4 Agent\n13 CampusTools", color: C.coral },
    { x: 8.3, n: "Verified", title: "真结果", body: "确定性计算\nEvidence / fail-closed", color: C.green },
  ];
  cols.forEach((c, i) => {
    s.addShape(pptx.ShapeType.line, { x: c.x, y: 2.03, w: 3.2, h: 0, line: { color: c.color, width: 4.5, beginArrowType: "none", endArrowType: "none" } });
    addText(s, c.n, c.x, 2.42, 3.2, 1.0, { fontFace: i === 2 ? "Aptos Display" : "Microsoft YaHei", fontSize: i === 2 ? 36 : 48, bold: true, color: c.color });
    addText(s, c.title, c.x, 3.63, 3.2, 0.52, { fontSize: 22, bold: true });
    addText(s, c.body, c.x, 4.33, 3.2, 0.92, { fontSize: 14, color: C.mute, breakLine: true, valign: "top" });
  });
  rounded(s, 0.8, 5.8, 10.7, 0.56, C.paper, 0, 0.2, false);
  addText(s, "真场景 25% · 创新实用 25% · 技术完整 20% · 数据算法 15% · 体验展示 15%", 1.02, 5.94, 10.25, 0.24, { fontSize: 9.8, color: C.mute, align: "center" });
  addText(s, "可扩展：排课辅助 · 资源调度 · 教学运行治理 · 跨部门协同", 1.2, 6.52, 10.0, 0.35, { fontSize: 14, bold: true, color: C.red, align: "center" });
}

// 12 — closing
{
  const s = pptx.addSlide("MASTER");
  softField(s, -0.25, 0.35, 5.6, 4.7, C.rose, 26);
  softField(s, 8.8, 0.2, 4.8, 4.8, C.lavender, 30);
  s.addImage(imgContain(path.join(brand, "platform-logo.png"), 0.82, 0.8, 1.55, 1.55));
  addText(s, "校园智序·小序", 0.82, 2.38, 7.4, 0.9, { fontSize: 38, bold: true });
  addText(s, "让教学时空，被理解、被核验、被安排。", 0.86, 3.4, 7.4, 0.62, { fontSize: 24, bold: true, color: C.red });
  addText(s, "让复杂的校园教学安排，简单到一句话就能问。", 0.87, 4.33, 7.5, 0.42, { fontSize: 14.5, color: C.mute });
  rounded(s, 9.52, 1.2, 2.45, 2.45, "FFFFFF", 0, 0.28, true);
  addText(s, "在线体验\n二维码", 9.86, 1.78, 1.76, 0.88, { fontSize: 22, bold: true, color: C.red, align: "center", breakLine: true });
  addText(s, "提交时加入", 9.86, 2.9, 1.76, 0.32, { fontSize: 10.5, color: C.mute, align: "center" });
  rounded(s, 8.68, 4.45, 4.16, 0.82, C.paper, 0, 0.2, true);
  addText(s, "最终在线体验地址 · 由提交人加入", 9.0, 4.7, 3.55, 0.32, { fontSize: 12, bold: true, color: C.red, align: "center" });
  tag(s, "REAL ADP", 0.88, 5.55, 1.08, C.red, "FFFFFF");
  tag(s, "REAL WIDGET", 2.12, 5.55, 1.42, C.green, "FFFFFF");
  tag(s, "VERIFIED", 3.7, 5.55, 1.18, C.paper, C.green);
}

await pptx.writeFile({ fileName: path.join(outDir, "校园智序-小序-答辩.pptx") });
