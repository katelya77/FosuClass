from __future__ import annotations

import copy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.shared import Inches, Pt, RGBColor
from docx.table import Table
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
DOCX = ROOT / "校园智序-小序-智能体设计说明书.docx"
PORTAL_HOME = ROOT / "assets" / "portal-home-1920x1080-final.png"
PORTAL_EXPERIENCE = ROOT / "assets" / "portal-experience-1920x1080-final.png"
PORTAL_CAPABILITY = ROOT / "assets" / "portal-capability-1920x1080-final.png"
PORTAL_WIDGET = ROOT / "assets" / "portal-verified-widget-1920x1080-final.png"
PORTAL_STUDENT_LIVE = ROOT / "qa" / "live-final" / "screenshots" / "04-student-live-1920x1080-final.png"


def blocks(document):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def iter_table_paragraphs(table: Table):
    for row in table.rows:
        for cell in row.cells:
            # Merged cells may be exposed more than once by python-docx.  The
            # replacements below are idempotent, so visiting every occurrence
            # is safer than trying to deduplicate transient XML wrapper ids.
            yield from cell.paragraphs
            for nested in cell.tables:
                yield from iter_table_paragraphs(nested)


def all_paragraphs(document):
    yield from document.paragraphs
    for table in document.tables:
        yield from iter_table_paragraphs(table)
    for section in document.sections:
        for part in (section.header, section.footer):
            yield from part.paragraphs
            for table in part.tables:
                yield from iter_table_paragraphs(table)


def replace_in_runs(paragraph: Paragraph, old: str, new: str) -> bool:
    changed = False
    for run in paragraph.runs:
        if old in run.text:
            run.text = run.text.replace(old, new)
            changed = True
    return changed


def set_text_keep_first_run(paragraph: Paragraph, value: str) -> None:
    if paragraph.runs:
        paragraph.runs[0].text = value
        for run in paragraph.runs[1:]:
            run.text = ""
    else:
        paragraph.add_run(value)


def set_cell_text(cell, value: str) -> None:
    if cell.paragraphs:
        set_text_keep_first_run(cell.paragraphs[0], value)
        for extra in cell.paragraphs[1:]:
            set_text_keep_first_run(extra, "")


def set_cell_lines(cell, lines: list[str]) -> None:
    """Fill the first len(lines) paragraphs of a cell, clearing leftovers.

    Keeps each paragraph's own style so the stat-card look (big number +
    small label) survives a full content swap.
    """
    paragraphs = cell.paragraphs
    for idx, line in enumerate(lines):
        if idx < len(paragraphs):
            set_text_keep_first_run(paragraphs[idx], line)
    for extra in paragraphs[len(lines):]:
        set_text_keep_first_run(extra, "")


def set_table_grid(table: Table, rows: list[list[str]]) -> None:
    """Replace table text while retaining the existing visual geometry."""
    for row_index, values in enumerate(rows):
        if row_index >= len(table.rows):
            break
        for cell_index, value in enumerate(values):
            if cell_index >= len(table.rows[row_index].cells):
                break
            set_cell_lines(table.rows[row_index].cells[cell_index], value.split("\n"))


def clear_content(paragraph: Paragraph) -> None:
    for child in list(paragraph._p):
        if child.tag.endswith("}pPr"):
            continue
        paragraph._p.remove(child)


def heading_index(items, prefix: str) -> int:
    for idx, item in enumerate(items):
        if isinstance(item, Paragraph) and item.text.strip().startswith(prefix):
            return idx
    raise RuntimeError(f"Missing page heading: {prefix}")


def replace_page_images(document, page_prefix: str, images: list[tuple[Path, float]]) -> None:
    items = list(blocks(document))
    start = heading_index(items, page_prefix)
    blips = [
        item
        for item in items[start + 1 : start + 16]
        if isinstance(item, Paragraph) and item._p.xpath(".//a:blip")
    ]
    for paragraph, (image_path, width) in zip(blips, images):
        clear_content(paragraph)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(4)
        paragraph.paragraph_format.space_after = Pt(5)
        paragraph.add_run().add_picture(str(image_path), width=Inches(width))


doc = Document(DOCX)

# Competition-facing prose should read like a product design document, not an
# internal release note.  Keep only official technical names that help a judge
# understand or reproduce the work; translate implementation shorthand into
# clear Chinese and remove build/port/version labels from the narrative.
visible_replacements = {
    "同一个 academic_context 作为共享工具形成 14 个 Agent bindings，但唯一 CampusTools 数量仍为 13。": "同一份教学上下文贯穿协作，形成 14 组专业智能体绑定关系；底层仍只有 13 项 CampusTools。",
    "同一个 共享教学上下文 作为共享工具形成 14 个 专业角色 绑定关系，但唯一 CampusTools 数量仍为 13。": "同一份教学上下文贯穿协作，形成 14 组专业智能体绑定关系；底层仍只有 13 项 CampusTools。",
    "PHASE 3.0  /  FINAL TRUTH FREEZE": "校园教学任务智能体｜设计说明书",
    "Judge Portal 首页：统一品牌、任务入口与比赛叙事。": "在线体验首页：统一呈现作品定位、任务入口与核心场景。",
    "真实 4173 架构场景：Main → Child → CampusTools → Child → Main。": "真实协作链路：主协调 → 专业智能体 → CampusTools → 专业智能体 → 主协调。",
    "07  /  Multi-Agent 协作机制": "07  /  多智能体协作机制",
    "当前冻结数据集为 competition-demo-v3；所有 Hero 场景共享同一事实版本。": "所有核心场景统一使用同一份匿名演示数据，查询、计算与核验结果可以稳定复现。",
    "11  /  Hero 1｜教学风险发现": "11  /  应用场景一｜教学风险发现",
    "12  /  Hero 2｜多人协同规划": "12  /  应用场景二｜多人协同规划",
    "13  /  Hero 3｜What-if 模拟调课": "13  /  应用场景三｜模拟调课",
    "14  /  Hero 4｜全局教学洞察": "14  /  应用场景四｜全局教学洞察",
    "15  /  Widget 与 Evidence": "15  /  结果卡与核验依据",
    "Verified 不是装饰，而是一条可复现证据链": "“已核验”不是装饰，而是一条可以复现的依据链",
    "18  /  测试、可靠性与 fail-closed": "18  /  测试、可靠性与保守失败机制",
    "4173 Showcase + 4174 Judge Portal": "作品展示页与在线体验入口",
    "R51 / R50.4 当前套件": "当前可交付配置",
    "4173 / 4174 build 与页面测试": "展示页面与在线体验测试",
    "4173 展示": "作品展示",
    "4174 评审": "在线体验",
    "核心计算、OpenAPI、R51 prompts、bindings、v3、Widget、Golden tests": "核心计算、OpenAPI、智能体提示词、绑定关系、匿名数据、结果卡与复现测试",
    "05  /  产品定位与设计目标": "05  /  设计思路与产品目标",
    "08  /  CampusTools 确定性事实层": "08  /  功能模块与确定性事实层",
    "v3": "同源",
    "true": "可行",
    "feasible": "约束核验",
    "warning": "有提醒",
    "false": "未写入",
    "mutatedData": "真实课表状态",
    "Contract": "接口契约",
    "E2E": "端到端",
    "ADP Agents": "ADP 智能体",
    "Agent foundation / regression": "智能体基础与回归测试",
    "rank 1｜120座": "首选｜120 座",
    "Tools 核验": "工具核验",
    "一句话背后，是一套可核验的校园任务操作系统": "把一句话，变成可核验的校园任务",
    "4 个智能体 × 13 项 CampusTools × 14 组协作绑定": "4 个智能体 × 13 项工具 × 14 组协作绑定",
    "生成模型负责理解，CampusTools 负责事实": "模型负责理解，工具负责把事实算清",
    "版本化匿名数据，把教学时空拆成可计算对象": "匿名数据，让教学时空可以计算",
    "集合运算、约束验证与稳定排序组成可复现链路": "算法不是黑箱：每一步都能复现",
    "可行与提醒可以同时成立，而且不会写入真实数据": "没有冲突，不等于来得及；可行、有提醒，但不写入真实课表",
    "mutatedData=false": "未写入真实课表（mutatedData=false）",
    "mutatedData=false，不绕过审批与审计": "真实课表未写入（mutatedData=false），不绕过审批与审计",
    "所有动态校园结论来自匿名版本化数据、明确输入和可复现算法。": "所有动态校园结论来自匿名数据、明确输入和可复现算法。",
    "最终对外品牌唯一为“校园智序·小序”；身份线索、真实域名与凭据全部禁止进入产物。": "内部域名、生产内部地址、私人服务地址及访问凭据不得进入提交产物；公开评审演示域名 adp.katelya.top 除外。",
    "本阶段不改生产配置、不直接部署": "演示站独立部署并提供公开评审入口；ADP 与其它生产配置通过受控发布流程管理",
    "最终地址与二维码提交前人工加入": "公开评审入口与二维码已写入最终提交材料",
    "从排课辅助出发，可扩展到资源调度、教学运行治理与跨部门协同。": "从真实课表服务出发，可扩展到资源调度、教学运行治理与跨部门协同。",
}

term_replacements = {
    "academic_context": "共享教学上下文",
    "Main → Child → Main": "主协调 → 专业智能体 → 主协调",
    "Main → Child → CampusTools → Child → Main": "主协调 → 专业智能体 → CampusTools → 专业智能体 → 主协调",
    "领域 Agent": "专业智能体",
    "4 Agent × 13 CampusTools × 14 bindings": "4 个智能体 × 13 项 CampusTools × 14 组协作绑定",
    "Hero 事实": "核心场景事实",
    "四个 Hero 结果": "四个核心场景结果",
    "Hero 场景": "核心场景",
    "Top1": "负载第一",
    "What-if": "模拟调课",
    "Golden Result": "标准核验结果",
    "Golden tests": "复现测试",
    "Golden": "标准核验",
    "Widget": "结果卡",
    "Evidence": "核验依据",
    "Verified": "已核验",
    "verified / degraded / failed": "已核验 / 降级 / 失败",
    "verified": "已核验",
    "fail-closed": "失败时保守返回",
    "prompts": "提示词",
    "bindings": "绑定关系",
    " build ": " 构建 ",
    "Main/Child": "主协调/专业角色",
    "Main→Child→Main": "主协调→专业角色→主协调",
    "Main": "主协调",
    "Child": "专业角色",
    "Schedule": "课表",
    "Risk": "风险",
    "Insight": "洞察",
    "Agent": "智能体",
    "Provider": "外部模型服务",
    "week + weekday + periods": "教学周 + 星期 + 节次",
    "campus + room": "校区 + 教室",
    "lesson": "课次",
    "schema": "数据结构",
    "dataVersion": "数据版本",
    "last-known-good": "上一份可用数据",
    "Thinking/Tool": "思考/工具调用",
    "Auroraqua 式温暖玻璃视觉": "温暖、轻透的玻璃质感视觉",
    # 评审术语升级（唯一许可的表达调整）：狭义“跨校区风险”上升为“教学空间转场风险”，数字不变。
    "跨校区赶场": "教学空间转场",
    "赶场": "转场",
}

for paragraph in all_paragraphs(doc):
    original = paragraph.text
    updated = visible_replacements.get(original.strip(), original)
    for old, new in term_replacements.items():
        updated = updated.replace(old, new)
    if updated != original:
        set_text_keep_first_run(paragraph, updated)

# Second review pass: restructure the abstract around the three real roles,
# turn the risk page into the student scenario, and give each scenario a
# role-facing title so the narrative follows “who is using it → what it does”.
narrative_replacements = {
    "项目摘要": "一句话定义",
    "真实需求与痛点": "真实需求来源",
    "已落地验证": "三类用户与需求",
    "多智能体协作机制": "三角色能力地图",
    "功能模块与确定性事实层": "多智能体协作机制",
    "数据模型": "CampusTools 确定性事实层",
    "算法原理": "算法与数据模型",
    "应用场景一｜教学风险发现": "应用场景一｜学生的一天",
    "没有冲突，不等于没有风险": "一句话查课，也能继续追问",
    "应用场景二｜多人协同规划": "应用场景二｜教师协同规划",
    "应用场景三｜模拟调课": "应用场景三｜教师调课核验",
    "应用场景四｜全局教学洞察": "应用场景四｜教学管理洞察",
    "可行、有提醒，但不写入真实课表": "没有冲突，不等于来得及；可行、有提醒，但不写入真实课表",
    "统一结果卡把自然语言结论、结构化数据与工具证据投影到同一展示层。": "统一结果卡把自然语言结论、结构化数据与工具证据投影到同一展示层；结果卡支持多轮接力——同一个对象可以继续追问，从查课表到看风险再到模拟调课，上下文不丢。",
}
for paragraph in all_paragraphs(doc):
    original = paragraph.text
    updated = original
    for old, new in narrative_replacements.items():
        updated = updated.replace(old, new)
    if updated != original:
        set_text_keep_first_run(paragraph, updated)

# Earlier cascading replacements could duplicate the page-13 slogan. Keep one
# headline and separate the verified decision state as its own subtitle.
for paragraph in all_paragraphs(doc):
    value = paragraph.text.strip()
    if value.startswith("没有冲突，不等于来得及；"):
        set_text_keep_first_run(paragraph, "没有冲突，不等于来得及；可以调，也不等于没有提醒")
    elif value.startswith("第1周周一5–6节"):
        set_text_keep_first_run(paragraph, "可行 · 有提醒 · 不写入真实课表")
    elif value.startswith("板块时间、教师时间"):
        set_text_keep_first_run(
            paragraph,
            "第1周周一5–6节 → 周四7–8节；自动推荐 A1-201。班级、教师、教室占用与容量逐项核验。",
        )

# Rebuild the abstract table around the three roles instead of the old
# “what it solves / why it is trustworthy” framing.  The real table is a
# single row with two multi-paragraph cells, so match by prefix and fill
# line-by-line to preserve the original paragraph styling.
ROLE_TABLE_LEFT = [
    "他们是谁，最真实的问题是什么",
    "学生——“今天有什么课？附近哪里有空教室？”",
    "教师——“我们什么时候都空？调到新时间行不行？”",
    "教学管理者——“未来四周谁最忙？风险在哪里？”",
    "三类角色共用同一句话入口",
]
ROLE_TABLE_RIGHT = [
    "小序怎样回答",
    "一句话查询班级 / 教师课表与空教室，支持连续追问与共享上下文",
    "共同空闲计算、教室推荐与调课前模拟核验",
    "负载排名、对象定位与逐层风险下钻",
    "查、算、筛、验、解释，一次任务内完成",
]
for table in doc.tables:
    if table.rows and table.rows[0].cells[0].text.strip().startswith("它解决什么"):
        set_cell_lines(table.rows[0].cells[0], ROLE_TABLE_LEFT)
        set_cell_lines(table.rows[0].cells[1], ROLE_TABLE_RIGHT)
        break

# The first ten pages now follow the judging logic: what it is → where the
# need came from → who uses it → how it works.  These are surgical edits on
# the retained 20-page template, so all typography and page furniture remain.
front_matter_replacements = {
    "把一句话，变成可核验的校园任务": "学生查课与找空间，教师协同与调课，管理者看全局与查风险",
    "围绕真实问题组织协作，把复杂教学时空转化为可执行、可复现的辅助决策。": "小序是面向学生、教师与教学管理者的校园教学时空资源智能体。",
    "课表没有冲突，不代表教学安排没有风险": "从 1500+ 底层课表服务，走向教学时空协同",
    "校园教学任务跨越时间、空间、人群与规则；单一查询只能看到其中一层。": "真实使用证明了查询需求，也让我们看到：查得到，不等于安排得合理。",
    "匿名演示数据中的教学风险发现：冲突为 0，但教学空间转场持续发生。": "查询只是第一步；真正复杂的是人员、时间、空间、课程与规则之间的关系。",
    "真正的问题不是“能不能排”，而是“排完之后是否仍然可行、合理、可解释”。": "底层校园课表服务累计服务用户达到 1500+；本次作品是在真实需求上的能力升级。",
    "累计真实用户 1500+": "同一套教学时空，三类人有不同问题",
    "已在真实校园教学服务场景投入使用，累计真实用户量达到 1500+。真实使用反馈推动作品从查询工具演进为可理解、可核验的校园教学任务智能体。": "学生需要查课与找空间，教师需要协同与调课，教学管理者需要看全局与查风险。",
    "在线体验首页：统一呈现作品定位、任务入口与核心场景。": "在线体验先呈现三类用户，再说明背后的智能体与工具。",
    "理解、分工、核验、回收：每一步都受边界约束": "先讲谁在用，再讲背后怎样实现",
    "四个角色共享协议与事实层，但各自承担清晰、不可混淆的职责。": "三类用户从同一句话入口进入，系统再由专业角色接力完成任务。",
    "模型负责理解，工具负责把事实算清": "主协调组织任务，专业智能体完成领域核验",
    "所有动态校园结论来自匿名数据、明确输入和可复现算法。": "四个智能体共享同一事实层，但主协调不直接调用 CampusTools。",
    "匿名数据，让教学时空可以计算": "模型可以理解，但不能编造校园事实",
    "所有核心场景统一使用同一份匿名演示数据，查询、计算与核验结果可以稳定复现。": "13 项 CampusTools 对课表、空间、协同、风险与洞察进行确定性查询和计算。",
    "算法不是黑箱：每一步都能复现": "从自然语言到核验结果，每一步都能解释",
    "每一步都能解释“候选为何进入、为何被筛掉、最终为何被推荐”。": "统一数据模型把课程、教师、班级、教室、教学周与节次连接起来。",
}
for paragraph in all_paragraphs(doc):
    value = paragraph.text.strip()
    if value in front_matter_replacements:
        set_text_keep_first_run(paragraph, front_matter_replacements[value])

for table in doc.tables:
    text = "\n".join(cell.text for row in table.rows for cell in row.cells)
    if "课程冲突" in text and "最短转场间隔" in text:
        set_table_grid(table, [["1500+\n底层服务用户", "查询 ≠\n合理安排", "人 × 时 × 空 × 规则\n真正复杂关系"]])
    elif "累计服务用户" in text and "校园使用环境" in text:
        set_table_grid(table, [["学生\n查课与找空间", "教师\n协同与调课", "教学管理者\n看全局与查风险"]])
    elif "主协调" in text and "课表" in text and "洞察" in text and "层" in text:
        set_table_grid(table, [
            ["角色", "高频问题", "小序提供的能力"],
            ["学生", "我的课在哪？哪里有空教室？", "查课表、连续追问、找空教室、一日安排"],
            ["教师", "大家何时都空？这门课能不能调？", "共同空闲、教室推荐、转场风险、模拟调课"],
            ["教学管理者", "谁最忙？哪里可能有风险？", "负载排名、资源分析、对象定位、风险下钻"],
            ["实现层", "自然语言统一入口", "多智能体协作 + CampusTools 确定性事实层"],
        ])
    elif "唯一工具" in text and "关键结论可回放" in text:
        set_table_grid(table, [["4\n智能体", "13\nCampusTools", "14\n协作绑定"]])
    elif "时间与空间" in text and "风险与洞察" in text:
        set_table_grid(table, [[
            "专业分工\n主协调：理解、路由、汇总\n课程空间：查课、教室与共同空闲\n风险规划：冲突、转场与模拟调课",
            "协作路径\n用户问题 → 主协调 → 专业智能体\n专业智能体 → CampusTools → 专业智能体\n最后回到主协调统一解释",
        ]])
    elif "校区" in text and "匿名教学单位" in text and "班级" in text and "教师" in text:
        set_table_grid(table, [["13\n唯一工具", "0\n主协调直接工具", "14\n专业角色绑定", "1\n共享教学上下文"]])
    elif "课程" in text and "教室" in text and "课次" in text and "数据哈希" in text:
        set_table_grid(table, [["明确输入\n对象与时间", "确定性计算\n查询与集合运算", "约束核验\n容量、占用与风险", "可复现结果\n同一输入同一结论"]])
    elif "核心关系" in text and "版本纪律" in text:
        set_table_grid(table, [[
            "工具能力\n课表与对象查询\n空教室与共同空闲\n风险检查与模拟调课\n负载与空间使用分析",
            "可信边界\n匿名数据先校验再使用\n关键结果保留核验依据\n条件变化必须重新调用工具\n缺失或损坏时保守返回",
        ]])

# Lock the only updated landing fact and the final narrative line throughout the editable document.
for paragraph in all_paragraphs(doc):
    replace_in_runs(paragraph, "1000+", "1500+")
    replace_in_runs(paragraph, "让复杂的校园教学安排，简单到一句话就能问。", "让教学时空，被理解、被安排。")
    replace_in_runs(
        paragraph,
        "生成模型理解任务｜确定性工具计算事实｜关键结论全部可核验",
        "模型理解任务｜工具计算事实｜关键结论可核验",
    )

for paragraph in doc.paragraphs:
    value = paragraph.text.strip()
    if value.startswith("前期产品形态累计服务用户"):
        set_text_keep_first_run(paragraph, "底层课表服务用户 1500+")
    elif value.startswith("作品并非从概念页起步"):
        set_text_keep_first_run(
            paragraph,
            "底层校园课表服务累计服务用户达到 1500+；本次参赛作品在这些真实需求基础上进一步扩展为校园教学时空协同智能体。",
        )
    elif value.startswith("对外材料仅保留"):
        set_text_keep_first_run(
            paragraph,
            "底层校园课表服务累计服务用户达到 1500+；本次参赛作品在这些真实需求基础上进一步扩展为校园教学时空协同智能体。匿名评审不展示学校、学院、姓名、学号、内部服务地址或任何账号凭证；公开评审域名除外。",
        )
    elif value.startswith("让教学时空，被理解"):
        set_text_keep_first_run(paragraph, "让教学时空，被理解、被安排。")
    elif value.startswith("总结："):
        set_text_keep_first_run(
            paragraph,
            "总结：底层校园课表服务累计服务用户达到 1500+；本次参赛作品在这些真实需求基础上进一步扩展为校园教学时空协同智能体。生成模型负责理解与组织，CampusTools 负责动态事实，结果卡呈现核验依据。",
        )

# Role-facing scenario copy.  NOTE: match the pristine document's real
# spacing (“教师025”, “第1周”) — earlier space-padded prefixes never matched.
for paragraph in all_paragraphs(doc):
    value = paragraph.text.strip()
    if value.startswith("教师025｜第1"):
        set_text_keep_first_run(
            paragraph,
            "查课表、连续追问、找空教室、看今日安排——学生的一天，用一句话完成。",
        )
    elif value.startswith("未来四周负载"):
        set_text_keep_first_run(
            paragraph,
            "未来四周负载第一的是教师 025：56 课次 / 112 课时；随后重新调用风险工具核验。",
        )
    elif value.startswith("系统把传统冲突检测之外的时空可行性显式标出"):
        set_text_keep_first_run(
            paragraph,
            "以上能力全部来自真实系统：可在在线体验中现场验证，也能在程序包中复现；不虚构使用数字。",
        )

# Scenario 1 is now the student day: swap the teacher-risk stat card
# (0 conflicts / 4 transitions / 20 minutes) for real student capability
# facts — one sentence, four query object kinds, and continuous follow-up.
# The teacher-risk numbers stay on page 03 (真实需求与痛点) and page 14.
STUDENT_STAT_CARDS = [
    ["1", "句话完成"],
    ["4", "类查询对象"],
    ["连续", "追问"],
]
doc_items = list(blocks(doc))
scenario_one_start = heading_index(doc_items, "11  /")
for item in doc_items[scenario_one_start + 1 :]:
    if isinstance(item, Paragraph) and item.text.strip().startswith("12  /"):
        break
    if isinstance(item, Table):
        cells = item.rows[0].cells
        if any("冲突 / 周" in cell.text or "上下文丢失" in cell.text for cell in cells):
            for cell, lines in zip(cells, STUDENT_STAT_CARDS):
                set_cell_lines(cell, lines)
            break

# A few verified technical fields are worth retaining, but spell out their
# meaning so the reader never has to decode a bare boolean or internal key.
for paragraph in all_paragraphs(doc):
    value = paragraph.text.strip()
    if value == "真实课表状态=false，不绕过审批与审计":
        set_text_keep_first_run(paragraph, "真实课表未写入（mutatedData=false），不绕过审批与审计")
    elif value == "真实课表状态=false":
        set_text_keep_first_run(paragraph, "未写入真实课表（mutatedData=false）")

# Cover: insert the frozen product definition right above the brand claim.
inserted_definition = any(
    paragraph.text.strip().startswith("面向学生、教师与教学管理者的校园教学时空资源智能体")
    for paragraph in doc.paragraphs
)
for paragraph in doc.paragraphs:
    if inserted_definition:
        break
    if paragraph.text.strip() == "让教学时空，被理解、被安排。":
        new_element = copy.deepcopy(paragraph._p)
        paragraph._p.addprevious(new_element)
        new_paragraph = Paragraph(new_element, paragraph._parent)
        set_text_keep_first_run(
            new_paragraph,
            "面向学生、教师与教学管理者的校园教学时空资源智能体：学生查课与找空间，教师协同与调课，管理者看全局与查风险。",
        )
        for run in new_paragraph.runs:
            run.font.size = Pt(13)
            run.font.bold = False
            run.font.color.rgb = RGBColor(0x54, 0x4B, 0x46)
        inserted_definition = True

# Replace old captures with the latest anonymous portal pages.
# Scenario 1 (student day) carries the capability page full-width; page 15
# keeps the verified-widget replay capture.
replace_page_images(doc, "04  /", [(PORTAL_HOME, 7.22)])
replace_page_images(doc, "11  /", [(PORTAL_STUDENT_LIVE, 7.22)])
replace_page_images(doc, "15  /", [(PORTAL_WIDGET, 7.22)])

doc.core_properties.title = "校园智序·小序—智能体设计说明书"
doc.core_properties.subject = "比赛最终提交 · 混合智能 · 可核验结果"
doc.core_properties.author = "校园智序·小序"
doc.core_properties.last_modified_by = "校园智序·小序"
doc.core_properties.comments = ""
doc.core_properties.keywords = "校园教学任务智能体, 多智能体协作, CampusTools, 可核验结果卡"

temp = DOCX.with_name("final-submission-design-guide.docx")
doc.save(temp)
temp.replace(DOCX)
print(DOCX)
