const axios = require("axios");

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const API_BASE = process.env.TEST_API_BASE || "http://localhost:3000";

async function run() {
  console.log("=== 开始测试 test-miniprogram-cache-version.js ===");

  const endpoints = ["/api/fosu/app-config", "/api/fosu/bootstrap"];
  for (const ep of endpoints) {
    const url = `${API_BASE}${ep}?ts=${Date.now()}`;
    const res = await axios.get(url, { proxy: false });
    console.log(`Endpoint ${ep} 状态码:`, res.status);
    
    const cc = res.headers["cache-control"];
    const pragma = res.headers["pragma"];
    console.log(`Headers for ${ep}: Cache-Control=${cc}, Pragma=${pragma}`);
    
    if (!cc || !cc.includes("no-store")) {
      throw new Error(`${ep} 接口应该被设置为 no-store 以防止小程序读取过期的 CDN 缓存`);
    }
    
    const data = res.data;
    if (!data.success) {
      throw new Error(`${ep} 接口响应失败`);
    }
    
    if (ep === "/api/fosu/app-config") {
      const payload = data.data || {};
      console.log("app-config fields check:", {
        term: payload.term,
        releaseVersion: payload.releaseVersion,
        publishedAt: payload.publishedAt,
        cacheVersion: payload.cacheVersion,
        cacheEpoch: payload.cacheEpoch
      });
      if (!payload.releaseVersion || !payload.term || !payload.cacheVersion || !payload.cacheEpoch) {
        throw new Error("app-config 缺省必要的高级缓存属性");
      }
    }
  }

  console.log("✅ test-miniprogram-cache-version.js 测试通过！");
}

run().catch(err => {
  console.error("❌ test-miniprogram-cache-version.js 测试失败:", err.message);
  process.exit(1);
});
