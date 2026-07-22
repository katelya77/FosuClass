# 小佛助手全宽工作台与微信服务通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成全宽小佛助手 UI、设置页提醒入口、一次性微信服务通知额度管理、安全发布配置与端到端验证。

**Architecture:** 复用现有小程序提醒客户端、提醒面板、Session 安全路由、加密提醒分片和微信订阅发送服务。新增的授权额度属于提醒状态，不成为新的身份或事实源；GitHub Actions 是唯一生产发布路径。

**Tech Stack:** 微信小程序 WXML/WXSS/JavaScript、Node.js/Express、AES-GCM 文件状态、GitHub Actions、微信订阅消息 HTTP API。

## Global Constraints

- `public/release` 外部模型调用次数必须为 0。
- 课程事实只来自 Release Pack、个人课表摘要和确定性 Tool。
- 订阅授权必须由真实用户点击触发，不得声称永久推送。
- 不记录 AppSecret、OpenID、学号凭据、Token 或原始课表。
- 生产发布只使用现有 GitHub Actions，不直接修改 VPS 文件。

---

### Task 1: 全宽工作台与设置页入口

**Files:**
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js`
- Modify: `miniprogram/pages/settings/settings.wxml`
- Modify: `miniprogram/pages/settings/settings.js`
- Test: `tools/test-xiaofu-full-width-reminder-entry.js`

**Interfaces:**
- Consumes: assistant query option `panel`
- Produces: `goSmartCourseReminders()` and `panel=reminders` deep link

- [ ] **Step 1: Write the failing test**

```js
assert.match(settingsWxml, /bindtap="goSmartCourseReminders"/);
assert.match(settingsJs, /panel=reminders/);
assert.match(assistantJs, /options\.panel.*reminders/);
assert.match(assistantWxss, /button\.proactive-insight[\s\S]*width:\s*100%/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-xiaofu-full-width-reminder-entry.js`
Expected: FAIL because the setting entry and explicit full-width override do not exist.

- [ ] **Step 3: Implement the minimal behavior**

```js
goSmartCourseReminders() {
  wx.navigateTo({ url: "/packageXiaofu/pages/ai-assistant/ai-assistant?panel=reminders" });
}
```

Assistant `onLoad` sets `showReminderSheet: true` when the decoded panel name is `reminders`. WXSS uses a 16rpx phone content rail and explicit `width: 100%; max-width: none; margin-left: 0; margin-right: 0` for task cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-xiaofu-full-width-reminder-entry.js`
Expected: PASS.

### Task 2: 一次性订阅授权额度

**Files:**
- Modify: `server/src/services/ai/reminders/courseReminderService.js`
- Modify: `server/src/routes/ai.js`
- Modify: `miniprogram/services/courseReminderClient.js`
- Test: `tools/test-course-reminder-authorization-credits.js`

**Interfaces:**
- Consumes: `{ principal, reminderId, subscriptionStatus, idempotencyKey }`
- Produces: `grantSubscriptionAuthorization(input)` and public `authorizationCredits`

- [ ] **Step 1: Write the failing service/API test**

```js
const granted = service.grantSubscriptionAuthorization({
  principal,
  reminderId: created.reminder.id,
  subscriptionStatus: "accept",
  idempotencyKey: "grant-1",
});
assert.strictEqual(granted.reminder.authorizationCredits, 2);
assert.strictEqual(service.grantSubscriptionAuthorization(sameInput).duplicate, true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-course-reminder-authorization-credits.js`
Expected: FAIL because the grant method and API route are absent.

- [ ] **Step 3: Implement encrypted, idempotent credit updates**

Create accepted reminders with one credit, rejected reminders with zero. Add `POST /api/ai/agent/reminders/:reminderId/subscription-authorizations`, require Session, accept only `accept`, cap credits at 30, and retain the last 100 operation hashes.

- [ ] **Step 4: Run service/API/client tests**

Run: `node tools/test-course-reminder-authorization-credits.js`
Expected: PASS, including duplicate protection and rejection handling.

### Task 3: 可靠发送、额度消耗和应用内兜底

**Files:**
- Modify: `server/src/services/ai/reminders/courseReminderDispatchService.js`
- Modify: `server/src/services/ai/reminders/courseReminderService.js`
- Modify: `server/src/services/ai/reminders/wechatSubscriptionService.js`
- Test: `tools/test-course-reminder-delivery-fallback.js`

**Interfaces:**
- Consumes: WeChat send result `{ success, code, retryable }`
- Produces: exactly-once credit consumption and deterministic in-app event fallback

- [ ] **Step 1: Write failing delivery tests**

```js
assert.strictEqual(afterSuccess.reminder.authorizationCredits, 0);
assert.strictEqual(afterUnauthorized.inAppEvents.length, 1);
assert.strictEqual(afterRetryExhaustion.inAppEvents.length, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-course-reminder-delivery-fallback.js`
Expected: FAIL because credits are not consumed and terminal WeChat failures do not enqueue the inbox event.

- [ ] **Step 3: Implement terminal fallback**

Treat zero credits as `APP_ONLY_DUE`. On success decrement one credit. For non-retryable WeChat rejection or exhausted retry budget, enqueue the deterministic in-app event, mark authorization required where applicable, and advance the recurrence instead of silently ending the reminder.

- [ ] **Step 4: Run delivery tests**

Run: `node tools/test-course-reminder-delivery-fallback.js`
Expected: PASS with one event and no duplicate event on repeated dispatch recording.

### Task 4: 提醒管理页补充微信授权

**Files:**
- Modify: `miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.js`
- Modify: `miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.wxml`
- Modify: `miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.wxss`
- Test: `tools/test-course-reminder-ui.js`

**Interfaces:**
- Consumes: reminder capability, `requestWechatSubscription`, `grantSubscriptionAuthorization`
- Produces: visible quota label and user-tap authorization button

- [ ] **Step 1: Extend the UI contract test and verify failure**

Assert the sheet contains “微信服务通知”, `authorizationCredits`, and `onGrantSubscription`; run `node tools/test-course-reminder-ui.js` and expect failure.

- [ ] **Step 2: Implement user-tap grant flow**

The button first fetches capability, calls `wx.requestSubscribeMessage`, then sends an idempotent grant only on `accept`. Reject/ban states keep app-only fallback and show truthful Chinese copy.

- [ ] **Step 3: Run UI and compile checks**

Run: `node tools/test-course-reminder-ui.js && npm run test:miniprogram-compile-preflight`
Expected: both PASS.

### Task 5: 配置、完整验证与受控发布

**Files:**
- Modify: `.github/workflows/deploy-vps.yml`
- Modify: `docs/github-actions-env-contract.md`
- Modify: `docs/xiaofu-agent/course-task-agent-v1.md`

**Interfaces:**
- Consumes: GitHub Secrets/Variables and existing Deploy to VPS workflow
- Produces: reproducible production environment and rollback evidence

- [ ] **Step 1: Generate independent Agent secrets without printing values**

Use cryptographic random input piped directly to `gh secret set` for the three Agent secrets. Set safe non-secret reminder variables; keep dispatch disabled until the real template is configured.

- [ ] **Step 2: Run all required verification**

Run foundation, regression, competition, final-convergence, phase2, phase3, release preflight, secret scan, compile preflight and package hygiene. Every command must exit 0.

- [ ] **Step 3: Commit and publish intentionally**

Stage all scoped files except `server/data/ai/kb-audit.jsonl`, commit with `feat: ship xiaofu course task agent`, push the branch and create a ready PR to `main`.

- [ ] **Step 4: Merge only after CI succeeds and monitor deployment**

Use GitHub checks to wait for CI, merge through GitHub, then watch the `Deploy to VPS` run through health checks. Do not bypass a failing check.

- [ ] **Step 5: Verify production truthfully**

Check `/health`, Agent readiness, public zero-provider behavior and reminder capability. A real service-notification send is complete only after the account administrator supplies the approved template metadata and a phone accepts the subscription prompt.
