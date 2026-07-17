# ADR-0004: Release Pack Remains the Data Plane

## Status

Accepted

## Context

课表读路径依赖 Release Pack、静态同步、Active Pointer 与 Last-known-good，已在生产验证。

## Decision

继续以 Release Pack 作为课表数据平面。PostgreSQL 仅作为未来控制平面（审计、作业、配置），不一次性迁移全部 JSON。

## Consequences

- Tier 0 链路不变
- 控制面可后续增强而不阻塞发布
- 需继续维护文件一致性与原子激活
