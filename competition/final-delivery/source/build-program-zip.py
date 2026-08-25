from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
PROGRAM = ROOT / "program"
OUTPUT = ROOT / "校园智序-小序-程序交付材料.zip"
TEMP = OUTPUT.with_suffix(".tmp")


def build() -> None:
    with ZipFile(TEMP, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(p for p in PROGRAM.rglob("*") if p.is_file()):
            archive.write(path, (Path("program") / path.relative_to(PROGRAM)).as_posix())
    TEMP.replace(OUTPUT)
    with ZipFile(OUTPUT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("program ZIP integrity failed")
    print(f"{OUTPUT.name}: {OUTPUT.stat().st_size} bytes")


if __name__ == "__main__":
    build()
