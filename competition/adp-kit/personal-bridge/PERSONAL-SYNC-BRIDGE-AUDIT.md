# 个人课表导入/同步桥接审计（PERSONAL-SYNC-BRIDGE-AUDIT）

> CSF Phase 4 交付审计：ADP「小序」如何安全地承接个人课表导入/同步意图。
> 结论先行：**ADP 不做直连导入**；只做意图识别 + 安全导航 + 诚实状态查询。

## 1. 现实资产盘点（复用而非新建）
- 小程序端既有「个人同步」页：`miniprogram/pages/personal-sync/`，提供学号导入
  （分步预览、推荐/待确认/未排入/疑似四桶整理）、文件导入、班级课表、手动编辑与历史复用。
- 服务端既有导入通道：`server/src/routes/fosuApaasImport.js`，端点族：
  `public-key`（创建公钥挑战）、`preview/start`、`preview/status`、`preview`、
  `recent`、`recent/confirm`、`confirm`、`cancel`。
- 凭据加密：客户端 `miniprogram/services/fosuStudentImportCrypto.js`（
  `encryptCredentialPayload`，SM2/RSA 混合），服务端
  `services/fosuApaasImportSessionStore.js`（`createPublicKeyChallenge`）。
- 会话校验：服务端 `verifySessionTokenDetailed` + `x-fosu-session` 通道。

## 2. 为什么 ADP 不能直连导入
- ADP 运行环境没有已验证的 Session（无 `x-fosu-session` 票据来源），无法通过
  服务端会话校验，也不具备安全保存挑战密钥的空间。
- 直连导入等于把学号密码交给未受信通道，违反「凭据零接触」约束。
- 因此桥接边界 = 导航 + 状态查询；导入本身永远发生在小程序端既有加密通道。

## 3. 桥接模块（`competition/adp-kit/personal-bridge/`）
- `classifyPersonalScheduleIntent(text)` → `import / bind / resync / change_source / status / null`。
- 写操作（import/bind/resync/change_source）→ `requiresConfirm=true`，对应授权等级 L3；
  状态查询（status）→ L1 只读。
- `buildBridgeMessage(intent)`：写操作消息要求确认 + 指向小程序端「个人同步」页 +
  提示凭据只走加密通道；状态消息诚实声明「无法直接读取本地状态，以小程序端为准」，
  **绝不宣称已导入/已同步**。

## 4. 权限与确认（与 Phase 5 授权模型一致）
- L3 写操作必须先确认；`authority.js` 的 `assertNoL3AutoRun` 保证主协调主动性不绕过。
- 确认前只读引导；确认后由小程序端既有通道执行，Agent 不代收凭据。

## 5. 安全声明
- 明文凭据（学号密码、Cookie、Token、登录票据、挑战密钥）绝不进入对话、知识库、
  Trace、日志与测试快照。
- 桥接消息不含内部 API 路径、内部 URL、Provider 信息。
- 绑定/同步状态以小程序端实际状态为准；未核验时如实说明，禁止伪报成功。

## 6. 验证
- `node --test r49-ma/tests/test-csf-personal-bridge.js`（P1–P8，GREEN）。
- 权限联动：`node --test r49-ma/tests/test-csf-authority-model.js`（A1–A7，GREEN）。

## 7. 回滚
- 桥接模块与测试均在 git 版本控制内；删除 `personal-bridge/` 与两个测试文件即可
  完全回退，不影响小程序端与服务端既有通道。