# R4 Rollback

- R4 仅新增版本化 Workflow；不删除历史 baseline，不修改已发布 Workflow 名称。
- 若任一 R3 Runtime 失败，在应用 Router 中停用对应 R3，恢复当前已验证的历史 Workflow reference。
- Schedule 继续保留真实 Widget `23fbc659efe3482fab588d754e4420a4`；不要用 05 Pilot 覆盖它。
- 05 在获得当前赛事空间真实导出 ID 前保持未启用；删除/停用 Pilot reference 即完成回滚。
- 回滚不涉及 production 数据、VPS、CloudBase、微信小程序或 main。
