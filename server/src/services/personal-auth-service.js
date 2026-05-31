/**
 * 个人学号统一认证服务
 * NOTE: 负责初始化登录会话、滑块验证、以及手动追踪跨域 302 重定向以安全交换统一认证登录票据。
 */

const dns = require("dns").promises;
const axios = require("axios");
const cheerio = require("cheerio");
const { createClient } = require("../utils/requestClient");
const { createSession, getSession, destroySession } = require("../utils/fosu-cookie-jar");
const { encryptFosuPassword } = require("../utils/fosu-password-encrypt");
const { safeLog, maskStudentId } = require("../utils/safeLogger");

/**
 * 判断是否为 DNS 解析错误
 * @param {Error} error 错误对象
 * @returns {boolean} 是否为 DNS 错误
 */
function isDnsError(error) {
  const code = error.code || "";
  return code === "ENOTFOUND" || code === "EAI_AGAIN";
}

/**
 * 校验校园网及教务网连通性
 */
async function assertCampusNetworkReachable() {
  const eduHost = "100.fosu.edu.cn";
  const authHost = "authserver.fosu.edu.cn";

  // 1. DNS 是否能解析 100.fosu.edu.cn
  try {
    await dns.lookup(eduHost);
  } catch (error) {
    safeLog("personal-reachability-dns-failed", { host: eduHost, error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  // 2. authserver.fosu.edu.cn 是否能访问
  try {
    await axios.get(`https://${authHost}`, { timeout: 3000, validateStatus: () => true });
  } catch (error) {
    safeLog("personal-reachability-auth-failed", { host: authHost, error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  // 3. 100.fosu.edu.cn 是否能访问
  try {
    await axios.get(`http://${eduHost}`, { timeout: 3000, validateStatus: () => true });
  } catch (error) {
    safeLog("personal-reachability-edu-failed", { host: eduHost, error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }
}

/**
 * 初始化个人登录会话，抓取 CAS 登录页与滑块验证码
 * @param {string} [studentId] 预检学号（不写日志）
 * @returns {Promise<Object>} 会话 ID 与滑块 Base64 图片等数据
 */
async function startPersonalSession(studentId) {
  const config = require("../config");
  if (config.CAMPUS_AGENT_ENABLED) {
    if (!config.CAMPUS_AGENT_BASE_URL) {
      throw new Error("VPN_GATEWAY_UNAVAILABLE");
    }
    return {
      success: true,
      useAgent: true,
      sessionId: "agent-session-temp",
      expiresIn: 300
    };
  }

  // 1. 预检 100 网的 DNS 解析及连通性是否正常
  await assertCampusNetworkReachable();

  // 2. 初始化内存会话并生成 Session ID
  const session = createSession();
  const sessionId = session.sessionId;

  // 3. 创建绑定会话 CookieJar 的 Axios 客户端
  const client = createClient({ jar: session.authCookieJar });

  const serviceUrl = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
  const loginUrl = `https://authserver.fosu.edu.cn/authserver/login?service=${encodeURIComponent(serviceUrl)}`;

  session.loginUrl = loginUrl;
  session.serviceUrl = serviceUrl;

  let response;
  try {
    response = await client.get(loginUrl, { timeout: 10000 });
  } catch (error) {
    safeLog("personal-session-network-error", { error: error.message });
    if (isDnsError(error)) {
      throw new Error("AUTHSERVER_UNREACHABLE"); // DNS 解析失败，判定为认证站不可达
    }
    throw new Error("AUTHSERVER_UNREACHABLE");
  }

  const html = response.data;

  // 4. 解析隐藏字段
  const $ = cheerio.load(html);
  const execution = $("#execution").val() || $("input[name='execution']").val() || "";
  const pwdEncryptSalt = $("#pwdEncryptSalt").val() || "";
  const lt = $("#lt").val() || $("input[name='lt']").val() || "";

  if (!execution || !pwdEncryptSalt) {
    throw new Error("LOGIN_PAGE_CHANGED");
  }

  session.execution = execution;
  session.pwdEncryptSalt = pwdEncryptSalt;
  session.lt = lt;

  // 5. 拉取滑块图片 JSON
  // NOTE: 根据 login.js 逻辑，直接通过 contextPath 拼接 /common/openSliderCaptcha.htl 请求，不再携带 lcpz7WKu 动态参数
  const captchaUrl = `https://authserver.fosu.edu.cn/authserver/common/openSliderCaptcha.htl?_=${Date.now()}`;
  let captchaRes;
  try {
    captchaRes = await client.get(captchaUrl, { timeout: 5000 });
  } catch (error) {
    safeLog("personal-session-captcha-fetch-failed", { error: error.message });
    throw new Error("SLIDER_ENDPOINT_FAILED");
  }

  let captchaData = captchaRes.data;
  if (typeof captchaData === "string") {
    try {
      captchaData = JSON.parse(captchaData);
    } catch (e) {
      throw new Error("SLIDER_ENDPOINT_FAILED");
    }
  }

  if (!captchaData || !captchaData.bigImage || !captchaData.smallImage) {
    throw new Error("SLIDER_ENDPOINT_FAILED");
  }

  return {
    success: true,
    sessionId,
    captcha: {
      bigImage: captchaData.bigImage,
      smallImage: captchaData.smallImage,
      tagWidth: captchaData.tagWidth || 93,
      canvasLength: 340,
    },
    expiresIn: 300,
  };
}

/**
 * 校验拖动滑块验证码
 * @param {string} sessionId 会话 ID
 * @param {number} canvasLength 背景总长度 (默认 340)
 * @param {number} moveLength 实际偏移量
 * @returns {Promise<Object>} 验证结果
 */
async function verifyPersonalSlider(sessionId, canvasLength, moveLength) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error("SESSION_EXPIRED");
  }

  const client = createClient({ jar: session.authCookieJar });
  // NOTE: 根据 longbow.slidercaptchas.js，直接请求 verifySliderCaptcha.htl，移除 query 参数中过时的 lcpz7WKu 字段
  const verifyUrl = "https://authserver.fosu.edu.cn/authserver/common/verifySliderCaptcha.htl";

  const postData = new URLSearchParams();
  postData.append("canvasLength", String(canvasLength || 340));
  postData.append("moveLength", String(moveLength));

  let response;
  try {
    response = await client.post(verifyUrl, postData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Referer: session.loginUrl,
      },
      timeout: 5000,
    });
  } catch (error) {
    safeLog("personal-slider-verify-network-error", { error: error.message });
    throw new Error("SLIDER_VERIFY_FAILED");
  }

  let resData = response.data;
  if (typeof resData === "string") {
    try {
      resData = JSON.parse(resData);
    } catch (e) {
      throw new Error("SLIDER_VERIFY_FAILED");
    }
  }

  if (resData && resData.errorCode === 1) {
    session.verified = true;
    return {
      success: true,
      verified: true,
    };
  } else {
    throw new Error("SLIDER_VERIFY_FAILED");
  }
}

/**
 * 执行个人学号登录并返回有效的教务会话 CookieJar
 * @param {string} sessionId 会话 ID
 * @param {string} studentId 学号
 * @param {string} password 密码
 * @returns {Promise<Object>} 登录成功后的 CookieJar 及学生基本信息
 */
async function loginAndGetJar(sessionId, studentId, password) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error("SESSION_EXPIRED");
  }

  if (!session.verified) {
    throw new Error("SLIDER_VERIFY_FAILED");
  }

  // 1. 进行密码 AES 加密
  const encryptedPassword = encryptFosuPassword(password, session.pwdEncryptSalt);

  // 2. 构造禁用自动重定向的 Axios 实例，手动跟踪重定向
  const client = createClient({
    jar: session.authCookieJar,
    maxRedirects: 0,
  });

  const postData = new URLSearchParams();
  postData.append("username", studentId);
  postData.append("password", encryptedPassword);
  postData.append("captcha", "");
  postData.append("_eventId", "submit");
  postData.append("cllt", "userNameLogin");
  postData.append("dllt", "generalLogin");
  postData.append("lt", session.lt || "");
  postData.append("execution", session.execution);

  safeLog("personal-login-post-attempt", { studentId: maskStudentId(studentId) });

  let loginRes;
  try {
    loginRes = await client.post(session.loginUrl, postData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: session.loginUrl,
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      timeout: 10000,
    });
  } catch (error) {
    safeLog("personal-login-post-error", { error: error.message });
    destroySession(sessionId);
    throw new Error("AUTHSERVER_UNREACHABLE");
  }

  // 3. 判断是否返回 302 凭证 Location
  const status = loginRes.status;
  const location = loginRes.headers["location"];

  if (status !== 302 || !location) {
    // 登录失败，销毁 session 并抛出统一登录失败异常
    safeLog("personal-login-credentials-invalid", { studentId: maskStudentId(studentId) });
    destroySession(sessionId);
    throw new Error("CAS_LOGIN_FAILED");
  }

  if (!location.includes("ticket=")) {
    safeLog("personal-login-ticket-missing", { location });
    destroySession(sessionId);
    throw new Error("CAS_LOGIN_FAILED");
  }

  // 4. 手动跟踪 302 跳转获取 JWC 会话 Cookie
  let nextUrl = location;
  let redirectCount = 0;

  while (nextUrl && redirectCount < 5) {
    redirectCount++;
    safeLog("personal-login-redirect", { step: redirectCount, url: nextUrl });

    let res;
    try {
      res = await client.get(nextUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        timeout: 8000,
      });
    } catch (err) {
      safeLog("personal-login-redirect-error", { error: err.message });
      destroySession(sessionId);
      if (isDnsError(err)) {
        throw new Error("EDU100_DNS_FAILED");
      } else {
        throw new Error("EDU100_UNREACHABLE");
      }
    }

    if (res.status === 302 || res.status === 301) {
      nextUrl = res.headers["location"];
      if (nextUrl && !nextUrl.startsWith("http")) {
        const urlObj = new URL(nextUrl, "http://100.fosu.edu.cn");
        nextUrl = urlObj.toString();
      }
    } else {
      break;
    }
  }

  // 5. 校验 framework/xsMain.jsp 以验证会话建立
  let mainRes;
  try {
    mainRes = await client.get("http://100.fosu.edu.cn/framework/xsMain.jsp", {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      timeout: 8000,
    });
  } catch (err) {
    safeLog("personal-login-xsmain-network-error", { error: err.message });
    destroySession(sessionId);
    if (isDnsError(err)) {
      throw new Error("EDU100_DNS_FAILED");
    } else {
      throw new Error("EDU100_UNREACHABLE");
    }
  }

  const xsMainHtml = mainRes.data;
  if (mainRes.status !== 200 || (!xsMainHtml.includes("桌面") && !xsMainHtml.includes("教学综合信息服务平台"))) {
    safeLog("personal-login-framework-failed", { status: mainRes.status });
    destroySession(sessionId);
    throw new Error("SCHEDULE_PAGE_UNREACHABLE");
  }

  // 6. 解析学生基本信息
  const $xsMain = cheerio.load(xsMainHtml);
  let studentName = "";
  const welcomeText = $xsMain("body").text();
  const nameMatch = welcomeText.match(/欢迎您[，,]\s*([\u4e00-\u9fa5A-Za-z]+)\s*(?:同学|老师)?/) ||
                    welcomeText.match(/([\u4e00-\u9fa5A-Za-z]+)\s*同学/);
  if (nameMatch) {
    studentName = nameMatch[1];
  }

  if (!studentName) {
    const welcomeEl = $xsMain("#welcome, .welcome, .user_name");
    if (welcomeEl.length) {
      studentName = welcomeEl.text().replace(/欢迎您|同学|\s/g, "");
    }
  }

  if (!studentName) {
    studentName = "学生";
  }

  // 校验通过，返回有效的 jar 和基本信息
  return {
    studentJar: session.authCookieJar,
    student: {
      studentId,
      studentName,
    },
  };
}

/**
 * 诊断教务网及统一身份认证网的连通性
 * @returns {Promise<Object>} 连通性诊断报告
 */
async function checkFosuNetwork() {
  const config = require("../config");
  if (config.CAMPUS_AGENT_ENABLED) {
    let agentReachable = false;
    let agentStatus = 0;
    let agentMessage = "";
    try {
      if (!config.CAMPUS_AGENT_BASE_URL) {
        throw new Error("CAMPUS_AGENT_BASE_URL 未配置");
      }
      // 对配置的校园代理基地址进行 GET 测试，以验证连通性
      const res = await axios.get(config.CAMPUS_AGENT_BASE_URL, { timeout: 3000, validateStatus: () => true });
      agentStatus = res.status;
      if (res.status >= 200 && res.status < 500) {
        agentReachable = true;
      } else {
        agentMessage = `校园代理响应异常状态码: ${res.status}`;
      }
    } catch (e) {
      agentReachable = false;
      agentMessage = `无法连接校园代理: ${e.message}`;
    }

    return {
      success: true,
      agentMode: true,
      agent: {
        reachable: agentReachable,
        status: agentStatus,
        message: agentMessage,
      },
      recommendation: agentReachable
        ? "校园代理连接正常。当前处于实验版校园网代理网关环境，可正常同步。"
        : `校园代理暂时不可用。原因: ${agentMessage || "连接超时"}。请检查您的代理 Agent 状态。`,
    };
  }

  const authUrl = "https://authserver.fosu.edu.cn/authserver/login?service=http%3A%2F%2F100.fosu.edu.cn%2Fcaslogin.jsp%3FkstzType%3Dnull";
  const eduHost = "100.fosu.edu.cn";
  const authHost = "authserver.fosu.edu.cn";

  let eduDnsResolved = false;
  let eduReachable = false;
  let eduErrorCode = undefined;
  let eduMessage = undefined;

  let authserverReachable = false;
  let authPageStatus = 0;
  let containsLoginPage = false;
  let captchaSwitch = "";
  let needCaptcha = "";
  let contextPath = "";

  // 1. 诊断 100 网 DNS 及 HTTP 可达性
  try {
    await dns.lookup(eduHost);
    eduDnsResolved = true;
  } catch (error) {
    eduDnsResolved = false;
    eduErrorCode = "EDU100_DNS_FAILED";
    eduMessage = "当前同步节点无法解析 100.fosu.edu.cn";
  }

  if (eduDnsResolved) {
    try {
      const res = await axios.get(`http://${eduHost}`, { timeout: 3000, validateStatus: () => true });
      if (res.status >= 200 && res.status < 400) {
        eduReachable = true;
      } else {
        eduErrorCode = "EDU100_UNREACHABLE";
        eduMessage = `教务 100 网首页响应非正常状态码: ${res.status}`;
      }
    } catch (e) {
      eduReachable = false;
      eduErrorCode = "EDU100_UNREACHABLE";
      eduMessage = `当前同步节点无法连接教务 100 网: ${e.message}`;
    }
  }

  // 2. 诊断 authserver DNS 及 HTTP(S) 可达性，解析参数
  let authDnsResolved = false;
  try {
    await dns.lookup(authHost);
    authDnsResolved = true;
  } catch (e) {}

  if (authDnsResolved) {
    try {
      const res = await axios.get(authUrl, { timeout: 3000, validateStatus: () => true });
      authserverReachable = true;
      authPageStatus = res.status;

      if (res.status === 200 && res.data) {
        const $ = cheerio.load(res.data);
        containsLoginPage = $("form#casLoginForm, form").length > 0;

        const scriptText = $("script").map((i, el) => $(el).html()).get().join("\n");
        const matchCaptchaSwitch = scriptText.match(/captchaSwitch\s*=\s*["']([^"']*)["']/i);
        const matchNeedCaptcha = scriptText.match(/needCaptcha\s*=\s*["']([^"']*)["']/i);
        const matchContextPath = scriptText.match(/contextPath\s*=\s*["']([^"']*)["']/i);

        captchaSwitch = matchCaptchaSwitch ? matchCaptchaSwitch[1] : "";
        needCaptcha = matchNeedCaptcha ? matchNeedCaptcha[1] : "";
        contextPath = matchContextPath ? matchContextPath[1] : "";
      }
    } catch (e) {
      authserverReachable = false;
    }
  }

  // 3. 推荐结论
  let recommendation = "";
  if (authserverReachable && !eduDnsResolved) {
    recommendation = "authserver 可访问，但 100.fosu.edu.cn 在当前容器内 DNS 解析失败。请先修复 100 网解析/校园网/VPN/内网路由，再继续调试个人课表同步。";
  } else if (authserverReachable && eduDnsResolved && !eduReachable) {
    recommendation = "authserver 可访问，100 网域名可解析但无法连通。个人课表同步需要后端能连通 100 网。请检查服务器是否处于校园网/校 VPN、网络防火墙或内网代理设置。";
  } else if (!authserverReachable) {
    recommendation = "当前同步节点无法连接学校统一身份认证站点。请先检查服务器公网出站规则与网络连通性。";
  } else {
    recommendation = "网络连接与域名解析均正常。您可以正常使用个人课表同步功能。";
  }

  return {
    success: true,
    authserver: {
      reachable: authserverReachable,
      status: authPageStatus,
      containsLoginPage,
      captchaSwitch,
      needCaptcha,
      contextPath,
    },
    edu100: {
      dnsResolved: eduDnsResolved,
      reachable: eduReachable,
      errorCode: eduErrorCode,
      message: eduMessage,
    },
    captcha: {
      mode: "slider-or-image",
      detectedEndpoints: [
        "/common/openSliderCaptcha.htl",
        "/common/verifySliderCaptcha.htl",
        "/checkNeedCaptcha.htl",
        "/getCaptcha.htl",
        "/common/toSliderCaptcha.htl",
      ],
      sliderTokenRequired: false,
    },
    recommendation,
  };
}

module.exports = {
  assertCampusNetworkReachable,
  startPersonalSession,
  verifyPersonalSlider,
  loginAndGetJar,
  checkFosuNetwork,
};
