const axios = require("axios");

async function runTest() {
  console.log("=== 开始测试教师课表 API ===");
  try {
    const res = await axios.post("http://localhost:3000/api/fosu/teacher-schedule", {
      semester: "2025-2026-2",
      collegeCode: "04",
      titleCode: "",
      keyword: "汪军",
      weekStart: "",
      weekEnd: ""
    });
    console.log("响应状态码:", res.status);
    console.log("数据源:", res.data.dataSource);
    
    if (res.data.success) {
      console.log("返回教师数量:", res.data.teachers?.length || 0);
      if (res.data.teachers && res.data.teachers.length > 0) {
        console.log("第一个教师名:", res.data.teachers[0].teacherName);
        console.log("第一个教师的课程数量:", res.data.teachers[0].courses?.length || 0);
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
