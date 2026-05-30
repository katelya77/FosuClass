/**
 * 个人课表同步本地调试脚本
 * NOTE: 方便开发者在内网或 VPN 状态下通过终端交互测试同步链路、人工拖拽图片计算并校准滑块效果。
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const personalAuthService = require("../src/services/personal-auth-service");
const personalScheduleService = require("../src/services/personal-schedule-service");
const { destroySession } = require("../src/utils/fosu-cookie-jar");
const { safeLog, maskStudentId } = require("../src/utils/safeLogger");

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * 隐藏密码终端询问
 */
function askPassword(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // 采用最通用的提示，如果终端不支持高级隐藏，允许直接输入，并安全清理
    rl.question(query, (password) => {
      rl.close();
      resolve(password.trim());
    });
  });
}

/**
 * 保存滑块 Base64 图片到本地调试文件夹
 * @param {string} base64Data 图片 base64 字符串
 * @param {string} filename 保存文件名
 * @returns {string} 绝对路径
 */
function saveSliderImage(base64Data, filename) {
  const debugDir = path.resolve(__dirname, "../../.debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  // 移出 base64 头部格式说明，如 data:image/jpeg;base64,
  const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Content, "base64");
  const filePath = path.join(debugDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function runCli() {
  console.log("=== FosuClass 个人课表本地 CLI 同步调试 ===");

  const studentId = process.env.FOSU_PERSONAL_STUDENT_ID || await askQuestion("请输入学号: ");
  if (!studentId) {
    console.error("学号不可为空！");
    process.exit(1);
  }

  let password = process.env.FOSU_PERSONAL_PASSWORD;
  if (!password) {
    password = await askPassword("请输入教务网密码: ");
  }
  if (!password) {
    console.error("密码不可为空！");
    process.exit(1);
  }

  const semester = process.env.FOSU_PERSONAL_SEMESTER || "2025-2026-2";

  let sessionId = "";

  try {
    // 1. 初始化会话
    console.log("1. 正在初始化统一认证会话并请求滑块验证码...");
    const sessionRes = await personalAuthService.startPersonalSession(studentId);
    sessionId = sessionRes.sessionId;

    // 2. 保存滑块大图和小图
    const bigPath = saveSliderImage(sessionRes.captcha.bigImage, "personal-slider-big.jpg");
    const smallPath = saveSliderImage(sessionRes.captcha.smallImage, "personal-slider-small.png");
    console.log(`➜ 滑块大图已保存: ${bigPath}`);
    console.log(`➜ 滑块小图已保存: ${smallPath}`);

    // 3. 提示用户输入偏移动量
    console.log("\n请在照片查看器或浏览器中打开上述两张滑块图，估算滑块偏离距离。");
    console.log("背景大图逻辑宽度为 340 像素，请估算或测量小滑块到拼图缺口边缘的偏移像素。");
    const moveLengthStr = await askQuestion("请输入 moveLength 像素距离 (如 116.5): ");
    const moveLength = parseFloat(moveLengthStr);

    if (isNaN(moveLength)) {
      console.error("无效的滑块偏移输入！");
      destroySession(sessionId);
      process.exit(1);
    }

    // 4. 校验滑块
    console.log("\n2. 正在向教务网发送滑块校验请求...");
    const verifyRes = await personalAuthService.verifyPersonalSlider(sessionId, 340, moveLength);
    if (!verifyRes.success) {
      console.error("滑块验证失败！");
      destroySession(sessionId);
      process.exit(1);
    }
    console.log("✔ 滑块校验成功！");

    // 5. 统一认证登录
    console.log("\n3. 正在执行登录认证链路...");
    const { studentJar, student } = await personalAuthService.loginAndGetJar(sessionId, studentId, password);
    console.log(`✔ 登录成功！已成功握手教务网会话。当前学生: ${student.studentName}`);

    // 6. 获取并解析课表
    console.log(`\n4. 正在抓取学期 [${semester}] 的个人课表并解析...`);
    const syncRes = await personalScheduleService.fetchAndParseSchedule(studentJar, student, semester);

    // 7. 保存解析后的 JSON 数据
    const debugDir = path.resolve(__dirname, "../../.debug");
    const scheduleJsonPath = path.join(debugDir, "personal-schedule-latest.json");
    fs.writeFileSync(scheduleJsonPath, JSON.stringify(syncRes, null, 2), "utf8");

    console.log("\n=================================");
    console.log("✔ 个人课表数据同步解析成功！");
    console.log(`➜ 课程总数: ${syncRes.schedule.courses.length} 门`);
    console.log(`➜ 数据已输出到: ${scheduleJsonPath}`);
    console.log("=================================");

  } catch (error) {
    console.error("\n✘ 课表同步失败！错误原因:", error.message);
    if (error.availableSemesters) {
      console.error("教务系统可选学期为:", error.availableSemesters);
    }
  } finally {
    password = null;
    if (sessionId) {
      destroySession(sessionId);
    }
  }
}

runCli();
