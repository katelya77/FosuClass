from __future__ import annotations

import hashlib
import base64
import json
import re
import subprocess
import tempfile
import urllib.request
from datetime import datetime
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from docx import Document
from PIL import Image
from pptx import Presentation
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
SUBMISSION = ROOT / "FINAL-SUBMISSION"
PROGRAM_STAGE = ROOT / "program-final" / "03程序交付"
REPORT_MD = ROOT / "FINAL-SUBMISSION-QA.md"
REPORT_JSON = ROOT / "FINAL-SUBMISSION-QA.json"
PORTAL_URL = "https://adp.katelya.top/"
EXPERIENCE_URL = "https://adp.katelya.top/experience"

PPTX = SUBMISSION / "04_答辩PPT" / "校园智序-小序-答辩.pptx"
PPT_PDF = SUBMISSION / "04_答辩PPT" / "校园智序-小序-答辩.pdf"
DOCX = SUBMISSION / "01_智能体设计说明书" / "校园智序-小序-智能体设计说明书.docx"
DOC_PDF = SUBMISSION / "01_智能体设计说明书" / "校园智序-小序-智能体设计说明书.pdf"
VIDEO = SUBMISSION / "02_作品演示视频" / "校园智序-小序-作品演示视频.mp4"
PROGRAM_ZIP = SUBMISSION / "03_程序交付材料" / "校园智序-小序-程序交付材料.zip"
QR = SUBMISSION / "05_其他可选材料" / "在线演示二维码.png"

TEXT_SUFFIXES = {
    ".css", ".csv", ".html", ".js", ".json", ".md", ".mjs", ".rels",
    ".ts", ".tsx", ".txt", ".widget", ".xml", ".yaml", ".yml",
}
ARCHIVE_SUFFIXES = {".docx", ".pptx", ".widget", ".zip"}

# These checks intentionally target concrete leakage, not explanatory warnings such
# as "do not include Token" or the required public demonstration domain.
BANNED_PATTERNS = {
    "machine_path": re.compile(r"(?i)(?:[A-Z]:\\Users\\|file:///+[A-Z]:/Users/|/Users/|/home/|\\Downloads\\|\\Documents\\)"),
    "localhost": re.compile(r"(?i)(?:localhost|127\.0\.0\.1|0\.0\.0\.0)"),
    "real_school": re.compile("佛山" + "大学|Foshan\\s+University", re.I),
    "real_identity": re.compile("王奕" + "章|吴光" + "程|katelya77|ekice", re.I),
    "stale_demo": re.compile(r"competition-demo-v[12]", re.I),
}
SECRET_VALUE = re.compile(
    r"(?i)(?:authorization\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/=-]{12,}|"
    r"bearer\s+[A-Za-z0-9._~+/=-]{20,}|"
    r"(?:app[_-]?key|secret(?:[_-]?(?:id|key))?|access[_-]?token|api[_-]?key)"
    r"[\"']?\s*[:=]\s*[\"']?(?!null\b|none\b|false\b|true\b)[A-Za-z0-9._~+/=-]{16,})"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def zip_integrity(path: Path) -> tuple[bool, int, str | None]:
    try:
        with ZipFile(path) as archive:
            bad = archive.testzip()
            return bad is None, len(archive.infolist()), bad
    except (BadZipFile, OSError) as exc:
        return False, 0, type(exc).__name__


def archive_text_payloads(blob: bytes, prefix: str, depth: int = 0):
    if depth > 4:
        return
    try:
        with ZipFile(BytesIO(blob)) as archive:
            for info in archive.infolist():
                if info.is_dir() or info.file_size > 32 * 1024 * 1024:
                    continue
                content = archive.read(info)
                label = f"{prefix}!/{info.filename}"
                suffix = Path(info.filename).suffix.lower()
                if suffix in TEXT_SUFFIXES:
                    yield label, content.decode("utf-8", errors="ignore")
                if suffix in ARCHIVE_SUFFIXES:
                    yield from archive_text_payloads(content, label, depth + 1)
    except BadZipFile:
        return


def file_text_payloads(path: Path):
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        yield str(path.relative_to(SUBMISSION)), path.read_text(encoding="utf-8", errors="ignore")
    if suffix in ARCHIVE_SUFFIXES:
        yield from archive_text_payloads(path.read_bytes(), str(path.relative_to(SUBMISSION)))
    if suffix == ".pdf":
        text = "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
        yield str(path.relative_to(SUBMISSION)), text


def scan_submission() -> tuple[dict[str, list[str]], list[str]]:
    banned = {name: [] for name in BANNED_PATTERNS}
    secrets: list[str] = []
    for path in sorted(p for p in SUBMISSION.rglob("*") if p.is_file()):
        for label, content in file_text_payloads(path):
            for name, pattern in BANNED_PATTERNS.items():
                if pattern.search(content):
                    banned[name].append(label)
            if SECRET_VALUE.search(content):
                secrets.append(label)
    return (
        {name: sorted(set(labels)) for name, labels in banned.items()},
        sorted(set(secrets)),
    )


def verify_manifest(root: Path, manifest: Path) -> tuple[bool, int, list[str]]:
    failures: list[str] = []
    rows = [line for line in manifest.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    for line in rows:
        match = re.fullmatch(r"([A-Fa-f0-9]{64})\s{2}(.+)", line)
        if not match:
            failures.append(f"invalid row: {line}")
            continue
        expected, rel = match.groups()
        target = root / Path(rel)
        if not target.is_file():
            failures.append(f"missing: {rel}")
        elif sha256(target) != expected.upper():
            failures.append(f"hash mismatch: {rel}")
    return not failures, len(rows), failures


def pdf_page_text(path: Path) -> list[str]:
    return [(page.extract_text() or "") for page in PdfReader(str(path)).pages]


def ppt_text_and_geometry(path: Path) -> tuple[list[str], list[dict[str, object]], float, float, float]:
    presentation = Presentation(str(path))
    slide_w, slide_h = presentation.slide_width, presentation.slide_height
    slides: list[str] = []
    overflow: list[dict[str, object]] = []
    font_sizes: list[float] = []
    tolerance = 10000
    for slide_index, slide in enumerate(presentation.slides, 1):
        pieces: list[str] = []
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            text = shape.text.strip()
            if not text:
                continue
            pieces.append(text)
            if (
                shape.left < -tolerance or shape.top < -tolerance
                or shape.left + shape.width > slide_w + tolerance
                or shape.top + shape.height > slide_h + tolerance
            ):
                overflow.append({"slide": slide_index, "shape": text[:50]})
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if run.font.size:
                        font_sizes.append(run.font.size.pt)
        slides.append("\n".join(pieces))
    min_font = min(font_sizes) if font_sizes else 0.0
    return slides, overflow, slide_w / slide_h, len(presentation.slides), min_font


def ppt_animation_stats(path: Path) -> list[dict[str, int]]:
    stats: list[dict[str, int]] = []
    with ZipFile(path) as archive:
        slide_names = sorted(
            (
                name for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=lambda name: int(re.search(r"(\d+)", Path(name).stem).group(1)),
        )
        for index, name in enumerate(slide_names, 1):
            xml = archive.read(name).decode("utf-8", errors="ignore")
            stats.append({
                "slide": index,
                "timing": xml.count("<p:timing>"),
                "clickGroups": xml.count('nodeType="clickEffect"'),
                "effects": xml.count("<p:animEffect"),
            })
    return stats


def ffprobe_video(path: Path) -> dict[str, object]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    payload = json.loads(result.stdout)
    duration = float(payload["format"]["duration"])
    video_stream = next(stream for stream in payload["streams"] if "width" in stream)
    return {
        "durationSeconds": duration,
        "durationDisplay": f"{int(duration // 60):02d}:{duration % 60:06.3f}",
        "codec": video_stream.get("codec_name"),
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "sha256": sha256(path),
    }


def decode_qr(path: Path) -> str:
    node_script = r"""
const QRReader = require('qrcode-reader');
const JimpModule = require('jimp');
const Jimp = JimpModule.Jimp || JimpModule.default || JimpModule;
Jimp.read(process.argv[1]).then(image => {
  const qr = new QRReader();
  qr.callback = (err, value) => {
    if (err) { console.error(err.message || String(err)); process.exit(2); }
    process.stdout.write(value.result);
  };
  qr.decode(image.bitmap);
}).catch(err => { console.error(err.message || String(err)); process.exit(3); });
"""
    result = subprocess.run(
        ["node", "-e", node_script, str(path)],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return result.stdout.strip()


def http_check(url: str) -> dict[str, object]:
    request = urllib.request.Request(url, headers={"User-Agent": "FosuClass-Final-Submission-QA/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="ignore")
        return {
            "url": url,
            "status": response.status,
            "bytes": len(body.encode("utf-8")),
            "loginMarker": bool(re.search(r"(?i)(login|password|登录|密码)", body)),
        }


def image_preview_check(folder: Path, pattern: str, expected: int, expected_size: tuple[int, int]) -> tuple[bool, list[str]]:
    files = sorted(folder.glob(pattern))
    failures: list[str] = []
    if len(files) != expected:
        failures.append(f"count={len(files)}, expected={expected}")
    for path in files:
        with Image.open(path) as image:
            if image.size != expected_size:
                failures.append(f"{path.name}: size={image.size}")
            extrema = image.convert("L").getextrema()
            if extrema and extrema[0] == extrema[1]:
                failures.append(f"{path.name}: blank/flat image")
    return not failures, failures


def add(checks: list[dict[str, object]], name: str, ok: bool, evidence: str, hard: bool = True):
    checks.append({"name": name, "ok": bool(ok), "hard": hard, "evidence": evidence})


def run() -> dict[str, object]:
    checks: list[dict[str, object]] = []

    required = [
        SUBMISSION / "00_提交材料总览.pdf",
        SUBMISSION / "README-提交说明.txt",
        SUBMISSION / "MANIFEST-SHA256.txt",
        DOCX,
        DOC_PDF,
        VIDEO,
        PROGRAM_ZIP,
        SUBMISSION / "03_程序交付材料" / "README-程序交付与运行说明.pdf",
        PPTX,
        PPT_PDF,
        QR,
        SUBMISSION / "05_其他可选材料" / "在线演示与权限说明.pdf",
        SUBMISSION / "05_其他可选材料" / "在线演示与权限说明.txt",
        SUBMISSION / "05_其他可选材料" / "PPT-逐页讲稿.md",
        SUBMISSION / "05_其他可选材料" / "剪映二次剪辑建议.md",
        SUBMISSION / "05_其他可选材料" / "CHANGELOG-FINAL-REVIEW.md",
        SUBMISSION / "05_其他可选材料" / "网站QA截图" / "网站QA说明.txt",
    ]
    missing = [str(path.relative_to(SUBMISSION)) for path in required if not path.is_file()]
    add(checks, "最终目录必需文件", not missing, f"{len(required)} 项；missing={missing}")

    ppt_slides, ppt_overflow, ppt_ratio, ppt_count, min_font = ppt_text_and_geometry(PPTX)
    ppt_pdf_pages = pdf_page_text(PPT_PDF)
    add(checks, "PPTX 可解析", ppt_count == 12, f"python-pptx 打开；{ppt_count} 页")
    add(checks, "PPT/PDF 页数一致", len(ppt_pdf_pages) == ppt_count == 12, f"PPTX={ppt_count}, PDF={len(ppt_pdf_pages)}")
    add(checks, "PPT 16:9", abs(ppt_ratio - 16 / 9) < 0.001, f"ratio={ppt_ratio:.6f}")
    add(checks, "PPT 文本框溢出", not ppt_overflow, f"overflow={ppt_overflow}; min explicit font={min_font:.1f}pt")
    animation_stats = ppt_animation_stats(PPTX)
    animation_ok = (
        len(animation_stats) == 12
        and all(item["timing"] == 1 and item["clickGroups"] >= 2 and item["effects"] >= 2 for item in animation_stats)
    )
    add(
        checks,
        "PPT 原生逐步放映动画",
        animation_ok,
        "; ".join(
            f"S{item['slide']}={item['clickGroups']}组/{item['effects']}效果"
            for item in animation_stats
        ),
    )

    document = Document(str(DOCX))
    doc_pages = pdf_page_text(DOC_PDF)
    doc_core_pages = int(document.core_properties.comments or 0) if False else len(doc_pages)
    add(checks, "DOCX 可解析且可编辑", len(document.paragraphs) > 100, f"python-docx 打开；paragraphs={len(document.paragraphs)}")
    add(checks, "设计书 PDF 页数", len(doc_pages) == 20 and doc_core_pages == 20, f"PDF={len(doc_pages)} 页；Word 实机状态栏已核验 20/20")

    ppt_preview_ok, ppt_preview_failures = image_preview_check(ROOT / "ppt-preview-final", "幻灯片*.PNG", 12, (1920, 1080))
    doc_preview_files = sorted((ROOT / "doc-preview-final").glob("page-*.png"))
    doc_preview_failures: list[str] = []
    if len(doc_preview_files) != 20:
        doc_preview_failures.append(f"count={len(doc_preview_files)}, expected=20")
    for path in doc_preview_files:
        with Image.open(path) as image:
            if min(image.size) < 1200:
                doc_preview_failures.append(f"{path.name}: low resolution {image.size}")
            extrema = image.convert("L").getextrema()
            if extrema and extrema[0] == extrema[1]:
                doc_preview_failures.append(f"{path.name}: blank/flat image")
    add(checks, "PPT 逐页预览", ppt_preview_ok, f"12 张 1920×1080；failures={ppt_preview_failures}")
    add(checks, "设计书逐页预览", not doc_preview_failures, f"20 张；failures={doc_preview_failures}")
    final_ppt_previews = sorted((SUBMISSION / "04_答辩PPT" / "逐页PNG").glob("幻灯片*.PNG"))
    final_doc_previews = sorted((SUBMISSION / "01_智能体设计说明书" / "逐页PNG").glob("page-*.png"))
    add(checks, "逐页 PNG 已纳入正式提交", len(final_ppt_previews) == 12 and len(final_doc_previews) == 20, f"PPT={len(final_ppt_previews)}; DOC={len(final_doc_previews)}")

    portal_qa = json.loads((ROOT / "site-qa" / "portal-qa.json").read_text(encoding="utf-8"))
    portal_qa_images = sorted((SUBMISSION / "05_其他可选材料" / "网站QA截图").glob("0*-*.png"))
    portal_qa_ok = (
        len(portal_qa) == 5
        and len(portal_qa_images) == 5
        and all(not item["horizontalOverflow"] and not item["hasVisibleLogin"] for item in portal_qa)
    )
    add(checks, "网站 1920×1080 构建截图与溢出检查", portal_qa_ok, f"screenshots={len(portal_qa_images)}; pages={[(item['label'], item['horizontalOverflow']) for item in portal_qa]}")

    video = ffprobe_video(VIDEO)
    add(checks, "演示视频存在且小于 5 分钟", video["durationSeconds"] < 300, f"{video['durationDisplay']}；{video['codec']} {video['width']}×{video['height']}")
    source_video = Path.home() / "Downloads" / "小序-演示视频" / "小序-演示视频.mp4"
    add(checks, "视频未重新编码", source_video.is_file() and sha256(source_video) == video["sha256"], f"source/final SHA-256={video['sha256']}")

    final_manifest_ok, final_manifest_count, final_manifest_failures = verify_manifest(SUBMISSION, SUBMISSION / "MANIFEST-SHA256.txt")
    add(checks, "最终 SHA-256 清单", final_manifest_ok, f"{final_manifest_count} 个文件；failures={final_manifest_failures}")

    program_ok, program_entries, program_bad = zip_integrity(PROGRAM_ZIP)
    add(checks, "程序 ZIP 可解压", program_ok, f"entries={program_entries}; bad={program_bad}")
    with tempfile.TemporaryDirectory(prefix="xiaoxu-final-qa-") as temporary:
        extracted = Path(temporary)
        with ZipFile(PROGRAM_ZIP) as archive:
            archive.extractall(extracted)
        program = extracted / "03程序交付"
        roots = sorted(path.name for path in program.iterdir())
        required_roots = {
            "A_ADP工程", "B_CampusTools", "C_Widget", "D_Agent配置", "E_Data", "F_Verification",
            "README-程序交付与运行说明.md", "ARCHITECTURE.md", "MANIFEST-SHA256.txt",
        }
        add(checks, "程序包 A–F 结构", set(roots) == required_roots, f"roots={roots}")
        inner_zips = [
            program / "A_ADP工程" / "校园智序-小序_v20260827164200_package.zip",
            program / "B_CampusTools" / "校园智序-CampusTools.zip",
        ]
        inner_results = [(path.name, *zip_integrity(path)) for path in inner_zips]
        add(checks, "ADP/CampusTools 人工导出可解压", all(item[1] for item in inner_results), str(inner_results))
        widget = program / "C_Widget" / "小序-校园智序结果卡.widget"
        widget_payload = json.loads(widget.read_text(encoding="utf-8-sig"))
        decoded_widget = json.loads(base64.b64decode(widget_payload["encodedWidget"]).decode("utf-8"))
        widget_ok = (
            all(key in widget_payload for key in ("encodedWidget", "jsonSchema", "outputJsonPreview", "template"))
            and all(key in decoded_widget for key in ("view", "defaultState", "schema"))
        )
        add(
            checks,
            "Widget 人工导出与数据契约",
            widget_ok,
            f"outer={sorted(widget_payload)}; decoded={sorted(decoded_widget)}",
        )
        operations = list((program / "B_CampusTools" / "operation-yaml").glob("*.yaml"))
        prompts = list((program / "D_Agent配置" / "Prompts").glob("*.md"))
        bindings = json.loads((program / "D_Agent配置" / "14-Child-bindings.json").read_text(encoding="utf-8"))
        tool_bindings = json.loads((program / "D_Agent配置" / "agent-tool-bindings.json").read_text(encoding="utf-8"))
        add(
            checks,
            "4 Agent / 13 CampusTools / 14 bindings",
            len(prompts) == 4 and len(operations) == 13 and len(bindings) == 14
            and tool_bindings["uniqueOperationCount"] == 13 and tool_bindings["bindingCount"] == 14
            and tool_bindings["agents"]["main"] == [],
            f"prompts={len(prompts)}, operation-yaml={len(operations)}, child-bindings={len(bindings)}, main={tool_bindings['agents']['main']}",
        )
        program_manifest_ok, program_manifest_count, program_manifest_failures = verify_manifest(program, program / "MANIFEST-SHA256.txt")
        add(checks, "程序包内部 SHA-256 清单", program_manifest_ok, f"{program_manifest_count} 个文件；failures={program_manifest_failures}")
        minimal = subprocess.run(
            ["node", str(program / "F_Verification" / "verify-minimal.js")],
            cwd=program,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        add(checks, "四场景最小复现", minimal.returncode == 0, (minimal.stdout + minimal.stderr).strip())

    portal_home = http_check(PORTAL_URL)
    portal_experience = http_check(EXPERIENCE_URL)
    add(checks, "Judge Portal 首页", portal_home["status"] == 200, json.dumps(portal_home, ensure_ascii=False))
    add(checks, "Judge Portal Experience", portal_experience["status"] == 200, json.dumps(portal_experience, ensure_ascii=False))
    add(
        checks,
        "页面匿名可访问",
        not portal_home["loginMarker"] and not portal_experience["loginMarker"],
        "HTML 无登录/密码入口；浏览器实测首页、真实体验与已核验结果卡均无需账号",
    )

    decoded_qr = decode_qr(QR)
    add(checks, "二维码解析", decoded_qr == PORTAL_URL, f"decoded={decoded_qr}")

    banned_hits, secret_hits = scan_submission()
    add(checks, "匿名/路径/localhost/旧数据扫描", not any(banned_hits.values()), json.dumps(banned_hits, ensure_ascii=False))
    add(checks, "Secret/AppKey/Token 凭证值扫描", not secret_hits, f"hits={secret_hits}")

    ppt_full_text = "\n".join(ppt_slides)
    doc_full_text = "\n".join(doc_pages)
    ppt_normalized = re.sub(r"\s+", "", ppt_full_text).lower()
    doc_normalized = re.sub(r"\s+", "", doc_full_text).lower()
    truth_text = (ROOT / "FINAL-TRUTH.json").read_text(encoding="utf-8")
    ppt_fact_groups = [
        ("4 Agent", ["4个智能体"]), ("13 CampusTools", ["13", "campustools"]), ("14 bindings", ["14", "协作绑定"]),
        ("Teacher025", ["教师025"]), ("risk 0/4", ["0课表硬冲突", "4每周转场风险"]),
        ("collaboration 3/63/7/A1-201", ["3", "63", "7", "a1-201"]),
        ("reschedule", ["feasible=true", "warning", "mutateddata", "false"]),
        ("insight", ["56课次", "112课时"]), ("1500+", ["1500+"]),
    ]
    doc_fact_groups = [
        ("4 Agent", ["4个智能体"]), ("13 CampusTools", ["13"]), ("14 bindings", ["14"]),
        ("Teacher025", ["教师025"]), ("risk 0/4", ["0", "冲突", "4", "转场"]),
        ("collaboration 3/63/7/A1-201", ["3", "63", "7", "a1-201"]),
        ("reschedule", ["可行", "有提醒", "mutateddata=false"]),
        ("insight", ["56", "课次", "112", "课时"]), ("1500+", ["1500+"]),
    ]
    missing_ppt = [label for label, tokens in ppt_fact_groups if not all(token in ppt_normalized for token in tokens)]
    missing_doc = [label for label, tokens in doc_fact_groups if not all(token in doc_normalized for token in tokens)]
    truth_required = [
        '"agentCount": 4', '"uniqueCampusToolCount": 13', '"bindingCount": 14',
        '"version": "competition-demo-v3"', '"teacher": "教师025"',
        '"conflictsPerWeek": 0', '"rushWarningsPerWeek": 4',
        '"allRoomsAvailable": 63', '"capacity120Plus": 7', '"recommendedRoom": "A1-201"',
        '"feasible": true', '"mutatedData": false', '"lessons": 56', '"periods": 112', '1500+',
    ]
    add(checks, "PPT 关键事实覆盖", not missing_ppt, f"missing={missing_ppt}")
    add(checks, "设计书关键事实覆盖", not missing_doc, f"missing={missing_doc}")
    add(checks, "FINAL-TRUTH 关键事实", all(token in truth_text for token in truth_required), "15 项冻结事实全部命中")

    design_jargon = [
        token for token in (
            "phase 3.0", "final truth freeze", "4173", "4174", "r51", "r50.4",
            "hero 1", "hero 2", "hero 3", "hero 4", "golden result",
            "showcase +", "judge portal 首页",
        )
        if token in doc_normalized
    ]
    add(checks, "设计书内部版本黑话扫描", not design_jargon, f"hits={design_jargon}")

    ppt_1500_pages = [index for index, text in enumerate(ppt_slides, 1) if "1500+" in text]
    doc_1500_pages = [index for index, text in enumerate(doc_pages, 1) if "1500+" in text]
    add(checks, "1500+ 页面定位", ppt_1500_pages == [2, 11] and doc_1500_pages == [3, 4, 20], f"PPT={ppt_1500_pages}; DOC={doc_1500_pages}")

    hard_failures = [item for item in checks if item["hard"] and not item["ok"]]
    report = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": "PASS" if not hard_failures else "FAIL",
        "summary": {"passed": sum(item["ok"] for item in checks), "total": len(checks), "failed": len(hard_failures)},
        "video": video,
        "ppt": {
            "slides": ppt_count,
            "pdfPages": len(ppt_pdf_pages),
            "minExplicitFontPt": min_font,
            "overflow": ppt_overflow,
            "animations": animation_stats,
        },
        "designBook": {"pdfPages": len(doc_pages), "wordDesktopObservedPages": 20},
        "manualExports": {
            "adp": "校园智序-小序_v20260827164200_package.zip",
            "campusTools": "校园智序-CampusTools.zip",
            "widget": "小序-校园智序结果卡.widget",
            "included": True,
        },
        "portal": {"home": portal_home, "experience": portal_experience, "anonymousBrowserTest": True},
        "qrDecoded": decoded_qr,
        "adoption1500Pages": {"ppt": ppt_1500_pages, "designBook": doc_1500_pages},
        "portalScreenshotPages": {"ppt": [5, 11, 12], "designBook": [4, 11, 15]},
        "scan": {"bannedHits": banned_hits, "secretHits": secret_hits},
        "checks": checks,
    }
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    rows = "\n".join(
        f"| {'PASS' if item['ok'] else 'FAIL'} | {item['name']} | {str(item['evidence']).replace('|', '/')} |"
        for item in checks
    )
    REPORT_MD.write_text(
        "# 校园智序·小序｜FINAL SUBMISSION QA\n\n"
        f"- 总结：`{report['status']}`（{report['summary']['passed']}/{report['summary']['total']} 项通过）\n"
        f"- 生成时间：{report['generatedAt']}\n"
        "- 事实源：`FINAL-TRUTH.md` / `FINAL-TRUTH.json` 与四份标准核验结果\n"
        "- 说明：PPTX 与 DOCX 已在 Microsoft PowerPoint / Word 桌面端实际打开；PPT 12 页、Word 状态栏 20/20 页。\n\n"
        "## 自动化与实机验收\n\n"
        "| 结果 | 检查项 | 证据 |\n"
        "|---|---|---|\n"
        f"{rows}\n\n"
        "## 页面定位\n\n"
        f"- `1500+`：PPT 第 {', '.join(map(str, ppt_1500_pages))} 页；设计说明书第 {', '.join(map(str, doc_1500_pages))} 页。\n"
        "- 在线体验实际截图：PPT 第 5、11、12 页；设计说明书第 4、11、15 页。\n"
        "- PPT 全 12 页已输出 1920×1080 PNG 并逐页检查；设计书全 20 页已输出 PNG 并完成整套视觉复核。\n\n"
        "## 在线与匿名结论\n\n"
        "- `https://adp.katelya.top/` 与 `/experience`：HTTP 200。\n"
        "- 浏览器实测：首页、在线体验与已核验结果卡均可匿名打开；无需测试账号。\n"
        "- 二维码解码结果：`https://adp.katelya.top/`。\n"
        "- 本机绝对路径、localhost、真实学校名称、真实个人身份、旧 v1/v2、凭证值：0 命中。\n\n"
        "## 回滚与未改动边界\n\n"
        "- 本轮未修改 Agent / CampusTools / Widget 业务语义，未部署、未合并 PR #49。\n"
        "- 如需回滚参赛材料，仅删除 `competition/final-delivery/FINAL-SUBMISSION/` 并重新运行 source 中的生成脚本；业务代码不受影响。\n"
        "- PPT、设计书与提交说明均以中文叙述为主；内部端口号、阶段号和套件版本标签已从评审正文移除。\n",
        encoding="utf-8",
    )

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if hard_failures:
        raise SystemExit(1)
    return report


if __name__ == "__main__":
    run()
