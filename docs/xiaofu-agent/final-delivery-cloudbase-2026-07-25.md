# 小佛助手核心可交付版本 — 最终交付报告

日期：2026-07-25  
分支：`release/xiaofu-final-cloudbase-agent`  
基线 main：`2476c3d53906f750181809870a655a31243c577b`（PR #31）

## 状态分离（禁止混为一谈）

| 层级 | 状态 | 证据 |
|------|------|------|
| 代码已存在 | ✅ | 本分支改动 + 新测试 |
| 单元测试通过 | ✅ 核心套件；全量 gate 见 CI 日志 | `test:xiaofu-final-suite`、open-schedule、AG-UI、Coze adapter、college、UI |
| 云函数已部署 | ✅ | `aiVoiceTranscribe`、`xiaofuAgentGateway` 部署完成（cloud1-d3g17rpe7566d3d5c） |
| 生产接口已通过 | ⏳/部分 | VPS/GHCR 视 CI 与部署密钥；Agent 主链仍为 VPS |
| 小程序已上传 | ⏳ | 需 miniprogram-ci 私钥；本机未自动正式上传 |
| 真机已验证 | ❌ | 未做真机；开发者工具截图受环境限制 |

## 根因

1. **班级课表误判**：`goalParser` 已定义 `open_schedule`，但 `resolveIntent` 只消费 `set_current_schedule`；查询兜底默认 teacher。  
2. **实体锁缺失**：工具缓存键未含 entityType，replan 可串类型。  
3. **教师学院筛选**：索引/搜索对 `collegeCodes[]` 支持不足；职称无数据仍展示。  
4. **UI**：`padding-bottom:200rpx` + fixed composer 双占位；状态岛 detail 使用白色半透明字；面板无统一防穿透。  
5. **AG-UI / Coze 异步**：无 AG-UI 映射；async task 结果在 `result.messages[].content`，旧解析读不到。

## 修改文件（摘要）

- `server/src/services/ai/toolRegistry.js` — `buildOpenScheduleIntent` + 路由  
- `server/src/services/ai/planner/goalParser.js` — GoalContract 字段、泛型实体保护  
- `server/src/services/ai/planner/toolResultCache.js` — entityType/scope 缓存键  
- `server/src/services/ai/agentRunState.js` — 有界 loop 钩子  
- `server/src/services/ai/aguiAdapter.js` + `routes/ai.js` POST `/agent/agui`  
- `server/src/services/ai/providers/cozeAgentAdapter.js` + `cozeProvider.js` env  
- `server/src/services/releaseService.js` — 教师学院派生、collegeCodes 过滤  
- `miniprogram/packageXiaofu/pages/ai-assistant/*` — flex 布局、token 色、modal 防穿透  
- `miniprogram/pages/school/*` — 学院切换清缓存、职称条件显示  
- `cloudfunctions/xiaofuAgentGateway/*`、`cloudbaserc.json`  
- 测试：`tools/test-open-schedule-goal.js` 等 6 个 + release gate 接入  

## SHA

- feature SHA：`719148c963962748638116475fa14c2c12ab1271`  
- merge SHA：`7b3df6ffb02f60a8c6e874bb96051ad75415f477`（PR #32）  
- PR：https://github.com/katelya77/FosuClass/pull/32  
- CI：Admin CI ✅ · Xiaofu Agent CI ✅ · Deploy to VPS ✅ · GHCR ✅

## 关键验收

### 打开24动物医学1班的课表

```
goal=open_schedule, entityType=class, entity=24动物医学1班
→ search_school_index {type:class, preferredId, lockedEntityType:class}
→ get_schedule_detail {type:class, id}
→ navigate 打开课表 Action
```

实测：unique preferredId + detail success（本地 Release Pack）。

### Coze

- stream_run：✅ 用 `server/.env` COZE_API_KEY 实测 answerLen=2  
- async_run + task 轮询：✅ task completed，解析 `result.messages` AI content  
- Downloads/token.txt：❌ 401 invalid（非生产会话；勿共享）  
- 401/429/5xx/abort：✅ 单元覆盖  

### CloudBase

- `aiVoiceTranscribe`：部署完成  
- `xiaofuAgentGateway`：部署完成  
- ASR 密钥：本地/云函数环境 **未找到** `TENCENT_ASR_*`；**人工阻塞** — 需 CAM 创建最小权限密钥写入云函数 env 后才能真音频与 `AI_VOICE_INPUT_ENABLED=true`  

### 教师学院

- **读路径派生**：`readActiveIndex('teacher')` 在索引缺学院字段时，从教师课表明细 courses 的 collegeCode/collegeName + 班级索引派生（`enrichTeacherIndexItemsOnRead`），不依赖重建 Release Pack。  
- 实测（active `26.05.29.22`）：全校 20 人；`collegeCode=04`（动物科技学院）→ 3 人（白银山/白志红/曹嫦妤）；`collegeCode=02` → 3 人；未选学院 → 20；假学院 → 0。  
- searchActiveIndex 支持 collegeCode / collegeCodes[]  
- 缓存键含 collegeCode（stableParamHash）  
- 切换学院清 teachersResult  
- 无职称数据时 `titleFilterEnabled=false` 隐藏控件  
- 证据：`tools/test-teacher-college-filter.js` + scratch `teacher-college.log`

### UI

- 去掉 200rpx 双占位；composer flex 贴底  
- 状态文字 `--xf-text-strong/secondary/faint`  
- sheet 打开时 `scroll-y=false` + mask `catchtap/catchtouchmove`  

## 阻塞项

1. **ASR SecretKey 未配置**（腾讯云不可回读旧 Key；需一次性创建并写入云函数）  
2. **VPS/GHCR 生产部署**依赖仓库 Secrets / Actions  
3. **体验版上传**依赖 miniprogram-ci 私钥  
4. **微信开发者工具截图**本环境未挂载  

## 回滚

```bash
git checkout main && git pull --ff-only
# 或 revert merge commit
tcb fn deploy <previous>  # 云函数回滚上一版本
```

主链仍为 VPS Agent API；CloudBase 网关失败不影响主路径。

## Runtime Fingerprint / 包体积

见 CI `release:preflight` / `test:miniprogram-package-hygiene` 输出（gate 日志）。
