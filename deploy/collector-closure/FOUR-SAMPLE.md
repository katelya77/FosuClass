# 班级审核后的四源 Sample 操作入口

此入口基于尚未合并的班级窗口入口；不能假设 Oracle、WYZ 和操作入口已线性合并。保持 Oracle Sample 后端与已安装 WYZ 版本不变，操作文件只携带现有一次性执行器。

`next-sample.js` 保留 class/40 路径，新增 four/120 的显式范围。创建 four 任务之前，通过原生受保护审核 API 重读已完成的 class 任务，核对同学期、完整 canonical hash、`sampleHumanReview.decision=confirmed`、`comparisonAttested=true` 及当前 payload 结构/指纹。人工批准文件不能替代后台已保存的审核。

四源范围固定为每来源一个请求目标；班级目标的单位仍是专业/年级请求组，可能返回多个行政班。必须分别请求班级、教师、教室、课程真实来源，禁止由班级推导冒充直采。采集请求预算 120、并发 1、间隔 900–1300ms、运行最多 15 分钟、批准窗口最多 30 分钟，输出仅供私有审核：`sampleOnly=true`、`publishable=false`、`coverageValid=false`。

四源执行器要求 `allowOneLogin=false`，只复用有效 Session，密码提交为零；Session 失效、挑战、认证错误或未知请求结果立即停止，不自动登录或重放。采集预算不等于整个认证/探针访问总数；未计数的探针保持 UNKNOWN。

`build-next-delivery.py` 输出一个 hash 绑定的 `.sh` 文件，并将已确认 classRunId/classCanonicalHash 带入 WYZ 启动参数。WYZ 会以签名 API 再次核验前置班级审核、当前任务和范围，检查已安装源码，持久预留后独立运行，失败不重启。模板替换标记采用不会出现在标准 base64 内的完整标记，避免篡改内嵌载荷。

先完成候选源码、离线回归及操作入口验证，再申请独立学校访问授权。获批且用户准备上传时，才生成新的批准时间与任务 ID，经 Oracle 原生 Cookie/RBAC/CSRF 写入和审计后打包。离线测试不得创建生产任务，也不代表真实四源采集成功。

原始 HTML 完整布局仍未自动保留；四源课程事实、两节/三节、周次/单双周与来源对应关系须另行真实核对。来源数据不同目标可能没有重叠，不能据此声称四源全校一致性或覆盖率已验证。真实回执必须分别报告四个来源，空结果与认证失败不得混淆。
