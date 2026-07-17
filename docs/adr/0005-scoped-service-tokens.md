# ADR-0005: Scoped Service Tokens

## Status

Accepted

## Context

`ADMIN_API_TOKEN` 当前等价于全权管理员，同步工具可访问无关写接口。

## Decision

引入 scoped service tokens，并兼容旧 token 映射为 `admin:full`：

```text
staging:init, staging:chunk, staging:finalize,
release:build, release:publish,
static:sync, static:verify,
relay:manage, admin:full
```

Cookie 会话保持 CSRF；浏览器写操作不得依赖“token 免 CSRF”漏洞。

## Consequences

- 最小权限
- 需更新 publisher/sync-client 文档与验收测试
- 旧 token 过渡期仍可用但记审计
