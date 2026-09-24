const {
  CAPTCHA_CHECK_URL,
  LOGIN_URL,
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
  looksLikeTimetable,
  maskStudentId,
  parseCasLoginFields,
  parseSemesterOptions,
} = require("./fosuDirectHtml");
const {
  MAX_REDIRECTS,
  assertHttpsSchoolUrl,
  directError,
  resolveSchoolRedirect,
} = require("./fosuDirectRedirect");
const {
  createDiagnosticSink,
  redirectFromUrl,
  setCookieNames,
} = require("./fosuDirectDiagnostics");

const BLOCKED_SCHOOL_HEADERS = /^(cookie|authorization|x-fosu-session|x-fosu-static-ticket|referer)$/i;

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

function createWxTransport() {
  const manualRedirect = typeof wx !== "undefined" && typeof wx.canIUse === "function" && wx.canIUse("request.object.redirect");
  return {
    manualRedirect: Boolean(manualRedirect),
    request(spec) {
      return new Promise((resolve, reject) => {
        wx.request({
          url: spec.url,
          method: spec.method || "GET",
          data: spec.data,
          header: spec.header,
          redirect: "manual",
          responseType: spec.responseType || "text",
          timeout: spec.timeout || 15000,
          success: resolve,
          fail: (error) => {
            const timeout = /timeout/i.test(error && error.errMsg || "");
            reject(directError(timeout ? "SCHOOL_SYSTEM_TIMEOUT" : "CAMPUS_NETWORK_REQUIRED", { stage: "transport" }));
          },
        });
      });
    },
  };
}

function schoolHeaders(extra, cookie) {
  const header = {};
  Object.keys(extra || {}).forEach((key) => {
    if (!BLOCKED_SCHOOL_HEADERS.test(key)) header[key] = extra[key];
  });
  if (cookie) header.Cookie = cookie;
  return header;
}

function createFosuDirectClient(options) {
  const transport = options && options.transport || createWxTransport();
  const jar = options && options.jar || createCookieJar();
  const diagnostics = createDiagnosticSink({ debug: Boolean(options && options.debug) });
  const secrets = {
    password: "",
    ticket: "",
    execution: "",
    pwdEncryptSalt: "",
  };
  const networkEnvironment = { authReachable: false, eduReachable: false };
  let active = true;

  function clearSecrets() {
    active = false;
    secrets.password = "";
    secrets.ticket = "";
    secrets.execution = "";
    secrets.pwdEncryptSalt = "";
    jar.clear();
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

  async function schoolRequest(spec) {
    assertActive(spec.stage);
    if (!transport.manualRedirect) throw directError("DIRECT_MODE_UNSUPPORTED", { stage: spec.stage || "request" });
    const url = assertHttpsSchoolUrl(spec.url);
    let response;
    try {
      response = await transport.request({
        url,
        method: spec.method || "GET",
        data: spec.data,
        responseType: spec.responseType || "text",
        timeout: spec.timeout || 15000,
        header: schoolHeaders(spec.header, jar.cookieHeader(url)),
      });
    } catch (error) {
      if (!active) throw directError("DIRECT_SYNC_CANCELLED", { stage: spec.stage || "request" });
      if (error && error.code) throw error;
      throw directError("CAMPUS_NETWORK_REQUIRED", { stage: spec.stage || "request" });
    }
    if (!active) {
      jar.clear();
      throw directError("DIRECT_SYNC_CANCELLED", { stage: spec.stage || "request", statusCode: response && response.statusCode });
    }
    jar.absorb(url, response || {});
    const statusCode = Number(response && response.statusCode || 0);
    const location = headerValue(response, "location");
    let redirect = redirectFromUrl(url);
    if (location) {
      try {
        redirect = redirectFromUrl(new URL(location, url).toString());
      } catch (error) {
        redirect = { scheme: "", host: "", pathname: "" };
      }
    }
    note({
      stage: spec.stage || "preflight",
      httpStatus: statusCode,
      redirect,
      cookieNames: jar.cookieNames(url).concat(setCookieNames(response)),
    });
    if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
      try {
        resolveSchoolRedirect(url, location);
      } catch (error) {
        error.stage = spec.stage || error.stage;
        error.statusCode = statusCode;
        throw error;
      }
    }
    return response || {};
  }

  async function follow(spec) {
    let current = assertHttpsSchoolUrl(spec.url);
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
      if (![301, 302, 303, 307, 308].includes(statusCode)) {
        return { response, url: current, upgraded };
      }
      if (hop === MAX_REDIRECTS) throw directError("TOO_MANY_REDIRECTS", { stage: spec.stage, statusCode });
      const location = headerValue(response, "location");
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

  async function preflight() {
    try {
      await schoolRequest({ url: LOGIN_URL, method: "GET", timeout: 8000, stage: "preflight" });
      networkEnvironment.authReachable = true;
    } catch (error) {
      if (error && error.statusCode) networkEnvironment.authReachable = true;
      note({ stage: "preflight", errorCode: error && error.code, httpStatus: error && error.statusCode, networkEnvironment });
      throw error;
    }
    try {
      await schoolRequest({ url: "https://100.fosu.edu.cn/", method: "GET", timeout: 8000, stage: "preflight" });
      networkEnvironment.eduReachable = true;
    } catch (error) {
      if (error && error.statusCode) networkEnvironment.eduReachable = true;
      note({ stage: "preflight", errorCode: error && error.code, httpStatus: error && error.statusCode, networkEnvironment });
      throw error;
    }
    note({ stage: "preflight", httpStatus: 200, networkEnvironment });
    return { ok: true, networkEnvironment };
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
      if (!studentId || !secrets.password) throw directError("INVALID_CREDENTIALS", { stage: "preflight" });
      await preflight();
      const loginPage = await follow({ url: LOGIN_URL, stage: "auth-page" });
      const html = textFromData(loginPage.response && loginPage.response.data);
      fields = parseCasLoginFields(html);
      secrets.execution = fields.execution;
      secrets.pwdEncryptSalt = fields.pwdEncryptSalt;
      if (!fields.execution || !fields.pwdEncryptSalt) {
        throw directError("LOGIN_PAGE_CHANGED", { stage: "auth-page", statusCode: loginPage.response && loginPage.response.statusCode });
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
      const posted = await schoolRequest({
        url: LOGIN_URL,
        method: "POST",
        data: form,
        header: { "Content-Type": "application/x-www-form-urlencoded" },
        stage: "login-post",
      });
      encryptedPassword = "";
      form = "";
      const statusCode = Number(posted.statusCode || 0);
      const location = headerValue(posted, "location");
      if (![301, 302, 303, 307, 308].includes(statusCode) || !location) {
        const code = classifyLoginPage(textFromData(posted.data)) || "LOGIN_REJECTED";
        throw directError(code, { stage: "login-post", statusCode });
      }
      if (!hasTicket(location)) {
        const code = classifyLoginPage(textFromData(posted.data)) || "LOGIN_REJECTED";
        throw directError(code, { stage: "login-post", statusCode });
      }
      let callback;
      try {
        callback = resolveSchoolRedirect(LOGIN_URL, location);
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
      if (!isAuthenticatedHome(homeHtml, Number(home.response && home.response.statusCode || 0))) {
        throw directError(httpsUpgraded ? "CAS_HTTPS_CALLBACK_UNSUPPORTED" : "LOGIN_REJECTED", {
          stage: "xs-main",
          statusCode: home.response && home.response.statusCode,
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
      note({
        stage: error && error.stage || "preflight",
        httpStatus: error && error.statusCode,
        errorCode: error && error.code,
        redirect: {
          scheme: "",
          host: error && error.locationHost || "",
          pathname: error && error.locationPath || "",
        },
      });
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
    preflight,
    readTimetable,
  };
}

function utf8Fallback(value) {
  const text = typeof value === "string" ? value : "";
  return new TextEncoder().encode(text);
}

module.exports = {
  createFosuDirectClient,
  createWxTransport,
  schoolHeaders,
};
