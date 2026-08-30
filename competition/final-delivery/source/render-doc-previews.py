# render-doc-previews.py — 用 PyMuPDF 把 PDF 渲染为 PNG 预览页（pdftoppm 不可用时的兜底）
# 用法: python render-doc-previews.py <input.pdf> <output_dir>
# 输出: page-01.png ... page-NN.png（按总页数补零，150 dpi，与 QA min>=1200px 兼容）
import os
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: render-doc-previews.py <input.pdf> <output_dir>", file=sys.stderr)
        return 2
    pdf_path = os.path.abspath(sys.argv[1])
    out_dir = os.path.abspath(sys.argv[2])
    if not os.path.isfile(pdf_path):
        print("pdf missing: " + pdf_path, file=sys.stderr)
        return 1
    os.makedirs(out_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    count = doc.page_count
    digits = max(2, len(str(count)))
    zoom = 150.0 / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    for index in range(count):
        page = doc.load_page(index)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        name = "page-" + str(index + 1).zfill(digits) + ".png"
        pix.save(os.path.join(out_dir, name))
    doc.close()
    print("PDF_PREVIEWS_OK pages=" + str(count) + " dpi=150 dir=" + out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
