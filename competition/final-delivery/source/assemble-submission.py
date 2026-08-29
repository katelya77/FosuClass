from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "manual-exports"
OUT = ROOT / "submission"
FINAL_ZIP = ROOT / "校园智序-小序-正式提交材料.zip"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def unique(candidates: list[Path], label: str) -> Path:
    if len(candidates) != 1:
        raise RuntimeError(f"{label}: expected exactly one export, found {len(candidates)}")
    return candidates[0]


def collect_manual_exports() -> tuple[Path, Path, Path]:
    files = [p for p in MANUAL.iterdir() if p.is_file() and p.name.lower() != "readme.md"]
    widget = unique([p for p in files if p.suffix.lower() == ".widget"], "Widget")
    plugin = unique([p for p in files if p.suffix.lower() == ".zip" and "campustools" in p.name.lower()], "CampusTools")
    app = unique([p for p in files if p.suffix.lower() == ".zip" and p != plugin], "ADP app")
    return app, plugin, widget


def build() -> dict[str, object]:
    app_export, plugin_export, widget_export = collect_manual_exports()
    dirs = {
        "design": OUT / "01设计说明书",
        "video": OUT / "02演示视频",
        "program": OUT / "03程序交付",
        "deck": OUT / "04答辩PPT",
        "online": OUT / "05在线演示",
    }
    for directory in dirs.values():
        directory.mkdir(parents=True, exist_ok=True)

    copy(ROOT / "校园智序-小序-智能体设计说明书.docx", dirs["design"] / "校园智序-小序-智能体设计说明书.docx")
    copy(ROOT / "校园智序-小序-智能体设计说明书.pdf", dirs["design"] / "校园智序-小序-智能体设计说明书.pdf")

    copy(ROOT / "校园智序-小序-程序交付材料.zip", dirs["program"] / "校园智序-小序-程序交付材料.zip")
    copy(app_export, dirs["program"] / "01-ADP应用导出.zip")
    copy(plugin_export, dirs["program"] / "02-CampusTools自定义插件导出.zip")
    copy(widget_export, dirs["program"] / "03-最终Widget导出.widget")
    copy(ROOT / "program" / "README-RUN.md", dirs["program"] / "README-RUN.md")
    copy(ROOT / "program" / "ARCHITECTURE.md", dirs["program"] / "ARCHITECTURE.md")
    (dirs["program"] / "README-IMPORT.md").write_text(
        "# 控制台导入说明\n\n"
        "提交包中的 ADP 应用导出已执行安全清理：私密运行变量与真实 API 地址不随包分发，"
        "旧品牌与旧演示数据版本说明已冻结为当前对外品牌和 v3。导入后请在腾讯 ADP Console "
        "通过私密变量重新配置 CampusTools 访问地址与凭据；不要写入前端、截图、文档或 Git。\n",
        encoding="utf-8",
    )

    copy(ROOT / "校园智序-小序-答辩.pptx", dirs["deck"] / "校园智序-小序-答辩.pptx")
    copy(ROOT / "校园智序-小序-答辩.pdf", dirs["deck"] / "校园智序-小序-答辩.pdf")

    copy(ROOT / "ONLINE-DEMO-GUIDE.pdf", dirs["online"] / "ONLINE-DEMO-GUIDE.pdf")
    (dirs["online"] / "ONLINE-ENTRY.txt").write_text(
        "校园智序·小序｜在线演示\nhttps://adp.katelya.top/\n\n"
        "Live ADP：实时 HTTPS SSE 请求。\n"
        "Verified Replay：已核验实录回放，显著标明非实时。\n",
        encoding="utf-8",
    )

    video_sources = [
        p for p in [
            ROOT / "校园智序-小序-演示视频.mp4",
            ROOT / "FINAL-DEMO.mp4",
            MANUAL / "校园智序-小序-演示视频.mp4",
        ] if p.exists()
    ]
    target_video = dirs["video"] / "校园智序-小序-演示视频.mp4"
    placeholder = dirs["video"] / "README-待录制.md"
    if video_sources:
        copy(video_sources[0], target_video)
        if placeholder.exists():
            placeholder.unlink()
        complete = True
    else:
        if target_video.exists():
            target_video.unlink()
        placeholder.write_text(
            "# 待人工加入最终演示视频\n\n"
            "请按上级目录 `RECORDING-CHECKLIST.md` 完成 04:35 成片，命名为"
            " `校园智序-小序-演示视频.mp4` 并放入 `competition/final-delivery/`，"
            "随后重新运行 `source/assemble-submission.py`。脚本在缺少成片时不会生成正式提交 ZIP。\n",
            encoding="utf-8",
        )
        complete = False

    tracked_files = sorted(
        p for p in OUT.rglob("*")
        if p.is_file() and p.name not in {"SHA256SUMS.txt", "SUBMISSION-MANIFEST.json"}
    )
    records = [
        {"path": p.relative_to(OUT).as_posix(), "size": p.stat().st_size, "sha256": sha256(p)}
        for p in tracked_files
    ]
    status = "READY" if complete else "PENDING_FINAL_VIDEO"
    manifest = {
        "brand": "校园智序·小序",
        "status": status,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "fileCount": len(records),
        "files": records,
    }
    (OUT / "SUBMISSION-MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUT / "SHA256SUMS.txt").write_text(
        "".join(f"{item['sha256']}  {item['path']}\n" for item in records), encoding="utf-8"
    )

    if complete:
        with ZipFile(FINAL_ZIP, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(p for p in OUT.rglob("*") if p.is_file()):
                archive.write(path, (Path("校园智序-小序-正式提交材料") / path.relative_to(OUT)).as_posix())
        manifest["finalZip"] = {"path": FINAL_ZIP.name, "size": FINAL_ZIP.stat().st_size, "sha256": sha256(FINAL_ZIP)}
    elif FINAL_ZIP.exists():
        FINAL_ZIP.unlink()

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


if __name__ == "__main__":
    build()
