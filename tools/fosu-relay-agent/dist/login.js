var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../fosu-sync-client/diagnose.js
var require_diagnose = __commonJS({
  "../fosu-sync-client/diagnose.js"(exports2, module2) {
    var dns = require("dns").promises;
    var axios = require("axios");
    require("dotenv").config();
    var FOSU_BASE_URL2 = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
    var FOSU_AUTH_URL = process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn";
    function isInternalIp(ip) {
      if (!ip) return false;
      if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
      if (ip.startsWith("172.")) {
        const parts = ip.split(".").map(Number);
        if (parts.length >= 2) {
          return parts[1] >= 16 && parts[1] <= 31;
        }
      }
      return ip.startsWith("172.");
    }
    async function diagnose2() {
      console.log("=== \u5F00\u59CB\u8BCA\u65AD\u4F5B\u5927\u6559\u52A1\u7F51\u8FDE\u63A5\u72B6\u6001 ===");
      console.log(`\u76EE\u6807\u6559\u52A1\u7F51: ${FOSU_BASE_URL2}`);
      console.log(`\u76EE\u6807\u7EDF\u4E00\u8BA4\u8BC1: ${FOSU_AUTH_URL}`);
      let hostname;
      try {
        hostname = new URL(FOSU_BASE_URL2).hostname;
      } catch (e) {
        console.error(`\u274C FOSU_BASE_URL \u683C\u5F0F\u4E0D\u6B63\u786E: ${e.message}`);
        process.exit(1);
      }
      console.log(`
1. \u6B63\u5728\u89E3\u6790 DNS: ${hostname} ...`);
      let addresses = [];
      let easyConnectLikelyConnected = false;
      try {
        const result = await dns.lookup(hostname, { all: true });
        addresses = result.map((r) => r.address);
        console.log(`   \u89E3\u6790\u6210\u529F\uFF01\u89E3\u6790\u5230\u4EE5\u4E0B IP \u5730\u5740:`);
        addresses.forEach((addr) => {
          const isInternal = isInternalIp(addr);
          if (isInternal) {
            easyConnectLikelyConnected = true;
          }
          console.log(`   - ${addr} [${isInternal ? "\u6821\u5185\u5185\u7F51 IP" : "\u5916\u7F51/\u516C\u7F51 IP"}]`);
        });
      } catch (error) {
        console.error(`\u274C DNS \u89E3\u6790\u5931\u8D25: ${error.message}`);
        console.log(`\u26A0\uFE0F  \u63D0\u793A: \u65E0\u6CD5\u89E3\u6790\u57DF\u540D\u3002\u8BF7\u5148\u8FDE\u63A5\u201C\u4F5B\u5927 EasyConnect\u201D\u6216\u8EAB\u5904\u201C\u4F5B\u5927\u6821\u56ED\u7F51\u201D\u73AF\u5883\u5185\u518D\u8BD5\uFF01`);
        return false;
      }
      if (!easyConnectLikelyConnected) {
        console.warn(`\u26A0\uFE0F  \u8B66\u544A: DNS \u89E3\u6790\u6210\u529F\u4F46\u672A\u5339\u914D\u5230\u6821\u5185\u5185\u7F51 IP \u8303\u56F4\u3002`);
      }
      console.log(`
2. \u6B63\u5728\u5C1D\u8BD5\u901A\u8FC7 Node.js \u8BBF\u95EE HTTPS ${FOSU_BASE_URL2} ...`);
      let httpsSuccess = false;
      let tlsHandshakeFailed = false;
      try {
        const response = await axios.get(FOSU_BASE_URL2, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpsSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTPS \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpsSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTPS \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
          const errStr = (error.message || "") + (error.code || "");
          if (errStr.includes("TLS") || errStr.includes("handshake") || errStr.includes("SSL") || errStr.includes("disconnected") || error.code === "ECONNRESET") {
            tlsHandshakeFailed = true;
          }
        }
      }
      let httpSuccess = false;
      const httpUrl = FOSU_BASE_URL2.replace(/^https:/i, "http:");
      console.log(`
3. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE HTTP \u7AEF\u53E3 ${httpUrl} ...`);
      try {
        const response = await axios.get(httpUrl, {
          timeout: 8e3,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01HTTP \u72B6\u6001\u7801: ${response.status}`);
        httpSuccess = true;
      } catch (error) {
        const responseUrl = error.config?.url || "";
        const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
        if (isRedirectToAuth || error.response && error.response.status === 302) {
          console.log(`   HTTP \u8BBF\u95EE\u6210\u529F\uFF01\u5DF2\u6210\u529F\u8DF3\u8F6C\u81F3\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u9875\u9762\u3002`);
          httpSuccess = true;
        } else {
          console.warn(`\u26A0\uFE0F  HTTP \u8BBF\u95EE\u5931\u8D25: ${error.message}`);
        }
      }
      console.log(`
4. \u6B63\u5728\u5C1D\u8BD5\u8BBF\u95EE\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1 ${FOSU_AUTH_URL} ...`);
      let authSuccess = false;
      try {
        await axios.get(FOSU_AUTH_URL, {
          timeout: 8e3
        });
        console.log(`   \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u54CD\u5E94\u6B63\u5E38\u3002`);
        authSuccess = true;
      } catch (error) {
        console.log(`\u26A0\uFE0F  \u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u8BBF\u95EE\u8B66\u544A (\u53EF\u80FD\u4E0D\u5F71\u54CD\u4F7F\u7528): ${error.message}`);
      }
      console.log(`
===================================`);
      if (httpsSuccess || httpSuccess) {
        console.log(`\u{1F389} \u8BCA\u65AD\u7ED3\u679C: \u672C\u673A\u6821\u5185\u7F51\u73AF\u5883\u6B63\u5E38\uFF01\u5DF2\u6210\u529F\u8FDE\u63A5\u5230\u6559\u52A1\u7F51\u3002`);
        console.log(`\u60A8\u53EF\u4EE5\u7EE7\u7EED\u8FD0\u884C 'npm run login' \u8FDB\u884C\u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected && tlsHandshakeFailed) {
        console.log(`\u2139\uFE0F  [NODE_TLS_HANDSHAKE_FAILED]`);
        console.log(`\u63D0\u793A: Node.js \u4E0E\u5B66\u6821\u5185\u7F51 HTTPS \u670D\u52A1\u63E1\u624B\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185 IP\uFF0C\u53EF\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u6D4F\u89C8\u5668\u767B\u5F55\u3002`);
        console.log(`\u8BF7\u8FD0\u884C 'npm run login'\uFF0CPlaywright \u6D4F\u89C8\u5668\u80FD\u591F\u5FFD\u7565\u6B64 TLS \u63E1\u624B\u95EE\u9898\u3002`);
        console.log(`===================================`);
        return true;
      }
      if (easyConnectLikelyConnected) {
        console.log(`\u2139\uFE0F  \u63D0\u793A: \u867D\u7136 Node.js \u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF0C\u4F46 DNS \u5DF2\u89E3\u6790\u5230\u6821\u5185\u5185\u7F51 IP\uFF0C\u5141\u8BB8\u7EE7\u7EED\u5C1D\u8BD5 Playwright \u767B\u5F55\u3002`);
        console.log(`===================================`);
        return true;
      }
      console.error(`\u274C \u8BCA\u65AD\u7ED3\u679C: \u65E0\u6CD5\u8FDE\u63A5\u5230\u5B66\u6821\u6559\u52A1\u7F51\uFF01`);
      console.log(`\u{1F4A1} \u63D0\u793A: \u8BF7\u5148\u786E\u8BA4\u5DF2\u542F\u52A8\u5E76\u6210\u529F\u8FDE\u63A5\u4E86 EasyConnect VPN\u3002`);
      console.log(`===================================`);
      return false;
    }
    if (require.main === module2) {
      diagnose2().then((success) => {
        process.exit(success ? 0 : 1);
      });
    }
    module2.exports = diagnose2;
  }
});

// ../fosu-sync-client/login.js
var { chromium } = require("playwright");
var path = require("path");
var fs = require("fs");
var diagnose = require_diagnose();
require("dotenv").config();
var FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
var SESSION_DIR = path.join(__dirname, ".session");
var SESSION_PATH = path.join(SESSION_DIR, "session.json");
var FOSU_LOGIN_PROFILE = process.env.FOSU_LOGIN_PROFILE || "desktop";
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}
async function login() {
  const isNetOk = await diagnose();
  if (!isNetOk) {
    console.error("\u274C \u7F51\u7EDC\u8FDE\u63A5\u8BCA\u65AD\u672A\u901A\u8FC7\uFF0C\u65E0\u6CD5\u6267\u884C\u767B\u5F55\uFF01");
    console.error("\u{1F4A1} \u8BF7\u786E\u8BA4\u5DF2\u8FDE\u63A5 VPN \u6216\u5904\u4E8E\u6821\u56ED\u7F51\u73AF\u5883\u4E2D\u3002");
    process.exit(1);
  }
  console.log("\n=== \u542F\u52A8 Playwright \u624B\u52A8\u767B\u5F55\u6D41\u7A0B ===");
  console.log("\u6B63\u5728\u4E3A\u60A8\u6253\u5F00\u6D4F\u89C8\u5668\uFF0C\u8BF7\u7A0D\u5019...");
  let userAgent = void 0;
  let viewport = void 0;
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
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false,
        args: launchArgs
      };
      if (channel) {
        config.channel = channel;
        console.log(`\u5C1D\u8BD5\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u901A\u9053: ${channel} ...`);
      } else {
        console.log("\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668 ...");
      }
      browser = await chromium.launch(config);
      break;
    } catch (e) {
      console.warn(`\u26A0\uFE0F \u6D4F\u89C8\u5668\u901A\u9053 ${channel || "\u5185\u7F6E"} \u542F\u52A8\u5931\u8D25: ${e.message}`);
    }
  }
  if (!browser) {
    console.error("\u274C \u65E0\u6CD5\u542F\u52A8\u4EFB\u4F55\u6D4F\u89C8\u5668\uFF01\u8BF7\u68C0\u67E5 Playwright \u5B89\u88C5\u662F\u5426\u5B8C\u6574\u3002");
    process.exit(1);
  }
  const context = await browser.newContext({
    userAgent,
    viewport,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const CAS_SERVICE_URL = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
  const AUTH_LOGIN_URL = "https://authserver.fosu.edu.cn/authserver/login?type=userNameLogin&service=" + encodeURIComponent(CAS_SERVICE_URL);
  console.log(`\u4F18\u5148\u901A\u8FC7\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u8FDB\u884C\u767B\u5F55: ${AUTH_LOGIN_URL} ...`);
  try {
    await page.goto(AUTH_LOGIN_URL, { timeout: 25e3 });
  } catch (error) {
    console.warn(`\u26A0\uFE0F \u8BBF\u95EE\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u5931\u8D25 (${error.message})\uFF0C\u5C1D\u8BD5\u76F4\u63A5\u8BBF\u95EE\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u767B\u5F55\u8DEF\u5F84...`);
    try {
      await page.goto("https://authserver.fosu.edu.cn/authserver/login", { timeout: 25e3 });
    } catch (authError) {
      console.error(`\u274C \u5BFC\u822A\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u5F7B\u5E95\u5931\u8D25: ${authError.message}`);
      console.log("\u{1F4A1} \u8BF7\u786E\u8BA4 EasyConnect \u662F\u5426\u6210\u529F\u8FDE\u63A5\uFF0C\u6216\u5DF2\u5904\u4E8E\u6821\u56ED\u7F51\u73AF\u5883\u4E2D\u3002");
    }
  }
  console.log("\n\u{1F4E2} [\u64CD\u4F5C\u63D0\u793A]");
  console.log("========================================================");
  console.log("1. \u8BF7\u5728\u6253\u5F00\u7684\u6D4F\u89C8\u5668\u4E2D\u624B\u52A8\u8F93\u5165\u60A8\u7684\u4F5B\u5927\u5B66\u5B66\u53F7\u4E0E\u5BC6\u7801\u3002");
  console.log("2. \u5982\u679C\u9047\u5230\u9A8C\u8BC1\u7801\u6216\u6ED1\u5757\u9A8C\u8BC1\uFF0C\u8BF7\u624B\u52A8\u5B8C\u6210\u8F93\u5165\u6216\u6ED1\u52A8\u3002");
  console.log("3. \u767B\u5F55\u6210\u529F\u540E\uFF0C\u811A\u672C\u4F1A\u81EA\u52A8\u68C0\u6D4B\u9875\u9762\u5E76\u4FDD\u5B58\u767B\u5F55\u6001\uFF0C\u968F\u540E\u81EA\u52A8\u5173\u95ED\u6D4F\u89C8\u5668\u3002");
  console.log("4. \u8BF7\u5728 5 \u5206\u949F\u5185\u5B8C\u6210\u767B\u5F55\u64CD\u4F5C\u3002");
  console.log("========================================================");
  try {
    let loggedIn = false;
    let hasClickedTab = false;
    const checkInterval = 1e3;
    const maxWaitTime = 3e5;
    let elapsed = 0;
    while (elapsed < maxWaitTime) {
      if (page.isClosed()) {
        break;
      }
      const currentUrl = page.url();
      if (currentUrl.includes("type=fidoLogin")) {
        console.log("\u26A0\uFE0F \u68C0\u6D4B\u5230\u5F53\u524D\u8FDB\u5165\u4E86\u751F\u7269\u8BC6\u522B\u767B\u5F55\u9875 (fidoLogin)\uFF0C\u6B63\u5728\u81EA\u52A8\u66FF\u6362 URL \u4E3A\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875 (userNameLogin)...");
        const newUrl = currentUrl.replace("type=fidoLogin", "type=userNameLogin");
        try {
          await page.goto(newUrl, { timeout: 15e3 });
          hasClickedTab = false;
          continue;
        } catch (e) {
          console.warn(`\u26A0\uFE0F \u81EA\u52A8\u8DF3\u8F6C\u5230\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u5931\u8D25: ${e.message}`);
        }
      }
      if (!hasClickedTab && !currentUrl.includes("type=userNameLogin")) {
        try {
          const tabs = [
            "text=/^\u8D26\u53F7\u767B\u5F55$/",
            "text=/^\u5BC6\u7801\u767B\u5F55$/",
            "text=/^\u8D26\u53F7\u5BC6\u7801\u767B\u5F55$/",
            "#userNameLogin",
            ".userNameLogin"
          ];
          for (const tabSelector of tabs) {
            const tab = page.locator(tabSelector).first();
            if (await tab.isVisible()) {
              console.log(`\u{1F4A1} \u68C0\u6D4B\u5230\u201C\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u201D\u76F8\u5173\u6807\u7B7E (${tabSelector})\uFF0C\u5C1D\u8BD5\u70B9\u51FB\u5207\u6362...`);
              await tab.click();
              hasClickedTab = true;
              await page.waitForTimeout(1e3);
              break;
            }
          }
        } catch (e) {
        }
      }
      const username = process.env.FOSU_USERNAME;
      const password = process.env.FOSU_PASSWORD;
      if (username && password) {
        try {
          const userSelectors = ['input[name="username"]', "#username", 'input[type="text"]'];
          const passSelectors = ['input[name="password"]', "#password", 'input[type="password"]'];
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
            console.log("\u68C0\u6D4B\u5230\u672A\u586B\u5199\u7684\u8D26\u53F7\u5BC6\u7801\u8F93\u5165\u6846\uFF0C\u5C1D\u8BD5\u81EA\u52A8\u586B\u5145...");
            await userEl.fill(username);
            await passEl.fill(password);
            console.log("\u2705 \u8D26\u53F7\u5BC6\u7801\u81EA\u52A8\u586B\u5145\u6210\u529F\uFF0C\u8BF7\u624B\u52A8\u5B8C\u6210\u9A8C\u8BC1\uFF08\u5982\u9A8C\u8BC1\u7801\u3001\u6ED1\u5757\u7B49\uFF09\u5E76\u63D0\u4EA4\u767B\u5F55\u3002");
          }
        } catch (e) {
        }
      }
      const leftAuthserver = !currentUrl.includes("/authserver/login") && !currentUrl.includes("authserver.fosu.edu.cn/authserver/");
      const isCasLogin = currentUrl.includes("100.fosu.edu.cn/caslogin.jsp");
      const isEduSys = currentUrl.includes("100.fosu.edu.cn") && !currentUrl.includes("caslogin.jsp");
      const hasMainUrl = currentUrl.includes("/framework/xsMain.jsp") || currentUrl.includes("/framework/index.jsp") || currentUrl.includes("/xsMain.jsp");
      let hasMainContent = false;
      try {
        const content = await page.content();
        hasMainContent = content.includes("\u6559\u5B66\u4E00\u4F53\u5316\u670D\u52A1\u5E73\u53F0") || content.includes("\u6211\u7684\u684C\u9762") || content.includes("\u5B66\u671F\u7406\u8BBA\u8BFE\u8868");
      } catch (e) {
      }
      if (leftAuthserver && (isCasLogin || isEduSys) || hasMainUrl || hasMainContent) {
        loggedIn = true;
        break;
      }
      await page.waitForTimeout(checkInterval);
      elapsed += checkInterval;
    }
    if (!loggedIn) {
      throw new Error("\u767B\u5F55\u8D85\u65F6\u6216\u672A\u68C0\u6D4B\u5230\u767B\u5F55\u6210\u529F\u7684\u9875\u9762\u72B6\u6001");
    }
    console.log("\u{1F389} \u68C0\u6D4B\u5230\u6210\u529F\u8FDB\u5165\u6559\u52A1\u7CFB\u7EDF\u4E3B\u9875\uFF01\u6B63\u5728\u4FDD\u5B58\u4F1A\u8BDD\u72B6\u6001...");
    await page.waitForTimeout(2e3);
    const storageState = await context.storageState();
    const cookiesCount = storageState.cookies.length;
    console.log(`\u6210\u529F\u83B7\u53D6\u5230 ${cookiesCount} \u4E2A\u4F1A\u8BDD Cookie\u3002`);
    fs.writeFileSync(SESSION_PATH, JSON.stringify(storageState, null, 2), "utf-8");
    console.log(`\u2705 \u767B\u5F55\u6001\u5DF2\u6210\u529F\u4FDD\u5B58\u81F3\u672C\u5730\u6587\u4EF6: tools/fosu-sync-client/.session/session.json`);
    console.log("\u8BE5\u6587\u4EF6\u5305\u542B\u654F\u611F\u767B\u5F55\u51ED\u8BC1\uFF0C\u8BF7\u52FF\u5C06\u5176\u63D0\u4EA4\u5230 Git \u6216\u5171\u4EAB\u7ED9\u4ED6\u4EBA\u3002");
  } catch (error) {
    if (error.name === "TimeoutError" || error.message.includes("Timeout") || error.message.includes("\u767B\u5F55\u8D85\u65F6\u6216\u672A\u68C0\u6D4B\u5230\u767B\u5F55\u6210\u529F\u7684\u9875\u9762\u72B6\u6001")) {
      console.error("\n\u274C \u767B\u5F55\u8D85\u65F6\u6216\u5931\u8D25\uFF01");
    } else {
      console.error(`
\u274C \u767B\u5F55\u8FC7\u7A0B\u4E2D\u53D1\u751F\u9519\u8BEF: ${error.message}`);
    }
    console.error("\u{1F4A1} \u63D0\u793A\uFF1A");
    console.error("   - \u8BF7\u786E\u8BA4\u662F\u5426\u5904\u4E8E\u6821\u56ED\u7F51 / \u6821\u56ED VPN \u73AF\u5883\uFF08100.fosu.edu.cn \u5FC5\u987B\u80FD\u6B63\u5E38\u89E3\u6790\u548C\u8BBF\u95EE\uFF09");
    console.error("   - \u8BF7\u786E\u8BA4\u662F\u5426\u5207\u6362\u5230\u8D26\u53F7\u767B\u5F55\uFF0C\u4E14\u5DF2\u6B63\u786E\u5B8C\u6210\u9A8C\u8BC1\u7801\u6216\u6ED1\u5757\u9A8C\u8BC1\u7B49\u5B89\u5168\u6838\u9A8C");
    console.error("   - \u8BF7\u91CD\u65B0\u6267\u884C npm run login");
  } finally {
    await browser.close();
    console.log("\u6D4F\u89C8\u5668\u5DF2\u5173\u95ED\u3002");
  }
}
if (require.main === module) {
  login();
}
module.exports = login;
