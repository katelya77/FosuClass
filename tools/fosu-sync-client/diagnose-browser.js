const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const DEBUG_DIR = path.join(__dirname, ".debug");
const SESSION_PATH = path.join(__dirname, ".session", "session.json");

if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function diagnoseBrowser() {
  console.log("=== 开始 Browser 级教务网深度诊断 ===");
  
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security"
  ];
  
  let browser;
  const channels = ["msedge", "chrome", null];
  
  for (const channel of channels) {
    try {
      const config = { headless: false, args: launchArgs };
      if (channel) {
        config.channel = channel;
        console.log(`正在尝试使用系统通道启动浏览器: ${channel}...`);
      } else {
        console.log("正在使用内置 Chromium 启动浏览器...");
      }
      browser = await chromium.launch(config);
      break;
    } catch (e) {
      console.warn(`⚠️ 浏览器通道 ${channel || "内置"} 启动失败: ${e.message}`);
    }
  }
  
  if (!browser) {
    console.error("❌ 无法启动任何浏览器！");
    process.exit(1);
  }
  
  // 检查是否存在现有登录态，若有则尝试载入，便于测试是否有登录态
  let contextOptions = { ignoreHTTPSErrors: true };
  if (fs.existsSync(SESSION_PATH)) {
    console.log("ℹ️ 检测到本地 session.json，将载入进行登录态检测...");
    contextOptions.storageState = SESSION_PATH;
  }
  
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  const httpUrl = FOSU_BASE_URL.replace(/^https:/i, "http:");
  console.log(`\n正在访问教务系统 (优先 HTTP): ${httpUrl}`);
  
  try {
    const response = await page.goto(httpUrl, { waitUntil: "load", timeout: 20000 });
    
    console.log(`\n=== 页面加载反馈 ===`);
    const finalUrl = page.url();
    console.log(`最终跳转 URL: ${finalUrl}`);
    
    const pageTitle = await page.title();
    console.log(`页面标题: ${pageTitle}`);
    
    // 检查是否包含统一认证跳转
    if (finalUrl.includes("authserver.fosu.edu.cn")) {
      console.log("🎉 状态: 教务入口可达，系统已成功跳转至统一身份认证系统 (authserver)。");
    } else if (finalUrl.includes("/framework/xsMain.jsp") || finalUrl.includes("/xsMain.jsp")) {
      console.log("🎉 状态: 检测到当前已拥有有效的登录态，已成功进入教务系统主页。");
    } else {
      console.log("ℹ️ 状态: 页面已加载，但未跳转至 authserver。请手动检查是否已是登录页或教务平台。");
    }
    
    // 判断内容中是否有错误或故障信息
    const content = await page.content();
    if (content.includes("无法访问") || content.includes("未连接") || content.includes("ERROR") || (response && response.status() >= 400)) {
      throw new Error(`页面响应异常，状态码: ${response ? response.status() : "未知"}`);
    }
    
    console.log(`\n🎉 诊断通过！网络层及浏览器端均可达。`);
  } catch (error) {
    console.error(`\n❌ 浏览器诊断页面加载失败: ${error.message}`);
    const screenshotPath = path.join(DEBUG_DIR, "diagnose-browser.png");
    try {
      await page.screenshot({ path: screenshotPath });
      console.log(`📸 调试截图已成功保存到: tools/fosu-sync-client/.debug/diagnose-browser.png`);
      console.log(`💡 提示: 请连接 EasyConnect 并检查 100.fosu.edu.cn 能否在常用浏览器中正常打开。`);
    } catch (ssErr) {
      console.error(`❌ 保存截图失败: ${ssErr.message}`);
    }
  } finally {
    console.log("\n将在 5 秒后自动关闭浏览器...");
    await page.waitForTimeout(5000);
    await browser.close();
    console.log("=== 诊断完毕 ===");
  }
}

diagnoseBrowser();
