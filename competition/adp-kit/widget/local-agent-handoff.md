# Widget V2 本机 Agent 收尾任务

把本文件直接交给 Kimi Code / Codex 执行。目标是验证并收口已经写入 `feat/campusflow-adp-integration` 的 Widget V2，不重新设计架构。

## 当前约束

- PR #49 保持 open、未 merge。
- 不修改 01–04 冻结事实逻辑。
- 不部署生产环境。
- 不触碰 CloudBase token。
- Widget 动态事实必须来自 CampusTools verified envelope。
- GitHub Actions 当前因账户 Billing/Spending Limit 无 runner，不能把远端红灯当成代码失败。

## 1. 同步

```bash
git status --short
git branch --show-current
git fetch origin
git pull --ff-only origin feat/campusflow-adp-integration
```

如果有用户未提交修改，不覆盖、不 reset --hard。

## 2. 先跑 Widget 最小门禁

```bash
node competition/adp-kit/widget/test-widget-adapter.js
```

必须 PASS，并看到：

```text
Widget adapter contract tests passed: 6 card types + verified/action safety gates
```

失败时遵循 TDD：先保留失败证据，只修 `competition/adp-kit/widget/` 范围内的真实缺陷，不改 CampusTools 事实算法来迁就 UI。

## 3. 生成确定性 Widget 样例

```bash
node competition/adp-kit/widget/generate-samples.js
```

然后检查：

```bash
git diff -- competition/adp-kit/widget/sample-results.json competition/adp-kit/widget/sample-results.js
```

要求：

- 六种 cardType 都有 `schemaVersion: campus-widget/v2`；
- schedule/classroom/conflict/day_plan 为 `verified=true`；
- Action 最多 3 个；
- 不出现 token / Authorization / NodeID / VarBizID；
- 动态课程/教室数据必须来自生成器，不手工改样例事实。

## 4. 跑合同校验

```bash
node competition/adp-kit/validate-kit.js
```

必须 PASS。

## 5. 本地视觉预览

```bash
node competition/adp-kit/widget/serve.js
```

在浏览器检查六类卡片。若本机有 Playwright/browser automation，建议自动截图：

- 390x844
- 430x932
- 768x1024

每个尺寸检查：

- 无横向溢出；
- 按钮不截断；
- Schedule 首屏可快速看到节次/课程/地点；
- Classroom filters chips 清晰；
- Conflict 红色冲突与橙色赶场视觉不同；
- Day Plan 时间轴最有展示感；
- Choice 候选可点击；
- Error 明确是恢复任务，而不是工程报错页；
- 不出现典型 AI 紫色渐变/机器人聊天卡风格。

不要为了截图修改动态事实。

## 6. 更新资产清单和完整 Gate

```bash
node competition/adp-kit/sync-assets-manifest.js
npm test --prefix competition/adp-kit
```

如果 full gate 因生成 submission package 产生合法变化，按仓库既有 generate/check 流程处理，不手工伪造 manifest/hash。

最后：

```bash
git diff --check
git status --short
```

## 7. 提交范围

只提交本轮真实生成/必要修复：

- `competition/adp-kit/widget/sample-results.json`
- `competition/adp-kit/widget/sample-results.js`
- `competition/adp-kit/reports/generated-assets-manifest.json`
- 因完整 generate/build 流程确定性变化的赛事 submission 生成物
- 如果测试发现真实 Widget 缺陷，提交对应 widget 源码/测试修复

不要提交：

- token
- `.tmp`
- 浏览器缓存
- 本地 node_modules
- 真实学校/身份数据
- ADP seed 中可能含的环境密钥

建议 commit：

```bash
git add <真实变化文件>
git commit -m "test(competition): verify widget v2 productization"
git push origin feat/campusflow-adp-integration
```

## 8. 汇报格式

请输出：

```text
Git
- start head:
- end head:
- commit:

Widget Gate
- adapter tests:
- generate samples:
- validate-kit:
- full npm test:
- git diff --check:

Visual
- 390x844:
- 430x932:
- 768x1024:
- overflow issues:
- cards checked: schedule/classroom/conflict/day_plan/choice/error

Generated
- sample-results updated: yes/no
- assets manifest updated: yes/no
- submission outputs updated: yes/no

Blockers
- GitHub Actions billing still blocked: yes/no
- ADP native Widget seed still pending: yes/no
```

不要把“没有运行”写成 PASS。
