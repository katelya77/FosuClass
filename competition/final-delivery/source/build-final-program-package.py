from __future__ import annotations

import base64
import hashlib
import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
STAGING_PARENT = ROOT / "program-final"
PACKAGE_ROOT = STAGING_PARENT / "03程序交付"
OUTPUT = ROOT / "校园智序-小序-程序交付材料.zip"
MANUAL = ROOT / "manual-exports"
EXISTING = ROOT / "program"

APP_ZIP = MANUAL / "校园智序-小序_v20260827164200_package.zip"
TOOLS_ZIP = MANUAL / "校园智序-CampusTools.zip"
WIDGET = MANUAL / "小序-校园智序结果卡.widget"


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.strip() + "\n", encoding="utf-8", newline="\n")


def copy_file(source: Path, target: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def safe_reset() -> None:
    resolved = STAGING_PARENT.resolve()
    if resolved.parent != ROOT.resolve() or resolved.name != "program-final":
        raise RuntimeError(f"Unsafe staging target: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    PACKAGE_ROOT.mkdir(parents=True)


def extract_tool_yamls() -> list[str]:
    target = PACKAGE_ROOT / "B_CampusTools" / "operation-yaml"
    target.mkdir(parents=True, exist_ok=True)
    with ZipFile(TOOLS_ZIP) as archive:
        names = sorted(name for name in archive.namelist() if name.lower().endswith(('.yaml', '.yml')))
        if len(names) != 13:
            raise RuntimeError(f"Expected 13 CampusTools YAML files, got {len(names)}")
        for name in names:
            output = target / Path(name).name
            output.write_bytes(archive.read(name))
    return [Path(name).stem for name in names]


def extract_widget_contract() -> None:
    outer = json.loads(WIDGET.read_text(encoding="utf-8"))
    inner = json.loads(base64.b64decode(outer["encodedWidget"]).decode("utf-8"))
    target = PACKAGE_ROOT / "C_Widget"
    write_text(target / "Template.tsx.txt", inner["view"])
    write_text(target / "Schema.ts.txt", inner["schema"])
    write_text(target / "Default.json", json.dumps(inner["defaultState"], ensure_ascii=False, indent=2))
    write_text(target / "Widget-envelope-schema.json", json.dumps(outer["jsonSchema"], ensure_ascii=False, indent=2))


def build_docs(operation_names: list[str]) -> None:
    readme = """
# 校园智序·小序｜程序交付与运行说明

## 1. 这是什么

这是“校园智序·小序”比赛作品的最小充分程序交付包。作品是腾讯 ADP 平台承载的 Multi-Agent 编排，与自定义 CampusTools 确定性事实层、统一 Widget、匿名演示数据和 Golden Result 组合而成的混合方案。

## 2. 组件边界

- `A_ADP工程/`：最新 ADP 应用人工导出 ZIP，由平台承载 4 Agent、流程和应用配置。
- `B_CampusTools/`：最新自定义插件 ZIP、13 个 operation 定义、OpenAPI 与确定性核心源码。
- `C_Widget/`：最终 `.widget` 人工导出，以及可继续编辑的 Template、Schema、Default 和数据契约。
- `D_Agent配置/`：4 Agent 最终 prompt、14 Child bindings 与 Main → Child → Main 流程说明。
- `E_Data/`：`competition-demo-v3` 匿名演示数据、schema 与版本来源。
- `F_Verification/`：4 个 Verified Golden Result、FINAL-TRUTH 与最小复现测试。

## 3. 导入 / 运行

1. 在腾讯 ADP 控制台导入 `A_ADP工程/` 中的应用 ZIP。
2. 导入 `B_CampusTools/` 中的自定义插件 ZIP；按 `OpenAPI/` 和 `operation-yaml/` 核对 13 个 operation。
3. 用 `D_Agent配置/Prompts/` 配置 Main、Schedule、Risk、Insight；按 bindings JSON 完成 14 个 Child bindings。Main 不直接绑定工具。
4. 导入 `C_Widget/` 中的 `.widget`，核对 Template、Schema 与 Default。
5. 本地复现确定性核心：安装 Node.js 18+，在本目录运行 `node F_Verification/verify-minimal.js`。

## 4. Verified snapshot

本交付包的可核查事实只来自 `competition-demo-v3`、CampusTools、Golden Result 与 FINAL-TRUTH。生成模型负责理解、路由和解释，不是动态校园事实源。任何真实平台运行所需的环境配置由评审环境或导入目标环境单独提供，不写入交付文件。

## 5. 在线演示

https://adp.katelya.top/

评委可直接从自然语言问题进入课程查询、多人协同、模拟调课与校园洞察。匿名访问，无需测试账号。
"""
    write_text(PACKAGE_ROOT / "README-程序交付与运行说明.md", readme)

    architecture = """
# Architecture

## 真实拓扑

```text
用户自然语言
    ↓
小序·Main（理解 / 路由 / 汇总；直接工具数 = 0）
    ↕ Main → Child → Main
Schedule / Risk / Insight
    ↕ 14 Child bindings
13 CampusTools（确定性查询 / 计算）
    ↓
结构化结果 → Verified Widget → Evidence / 继续追问
```

## 不变量

- Agent 数量：4。
- Agent-facing CampusTools：13。
- Child bindings：14；`campus_academic_context` 同时绑定 Schedule 与 Risk。
- Child 不互相转发；所有跨领域协作回到 Main。
- 统一 `academic_context` 承接对象、时间范围与约束。
- 统一结果卡表达 verified / degraded / failed；无结果或损坏时不伪造答案。
- 数据版本：`competition-demo-v3`，哈希 `sha1:842b7959e808`。
"""
    write_text(PACKAGE_ROOT / "ARCHITECTURE.md", architecture)

    write_text(
        PACKAGE_ROOT / "A_ADP工程" / "README-ADP工程说明.md",
        """
# ADP 工程说明

本目录包含 2026-08-27 16:42:00 标识的最新人工导出应用包。它承载小序·Main、Schedule、Risk、Insight 四个 Agent 及平台侧流程配置。提交前只清除了私密默认值和旧版本提示文本，没有修改 Agent、bindings、流程、工具或 Widget 的既有业务语义。

导入后请按 `D_Agent配置/` 与 `F_Verification/` 进行核对；不要把平台环境凭证写回导出包或文档。
""",
    )

    tool_lines = "\n".join(f"{idx}. `{name}`" for idx, name in enumerate(operation_names, 1))
    write_text(
        PACKAGE_ROOT / "B_CampusTools" / "13-Agent-facing-operations.md",
        f"""
# 13 个 Agent-facing CampusTools operations

以下清单来自本次最新 CampusTools 人工导出 ZIP，文件数与 FINAL-TRUTH 一致：

{tool_lines}

绑定关系以 `D_Agent配置/agent-tool-bindings.json` 为准；Main 的直接工具列表为空。
""",
    )
    write_text(
        PACKAGE_ROOT / "B_CampusTools" / "README-运行说明.md",
        """
# CampusTools 运行说明

`校园智序-CampusTools.zip` 是最新平台自定义插件人工导出。`core-src/` 是与比赛四个场景直接相关的最小确定性核心，`OpenAPI/` 是脱敏后的接口结构，`operation-yaml/` 保留 13 个平台 operation 定义。

本地最小验证：在程序交付根目录运行 `node F_Verification/verify-minimal.js`。测试会核对数据版本、4/13/14 架构事实、四个 Golden Result 与风险、协同、调课、洞察结果。
""",
    )

    write_text(
        PACKAGE_ROOT / "C_Widget" / "Widget数据契约说明.md",
        """
# Widget 数据契约说明

`.widget` 是最终人工导出；`Template.tsx.txt`、`Schema.ts.txt` 与 `Default.json` 从该导出的 `encodedWidget` 原样解码。Widget 只投影结构化工具结果，不重新计算事实。

结果至少表达：场景类型、自然语言结论、结构化 payload、`dataVersion`、核验状态与 Evidence 摘要。关键结论只有在验证成功时标记 `verified`；普通对话不堆叠证据卡，无结果、歧义或损坏时给出明确状态并保留文本降级。
""",
    )

    write_text(
        PACKAGE_ROOT / "D_Agent配置" / "Main-Child-Main说明.md",
        """
# Main → Child → Main

1. Main 读取自然语言目标，选择一个专业 Child。
2. Child 从统一 `academic_context` 提取实体、时间范围与约束。
3. Child 调用其 bindings 允许的 CampusTools。
4. Child 把结构化观察返回 Main；Child 之间不直接转发。
5. Main 统一组织结果、Widget 与下一步追问。

Main 直接工具数为 0；专业分工为 Schedule、Risk、Insight。跨域连续追问始终回到 Main 再分配，从而保持同一对象和约束而不扩大工具权限。
""",
    )
    write_text(
        PACKAGE_ROOT / "D_Agent配置" / "流程编排说明.md",
        """
# 流程编排说明

```text
自然语言理解 → 目标识别 → Main 路由 → 专业 Agent
→ 参数提取 → CampusTools 查询/计算 → 约束核验
→ 结构化结果 → Verified Widget → academic_context 续接
```

Hybrid Intelligence 边界：LLM 负责理解、协作与表达；确定性工具层负责事实与计算。若工具不可用，必须保留明确失败或降级状态，不得让模型补全课表事实。
""",
    )

    write_text(
        PACKAGE_ROOT / "E_Data" / "PROVENANCE.md",
        """
# 数据来源与版本

- 数据集：`competition-demo-v3`
- 哈希：`sha1:842b7959e808`
- 范围：4 校区、6 匿名教学单位、24 班级、40 教师、73 课程、85 教室、175 课次。
- 用途：比赛演示、Golden Result 与最小复现。
- 隐私：全部为匿名演示对象，不包含真实用户课表、账号、登录票据或原始个人文件。

所有四个 Hero 场景与程序包内 Golden Result 共用该快照。加载失败时应保留上一份已核验可用数据，不生成替代事实。
""",
    )
    write_text(
        PACKAGE_ROOT / "E_Data" / "VERSION.json",
        json.dumps(
            {
                "dataVersion": "competition-demo-v3",
                "dataHash": "sha1:842b7959e808",
                "campuses": 4,
                "teachingUnits": 6,
                "classes": 24,
                "teachers": 40,
                "courses": 73,
                "rooms": 85,
                "lessons": 175,
            },
            ensure_ascii=False,
            indent=2,
        ),
    )

    write_text(
        PACKAGE_ROOT / "F_Verification" / "核验说明.md",
        """
# 核验说明

四个 JSON 是同一 `competition-demo-v3` 快照上的 Verified Golden Result：

- Risk：教师025，第1–4周，每周 0 冲突 / 4 次跨校区赶场，最短间隔 20 分钟。
- Collaboration：3 位教师 → 63 间可用 → 7 间容量达标 → A1-201（120 座）。
- Reschedule：周一5–6节 → 周四7–8节，`feasible=true` 与 1 条 warning 同时成立，`mutatedData=false`。
- Insight：教师025 为 Top1，56 课次 / 112 课时，并可继续核验 0 冲突 / 4 赶场。

执行 `node verify-minimal.js` 可复现核心计算与交付结构检查。
""",
    )


def write_verifier() -> None:
    verifier = r'''"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));

const dataset = readJson("E_Data", "competition-demo-v3.json");
assert.equal(dataset.meta.dataVersion, "competition-demo-v3");
assert.equal(dataset.meta.dataHash, "sha1:842b7959e808");
assert.deepEqual(
  {
    campuses: dataset.campuses.length,
    colleges: dataset.colleges.length,
    classes: dataset.classes.length,
    teachers: dataset.teachers.length,
    courses: dataset.courses.length,
    rooms: dataset.rooms.length,
    lessons: dataset.lessons.length,
  },
  { campuses: 4, colleges: 6, classes: 24, teachers: 40, courses: 73, rooms: 85, lessons: 175 },
);

const bindings = readJson("D_Agent配置", "agent-tool-bindings.json");
assert.equal(Object.keys(bindings.agents).length, 4);
assert.equal(bindings.uniqueOperationCount, 13);
assert.equal(bindings.bindingCount, 14);
assert.deepEqual(bindings.agents.main, []);
assert.deepEqual(bindings.sharedTools.campus_academic_context, ["schedule", "risk"]);

process.env.CAMPUS_DATA_PATH = path.join(ROOT, "E_Data", "competition-demo-v3.json");
const { TOOL_DEFS, callTool } = require(path.join(ROOT, "B_CampusTools", "core-src", "tools.js"));
const { AGENT_TOOL_MAP } = require(path.join(ROOT, "B_CampusTools", "core-src", "agent-tools.js"));
assert.equal(Object.keys(AGENT_TOOL_MAP).length, 13);
assert.ok(Object.values(AGENT_TOOL_MAP).every((name) => TOOL_DEFS.some((tool) => tool.name === name)));

for (const week of [1, 2, 3, 4]) {
  const risk = callTool("compare_schedules", {
    firstType: "teacher", firstName: "教师025",
    secondType: "teacher", secondName: "教师025", week,
  });
  assert.equal(risk.summary.conflictCount, 0);
  assert.equal(risk.summary.rushWarningCount, 4);
  assert.ok(risk.rushWarnings.every((item) => item.gapMinutes === 20));
}

const rooms = callTool("find_available_classrooms", { week: 1, weekday: 4, periodStart: 1, periodEnd: 4 });
assert.equal(rooms.items.length, 63);

const group = callTool("plan_group", {
  entities: [
    { type: "teacher", name: "教师005" },
    { type: "teacher", name: "教师006" },
    { type: "teacher", name: "教师014" },
  ],
  week: 1, weekday: 4, periodStart: 1, periodEnd: 4,
  minConsecutivePeriods: 4, minCapacity: 120,
});
assert.equal(group.items[0].roomCount, 7);
assert.equal(group.items[0].rooms[0].roomName, "A1-201");
assert.equal(group.items[0].rooms[0].capacity, 120);

const reschedule = callTool("check_reschedule_feasibility", {
  sourceLessonId: "lesson-001",
  target: { week: 1, weekday: 4, periodStart: 7, periodEnd: 8 },
});
assert.equal(reschedule.summary.feasible, true);
assert.equal(reschedule.summary.warningCount, 1);
assert.equal(reschedule.simulation.mutatedData, false);
assert.equal(reschedule.items[0].checks.spaceAvailability.roomCount, 8);
assert.equal(reschedule.items[0].checks.spaceAvailability.suggestedRoom.name, "A1-201");

const insight = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 1 });
assert.equal(insight.items[0].teacher.name, "教师025");
assert.equal(insight.items[0].lessonOccurrences, 56);
assert.equal(insight.items[0].periodUnits, 112);

for (const name of ["risk", "collaboration", "reschedule", "insight"]) {
  const golden = readJson("F_Verification", "Golden-Result", `${name}.json`);
  assert.equal(golden.dataVersion, "competition-demo-v3");
  assert.equal(golden.verified, true);
}

const widget = fs.readFileSync(path.join(ROOT, "C_Widget", "小序-校园智序结果卡.widget"), "utf8");
assert.doesNotThrow(() => JSON.parse(widget));
assert.ok(widget.includes('"verified"'));

console.log("PASS: 4 Agent / 13 CampusTools / 14 bindings / 4 Golden Result");
'''
    write_text(PACKAGE_ROOT / "F_Verification" / "verify-minimal.js", verifier)


def copy_payload() -> None:
    copy_file(APP_ZIP, PACKAGE_ROOT / "A_ADP工程" / APP_ZIP.name)
    copy_file(TOOLS_ZIP, PACKAGE_ROOT / "B_CampusTools" / TOOLS_ZIP.name)
    copy_file(WIDGET, PACKAGE_ROOT / "C_Widget" / WIDGET.name)

    for source in sorted((EXISTING / "campus-tools" / "src").glob("*.js")):
        copy_file(source, PACKAGE_ROOT / "B_CampusTools" / "core-src" / source.name)
    copy_file(EXISTING / "openapi" / "campus-tools.openapi.json", PACKAGE_ROOT / "B_CampusTools" / "OpenAPI" / "campus-tools.openapi.json")

    for source in sorted((EXISTING / "prompts").glob("*.md")):
        copy_file(source, PACKAGE_ROOT / "D_Agent配置" / "Prompts" / source.name)
    copy_file(EXISTING / "bindings" / "agent-tool-bindings.json", PACKAGE_ROOT / "D_Agent配置" / "agent-tool-bindings.json")
    binding_data = json.loads((EXISTING / "bindings" / "agent-tool-bindings.json").read_text(encoding="utf-8"))
    rows = []
    for agent, tools in binding_data["agents"].items():
        for tool in tools:
            rows.append({"agent": agent, "operation": tool})
    if len(rows) != 14:
        raise RuntimeError(f"Expected 14 child bindings, got {len(rows)}")
    write_text(PACKAGE_ROOT / "D_Agent配置" / "14-Child-bindings.json", json.dumps(rows, ensure_ascii=False, indent=2))
    write_text(
        PACKAGE_ROOT / "D_Agent配置" / "Main-Child-Main.json",
        json.dumps(
            {
                "mainDirectToolCount": 0,
                "route": ["Main", "Child", "Main"],
                "childAgents": ["Schedule", "Risk", "Insight"],
                "childToChild": False,
                "sharedContext": "academic_context",
                "resultProjection": "Verified Widget",
            },
            ensure_ascii=False,
            indent=2,
        ),
    )

    copy_file(EXISTING / "data" / "competition-demo-v3.json", PACKAGE_ROOT / "E_Data" / "competition-demo-v3.json")
    copy_file(EXISTING / "data" / "competition-demo-v3.schema.json", PACKAGE_ROOT / "E_Data" / "competition-demo-v3.schema.json")

    for source in sorted((EXISTING / "golden").glob("*.json")):
        copy_file(source, PACKAGE_ROOT / "F_Verification" / "Golden-Result" / source.name)
    copy_file(ROOT / "FINAL-TRUTH.md", PACKAGE_ROOT / "F_Verification" / "FINAL-TRUTH.md")
    copy_file(ROOT / "FINAL-TRUTH.json", PACKAGE_ROOT / "F_Verification" / "FINAL-TRUTH.json")


def build_manifest() -> None:
    entries = []
    for path in sorted(p for p in PACKAGE_ROOT.rglob("*") if p.is_file() and p.name != "MANIFEST-SHA256.txt"):
        entries.append(f"{sha256(path)}  {path.relative_to(PACKAGE_ROOT).as_posix()}")
    write_text(PACKAGE_ROOT / "MANIFEST-SHA256.txt", "\n".join(entries))


def build_zip() -> None:
    temp = OUTPUT.with_suffix(".tmp")
    if temp.exists():
        temp.unlink()
    with ZipFile(temp, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(p for p in PACKAGE_ROOT.rglob("*") if p.is_file()):
            archive.write(path, (Path("03程序交付") / path.relative_to(PACKAGE_ROOT)).as_posix())
    temp.replace(OUTPUT)
    with ZipFile(OUTPUT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Program ZIP integrity failed")


def main() -> None:
    safe_reset()
    copy_payload()
    operation_names = extract_tool_yamls()
    extract_widget_contract()
    build_docs(operation_names)
    write_verifier()
    build_manifest()
    build_zip()
    print(PACKAGE_ROOT)
    print(f"{OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
