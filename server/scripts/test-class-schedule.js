const axios = require("axios");

async function runTest() {
  console.log("=== 开始测试行政班级课表 API ===");
  try {
    const res = await axios.post("http://localhost:3000/api/fosu/class-schedule", {
      semester: "2025-2026-2",
      collegeCode: "04",
      grade: "2025",
      majorCode: "3C3A6B4C710B4C8C9079446B5F5FCD96",
      weekStart: "",
      weekEnd: "",
      sectionStart: "",
      sectionEnd: ""
    });
    console.log("响应状态码:", res.status);
    console.log("数据源:", res.data.dataSource);
    
    if (res.data.success) {
      console.log("返回班级数量:", res.data.classes?.length || 0);
      if (res.data.classes && res.data.classes.length > 0) {
        console.log("第一个班级名:", res.data.classes[0].className);
        console.log("第一个班级的课程数量:", res.data.classes[0].courses?.length || 0);
      }
      console.log("测试成功！");
    } else {
      console.log("测试失败:", res.data.message);
    }
  } catch (error) {
    console.error("测试出错，请确保后端服务已启动：", error.message);
  }
}

runTest();
