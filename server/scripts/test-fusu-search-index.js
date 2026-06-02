const axios = require("axios");

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const API_BASE = process.env.TEST_API_BASE || "http://localhost:3000";

async function run() {
  console.log("=== 开始测试 test-fusu-search-index.js ===");

  // 1. 请求不带 releaseVersion 的 search-index
  const resNoVer = await axios.get(`${API_BASE}/api/fosu/search-index?type=class`, { proxy: false });
  console.log("不带版本的 search-index 响应状态:", resNoVer.status);
  const cacheControlNoVer = resNoVer.headers["cache-control"];
  console.log("Cache-Control (不带版本):", cacheControlNoVer);
  if (cacheControlNoVer && cacheControlNoVer.includes("public")) {
    throw new Error("不带 releaseVersion 参数时不应缓存");
  }

  const dataNoVer = resNoVer.data;
  if (!dataNoVer.success || !dataNoVer.meta || !dataNoVer.meta.releaseVersion) {
    throw new Error("不带版本的返回结构不符合规范，缺少 meta 或 releaseVersion");
  }
  const releaseVersion = dataNoVer.meta.releaseVersion;
  console.log("当前 active releaseVersion:", releaseVersion);

  // 2. 带 releaseVersion 参数请求 classes/teachers/classrooms/courses 并校验
  const types = ["class", "teacher", "classroom", "course"];
  for (const type of types) {
    const resVer = await axios.get(`${API_BASE}/api/fosu/search-index?type=${type}&releaseVersion=${releaseVersion}`, { proxy: false });
    console.log(`类型 ${type} 的响应数据校验...`);
    const cacheControlVer = resVer.headers["cache-control"];
    console.log(`Cache-Control (带版本 ${type}):`, cacheControlVer);
    if (!cacheControlVer || !cacheControlVer.includes("public")) {
      throw new Error("带 releaseVersion 参数时应返回允许 CDN 缓存的 Cache-Control");
    }
    
    const payload = resVer.data;
    if (!payload.success || !payload.meta) {
      throw new Error(`${type} 返回格式错误，success=false 或缺少 meta`);
    }
    console.log(`${type} 索引总数:`, payload.meta.counts[type + "s"] || payload.items.length);
  }

  console.log("✅ test-fusu-search-index.js 测试通过！");
}

run().catch(err => {
  console.error("❌ test-fusu-search-index.js 测试失败:", err.message);
  process.exit(1);
});
