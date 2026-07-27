# Agent 平台化 M1 进度记录

- 2026-07-28T02:47:52+08:00 T1 测试文件初版完成：tools/test-provider-control-plane.js（断言组 ①—⑤，分组 run 函数 + GROUPS 数组，可续写 T2）。
- 2026-07-28T02:48:15+08:00 首次运行 `node tools/test-provider-control-plane.js`：5/5 组 PASS，exit=0，无红灯、无疑似实现缺陷，未改动任何业务代码。
- 2026-07-28T02:48:15+08:00 定稿验证：`node --check` 通过；第二次定向运行 5/5 PASS，exit=0；os.tmpdir() 无 fosu-provider-control-plane-* 残留；git status 确认仅新增本测试与进度文件。T1 完成，T2（断言组 ⑥—⑪）待续写：在 GROUPS 数组追加独立 run 函数即可。
- 2026-07-28T02:54:54+08:00 T2 组⑥ recent_success/指标完成：3 次成功桩 probe 后 callCount===3、lastSuccessAt 非空、p95>=p50 且有限；resetForTest 后全清零。
- 2026-07-28T02:54:54+08:00 T2 组⑦ error_classification 完成：timeout/401/403/429/ECONNRESET 透传/空错误 provider_failed 六例锁定 classifyFailure 现实现映射。
- 2026-07-28T02:54:54+08:00 T2 组⑧ circuit breaker 完成：withEnv 阈值 2/冷却 1000ms，两次失败开断 → generateWithChain 跳过 deepseek(circuit_open) 回退 mock → 1.1s 后 half-open，组末 resetForTest。
- 2026-07-28T02:54:54+08:00 T2 组⑨ public 恒零外部调用完成：显式 cfg 与 env 回退两路径链解析全 ["mock"]；deepseek/coze/cloudbase-openai 的 generate+generateStructured 计数桩恒 0；public probe forbidden 且桩 0 次。
- 2026-07-28T02:54:54+08:00 T2 组⑩ Shadow Eval 隔离完成：shadow 不改写 answer/provider、status scheduled、内容不泄漏、失败不影响主结果且进程不崩；runShadowEvaluation 直调返回 failed 不外抛；源码静态断言无 memory 依赖。
- 2026-07-28T02:54:54+08:00 T2 组⑪ 后台 UI 与运行时同源完成：admin.js 含 getAuthoritativeProviderConfig 调用、adminPages.js 含 readiness-matrix/probe 两个字面量；自足 fixture 下五元组与 resolveStageChain 三阶段第一跳全一致。
- 2026-07-28T02:54:54+08:00 T2 定稿验证：node --check 通过；连续两次 `node tools/test-provider-control-plane.js` 均 11/11 PASS，exit=0，单次总耗时约 1.6s（<10s）；无临时目录残留；git status 确认仍仅两个新增文件。无疑似实现缺陷，未改业务代码。
