const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:3000";
const ADMIN_TOKEN = "test-admin-token"; // 根据 server/.env 中的配置

const headers = {
  "Content-Type": "application/json",
  "x-admin-token": ADMIN_TOKEN
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 预先写入一个 mock catalog.json 到 server/storage
function setupCatalog() {
  const storageDir = path.join(__dirname, "../storage");
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  const catalogPath = path.join(storageDir, "catalog.json");
  const catalogData = {
    semesters: [{ value: "2025-2026-2", label: "2025-2026学年第二学期" }],
    colleges: [
      { code: "04", name: "动物科技学院" },
      { code: "02", name: "物理与光电工程学院" }
    ],
    grades: ["2020", "2021", "2022", "2023", "2024", "2025"],
    weeks: []
  };
  fs.writeFileSync(catalogPath, JSON.stringify(catalogData, null, 2), "utf-8");
  console.log("Mock catalog.json 已写入完毕。");
}

async function runTests() {
  console.log("=== 开始执行服务端 /sync/majors 接口自动化测试 ===\n");
  
  setupCatalog();

  // 用例 1: 正常上传 active 年级数据，验证去重、stable hash 和 nested 存储格式
  try {
    console.log("👉 用例 1: 正常数据测试...");
    const payload = [
      { collegeCode: "04", grade: "2025", name: "动物医学" }, // 无 code，需生成 stable hash
      { collegeCode: "04", grade: "2025", name: "动物科学", code: "0402" },
      { collegeCode: "04", grade: "2025", name: "动物科学", code: "0402" }, // 重复数据，需去重
      { collegeCode: "04", grade: "2020", name: "古老专业", code: "0499" }, // 历史年级（2020），默认需被过滤
      { collegeCode: "02", grade: "2024", name: "光电信息", code: "0201" }
    ];

    const res = await axios.post(`${API_BASE}/api/admin/sync/majors`, payload, { headers });
    console.log("   响应状态码:", res.status);
    console.log("   响应数据:", res.data);

    // 检查 majors-index.json 的结构
    const majorsIndexPath = path.join(__dirname, "../storage/majors-index.json");
    if (fs.existsSync(majorsIndexPath)) {
      const data = JSON.parse(fs.readFileSync(majorsIndexPath, "utf-8"));
      console.log("   生成 majors-index.json 内容:", JSON.stringify(data, null, 2));
      
      const animalCollege = data.colleges.find(c => c.collegeCode === "04");
      const grade2025 = animalCollege?.grades.find(g => g.grade === "2025");
      console.log("   2025 级动物科技学院专业:", grade2025?.majors);
      
      const has2020 = animalCollege?.grades.some(g => g.grade === "2020");
      console.log("   是否过滤了 2020 年级:", !has2020 ? "✅ 是" : "❌ 否");
    } else {
      console.error("   ❌ majors-index.json 未正常生成！");
    }
  } catch (error) {
    console.error("   ❌ 用例 1 失败:", error.response ? error.response.data : error.message);
  }

  await sleep(1000);
  console.log("\n--------------------------------------------------\n");

  // 用例 2: 校验 Schema 字段缺失，应返回 400 并指明原因
  try {
    console.log("👉 用例 2: 缺失 collegeCode 校验...");
    const payload = [
      { grade: "2025", name: "缺失学院的专业", code: "0401" }
    ];
    await axios.post(`${API_BASE}/api/admin/sync/majors`, payload, { headers });
    console.log("   ❌ 错误：不合法数据未被成功阻拦！");
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log("   ✅ 成功阻拦！HTTP 状态码:", error.response.status);
      console.log("   阻拦提示:", error.response.data);
    } else {
      console.error("   ❌ 用例 2 出错:", error.message);
    }
  }

  await sleep(1000);
  console.log("\n--------------------------------------------------\n");

  // 用例 3: 校验敏感词过滤 (包含 cookie 等敏感字符)
  try {
    console.log("👉 用例 3: 敏感信息校验...");
    const payload = [
      { collegeCode: "04", grade: "2025", name: "注入cookie的数据", code: "0401" }
    ];
    await axios.post(`${API_BASE}/api/admin/sync/majors`, payload, { headers });
    console.log("   ❌ 错误：敏感数据未被成功阻拦！");
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log("   ✅ 成功阻拦！HTTP 状态码:", error.response.status);
      console.log("   阻拦提示:", error.response.data);
    } else {
      console.error("   ❌ 用例 3 出错:", error.message);
    }
  }

  await sleep(1000);
  console.log("\n--------------------------------------------------\n");

  // 用例 4: allowHistorical=true 应该保留历史年级
  try {
    console.log("👉 用例 4: allowHistorical=true 测试...");
    const payload = [
      { collegeCode: "04", grade: "2020", name: "古老专业", code: "0499" }
    ];
    const res = await axios.post(`${API_BASE}/api/admin/sync/majors?allowHistorical=true`, payload, { headers });
    console.log("   响应状态码:", res.status);
    
    const majorsIndexPath = path.join(__dirname, "../storage/majors-index.json");
    if (fs.existsSync(majorsIndexPath)) {
      const data = JSON.parse(fs.readFileSync(majorsIndexPath, "utf-8"));
      const animalCollege = data.colleges.find(c => c.collegeCode === "04");
      const has2020 = animalCollege?.grades.some(g => g.grade === "2020");
      console.log("   在 allowHistorical=true 时是否保留了 2020 年级:", has2020 ? "✅ 是" : "❌ 否");
    }
  } catch (error) {
    console.error("   ❌ 用例 4 失败:", error.response ? error.response.data : error.message);
  }

  await sleep(1000);
  console.log("\n--------------------------------------------------\n");

  // 用例 5: 验证小程序端数据获取 API 向后兼容性
  try {
    console.log("👉 用例 5: 验证 getMajors 服务层接口...");
    const res = await axios.get(`${API_BASE}/api/fosu/majors?collegeCode=04&grade=2020`);
    console.log("   响应状态码:", res.status);
    console.log("   响应内容:", res.data);
    if (res.data.success && Array.isArray(res.data.majors) && res.data.majors.length > 0) {
      console.log("   ✅ 服务层接口验证成功，向后兼容正常！");
    } else {
      console.error("   ❌ 服务层接口验证失败！");
    }
  } catch (error) {
    console.error("   ❌ 用例 5 失败:", error.message);
  }
}

runTests();
