# FINAL-REVIEW-CHANGELOG · 最终评审叙事重构 · 全部变更清单

> 时间窗：2026-08-31 00:00 – 04:20（本日历夜）
> 范围：按"评委第一次看到作品"的视角重构五类产物；**不改业务数据、底层 Agent、CampusTools、Widget、Schema、bindings；不重新发布 ADP；不 merge main；不删分支。**
> 终态：QA 31/31 全绿 PASS（2026-08-31T04:15:34+08:00）

---

## 1. 答辩 PPT（12 页全新叙事）

- `source/build-final-submission-pptx.mjs`：按新叙事（谁在用→什么问题→怎样帮→为什么能做到→为什么可信→验证程度→未来）全量重写 12 页；所有可动画元素注册 objectName 分组（A01…A0n）；品牌 Auroraqua warm white / coral / rose / peach / lavender；Noto Serif SC + MiSans。
- `source/add-ppt-animations.ps1`：原生逐步点击动画注入（仅 Fade），12 页共 67 组 / 242 效果，每页 timing=1。
- 术语与事实：4 Agent / 13 CampusTools / 14 绑定 / 0 硬冲突 / 4 转场·20 分钟 / 3→63→7→A1-201 / 教师025·56 课次·112 课时 / 1500+ 全部与 FINAL-TRUTH 冻结一致；"跨校区赶场"上升为"教学空间转场风险"（数字不变，唯一许可的表达升级）。
- 兜底修复：`imageCrop` / `imageContain` 两处适配 image-size v2（`readFileSync` 后传 Buffer；v2 的 `imageSize()` 不再接受路径）。
- 产物：`校园智序-小序-答辩.pptx`（12 页，scrub 清理 8 处本机路径）+ `校园智序-小序-答辩.pdf` + 12 张 1920×1080 预览（`ppt-preview-final/`）。

## 2. 智能体设计说明书（20 页）

- `source/update-final-submission-docx.py`：全量重写（≈370 行）。三层替换链（visible → term → narrative）+ 摘要三角色表 + 场景文案 + 1500+ 锁定 + 冻结产品定义插入封面 + 截图替换。
- **本轮二次修复（内容错位，04:08 发现 → 04:15 修复落地）**：
  1. P11"应用场景一｜学生的一天"：副标题分支匹配串修正（pristine 原文为无空格"教师025｜第1–4周"，旧分支带空格永不命中）→ 现为学生场景文案。
  2. P11 数字卡：教师风险卡（0 冲突/4 转场/20′）→ 学生能力卡（1 句话完成 / 4 类查询对象 / 0 上下文丢失）；教师风险数字保留在第 03 章节（真实需求与痛点）与 P14。
  3. P14 副标题：消除"负载 负载第一"重复词病句 → "未来四周负载第一的是教师 025：56 课次 / 112 课时；随后重新调用风险工具核验。"
  4. 项目摘要表：旧"它解决什么/它为什么可信"表（因多行文本导致等值匹配失效）→ 重建为三角色表，与 PPT P3 对齐。
  5. P11 截图：真实体验页截图 → 角色与能力页全宽截图（与"学生的一天"主题匹配）。
- 产物：`校园智序-小序-智能体设计说明书.docx`（20 页，Word 实机核验）+ PDF + 20 张 150dpi 预览（`doc-preview-final/`）。

## 3. 在线演示网站（demo-portal）

- 源码 8 文件重写：导航压缩为 4 个一级入口（首页 / 角色与能力 / 已核验案例 / 真实体验）；案例页"已核验演示回放 · 非实时"诚信标注；Live 页"真实体验"定位；"跨校区赶场"→"教学空间转场风险"；1500+ 口径统一；新视觉（Auroraqua）。
- 测试/配置 5 文件同步：24 个测试全部通过（App routing / AdpExperience / GuidedDemo / AdpWidget / adp / adp-stream）。
- 资产管线：`source/capture-portal-assets.mjs` 自动拍摄 4 张 1920×1080 官方截图（home / capability / experience / verified-widget）并写入 `final-delivery/assets/`；历史资产全部备份至 6 个时间戳目录（assets-backup-20260831-*）。
- 线上部署：**未执行**（线上 adp.katelya.top 仍为旧导航；QA 活站检查只验 200 + 无登录标记，通过）。

## 4. 提交材料与 QA

- `source/assemble-final-submission.py`：重新组装 FINAL-SUBMISSION（视频 SHA 冻结、程序包 55 条目、二维码、说明文档）。
- `source/final-submission-qa.py`：31 项硬检查全绿；报告截图页码同步为 ppt[5,11] / designBook[4,11,15]；1500+ 定位 PPT[2,11] / DOC[4,20]。
- 视频：未重编码、未替换（source/final SHA-256 一致：`A48A1B88…4024C`，04:44.212 < 5 分钟）。
- 匿名扫描：machine_path / localhost / real_school / real_identity / stale_demo / secret 全部 0 命中。

## 5. 管线与基础设施

- `source/run-restructure.ps1`：九阶段全链路（build+test → 截图 → 资产替换+备份 → pptxgenjs 定位 → PPT 构建+动画+scrub → PPT 导出 → 设计书 pristine 还原+升级+导出 → assemble+QA → 清理）。含中文路径，已补 UTF-8 BOM（PowerShell 5.1 无 BOM 会按 GBK 误读中文字面量）。
- `source/export-office-artifacts.ps1`：新增 pdftoppm 缺失时的 Python 兜底分支（`render-doc-previews.py`，PyMuPDF 150dpi 渲染）。
- `source/render-doc-previews.py`：新增。
- `source/dump-docx-blocks.py` + `dump-docx-blocks.txt`：本轮排查临时工具（设计书结构 dump），任务收尾时可删除。
- 依赖落位：pptxgenjs@3.12.0 + image-size@2.0.2（final-delivery/node_modules）；reportlab@5.0.1、python-pptx@1.0.2、pypdf@6.16.2（全局 Python）；pymupdf@1.27.2.3 已预装。

## 6. 新增交付支撑文档

- `PPT-SPEAKER-NOTES.md`：12 页逐页讲稿（画面重点 / 点击节奏 / 20–40s 讲稿 / 6 分 45 秒时间分配 / 高频追问一句话预案）。
- `VIDEO-RESTRUCTURE-NOTES.md`：视频宏观重剪建议（不重做视频；含剪映精修清单、重排顺序、替换纪律）。
- `FINAL-REVIEW-CHANGELOG.md`：本文件。

## 7. 明确未做（待主人决策）

1. **commit / push**：本轮大量变更仍在工作区（网站源码、final-delivery 产物、管线脚本、备份目录），未提交。工作区另有 2 个与本轮无关的 png 变更（output/agent-config-plane-browser/）不应误提交。
2. **线上部署**：新导航网站尚未发布到 adp.katelya.top（原 competition/docs/cloudflare-pages.md 路径已不存在，部署方式待确认：Cloudflare Pages 连 GitHub 自动部署 or wrangler deploy）。
3. **视频重剪**：仅产出建议文档，未动视频本体。
4. **临时文件清理**：dump-docx-blocks.py/.txt 可删（属本轮生成的排查工具）。

## 8. 复现命令（全链路）

```
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Katelya\Documents\VScode\FosuClass\competition\final-delivery\source\run-restructure.ps1" -SkipSite
```

各阶段幂等：可重复执行；截图重拍；资产备份带时间戳；设计书从 pristine 备份还原重放全部替换。
