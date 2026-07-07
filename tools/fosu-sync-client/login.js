/**
 * 本地登录脚本：利用 Playwright 打开可见浏览器引导用户手动登录佛大教务，
 * 登录成功后将浏览器会话状态持久化到本地 .session/session.json 文件。
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const diagnose = require("./diagnose");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("./syncEnv");

loadSyncClientEnv();
prepareDirectNetworkEnvironment(process.env);
const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const SESSION_DIR = path.join(__dirname, ".session");
const SESSION_PATH = path.join(SESSION_DIR, "session.json");
const MOBILE_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const WECHAT_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
const DESKTOP_UA = "";
const FOSU_LOGIN_UA_MODE = String(process.env.FOSU_LOGIN_UA_MODE || process.env.FOSU_LOGIN_PROFILE || "mobile").toLowerCase() === "desktop" ? "desktop" : "mobile";
const LOGIN_AUTO = process.argv.includes("--auto") || process.argv.includes("auto") || process.env.FOSU_LOGIN_AUTO === "true";

function maskStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (!value) return "";
  if (process.env.FOSU_LOGIN_SHOW_STUDENT_ID === "true") return value;
  if (value.length <= 8) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function getLoginCredentials() {
  const studentId = String(
    process.env.FOSU_SYNC_STUDENT_ID ||
    process.env.FOSU_USERNAME ||
    process.env.FOSU_STUDENT_ID ||
    ""
  ).trim();
  const password = String(
    process.env.FOSU_SYNC_PASSWORD ||
    process.env.FOSU_PASSWORD ||
    ""
  );
  return { studentId, password };
}

function classifyLoginFailureContent(content, url, errorMessage) {
  const text = String(content || "").replace(/\s+/g, " ");
  const currentUrl = String(url || "");
  const message = String(errorMessage || "");
  if (/Timeout|超时|Navigation timeout/i.test(message)) return "NETWORK_TIMEOUT";
  if (/验证码|captcha/i.test(text)) return "CAPTCHA_REQUIRED";
  if (/滑块|拼图|人机|风险|风控|安全验证|risk/i.test(text)) return "RISK_CONTROL_REQUIRED";
  if (/密码错误|用户名或密码|账号或密码|认证失败|登录失败|不存在|incorrect/i.test(text)) return "INVALID_CREDENTIALS";
  if (/authserver\.fosu\.edu\.cn|\/authserver\/login/i.test(currentUrl) && !/username|password|账号|密码/i.test(text)) {
    return "LOGIN_PAGE_CHANGED";
  }
  if (/100\.fosu\.edu\.cn|authserver\.fosu\.edu\.cn/i.test(currentUrl)) return "LOGIN_NOT_COMPLETED";
  return "NETWORK_TIMEOUT";
}

function failureTipForCode(code) {
  if (code === "INVALID_CREDENTIALS") return "学号或密码不正确，请确认后重试。";
  if (code === "CAPTCHA_REQUIRED") return "当前需要验证码，请改用手动登录完成验证。";
  if (code === "RISK_CONTROL_REQUIRED") return "当前触发安全核验，请在浏览器中手动完成验证。";
  if (code === "LOGIN_PAGE_CHANGED") return "登录页结构可能已变化，需要检查选择器。";
  if (code === "NETWORK_TIMEOUT") return "访问超时，请确认校园网或 VPN 可用。";
  return "未检测到登录成功，请重新执行登录流程。";
}

// 确保会话目录存在
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

async function login() {
  // 1. 在登录前执行网络诊断
  const network = await diagnose();
  if (!network || network.readiness === "blocked") {
    console.error("❌ 网络连接诊断未通过，无法执行登录！");
    console.error("💡 请确认已连接 VPN 或处于校园网环境中。");
    process.exitCode = 1;
    return;
  }

  console.log("\n=== 启动 Playwright 手动登录流程 ===");
  console.log("正在为您打开浏览器，请稍候...");

  // 根据配置设定 User-Agent
  let userAgent = undefined;
  let viewport = undefined;
  if (FOSU_LOGIN_UA_MODE === "mobile") {
    userAgent = process.env.FOSU_LOGIN_UA || process.env.FOSU_IMPORT_MOBILE_UA || WECHAT_IOS_UA || MOBILE_SAFARI_UA;
    viewport = { width: 390, height: 844, isMobile: true };
  } else if (process.env.FOSU_LOGIN_UA) {
    userAgent = process.env.FOSU_LOGIN_UA;
  } else if (DESKTOP_UA) {
    userAgent = DESKTOP_UA;
  }
  console.log(`登录 UA 模式: ${FOSU_LOGIN_UA_MODE}${LOGIN_AUTO ? "，自动登录" : "，手动登录"}`);

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
    process.exitCode = 1;
    return;
  }

  const context = await browser.newContext({
    userAgent,
    viewport,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  const CAS_SERVICE_URL = 'http://100.fosu.edu.cn/caslogin.jsp?kstzType=null';
  const AUTH_LOGIN_URL = 'https://authserver.fosu.edu.cn/authserver/login?type=userNameLogin&service=' + encodeURIComponent(CAS_SERVICE_URL);

  console.log(`优先通过账号密码登录页进行登录: ${AUTH_LOGIN_URL} ...`);
  try {
    await page.goto(AUTH_LOGIN_URL, { timeout: 25000 });
  } catch (error) {
    console.warn(`⚠️ 访问账号密码登录页失败 (${error.message})，尝试直接访问统一身份认证登录路径...`);
    try {
      await page.goto('https://authserver.fosu.edu.cn/authserver/login', { timeout: 25000 });
    } catch (authError) {
      console.error(`❌ 导航统一身份认证系统彻底失败: ${authError.message}`);
      console.log("💡 请确认 EasyConnect 是否成功连接，或已处于校园网环境中。");
    }
  }

  console.log("\n📢 [操作提示]");
  console.log("========================================================");
  console.log("1. 请在打开的浏览器中手动输入您的佛大学学号与密码。");
  console.log("2. 如果遇到验证码或滑块验证，请手动完成输入或滑动。");
  console.log("3. 登录成功后，脚本会自动检测页面并保存登录态，随后自动关闭浏览器。");
  console.log("4. 请在 5 分钟内完成登录操作。");
  console.log("========================================================");

  const configuredCredentials = getLoginCredentials();
  if (LOGIN_AUTO) {
    if (!configuredCredentials.studentId || !configuredCredentials.password) {
      console.error("❌ 自动登录需要配置 FOSU_SYNC_STUDENT_ID 和 FOSU_SYNC_PASSWORD，或在 .env.local 中提供。");
      console.error("密码不会输出到日志，也不会写入 Git。");
      await browser.close();
      process.exitCode = 1;
      return;
    }
    console.log(`自动登录账号: ${maskStudentId(configuredCredentials.studentId)}`);
  }

  try {
    // 轮询检查登录态是否成功
    let loggedIn = false;
    let hasClickedTab = false; // 新增 Flag，防止频繁点击干扰用户输入
    let autoSubmitted = false;
    const checkInterval = 1000;
    const maxWaitTime = 300000; // 5分钟
    let elapsed = 0;

    while (elapsed < maxWaitTime) {
      if (page.isClosed()) {
        break;
      }

      const currentUrl = page.url();

      // 1. 如果检测到当前 URL 包含 type=fidoLogin，则自动跳转或替换为 type=userNameLogin
      if (currentUrl.includes("type=fidoLogin")) {
        console.log("⚠️ 检测到当前进入了生物识别登录页 (fidoLogin)，正在自动替换 URL 为账号密码登录页 (userNameLogin)...");
        const newUrl = currentUrl.replace("type=fidoLogin", "type=userNameLogin");
        try {
          await page.goto(newUrl, { timeout: 15000 });
          hasClickedTab = false; // 重置点击状态
          continue;
        } catch (e) {
          console.warn(`⚠️ 自动跳转到账号密码登录页失败: ${e.message}`);
        }
      }

      // 2. 如果页面存在“账号登录”tab，且尚未点击过，且 URL 不包含 userNameLogin，则优先点击账号登录
      if (!hasClickedTab && !currentUrl.includes("type=userNameLogin")) {
        try {
          const tabs = [
            "text=/^账号登录$/",
            "text=/^密码登录$/",
            "text=/^账号密码登录$/",
            "#userNameLogin",
            ".userNameLogin"
          ];
          for (const tabSelector of tabs) {
            const tab = page.locator(tabSelector).first();
            if (await tab.isVisible()) {
              console.log(`💡 检测到“账号密码登录”相关标签 (${tabSelector})，尝试点击切换...`);
              await tab.click();
              hasClickedTab = true; // 标记已点击，避免重复频繁点击
              await page.waitForTimeout(1000);
              break;
            }
          }
        } catch (e) {
          // 忽略检查/点击标签时的异常
        }
      }

      // 3. 支持用户手动输入账号密码登录，不要强制自动填密码。但如果有配置环境变量可以作为便利性辅助填充。
      const username = configuredCredentials.studentId;
      const password = configuredCredentials.password;
      if ((LOGIN_AUTO || username && password) && username && password) {
        try {
          const userSelectors = ['input[name="username"]', '#username', 'input[type="text"]'];
          const passSelectors = ['input[name="password"]', '#password', 'input[type="password"]'];
          
          let userEl = null;
          for (const sel of userSelectors) {
            const locator = page.locator(sel).first();
            if (await locator.isVisible()) {
              const val = await locator.inputValue();
              if (!val) {
                userEl = locator;
                break;
              }
            }
          }
          
          let passEl = null;
          for (const sel of passSelectors) {
            const locator = page.locator(sel).first();
            if (await locator.isVisible()) {
              const val = await locator.inputValue();
              if (!val) {
                passEl = locator;
                break;
              }
            }
          }
          
          if (userEl && passEl) {
            console.log(`检测到未填写的账号密码输入框，尝试自动填充账号 ${maskStudentId(username)}...`);
            await userEl.fill(username);
            await passEl.fill(password);
            if (LOGIN_AUTO && !autoSubmitted) {
              const submitSelectors = [
                "#login_submit",
                "#login",
                "button[type='submit']",
                "input[type='submit']",
                ".login-btn",
                "text=/^(登录|登 录|提交)$/"
              ];
              for (const selector of submitSelectors) {
                const submit = page.locator(selector).first();
                if (await submit.isVisible()) {
                  await submit.click();
                  autoSubmitted = true;
                  console.log("✅ 已提交自动登录请求。");
                  break;
                }
              }
              if (!autoSubmitted) {
                console.warn("⚠️ 未找到登录按钮，已填充账号，请手动点击登录。");
              }
            } else {
              console.log("✅ 账号密码自动填充成功，请手动完成验证（如验证码、滑块等）并提交登录。");
            }
          }
        } catch (e) {
          // 忽略自动填充错误
        }
      }

      // 4. 登录成功判定条件扩展
      const leftAuthserver = !currentUrl.includes("/authserver/login") && !currentUrl.includes("authserver.fosu.edu.cn/authserver/");
      const isCasLogin = currentUrl.includes("100.fosu.edu.cn/caslogin.jsp");
      const isEduSys = currentUrl.includes("100.fosu.edu.cn") && !currentUrl.includes("caslogin.jsp");
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

      if ((leftAuthserver && (isCasLogin || isEduSys)) || hasMainUrl || hasMainContent) {
        loggedIn = true;
        break;
      }

      await page.waitForTimeout(checkInterval);
      elapsed += checkInterval;
    }

    if (!loggedIn) {
      const content = page.isClosed() ? "" : await page.content().catch(() => "");
      const code = classifyLoginFailureContent(content, page.isClosed() ? "" : page.url(), "登录超时或未检测到登录成功的页面状态");
      const error = new Error(failureTipForCode(code));
      error.code = code;
      throw error;
    }

    console.log("🎉 检测到成功进入教务系统主页！正在保存会话状态...");

    // 等待 2 秒以确保浏览器会话状态写入完毕
    await page.waitForTimeout(2000);

    // 获取并保存 StorageState
    const storageState = await context.storageState();
    
    const cookiesCount = storageState.cookies.length;
    console.log(`成功获取到 ${cookiesCount} 个会话凭据项。`);

    fs.writeFileSync(SESSION_PATH, JSON.stringify(storageState, null, 2), "utf-8");
    console.log(`✅ 登录态已成功保存至本地文件: tools/fosu-sync-client/.session/session.json`);
    console.log("该文件包含敏感登录凭证，请勿将其提交到 Git 或共享给他人。");

  } catch (error) {
    const content = page && !page.isClosed() ? await page.content().catch(() => "") : "";
    const code = error.code || classifyLoginFailureContent(content, page && !page.isClosed() ? page.url() : "", error.message);
    if (code === "NETWORK_TIMEOUT") {
      console.error("\n❌ 登录超时或网络访问失败！");
    } else {
      console.error(`\n❌ 登录失败: ${failureTipForCode(code)}`);
    }
    console.error(`失败类型: ${code}`);
    console.error("💡 提示：");
    console.error("   - 请确认是否处于校园网 / 校园 VPN 环境（100.fosu.edu.cn 必须能正常解析和访问）");
    console.error("   - 请确认是否切换到账号登录，且已正确完成验证码或滑块验证等安全核验");
    console.error("   - 请重新执行 npm run sync:login");
  } finally {
    await browser.close();
    console.log("浏览器已关闭。");
  }
}

if (require.main === module) {
  login();
}

module.exports = login;
