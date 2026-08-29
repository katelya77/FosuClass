from __future__ import annotations

from pathlib import Path

from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.pdfgen import canvas
import subprocess


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "在线演示二维码.png"
URL = "https://adp.katelya.top/"


def build_qr() -> Path:
    output_size = 1200
    quiet_zone = 84
    widget = qr.QrCodeWidget(URL)
    x0, y0, x1, y1 = widget.getBounds()
    source_w = x1 - x0
    source_h = y1 - y0
    inner = output_size - quiet_zone * 2
    drawing = Drawing(
        output_size,
        output_size,
        transform=[inner / source_w, 0, 0, inner / source_h, quiet_zone, quiet_zone],
    )
    drawing.add(widget)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp_pdf = OUTPUT.with_suffix(".qr-source.pdf")
    pdf = canvas.Canvas(str(temp_pdf), pagesize=(output_size, output_size), pageCompression=1)
    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, output_size, output_size, fill=1, stroke=0)
    drawing.drawOn(pdf, 0, 0)
    pdf.showPage()
    pdf.save()
    subprocess.run(
        ["pdftoppm", "-png", "-singlefile", "-r", "72", str(temp_pdf), str(OUTPUT.with_suffix(""))],
        check=True,
    )
    temp_pdf.unlink(missing_ok=True)
    return OUTPUT


if __name__ == "__main__":
    print(build_qr())
