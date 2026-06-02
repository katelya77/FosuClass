const axios = require("axios");

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const API_BASE = process.env.TEST_API_BASE || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "test-admin-token";

const admin = axios.create({
  baseURL: API_BASE,
  proxy: false,
  headers: { 
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json"
  },
  validateStatus: () => true,
});

async function run() {
  console.log("=== 开始测试 test-release-index.js ===");
  
  // 1. 检查可用性
  const checkRes = await admin.get("/api/admin/sync/releases/check-availability");
  console.log("可用性检测响应:", checkRes.status, JSON.stringify(checkRes.data, null, 2));
  if (checkRes.status !== 200 || !checkRes.data.success) {
    throw new Error("诊断可用性接口失败");
  }

  const result = checkRes.data.result || {};
  const activeReleaseVersion = result.activeReleaseVersion || "26.05.29.22";
  console.log("检测到或默认使用的 activeReleaseVersion:", activeReleaseVersion);

  // 2. 触发重建索引
  console.log("正在尝试重建版本索引:", activeReleaseVersion);
  const rebuildRes = await admin.post("/api/admin/sync/releases/rebuild-index", {
    version: activeReleaseVersion
  });
  console.log("重建索引响应:", rebuildRes.status, rebuildRes.data);
  
  const isExpected404 = rebuildRes.status === 404 && rebuildRes.data && String(rebuildRes.data.message).includes("找不到");
  const isSuccess200 = rebuildRes.status === 200 && rebuildRes.data.success;
  
  if (!isSuccess200 && !isExpected404) {
    throw new Error("重建索引失败");
  }

  console.log("✅ test-release-index.js 测试通过！");
}

run().catch(err => {
  console.error("❌ test-release-index.js 测试失败:", err.message);
  process.exit(1);
});
