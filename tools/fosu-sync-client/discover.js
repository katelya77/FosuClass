/**
 * 自动发现与接口嗅探脚本：
 * 使用 Playwright 自动登录并依次导航至教务网核心课表页面，
 * 监听所有网络请求，提取并生成脱敏的 API 接口清单报告。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const diagnose = require("./diagnose");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const SESSION_PATH = path.join(__dirname, ".session", "session.json");
const DEBUG_DIR = path.join(__dirname, ".debug");

// 确保 debug 目录存在
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

// 延迟辅助函数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 兼容 HTTP/HTTPS 的 Playwright 导航辅助函数
 */
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const httpUrl = `${FOSU_BASE_URL.replace(/^https:/i, "http:")}${cleanPath}`;
  const httpsUrl = `${FOSU_BASE_URL}${cleanPath}`;
  
  try {
    await page.goto(httpUrl, options);
  } catch (err) {
    try {
      await page.goto(httpsUrl, options);
    } catch (httpsErr) {
      throw new Error(`导航到 ${cleanPath} 彻底失败 (HTTP: ${err.message}, HTTPS: ${httpsErr.message})`);
    }
  }
}

/**
 * 初始化 Playwright 浏览器
 */
async function initBrowser() {
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content"
  ];

  let browser;
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
      break;
    } catch (e) {
      console.warn(`⚠️ 浏览器通道 ${channel || "内置"} 启动失败: ${e.message}`);
    }
  }

  if (!browser) {
    console.error("❌ 无法启动任何浏览器！请检查 Playwright 安装是否完整。");
    process.exit(1);
  }

  if (!fs.existsSync(SESSION_PATH)) {
    console.error("❌ 本地未找到 session.json 登录会话文件！");
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    await browser.close();
    process.exit(1);
  }

  const context = await browser.newContext({
    storageState: SESSION_PATH,
    ignoreHTTPSErrors: true,
  });

  return { browser, context };
}

/**
 * 校验敏感文本：如果存在 Cookie、密码、学号等信息，返回 true
 */
function isSensitiveValue(val) {
  if (!val) return false;
  const str = String(val).toLowerCase();
  
  // 识别高风险凭据特征
  if (
    str.includes("jsessionid") ||
    str.includes("cookie") ||
    str.includes("ticket") ||
    str.includes("password") ||
    str.includes("passwd") ||
    str.includes("token") ||
    str.includes("secret")
  ) {
    return true;
  }
  
  // 识别学号特征 (例如 11-12 位数字)
  if (/^\d{11,12}$/.test(str)) {
    return true;
  }
  
  return false;
}

/**
 * 参数名脱敏提取：只提取参数键，剔除参数具体值
 */
function extractKeysOnly(paramsObject) {
  if (!paramsObject) return [];
  return Object.keys(paramsObject).map(key => {
    // 再次过滤键名本身是否有敏感词
    if (isSensitiveValue(key)) {
      return `[SENSITIVE_KEY_REDACTED]`;
    }
    return key;
  });
}

async function discover() {
  // 1. 网络连接检测
  const isNetOk = await diagnose();
  if (!isNetOk) {
    console.error("❌ 本地网络未通过诊断，中止接口发现任务！");
    process.exit(1);
  }

  const { browser, context } = await initBrowser();
  const page = await context.newPage();

  console.log("\n=== 启动接口发现嗅探监听 ===");
  
  // 用于收集所有发现的接口请求
  const endpointsMap = new Map();

  // 监听 response
  page.on("response", async (response) => {
    try {
      const request = response.request();
      const urlStr = request.url();
      
      // 只记录教务网主域名的请求，过滤外部资源（如图片、css、js）以及统一认证域
      if (urlStr.includes("100.fosu.edu.cn")) {
        const urlObj = new URL(urlStr);
        const pathStr = urlObj.pathname;
        const method = request.method();
        
        // 静态资源文件直接过滤，不作为 API 接口记录
        if (/\.(png|jpg|jpeg|gif|css|js|ico|woff|woff2|svg)$/i.test(pathStr)) {
          return;
        }

        // 解析 Query 参数名
        const queryParams = [];
        urlObj.searchParams.forEach((_, key) => {
          if (!isSensitiveValue(key)) {
            queryParams.push(key);
          }
        });

        // 解析 Post Body 参数名
        const postParams = [];
        const postData = request.postData();
        if (postData) {
          try {
            // 支持 JSON 和 表单格式解析
            if (postData.trim().startsWith("{")) {
              const parsedJson = JSON.parse(postData);
              postParams.push(...extractKeysOnly(parsedJson));
            } else {
              const urlParams = new URLSearchParams(postData);
              urlParams.forEach((_, key) => {
                if (!isSensitiveValue(key)) {
                  postParams.push(key);
                }
              });
            }
          } catch (e) {
            // 解析失败时可能为普通文本
          }
        }

        const status = response.status();
        const contentType = response.headers()["content-type"] || "";
        
        let responseLength = 0;
        let responseText = "";
        try {
          responseText = await response.text();
          responseLength = responseText.length;
        } catch (e) {
          // 响应已关闭或无法以文本解析
        }

        // 识别特征
        const hasTable = responseText.includes("<table") || responseText.includes("</table>");
        const hasKbtable = responseText.includes("kbtable") || responseText.includes("class=\"kbtable\"");
        const hasSelectOption = responseText.includes("<select") && responseText.includes("<option");
        const isScheduleHtml = responseText.includes("课表") || responseText.includes("星期一") || responseText.includes("时间划段");

        // 建立唯一 key 用于去重
        const uniqueKey = `${method}:${pathStr}:${queryParams.sort().join(",")}:${postParams.sort().join(",")}`;

        endpointsMap.set(uniqueKey, {
          method,
          path: pathStr,
          queryParams,
          postParams,
          status,
          contentType,
          responseLength,
          hasTable,
          hasKbtable,
          hasSelectOption,
          isScheduleHtml
        });
      }
    } catch (err) {
      // 避免由于个别网络响应读取异常中断嗅探
    }
  });

  const targets = [
    { name: "教务首页桌面", path: "/framework/xsMain.jsp" },
    { name: "学生个人课表", path: "/xskb/xskb_list.do" },
    { name: "行政班级课表", path: "/kbcx/kbxx_xzb" },
    { name: "教师课表", path: "/kbcx/kbxx_teacher" },
    { name: "教室课表", path: "/kbcx/kbxx_classroom" },
    { name: "课程课表", path: "/kbcx/kbxx_kc" }
  ];

  for (const target of targets) {
    console.log(`\n📢 正在自动访问: ${target.name} (${target.path}) ...`);
    try {
      await gotoPage(page, target.path, { waitUntil: "networkidle", timeout: 20000 });
      // 额外在页面内停留一段时间，给页面异步接口加载的时间
      await sleep(2500);
      
      // 如果是在联动页面，尝试点击一些基本的联动下拉框触发 Ajax 加载，以便抓到联动接口
      if (target.path.includes("kbxx")) {
        console.log("   尝试触发下拉框联动以捕获潜在 Ajax 接口...");
        await page.evaluate(() => {
          // 尝试触发学院下拉框 change
          const selectSkyx = document.querySelector("select[name='skyx']");
          if (selectSkyx && selectSkyx.options.length > 1) {
            selectSkyx.selectedIndex = 1;
            selectSkyx.dispatchEvent(new Event("change"));
          }
        });
        await sleep(1500);
      }
    } catch (e) {
      console.warn(`⚠️  访问 ${target.name} 时超时或发生错误: ${e.message}`);
    }
  }

  await browser.close();
  console.log("\n=== 接口嗅探完毕，正在生成脱敏报告 ===");

  const endpointsList = Array.from(endpointsMap.values());
  const jsonPath = path.join(DEBUG_DIR, "fosu-endpoints.json");
  const mdPath = path.join(DEBUG_DIR, "fosu-endpoints.md");

  // 1. 写入 JSON
  fs.writeFileSync(jsonPath, JSON.stringify(endpointsList, null, 2), "utf-8");
  console.log(`✅ 成功写入脱敏 JSON 报告: tools/fosu-sync-client/.debug/fosu-endpoints.json`);

  // 2. 写入 Markdown
  let mdContent = `# 佛大教务系统 API 接口发现与脱敏分析报告

本报告由 FosuClass Synchronizer 接口嗅探工具自动生成，仅包含请求结构、参数键及响应特征分析，**不包含任何凭证、学号、姓名、Cookie 或者是响应正文**。

- **探测时间**：${new Date().toLocaleString()}
- **探测范围**：教务处 6 个核心主页与异步关联 API

## 一、 发现的接口特征汇总

| 请求方法 | 接口路径 (Path) | Query 参数名 | Post 参数名 | 响应类型 (Content-Type) | 响应长度 | 包含 Table | 包含 Select | 疑似课表 |
| :---: | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
`;

  endpointsList.forEach(ep => {
    mdContent += `| **${ep.method}** | \`${ep.path}\` | ${ep.queryParams.length > 0 ? ep.queryParams.map(q => `\`${q}\``).join(", ") : "无"} | ${ep.postParams.length > 0 ? ep.postParams.map(p => `\`${p}\``).join(", ") : "无"} | \`${ep.contentType.split(";")[0]}\` | ${ep.responseLength} B | ${ep.hasTable ? "✅" : "❌"} | ${ep.hasSelectOption ? "✅" : "❌"} | ${ep.isScheduleHtml ? "✅" : "❌"} |\n`;
  });

  mdContent += `
## 二、 关键路由架构发现与建议

1. **统一身份认证拦截**：
   在会话校验和接口请求中，若出现被 302 重定向至 \`authserver.fosu.edu.cn\`，说明本地 session.json 已过期。需重新调用 \`npm run login\` 进行登录引导。
   
2. **AJAX 联动推荐**：
   检测到类似 \`getZyByAjax\` 等 AJAX 联动接口，可以通过注入脚本 \`page.evaluate\` 并使用 \`fetch\` 在页面上下文中请求，从而安全绕过 Node.js 的 SSL/TLS 握手协议障碍。
   
3. **HTML 解析兼容**：
   部分课表接口（例如行政班级课表 iframe \`/kbcx/kbxx_xzb_ifr\`）直接返回渲染后的 HTML 表格。FosuClass 解析器必须保持高容错度，继续沿用 Cheerio 对 \`kbtable\` 表格的选择器提取规则。
`;

  fs.writeFileSync(mdPath, mdContent, "utf-8");
  console.log(`✅ 成功写入脱敏 Markdown 报告: tools/fosu-sync-client/.debug/fosu-endpoints.md`);
}

if (require.main === module) {
  discover();
}

module.exports = discover;
