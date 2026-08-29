from __future__ import annotations

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
PORTAL_WIDGET = ROOT / "assets" / "portal-verified-widget-1920x1080-final.png"


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


def replace_page_image(document, page_prefix: str, image_path: Path, width: float) -> None:
    items = list(blocks(document))
    start = heading_index(items, page_prefix)
    paragraph = next(
        item
        for item in items[start + 1 : start + 16]
        if isinstance(item, Paragraph) and item._p.xpath(".//a:blip")
    )
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
    "生成模型负责理解任务，CampusTools 负责事实": "模型负责理解，工具负责把事实算清",
    "版本化匿名数据，把教学时空拆成可计算对象": "匿名数据，让教学时空可以计算",
    "集合运算、约束验证与稳定排序组成可复现链路": "算法不是黑箱：每一步都能复现",
    "可行与提醒可以同时成立，而且不会写入真实数据": "可行、有提醒，但不写入真实课表",
    "mutatedData=false": "未写入真实课表（mutatedData=false）",
    "mutatedData=false，不绕过审批与审计": "真实课表未写入（mutatedData=false），不绕过审批与审计",
    "所有动态校园结论来自匿名版本化数据、明确输入和可复现算法。": "所有动态校园结论来自匿名数据、明确输入和可复现算法。",
}

term_replacements = {
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
}

for paragraph in all_paragraphs(doc):
    original = paragraph.text
    updated = visible_replacements.get(original.strip(), original)
    for old, new in term_replacements.items():
        updated = updated.replace(old, new)
    if updated != original:
        set_text_keep_first_run(paragraph, updated)

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
        set_text_keep_first_run(paragraph, "累计真实用户 1500+")
    elif value.startswith("作品并非从概念页起步"):
        set_text_keep_first_run(
            paragraph,
            "已在真实校园教学服务场景投入使用，累计真实用户量达到 1500+。真实使用反馈推动作品从查询工具演进为可理解、可核验的校园教学任务智能体。",
        )
    elif value.startswith("对外材料仅保留"):
        set_text_keep_first_run(
            paragraph,
            "已在真实校园教学服务场景投入使用，累计真实用户量达到 1500+。匿名评审不展示学校、学院、姓名、学号、真实内部地址或任何账号凭证。",
        )
    elif value.startswith("让教学时空，被理解"):
        set_text_keep_first_run(paragraph, "让教学时空，被理解、被安排。")
    elif value.startswith("总结："):
        set_text_keep_first_run(
            paragraph,
            "总结：作品已在真实校园教学服务场景投入使用，累计真实用户量达到 1500+。生成模型负责理解与组织，CampusTools 负责动态事实，结果卡负责把结论与核验依据清楚地呈现给人。",
        )

# A few verified technical fields are worth retaining, but spell out their
# meaning so the reader never has to decode a bare boolean or internal key.
for paragraph in all_paragraphs(doc):
    value = paragraph.text.strip()
    if value == "真实课表状态=false，不绕过审批与审计":
        set_text_keep_first_run(paragraph, "真实课表未写入（mutatedData=false），不绕过审批与审计")
    elif value == "真实课表状态=false":
        set_text_keep_first_run(paragraph, "未写入真实课表（mutatedData=false）")

# Replace old captures with the latest anonymous Judge Portal and real Verified Widget pages.
replace_page_image(doc, "04  /", PORTAL_HOME, 7.22)
replace_page_image(doc, "15  /", PORTAL_WIDGET, 7.22)

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
