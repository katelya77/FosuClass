from __future__ import annotations

import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = next(
    path for path in (ROOT / "manual-exports").glob("*.zip")
    if "campustools" in path.name.lower()
)
TEMP = PLUGIN.with_suffix(".sanitized.tmp")
OLD = ("competition-demo-v" + "2.json").encode("ascii")
NEW = b"competition-demo-v3.json"


def run() -> None:
    replacements = 0
    with ZipFile(PLUGIN, "r") as source, ZipFile(TEMP, "w", ZIP_DEFLATED, compresslevel=9) as target:
        for info in source.infolist():
            payload = source.read(info)
            count = payload.count(OLD)
            if count:
                payload = payload.replace(OLD, NEW)
                replacements += count
            cloned = ZipInfo(info.filename, info.date_time)
            cloned.comment = info.comment
            cloned.extra = info.extra
            cloned.internal_attr = info.internal_attr
            cloned.external_attr = info.external_attr
            cloned.create_system = info.create_system
            cloned.compress_type = ZIP_DEFLATED
            target.writestr(cloned, payload)
    if replacements == 0:
        TEMP.unlink(missing_ok=True)
        with ZipFile(PLUGIN) as check:
            if OLD not in b"".join(check.read(info) for info in check.infolist() if not info.is_dir()):
                print(f"sanitized={PLUGIN.name}; replacements=0; already-current")
                return
    if replacements != 1:
        TEMP.unlink(missing_ok=True)
        raise RuntimeError(f"expected one stale data-version description, found {replacements}")
    os.replace(TEMP, PLUGIN)
    with ZipFile(PLUGIN) as check:
        if check.testzip() is not None:
            raise RuntimeError("sanitized CampusTools export failed ZIP integrity")
        content = check.read("campus_day_plan.yaml")
        if OLD in content or NEW not in content:
            raise RuntimeError("sanitized CampusTools export did not freeze v3 description")
    print(f"sanitized={PLUGIN.name}; replacements={replacements}")


if __name__ == "__main__":
    run()
