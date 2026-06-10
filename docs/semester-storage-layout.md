# 学期存储布局

按学期隔离的存储位于 `storage/terms/{term}`。目录名必须先通过 term id 校验，避免非法路径进入存储层。

```text
storage/
  term-registry.json
  terms/
    2025-2026-2/
      catalog.json
      majors-index.json
      sync-meta.json
      snapshot-meta.json
    2026-2027-1/
      catalog.json
      majors-index.json
      sync-meta.json
      snapshot-meta.json
  releases/
    active.json
    term-index.json
    {releaseVersion}/
      manifest.json
```

## 读写规则

- 请求学期 A 时，只读取学期 A 的存储。
- 缺失的学期存储不会回退到其他学期。
- 旧版全局 `catalog.json`、`majors-index.json` 和 `sync-meta.json` 只在兼容旧当前学期时读取。
- 新学期数据写入学期存储和 Release Pack，不再写入旧版全局文件。
- API 响应应包含 `term`、`releaseVersion`、`dataAvailable` 和 `updatedAt`，方便前端和后台判断数据来源。

## 常见错误码

- `TERM_NOT_FOUND`
- `TERM_NOT_PUBLISHED`
- `TERM_DISABLED`
- `TERM_CONFIG_INCOMPLETE`
- `TERM_DATA_MISSING`
- `TERM_DATA_MISMATCH`
