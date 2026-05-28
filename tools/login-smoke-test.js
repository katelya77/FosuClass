#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getSession, requestWithRetry } = require("../cloudfunctions/common/casSession");
const { FosuQiangzhiAdapter } = require("../cloudfunctions/common/fosuQiangzhiAdapter");
const { parseSchoolOptionsHtml } = require("../cloudfunctions/common/parser");

function checkCredentials() {
  let secrets = {};
  try {
    const secretsPath = path.join(__dirname, "..", "local.secrets.json");
    if (fs.existsSync(secretsPath)) {
      secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
    }
  } catch (e) {
    // ignore
  }

  const username = process.env.FOSU_SERVICE_USERNAME || secrets.FOSU_SERVICE_USERNAME || secrets.FOSU_STUDENT_ID;
  const password = process.env.FOSU_SERVICE_PASSWORD || secrets.FOSU_SERVICE_PASSWORD || secrets.FOSU_PASSWORD;

  return { username, password };
}

async function run() {
  const { username, password } = checkCredentials();
  
  if (!username || !password || username.includes("here") || password.includes("here")) {
    console.log("\n========================================================");
    console.log("提示: 未在环境变量或 local.secrets.json 中配置真实教务凭证。");
    console.log("跳过真实网络登录测试。");
    console.log("如需测试真实登录，请创建 local.secrets.json 并填入 FOSU_STUDENT_ID 和 FOSU_PASSWORD。");
    console.log("========================================================\n");
    return;
  }

  console.log(`正在尝试以用户 ${username} 模拟 CAS 登录...`);
  
  try {
    const adapter = new FosuQiangzhiAdapter();
    const res = await adapter.fetchClassOptionsPage();
    
    console.log("请求成功！HTTP 状态码:", res.statusCode);
    if (res.statusCode === 200) {
      const parsed = parseSchoolOptionsHtml(res.text);
      console.log(`[成功] 解析出 ${parsed.colleges.length} 个学院选项。`);
      console.log(`[成功] 解析出 ${parsed.semesters.length} 个学期选项。`);
      console.log(`[成功] 解析出 ${parsed.grades.length} 个年级选项。`);
      
      if (parsed.colleges.length > 0) {
        console.log("首个学院示例:", parsed.colleges[0]);
      }
      console.log("\nCAS 登录及页面解析烟雾测试顺利通过！");
    } else {
      console.error("[错误] 页面请求返回异常状态码。");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n[测试失败] 遭遇错误:", error.message);
    if (error.message.includes("NEED_CAPTCHA")) {
      console.log("原因: 触发了教务系统的验证码限制，需要在云函数侧进行验证码捕获处理。");
    }
    process.exit(1);
  }
}

run();
