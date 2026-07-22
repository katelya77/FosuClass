#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const routes = read("server/src/modules/ai-provider/routes.js");
const configService = read("server/src/services/ai/providerConfigService.js");
const runtimeStore = read("server/src/services/ai/providerRuntimeConfigStore.js");
const adminPage = read("server/src/routes/adminPages.js");
const provider = read("server/src/services/ai/providers/cozeProvider.js");
const envExample = read("server/.env.example");
const deployWorkflow = read(".github/workflows/deploy-vps.yml");

assert.ok(routes.includes('/ai-provider/test-coze'));
assert.ok(routes.includes("cozeProvider.testConnection"));
assert.ok(routes.includes("COZE_TEST_PUBLIC_FORBIDDEN"));
assert.ok(routes.includes("isAllowedCozeBaseUrl"));
assert.ok(provider.includes("COZE_TOKEN_INVALID"));
assert.ok(provider.includes("COZE_BOT_NOT_FOUND"));
assert.ok(provider.includes("COZE_BOT_NOT_PUBLISHED"));
assert.ok(provider.includes("COZE_PERMISSION_DENIED"));
assert.ok(provider.includes("COZE_RATE_LIMITED"));
assert.ok(provider.includes("COZE_TIMEOUT"));
assert.ok(provider.includes("COZE_API_MODE"));
assert.ok(provider.includes("COZE_WORKLOAD_ENDPOINT"));
assert.ok(provider.includes("COZE_PROJECT_ID"));
assert.ok(provider.includes("buildWorkloadRequestBody"));
assert.ok(provider.includes("parseWorkloadStream"));
assert.ok(routes.includes(".coze.site"));
assert.ok(routes.includes("COZE_WORKLOAD_ENDPOINT"));

assert.ok(adminPage.includes("cozeTestConnectionBtn"));
assert.ok(adminPage.includes("function testCozeConnection"));
assert.ok(adminPage.includes("已发布 Bot ID"));
assert.ok(adminPage.includes("Workspace/Space ID"));
assert.ok(adminPage.includes("cozeApiMode"));
assert.ok(adminPage.includes("cozeWorkloadEndpoint"));
assert.ok(adminPage.includes("cozeProjectId"));
assert.ok(!adminPage.includes("id='cozeUserId'"));
assert.ok(!adminPage.includes('id="cozeUserId"'));
assert.ok(!configService.includes('["userId", Boolean(profile.cozeUserId)]'));
assert.ok(!configService.includes("COZE_USER_ID"));
assert.ok(!runtimeStore.includes("COZE_USER_ID"));
assert.ok(!envExample.includes("COZE_USER_ID"));
assert.ok(!deployWorkflow.includes("COZE_USER_ID"));
assert.ok(runtimeStore.includes('"COZE_API_MODE"'));
assert.ok(runtimeStore.includes('"COZE_WORKLOAD_ENDPOINT"'));
assert.ok(runtimeStore.includes('"COZE_PROJECT_ID"'));
assert.ok(envExample.includes("COZE_API_MODE="));
assert.ok(envExample.includes("COZE_WORKLOAD_ENDPOINT="));
assert.ok(envExample.includes("COZE_PROJECT_ID="));
assert.ok(deployWorkflow.includes("COZE_WORKLOAD_ENDPOINT='${{ vars.COZE_WORKLOAD_ENDPOINT }}'"));
assert.ok(deployWorkflow.includes("COZE_PROJECT_ID='${{ vars.COZE_PROJECT_ID }}'"));
assert.ok(deployWorkflow.includes("configure_coze_workload"));
assert.ok(deployWorkflow.includes("configure-coze-workload.js --verify"));

console.log("test-coze-connection-config-ux: PASS");
