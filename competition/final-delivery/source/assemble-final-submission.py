from __future__ import annotations

import hashlib
import shutil
from datetime import datetime
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
FINAL = ROOT / "FINAL-SUBMISSION"
ASSETS = ROOT / "assets"
DOWNLOADS = Path.home() / "Downloads"
URL = "https://adp.katelya.top/"

PPTX = ROOT / "校园智序-小序-答辩.pptx"
PPT_PDF = ROOT / "校园智序-小序-答辩.pdf"
DOCX = ROOT / "校园智序-小序-智能体设计说明书.docx"
DOC_PDF = ROOT / "校园智序-小序-智能体设计说明书.pdf"
PROGRAM_ZIP = ROOT / "校园智序-小序-程序交付材料.zip"
QR = ASSETS / "在线演示二维码.png"
PORTAL_HOME = ASSETS / "portal-home-1920x1080-final.png"
PORTAL_EXPERIENCE = ASSETS / "portal-experience-1920x1080-final.png"
PORTAL_WIDGET = ASSETS / "portal-verified-widget-1920x1080-final.png"

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
pdfmetrics.registerFont(TTFont("Xiaoxu", FONT_REGULAR))
pdfmetrics.registerFont(TTFont("XiaoxuBold", FONT_BOLD))

W, H = A4
BG = "#FCF8F3"
INK = "#272220"
BODY = "#5B4F4A"
MUTE = "#83756F"
CORAL = "#E65745"
CORAL_DARK = "#B73F34"
GREEN = "#24816D"
BLUE = "#527CA3"
AMBER = "#B96B2E"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def safe_reset_final() -> None:
    resolved = FINAL.resolve()
    if resolved.parent != ROOT.resolve() or resolved.name != "FINAL-SUBMISSION":
        raise RuntimeError(f"Unsafe final target: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    for name in (
        "01_智能体设计说明书",
        "02_作品演示视频",
        "03_程序交付材料",
        "04_答辩PPT",
        "05_其他可选材料",
    ):
        (resolved / name).mkdir(parents=True, exist_ok=True)


def copy(source: Path, target: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def find_final_video() -> Path:
    candidates = []
    preferred = DOWNLOADS / "小序-演示视频"
    if preferred.is_dir():
        candidates.extend(preferred.rglob("*.mp4"))
    candidates.extend(path for path in DOWNLOADS.glob("*.mp4") if "小序" in path.name or "校园智序" in path.name)
    candidates = [path for path in candidates if path.is_file()]
    if not candidates:
        raise FileNotFoundError("No final Xiaoxu MP4 found in Downloads")
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def page_background(c: canvas.Canvas, page_no: int, total: int) -> None:
    c.setFillColor(HexColor(BG))
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.saveState()
    c.setFillColor(Color(0.96, 0.50, 0.42, alpha=0.10))
    c.circle(35, H - 40, 145, fill=1, stroke=0)
    c.setFillColor(Color(0.76, 0.69, 0.85, alpha=0.10))
    c.circle(W - 25, 95, 155, fill=1, stroke=0)
    c.restoreState()
    c.setFont("Xiaoxu", 7)
    c.setFillColor(HexColor(MUTE))
    c.drawString(38, 24, "校园智序·小序")
    c.drawRightString(W - 38, 24, f"{page_no:02d} / {total:02d}")


def txt(c: canvas.Canvas, value: str, x: float, y: float, size: float, color: str = INK, bold: bool = False) -> None:
    c.setFont("XiaoxuBold" if bold else "Xiaoxu", size)
    c.setFillColor(HexColor(color))
    c.drawString(x, y, value)


def wrapped(c: canvas.Canvas, value: str, x: float, y: float, width: float, size: float, color: str = BODY, bold: bool = False, leading: float | None = None) -> float:
    font = "XiaoxuBold" if bold else "Xiaoxu"
    leading = leading or size * 1.65
    c.setFont(font, size)
    c.setFillColor(HexColor(color))
    current = ""
    lines: list[str] = []
    for char in value:
        if char == "\n":
            lines.append(current)
            current = ""
            continue
        if pdfmetrics.stringWidth(current + char, font, size) <= width:
            current += char
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    cursor = y
    for line in lines:
        c.drawString(x, cursor, line)
        cursor -= leading
    return cursor


def panel(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill: str = "#FFFFFF", alpha: float = 0.78, radius: float = 18) -> None:
    c.saveState()
    base = HexColor(fill)
    c.setFillColor(Color(base.red, base.green, base.blue, alpha=alpha))
    c.setStrokeColor(Color(1, 1, 1, alpha=0.88))
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    c.restoreState()


def image_fit(c: canvas.Canvas, image: Path, x: float, y: float, w: float, h: float) -> None:
    reader = ImageReader(str(image))
    iw, ih = reader.getSize()
    scale = min(w / iw, h / ih)
    rw, rh = iw * scale, ih * scale
    c.drawImage(reader, x + (w - rw) / 2, y + (h - rh) / 2, rw, rh, mask="auto")


def image_cover(c: canvas.Canvas, image: Path, x: float, y: float, w: float, h: float) -> None:
    reader = ImageReader(str(image))
    iw, ih = reader.getSize()
    scale = max(w / iw, h / ih)
    sw, sh = w / scale, h / scale
    sx = max(0, (iw - sw) / 2)
    sy = max(0, (ih - sh) / 2)
    c.drawImage(reader, x, y, w, h, mask="auto", srcinfo=(sx, sy, sx + sw, sy + sh))


def build_online_pdf(output: Path) -> None:
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    c.setTitle("校园智序·小序｜在线演示与权限说明")
    c.setAuthor("校园智序·小序")

    page_background(c, 1, 2)
    txt(c, "在线体验", 42, H - 62, 8.5, CORAL, True)
    txt(c, "在线演示与权限说明", 42, H - 105, 26, INK, True)
    wrapped(c, "评委可直接从自然语言问题进入课程查询、多人协同、模拟调课与校园洞察等核心场景。", 42, H - 137, W - 84, 10.5)
    panel(c, 42, H - 375, W - 84, 198)
    txt(c, "在线演示", 64, H - 213, 9, CORAL, True)
    txt(c, URL, 64, H - 245, 16, INK, True)
    txt(c, "匿名访问 · 无需测试账号", 64, H - 274, 10, GREEN, True)
    wrapped(c, "页面同时提供实时体验与已核验实录；实时不可用时不伪装成功，回放内容明确标记为非实时。", 64, H - 306, 270, 8.5)
    image_fit(c, QR, W - 188, H - 354, 120, 120)
    panel(c, 42, 72, W - 84, 360)
    image_fit(c, PORTAL_HOME, 54, 84, W - 108, 336)
    c.showPage()

    page_background(c, 2, 2)
    txt(c, "真实体验 · 已核验结果", 42, H - 62, 8.5, CORAL, True)
    txt(c, "真实页面，不需要先理解智能体配置", 42, H - 105, 23, INK, True)
    panel(c, 42, H - 445, W - 84, 300)
    image_fit(c, PORTAL_WIDGET, 54, H - 433, W - 108, 276)
    txt(c, "可直接验证的四个问题", 42, 338, 15, CORAL_DARK, True)
    prompts = [
        "01  教师025未来四周有没有冲突与跨校区赶场风险？",
        "02  教师005、006、014何时共同空闲，并推荐不少于120座的教室。",
        "03  将周一5–6节模拟调整到周四7–8节，是否可行？",
        "04  未来四周谁最忙？继续查看其课表并检查风险。",
    ]
    y = 302
    for value in prompts:
        panel(c, 42, y - 22, W - 84, 38, fill="#FFFFFF", alpha=0.62, radius=12)
        txt(c, value, 56, y - 8, 8.7, BODY, True)
        y -= 50
    txt(c, "权限结论", 42, 88, 8.2, CORAL, True)
    txt(c, "测试账号：无需账号", 42, 63, 11, GREEN, True)
    c.showPage()
    c.save()


def build_program_readme_pdf(output: Path) -> None:
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    c.setTitle("校园智序·小序｜程序交付与运行说明")
    c.setAuthor("校园智序·小序")

    page_background(c, 1, 3)
    txt(c, "PROGRAM DELIVERY", 42, H - 62, 8.5, CORAL, True)
    txt(c, "程序交付与运行说明", 42, H - 105, 26, INK, True)
    wrapped(c, "腾讯 ADP 平台化编排 + 自定义 CampusTools 确定性事实层 + 可核验结果卡的最小充分正式交付。", 42, H - 139, W - 84, 11)
    facts = [("4", "智能体", CORAL_DARK), ("13", "CampusTools", GREEN), ("14", "协作绑定", BLUE)]
    for idx, (number, label, color) in enumerate(facts):
        x = 42 + idx * 171
        panel(c, x, 515, 150, 104, fill="#FFFFFF", alpha=0.80)
        txt(c, number, x + 18, 560, 27, color, True)
        txt(c, label, x + 18, 535, 9.2, BODY, True)
    txt(c, "真实边界", 42, 473, 14, CORAL_DARK, True)
    wrapped(c, "Main 只负责理解、路由与汇总，直接工具数为 0；Schedule、Risk、Insight 通过 14 个 bindings 调用 13 个确定性工具；所有跨域协作回到 Main。", 42, 445, W - 84, 10.3)
    panel(c, 42, 230, W - 84, 155, fill="#FFFFFF", alpha=0.72)
    lines = [
        "自然语言 → 主协调 → 专业智能体 → CampusTools",
        "→ 约束核验 → 结构化结果 → 已核验结果卡",
        "→ academic_context 续接下一轮问题",
    ]
    y = 343
    for idx, line in enumerate(lines):
        txt(c, line, 67, y, 13.5, [CORAL_DARK, GREEN, BLUE][idx], True)
        y -= 42
    txt(c, "在线演示", 42, 174, 8.5, CORAL, True)
    txt(c, URL, 42, 146, 14, INK, True)
    c.showPage()

    page_background(c, 2, 3)
    txt(c, "PACKAGE MAP", 42, H - 62, 8.5, CORAL, True)
    txt(c, "程序 ZIP 内部结构", 42, H - 105, 24, INK, True)
    rows = [
        ("A_ADP工程", "最新 ADP 应用人工导出 ZIP", CORAL_DARK),
        ("B_CampusTools", "插件 ZIP、核心源码、OpenAPI、13 operations", GREEN),
        ("C_Widget", ".widget、Template、Schema、Default、契约", BLUE),
        ("D_Agent配置", "4 prompts、14 bindings、Main→Child→Main", CORAL),
        ("E_Data", "competition-demo-v3、schema、provenance", AMBER),
        ("F_Verification", "4 份标准核验结果、FINAL-TRUTH、最小测试", GREEN),
    ]
    y = H - 170
    for name, desc, color in rows:
        panel(c, 42, y - 58, W - 84, 66, fill="#FFFFFF", alpha=0.70, radius=14)
        txt(c, name, 58, y - 27, 11, color, True)
        wrapped(c, desc, 202, y - 27, W - 260, 9.2, BODY)
        y -= 79
    txt(c, "包内根目录同时提供 README、ARCHITECTURE 与 MANIFEST-SHA256。", 42, 83, 9, MUTE)
    c.showPage()

    page_background(c, 3, 3)
    txt(c, "运行与核验", 42, H - 62, 8.5, CORAL, True)
    txt(c, "导入、复现与已核验快照", 42, H - 105, 23, INK, True)
    steps = [
        "01  在腾讯 ADP 控制台导入 A_ADP工程 中的应用 ZIP。",
        "02  导入 B_CampusTools 中的自定义插件 ZIP，并核对 13 operations。",
        "03  使用 D_Agent配置 中的 prompts 与 bindings 配置 4 Agent。",
        "04  导入 C_Widget 中的最终 .widget。",
        "05  本地运行 node F_Verification/verify-minimal.js。",
    ]
    y = H - 164
    for step in steps:
        panel(c, 42, y - 43, W - 84, 50, fill="#FFFFFF", alpha=0.70, radius=13)
        txt(c, step, 58, y - 23, 9.5, BODY, True)
        y -= 63
    txt(c, "已核验快照", 42, 318, 14, GREEN, True)
    verified = [
        "Risk：0 冲突 / 4 风险 / 20 分钟",
        "Collaboration：3 → 63 → 7 → A1-201",
        "Reschedule：feasible + warning / mutatedData=false",
        "Insight：教师025 / 56 课次 / 112 课时",
    ]
    y = 287
    for line in verified:
        txt(c, "• " + line, 56, y, 10, BODY)
        y -= 28
    wrapped(c, "事实源仅为 competition-demo-v3、CampusTools、标准核验结果与 FINAL-TRUTH；导出包内不包含真实用户数据或访问凭证。", 42, 136, W - 84, 9.5, MUTE)
    c.showPage()
    c.save()


def build_overview_pdf(output: Path, video_duration_text: str) -> None:
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    c.setTitle("校园智序·小序｜提交材料总览")
    c.setAuthor("校园智序·小序")
    page_background(c, 1, 2)
    txt(c, "FINAL SUBMISSION", 42, H - 62, 8.5, CORAL, True)
    txt(c, "提交材料总览", 42, H - 105, 27, INK, True)
    wrapped(c, "小序把复杂的校园教学时空，变成一句话可以理解、计算、核验和继续决策的事情。", 42, H - 140, W - 84, 11.2)
    items = [
        ("01", "智能体设计说明书", "DOCX + PDF · 20 页", CORAL_DARK),
        ("02", "作品演示视频", f"MP4 · {video_duration_text}", BLUE),
        ("03", "程序交付材料", "最小充分 ZIP + 运行说明", GREEN),
        ("04", "答辩 PPT", "PPTX + PDF · 12 页", CORAL),
        ("05", "在线演示", "PDF + TXT + QR Code", AMBER),
    ]
    y = H - 205
    for no, title, desc, color in items:
        panel(c, 42, y - 60, W - 84, 68, fill="#FFFFFF", alpha=0.76, radius=15)
        txt(c, no, 59, y - 28, 11, color, True)
        txt(c, title, 98, y - 28, 13, INK, True)
        c.setFont("Xiaoxu", 9)
        c.setFillColor(HexColor(MUTE))
        c.drawRightString(W - 58, y - 28, desc)
        y -= 83
    txt(c, "在线入口", 42, 92, 8.5, CORAL, True)
    txt(c, URL, 42, 65, 13, INK, True)
    c.showPage()

    page_background(c, 2, 2)
    txt(c, "FINAL TRUTH", 42, H - 62, 8.5, CORAL, True)
    txt(c, "一页核对全部关键事实", 42, H - 105, 24, INK, True)
    facts = [
        "4 Agent · 13 CampusTools · 14 bindings · Main → Child → Main",
        "competition-demo-v3 · sha1:842b7959e808",
        "Risk：0 冲突 / 4 风险",
        "Collaboration：3 → 63 → 7 → A1-201",
        "Reschedule：feasible + warning / mutatedData=false",
        "Insight：教师025 / 56 课次 / 112 课时",
        "真实落地：累计真实用户 1500+",
    ]
    y = H - 170
    for idx, fact in enumerate(facts, 1):
        panel(c, 42, y - 52, W - 84, 60, fill="#FFFFFF", alpha=0.68, radius=14)
        txt(c, f"{idx:02d}", 58, y - 25, 9, CORAL, True)
        txt(c, fact, 94, y - 25, 10.3, BODY, True)
        y -= 72
    txt(c, "匿名与安全", 42, 104, 9, CORAL, True)
    wrapped(c, "材料不展示真实学校、真实个人身份、本机路径、内部调试地址或访问凭证；所有用户、课程与教室对象均为匿名演示口径。", 42, 79, W - 84, 8.8, MUTE)
    c.showPage()
    c.save()


def write_text_files(video_source: Path) -> None:
    online = FINAL / "05_其他可选材料" / "在线演示与权限说明.txt"
    online.write_text(
        "作品：校园智序·小序\n"
        f"在线演示：{URL}\n\n"
        "说明：评委可直接从自然语言问题进入课程查询、多人协同、模拟调课与校园洞察等核心场景。\n"
        "测试账号：无需账号\n",
        encoding="utf-8",
        newline="\n",
    )
    readme = FINAL / "README-提交说明.txt"
    readme.write_text(
        "校园智序·小序｜FINAL SUBMISSION\n\n"
        "01_智能体设计说明书：可编辑 DOCX 与同版 PDF。\n"
        "02_作品演示视频：从 Downloads 最新最终 MP4 原样复制，未重新编码。\n"
        "03_程序交付材料：平台工程、自定义 CampusTools、Widget、Agent 配置、匿名数据与验证材料。\n"
        "04_答辩PPT：12 页 PPTX 与同版 PDF。\n"
        "05_其他可选材料：在线演示说明与二维码。\n\n"
        f"在线演示：{URL}\n"
        "测试账号：无需账号\n"
        f"视频来源文件名：{video_source.name}\n"
        "事实口径：FINAL-TRUTH / 标准核验结果。\n",
        encoding="utf-8",
        newline="\n",
    )


def write_manifest() -> None:
    entries = []
    for path in sorted(p for p in FINAL.rglob("*") if p.is_file() and p.name != "MANIFEST-SHA256.txt"):
        entries.append(f"{sha256(path)}  {path.relative_to(FINAL).as_posix()}")
    (FINAL / "MANIFEST-SHA256.txt").write_text("\n".join(entries) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    safe_reset_final()
    video_source = find_final_video()

    copy(DOCX, FINAL / "01_智能体设计说明书" / DOCX.name)
    copy(DOC_PDF, FINAL / "01_智能体设计说明书" / DOC_PDF.name)
    video_target = FINAL / "02_作品演示视频" / "校园智序-小序-作品演示视频.mp4"
    copy(video_source, video_target)
    copy(PROGRAM_ZIP, FINAL / "03_程序交付材料" / PROGRAM_ZIP.name)
    copy(PPTX, FINAL / "04_答辩PPT" / PPTX.name)
    copy(PPT_PDF, FINAL / "04_答辩PPT" / PPT_PDF.name)
    copy(QR, FINAL / "05_其他可选材料" / QR.name)

    online_pdf = FINAL / "05_其他可选材料" / "在线演示与权限说明.pdf"
    program_pdf = FINAL / "03_程序交付材料" / "README-程序交付与运行说明.pdf"
    overview_pdf = FINAL / "00_提交材料总览.pdf"
    build_online_pdf(online_pdf)
    build_program_readme_pdf(program_pdf)
    build_overview_pdf(overview_pdf, "04:44")
    write_text_files(video_source)
    write_manifest()

    if sha256(video_source) != sha256(video_target):
        raise RuntimeError("Video copy hash mismatch")
    print(FINAL)
    print(f"video={video_source} sha256={sha256(video_target)}")


if __name__ == "__main__":
    main()
