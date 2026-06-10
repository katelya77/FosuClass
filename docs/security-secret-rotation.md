# 安全密钥轮换

## Session token secret

1. 将旧的当前值写入 `FOSU_SESSION_SECRET_PREVIOUS`。
2. 将新值写入 `FOSU_SESSION_SECRET_CURRENT`。
3. 修改 `FOSU_SESSION_SECRET_KID`。
4. 部署服务。
5. 等待超过 `FOSU_SESSION_TTL_SECONDS` 的时间。
6. 移除 `FOSU_SESSION_SECRET_PREVIOUS`。
7. 再次部署。

## Static ticket secret

1. 将旧的当前值写入 `FOSU_STATIC_TICKET_SECRET_PREVIOUS`。
2. 将新值写入 `FOSU_STATIC_TICKET_SECRET_CURRENT`。
3. 修改 `FOSU_STATIC_TICKET_SECRET_KID`。
4. 部署服务。
5. 等待超过 `FOSU_STATIC_TICKET_TTL_SECONDS` 的时间。
6. 移除 `FOSU_STATIC_TICKET_SECRET_PREVIOUS`。
7. 再次部署。

## 规则

- 不要复用 `ADMIN_API_TOKEN` 作为 session 或 static ticket secret。
- 不要在 GitHub Actions 日志中输出任何密钥值。
- 生产环境启用 `session` 或 `ticket` 模式时，如果缺少必要密钥，部署校验必须失败。
- `observe` 模式允许带警告启动，以保证 last-known-good 继续可用。
