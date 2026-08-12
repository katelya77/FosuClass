#!/usr/bin/env python3
"""Derive auditable Widget contracts from the six real Tencent exports."""

import argparse
import base64
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CATALOG_PATH = ROOT / "real-adp-export-catalog.json"
CONTRACT_ROOT = ROOT / "contracts"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def locate(downloads, record):
    expected = record["sha256"]
    direct = downloads / record["file"]
    candidates = [direct] if direct.is_file() else []
    candidates.extend(path for path in downloads.glob("*.widget") if path not in candidates)
    for path in candidates:
        if hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            return path
    raise AssertionError(f"real Widget export missing or hash drift: {record['name']}")


def derive(downloads):
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    derived = {}
    registry = {
        "schema": "fosuclass-campus-widget-registry/v1",
        "source": "real Tencent ADP .widget exports",
        "dataVersion": "competition-demo-v1",
        "widgets": {},
    }
    for kind, record in catalog["widgets"].items():
        path = locate(downloads, record)
        outer = json.loads(path.read_text(encoding="utf-8"))
        inner = json.loads(base64.b64decode(outer["encodedWidget"]))
        assert inner["id"] == record["widgetId"]
        assert inner["name"] == record["name"]
        schema = outer["jsonSchema"]
        assert isinstance(schema, dict) and schema.get("type") == "object"
        inner_schema = inner.get("schema", "")
        if str(inner_schema).lstrip().startswith("{"):
            assert json.loads(inner_schema) == schema
            schema_language = "json-schema"
        else:
            assert kind == "Schedule" and "z" in inner_schema and ".object" in inner_schema
            schema_language = "zod+exported-json-schema"
        slug = kind.lower()
        files = {
            CONTRACT_ROOT / slug / "schema.json": canonical(schema),
            CONTRACT_ROOT / slug / "default.json": canonical(inner["defaultState"]),
            CONTRACT_ROOT / slug / "template.txt": str(outer.get("template", "")).rstrip() + "\n",
            CONTRACT_ROOT / slug / "view.txt": str(inner.get("view", "")).rstrip() + "\n",
        }
        if kind == "Schedule":
            files[CONTRACT_ROOT / slug / "zod.txt"] = str(inner_schema).rstrip() + "\n"
        contract = {
            "schema": "fosuclass-adp-widget-contract/v3",
            "kind": slug,
            "widgetId": record["widgetId"],
            "widgetName": record["name"],
            "sourceFile": record["file"],
            "sourceSha256": record["sha256"],
            "schemaLanguage": schema_language,
            "required": schema.get("required", []),
            "integration": record["integration"],
        }
        files[CONTRACT_ROOT / slug / "contract.json"] = canonical(contract)
        derived.update(files)
        registry["widgets"][kind] = {
            "name": record["name"], "widgetId": record["widgetId"],
            "sourceSha256": record["sha256"], "contract": f"contracts/{slug}/contract.json",
            "integration": record["integration"],
        }
    derived[ROOT / "widget-registry.json"] = canonical(registry)
    return derived


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", default=str(Path.home() / "Downloads"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    derived = derive(Path(args.downloads))
    for path, content in derived.items():
        if args.check:
            assert path.is_file() and path.read_text(encoding="utf-8") == content, f"contract drift: {path}"
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print(f"Real Widget Contract extraction: PASS ({len(derived)} files, 6 verified WidgetIDs)")


if __name__ == "__main__":
    main()
