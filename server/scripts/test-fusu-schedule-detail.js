const axios = require("axios");

process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const API_BASE = process.env.TEST_API_BASE || "http://localhost:3000";

async function run() {
  console.log("=== 开始测试 test-fusu-schedule-detail.js ===");

  // 1. 获取一个班级 id 作为测试对象
  const indexRes = await axios.get(`${API_BASE}/api/fosu/search-index?type=class`, { proxy: false });
  if (!indexRes.data.success || !indexRes.data.items || indexRes.data.items.length === 0) {
    throw new Error("无法获取测试用的班级列表");
  }
  const target = indexRes.data.items[0];
  const classId = target.id || target.name;
  const releaseVersion = indexRes.data.meta.releaseVersion;
  const term = indexRes.data.meta.term;
  console.log("选中测试班级:", classId, "版本:", releaseVersion, "学期:", term);

  // 2. 测 detail 不带版本时的响应
  const detailNoVer = await axios.get(`${API_BASE}/api/fosu/schedule-detail?type=class&id=${encodeURIComponent(classId)}&term=${term}`, { proxy: false });
  console.log("详情不带版本状态码:", detailNoVer.status);
  if (!detailNoVer.data.success || !detailNoVer.data.schedule || !Array.isArray(detailNoVer.data.schedule.courses)) {
    throw new Error("详情不带版本返回结构不符合要求");
  }

  // 3. 测 detail 带版本时的响应 (应支持缓存)
  const detailVer = await axios.get(`${API_BASE}/api/fosu/schedule-detail?type=class&id=${encodeURIComponent(classId)}&term=${term}&releaseVersion=${releaseVersion}`, { proxy: false });
  console.log("详情带版本状态码:", detailVer.status);
  const cc = detailVer.headers["cache-control"];
  console.log("Cache-Control (详情带版本):", cc);
  if (!cc || !cc.includes("public")) {
    throw new Error("详情带版本时应允许公共缓存");
  }

  console.log("✅ test-fusu-schedule-detail.js 测试通过！");
}

run().catch(err => {
  console.error("❌ test-fusu-schedule-detail.js 测试失败:", err.message);
  process.exit(1);
});
