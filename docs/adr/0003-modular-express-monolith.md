# ADR-0003: Modular Express Monolith

## Status

Accepted

## Context

`admin.js` 超 6k 行，领域混杂，存在重复路由与过大 token 权限。微服务会引入运维复杂度，与单机 Oracle ARM 部署不匹配。

## Decision

保持 Express 单体；按领域拆到 `server/src/modules/*`；不采用 NestJS 全面迁移或微服务。

## Consequences

- 可渐进拆分、保留 API 兼容
- 需要纪律与架构守卫防止文件回胀
- TypeScript 仅优先新模块与 contract
