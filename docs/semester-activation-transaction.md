# 学期激活事务

学期激活由 `server/src/services/semesterActivationTransactionService.js` 管理。

## 激活前备份

激活前会备份以下文件：

- `releases/active.json`
- `snapshots/current.json`
- `snapshots/current.json.gz`
- `releases/term-index.json`
- `term-registry.json`
- `admin-config.json`
- `public/runtime/active.json`

## 阻断条件

以下任一条件成立时，事务会阻止激活：

- 目标学期不存在。
- 目标学期不是 `ready` 或 `current`。
- registry 中的 release version 与请求的 release 不一致。
- release manifest 中的 term 与目标学期不一致。
- Release Pack 快速健康检查未通过。
- 必需的静态 Release 文件缺失。

## 失败恢复

如果任意写入失败，系统会恢复所有已备份文件并清理缓存。激活请求通过进程内队列串行执行，避免并发激活导致状态覆盖或丢失更新。
