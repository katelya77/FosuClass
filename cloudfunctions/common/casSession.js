const fs = require("fs");
const path = require("path");
const { CookieJar } = require("tough-cookie");
const { createClient } = require("./requestClient");
const { safeLog } = require("./safeLogger");

// NOTE: 缓存 Session，保存在云函数容器内存中，实现容器生命周期内的复用
let globalJar = new CookieJar();
let globalClient = createClient({ jar: globalJar });
let isLoggingIn = false; // 防止并发请求重复登录
let lastLoginTime = 0;

/**
 * 动态加载本地 Secrets (仅供本地调试，Git 已忽略)
 */
function loadLocalSecrets() {
  let secrets = {};
  try {
    let currentDir = __dirname;
    for (let i = 0; i < 6; i++) {
      const secretsPath = path.join(currentDir, "local.secrets.json");
      if (fs.existsSync(secretsPath)) {
        secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
        break;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }
  } catch (error) {
    safeLog("load-secrets-error", { message: error.message });
  }
  return secrets;
}

/**
 * 获取服务的登录凭证
 */
function getCredentials() {
  const secrets = loadLocalSecrets();
  const username = process.env.FOSU_SERVICE_USERNAME || secrets.FOSU_SERVICE_USERNAME || secrets.FOSU_STUDENT_ID;
  const password = process.env.FOSU_SERVICE_PASSWORD || secrets.FOSU_SERVICE_PASSWORD || secrets.FOSU_PASSWORD;
  
  if (!username || !password) {
    throw new Error("Missing FOSU_SERVICE_USERNAME or FOSU_SERVICE_PASSWORD environment variables.");
  }
  return { username, password };
}

/**
 * 判断 HTML 页面是否是 CAS 登录页
 * @param {string} html 页面内容
 * @returns {boolean} 是否为登录页
 */
function isLoginPage(html) {
  const content = String(html || "");
  return content.includes("username") && (content.includes("password") || content.includes("execution"));
}

/**
 * 从 CAS 登录页解析表单隐藏项
 * @param {string} html 页面 HTML
 * @returns {Object} 解析出的隐藏字段
 */
function parseLoginForm(html) {
  const content = String(html || "");
  
  const executionMatch = content.match(/name=["']execution["']\s+value=["']([^"']+)["']/) ||
                         content.match(/value=["']([^"']+)["']\s+name=["']execution["']/);
  const ltMatch = content.match(/name=["']lt["']\s+value=["']([^"']+)["']/) ||
                  content.match(/value=["']([^"']+)["']\s+name=["']lt["']/);
  const dlltMatch = content.match(/name=["']dllt["']\s+value=["']([^"']+)["']/) ||
                    content.match(/value=["']([^"']+)["']\s+name=["']dllt["']/);
  const clltMatch = content.match(/name=["']cllt["']\s+value=["']([^"']+)["']/) ||
                    content.match(/value=["']([^"']+)["']\s+name=["']cllt["']/);
  const eventIdMatch = content.match(/name=["']_eventId["']\s+value=["']([^"']+)["']/) ||
                       content.match(/value=["']([^"']+)["']\s+name=["']_eventId["']/);

  return {
    execution: executionMatch ? executionMatch[1] : "",
    lt: ltMatch ? ltMatch[1] : "",
    dllt: dlltMatch ? dlltMatch[1] : "userNameMenuItem",
    cllt: clltMatch ? clltMatch[1] : "userNameMenuItem",
    _eventId: eventIdMatch ? eventIdMatch[1] : "submit",
  };
}

/**
 * 执行 CAS 模拟登录流程
 */
async function performLogin() {
  if (isLoggingIn) {
    // 如果已经在登录中，等待 1 秒再返回，避免并发登录
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return;
  }
  
  isLoggingIn = true;
  safeLog("cas-login-start", {});
  
  try {
    const { username, password } = getCredentials();
    
    // 重新初始化会话 Cookie 容器，防止残留脏数据
    globalJar = new CookieJar();
    globalClient = createClient({ jar: globalJar });

    const serviceUrl = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
    const loginUrl = `https://authserver.fosu.edu.cn/authserver/login?service=${encodeURIComponent(serviceUrl)}`;

    // 1. GET 登录页以获得初始 Cookies (如 JSESSIONID) 和隐藏表单参数
    const getRes = await globalClient.get(loginUrl);
    const html = getRes.data;

    if (!isLoginPage(html)) {
      // 如果获取回来的不是登录页，且没有需要登录的特征，说明已经直接跳过登录了
      safeLog("cas-login-bypass", { message: "GET response is not a login page" });
      isLoggingIn = false;
      lastLoginTime = Date.now();
      return;
    }

    const formParams = parseLoginForm(html);
    if (!formParams.execution || !formParams.lt) {
      safeLog("cas-parse-warn", { execution: Boolean(formParams.execution), lt: Boolean(formParams.lt) });
    }

    // 检测是否需要验证码
    if (html.includes("captcha") && html.includes("captchaImg")) {
      throw new Error("NEED_CAPTCHA");
    }

    // 2. 准备 POST 表单参数
    const postData = new URLSearchParams();
    postData.append("username", username);
    postData.append("password", password);
    postData.append("lt", formParams.lt);
    postData.append("dllt", formParams.dllt);
    postData.append("cllt", formParams.cllt);
    postData.append("execution", formParams.execution);
    postData.append("_eventId", formParams._eventId);
    postData.append("rmShown", "1");

    safeLog("cas-login-post-attempt", { username: username.slice(0, 2) + "****" });

    // 3. 发送登录 POST
    const postRes = await globalClient.post(loginUrl, postData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginUrl,
      },
    });

    const finalHtml = postRes.data;
    
    // 检查最终页面是否仍为登录页（如果登录失败，CAS会返回包含错误提示的登录页）
    if (isLoginPage(finalHtml)) {
      // 提取错误提示
      const errorMatch = finalHtml.match(/id="showErrorMsg"[^>]*>([\s\S]*?)<\/span>/i) || 
                         finalHtml.match(/class="auth_error_msg"[^>]*>([\s\S]*?)<\/div>/i);
      const errMsg = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, "").trim() : "用户名或密码错误";
      safeLog("cas-login-failed-page", { errMsg });
      throw new Error(`NEED_LOGIN: ${errMsg}`);
    }

    safeLog("cas-login-success", { url: postRes.config?.url });
    lastLoginTime = Date.now();
  } catch (error) {
    safeLog("cas-login-error", { error: error.message });
    throw error;
  } finally {
    isLoggingIn = false;
  }
}

/**
 * 获取一个可用的会话客户端
 * @param {boolean} forceRefresh 是否强制重新登录
 * @returns {Promise<import("axios").AxiosInstance>} 会话客户端
 */
async function getSession(forceRefresh = false) {
  // 如果 Cookie 已经超过 15 分钟没刷新，或者强制刷新，则进行登录
  const isExpired = Date.now() - lastLoginTime > 15 * 60 * 1000;
  
  if (forceRefresh || isExpired || lastLoginTime === 0) {
    await performLogin();
  }
  
  return globalClient;
}

/**
 * 校验请求结果，并在登录失效时自动重试一次
 * @param {Function} requestFn 返回请求 promise 的函数
 * @returns {Promise<any>} 请求结果
 */
async function requestWithRetry(requestFn) {
  let client = await getSession();
  try {
    const res = await requestFn(client);
    // 判断返回的是否是登录页，强智系统如果 Cookie 失效，可能会 302 重定向到登录页并被 axios 自动跟随返回登录页 HTML
    if (isLoginPage(res.data)) {
      safeLog("cas-session-expired-detect", { action: "retrying-login" });
      client = await getSession(true); // 强制重新登录
      return await requestFn(client); // 重试
    }
    return res;
  } catch (error) {
    // 如果是 401 或 302 等异常
    const status = error.response?.status;
    if (status === 401 || status === 302) {
      safeLog("cas-http-status-expired", { status, action: "retrying-login" });
      client = await getSession(true);
      return await requestFn(client);
    }
    throw error;
  }
}

module.exports = {
  getSession,
  requestWithRetry,
  isLoginPage,
};
