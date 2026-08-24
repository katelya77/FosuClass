# 校园智序·小序｜FINAL QA

> 审核日期：2026-08-24
> 交付阶段：PHASE 3.0 — FINAL TRUTH FREEZE + COMPETITION DELIVERY

## 交付完整性

- 设计说明书：20 页 DOCX + PDF，逐页 PNG 预览 20 张。
- 答辩材料：12 页 PPTX + PDF，逐页 PNG 预览 12 张。
- 视频材料：脚本、镜头表、口播稿、SRT 字幕齐备；锁定时长 04:45。
- 口播稿：1019 个汉字；字幕 26 段，序号连续、无重叠，末帧 00:04:45,000。
- 程序复现包：22 个受清单管理的文件，SHA-256 与字节数全部一致。
- ZIP：25 个条目，未包含依赖目录、版本历史、archive 或无关源码。

## 事实与契约

- 4 Agent / 13 个面向 Agent 的 CampusTools / 14 个 Child bindings。
- Main 直接工具绑定为 0；协作路径为 Main → Child → Main。
- 匿名演示数据固定为当前最终版本，数据摘要为 `sha1:842b7959e808`。
- 四个 Hero Golden Result 均通过最小复现测试。
- What-if 结果保持 `mutatedData=false`，不会修改事实数据。

## 匿名与安全

- 扫描范围覆盖正文文本、OOXML 内部 XML、PDF 文本与元数据、ZIP 内文件和图片元数据。
- 身份线索、旧演示数据标识、本机路径、回环地址：0 命中。
- 邮箱与凭据值模式：0 命中。
- 对外可见品牌统一为“校园智序·小序”。
- OpenAPI 仅保留标准鉴权结构与匿名占位地址，不含任何凭据值或私有部署地址。

## 验证结果

- Agent Foundation：42/42 通过。
- Agent Regression：独立复跑 197/197 通过。首次与另一完整套件并发时，Windows 子进程出现一次瞬态退出；单独复跑后不再复现。
- AI Competition：通过。
- Agent Final Convergence：通过。
- R51：91/91 通过。
- R50.4 + Final Acceptance：5/5 通过。
- 当前匿名数据验证器：ALL PASS。
- 程序交付验证：4 agents / 13 tools / 14 bindings / 4 verified heroes，PASS。
- 4173 Showcase：67/67，build 通过，浏览器运行无 console error。
- 4174 Judge Portal：12/12，build 通过，浏览器运行无 console error。
- PPT 溢出检查：No overflow detected。
- Git whitespace：`git diff --check` 通过。

## 人工补充项

提交前仍须从腾讯 ADP Console 人工导出并放入 `manual-exports/`：

1. ADP 应用导出 ZIP；
2. CampusTools 自定义插件导出 ZIP；
3. 最终 Widget 导出文件。

同时需要把最终在线体验链接与二维码填入答辩第 12 页，并在视频 03:20–04:05 使用真实 ADP 操作录屏替换拍摄占位。
