const {
  CAPTCHA_CHECK_URL,
  CAS_BOOTSTRAP_URL,
  TIMETABLE_URL,
  XS_MAIN_URL,
} = require("./fosuDirectConfig");
const { createCookieJar } = require("./fosuDirectCookieJar");
const { encryptFosuPassword } = require("./fosuDirectPasswordCrypto");
const {
  captchaRequiredFromCheck,
  classifyLoginPage,
  hasTicket,
  isAuthenticatedHome,
  looksLikeLoginPage,
  looksLikeTimetable,
  maskStudentId,
  parseCasLoginFields,
  parseSemesterOptions,
} = require("./fosuDirectHtml");
const {
  MAX_REDIRECTS,
  assertHttpsSchoolUrl,
  directError,
  inspectSchoolResponse,
  isRedirectStatus,
  resolveSchoolRedirect,
} = require("./fosuDirectRedirect");
const {
  createDiagnosticSink,
  redirectFromUrl,
  setCookieNames,
} = require("./fosuDirectDiagnostics");
const { resolveRelativeUrl } = require("./fosuDirectUrl");

const BLOCKED_SCHOOL_HEADERS = /^(cookie|authorization|x-fosu-session|x-fosu-static-ticket|referer|user-agent)$/i;
const SCHOOL_MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";

function headerValue(response, name) {
  const headers = response && (response.header || response.headers) || {};
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : "";
}

function latin1FromBytes(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data instanceof ArrayBuffer ? data : []);
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function textFromData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) return latin1FromBytes(data);
  return data == null ? "" : String(data);
}

function bytesToBase64(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data instanceof ArrayBuffer ? data : []);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return output;
}

function classifyWxRequestFail(error) {
  const raw = String(error && (error.errMsg || error.message) || "");
  const text = raw.toLowerCase();
  let wxErrorCategory = "unknown";
  if (/timeout/.test(text)) wxErrorCategory = "timeout";
  else if (/dns|not resolved|getaddrinfo/.test(text)) wxErrorCategory = "dns";
  else if (/ssl|tls|certificate|handshake/.test(text)) wxErrorCategory = "tls";
  else if (/domain list|not in domain|合法域名/.test(text)) wxErrorCategory = "domain-policy";
  else if (/abort/.test(text)) wxErrorCategory = "abort";
  else if (/connection|connect|refused|reset|socket|network/.test(text)) wxErrorCategory = "connection";
  return {
    wxErrno: Number(error && (error.errno || error.errCode) || 0) || 0,
    wxErrorCategory,
    wxErrMsgSafe: raw.replace(/https?:\/\/\S+/gi, "[url]").replace(/[?#]\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 180),
  };
}

function targetFromUrl(value) {
  const parsed = redirectFromUrl(value);
  return {
    targetHost: parsed.host || "",
    pathname: parsed.pathname || "",
  };
}

function createWxTransport() {
  const manualRedirect = typeof wx !== "undefined" && typeof wx.canIUse === "function" && wx.canIUse("request.object.redirect");
  return {
    manualRedirect: Boolean(manualRedirect),
    followRedirect: true,
    request(spec) {
      return new Promise((resolve, reject) => {
        const payload = {
          url: spec.url,
          method: spec.method || "GET",
          timeout: spec.timeout || 15000,
          success: (response) => {
            if (response && typeof response === "object") response.transportPhase = "wx-request-success";
            resolve(response);
          },
          fail: (error) => {
            const safe = classifyWxRequestFail(error);
            reject(directError("DIRECT_NETWORK_ERROR", Object.assign({
              stage: spec.stage || "transport",
              transportPhase: "wx-request-fail",
              targetHost: targetFromUrl(spec.url).targetHost,
            }, safe)));
          },
        };
        if (spec.data !== undefined) payload.data = spec.data;
        if (spec.header) payload.header = spec.header;
        if (spec.responseType) payload.responseType = spec.responseType;
        if (spec.redirect) payload.redirect = spec.redirect;
        wx.request(payload);
      });
    },
  };
}

function buildSchoolRequestHeaders(extra, cookie) {
  const header = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  Object.keys(extra || {}).forEach((key) => {
    if (!BLOCKED_SCHOOL_HEADERS.test(key)) header[key] = extra[key];
  });
  delete header.Referer;
  delete header.Authorization;
  delete header["User-Agent"];
  delete header.Host;
  delete header.Connection;
  delete header["Content-Length"];
  delete header.Origin;
  if (cookie) header.Cookie = cookie;
  return header;
}

function createFosuDirectClient(options) {
  const transport = options && options.transport || createWxTransport();
  const jar = options && options.jar || createCookieJar();
  const debug = Boolean(options && options.debug);
  const diagnostics = createDiagnosticSink({ debug });
  const secrets = {
    password: "",
    ticket: "",
    execution: "",
    pwdEncryptSalt: "",
  };
  const networkEnvironment = { authReachable: false, eduReachable: false, preflightReachable: false };
  let active = true;

  function clearSecrets() {
    active = false;
    secrets.password = "";
    secrets.ticket = "";
    secrets.execution = "";
    secrets.pwdEncryptSalt = "";
    jar.clear();
  }

  function noteBlockedRedirect(error) {
    if (!debug || !error || (error.code !== "UNTRUSTED_REDIRECT" && error.code !== "HTTP_REQUEST_FORBIDDEN")) return;
    const redirect = error.safeRedirect || {};
    if (typeof console !== "undefined" && console.info) {
      console.info("[FosuDirect][redirect-blocked]", {
        stage: error.stage || "",
        status: error.statusCode || 0,
        scheme: redirect.scheme || "",
        host: redirect.host || "",
        pathname: String(redirect.pathname || "").split("?")[0],
      });
    }
  }

  function note(spec) {
    return diagnostics.record(Object.assign({
      networkEnvironment,
    }, spec));
  }

  function assertActive(stage) {
    if (active) return;
    throw directError("DIRECT_SYNC_CANCELLED", { stage: stage || "preflight" });
  }

  function noteFailure(error, stage, targetHost) {
    note({
      stage: (error && error.stage) || stage || "",
      httpStatus: error && error.statusCode,
      errorCode: error && error.code,
      transportPhase: error && error.transportPhase,
      targetHost: (error && error.targetHost) || targetHost || "",
      redirectHost: error && error.safeRedirect && error.safeRedirect.host,
      redirect: error && error.safeRedirect,
      wxErrno: error && error.wxErrno,
      wxErrorCategory: error && error.wxErrorCategory,
      wxErrMsgSafe: error && error.wxErrMsgSafe,
      exceptionName: error && error.exceptionName,
      exceptionMessageSafe: error && error.exceptionMessageSafe,
      stackTop: error && error.stackTop,
      networkEnvironment,
    });
  }

  function stampBeforeRequest(error, stage, targetHost) {
    if (!error || !error.code) {
      const wrapped = directError("DIRECT_CLIENT_INTERNAL_ERROR", {
        stage,
        transportPhase: "before-request",
        targetHost,
      });
      wrapped.exceptionName = error && error.name || "Error";
      wrapped.exceptionMessageSafe = String(error && error.message || "")
        .replace(/https?:\/\/\S+/gi, "[url]")
        .replace(/(password|cookie|ticket|execution|pwdencryptsalt)=[^\s&]*/gi, "$1=[redacted]")
        .slice(0, 180);
      wrapped.stackTop = String(error && error.stack || "").split("\n").slice(0, 2).join(" | ").replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
      return wrapped;
    }
    if (error.code === "DIRECT_SYNC_CANCELLED" || error.code === "DIRECT_MODE_UNSUPPORTED") {
      error.transportPhase = error.transportPhase || "before-request";
      error.targetHost = error.targetHost || targetHost;
      return error;
    }
    if (error.code === "DIRECT_NETWORK_ERROR") return error;
    error.transportPhase = "before-request";
    error.targetHost = error.targetHost || targetHost;
    return error;
  }

  async function schoolRequest(spec) {
    const stage = spec.stage || "request";
    const target = targetFromUrl(spec.url);
    let url = "";
    let header = null;
    try {
      assertActive(stage);
      if (!transport.manualRedirect) {
        throw directError("DIRECT_MODE_UNSUPPORTED", {
          stage,
          transportPhase: "before-request",
          targetHost: target.targetHost,
        });
      }
      url = assertHttpsSchoolUrl(spec.url);
      header = buildSchoolRequestHeaders(spec.header, jar.cookieHeader(url));
    } catch (error) {
      if (!active) {
        const cancelled = directError("DIRECT_SYNC_CANCELLED", {
          stage,
          transportPhase: "before-request",
          targetHost: target.targetHost,
        });
        noteFailure(cancelled, stage, target.targetHost);
        throw cancelled;
      }
      const surfaced = stampBeforeRequest(error, stage, target.targetHost);
      noteFailure(surfaced, stage, target.targetHost);
      throw surfaced;
    }
    let response;
    try {
      response = await transport.request({
        url,
        method: spec.method || "GET",
        data: spec.data,
        responseType: spec.responseType || "text",
        timeout: spec.timeout || 15000,
        header,
        redirect: spec.redirect || "manual",
        stage,
      });
    } catch (error) {
      if (!active) {
        const cancelled = directError("DIRECT_SYNC_CANCELLED", {
          stage,
          transportPhase: "before-request",
          targetHost: target.targetHost,
        });
        noteFailure(cancelled, stage, target.targetHost);
        throw cancelled;
      }
      const surfaced = error && error.code === "DIRECT_NETWORK_ERROR"
        ? error
        : directError("DIRECT_CLIENT_INTERNAL_ERROR", {
          stage,
          transportPhase: "before-request",
          targetHost: target.targetHost,
        });
      surfaced.stage = surfaced.stage || stage;
      surfaced.targetHost = surfaced.targetHost || target.targetHost;
      noteFailure(surfaced, stage, target.targetHost);
      throw surfaced;
    }
    if (!active) {
      jar.clear();
      const cancelled = directError("DIRECT_SYNC_CANCELLED", {
        stage,
        transportPhase: "after-response",
        targetHost: target.targetHost,
        statusCode: response && response.statusCode,
      });
      noteFailure(cancelled, stage, target.targetHost);
      throw cancelled;
    }
    jar.absorb(url, response || {});
    const statusCode = Number(response && response.statusCode || 0);
    const location = headerValue(response, "location");
    let redirect = { scheme: "", host: "", pathname: "" };
    if (isRedirectStatus(statusCode) && String(location || "").trim()) {
      try {
        redirect = redirectFromUrl(resolveRelativeUrl(url, location));
      } catch (error) {
        redirect = redirectFromUrl(location);
      }
    }
    note({
      stage,
      httpStatus: statusCode,
      redirect,
      redirectHost: redirect.host || "",
      targetHost: target.targetHost,
      transportPhase: "wx-request-success",
      cookieNames: jar.cookieNames(url).concat(setCookieNames(response)),
    });
    if (isRedirectStatus(statusCode)) {
      try {
        inspectSchoolResponse(url, statusCode, location);
      } catch (error) {
        error.stage = stage;
        error.statusCode = statusCode;
        error.transportPhase = "after-response";
        error.targetHost = target.targetHost;
        noteBlockedRedirect(error);
        noteFailure(error, stage, target.targetHost);
        throw error;
      }
    }
    return response || {};
  }

  async function follow(spec) {
    let current = spec.url;
    let method = spec.method || "GET";
    let body = spec.data;
    let upgraded = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await schoolRequest({
        url: current,
        method,
        data: body,
        header: spec.header,
        responseType: spec.responseType || "text",
        timeout: spec.timeout,
        stage: spec.stage,
      });
      const statusCode = Number(response.statusCode || 0);
      if (!isRedirectStatus(statusCode)) {
        return { response, url: current, upgraded };
      }
      if (hop === MAX_REDIRECTS) throw directError("TOO_MANY_REDIRECTS", { stage: spec.stage, statusCode });
      const location = headerValue(response, "location");
      if (!String(location || "").trim()) {
        throw directError("REDIRECT_LOCATION_MISSING", { stage: spec.stage, statusCode });
      }
      let resolved;
      try {
        resolved = resolveSchoolRedirect(current, location);
      } catch (error) {
        error.stage = spec.stage || error.stage;
        error.statusCode = statusCode;
        throw error;
      }
      if (resolved.upgraded) upgraded = true;
      current = resolved.url;
      method = "GET";
      body = undefined;
    }
    throw directError("TOO_MANY_REDIRECTS", { stage: spec.stage });
  }

  async function bootstrapCasLogin() {
    if (transport.followRedirect) return bootstrapCasLoginByFollow();
    const response = await schoolRequest({
      url: CAS_BOOTSTRAP_URL,
      method: "GET",
      timeout: 8000,
      stage: "cas-bootstrap",
    });
    const statusCode = Number(response.statusCode || 0);
    const location = headerValue(response, "location");
    if (!isRedirectStatus(statusCode) || !String(location || "").trim()) {
      throw directError(isRedirectStatus(statusCode) ? "REDIRECT_LOCATION_MISSING" : "AUTH_PAGE_HTTP_ERROR", {
        stage: "cas-bootstrap",
        statusCode,
        transportPhase: "after-response",
        targetHost: "100.fosu.edu.cn",
      });
    }
    const resolved = resolveSchoolRedirect(CAS_BOOTSTRAP_URL, location);
    if (resolved.host !== "authserver.fosu.edu.cn" || String(resolved.path || "").indexOf("/authserver/login") !== 0) {
      throw directError("UNTRUSTED_REDIRECT", {
        stage: "cas-bootstrap",
        statusCode,
        scheme: "https",
        locationHost: resolved.host,
        locationPath: resolved.path,
        transportPhase: "after-response",
        targetHost: "100.fosu.edu.cn",
      });
    }
    networkEnvironment.authReachable = true;
    networkEnvironment.eduReachable = true;
    if (typeof options.onNetworkState === "function") options.onNetworkState("connected");
    return { authLoginUrl: resolved.url };
  }

  async function bootstrapCasLoginByFollow() {
    const response = await schoolRequest({
      url: CAS_BOOTSTRAP_URL,
      method: "GET",
      timeout: 10000,
      stage: "cas-bootstrap",
      redirect: "follow",
    });
    const statusCode = Number(response.statusCode || 0);
    const html = textFromData(response.data);
    const polluted = /_wx_redirect/.test(html);
    if (polluted || statusCode === 404) {
      throw directError("WECHAT_REDIRECT_INCOMPATIBLE", {
        stage: "cas-bootstrap",
        statusCode,
        transportPhase: "after-response",
        targetHost: "100.fosu.edu.cn",
      });
    }
    const pageUrl = "https://authserver.fosu.edu.cn/authserver/login";
    jar.absorb(pageUrl, response || {});
    const fields = parseCasLoginFields(html, pageUrl);
    if (statusCode !== 200 || !fields.execution || !fields.pwdEncryptSalt || /_wx_redirect/.test(fields.postUrl || "")) {
      throw directError(statusCode === 200 ? "AUTH_PAGE_CHANGED" : "AUTH_PAGE_HTTP_ERROR", {
        stage: "cas-bootstrap",
        statusCode,
        transportPhase: "after-response",
        targetHost: "authserver.fosu.edu.cn",
      });
    }
    networkEnvironment.authReachable = true;
    networkEnvironment.eduReachable = true;
    if (typeof options.onNetworkState === "function") options.onNetworkState("connected");
    return { authLoginUrl: pageUrl, followed: true, fields, html, response };
  }

  async function checkSchoolLink() {
    try {
      await bootstrapCasLogin();
      return { state: "connected" };
    } catch (error) {
      if (error && error.code === "DIRECT_NETWORK_ERROR") {
        if (typeof options.onNetworkState === "function") options.onNetworkState("unavailable");
        return { state: "unavailable", errorCode: error.code, transportPhase: error.transportPhase };
      }
      return { state: "unknown", errorCode: error && error.code, transportPhase: error && error.transportPhase };
    }
  }

  async function readTimetable(input) {
    const studentId = String(input && input.studentId || "").trim();
    secrets.password = String(input && input.password || "");
    const semester = String(input && input.semester || "").trim();
    let httpsUpgraded = false;
    let fields = null;
    let encryptedPassword = "";
    let form = "";
    try {
      if (!studentId || !secrets.password) throw directError("INVALID_CREDENTIALS", { stage: "auth-page", transportPhase: "before-request" });
      if (typeof options.onProgress === "function") options.onProgress("cas-bootstrap");
      const boot = await bootstrapCasLogin();
      if (typeof options.onProgress === "function") options.onProgress("auth-page");
      const loginPage = boot.followed
        ? { response: boot.response, url: boot.authLoginUrl, upgraded: false }
        : await follow({ url: boot.authLoginUrl, stage: "auth-page" });
      const loginStatus = Number(loginPage.response && loginPage.response.statusCode || 0);
      if (loginStatus !== 200) {
        throw directError("AUTH_PAGE_HTTP_ERROR", {
          stage: "auth-page",
          statusCode: loginStatus,
          transportPhase: "after-response",
          targetHost: "authserver.fosu.edu.cn",
        });
      }
      if (typeof options.onNetworkState === "function") options.onNetworkState("connected");
      const html = textFromData(loginPage.response && loginPage.response.data);
      fields = parseCasLoginFields(html, loginPage.url);
      secrets.execution = fields.execution;
      secrets.pwdEncryptSalt = fields.pwdEncryptSalt;
      if (!fields.execution || !fields.pwdEncryptSalt) {
        throw directError("AUTH_PAGE_CHANGED", { stage: "auth-page", statusCode: loginStatus, transportPhase: "after-response", targetHost: "authserver.fosu.edu.cn" });
      }
      const captcha = await schoolRequest({
        url: CAPTCHA_CHECK_URL,
        method: "POST",
        data: `username=${encodeURIComponent(studentId)}`,
        header: { "Content-Type": "application/x-www-form-urlencoded" },
        stage: "captcha-check",
      });
      if (captchaRequiredFromCheck(textFromData(captcha.data) || captcha.data)) {
        throw directError("INTERACTIVE_CHALLENGE_REQUIRED", { stage: "captcha-check", statusCode: captcha.statusCode });
      }
      encryptedPassword = await encryptFosuPassword(secrets.password, fields.pwdEncryptSalt);
      secrets.password = "";
      form = [
        `username=${encodeURIComponent(studentId)}`,
        `password=${encodeURIComponent(encryptedPassword)}`,
        "captcha=",
        `_eventId=${encodeURIComponent(fields._eventId || "submit")}`,
        `cllt=${encodeURIComponent(fields.cllt || "userNameLogin")}`,
        `dllt=${encodeURIComponent(fields.dllt || "generalLogin")}`,
        `lt=${encodeURIComponent(fields.lt || "")}`,
        `execution=${encodeURIComponent(fields.execution)}`,
      ].join("&");
      const postUrl = fields.postUrl || loginPage.url;
      if (/_wx_redirect/.test(postUrl)) {
        throw directError("WECHAT_REDIRECT_INCOMPATIBLE", {
          stage: "login-post",
          transportPhase: "before-request",
          targetHost: "authserver.fosu.edu.cn",
        });
      }
      const posted = await schoolRequest({
        url: postUrl,
        method: "POST",
        data: form,
        header: { "Content-Type": "application/x-www-form-urlencoded" },
        stage: "login-post",
      });
      encryptedPassword = "";
      form = "";
      const statusCode = Number(posted.statusCode || 0);
      const location = headerValue(posted, "location");
      if (isRedirectStatus(statusCode) && !String(location || "").trim()) {
        throw directError("REDIRECT_LOCATION_MISSING", { stage: "login-post", statusCode });
      }
      if (!isRedirectStatus(statusCode) || !location) {
        const code = classifyLoginPage(textFromData(posted.data)) || "LOGIN_REJECTED";
        throw directError(code, { stage: "login-post", statusCode });
      }
      if (!hasTicket(location)) {
        const code = classifyLoginPage(textFromData(posted.data)) || "LOGIN_REJECTED";
        throw directError(code, { stage: "login-post", statusCode });
      }
      let callback;
      try {
        callback = resolveSchoolRedirect(fields.postUrl || loginPage.url, location);
      } catch (error) {
        error.stage = "cas-redirect";
        error.statusCode = statusCode;
        throw error;
      }
      if (callback.upgraded) httpsUpgraded = true;
      secrets.ticket = "";
      note({
        stage: "cas-redirect",
        httpStatus: statusCode,
        redirect: redirectFromUrl(callback.url),
        cookieNames: jar.cookieNames(callback.url),
      });
      const callbackResult = await follow({ url: callback.url, stage: "cas-callback" });
      if (callbackResult.upgraded) httpsUpgraded = true;
      const home = await follow({ url: XS_MAIN_URL, stage: "xs-main" });
      const homeHtml = textFromData(home.response && home.response.data);
      const homeStatus = Number(home.response && home.response.statusCode || 0);
      if (looksLikeLoginPage(homeHtml) || !isAuthenticatedHome(homeHtml, homeStatus)) {
        throw directError(looksLikeLoginPage(homeHtml) || !httpsUpgraded ? "CAS_SESSION_NOT_ESTABLISHED" : "CAS_HTTPS_CALLBACK_UNSUPPORTED", {
          stage: "xs-main",
          statusCode: homeStatus,
        });
      }
      let timetable = await schoolRequest({
        url: TIMETABLE_URL,
        method: "GET",
        responseType: "arraybuffer",
        stage: "timetable-fetch",
      });
      let timetableUrl = TIMETABLE_URL;
      if ([301, 302, 303, 307, 308].includes(Number(timetable.statusCode || 0))) {
        const next = resolveSchoolRedirect(TIMETABLE_URL, headerValue(timetable, "location"));
        if (next.upgraded) httpsUpgraded = true;
        timetableUrl = next.url;
        timetable = await schoolRequest({
          url: timetableUrl,
          method: "GET",
          responseType: "arraybuffer",
          stage: "timetable-fetch",
        });
      }
      const decodedForSemester = textFromData(timetable.data);
      if (semester && decodedForSemester && looksLikeTimetable(decodedForSemester)) {
        const parsed = parseSemesterOptions(decodedForSemester);
        const matched = parsed.options.find((item) => item.code === semester || item.code.indexOf(semester) === 0);
        if (matched && parsed.current !== matched.code) {
          timetable = await schoolRequest({
            url: TIMETABLE_URL,
            method: "POST",
            data: `xnxq01id=${encodeURIComponent(matched.code)}`,
            header: { "Content-Type": "application/x-www-form-urlencoded" },
            responseType: "arraybuffer",
            stage: "semester-switch",
          });
        } else if (!matched && parsed.options.length) {
          throw directError("SEMESTER_NOT_FOUND", { stage: "semester-switch" });
        }
      }
      const finalText = textFromData(timetable.data);
      if (!looksLikeTimetable(finalText)) {
        throw directError(httpsUpgraded ? "CAS_HTTPS_CALLBACK_UNSUPPORTED" : "SCHEDULE_PAGE_UNREACHABLE", {
          stage: "timetable-fetch",
          statusCode: timetable.statusCode,
        });
      }
      const body = timetable.data;
      const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : (body instanceof Uint8Array ? body : utf8Fallback(body));
      return {
        source: "client-direct-fosu100",
        timetableBodyBase64: bytesToBase64(bytes),
        contentType: headerValue(timetable, "content-type") || "text/html",
        semester,
        profileHint: {
          studentIdMasked: maskStudentId(studentId),
        },
      };
    } catch (error) {
      noteFailure(error, error && error.stage, error && error.targetHost);
      throw error;
    } finally {
      encryptedPassword = "";
      form = "";
      if (fields) {
        fields.execution = "";
        fields.pwdEncryptSalt = "";
        fields.lt = "";
        fields = null;
      }
      clearSecrets();
    }
  }

  return {
    clearSecrets,
    getSafeDiagnostics() {
      return diagnostics.list();
    },
    bootstrapCasLogin,
    checkSchoolLink,
    readTimetable,
    runSchoolNetworkSmokeTest: () => runSchoolNetworkSmokeTest({
      debug,
      request: options && options.smokeRequest,
    }),
  };
}

function utf8Fallback(value) {
  const text = typeof value === "string" ? value : "";
  return new TextEncoder().encode(text);
}

const schoolHeaders = buildSchoolRequestHeaders;

function logSmoke(debug, name, result) {
  if (!debug || typeof console === "undefined" || !console.info) return;
  console.info(`[FosuDirect][smoke][${name}]`, {
    targetHost: "authserver.fosu.edu.cn",
    transportPhase: result.transportPhase || "",
    httpStatus: result.httpStatus || 0,
    elapsedMs: result.elapsedMs || 0,
    wxErrno: result.wxErrno || 0,
    wxErrMsgSafe: result.wxErrMsgSafe || "",
  });
}

function wxSmokeRequest(spec) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (typeof wx === "undefined" || typeof wx.request !== "function") {
      resolve({
        ok: false,
        transportPhase: "before-request",
        httpStatus: 0,
        elapsedMs: 0,
        wxErrno: 0,
        wxErrMsgSafe: "wx.request unavailable",
      });
      return;
    }
    const payload = {
      url: spec.url,
      method: "GET",
      timeout: 8000,
      success(response) {
        resolve({
          ok: true,
          transportPhase: "wx-request-success",
          httpStatus: Number(response && response.statusCode || 0) || 0,
          elapsedMs: Date.now() - started,
          wxErrno: 0,
          wxErrMsgSafe: "",
        });
      },
      fail(error) {
        const safe = classifyWxRequestFail(error);
        resolve({
          ok: false,
          transportPhase: "wx-request-fail",
          httpStatus: 0,
          elapsedMs: Date.now() - started,
          wxErrno: safe.wxErrno,
          wxErrMsgSafe: safe.wxErrMsgSafe,
        });
      },
    };
    if (spec.header) payload.header = spec.header;
    if (spec.redirect) payload.redirect = spec.redirect;
    try {
      wx.request(payload);
    } catch (error) {
      resolve({
        ok: false,
        transportPhase: "before-request",
        httpStatus: 0,
        elapsedMs: Date.now() - started,
        wxErrno: 0,
        wxErrMsgSafe: "before-request",
      });
    }
  });
}

async function runSchoolNetworkSmokeTest(options) {
  const debug = !options || options.debug !== false;
  const request = options && options.request || wxSmokeRequest;
  const cases = [
    { name: "minimal" },
    { name: "manual", redirect: "manual" },
    { name: "headers", redirect: "manual", header: buildSchoolRequestHeaders() },
    { name: "ua", header: { "User-Agent": SCHOOL_MOBILE_USER_AGENT } },
  ];
  const results = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    let result;
    try {
      result = await request({
        url: "https://authserver.fosu.edu.cn/authserver/login",
        redirect: item.redirect,
        header: item.header,
      });
    } catch (error) {
      result = {
        ok: false,
        transportPhase: "before-request",
        httpStatus: 0,
        elapsedMs: 0,
        wxErrno: 0,
        wxErrMsgSafe: "before-request",
      };
    }
    const safe = {
      name: item.name,
      ok: Boolean(result && result.ok),
      transportPhase: result && result.transportPhase || "",
      httpStatus: Number(result && result.httpStatus || 0) || 0,
      elapsedMs: Number(result && result.elapsedMs || 0) || 0,
      wxErrno: Number(result && result.wxErrno || 0) || 0,
      wxErrMsgSafe: String(result && result.wxErrMsgSafe || "").slice(0, 180),
    };
    logSmoke(debug, item.name, safe);
    results.push(safe);
  }
  return results;
}

module.exports = {
  SCHOOL_MOBILE_USER_AGENT,
  buildSchoolRequestHeaders,
  createFosuDirectClient,
  createWxTransport,
  runSchoolNetworkSmokeTest,
  schoolHeaders,
};
