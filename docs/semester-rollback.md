# 学期回滚

学期回滚依赖 `term-index` 中记录的上一版 Release，以及当前 active 指针的备份文件。

## 自动回滚

激活流程会在写入前备份以下文件：

- previous `releases/active.json`
- previous `snapshots/current.json`
- previous `snapshots/current.json.gz`
- previous `releases/term-index.json`

如果激活过程中 registry、term-index、snapshot 或 active pointer 任一步更新失败，系统会恢复到之前状态。

## 手动回滚

1. 打开 Admin Console。
2. 在 `学期管理` 中检查上一学期和回滚 Release 的 readiness。
3. 如有需要，先绑定回滚 Release。
4. readiness 通过后，再激活上一学期。
5. 验证 app-config、active release manifest、term-index 和 OpenResty static manifest 是否一致。

## 保留规则

Registry 和 term-index 引用会被 pin 住：

- 当前学期保留 active release，并在可用时至少保留两个回滚候选。
- 每个已归档学期至少保留一个健康 Release。
- ready/planned 学期保留已绑定的候选 Release。
- 未绑定、未 pin 且已过期的 Release，可在维护 dry-run 确认后清理。
