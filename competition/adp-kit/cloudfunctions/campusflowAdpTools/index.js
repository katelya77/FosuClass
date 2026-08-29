"use strict";

const path = require("path");

// CloudBase managed-runtime HTTP Functions must listen on port 9000.
process.env.PORT = "9000";

// 数据源选择（R50.0 V3 runtime cutover）：
// 1. 显式设置 CAMPUS_DATA_PATH 时尊重该值（仍受 data.js 的 competition-demo-*
//    文件名守卫约束）；
// 2. 否则按 CAMPUS_DEMO_DATA_VERSION（competition-demo-v2 | competition-demo-v3，
//    默认 competition-demo-v3）读取部署包内对应匿名数据集；
// 3. 不存在任何“缺文件/版本不对就回退 v1 或 production”的路径——加载失败即冷启动失败。
const DEFAULT_DATA_VERSION = "competition-demo-v3";
if (!process.env.CAMPUS_DATA_PATH) {
  const version = process.env.CAMPUS_DEMO_DATA_VERSION || DEFAULT_DATA_VERSION;
  if (!/^competition-demo-v\d+$/.test(version)) {
    throw new Error(`CAMPUS_DEMO_DATA_VERSION 非法: ${version}（仅允许 competition-demo-v* 匿名数据集）`);
  }
  process.env.CAMPUS_DATA_PATH = path.join(__dirname, "mock-data", `${version}.json`);
}

// The managed competition endpoint must fail closed. The reusable MCP service
// may run without auth for local development, but this deployment wrapper may
// never become public merely because an environment variable was removed.
if (!process.env.CAMPUS_API_TOKEN) {
  throw new Error("CAMPUS_API_TOKEN is required for the competition HTTP Function");
}
process.env.CAMPUS_API_AUTH_MODE = "token";

const { loadDataset } = require("./src/data");
const { server } = require("./src/server");

// Fail closed during cold start if the bundled data is missing or not a
// competition-demo-* dataset. No production fallback exists.
const { dataVersion, dataHash } = loadDataset();
if (!/^competition-demo-v\d+$/.test(String(dataVersion || ""))) {
  throw new Error(`数据版本非法，拒绝启动: ${dataVersion}（仅允许 competition-demo-v* 匿名数据集）`);
}

server.listen(9000, () => {
  console.log(JSON.stringify({
    event: "campusflow_http_function_started",
    port: 9000,
    dataVersion,
    dataHash,
  }));
});
