# ADR-0001: Keep Native WeChat Mini Program

## Status

Accepted

## Context

FosuClass 已上线为原生微信小程序，深度绑定微信能力、缓存策略与 Release Pack 读取路径。

## Decision

保留原生微信小程序；不迁移到 uni-app 或 Taro。

## Consequences

- 用户端稳定，Tier 0 读路径不变
- 后台与小程序可独立演进
- 不享受跨端框架抽象，但避免重写风险
