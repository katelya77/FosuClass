# REALITY AUDIT｜校园智序·小序终局收尾

审计时间：2026-09-01（Asia/Shanghai）
审计原则：现实运行状态优先于历史说明；动态校园事实仅以 FINAL-TRUTH、CampusTools 确定性结果与标准核验结果为准。

## 1. Git、发布与回滚基线

- 本轮材料工作分支：`final/competition-judge-polish`；首轮 Portal/材料源码提交 `6cbb1021d19ffffad2a10d5888c7361dfb7dbfdd`。
- PR #57 已通过适用检查并合并；合并后的 `origin/main` 为 `c55ef3bc763d75a9dbac52c56b90a2bd56348df0`。
- Portal 生产分支：`deploy/demo-portal`；发布提交 `838510e4fd97b945805dd384bc9d5095c43cc2d6`。
- Cloudflare Pages Deployment ID：`64abc3b1-04f1-4740-889f-c8e32dd2bafd`，状态 `success`。
- 发布前生产回滚点：Git `b60a5749672cb87d548532ff209176693e65c6fa`；对应 Cloudflare Deployment `96d3139a-d7b8-489a-aea3-0ab837fd9f83`。
- 已知收口提交 `6c93d39769855799256ec57ebef957f6ac9feff1` 在历史中，不是当前 HEAD。
- 历史“PR #49 必须保持 OPEN”约束已失效。
- 进入本轮前已有用户改动 `competition/adp-kit/r49-ma/tools/openapi/campus-agent-tools.adp-import.json` 保留原样，未纳入比赛提交。

## 2. 冻结事实与版本

- 材料版本：`FINAL JUDGE PACKAGE`。
- 数据版本：`competition-demo-v3`；摘要 `sha1:842b7959e808`。
- Agent：4 个；CampusTools：13 项；Child bindings：14 组；Main 直接绑定为 0。
- Widget：外层 `1.0`；仓库收口契约 `fosuclass-adp-widget-contract/v7`；Portal 直接渲染 ADP 最新 `Widget.View`。
- 教师风险：0 硬冲突；每周 4 次教学空间转场风险；最短间隔 20 分钟。
- 多人协同：3 位教师；63 间可用教室；7 间满足不少于 120 座；推荐 A1-201（120 座）。
- 模拟调课：`feasible=true`；有提醒；`mutatedData=false`；不写入真实课表。
- 教学洞察：教师025；未来四周 56 课次 / 112 课时。
- `1500+` 仅指底层校园课表服务累计服务用户，不是参赛多智能体用户数。

确定性标准核验：

- `competition/final-delivery/program/tests/verify-delivery.js`：PASS，4 Agent / 13 Tools / 14 bindings / 4 verified heroes。
- `competition/final-delivery/program-final/03程序交付/F_Verification/verify-minimal.js`：PASS，4 / 13 / 14 / 4 Golden Result。

## 3. Portal 构建与正式部署

- 源码位置：`competition/demo-portal/`。
- 正式 URL：`https://adp.katelya.top/`；无需账号。
- 导航：`首页 / 角色与能力 / 已核验案例 / 真实体验`。
- Live 链路：浏览器 → 同源 Cloudflare Function `/api/adp/chat` → 腾讯 ADP SSE → 主协调 → 专业智能体 → CampusTools → Widget.View → Portal。
- Live 失败不会自动冒充 Replay；回放明确标注“已核验演示回放 · 非实时”。
- Portal 测试：6 个文件、26 个测试全部通过；生产构建 2105 个模块通过。
- 依赖安全审计：0 个漏洞；浏览器 Bundle 未发现 Token、Cookie、API Key、内部服务地址或旧 iframe 配置。
- 公网资源指纹：`/assets/index-B_iuf_G1.js` 与 `/assets/index-onljImJR.css` 均 HTTP 200，内容与发布构建一致。

## 4. ADP 公网真实取证

- 学生：3/3 轮 PASS；同一会话依次查询班级第 1 周课表、筛选周三、继续找周三下午空教室；最终命中 `campus_classroom_search`，返回 2026-09-02（周三）与 A1-103。
- 教师协同：1/1 轮 PASS；命中 `campus_group_plan`；最新 Widget 直接呈现 7 间满足 120 座的教室与 A1-201。63 间总可用教室由同数据版本的确定性标准核验单独锁定，不冒充本轮 Widget 文案。
- 模拟调课：1/1 轮 PASS；命中 `campus_reschedule_feasibility`；整体可行、A1-201（120）、存在连续授课提醒、没有修改真实课表。
- 管理下钻：3/3 轮 PASS；同一会话完成最高负载 → 他的课表 → 他的风险；教师025、56/112、0 冲突、4 次转场、20 分钟均在结构化证据中核验。
- 原始脱敏证据：`competition/final-delivery/qa/live-final/evidence/`；仅保存会话 SHA-256 摘要，不保存凭据。

## 5. 公网视口、错误与二维码 QA

- 静态与 Live 合并报告：5 份源报告、4 组 Live、14 个视口记录、11 张要求截图。
- 1920×1080、1600×900、1440×900、1366×768：无横向溢出。
- 移动端 390×844：通过。
- console error：0；page error：0；QA issues：0。
- 二维码解码结果：`https://adp.katelya.top/`；`.url` 指向同一地址。
- 自动截图位置：`competition/final-delivery/qa/live-final/screenshots/`。

## 6. 最终材料

- 答辩 PPT：12 页、16:9；P5 使用真实学生三轮 Live 截图；P7 降低文字密度；P10 标题为“技术创新：让任务接得住，让结果核得清”；P12 为 6 个点击组。
- 设计说明书：20 页；P11 使用“连续追问”；P13 无重复；P17 允许公开评审域名例外；P19 为真实部署现状；P20 使用准确 1500+ 口径。
- 在线体验材料：学生 / 教师 / 教学管理者三角色、四个案例、无需账号、公开 URL 与二维码。
- 作品演示视频未编辑、未重新编码；SHA-256 保持 `A48A1B88E4CA73FE571AD750A601C33C546F50C9D7C7709D4CF9F70080B4024C`。

## 7. 当前源码与线上一致性结论

- 线上 Portal 的运行代码、静态资源与 Cloudflare Function 来自发布提交 `838510e4fd97b945805dd384bc9d5095c43cc2d6`。
- `main` 中对应的运行时 `src/`、`public/`、`functions/` 与发布版本一致；发布后新增改动仅涉及 QA 脚本、证据与最终材料生成，不改变线上运行 Bundle。
- 当前无生产 blocker；如线上关键探针失败，回滚到 `b60a5749672cb87d548532ff209176693e65c6fa` 对应部署。
