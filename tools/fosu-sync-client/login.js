/**
 * 本地登录脚本：利用 Playwright 打开可见浏览器引导用户手动登录佛大教务，
 * 登录成功后将会话 Cookie 及 Storage 状态持久化到本地 .session/session.json 文件。
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const diagnose = require("./diagnose");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const SESSION_DIR = path.join(__dirname, ".session");
const SESSION_PATH = path.join(SESSION_DIR, "session.json");
const FOSU_LOGIN_PROFILE = process.env.FOSU_LOGIN_PROFILE || "desktop";

// 确保会话目录存在
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

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

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security"
  ];

  let browser;
  // 优先尝试系统边缘浏览器，其次是 Chrome，最后回退内置 Chromium
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false,
        args: launchArgs,
      };
      if (channel) {
        config.channel = channel;
        console.log(`尝试使用系统浏览器通道: ${channel} ...`);
      } else {
        console.log("使用内置 Chromium 浏览器 ...");
      }
      browser = await chromium.launch(config);
      break; // 成功启动则退出循环
    } catch (e) {
      console.warn(`⚠️ 浏览器通道 ${channel || "内置"} 启动失败: ${e.message}`);
    }
  }

  if (!browser) {
    console.error("❌ 无法启动任何浏览器！请检查 Playwright 安装是否完整。");
    process.exit(1);
  }

  const context = await browser.newContext({
    userAgent,
    viewport,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // 优先访问 HTTP，若失败再尝试 HTTPS
  const httpUrl = FOSU_BASE_URL.replace(/^https:/i, "http:");
  console.log(`优先通过 HTTP 访问教务系统: ${httpUrl} ...`);
  try {
    await page.goto(httpUrl, { timeout: 15000 });
  } catch (error) {
    console.warn(`⚠️ HTTP 导航失败 (${error.message})，正在尝试 HTTPS 导航: ${FOSU_BASE_URL} ...`);
    try {
      await page.goto(FOSU_BASE_URL, { timeout: 15000 });
    } catch (httpsError) {
      console.error(`❌ 导航教务系统彻底失败: ${httpsError.message}`);
      console.log("💡 请确认 EasyConnect 是否成功连接，且能打开教务网页。");
    }
  }

  console.log("\n📢 [操作提示]");
  console.log("========================================================");
  console.log("1. 请在打开的浏览器中手动输入您的佛大学学号与密码。");
  console.log("2. 如果遇到验证码或滑块验证，请手动完成输入或滑动。");
  console.log("3. 登录成功后，脚本会自动检测页面并保存登录态，随后自动关闭浏览器。");
  console.log("4. 请在 5 分钟内完成登录操作。");
  console.log("========================================================");

  try {
    // 轮询检查登录态是否成功
    let loggedIn = false;
    const checkInterval = 1000;
    const maxWaitTime = 300000; // 5分钟
    let elapsed = 0;

    while (elapsed < maxWaitTime) {
      if (page.isClosed()) {
        break;
      }

      const currentUrl = page.url();
      const hasMainUrl = currentUrl.includes("/framework/xsMain.jsp") || 
                         currentUrl.includes("/framework/index.jsp") || 
                         currentUrl.includes("/xsMain.jsp");

      let hasMainContent = false;
      try {
        const content = await page.content();
        hasMainContent = content.includes("教学一体化服务平台") || 
                         content.includes("我的桌面") || 
                         content.includes("学期理论课表");
      } catch (e) {
        // 忽略页面加载或导航时的临时错误
      }

      if (hasMainUrl || hasMainContent) {
        loggedIn = true;
        break;
      }

      await page.waitForTimeout(checkInterval);
      elapsed += checkInterval;
    }

    if (!loggedIn) {
      throw new Error("登录超时或未检测到登录成功的页面状态");
    }

    console.log("🎉 检测到成功进入教务系统主页！正在保存会话状态...");

    // 等待 2 秒以确保 Cookie 和 Token 写入完毕
    await page.waitForTimeout(2000);

    // 获取并保存 StorageState
    const storageState = await context.storageState();
    
    const cookiesCount = storageState.cookies.length;
    console.log(`成功获取到 ${cookiesCount} 个会话 Cookie。`);

    fs.writeFileSync(SESSION_PATH, JSON.stringify(storageState, null, 2), "utf-8");
    console.log(`✅ 登录态已成功保存至本地文件: tools/fosu-sync-client/.session/session.json`);
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
