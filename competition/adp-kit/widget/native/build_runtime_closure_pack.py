#!/usr/bin/env python3
"""Build the deterministic ADP Runtime Closure handoff pack."""

import hashlib
import json
import shutil
import zipfile
from pathlib import Path


NATIVE = Path(__file__).resolve().parent
KIT = NATIVE.parent.parent
REPO = KIT.parent.parent
FINAL = REPO / "output" / "competition-adp" / "final"
NEXT = REPO / "output" / "competition-adp" / "next"
RICH = NATIVE / "schedule-rich-v4"
FIXED_ZIP_TIME = (2026, 8, 14, 0, 0, 0)
WORKFLOWS = [
    "01-Schedule-Final.zip",
    "02-Classroom-Final.zip",
    "03-Conflict-Final.zip",
    "04-DayPlan-Final.zip",
]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_text(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.rstrip() + "\n", encoding="utf-8", newline="\n")


def checklist(cases, registry):
    lines = [
        "# ADP Runtime E2E Checklist",
        "",
        "> 本清单由 competition-demo-v1、Golden 与 compiler recovery contract 自动生成。",
        "> LOCAL PASS 不等于腾讯 ADP Runtime PASS；每例必须在腾讯 ADP 草稿环境观察原生 Widget 与 Action 回流。",
        "",
    ]
    for index, case in enumerate(cases["cases"], 1):
        widget = registry["widgets"][case["widgetKey"]]
        action_payload = json.dumps(case["action"]["sysChat"], ensure_ascii=False, separators=(",", ":"))
        tool_input = json.dumps(case["toolInput"], ensure_ascii=False, separators=(",", ":"))
        lines.extend([
            f"## {index}. {case['kind']} — `{case['fixtureId']}`",
            "",
            f"- Fixture 来源：`{case['source']}`",
            f"- 用户输入：`{case['userInput']}`",
            f"- 预期 Agent 路由：`{case['agentRoute']}`",
            f"- 预期 Workflow：`{case['workflow']}`",
            f"- 预期 Tool：`{case['tool']}`",
            f"- Tool 固定输入：`{tool_input}`",
            f"- 预期 Widget：`{widget['name']}`",
            f"- 真实 WidgetID：`{widget['widgetId']}`",
            f"- 必须出现：{'；'.join(f'`{value}`' for value in case['mustAppear'])}",
            f"- 不得出现：{'；'.join(f'`{value}`' for value in case['mustNotAppear'])}",
            f"- 点击 Action：`{case['action']['label']}`",
            f"- Action 后 sys.chat 输入：`{action_payload}`",
            f"- Action 后预期 Workflow：`{case['action']['nextWorkflow']}`",
            "- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`",
            "",
        ])
    return "\n".join(lines)


def needs_rich_export():
    return """# NEEDS_USER_RICH_V4_WIDGET_EXPORT

状态：`REQUIRED`。

原因：腾讯 ADP 的真实 WidgetID 位于平台保存后导出的 `.widget` 中；当前 Schedule V2 的真实 ID 只能用于 RuntimeSafe V3，不能复制为 Rich V4 ID。仓库不会虚构或复用该 ID。

用户只需完成一次：

1. 在腾讯 ADP Widget 管理中复制 `小序-课表票据-V2`，命名 `小序-课表票据-Rich-V4-Pilot`；不要修改或覆盖原 V2。
2. 用本包 `Schedule-Rich-V4-Pilot/template.txt` 替换 View，用 `zod.txt` 替换 Schema，用 `default.json` 替换 Default State，保存并确认平台校验通过。
3. 导出唯一的 `小序-课表票据-Rich-V4-Pilot.widget` 并交回。

收到真实导出后，compiler 将自动提取 `encodedWidget.id/view/defaultState/schema`、登记真实 WidgetID，并生成 side-by-side Pilot Workflow；用户无需手改节点。
"""


def rollback_text():
    return """# ROLLBACK

- 当前 `01-Schedule-Final.zip` 始终绑定真实 `小序-课表票据-V2`，状态为 RuntimeSafe V3。
- Rich V4 Pilot 未取得真实 WidgetID，未写入 01 Final、未覆盖 V2、未进入 active workflow。
- 若 02/03/04 草稿 Runtime 异常，在腾讯 ADP 中停用对应 Final 草稿并恢复此前已导入版本；不要让失败流程回退到 01。
- 本包不包含生产发布、VPS、CloudBase、小程序或 Active Release 操作。
"""


def write_zip(path, files):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            writer.writestr(info, files[name].read_bytes())


def main():
    missing = [name for name in WORKFLOWS if not (FINAL / name).is_file()]
    if missing:
        raise SystemExit(f"fresh Final artifacts missing: {missing}; run npm run adp:compile first")
    validation = [read_json(FINAL / f"validation-report-{key}.json") for key in ["01", "02", "03", "04"]]
    if any(item.get("status") != "PASS" for item in validation):
        raise SystemExit("Final artifact validation is not PASS")

    if NEXT.exists():
        # NEXT is a generated, task-scoped directory. Individual source files
        # live outside it, so rebuilding it cannot delete user-authored inputs.
        shutil.rmtree(NEXT)
    NEXT.mkdir(parents=True)
    for name in WORKFLOWS:
        shutil.copy2(FINAL / name, NEXT / name)
    shutil.copy2(NATIVE / "widget-registry.json", NEXT / "widget-registry.json")
    shutil.copytree(RICH, NEXT / "Schedule-Rich-V4-Pilot")

    cases = read_json(NATIVE / "runtime-e2e-cases.json")
    registry = read_json(NATIVE / "widget-registry.json")
    write_text(NEXT / "ADP-RUNTIME-E2E-CHECKLIST.md", checklist(cases, registry))
    write_text(NEXT / "NEEDS_USER_RICH_V4_WIDGET_EXPORT.md", needs_rich_export())
    write_text(NEXT / "ROLLBACK.md", rollback_text())

    pack_files = [*WORKFLOWS, "widget-registry.json", "ADP-RUNTIME-E2E-CHECKLIST.md",
                  "NEEDS_USER_RICH_V4_WIDGET_EXPORT.md", "ROLLBACK.md"]
    pack_files.extend(
        path.relative_to(NEXT).as_posix()
        for path in (NEXT / "Schedule-Rich-V4-Pilot").rglob("*") if path.is_file()
    )
    manifest = {
        "schema": "fosuclass-adp-runtime-closure-pack/v1",
        "generatedAt": "2026-08-14T00:00:00+08:00",
        "dataVersion": cases["dataVersion"],
        "localStatus": "PASS",
        "runtimeStatus": "PENDING_TENCENT_ADP_E2E",
        "schedule": "RUNTIME_SAFE_V3_ACTIVE_RICH_V4_PENDING",
        "richV4RealWidgetId": None,
        "needsUserExport": True,
        "widgetCount": len(registry["widgets"]),
        "runtimeCaseCount": len(cases["cases"]),
        "files": [{"path": name, "sha256": sha256(NEXT / name)} for name in sorted(pack_files)],
    }
    write_text(NEXT / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    pack_files.append("manifest.json")
    write_text(NEXT / "SHA256SUMS.txt", "\n".join(
        f"{sha256(NEXT / name)}  {name}" for name in sorted(pack_files)
    ))
    pack_files.append("SHA256SUMS.txt")
    target = NEXT / "ADP-Runtime-Closure-Pack.zip"
    write_zip(target, {name: NEXT / name for name in pack_files})
    print(f"ADP Runtime Closure Pack: PASS ({len(pack_files)} files)")
    print(f"Path: {target}")
    print(f"SHA256: {sha256(target)}")


if __name__ == "__main__":
    main()
