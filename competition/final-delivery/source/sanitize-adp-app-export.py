from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
APP_EXPORT = next(
    path for path in (ROOT / "manual-exports").glob("*.zip")
    if "campustools" not in path.name.lower()
)
TEMP = APP_EXPORT.with_suffix(".sanitized.tmp")
FINAL_BRAND = "校园智序·小序"
LEGACY_REPOSITORY_BRAND = "Fosu" + "Class"
STALE_V1 = "competition-demo-v" + "1"
STALE_V2 = "competition-demo-v" + "2"
PRIVATE_VARIABLES = {"campus_api_base_url", "campus_api_authorization", "campus_api_token"}


def clone_info(info: ZipInfo) -> ZipInfo:
    cloned = ZipInfo(info.filename, info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.internal_attr = info.internal_attr
    cloned.external_attr = info.external_attr
    cloned.create_system = info.create_system
    cloned.compress_type = ZIP_DEFLATED
    return cloned


def rewrite_zip(blob: bytes, transform, depth: int = 0) -> bytes:
    source_buffer = BytesIO(blob)
    target_buffer = BytesIO()
    with ZipFile(source_buffer, "r") as source, ZipFile(target_buffer, "w", ZIP_DEFLATED, compresslevel=9) as target:
        for info in source.infolist():
            payload = source.read(info)
            suffix = Path(info.filename).suffix.lower()
            if suffix == ".zip" and depth < 4:
                payload = rewrite_zip(payload, transform, depth + 1)
            else:
                payload = transform(info.filename, payload)
            target.writestr(clone_info(info), payload)
    return target_buffer.getvalue()


def transform(name: str, payload: bytes) -> bytes:
    lower = name.lower()
    text_like = Path(name).suffix.lower() in {".json", ".jsonl", ".md", ".txt", ".yaml", ".yml", ".xml"}
    if not text_like:
        return payload
    text = payload.decode("utf-8", errors="strict")
    text = text.replace(STALE_V1, "competition-demo-v3")
    text = text.replace(STALE_V2, "competition-demo-v3")
    text = text.replace(LEGACY_REPOSITORY_BRAND, FINAL_BRAND)
    if lower.endswith("app/app_config/app_variable.json"):
        data = json.loads(text)
        for variable in data.get("Variables", []):
            name_value = variable.get("VarName")
            if name_value in PRIVATE_VARIABLES:
                variable["VarDefaultValue"] = ""
                variable["VarDefaultFileName"] = ""
            if name_value == "data_version":
                variable["VarDefaultValue"] = "competition-demo-v3"
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    return text.encode("utf-8")


def run() -> None:
    original = APP_EXPORT.read_bytes()
    sanitized = rewrite_zip(original, transform)
    TEMP.write_bytes(sanitized)
    os.replace(TEMP, APP_EXPORT)
    with ZipFile(APP_EXPORT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("sanitized ADP app export failed ZIP integrity")

    # Re-open nested app variables and assert that the three private defaults
    # are empty without printing or logging their former values.
    with ZipFile(APP_EXPORT) as outer:
        app_name = next(name for name in outer.namelist() if name.endswith("/app.zip"))
        with ZipFile(BytesIO(outer.read(app_name))) as app:
            variables = json.loads(app.read("app/app_config/app_variable.json"))
            by_name = {item.get("VarName"): item for item in variables.get("Variables", [])}
            if any(by_name[name].get("VarDefaultValue") for name in PRIVATE_VARIABLES):
                raise RuntimeError("private ADP application defaults were not scrubbed")
            if by_name["data_version"].get("VarDefaultValue") != "competition-demo-v3":
                raise RuntimeError("ADP application data version is not v3")
    print(f"sanitized={APP_EXPORT.name}; private-defaults=3; data-version=v3; brand={FINAL_BRAND}")


if __name__ == "__main__":
    run()
