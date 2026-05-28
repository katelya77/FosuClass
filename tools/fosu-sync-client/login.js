/**
 * 本地登录脚本：利用 Playwright 打开可见浏览器引导用户手动登录佛大教务，
 * 登录成功后将会话 Cookie 及 Storage 状态持久化到本地 session.json 文件。
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const diagnose = require("./diagnose");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const SESSION_PATH = path.join(__dirname, "session.json");
const FOSU_LOGIN_PROFILE = process.env.FOSU_LOGIN_PROFILE || "desktop";

async function login() {
  // 1. 在登录前执行网络诊断
  const isNetOk = await diagnose();
  if (!isNetOk) {
    console.error("❌ 网络连接诊断未通过，无法执行登录！");
    console.error("💡 请确认已连接 VPN 或处于校园网环境中。");
    process.exit(1);
  }

  console.log("\n=== 启动 Playwright 手动登录流程 ===");
  console.log("正在为您打开浏览器，请稍候...");

  // 根据配置设定 User-Agent
  let userAgent = undefined;
  let viewport = undefined;
  if (FOSU_LOGIN_PROFILE === "mobile") {
    userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    viewport = { width: 375, height: 812 };
  }

  const browser = await chromium.launch({
    headless: false, // 必须为 false 才能引导用户手动登录
    args: ["--disable-blink-features=AutomationControlled"], // 降低自动化痕迹
  });

  const context = await browser.newContext({
    userAgent,
    viewport,
    ignoreHTTPSErrors: true, // 忽略校内网可能存在的证书过期/自签名问题
  });

  const page = await context.newPage();

  console.log(`正在导航到教务系统: ${FOSU_BASE_URL} ...`);
  await page.goto(FOSU_BASE_URL);

  console.log("\n📢 [操作提示]");
  console.log("========================================================");
  console.log("1. 请在打开的浏览器中手动输入您的佛大学号与密码。");
  console.log("2. 如果遇到验证码或滑块验证，请手动完成输入或滑动。");
  console.log("3. 登录成功后，脚本会自动检测页面并保存登录态，随后自动关闭浏览器。");
  console.log("4. 请在 5 分钟内完成登录操作。");
  console.log("========================================================");

  try {
    // 监听 URL 变化，强智教务网成功登录后通常会跳转到 /framework/xsMain.jsp
    await page.waitForURL((url) => {
      const urlStr = url.toString();
      return urlStr.includes("/framework/xsMain.jsp") || urlStr.includes("/framework/index.jsp") || urlStr.includes("/xsMain.jsp");
    }, {
      timeout: 300000 // 5 分钟超时
    });

    console.log("🎉 检测到成功进入教务系统主页！正在保存会话状态...");

    // 等待 2 秒以确保 Cookie 和 Token 写入完毕
    await page.waitForTimeout(2000);

    // 获取并保存 StorageState (包括 Cookie 与 LocalStorage)
    const storageState = await context.storageState();
    
    // 脱敏日志输出，防止泄漏敏感 Cookie 详情
    const cookiesCount = storageState.cookies.length;
    console.log(`成功获取到 ${cookiesCount} 个会话 Cookie。`);

    fs.writeFileSync(SESSION_PATH, JSON.stringify(storageState, null, 2), "utf-8");
    console.log(`✅ 登录态已成功保存至本地文件: tools/fosu-sync-client/session.json`);
    console.log("该文件包含敏感登录凭证，请勿将其提交到 Git 或共享给他人。");

  } catch (error) {
    if (error.name === "TimeoutError" || error.message.includes("Timeout")) {
      console.error("\n❌ 登录超时 (5分钟)。您是否未在规定时间内完成登录？");
    } else {
      console.error(`\n❌ 登录过程中发生错误: ${error.message}`);
    }
    console.log("💡 建议重新运行 'npm run login' 进行登录。");
  } finally {
    await browser.close();
    console.log("浏览器已关闭。");
  }
}

if (require.main === module) {
  login();
}

module.exports = login;
