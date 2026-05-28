const axios = require("axios");

async function runTest() {
  console.log("=== 开始测试联动专业 API ===");
  try {
    const res = await axios.get("http://localhost:3000/api/fosu/majors?collegeCode=04&grade=2025");
    console.log("响应状态码:", res.status);
    console.log("数据源:", res.data.dataSource);
    console.log("专业数量:", res.data.majors?.length || 0);
    
    if (res.data.success) {
      console.log("专业列表:", res.data.majors);
      console.log("测试成功！");
    } else {
      console.log("测试失败:", res.data.message);
    }
  } catch (error) {
    console.error("测试出错，请确保后端服务已启动：", error.message);
  }
}

runTest();
