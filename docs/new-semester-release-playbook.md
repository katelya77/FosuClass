# 新学期发布手册

在管理员填写确认过的开学日期，并且健康 Release 已存在之前，不要激活未来学期。

## 1. 创建学期

在 Admin Console 打开 `学期管理`，创建 planned 学期：

- `term`：`2026-2027-1`
- `semesterText`：可留空，由系统自动生成
- `termStartDate`：管理员确认过的日期
- `totalWeeks`：管理员确认过的总周数
- `weekStart`：`monday`

新学期会保持 `planned` 状态。数据发布前，普通查询不可访问该学期。

## 2. 采集数据

运行同步 CLI，并显式传入学期配置：

```bash
npm run sync:local-campus -- \
  --term=2026-2027-1 \
  --term-start-date=2026-09-07 \
  --total-weeks=20 \
  --fresh
```

上面的日期只是示例。CLI 不应猜测未来学期日期，必须由管理员按校历确认。

## 3. 上传与审核

通过现有 Staging 上传流程上传 JSON。Staging JSON 必须包含顶层 `termConfig`，旁路元数据包含 `term` 和 `termConfigHash`。

在 Admin Console 中检查条目数量、hash、warning 和学期一致性。新学期 Staging 不应覆盖当前学期 catalog 文件。

## 4. 构建并绑定 Release

发布非当前学期时，系统会构建一个带学期信息的 Release，并将目标学期标记为 `ready`。此时不会更新 `releases/active.json`。

切换前检查会验证：

- staging term
- snapshot term
- catalog term
- resources term
- manifest `termConfig`
- registry term
- Release Pack health
- OpenResty static manifest

## 5. 激活

在 `学期管理` 中运行 readiness 检查，通过后再激活。确认弹窗应展示旧学期、新学期、releaseVersion、开学日期、总周数、数据数量、OpenResty 状态和回滚目标。

激活会更新 registry、term-index、active.json、current snapshot、app-config 和静态 Release 指针。如果失败，系统会恢复之前的 active 状态。
