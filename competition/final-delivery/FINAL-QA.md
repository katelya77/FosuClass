# 校园智序·小序｜PHASE 3.1 FINAL CUT QA

> 审核日期：2026-08-24
> 交付阶段：PHASE 3.1 — FINAL CUT

## 交付完整性

- 设计说明书：20 页 DOCX + PDF，逐页 PNG 预览 20 张；P15 为真实官方 Widget，P18 为真实 Main → Child → CampusTools → Widget 证据。
- 答辩材料：12 页 PPTX + PDF，逐页 PNG 预览 12 张；PowerPoint 原生打开与版面溢出检查通过。
- 视频材料：脚本、镜头表、口播稿、SRT 字幕齐备；锁定时长 `04:35`。
- 口播稿：1080 个非空白字符；字幕 32 段，序号连续、无重叠，末帧 `00:04:35,000`。
- 程序复现包：23 个必要文件；ZIP 共 25 个条目，不含依赖目录、版本历史、archive、真实数据或凭据。

## 4174 Native ADP API

- 主通路为 Pages Function `/api/adp/chat`，服务端构造 UUID RequestId、持久 ConversationId 与增量多意图请求，并原样透传 SSE。
- 密钥只存在于本机已忽略的 `.dev.vars` 与 Cloudflare Secret；扫描 2783 个 Git 跟踪文件和 133 个构建/交付文件，密钥值命中为 0。
- 大赛自部署 ADP 发布入口完成过真实 200 SSE 会话：出现 `小序-主协调`、`小序-校园洞察`，并出现全校概览与教师负载查询两次真实工具调用。
- 真实返回包含 Widget.View / WidgetId / WidgetRunId；官方 `<adp-widget>` 已在浏览器实际渲染，非本地伪造。
- 当前发布版本未返回 `IsSubAgent` 字段；诊断页如实显示“字段尚未返回”，不制造状态。
- 最后一轮复测仍得到 HTTP 200 SSE，但上游事件明确返回 `400429 RateLimit`；页面按真实事件呈现，未把限流包装成成功。此前成功会话与 Widget 截图已保存在 `qa/final-cut/`。

## 4173 Final Cut Director

- Opening 10 秒、Architecture 15 秒；完整导演片时间线 163 秒。
- 四个 Hero 均使用“问题 → 协作 → 核验 → 结论”四拍结构；问题先全屏 1.5–2 秒，再缩到左上。
- 1920×1080、1440×900、1366×768 的 record mode 均无横向或纵向溢出。
- 四幕冻结值未改变：Risk `0 / 4 / 20 min`；Collaboration `63 → 7 → A1-201`；Reschedule `5 PASS + 1 WARNING / feasible=true / mutatedData=false`；Insight `Top1 / 56 / 112 / 0 / 4`。

## 自动验证

- Agent Foundation：42/42 通过。
- Agent Regression：197/197 通过；需 Docker 的 PostgreSQL / Redis 段如实标记 UNVERIFIED，其文件与降级路径验证通过。
- AI Competition：通过；其中无密钥提交检查通过。
- Agent Final Convergence：全部通过。
- 4173 Showcase：67/67，生产 build 通过。
- 4174 Judge Portal：13/13，生产 build 通过。
- Cloudflare Pages Functions：Wrangler 4.125.0 生产函数构建通过。
- 程序交付验证：4 agents / 13 tools / 14 bindings / 4 verified heroes，PASS。
- PPT：12 页，PowerPoint 原生打开通过，slides_test 报告 `No overflow detected`。
- DOCX：20 页，Word 原生打开通过，隐私清理移除 1032 个编辑会话标识并清理核心元数据。
- SRT：32 段、时间单调、无重叠、总时长 275 秒，可直接导入剪映 / Premiere。

## 匿名与旧版本扫描

- 扫描范围覆盖最终文本、OOXML 内部 XML、PDF 文本、程序包与构建产物。
- 身份线索、真实学校/学院、代码托管账号、本机用户路径、回环地址、凭据值：0 命中。
- 旧版演示数据版本标识：0 命中。
- 最终材料中旧产品名、旧仓库名与本机工作区名：0 命中。
- PPT 的图片描述路径已清理；最终对外品牌统一为“校园智序·小序”。

## 人工补充项

提交前仍须从腾讯 ADP Console 人工导出并放入 `manual-exports/`：

1. ADP 应用导出 ZIP；
2. CampusTools 自定义插件导出 ZIP；
3. 最终 Widget 导出文件。

同时需要把最终公开体验链接与二维码填入答辩第 12 页，并按镜头表录制最终 REAL ADP 三组真实提问画面。
