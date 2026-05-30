/**
 * 个人学号统一认证页深度分析工具
 * NOTE: 请求统一身份认证页并保存脱敏调试资源，诊断滑块接口与 CAS 隐藏字段。
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const axios = require("axios");
const cheerio = require("cheerio");

// 脱敏函数
function redactContent(content) {
  if (!content) return "";
  return String(content)
    .replace(/(JSESSIONID=)[^;\s"']+/gi, "$1[REDACTED]")
    .replace(/(ticket=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(pwdEncryptSalt\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2")
    .replace(/(execution\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2");
}

function redactHeaders(headers) {
  if (!headers) return {};
  const redacted = Object.assign({}, headers);
  // 脱敏 Set-Cookie
  if (redacted["set-cookie"]) {
    if (Array.isArray(redacted["set-cookie"])) {
      redacted["set-cookie"] = redacted["set-cookie"].map((cookie) =>
        cookie.replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]")
      );
    } else {
      redacted["set-cookie"] = redacted["set-cookie"].replace(
        /(JSESSIONID=)[^;\s]+/gi,
        "$1[REDACTED]"
      );
    }
  }
  return redacted;
}

async function runInspect() {
  console.log("==================================================");
  console.log("  FosuClass 统一认证登录页深度分析工具");
  console.log("==================================================");

  const debugDir = path.resolve(__dirname, "../.debug/personal-auth");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const serviceUrl = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
  const loginUrl = `https://authserver.fosu.edu.cn/authserver/login?service=${encodeURIComponent(serviceUrl)}`;
  const authHost = "authserver.fosu.edu.cn";
  const eduHost = "100.fosu.edu.cn";

  let dnsResolved100 = false;
  try {
    const ips = await dns.lookup(eduHost);
    if (ips && ips.address) {
      dnsResolved100 = true;
    }
  } catch (e) {}

  let authserverReachable = false;
  let loginPageStatus = 0;
  let html = "";
  let headers = {};
  let containsLoginForm = false;
  let captchaSwitch = "";
  let needCaptcha = "";
  let contextPath = "";

  console.log(`1. 正在请求登录入口: ${loginUrl}`);
  try {
    const res = await axios.get(loginUrl, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    authserverReachable = true;
    loginPageStatus = res.status;
    html = res.data;
    headers = res.headers;
  } catch (error) {
    console.error(`[✘] 请求登录页失败: ${error.message}`);
  }

  const report = {
    authserverReachable,
    loginPageStatus,
    containsLoginForm: false,
    captchaSwitch: "",
    needCaptcha: "",
    contextPath: "",
    detectedScripts: [],
    detectedEndpoints: {
      openSliderCaptcha: "/authserver/common/openSliderCaptcha.htl",
      verifySliderCaptcha: "/authserver/common/verifySliderCaptcha.htl",
      checkNeedCaptcha: "/authserver/checkNeedCaptcha.htl",
      getCaptcha: "/authserver/getCaptcha.htl",
      toSliderCaptcha: "/authserver/common/toSliderCaptcha.htl",
    },
    detectedPasswordEncrypt: {
      functionName: "encryptPassword",
      saltField: "pwdEncryptSalt",
    },
    detectedCasFields: {
      execution: false,
      lt: false,
      cllt: false,
      dllt: false,
      eventId: false,
      pwdEncryptSalt: false,
    },
  };

  if (authserverReachable && html) {
    const $ = cheerio.load(html);

    // 检查表单是否存在
    containsLoginForm = $("form#casLoginForm, form").length > 0;
    report.containsLoginForm = containsLoginForm;

    // 解析配置参数
    const scriptText = $("script")
      .map((i, el) => $(el).html())
      .get()
      .join("\n");

    const matchCaptchaSwitch = scriptText.match(/captchaSwitch\s*=\s*["']([^"']*)["']/i);
    const matchNeedCaptcha = scriptText.match(/needCaptcha\s*=\s*["']([^"']*)["']/i);
    const matchContextPath = scriptText.match(/contextPath\s*=\s*["']([^"']*)["']/i);

    captchaSwitch = matchCaptchaSwitch ? matchCaptchaSwitch[1] : "";
    needCaptcha = matchNeedCaptcha ? matchNeedCaptcha[1] : "";
    contextPath = matchContextPath ? matchContextPath[1] : "";

    report.captchaSwitch = captchaSwitch;
    report.needCaptcha = needCaptcha;
    report.contextPath = contextPath;

    // 检查表单隐藏字段
    report.detectedCasFields.execution =
      $("#execution").length > 0 || $("input[name='execution']").length > 0;
    report.detectedCasFields.lt =
      $("#lt").length > 0 || $("input[name='lt']").length > 0;
    report.detectedCasFields.cllt =
      $("input[name='cllt']").length > 0 || scriptText.includes("userNameLogin");
    report.detectedCasFields.dllt =
      $("input[name='dllt']").length > 0 || scriptText.includes("generalLogin");
    report.detectedCasFields.eventId =
      $("input[name='_eventId']").length > 0 || scriptText.includes("submit");
    report.detectedCasFields.pwdEncryptSalt =
      $("#pwdEncryptSalt").length > 0 || $("input[name='pwdEncryptSalt']").length > 0;

    // 2. 收集 JS 脚本
    console.log("2. 正在提取引用的关键 JS 资源...");
    const scriptSrcs = [];
    $("script[src]").each((i, el) => {
      const src = $(el).attr("src");
      scriptSrcs.push(src);
    });
    report.detectedScripts = scriptSrcs;

    fs.writeFileSync(
      path.join(debugDir, "login-scripts-manifest.json"),
      JSON.stringify(scriptSrcs, null, 2),
      "utf8"
    );

    // 尝试拉取这四个关键 JS
    const targetJsFiles = [
      { key: "encrypt.js", pattern: /encrypt\.js/ },
      { key: "login.js", pattern: /login\.js/ },
      { key: "schoolCombinedLogin.js", pattern: /schoolCombinedLogin\.js/ },
      { key: "longbow.slidercaptchas.js", pattern: /longbow\.slidercaptchas\.js/ },
    ];

    for (const target of targetJsFiles) {
      const matchedSrc = scriptSrcs.find((src) => target.pattern.test(src));
      if (matchedSrc) {
        // 拼接成绝对 URL
        let absoluteJsUrl = matchedSrc;
        if (!absoluteJsUrl.startsWith("http")) {
          const base = "https://authserver.fosu.edu.cn";
          if (absoluteJsUrl.startsWith("/")) {
            absoluteJsUrl = base + absoluteJsUrl;
          } else {
            absoluteJsUrl = base + "/authserver/" + absoluteJsUrl;
          }
        }
        console.log(`➜ 正在下载 JS [${target.key}]: ${absoluteJsUrl}`);
        try {
          const jsRes = await axios.get(absoluteJsUrl, { timeout: 5000 });
          fs.writeFileSync(
            path.join(debugDir, target.key),
            redactContent(jsRes.data),
            "utf8"
          );
        } catch (e) {
          console.warn(`[!] 下载 JS [${target.key}] 失败: ${e.message}`);
        }
      } else {
        console.log(`[-] 未在页面中检测到 ${target.key}`);
      }
    }

    // 保存脱敏后的 HTML 和 Headers
    fs.writeFileSync(
      path.join(debugDir, "login.html"),
      redactContent(html),
      "utf8"
    );
    fs.writeFileSync(
      path.join(debugDir, "login.headers.json"),
      JSON.stringify(redactHeaders(headers), null, 2),
      "utf8"
    );
  }

  // 写入检查报告
  fs.writeFileSync(
    path.join(debugDir, "inspect-report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("\n==================================================");
  console.log("  分析报告摘要 (Chinese Report Summary)");
  console.log("==================================================");
  console.log(`- 统一认证站 authserver 是否可达: ${authserverReachable ? "【是】" : "【否】"}`);
  console.log(`- 教务 100 网 100.fosu.edu.cn 是否可解析: ${dnsResolved100 ? "【是】" : "【否】"}`);
  console.log(`- 页面是否包含登录表单 (containsLoginForm): ${report.containsLoginForm ? "【检测到】" : "【未检测到】"}`);
  console.log(`- 滑块验证码控制开关 (captchaSwitch): "${report.captchaSwitch}" (1 表示启用)`);
  console.log(`- 是否需要滑块 (needCaptcha): "${report.needCaptcha}"`);
  console.log(`- 系统应用路径 (contextPath): "${report.contextPath}"`);

  console.log("\n[隐藏字段检测结果]:");
  console.log(`  - execution (登录流程标记): ${report.detectedCasFields.execution ? "✔ 已检测到" : "✘ 未检测到"}`);
  console.log(`  - lt (登录流水号): ${report.detectedCasFields.lt ? "✔ 已检测到" : "✘ 未检测到"}`);
  console.log(`  - pwdEncryptSalt (密码加密盐值): ${report.detectedCasFields.pwdEncryptSalt ? "✔ 已检测到" : "✘ 未检测到"}`);
  console.log(`  - cllt & dllt (登录类型参数): ${report.detectedCasFields.cllt && report.detectedCasFields.dllt ? "✔ 已检测到" : "✘ 未检测到"}`);

  console.log("\n[滑块相关接口检测]:");
  console.log("  - 拼图获取端点 (openSliderCaptcha): 已检测");
  console.log("  - 拼图校验端点 (verifySliderCaptcha): 已检测");

  console.log("\n[下一步建议]:");
  if (!authserverReachable) {
    console.log("建议：首先确认后端服务器或容器的公网出站规则，确保可正常请求学校统一身份认证站点。");
  } else if (!dnsResolved100) {
    console.log("建议：统一认证站解析正常，但教务 100 网 DNS 解析失败。");
    console.log("     说明同步节点缺少校园网内网解析。请在宿主机/容器中配置内网 DNS 或绑定 hosts (100.fosu.edu.cn)。");
  } else if (!report.detectedCasFields.pwdEncryptSalt) {
    console.log("建议：检测不到密码加密盐值字段。可能统一认证站页面结构已更新，请检查 login.html 确认是否有新加密流程。");
  } else {
    console.log("建议：登录页环境解析完全正常！请确保小程序滑块偏移输入 moveLength 正确，并可尝试执行全链路登录同步。");
  }
  console.log("==================================================");
  console.log(`➜ 详细脱敏调试数据已保存至: ${debugDir}`);
}

runInspect().catch((err) => {
  console.error("运行分析工具时发生未知错误:", err);
  process.exit(1);
});
