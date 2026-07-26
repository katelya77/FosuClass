# 小佛助手统一模型优先链路：实施任务

## 阶段 1：审计与红灯测试

- [x] 核对 main 基线、未提交改动与既有链路。
- [x] 运行 mandatory/Phase 2/Phase 3 与 Teacher/Voice/Receipt/UI 定向基线测试。
- [x] 输出根因、需求与设计事实源。
- [x] 添加严格 GoalContract 单元测试：额外字段、toolName、非法 Goal、confidence、约束裁剪。
- [x] 添加请求级 Provider 优先级测试，稳定复现全局 Chain 污染。
- [x] 添加 model-first 调用顺序和 public 零 Provider 测试。
- [x] 添加 Follow-up/Working State/Receipt 集成测试。
- [x] 添加 Understanding RunEvent 与 UI 真相流测试。

## 阶段 2：服务端统一链路

- [x] 实现 strict GoalContract validator/normalizer。
- [x] 实现统一 Structured Provider 调用，覆盖 Hunyuan3/DeepSeek/Coze。
- [x] 修复请求配置优先级、Coze 显式禁用与诊断隔离。
- [x] 实现 UnderstandingService 与 Manifest GoalResolver。
- [x] 在 Agent Kernel 前接入 Understanding，保留安全前置与 public policy adapter。
- [x] 扩展 Working Memory 与 agent.v2 响应，保持 agent.v1 兼容。
- [x] 增加 Understanding RunEvent/AG-UI 映射。

## 阶段 3：搜索、语音、Action 与 UI 收敛

- [x] 证明 Agent Teacher Goal 复用共享 Teacher Search Contract。
- [x] 证明教师/班级/教室/课程统一 schedule-view 导航。
- [x] 证明设置当前课表只有 Receipt 后提交状态。
- [x] 证明语音状态与五类失败原因，真实转写只填 composer。
- [x] 移除客户端预猜 Understanding，消费服务端真实事件。
- [x] 保持全宽状态岛、单 composer、实测 composerInset 与无多余留白。
- [x] 修复 Phase 2 文档审计的过期文件引用并收敛文档索引。

## 阶段 4：验证与交付

- [x] 运行新增定向测试并完成 mutation check。
- [x] 运行 Agent Foundation / Regression / AI Competition / Final Convergence。
- [x] 运行 Phase 2 / Phase 3 与模块直接相关测试。
- [x] 完成小程序编译预检、包体、隐私、UI 几何与交互静态检查。
- [ ] 执行微信 DevTools/体验版真机验证；未执行前不得声称真机通过。
- [ ] 提交、推送、创建 Draft PR，修复 CI，转 Ready 并按保护规则合并。
- [ ] 完成 VPS/GHCR/CloudBase 非生产部署门禁与实际部署；生产发布保持禁止。
- [ ] 能力与凭据允许时上传体验版；不得把上传/部署描述为真机通过。
- [ ] 输出测试、部署、阻塞、回滚与 12 项交付报告。
