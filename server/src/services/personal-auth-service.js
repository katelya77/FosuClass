/**
 * 个人学号统一认证服务
 * NOTE: 负责初始化登录会话、滑块验证、以及手动追踪跨域 302 重定向以安全交换统一认证登录票据。
 */

const cheerio = require("cheerio");
const { createClient } = require("../utils/requestClient");
const { createSession, getSession, destroySession } = require("../utils/fosu-cookie-jar");
const { encryptFosuPassword } = require("../utils/fosu-password-encrypt");
const { safeLog, maskStudentId } = require("../utils/safeLogger");

/**
 * 初始化个人登录会话，抓取 CAS 登录页与滑块验证码
 * @param {string} [studentId] 预检学号（不写日志）
 * @returns {Promise<Object>} 会话 ID 与滑块 Base64 图片等数据
 */
async function startPersonalSession(studentId) {
  // 1. 初始化内存会话并生成 Session ID
  const session = createSession();
  const sessionId = session.sessionId;

  // 2. 创建绑定会话 CookieJar 的 Axios 客户端
  const client = createClient({ jar: session.authCookieJar });

  const serviceUrl = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
  const loginUrl = `https://authserver.fosu.edu.cn/authserver/login?service=${encodeURIComponent(serviceUrl)}`;

  session.loginUrl = loginUrl;
  session.serviceUrl = serviceUrl;

  let response;
  try {
    response = await client.get(loginUrl);
  } catch (error) {
    safeLog("personal-session-network-error", { error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  const html = response.data;

  // 3. 解析隐藏字段
  const $ = cheerio.load(html);
  const execution = $("#execution").val() || $("input[name='execution']").val() || "";
  const pwdEncryptSalt = $("#pwdEncryptSalt").val() || "";
  const lt = $("#lt").val() || $("input[name='lt']").val() || "";

  // 4. 正则解析滑块 Token lcpz7WKu
  const regexes = [
    /lcpz7WKu\s*[:=]\s*["']([^"']+)["']/i,
    /lcpz7WKu\s*=\s*["']([^"']+)["']/i,
    /["']lcpz7WKu["']\s*[:=]\s*["']([^"']+)["']/i,
    /openSliderCaptcha\.htl\?.*?lcpz7WKu=([^"&'\s]+)/i,
  ];

  let lcpz7WKu = "";
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match && match[1]) {
      lcpz7WKu = match[1];
      break;
    }
  }

  if (!execution) {
    throw new Error("LOGIN_PAGE_PARSE_FAILED: execution 字段解析失败");
  }
  if (!pwdEncryptSalt) {
    throw new Error("LOGIN_PAGE_PARSE_FAILED: pwdEncryptSalt 字段解析失败");
  }
  if (!lcpz7WKu) {
    throw new Error("SLIDER_TOKEN_NOT_FOUND");
  }

  session.execution = execution;
  session.pwdEncryptSalt = pwdEncryptSalt;
  session.lt = lt;
  session.lcpz7WKu = lcpz7WKu;

  // 5. 拉取滑块图片 JSON
  const captchaUrl = `https://authserver.fosu.edu.cn/authserver/common/openSliderCaptcha.htl?_=${Date.now()}&lcpz7WKu=${lcpz7WKu}`;
  let captchaRes;
  try {
    captchaRes = await client.get(captchaUrl);
  } catch (error) {
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  let captchaData = captchaRes.data;
  if (typeof captchaData === "string") {
    try {
      captchaData = JSON.parse(captchaData);
    } catch (e) {
      throw new Error("LOGIN_PAGE_PARSE_FAILED: 无法解析滑块验证码数据");
    }
  }

  if (!captchaData || !captchaData.bigImage || !captchaData.smallImage) {
    throw new Error("LOGIN_PAGE_PARSE_FAILED: 滑块验证码响应图为空");
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
    throw new Error("SESSION_EXPIRED: 会话已失效，请重新生成验证码");
  }

  const client = createClient({ jar: session.authCookieJar });
  const verifyUrl = `https://authserver.fosu.edu.cn/authserver/common/verifySliderCaptcha.htl?lcpz7WKu=${session.lcpz7WKu}`;

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
    });
  } catch (error) {
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  let resData = response.data;
  if (typeof resData === "string") {
    try {
      resData = JSON.parse(resData);
    } catch (e) {
      throw new Error("SLIDER_VERIFY_FAILED: 无法解析验证结果");
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
    });
  } catch (error) {
    safeLog("personal-login-post-error", { error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  // 3. 判断是否返回 302 凭证 Location
  const status = loginRes.status;
  const location = loginRes.headers["location"];

  if (status !== 302 || !location) {
    // 登录失败，销毁 session
    safeLog("personal-login-credentials-invalid", { studentId: maskStudentId(studentId) });
    destroySession(sessionId);
    throw new Error("INVALID_CREDENTIALS");
  }

  if (!location.includes("ticket=")) {
    safeLog("personal-login-ticket-missing", { location });
    destroySession(sessionId);
    throw new Error("CAS_TICKET_MISSING");
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
      });
    } catch (err) {
      safeLog("personal-login-redirect-error", { error: err.message });
      destroySession(sessionId);
      throw new Error("JWC_SESSION_FAILED");
    }

    if (res.status === 302 || res.status === 301) {
      nextUrl = res.headers["location"];
      if (nextUrl && !nextUrl.startsWith("http")) {
        const urlObj = new URL(nextUrl, "https://100.fosu.edu.cn");
        nextUrl = urlObj.toString();
      }
    } else {
      break;
    }
  }

  // 5. 校验 framework/xsMain.jsp
  let mainRes;
  try {
    mainRes = await client.get("https://100.fosu.edu.cn/framework/xsMain.jsp", {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  } catch (err) {
    destroySession(sessionId);
    throw new Error("JWC_SESSION_FAILED");
  }

  const xsMainHtml = mainRes.data;
  if (mainRes.status !== 200 || (!xsMainHtml.includes("桌面") && !xsMainHtml.includes("教学综合信息服务平台"))) {
    safeLog("personal-login-framework-failed", { status: mainRes.status });
    destroySession(sessionId);
    throw new Error("INVALID_CREDENTIALS");
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

module.exports = {
  startPersonalSession,
  verifyPersonalSlider,
  loginAndGetJar,
};
