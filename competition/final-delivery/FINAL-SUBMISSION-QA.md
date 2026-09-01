# 校园智序·小序｜FINAL SUBMISSION QA

- 总结：`PASS`（33/33 项通过）
- 生成时间：2026-09-01T10:44:40+08:00
- 事实源：`FINAL-TRUTH.md` / `FINAL-TRUTH.json` 与四份标准核验结果
- 说明：PPTX 与 DOCX 已在 Microsoft PowerPoint / Word 桌面端实际打开；PPT 12 页、Word 状态栏 20/20 页。

## 自动化与实机验收

| 结果 | 检查项 | 证据 |
|---|---|---|
| PASS | 最终目录必需文件 | 17 项；missing=[] |
| PASS | PPTX 可解析 | python-pptx 打开；12 页 |
| PASS | PPT/PDF 页数一致 | PPTX=12, PDF=12 |
| PASS | PPT 16:9 | ratio=1.777778 |
| PASS | PPT 文本框溢出 | overflow=[]; min explicit font=8.5pt |
| PASS | PPT 原生逐步放映动画 | S1=4组/5效果; S2=6组/27效果; S3=5组/24效果; S4=8组/29效果; S5=5组/16效果; S6=6组/15效果; S7=5组/12效果; S8=4组/17效果; S9=6组/36效果; S10=4组/16效果; S11=5组/28效果; S12=6组/19效果 |
| PASS | DOCX 可解析且可编辑 | python-docx 打开；paragraphs=140 |
| PASS | 设计书 PDF 页数 | PDF=20 页；Word 实机状态栏已核验 20/20 |
| PASS | PPT 逐页预览 | 12 张 1920×1080；failures=[] |
| PASS | 设计书逐页预览 | 20 张；failures=[] |
| PASS | 逐页 PNG 已纳入正式提交 | PPT=12; DOC=20 |
| PASS | 网站生产截图与多视口溢出检查 | screenshots=10; live=4; viewports=14; console=0; page=0 |
| PASS | 演示视频存在且小于 5 分钟 | 04:44.212；h264 1920×1080 |
| PASS | 视频未重新编码 | source/final SHA-256=A48A1B88E4CA73FE571AD750A601C33C546F50C9D7C7709D4CF9F70080B4024C |
| PASS | 最终 SHA-256 清单 | 69 个文件；failures=[] |
| PASS | 程序 ZIP 可解压 | entries=55; bad=None |
| PASS | 程序包 A–F 结构 | roots=['ARCHITECTURE.md', 'A_ADP工程', 'B_CampusTools', 'C_Widget', 'D_Agent配置', 'E_Data', 'F_Verification', 'MANIFEST-SHA256.txt', 'README-程序交付与运行说明.md'] |
| PASS | ADP/CampusTools 人工导出可解压 | [('校园智序-小序_v20260827164200_package.zip', True, 4, None), ('校园智序-CampusTools.zip', True, 13, None)] |
| PASS | Widget 人工导出与数据契约 | outer=['encodedWidget', 'jsonSchema', 'name', 'outputJsonPreview', 'template', 'version']; decoded=['defaultState', 'defaultStateValidity', 'id', 'name', 'schema', 'schemaValidity', 'states', 'view', 'viewValidity'] |
| PASS | 4 Agent / 13 CampusTools / 14 bindings | prompts=4, operation-yaml=13, child-bindings=14, main=[] |
| PASS | 程序包内部 SHA-256 清单 | 54 个文件；failures=[] |
| PASS | 四场景最小复现 | PASS: 4 Agent / 13 CampusTools / 14 bindings / 4 Golden Result |
| PASS | Judge Portal 首页 | {"url": "https://adp.katelya.top/", "status": 200, "bytes": 860, "loginMarker": false} |
| PASS | Judge Portal Experience | {"url": "https://adp.katelya.top/experience", "status": 200, "bytes": 860, "loginMarker": false} |
| PASS | 页面匿名可访问 | HTML 无登录/密码入口；浏览器实测首页、真实体验与已核验结果卡均无需账号 |
| PASS | 二维码解析 | decoded=https://adp.katelya.top/ |
| PASS | 匿名/路径/localhost/旧数据扫描 | {"machine_path": [], "localhost": [], "real_school": [], "real_identity": [], "stale_demo": []} |
| PASS | Secret/AppKey/Token 凭证值扫描 | hits=[] |
| PASS | PPT 关键事实覆盖 | missing=[] |
| PASS | 设计书关键事实覆盖 | missing=[] |
| PASS | FINAL-TRUTH 关键事实 | 15 项冻结事实全部命中 |
| PASS | 设计书内部版本黑话扫描 | hits=[] |
| PASS | 1500+ 页面定位 | PPT=[2, 11]; DOC=[3, 4, 20] |

## 页面定位

- `1500+`：PPT 第 2, 11 页；设计说明书第 3, 4, 20 页。
- 在线体验实际截图：PPT 第 5、11、12 页；设计说明书第 4、11、15 页。
- PPT 全 12 页已输出 1920×1080 PNG 并逐页检查；设计书全 20 页已输出 PNG 并完成整套视觉复核。

## 在线与匿名结论

- `https://adp.katelya.top/` 与 `/experience`：HTTP 200。
- 浏览器实测：首页、在线体验与已核验结果卡均可匿名打开；无需测试账号。
- 二维码解码结果：`https://adp.katelya.top/`。
- 本机绝对路径、localhost、真实学校名称、真实个人身份、旧 v1/v2、凭证值：0 命中。

## 回滚与未改动边界

- 本轮未修改 Agent / CampusTools / Widget 业务语义；Portal 已按授权通过受控流程部署，PR #57 已合并。
- Portal 回滚源码为 `b60a5749672cb87d548532ff209176693e65c6fa`，上一生产 Deployment ID 为 `96d3139a-d7b8-489a-aea3-0ab837fd9f83`；材料可由 source 生成脚本重建。
- PPT、设计书与提交说明均以中文叙述为主；内部端口号、阶段号和套件版本标签已从评审正文移除。
