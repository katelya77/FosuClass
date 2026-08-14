# R5 Rollback

1. 若 05 Runtime 失败，仅从应用 Router 停用 `05-校园教学态势-R1`；不要删除真实 Widget 或历史 Workflow。
2. 01～04 R3 ZIP 与 R4 实机结构保持 byte-stable，可继续作为稳定基线。
3. 若应用路由竞争，按 Activation Matrix 关闭旧 baseline / Final / RuntimeSafe 中间版本引用。
4. 回滚不涉及 production 数据、VPS、CloudBase、微信小程序、main 或正式 ADP 发布。
