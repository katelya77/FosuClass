import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = process.env.WORKSPACE_NODE_MODULES;
if (!moduleRoot) throw new Error("WORKSPACE_NODE_MODULES is required");
const require = createRequire(path.join(moduleRoot, "package.json"));
const pptxgen = require("pptxgenjs");
const { imageSize } = require("image-size");

const root = path.resolve(here, "..");
const repo = path.resolve(root, "..", "..");
const assets = path.join(root, "assets");
const qa = path.join(root, "qa", "final-cut");
const finalShots = path.join(root, "qa", "live-final", "screenshots");
const brand = path.join(repo, "competition", "demo-portal", "public", "branding");
const output = path.join(root, "校园智序-小序-答辩.pptx");

const pptx = new pptxgen();
pptx.defineLayout({ name: "XIAOXU_FINAL", width: 13.333, height: 7.5 });
pptx.layout = "XIAOXU_FINAL";
pptx.author = "校园智序·小序";
pptx.company = "校园智序·小序";
pptx.subject = "校园教学任务智能体比赛答辩";
pptx.title = "校园智序·小序—答辩";
pptx.lang = "zh-CN";
pptx.theme = { headFontFace: "Noto Serif SC", bodyFontFace: "MiSans", lang: "zh-CN" };

const S = pptx.ShapeType;
const F = { title: "Noto Serif SC", body: "MiSans", number: "MiSans" };
const C = {
  paper: "FBF7F1", white: "FFFFFF", ink: "211E1C", body: "544B46", mute: "887C75", line: "DDD2CA",
  coral: "E65442", coralDark: "B83E32", coralSoft: "F6DED8", peach: "F6E8D8", lavender: "ECE5EF",
  green: "237F69", greenSoft: "DDECE6", amber: "B96B2E", amberSoft: "F4E4CF", blue: "507BA0", blueSoft: "DFE8F0",
};
const noLine = { color: C.white, transparency: 100 };
let objectSerial = 0;

function objectName(group, role = "item") {
  objectSerial += 1;
  return `${group || "S00"}_${String(objectSerial).padStart(4, "0")}_${role}`;
}

function addText(slide, value, x, y, w, h, opts = {}, group = null) {
  slide.addText(value, {
    x, y, w, h, fontFace: opts.fontFace || F.body, fontSize: opts.fontSize || 18,
    bold: opts.bold || false, color: opts.color || C.ink, margin: opts.margin ?? 0,
    valign: opts.valign || "mid", align: opts.align || "left", breakLine: opts.breakLine || false,
    fit: opts.fit || "shrink", paraSpaceAfterPt: 0, objectName: objectName(group, "text"), ...opts,
  });
}

function addShape(slide, type, opts, group = null, role = "shape") {
  slide.addShape(type, { ...opts, objectName: objectName(group, role) });
}

function addImage(slide, image, group = null, role = "image") {
  slide.addImage({ ...image, objectName: objectName(group, role) });
}

function hairline(slide, x, y, w, color = C.line, width = 1, group = null) {
  addShape(slide, S.line, { x, y, w, h: 0, line: { color, width } }, group, "line");
}

function arrow(slide, x, y, w, h = 0, color = C.coral, width = 1.7, group = null) {
  let flipH = false; let flipV = false;
  if (w < 0) { x += w; w = Math.abs(w); flipH = true; }
  if (h < 0) { y += h; h = Math.abs(h); flipV = true; }
  addShape(slide, S.line, { x, y, w, h, flipH, flipV, line: { color, width, beginArrowType: "none", endArrowType: "triangle" } }, group, "arrow");
}

function doubleArrow(slide, x, y, w, h, color = C.coral, group = null) {
  let flipH = false; let flipV = false;
  if (w < 0) { x += w; w = Math.abs(w); flipH = true; }
  if (h < 0) { y += h; h = Math.abs(h); flipV = true; }
  addShape(slide, S.line, { x, y, w, h, flipH, flipV, line: { color, width: 1.45, beginArrowType: "triangle", endArrowType: "triangle" } }, group, "double-arrow");
}

function addBackground(slide, page, dark = false) {
  slide.background = { color: dark ? C.ink : C.paper };
  if (!dark) {
    addShape(slide, S.ellipse, {
      x: page % 2 ? 9.45 : -1.75, y: page % 2 ? -1.7 : 4.85, w: 5.8, h: 4.1,
      fill: { color: page % 3 ? C.coralSoft : C.peach, transparency: 62 }, line: noLine,
    }, null, "background-field");
    addShape(slide, S.arc, {
      x: page % 2 ? -0.7 : 10.2, y: page % 2 ? 4.8 : -0.6, w: 3.6, h: 2.5,
      adjustPoint: 0.26, rotate: page % 2 ? 18 : 198, fill: { color: C.white, transparency: 100 },
      line: { color: C.coral, transparency: 70, width: 1.1 },
    }, null, "background-arc");
  } else {
    addShape(slide, S.ellipse, { x: 8.0, y: -1.1, w: 6.8, h: 6.8, fill: { color: C.coral, transparency: 42 }, line: noLine }, null, "background-field");
    addShape(slide, S.ellipse, { x: 9.0, y: 0, w: 4.9, h: 4.9, fill: { color: C.amber, transparency: 72 }, line: noLine }, null, "background-field");
  }
}

function footer(slide, page, dark = false) {
  const color = dark ? "D8CDC7" : C.mute;
  addText(slide, "校园智序·小序", 0.56, 7.12, 2.1, 0.18, { fontSize: 8.5, color }, null);
  addText(slide, `${String(page).padStart(2, "0")} / 12`, 11.92, 7.12, 0.84, 0.18, { fontSize: 8.5, color, align: "right" }, null);
}

function header(slide, page, section, title, subtitle = "") {
  addBackground(slide, page);
  addText(slide, section, 0.58, 0.28, 4.1, 0.24, { fontSize: 10, bold: true, color: C.coral, charSpacing: 0.7 }, null);
  addText(slide, title, 0.56, 0.68, 12.1, 0.62, { fontFace: F.title, fontSize: 27, bold: true, color: C.ink }, null);
  if (subtitle) addText(slide, subtitle, 0.58, 1.32, 11.9, 0.33, { fontSize: 12.2, color: C.body }, null);
  footer(slide, page);
}

function imageCrop(file, x, y, w, h) {
  const dim = imageSize(require("node:fs").readFileSync(file)); const ir = dim.width / dim.height; const br = w / h;
  if (ir > br) {
    const sw = dim.height * br;
    return { path: file, x, y, w, h, sizing: "crop", crop: { x: (dim.width - sw) / 2, y: 0, w: sw, h: dim.height } };
  }
  const sh = dim.width / br;
  return { path: file, x, y, w, h, sizing: "crop", crop: { x: 0, y: (dim.height - sh) / 2, w: dim.width, h: sh } };
}

function imageContain(file, x, y, w, h) {
  const dim = imageSize(require("node:fs").readFileSync(file)); const scale = Math.min(w / dim.width, h / dim.height);
  const iw = dim.width * scale; const ih = dim.height * scale;
  return { path: file, x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
}

function screen(slide, file, x, y, w, h, group, crop = true) {
  addShape(slide, S.rect, { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, fill: { color: C.white }, line: { color: C.line, width: 0.9 } }, group, "screen-base");
  addImage(slide, crop ? imageCrop(file, x, y, w, h) : imageContain(file, x, y, w, h), group, "screen-image");
}

function label(slide, value, x, y, w, color, group) {
  addShape(slide, S.rect, { x, y, w, h: 0.31, fill: { color }, line: noLine }, group, "label-bg");
  addText(slide, value, x + 0.08, y + 0.02, w - 0.16, 0.26, { fontSize: 9.2, bold: true, color: C.white, align: "center" }, group);
}

// 01｜封面：先说清楚这是什么，再谈技术。
{
  const s = pptx.addSlide();
  addBackground(s, 1, true);
  addImage(s, imageContain(path.join(brand, "platform-logo.png"), 0.72, 0.64, 1.0, 1.0), null, "logo");
  addText(s, "序", 9.18, 0.35, 3.7, 5.8, { fontFace: F.title, fontSize: 220, bold: true, color: "FFFFFF", transparency: 88, align: "center" }, null);
  addText(s, "校园智序·小序", 0.78, 1.88, 7.8, 0.78, { fontFace: F.title, fontSize: 39, bold: true, color: C.white }, "A01");
  addText(s, "面向学生、教师与教学管理者的\n校园教学时空资源智能体", 0.78, 2.92, 7.9, 1.28, { fontFace: F.title, fontSize: 25, bold: true, color: "FFD9CF", breakLine: true, valign: "top" }, "A02");
  hairline(s, 0.8, 4.66, 4.8, "E89989", 1.3, "A03");
  addText(s, "一句自然语言，统一完成课表查询、空间查找、多人协同、调课核验与教学运行分析。", 0.8, 4.84, 7.4, 0.42, { fontSize: 13.5, color: "F2E8E3" }, "A03");
  addText(s, "让教学时空，被理解、被安排。", 0.8, 5.56, 6.2, 0.5, { fontFace: F.title, fontSize: 19, bold: true, color: C.white }, "A04");
  footer(s, 1, true);
}

// 02｜它从哪里来：真实课表服务 → 真实需求扩展。
{
  const s = pptx.addSlide();
  header(s, 2, "它从哪里来", "从真实使用的课表服务里长出来", "项目源于已经真实投入使用的校园课表服务；真实需求让作品不断生长。");
  addText(s, "1500+", 0.66, 1.86, 3.6, 1.0, { fontSize: 60, bold: true, color: C.coralDark }, "A01");
  addText(s, "底层课表服务累计用户", 0.72, 2.88, 3.4, 0.36, { fontSize: 16, bold: true }, "A01");
  addText(s, "查到课表，只是第一步。", 0.74, 3.5, 3.9, 0.62, { fontFace: F.title, fontSize: 24, bold: true, color: C.coralDark, valign: "top" }, "A02");
  hairline(s, 0.78, 4.24, 3.45, C.coral, 2.2, "A02");
  const questions = ["谁有空？", "哪里有空？", "会不会赶不及？", "能不能调？", "哪里最忙？"];
  questions.forEach((q, index) => {
    addText(s, q, 0.8, 4.46 + index * 0.46, 3.6, 0.4, { fontFace: F.title, fontSize: 16.5, bold: true, color: index % 2 ? C.amber : C.coralDark }, "A03");
  });
  const nodes = [
    { x: 5.2, y: 2.06, t: "课程", c: C.coral }, { x: 8.07, y: 1.88, t: "教师", c: C.amber },
    { x: 10.72, y: 2.34, t: "班级", c: C.blue }, { x: 6.02, y: 5.04, t: "教室", c: C.green },
    { x: 9.38, y: 5.0, t: "时间", c: C.coralDark },
  ];
  const cx = 8.24; const cy = 3.57;
  nodes.forEach((n) => {
    addShape(s, S.ellipse, { x: n.x, y: n.y, w: 1.2, h: 1.2, fill: { color: C.paper, transparency: 4 }, line: { color: n.c, width: 1.5 } }, "A04", "relation-node");
    addText(s, n.t, n.x, n.y + 0.37, 1.2, 0.36, { fontSize: 15, bold: true, color: n.c, align: "center" }, "A04");
    arrow(s, n.x + 0.6, n.y + 0.6, cx - (n.x + 0.6), cy - (n.y + 0.6), C.line, 1.0, "A04");
  });
  addShape(s, S.ellipse, { x: cx - 0.82, y: cy - 0.63, w: 1.64, h: 1.26, fill: { color: C.coral }, line: noLine }, "A05", "relation-center");
  addText(s, "教学安排", cx - 0.78, cy - 0.2, 1.56, 0.4, { fontSize: 17, bold: true, color: C.white, align: "center" }, "A05");
  addText(s, "真实需求从“查得到”，长成“算得清、调得动、看得全”。", 5.42, 6.62, 6.95, 0.4, { fontFace: F.title, fontSize: 15.5, bold: true, color: C.coralDark, align: "center" }, "A06");
}

// 03｜三类用户：整套作品的新主轴。
{
  const s = pptx.addSlide();
  header(s, 3, "谁在用它", "学生、教师与教学管理者", "同一个系统，回答三类人每天最真实的问题。");
  const roles = [
    {
      x: 0.7, title: "学生", color: C.coral, q: "“我今天有什么课？\n附近哪里有空教室？”",
      caps: ["一句话查课表", "连续追问不丢上下文", "找空教室与可用空间", "今天课程与安排"],
    },
    {
      x: 4.92, title: "教师", color: C.green, q: "“我们什么时候都空？\n能不能调整？”",
      caps: ["多人共同空闲", "教室空间推荐", "教学空间转场风险", "调课前模拟核验"],
    },
    {
      x: 9.14, title: "教学管理者", color: C.blue, q: "“谁最忙？\n哪里可能有风险？”",
      caps: ["全局负载总览", "教室资源分布", "风险对象定位", "下钻原因分析"],
    },
  ];
  roles.forEach((role, index) => {
    const group = `A0${index + 1}`;
    addText(s, role.title, role.x, 1.98, 3.4, 0.62, { fontFace: F.title, fontSize: 30, bold: true, color: role.color }, group);
    hairline(s, role.x + 0.02, 2.72, 0.86, role.color, 3.2, group);
    addText(s, role.q, role.x, 2.98, 3.45, 1.06, { fontFace: F.title, fontSize: 16.5, bold: true, color: C.ink, breakLine: true, valign: "top" }, group);
    role.caps.forEach((cap, capIndex) => {
      addText(s, `· ${cap}`, role.x + 0.02, 4.28 + capIndex * 0.5, 3.4, 0.42, { fontSize: 13, color: C.body }, group);
    });
  });
  addShape(s, S.line, { x: 4.66, y: 2.02, w: 0, h: 3.7, line: { color: C.line, width: 1 } }, "A04", "divider-1");
  addShape(s, S.line, { x: 8.88, y: 2.02, w: 0, h: 3.7, line: { color: C.line, width: 1 } }, "A04", "divider-2");
  addText(s, "他们不需要学会教务系统的操作，只要把问题说出来。", 2.28, 6.28, 8.76, 0.4, { fontFace: F.title, fontSize: 16, bold: true, color: C.coralDark, align: "center" }, "A05");
}

// 04｜一句话怎样变成结果。
{
  const s = pptx.addSlide();
  header(s, 4, "一句话怎样变成结果", "用户只管把问题说出来", "理解、分工、计算、核验与继续追问，由系统接住。");
  addShape(s, S.roundRect, { x: 0.74, y: 2.02, w: 4.02, h: 1.2, rectRadius: 0.18, fill: { color: C.coralSoft, transparency: 4 }, line: { color: C.coral, width: 1.2 } }, "A01", "question");
  addText(s, "“帮三位老师找共同空闲，\n再推荐一间不少于 120 座的教室。”", 1.04, 2.23, 3.43, 0.74, { fontFace: F.title, fontSize: 16, bold: true, breakLine: true, valign: "top" }, "A01");
  addText(s, "一句人话", 0.79, 3.47, 3.62, 0.42, { fontSize: 20, bold: true, color: C.coralDark }, "A02");
  addText(s, "不需要填写复杂表单，也不需要知道背后有哪些智能体和工具。", 0.8, 3.98, 3.55, 0.72, { fontSize: 13, color: C.body, breakLine: true, valign: "top" }, "A02");
  const steps = [
    { x: 5.37, t: "听懂问题", d: "识别对象和目标", c: C.coral }, { x: 7.1, t: "分给专家", d: "不同角色接力", c: C.amber },
    { x: 8.83, t: "算清事实", d: "工具查询与计算", c: C.green }, { x: 10.56, t: "核验结论", d: "结果可追溯", c: C.blue },
  ];
  steps.forEach((st, index) => {
    const group = `A0${index + 3}`;
    addText(s, String(index + 1).padStart(2, "0"), st.x, 2.02, 0.72, 0.35, { fontSize: 11, bold: true, color: st.c }, group);
    hairline(s, st.x, 2.49, 1.34, st.c, 2.8, group);
    addText(s, st.t, st.x, 2.78, 1.42, 0.48, { fontFace: F.title, fontSize: 17, bold: true, color: st.c }, group);
    addText(s, st.d, st.x, 3.38, 1.42, 0.62, { fontSize: 11.2, color: C.body, breakLine: true, valign: "top" }, group);
    if (index < steps.length - 1) arrow(s, st.x + 1.38, 2.64, 0.26, 0, C.line, 1.3, group);
  });
  hairline(s, 5.34, 4.62, 6.65, C.line, 1.0, "A07");
  addText(s, "模型负责听懂人话和组织协作；CampusTools 负责把动态校园事实算清楚。", 5.36, 4.87, 6.68, 0.5, { fontSize: 14, bold: true }, "A07");
  addText(s, "结果进入统一结果卡，可以继续追问“那看看他的课表”“再查一下风险”。", 5.36, 5.5, 6.65, 0.42, { fontSize: 13, color: C.body }, "A08");
  addText(s, "4 个智能体 · 13 项工具 · 14 组协作绑定", 5.36, 6.18, 2.75, 0.28, { fontSize: 10.2, bold: true, color: C.body }, "A08");
  label(s, "查得清 · 算得出 · 验得过 · 接得住", 8.46, 6.16, 3.06, C.coral, "A08");
}

// 05｜学生场景：用一段连续追问讲清真实能力，不虚构结果数字。
{
  const s = pptx.addSlide();
  header(s, 5, "学生场景｜从查课到找空间", "一句话查课，也能接着问", "学生不用反复选择查询入口；系统记住对象和时间，把下一句话接下去。");
  const turns = [
    { n: "01", q: "“查看 01 班第 1 周课表。”", d: "先查清课程安排", c: C.coral, group: "A01" },
    { n: "02", q: "“只看周三。”", d: "沿用班级与周次", c: C.amber, group: "A02" },
    { n: "03", q: "“下午哪里有空教室？”", d: "继续查询可用空间", c: C.green, group: "A03" },
  ];
  turns.forEach((item, index) => {
    const y = 1.94 + index * 1.28;
    addText(s, item.n, 0.82, y, 0.48, 0.3, { fontSize: 10, bold: true, color: item.c }, item.group);
    addText(s, item.q, 1.42, y - 0.02, 3.52, 0.5, { fontFace: F.title, fontSize: 17.5, bold: true, color: C.ink }, item.group);
    addText(s, item.d, 1.42, y + 0.55, 3.2, 0.3, { fontSize: 11.2, bold: true, color: item.c }, item.group);
    if (index < turns.length - 1) arrow(s, 1.04, y + 0.72, 0, 0.5, C.line, 1.2, item.group);
  });
  hairline(s, 0.82, 5.86, 3.98, C.line, 1.0, "A04");
  addText(s, "不用重填班级，不用重选时间，\n也不用学习教务系统的复杂入口。", 0.82, 6.05, 4.02, 0.72, { fontFace: F.title, fontSize: 13.4, bold: true, color: C.coralDark, breakLine: true, valign: "top" }, "A04");
  screen(s, path.join(finalShots, "04-student-live-1920x1080-final.png"), 5.24, 1.9, 7.42, 4.42, "A05", false);
  addText(s, "真实 ADP 三轮连续追问 · 同一会话", 8.54, 6.44, 4.06, 0.3, { fontSize: 11.5, bold: true, color: C.coralDark, align: "right" }, "A05");
}

// 06｜教师案例一：多人协同，3 → 63 → 7 → A1-201。
{
  const s = pptx.addSlide();
  header(s, 6, "教师案例｜多人协同", "三位教师的一次共同空闲，最后落到一间教室", "第1周周四1—4节；先找人都空的时间，再按容量筛选教室。");
  const chain = [
    { x: 0.72, n: "3", label: "位教师", color: C.coral, group: "A01" },
    { x: 3.36, n: "63", label: "间可用教室", color: C.green, group: "A02" },
    { x: 6.31, n: "7", label: "间不少于120座", color: C.amber, group: "A03" },
    { x: 9.34, n: "A1-201", label: "推荐教室 · 120座", color: C.blue, group: "A04" },
  ];
  chain.forEach((item, index) => {
    addText(s, item.n, item.x, 1.86, index === 3 ? 2.45 : 1.62, 0.86, { fontSize: index === 3 ? 36 : 48, bold: true, color: item.color }, item.group);
    addText(s, item.label, item.x, 2.74, index === 3 ? 2.48 : 2.02, 0.34, { fontSize: 12, bold: true, color: C.body }, item.group);
    if (index < chain.length - 1) arrow(s, item.x + (index === 0 ? 1.82 : 2.18), 2.43, 0.44, 0, C.coral, 1.6, item.group);
  });
  hairline(s, 0.72, 3.25, 11.86, C.line, 1.0, "A05");
  screen(s, path.join(qa, "4173-collaboration-1920x1080.png"), 1.09, 3.56, 11.16, 2.78, "A05", true);
  addText(s, "共同空闲 → 空间可用 → 容量过滤 → 给出推荐", 3.37, 6.5, 6.62, 0.32, { fontSize: 13, bold: true, color: C.coralDark, align: "center" }, "A06");
}

// 07｜教师案例二：风险发现 + 模拟调课，一个完整的教学故事。
{
  const s = pptx.addSlide();
  header(s, 7, "教师案例｜风险与模拟调课", "没有冲突，不等于来得及；可以调，也不等于没有提醒", "教师025 · 第1—4周；系统先算清空间转场风险，再模拟调整方案——真实课表不会被改动。");
  addText(s, "0", 0.78, 1.82, 1.42, 1.0, { fontSize: 58, bold: true, color: C.green }, "A01");
  addText(s, "硬冲突", 2.16, 2.16, 1.9, 0.4, { fontSize: 17, bold: true, color: C.green }, "A01");
  addText(s, "4 次", 0.78, 3.24, 1.82, 0.9, { fontSize: 50, bold: true, color: C.amber }, "A02");
  addText(s, "转场 / 周", 2.44, 3.53, 1.72, 0.4, { fontSize: 16, bold: true, color: C.amber }, "A02");
  addText(s, "最短间隔 20 分钟", 0.82, 4.22, 3.2, 0.34, { fontSize: 13, bold: true, color: C.body }, "A02");
  addShape(s, S.rect, { x: 0.74, y: 5.03, w: 4.04, h: 1.55, fill: { color: C.greenSoft, transparency: 16 }, line: noLine }, "A03", "reschedule-band");
  addText(s, "可行 · 有提醒 · 未写入", 0.94, 5.3, 3.68, 0.42, { fontFace: F.title, fontSize: 17, bold: true, color: C.green }, "A03");
  addText(s, "模拟核验不修改真实课表", 0.94, 5.91, 3.68, 0.34, { fontSize: 11.5, bold: true, color: C.body }, "A03");
  screen(s, path.join(qa, "4173-risk-1920x1080.png"), 5.08, 1.84, 7.58, 2.42, "A04", true);
  screen(s, path.join(qa, "4173-reschedule-1920x1080.png"), 5.08, 4.44, 7.58, 2.42, "A05", true);
}

// 08｜教学管理案例：全局到个体，排名是入口不是结论。
{
  const s = pptx.addSlide();
  header(s, 8, "教学管理案例｜全局到个体", "排名不是结论，而是发现问题的入口", "未来四周谁的负载最高？他的课表和真实风险是什么？一层一层往下看。");
  const stages = [
    { y: 1.95, n: "01", title: "先找出最忙的人", result: "教师025 · 56课次 / 112课时", color: C.blue, group: "A01" },
    { y: 3.47, n: "02", title: "再看他的课表", result: "沿用同一教师对象，不用重新输入", color: C.coral, group: "A02" },
    { y: 4.99, n: "03", title: "最后检查他的风险", result: "0硬冲突 / 每周4次转场风险", color: C.green, group: "A03" },
  ];
  stages.forEach((st, index) => {
    addShape(s, S.ellipse, { x: 0.82, y: st.y, w: 0.54, h: 0.54, fill: { color: st.color }, line: noLine }, st.group, "stage-dot");
    addText(s, st.n, 0.89, st.y + 0.12, 0.4, 0.22, { fontSize: 8.5, bold: true, color: C.white, align: "center" }, st.group);
    addText(s, st.title, 1.62, st.y - 0.01, 2.65, 0.42, { fontFace: F.title, fontSize: 18, bold: true, color: st.color }, st.group);
    addText(s, st.result, 1.62, st.y + 0.55, 3.72, 0.36, { fontSize: 12.2, color: C.body }, st.group);
    if (index < stages.length - 1) addShape(s, S.line, { x: 1.09, y: st.y + 0.57, w: 0, h: 0.94, line: { color: C.line, width: 1.4, dash: "dash" } }, st.group, "stage-line");
  });
  addText(s, "答案层层接力，“他”始终是同一个人。", 0.83, 6.35, 4.38, 0.38, { fontFace: F.title, fontSize: 17, bold: true, color: C.coralDark }, "A04");
  screen(s, path.join(qa, "4173-insight-1920x1080.png"), 5.62, 1.88, 7.04, 4.84, "A04", true);
}

// 09｜背后怎么做到：技术此时才出场。
{
  const s = pptx.addSlide();
  header(s, 9, "背后怎么做到", "主协调听懂任务，专业角色把事情办完", "四个智能体各有边界；主协调不直接调用 CampusTools，所有结果都回到主协调统一解释。");
  addShape(s, S.ellipse, { x: 4.55, y: 2.04, w: 2.13, h: 1.45, fill: { color: C.coral }, line: noLine }, "A01", "main");
  addText(s, "小序·主协调", 4.66, 2.33, 1.9, 0.4, { fontFace: F.title, fontSize: 17, bold: true, color: C.white, align: "center" }, "A01");
  addText(s, "理解 · 分工 · 汇总", 4.74, 2.82, 1.73, 0.27, { fontSize: 10, color: "FFE5DE", align: "center" }, "A01");
  const children = [
    { x: 0.78, y: 2.05, title: "课程空间", desc: "查课表、找教室、算共同空闲", color: C.coralDark },
    { x: 0.78, y: 4.36, title: "风险规划", desc: "查冲突、识别赶场、模拟调课", color: C.amber },
    { x: 4.48, y: 4.62, title: "校园洞察", desc: "看负载、找第一名、继续下钻", color: C.blue },
  ];
  children.forEach((ch, index) => {
    const group = `A0${index + 2}`;
    addText(s, ch.title, ch.x, ch.y, 2.86, 0.48, { fontFace: F.title, fontSize: 20, bold: true, color: ch.color }, group);
    hairline(s, ch.x, ch.y + 0.61, 2.7, ch.color, 2.3, group);
    addText(s, ch.desc, ch.x, ch.y + 0.81, 2.85, 0.54, { fontSize: 12, color: C.body }, group);
    const fromX = ch.x > 4 ? ch.x + 1.43 : ch.x + 2.84; const fromY = ch.y + 0.58;
    doubleArrow(s, fromX, fromY, 4.55 - fromX + (ch.x > 4 ? 1.06 : 0), 2.76 - fromY, C.coral, group);
  });
  addShape(s, S.rect, { x: 7.47, y: 1.92, w: 5.19, h: 4.8, fill: { color: C.greenSoft, transparency: 24 }, line: noLine }, "A05", "tools-band");
  addText(s, "CampusTools", 7.83, 2.17, 2.4, 0.48, { fontSize: 23, bold: true, color: C.green }, "A05");
  addText(s, "13 个面向智能体的确定性工具", 7.85, 2.69, 3.64, 0.31, { fontSize: 11.5, color: C.body }, "A05");
  const toolGroups = [
    ["课表与对象", "查课表 · 找对象 · 衔接上下文"], ["空间与协同", "找空教室 · 求共同空闲 · 生成方案"],
    ["风险与调课", "查冲突 · 识别赶场 · 模拟可行性"], ["校园洞察", "看总览 · 算负载 · 分析空间利用"],
  ];
  toolGroups.forEach((row, index) => {
    const y = 3.28 + index * 0.74;
    hairline(s, 7.84, y + 0.58, 4.35, index === toolGroups.length - 1 ? C.green : "BFD8CE", index === toolGroups.length - 1 ? 2.2 : 0.8, "A05");
    addText(s, row[0], 7.86, y, 1.34, 0.36, { fontSize: 12.2, bold: true, color: C.green }, "A05");
    addText(s, row[1], 9.34, y, 2.85, 0.36, { fontSize: 10.7, color: C.body }, "A05");
  });
  addText(s, "4", 8.04, 6.02, 0.56, 0.48, { fontSize: 26, bold: true, color: C.coralDark, align: "center" }, "A06");
  addText(s, "个智能体", 8.55, 6.09, 0.94, 0.3, { fontSize: 10.5, bold: true }, "A06");
  addText(s, "13", 9.62, 6.02, 0.72, 0.48, { fontSize: 26, bold: true, color: C.green, align: "center" }, "A06");
  addText(s, "项工具", 10.3, 6.09, 0.78, 0.3, { fontSize: 10.5, bold: true }, "A06");
  addText(s, "14", 11.2, 6.02, 0.72, 0.48, { fontSize: 26, bold: true, color: C.blue, align: "center" }, "A06");
  addText(s, "绑定关系", 11.86, 6.09, 1.0, 0.3, { fontSize: 10.5, bold: true }, "A06");
}

// 10｜技术创新：让理解、事实与上下文各自有边界。
{
  const s = pptx.addSlide();
  header(s, 10, "技术创新", "技术创新：让任务接得住，让结果核得清", "把多人协作、确定性事实与跨轮次上下文，组织成同一条可复核的任务链。");
  const layers = [
    { y: 1.91, h: 1.34, fill: C.coralSoft, color: C.coralDark, n: "01", title: "多角色接力", body: "主协调听懂目标，专业智能体各自处理课表、风险与全局洞察。", tech: "分工有边界", group: "A01" },
    { y: 3.39, h: 1.56, fill: C.greenSoft, color: C.green, n: "02", title: "事实单独核验", body: "课表、教室、容量与风险由 CampusTools 计算；模型不能自行补写动态事实。", tech: "结果可复核", group: "A02" },
    { y: 5.09, h: 1.34, fill: C.blueSoft, color: C.blue, n: "03", title: "追问不用重来", body: "从“谁最忙”到“看他的课表”再到“查他的风险”，同一对象持续传递。", tech: "上下文连续", group: "A03" },
  ];
  layers.forEach((l) => {
    addShape(s, S.rect, { x: 0.72, y: l.y, w: 11.9, h: l.h, fill: { color: l.fill, transparency: 6 }, line: noLine }, l.group, "layer");
    addText(s, l.n, 1.02, l.y + 0.2, 0.48, 0.34, { fontSize: 10, bold: true, color: l.color }, l.group);
    addText(s, l.title, 1.62, l.y + 0.22, 3.05, 0.52, { fontFace: F.title, fontSize: 21, bold: true, color: l.color }, l.group);
    addText(s, l.body, 5.08, l.y + 0.2, 5.56, l.h - 0.38, { fontSize: 12.4, color: C.body, breakLine: true }, l.group);
    addText(s, l.tech, 10.92, l.y + 0.22, 1.34, 0.34, { fontSize: 10.5, bold: true, color: l.color, align: "right" }, l.group);
  });
  addText(s, "“模型可以理解，但不能自行编造校园事实。”", 3.89, 6.57, 5.52, 0.34, { fontFace: F.title, fontSize: 14.5, bold: true, color: C.coralDark, align: "center" }, "A04");
}

// 11｜真实落地与下一步。
{
  const s = pptx.addSlide();
  header(s, 11, "真实落地与下一步", "从真实服务长出来，也朝着真实需求走下去", "项目源于已经真实投入使用的校园课表服务；只呈现已发生的真实使用，不虚构活跃度、满意度或增长率。");
  addText(s, "1500+", 0.7, 1.86, 3.5, 0.98, { fontSize: 60, bold: true, color: C.coralDark }, "A01");
  addText(s, "底层课表服务累计用户", 0.76, 2.86, 3.1, 0.36, { fontSize: 16, bold: true }, "A01");
  addText(s, "本次参赛作品在这些真实需求基础上，从课表查询升级为校园教学时空资源智能体。", 0.78, 3.36, 3.6, 0.82, { fontSize: 12.5, color: C.body, breakLine: true, valign: "top" }, "A02");
  hairline(s, 0.78, 4.32, 3.37, C.line, 1.0, "A02");
  const values = ["减少信息差", "减少重复核对", "降低协调成本", "提前发现风险", "让安排更可解释"];
  values.forEach((value, index) => {
    const y = 4.5 + index * 0.44;
    addText(s, `0${index + 1}`, 0.8, y, 0.42, 0.28, { fontSize: 9, bold: true, color: index % 2 ? C.green : C.coral }, "A03");
    addText(s, value, 1.32, y, 2.77, 0.3, { fontSize: 12.2, bold: true }, "A03");
  });
  screen(s, path.join(assets, "portal-home-1920x1080-final.png"), 4.7, 1.86, 7.96, 3.38, "A04", true);
  const roadmap = ["学生高频课表服务", "教师协同与资源推荐", "教学管理风险预警", "教学时空数字化治理"];
  roadmap.forEach((item, index) => {
    const x = 4.72 + index * 1.98;
    const group = `A0${index + 2}`;
    addText(s, `0${index + 1}`, x, 5.55, 0.38, 0.25, { fontSize: 8.5, bold: true, color: index < 2 ? C.coral : C.green }, group);
    hairline(s, x, 5.91, 1.62, index < 2 ? C.coral : C.green, 2.1, group);
    addText(s, item, x, 6.08, 1.72, 0.58, { fontSize: 10.2, bold: true, color: C.body, breakLine: true, valign: "top" }, group);
  });
}

// 12｜在线体验与收束。
{
  const s = pptx.addSlide();
  addBackground(s, 12, true);
  addText(s, "在线体验", 0.62, 0.31, 2.1, 0.26, { fontSize: 10, bold: true, color: "FFB7A7" }, null);
  addText(s, "评委可以直接问，\n不需要先懂配置。", 0.62, 0.77, 5.35, 1.22, { fontFace: F.title, fontSize: 29, bold: true, color: C.white, breakLine: true, valign: "top" }, "A01");
  addText(s, "匿名访问，无需测试账号；三类角色的问题都可以直接试。", 0.66, 2.19, 5.26, 0.42, { fontSize: 13, color: "E9DDD7" }, "A01");
  screen(s, path.join(assets, "portal-home-1920x1080-final.png"), 0.66, 2.66, 3.62, 2.04, "A02", true);
  screen(s, path.join(assets, "portal-capability-1920x1080-final.png"), 4.5, 2.66, 3.62, 2.04, "A03", true);
  screen(s, path.join(assets, "portal-verified-widget-1920x1080-final.png"), 8.34, 2.66, 3.62, 2.04, "A04", true);
  const roleQuestions = [
    { x: 0.66, role: "学生", q: "“查看2025级计算机类01班\n第1周课表。”" },
    { x: 4.5, role: "教师", q: "“帮三位老师找周四上午\n的共同空闲。”" },
    { x: 8.34, role: "教学管理者", q: "“未来四周谁的教学负载\n最高？”" },
  ];
  roleQuestions.forEach((item, index) => {
    const group = `A0${index + 5}`;
    addText(s, item.role, item.x + 0.06, 4.86, 3.5, 0.3, { fontSize: 12, bold: true, color: "FFB7A7" }, group);
    addText(s, item.q, item.x + 0.06, 5.16, 3.5, 0.62, { fontSize: 11, color: "F2E8E3", breakLine: true, valign: "top" }, group);
  });
  addImage(s, imageContain(path.join(assets, "在线演示二维码.png"), 10.94, 5.98, 1.3, 1.3), "A05", "qr");
  addText(s, "扫码体验", 9.32, 6.06, 1.38, 0.3, { fontSize: 13, bold: true, color: C.white, align: "right" }, "A05");
  addText(s, "无需账号", 9.56, 6.4, 1.14, 0.26, { fontSize: 10, bold: true, color: "9FDBC8", align: "right" }, "A05");
  addText(s, "让教学时空，被理解、被安排。", 0.66, 6.02, 7.65, 0.52, { fontFace: F.title, fontSize: 22, bold: true, color: "FFD3C8" }, "A06");
  addText(s, "adp.katelya.top", 0.68, 6.62, 3.2, 0.28, { fontSize: 12, bold: true, color: C.white }, "A06");
  footer(s, 12, true);
}

await pptx.writeFile({ fileName: output, compression: true });
console.log(output);
