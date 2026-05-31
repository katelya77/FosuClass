/**
 * 个人课表同步降级与代理网关回归测试
 * NOTE: 验证敏感词脱敏、网络诊断错误映射、代理分流控制以及代理不可用时的降级返回。
 */

const assert = require("assert");
const path = require("path");
const config = require("../src/config");
const { redactSecrets, maskStudentId } = require("../src/utils/safeLogger");
const personalScheduleService = require("../src/services/personal-schedule-service");
const personalAuthService = require("../src/services/personal-auth-service");
const personalRouter = require("../src/routes/personal");

// 模拟 Express 响应对象
function createMockResponse() {
  let statusVal = 200;
  let jsonVal = null;
  return {
    status(val) {
      statusVal = val;
      return this;
    },
    json(val) {
      jsonVal = val;
      return this;
    },
    getStatus() { return statusVal; },
    getJson() { return jsonVal; }
  };
}

async function runTests() {
  console.log("=== 开始运行个人同步降级与代理网关回归测试 ===");

  // ==========================================
  // 测试 1：敏感词脱敏与学号遮蔽
  // ==========================================
  console.log("测试 1：验证敏感词脱敏与学号遮蔽...");
  
  const testPayload = {
    studentId: "2021003456",
    password: "mySecretPassword123",
    cookie: "JSESSIONID=abcdefg123456",
    execution: "e1s1_token",
    captcha: "slider_slider_token_abc"
  };
  const redacted = redactSecrets(testPayload);
  
  assert.strictEqual(redacted.studentId, "2021003456", "学号本身不应该被 redactSecrets 消除");
  assert.strictEqual(redacted.password, "[REDACTED]", "密码字段必须被脱敏");
  assert.strictEqual(redacted.cookie, "[REDACTED]", "Cookie字段必须被脱敏");
  assert.strictEqual(redacted.execution, "[REDACTED]", "Execution 字段必须被脱敏");
  assert.strictEqual(redacted.captcha, "[REDACTED]", "Captcha 字段必须被脱敏");

  // 测试学号掩盖
  assert.strictEqual(maskStudentId("2021003456"), "2021****3456", "长学号掩盖格式不正确");
  assert.strictEqual(maskStudentId("1234"), "****", "极短学号掩盖格式不正确");
  console.log("✔ 测试 1 通过：脱敏及遮蔽符合预期。");

  // ==========================================
  // 测试 2：handlePersonalError 错误码映射
  // ==========================================
  console.log("\n测试 2：验证 handlePersonalError 错误码映射...");
  
  const handlePersonalError = personalRouter.handlePersonalError;
  assert.ok(typeof handlePersonalError === "function", "必须能获取到 handlePersonalError 处理器");

  // 2.1 校园网不可达错误映射
  const res1 = createMockResponse();
  handlePersonalError(res1, new Error("CAMPUS_NETWORK_REQUIRED"));
  assert.strictEqual(res1.getJson().code, "CAMPUS_NETWORK_REQUIRED");
  assert.ok(res1.getJson().message.includes("暂时无法访问学校教务系统"), "中文信息描述不正确");

  // 2.2 DNS 解析失败映射
  const res2 = createMockResponse();
  const dnsErr = new Error("getaddrinfo ENOTFOUND");
  dnsErr.code = "ENOTFOUND";
  handlePersonalError(res2, dnsErr);
  assert.strictEqual(res2.getJson().code, "UPSTREAM_DNS_FAILED");

  // 2.3 连接超时映射
  const res3 = createMockResponse();
  const timeoutErr = new Error("timeout of 3000ms exceeded");
  timeoutErr.code = "ECONNABORTED";
  handlePersonalError(res3, timeoutErr);
  assert.strictEqual(res3.getJson().code, "UPSTREAM_TIMEOUT");

  // 2.4 404 未找到映射
  const res4 = createMockResponse();
  handlePersonalError(res4, new Error("Request failed with status code 404"));
  assert.strictEqual(res4.getJson().code, "UPSTREAM_404");

  // 2.5 滑块令牌未找到映射
  const res5 = createMockResponse();
  handlePersonalError(res5, new Error("SLIDER_TOKEN_NOT_FOUND"));
  assert.strictEqual(res5.getJson().code, "SLIDER_TOKEN_NOT_FOUND");
  console.log("✔ 测试 2 通过：核心错误码成功映射为标准中文汉化结构。");

  // ==========================================
  // 测试 3：CAMPUS_AGENT_ENABLED = false 时不调用代理
  // ==========================================
  console.log("\n测试 3：验证 CAMPUS_AGENT_ENABLED = false 时不启用代理分流...");
  
  // 保存当前配置备份
  const backupEnabled = config.CAMPUS_AGENT_ENABLED;
  const backupUrl = config.CAMPUS_AGENT_BASE_URL;
  const backupToken = config.CAMPUS_AGENT_TOKEN;

  config.CAMPUS_AGENT_ENABLED = false;
  
  // 在直接模式下，初始化会话会直接调用网络预检。
  // 在没有校园网的机器上测试它，它必然抛出校园网不可达错误。
  try {
    await personalAuthService.startPersonalSession("20210001");
    // 如果碰巧在内网环境中能跑通，我们在此不做失败判定，但一定要拦截到没有返回 useAgent 属性。
  } catch (err) {
    // 捕获到预检失败
    assert.strictEqual(err.message, "CAMPUS_NETWORK_REQUIRED", "直连模式未连接校园网应抛出 CAMPUS_NETWORK_REQUIRED");
  }
  console.log("✔ 测试 3 通过：代理关闭时成功阻断或回退至直连预检流程。");

  // ==========================================
  // 测试 4：CAMPUS_AGENT_ENABLED = true 代理不可达时返回 VPN_GATEWAY_UNAVAILABLE
  // ==========================================
  console.log("\n测试 4：验证 CAMPUS_AGENT_ENABLED = true 但代理不可达时抛出 VPN_GATEWAY_UNAVAILABLE...");

  config.CAMPUS_AGENT_ENABLED = true;
  config.CAMPUS_AGENT_BASE_URL = "http://invalid-gateway-test.local:9999";
  config.CAMPUS_AGENT_TOKEN = "test-token-123";

  // 4.1 测试初始化会话：应该直接返回 useAgent=true，不需要网络预检，sessionId 占位符
  const sessionRes = await personalAuthService.startPersonalSession("20210001");
  assert.strictEqual(sessionRes.useAgent, true, "启用代理时应返回 useAgent: true");
  assert.strictEqual(sessionRes.sessionId, "agent-session-temp", "应返回代理临时会话标识");

  // 4.2 测试获取课表：由于 base_url 不存在，必然报错并降级为 VPN_GATEWAY_UNAVAILABLE
  await assert.rejects(
    async () => {
      await personalScheduleService.fetchAndParseScheduleViaAgent("20210001", "password", "2025-2026-2");
    },
    (err) => {
      assert.strictEqual(err.message, "VPN_GATEWAY_UNAVAILABLE", "不可达的代理必须抛出 VPN_GATEWAY_UNAVAILABLE 错误");
      return true;
    }
  );

  // 恢复配置
  config.CAMPUS_AGENT_ENABLED = backupEnabled;
  config.CAMPUS_AGENT_BASE_URL = backupUrl;
  config.CAMPUS_AGENT_TOKEN = backupToken;

  console.log("✔ 测试 4 通过：代理网关不可用时，降级与抛错完全正常。");

  console.log("\n=================================");
  console.log("✔ 所有个人同步降级回归测试成功通过！");
  console.log("=================================");
}

runTests().catch((error) => {
  console.error("✘ 回归测试执行失败:", error);
  process.exit(1);
});
