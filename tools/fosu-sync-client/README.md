# FosuClass 本地同步客户端

`fosu-sync-client` 是唯一允许抓取 `100.fosu.edu.cn` 的组件。请在已连接校园网或 VPN 的 Windows 本机运行。服务器只接收 Staging、校验、构建 Release、同步静态文件和切换 runtime pointer。

不要提交 Cookie、密码、JSESSIONID、CAS ticket、Session、Token、原始 HTML 或真实课表缓存。

## 常用命令

日常同步：全部动态课表

```powershell
npm run sync:daily -- --term=2025-2026-2
```

日常同步：班级课表

```powershell
npm run sync:daily:classes -- --term=2025-2026-2
```

日常同步：教师课表

```powershell
npm run sync:daily:teachers -- --term=2025-2026-2
```

日常同步：教室课表

```powershell
npm run sync:daily:classrooms -- --term=2025-2026-2
```

日常同步：课程课表

```powershell
npm run sync:daily:courses -- --term=2025-2026-2
```

上传本地暂存文件

```powershell
npm run sync:upload-staging -- --file=.\staging\2025-2026-2-full.json --term=2025-2026-2
```

恢复中断任务

```powershell
npm run sync:resume -- --run-id=RUN_ID
```

## 上传摘要

完整 Snapshot 上传时不再显示无意义的 `itemCount: 0`。CLI 会输出：

- 班级课表
- 行政班
- 专业聚合
- 教师目录
- 教师课表
- 教师课程事件
- 教室目录
- 教室课表
- 课程目录
- 课程课表
- 实际 100 网请求数
- 是否读取旧动态缓存
- 教师数据质量

## 教师直抓诊断

如果 100 网教师页没有教师下拉框，客户端可能只能发现学院下拉框。此时按学院请求 `/kbcx/kbxx_teacher_ifr` 得到的 `teacherName` 可能被班级名、课程名或“临班”污染。客户端会保留 Staging 诊断数据，但写入：

```json
{
  "targetDiscoveryMode": "college-select",
  "discoveredTeacherTargets": null,
  "coverageStatus": "invalid",
  "publishable": false
}
```

不要把学院请求数当成教师人数，也不要把旧线上 1007 当成本次实时发现候选数。

## 学期配置

解析优先级：

1. 显式 `--total-weeks`
2. 同学期 Term Registry
3. 已验证本地 Term Config
4. 新学期无配置时报错

当前 `2025-2026-2`：

```json
{
  "termStartDate": "2026-03-09",
  "weekStart": "monday",
  "totalWeeks": 19
}
```

CLI 与 Registry 冲突时默认采用 Registry。只有 `--override-term-config` 才允许覆盖。

## 缓存与运行产物

本机运行目录不会提交：

```text
tools/fosu-sync-client/.cache/
tools/fosu-sync-client/.debug/
tools/fosu-sync-client/.session/
tools/fosu-sync-client/staging/
staging/
```

测试需要样本时只能新增小型脱敏 fixture，不得复制真实 `.cache` 文件。
