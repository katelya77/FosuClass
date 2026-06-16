const fs = require("fs");
const path = require("path");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("./syncEnv");

const SESSION_PATH = path.join(__dirname, ".session", "session.json");
const MAIN_PAGE_PATH = "/framework/xsMain.jsp";

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getExpiredSessionTip() {
  return "Session 已失效，请运行 npm run login";
}

function hasLoginUrl(url) {
  return /authserver\.fosu\.edu\.cn|\/authserver\/login|login/i.test(String(url || ""));
}

function hasLoginContent(content) {
  return /统一身份认证|账号登录|密码登录|userNameLogin|authserver/i.test(String(content || ""));
}

function hasEduHomeContent(content) {
  return /教学一体化服务平台|我的桌面|学期理论课表|xsMain|framework/i.test(String(content || ""));
}

async function loadChromium(options = {}) {
  if (options.chromium) return options.chromium;
  const playwright = require("playwright");
  return playwright.chromium;
}

async function launchBrowser(chromium, options = {}) {
  const channels = options.channels || ["msedge", "chrome", null];
  let lastError = null;
  for (const channel of channels) {
    try {
      const config = {
        headless: options.headless !== false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--ignore-certificate-errors",
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--no-proxy-server",
        ],
      };
      if (channel) config.channel = channel;
      return await chromium.launch(config);
    } catch (error) {
      lastError = error;
    }
  }
  const error = createError("PLAYWRIGHT_LAUNCH_FAILED", lastError && lastError.message || "Unable to launch browser");
  error.originalError = lastError;
  throw error;
}

async function verifySession(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fs || fs;
  loadSyncClientEnv({ env });
  prepareDirectNetworkEnvironment(env, { axios: options.axios });

  const sessionPath = options.sessionPath || SESSION_PATH;
  let stat = null;
  try {
    stat = fsImpl.existsSync(sessionPath) ? fsImpl.statSync(sessionPath) : null;
  } catch (error) {
    stat = null;
  }
  if (!stat || stat.size < 20) {
    return {
      ok: false,
      code: "SESSION_EXPIRED",
      message: getExpiredSessionTip(),
      sessionFile: "missing-or-empty",
    };
  }

  const chromium = await loadChromium(options);
  const browser = await launchBrowser(chromium, options);
  let context = null;
  try {
    context = await browser.newContext({
      storageState: sessionPath,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const baseUrl = String(env.FOSU_BASE_URL || "https://100.fosu.edu.cn").replace(/\/+$/g, "");
    const httpBase = baseUrl.replace(/^https:/i, "http:");
    const targetUrls = [
      `${httpBase}${MAIN_PAGE_PATH}`,
      `${baseUrl}${MAIN_PAGE_PATH}`,
    ];
    let lastError = null;
    for (const targetUrl of targetUrls) {
      try {
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: Number(options.timeoutMs || 25000),
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      return {
        ok: false,
        code: "SESSION_EXPIRED",
        message: getExpiredSessionTip(),
        reason: "navigation-failed",
        detail: lastError.message,
      };
    }

    const currentUrl = page.url();
    const content = await page.content().catch(() => "");
    const redirectedToLogin = hasLoginUrl(currentUrl) || hasLoginContent(content);
    const eduHome = hasEduHomeContent(content) || /100\.fosu\.edu\.cn/i.test(currentUrl) && !hasLoginUrl(currentUrl);
    if (redirectedToLogin || !eduHome) {
      return {
        ok: false,
        code: "SESSION_EXPIRED",
        message: getExpiredSessionTip(),
        redirectedToLogin,
        eduHome,
      };
    }

    return {
      ok: true,
      code: "SESSION_VALID",
      message: "SESSION_VALID",
      redirectedToLogin: false,
      eduHome: true,
    };
  } finally {
    if (context && typeof context.close === "function") {
      await context.close().catch(() => {});
    }
    if (browser && typeof browser.close === "function") {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  MAIN_PAGE_PATH,
  SESSION_PATH,
  getExpiredSessionTip,
  hasEduHomeContent,
  hasLoginContent,
  hasLoginUrl,
  verifySession,
};
