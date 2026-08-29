from __future__ import annotations

from pathlib import Path

from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "ONLINE-DEMO-GUIDE.pdf"
LOGO = ROOT.parent / "demo-portal" / "public" / "branding" / "platform-logo.png"
URL = "https://adp.katelya.top/"

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
pdfmetrics.registerFont(TTFont("Xiaoxu", FONT_REGULAR))
pdfmetrics.registerFont(TTFont("XiaoxuBold", FONT_BOLD))

W, H = A4


def rounded_panel(c: canvas.Canvas, x: float, y: float, w: float, h: float, radius: float = 18) -> None:
    c.saveState()
    c.setFillColor(Color(1, 1, 1, alpha=0.70))
    c.setStrokeColor(Color(1, 1, 1, alpha=0.94))
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    c.restoreState()


def draw_qr(c: canvas.Canvas, x: float, y: float, size: float) -> None:
    widget = qr.QrCodeWidget(URL)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    drawing.drawOn(c, x, y)


def text(c: canvas.Canvas, value: str, x: float, y: float, size: float, color: str, bold: bool = False) -> None:
    c.setFont("XiaoxuBold" if bold else "Xiaoxu", size)
    c.setFillColor(HexColor(color))
    c.drawString(x, y, value)


def build() -> None:
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("校园智序·小序｜在线演示指南")
    c.setAuthor("校园智序·小序")
    c.setSubject("比赛在线演示入口与匿名说明")

    c.setFillColor(HexColor("#FBF7F2"))
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Low-frequency Auroraqua light fields.
    c.saveState()
    c.setFillColor(Color(0.98, 0.53, 0.43, alpha=0.13))
    c.circle(45, H - 55, 150, fill=1, stroke=0)
    c.setFillColor(Color(0.88, 0.80, 0.96, alpha=0.15))
    c.circle(W - 30, H - 270, 170, fill=1, stroke=0)
    c.setFillColor(Color(1.0, 0.72, 0.60, alpha=0.11))
    c.circle(W - 110, 70, 155, fill=1, stroke=0)
    c.restoreState()

    margin = 38
    logo = ImageReader(str(LOGO))
    c.drawImage(logo, margin, H - 92, 48, 48, mask="auto", preserveAspectRatio=True)
    text(c, "校园智序·小序", margin + 60, H - 63, 17, "#332B29", True)
    text(c, "ONLINE DEMO · SUBMISSION LOCK", margin + 60, H - 82, 7.2, "#B34A37", True)

    text(c, "扫码进入评委体验", margin, H - 138, 28, "#332B29", True)
    text(c, "让复杂的校园教学安排，简单到一句话就能问。", margin, H - 164, 10.5, "#6D5C58")

    # Main focus: URL + QR.
    rounded_panel(c, margin, H - 376, W - 2 * margin, 184, 24)
    text(c, "在线入口", margin + 22, H - 224, 8, "#B34A37", True)
    text(c, URL, margin + 22, H - 252, 15, "#332B29", True)
    text(c, "已发布 Multi-Agent · Native HTTPS SSE · 官方 ADP Widget", margin + 22, H - 274, 8.2, "#75635E")

    c.setFillColor(HexColor("#E05A42"))
    c.roundRect(margin + 22, H - 322, 86, 25, 12.5, fill=1, stroke=0)
    text(c, "Live ADP", margin + 42, H - 314, 7.4, "#FFFFFF", True)
    c.setFillColor(Color(1, 1, 1, alpha=0.82))
    c.roundRect(margin + 116, H - 322, 118, 25, 12.5, fill=1, stroke=0)
    text(c, "Verified Replay", margin + 134, H - 314, 7.4, "#A34736", True)

    qr_x, qr_y, qr_size = W - margin - 138, H - 354, 116
    c.setFillColor(Color(1, 1, 1, alpha=0.92))
    c.roundRect(qr_x - 11, qr_y - 11, qr_size + 22, qr_size + 22, 19, fill=1, stroke=0)
    draw_qr(c, qr_x, qr_y, qr_size)
    text(c, "手机扫码打开", qr_x + 20, qr_y - 25, 7.2, "#75635E")

    # Recommended prompts: one continuous vertical sequence, not card wallpaper.
    text(c, "推荐问题", margin, H - 418, 9, "#B34A37", True)
    prompts = [
        ("01", "未来四周教师负载最高的是谁？"),
        ("02", "再检查 Top1 未来四周有没有跨校区赶场风险。"),
        ("03", "帮教师005、006、014找第1周周四上午共同空闲，\n并推荐容量不少于120座的教室。"),
    ]
    y = H - 456
    for idx, prompt in prompts:
        c.setFillColor(Color(1, 1, 1, alpha=0.54))
        c.roundRect(margin, y - 26, W - 2 * margin, 48 if "\n" not in prompt else 60, 15, fill=1, stroke=0)
        text(c, idx, margin + 16, y - 2, 8.5, "#D85640", True)
        lines = prompt.split("\n")
        for line_index, line in enumerate(lines):
            text(c, line, margin + 52, y - 1 - line_index * 15, 10.2, "#3B312F", line_index == 0)
        y -= 60 if "\n" not in prompt else 72

    # Mode truth, balanced but subordinate to QR.
    mode_y = 112
    rounded_panel(c, margin, mode_y, W - 2 * margin, 116, 20)
    c.setStrokeColor(Color(0.80, 0.43, 0.35, alpha=0.18))
    c.line(W / 2, mode_y + 18, W / 2, mode_y + 98)
    text(c, "LIVE ADP", margin + 20, mode_y + 84, 8, "#2C8A58", True)
    text(c, "实时调用已发布应用", margin + 20, mode_y + 61, 10.5, "#332B29", True)
    text(c, "SSE、AgentName、Tool 与 Widget 均来自本次请求。", margin + 20, mode_y + 39, 7.2, "#75635E")
    text(c, "限流时不自动重试，也不伪装成功。", margin + 20, mode_y + 23, 7.2, "#75635E")

    text(c, "VERIFIED REPLAY", W / 2 + 20, mode_y + 84, 8, "#B34A37", True)
    text(c, "已核验实录回放", W / 2 + 20, mode_y + 61, 10.5, "#332B29", True)
    text(c, "来自真实成功 SSE / Agent / Tool / Widget 证据。", W / 2 + 20, mode_y + 39, 7.2, "#75635E")
    text(c, "页面显著标明非实时，不消耗 ADP 配额。", W / 2 + 20, mode_y + 23, 7.2, "#75635E")

    text(c, "匿名演示说明", margin, 78, 7.4, "#B34A37", True)
    text(c, "全部教师、课程、教室与数据版本均为匿名比赛演示数据；不含真实学校、个人身份或访问密钥。", margin, 61, 7.2, "#75635E")
    text(c, "校园智序·小序 —— 让教学时空，被理解、被核验、被安排。", margin, 32, 7.4, "#4D403D", True)
    text(c, "01 / 01", W - margin - 30, 32, 6.8, "#9A8984")

    c.showPage()
    c.save()


if __name__ == "__main__":
    build()
    print(OUTPUT)
