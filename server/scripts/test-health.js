const axios = require("axios");

async function runTest() {
  console.log("=== 开始测试健康检查 API ===");
  try {
    const res = await axios.get("http://localhost:3000/api/health");
    console.log("响应状态码:", res.status);
    console.log("响应数据:", JSON.stringify(res.data, null, 2));
    if (res.data.success) {
      console.log("测试成功！");
    } else {
      console.log("测试失败，返回异常。");
    }
  } catch (error) {
    console.error("测试出错，请确保后端服务已启动 (npm run dev)：", error.message);
  }
}

runTest();
