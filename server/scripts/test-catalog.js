const axios = require("axios");

async function runTest() {
  console.log("=== 开始测试全校 Catalog API ===");
  try {
    const res = await axios.get("http://localhost:3000/api/fosu/catalog?semester=2025-2026-2");
    console.log("响应状态码:", res.status);
    console.log("数据源:", res.data.dataSource);
    console.log("学期选项数量:", res.data.semesters?.length || 0);
    console.log("学院选项数量:", res.data.colleges?.length || 0);
    console.log("年级选项数量:", res.data.grades?.length || 0);
    
    if (res.data.success) {
      console.log("前几个学院示例:", res.data.colleges?.slice(0, 3));
      console.log("测试成功！");
    } else {
      console.log("测试失败:", res.data.message);
    }
  } catch (error) {
    console.error("测试出错，请确保后端服务已启动：", error.message);
  }
}

runTest();
