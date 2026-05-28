/**
 * 本地同步核心脚本：负责诊断网络、复用或注入登录状态、抓取教务数据并同步上传至 VPS 后端。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const diagnose = require("./diagnose");
const envPath = path.resolve(__dirname, ".env");
require("dotenv").config({ path: envPath });

console.log(`[env] .env path: ${envPath}`);
console.log(`[env] FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
console.log(`[env] PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "未配置"}`);
console.log(`[env] SYNC_GRADE_RANGE: ${process.env.SYNC_GRADE_RANGE || "未配置"}`);
console.log(`[env] SYNC_GRADES: ${process.env.SYNC_GRADES || "未配置"}`);
console.log(`[env] ADMIN_API_TOKEN: ${process.env.ADMIN_API_TOKEN ? "present" : "missing"}`);

// 引入后端已有的解析与规范化逻辑以确保格式 100% 兼容
const parser = require("../../server/src/utils/parser");
const normalizer = require("../../server/src/utils/scheduleNormalizer");

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const FOSU_API_BASE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const FOSU_SYNC_AUTH_MODE = process.env.FOSU_SYNC_AUTH_MODE || "playwright-manual";
const SESSION_PATH = path.join(__dirname, ".session", "session.json");

// 延迟辅助函数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 兼容 HTTP/HTTPS 的 Playwright 导航辅助函数
 */
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  // 确保相对路径以 / 开头
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
 * 将 manual-cookie 字符串解析为 Playwright 的 Cookie 对象数组
 */
function parseCookieString(cookieStr, domain) {
  if (!cookieStr) return [];
  const domainHost = new URL(domain).hostname;
  return cookieStr
    .split(";")
    .map((pair) => {
      const parts = pair.split("=");
      if (parts.length >= 2) {
        return {
          name: parts[0].trim(),
          value: parts.slice(1).join("=").trim(),
          domain: domainHost,
          path: "/",
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * 向 VPS 发送 POST 请求（管理员 Token 认证）
 */
async function uploadToVps(endpoint, data) {
  if (!ADMIN_API_TOKEN) {
    console.error("❌ 本地未配置 ADMIN_API_TOKEN！无法向 VPS 写入数据。");
    throw new Error("Missing ADMIN_API_TOKEN");
  }

  const url = `${FOSU_API_BASE}${endpoint}`;
  console.log(`📤 正在上传数据到 VPS: ${url} ...`);
  
  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_API_TOKEN,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    console.log(`✅ VPS 响应: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    console.error(`❌ 上传失败: ${error.message}`);
    if (error.response) {
      console.error(`   VPS 错误状态码: ${error.response.status}`);
      console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * 初始化已登录的 Playwright 上下文
 */
async function initBrowserContext() {
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content"
  ];

  let browser;
  // 优先尝试系统边缘浏览器，其次是 Chrome，最后回退内置 Chromium
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false, // 设为 false 以确保与系统通道的最大兼容性，并且能够直观展示同步过程
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
      if (channel === null) {
        console.error("\n💡 提示: 如果您想使用内置 Chromium 浏览器，请先运行以下命令安装：");
        console.error("   npx playwright install chromium");
      }
    }
  }

  if (!browser) {
    console.error("❌ 无法启动任何浏览器！请检查 Playwright 安装是否完整。");
    process.exit(1);
  }

  let context;

  if (FOSU_SYNC_AUTH_MODE === "playwright-manual") {
    if (!fs.existsSync(SESSION_PATH)) {
      console.error("❌ 本地未找到 session.json 登录会话文件！");
      console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      storageState: SESSION_PATH,
      ignoreHTTPSErrors: true,
    });
  } else if (FOSU_SYNC_AUTH_MODE === "manual-cookie") {
    if (!process.env.FOSU_MANUAL_COOKIE) {
      console.error("❌ 选择了 manual-cookie 模式，但未在 .env 中配置 FOSU_MANUAL_COOKIE！");
      await browser.close();
      process.exit(1);
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    // 注入 cookie
    const cookies = parseCookieString(process.env.FOSU_MANUAL_COOKIE, FOSU_BASE_URL);
    await context.addCookies(cookies);
    console.log(`🔑 已从 .env 中注入 ${cookies.length} 个 Cookie 至浏览器会话。`);
  } else {
    console.error(`❌ 未知的登录模式: ${FOSU_SYNC_AUTH_MODE}`);
    await browser.close();
    process.exit(1);
  }

  return { browser, context };
}

/**
 * 校验登录态是否仍然有效
 */
async function checkSession(page) {
  console.log("🔒 正在校验会话有效性...");
  try {
    await gotoPage(page, "/framework/xsMain.jsp", { waitUntil: "networkidle" });
  } catch (error) {
    console.error(`❌ 导航至教务页失败，可能未连内网或握手彻底失败: ${error.message}`);
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  const currentUrl = page.url();
  if (currentUrl.includes("authserver.fosu.edu.cn") || currentUrl.includes("login")) {
    console.error("❌ 会话已过期或无效！被重定向到了登录页面。");
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  const content = await page.content();
  if (content.includes("统一身份认证") || content.includes("密码登录")) {
    console.error("❌ 会话已过期！页面包含登录标识。");
    console.error("💡 提示: 登录状态已过期，请重新运行 npm run login。");
    return false;
  }
  
  console.log("🎉 会话有效，教务系统主页加载正常。");
  return true;
}

/**
 * 自动推断合理的当前学期
 */
function inferPreferredSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 1 && month <= 8) {
    return `${year - 1}-${year}-2`;
  } else {
    return `${year}-${year}-1`;
  }
}

/**
 * 强制在页面选择指定学期并等待联动
 */
async function selectSemester(page, preferredSemester) {
  if (!preferredSemester) {
    return null;
  }
  
  console.log(`配置学期：${preferredSemester}`);

  // 在页面中寻找匹配的 select 和 option
  const selectResult = await page.evaluate((prefSem) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (let sIdx = 0; sIdx < selects.length; sIdx++) {
      const sel = selects[sIdx];
      const name = sel.getAttribute("name") || "";
      const id = sel.getAttribute("id") || "";
      
      for (let oIdx = 0; oIdx < sel.options.length; oIdx++) {
        const opt = sel.options[oIdx];
        const val = opt.value || "";
        const txt = opt.textContent || "";
        
        if (val.includes(prefSem) || txt.includes(prefSem)) {
          return {
            selectIndex: sIdx,
            selectName: name,
            selectId: id,
            optionValue: val,
            optionText: txt.trim()
          };
        }
      }
    }
    return null;
  }, preferredSemester);

  if (!selectResult) {
    // 打印教务系统的可选学期，以供调试
    const allSemOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const debugInfo = [];
      selects.forEach((sel) => {
        const name = sel.getAttribute("name") || sel.getAttribute("id") || "unnamed";
        if (/xnxq/i.test(name)) {
          const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
          debugInfo.push({ name, opts });
        }
      });
      return debugInfo;
    });
    
    console.error(`❌ 无法在教务系统中匹配到目标学期: ${preferredSemester}`);
    if (allSemOptions.length > 0) {
      console.error("教务系统中学期下拉框的可选值如下：");
      allSemOptions.forEach(sel => {
        sel.opts.forEach(opt => {
          console.error(`  - 值: ${opt.value}, 文本: ${opt.text}`);
        });
      });
    }
    throw new Error(`未找到匹配的学期: ${preferredSemester}`);
  }

  // 构造选择器
  let selector = "";
  if (selectResult.selectName) {
    selector = `select[name="${selectResult.selectName}"]`;
  } else if (selectResult.selectId) {
    selector = `select[id="${selectResult.selectId}"]`;
  } else {
    selector = `select:nth-of-type(${selectResult.selectIndex + 1})`;
  }

  console.log(`页面匹配学期：${selectResult.optionText}`);
  
  // 选择选项并等待
  await page.selectOption(selector, selectResult.optionValue);
  await page.waitForTimeout(1500); // 必须等待页面联动更新

  // 验证最终使用学期是否是要求的学期
  const finalValue = await page.$eval(selector, el => el.value);
  if (!finalValue.includes(preferredSemester)) {
    throw new Error(`选择学期后校验失败：最终选中的值 ${finalValue} 与期望值 ${preferredSemester} 不匹配！`);
  }

  console.log(`最终使用学期：${preferredSemester}`);
  return {
    value: selectResult.optionValue,
    label: selectResult.optionText
  };
}

/**
 * 提取学院名称的安全拼音/英文 Slug，供样本文件名使用
 */
function getCollegeSlug(collegeName) {
  const map = {
    "人文": "human",
    "传": "college",
    "动物": "animal",
    "动科": "animal",
    "生命": "life",
    "商": "business",
    "法": "law",
    "医": "medical",
    "工": "engineering",
    "理": "science",
    "材料": "materials",
    "电信": "telecom",
    "机电": "mechatronic",
    "计算机": "computer",
    "数学": "math",
    "物理": "physics",
    "化学": "chemistry",
    "环境": "env",
    "土木": "civil",
    "食品": "food",
    "设计": "design",
    "艺术": "art",
    "体育": "sports",
    "马克思": "marx",
    "国际": "intl",
    "继教": "continue"
  };
  
  let slug = "college";
  for (const [key, val] of Object.entries(map)) {
    if (collegeName.includes(key)) {
      slug = val;
      break;
    }
  }
  return slug;
}

let savedSampleCount = 0;

/**
 * 保存原始专业联动响应样本
 */
function saveMajorResponseSample(rawText, meta, parsedCount, emptyNameCount) {
  if (savedSampleCount >= 3) return;
  savedSampleCount++;

  const sampleDir = path.join(__dirname, ".debug", "major-response-samples");
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }

  const slug = getCollegeSlug(meta.collegeName);
  const safeName = `${meta.collegeCode}-${meta.grade}-${slug}-college`;
  const rawPath = path.join(sampleDir, `${safeName}.raw.txt`);
  const metaPath = path.join(sampleDir, `${safeName}.meta.json`);

  // 脱敏原始响应体：移除敏感 SessionID 或 Cookie 等
  let sanitizedRaw = rawText;
  sanitizedRaw = sanitizedRaw.replace(/JSESSIONID=[a-zA-Z0-9.\-_]+/gi, "JSESSIONID=REDACTED");
  sanitizedRaw = sanitizedRaw.replace(/cookie/gi, "REDACTED");

  fs.writeFileSync(rawPath, sanitizedRaw, "utf-8");

  const metaData = {
    collegeCode: meta.collegeCode,
    collegeName: meta.collegeName,
    grade: meta.grade,
    semester: meta.semester,
    requestUrl: meta.requestUrl,
    method: meta.method || "GET",
    status: meta.status || 200,
    contentType: meta.contentType || (rawText.trim().startsWith("<") ? "text/html" : "application/json"),
    rawLength: rawText.length,
    parsedCount,
    emptyNameCount
  };

  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
  console.log(`💾 已保存原始响应样本及元数据至: ${rawPath}`);
}

/**
 * 从不同格式的专业联动响应中解析出专业列表
 */
function parseMajorOptionsFromResponse(raw, meta) {
  if (!raw) return [];
  const { collegeCode = "", collegeName = "", grade = "", semester = "", requestUrl = "" } = meta || {};
  const rawStr = String(raw).trim();
  const items = [];

  const formatItem = (codeVal, nameVal) => {
    const code = typeof codeVal === "string" ? codeVal.trim() : (codeVal ? String(codeVal).trim() : "");
    const name = typeof nameVal === "string" ? nameVal.trim() : (nameVal ? String(nameVal).trim() : "");
    if (!code && !name) return null;

    return {
      code,
      name,
      majorCode: code,
      majorName: name,
      rawLabel: name,
      collegeCode,
      collegeName,
      grade,
      semester
    };
  };

  // 1. 尝试 JSON 数组格式
  try {
    let parsed = null;
    if (rawStr.startsWith("[") || rawStr.startsWith("{")) {
      parsed = JSON.parse(rawStr);
    } else {
      // 提取中括号包裹的疑似 JSON 数组
      const jsonRegex = /\[\s*\{[\s\S]*\}\s*\]/;
      const match = rawStr.match(jsonRegex);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          // 尝试宽容解析或 eval 提取
          try {
            parsed = eval(`(${match[0]})`);
          } catch (evalErr) {
            // ignore
          }
        }
      }
    }

    if (parsed) {
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed.rows || parsed.data || parsed.list || parsed.majors || parsed.items) || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item) continue;
          const codeVal = item.majorCode || item.code || item.value || item.id || item.dm || item.DM || item.zyh || item.ZYH || item.bh || item.BH;
          const nameVal = item.majorName || item.name || item.label || item.text || item.mc || item.MC || item.zymc || item.ZYMC || item.dmmc || item.DMMC || item.title;
          const formatted = formatItem(codeVal, nameVal);
          if (formatted) items.push(formatted);
        }
      }
    }
  } catch (jsonErr) {
    // ignore
  }

  // 2. 如果没有解析出 JSON，尝试 HTML Cheerio 解析
  if (items.length === 0) {
    try {
      const $ = cheerio.load(rawStr, { decodeEntities: false });
      $("option").each((_, el) => {
        const val = $(el).val() || $(el).attr("value") || "";
        const text = $(el).text().trim();
        // 跳过空值和请选择占位符
        if (val) {
          const formatted = formatItem(val, text);
          if (formatted) items.push(formatted);
        }
      });
    } catch (htmlErr) {
      // ignore
    }
  }

  // 3. 正则兜底解析 HTML option 格式
  if (items.length === 0) {
    const optionRegex = /<option\s+[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match;
    while ((match = optionRegex.exec(rawStr)) !== null) {
      const val = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (val) {
        const formatted = formatItem(val, text);
        if (formatted) items.push(formatted);
      }
    }
  }

  return items;
}

/**
 * 规范化单个专业数据项，识别需要丢弃的数据
 */
function normalizeMajorItem(item) {
  const majorCodeRaw = item.majorCode || item.code || item.value;
  const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;

  const majorName = typeof majorNameRaw === "string" ? majorNameRaw.trim() : (majorNameRaw ? String(majorNameRaw).trim() : "");
  let majorCode = typeof majorCodeRaw === "string" ? majorCodeRaw.trim() : (majorCodeRaw ? String(majorCodeRaw).trim() : "");

  if (!majorCode && !majorName) {
    return { status: "drop_empty", item };
  }
  if (!majorName) {
    return { status: "drop_empty", item };
  }

  const placeholders = ["请选择", "全部", "全部专业", "--请选择--", "请选择专业"];
  if (placeholders.includes(majorName)) {
    return { status: "drop_placeholder", item };
  }

  let generated = false;
  if (!majorCode) {
    majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
    generated = true;
  }

  return {
    status: "keep",
    generated,
    normalized: {
      code: majorCode,
      name: majorName,
      majorCode,
      majorName,
      collegeCode: item.collegeCode,
      grade: item.grade
    }
  };
}

/**
 * 批量清洗专业 Payload
 */
function cleanMajorsPayload(rawItems) {
  const cleaned = [];
  const droppedEmpty = [];
  const droppedPlaceholder = [];
  let generatedCount = 0;

  for (const item of rawItems) {
    const res = normalizeMajorItem(item);
    if (res.status === "keep") {
      cleaned.push(res.normalized);
      if (res.generated) {
        generatedCount++;
      }
    } else if (res.status === "drop_empty") {
      droppedEmpty.push(res.item);
    } else if (res.status === "drop_placeholder") {
      droppedPlaceholder.push(res.item);
    }
  }

  return {
    cleaned,
    droppedEmpty,
    droppedPlaceholder,
    generatedCount
  };
}

/**
 * 1. 同步 Catalog 基础选项数据
 */
async function syncCatalog(page) {
  console.log("\n=== [步骤 1] 开始抓取 Catalog ===");
  
  // 1. 访问行政班级课表页面获取基础 catalog
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);

  // 重新获取选择学期后的页面内容
  html = await page.content();
  $ = cheerio.load(html);

  // 解析所有可选学期
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });

  const matchedOption = semesters.find(s => s.value === semResult.value) || semResult;
  const reorderedSemesters = [
    matchedOption,
    ...semesters.filter(s => s.value !== matchedOption.value)
  ];

  // 使用 Map 管理学院列表，方便根据 code 去重
  const collegeMap = new Map();
  
  function addCollegesFromSelect(selectHtml) {
    const $select = cheerio.load(selectHtml);
    $select("select[name='skyx'] option").each((_, el) => {
      const val = $select(el).attr("value");
      const text = $select(el).text().trim();
      if (val && !text.includes("请选择") && !text.includes("全部")) {
        const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
        if (!collegeMap.has(val)) {
          collegeMap.set(val, { code: val, name: cleanName, rawLabel: text });
        }
      }
    });
  }

  // 提取班级课表页面的学院
  addCollegesFromSelect(html);

  // 解析年级
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("选择")) {
      grades.push(val);
    }
  });

  // 2. 依次访问教师课表、教室课表和课程课表以补充学院选项
  const extraPages = [
    { name: "教师课表", path: "/kbcx/kbxx_teacher" },
    { name: "教室课表", path: "/kbcx/kbxx_classroom" },
    { name: "课程课表", path: "/kbcx/kbxx_kc" }
  ];

  for (const item of extraPages) {
    try {
      console.log(`   正在访问 ${item.name} (${item.path}) 补充院系选项...`);
      await gotoPage(page, item.path, { waitUntil: "networkidle" });
      const pageHtml = await page.content();
      addCollegesFromSelect(pageHtml);
    } catch (e) {
      console.warn(`   ⚠️ 补充访问 ${item.name} 失败: ${e.message} (将忽略并继续)`);
    }
  }

  const colleges = Array.from(collegeMap.values());

  // 默认周次
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    value: String(i + 1),
    label: `第${i + 1}周`,
  }));

  const catalogPayload = {
    colleges,
    semesters: reorderedSemesters,
    grades,
    weeks,
    sections: [],
  };

  console.log(`📊 抓取完毕: 学院 ${colleges.length} 个, 学期 ${reorderedSemesters.length} 个, 年级 ${grades.length} 个`);
  
  // 上传至 VPS
  await uploadToVps("/api/admin/sync/catalog", catalogPayload);
  
  // 本地保存一份
  fs.writeFileSync(path.join(__dirname, "last-catalog.json"), JSON.stringify(catalogPayload, null, 2), "utf-8");
  console.log("💾 Catalog 临时数据已保存至本地 last-catalog.json");
  return catalogPayload;
}

/**
 * 2. 同步 Majors 专业映射数据
 */
/**
 * 动态年级过滤函数
 * @param {string} semester 学期，形如 "2025-2026-2" 或 "2025-2026学年第二学期"
 * @param {Object} options 过滤参数
 */
function getActiveGradesBySemester(semester, options = {}) {
  const { originalGrades = [] } = options;
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';
  const syncGradesEnv = process.env.SYNC_GRADES;
  const confirmFullSync = process.env.CONFIRM_FULL_SYNC === 'true';

  const match = semester.match(/^(\d{4})/);
  if (!match) {
    throw new Error(`无法从学期标识 "${semester}" 中提取学年起始年份，请检查学期格式。`);
  }
  const startYear = parseInt(match[1], 10);

  let targetGrades = [];

  if (gradeRangeEnv === 'active') {
    // 默认本科保守保留 5 个年级
    for (let i = 4; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'recent4') {
    // 只同步最近 4 个年级
    for (let i = 3; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'custom') {
    if (!syncGradesEnv) {
      throw new Error("检测到 SYNC_GRADE_RANGE=custom，但未设置 SYNC_GRADES 环境变量。");
    }
    targetGrades = syncGradesEnv.split(',').map(g => g.trim()).filter(Boolean);
  } else if (gradeRangeEnv === 'all') {
    if (!confirmFullSync) {
      console.error("❌ 检测到 SYNC_GRADE_RANGE=all，但未设置 CONFIRM_FULL_SYNC=true。为避免同步过多历史年级，已中止。");
      process.exit(1);
    }
    return originalGrades;
  } else {
    // 默认 active
    for (let i = 4; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  }

  // 过滤出在教务系统原始年级中匹配的部分
  return originalGrades.filter(g => targetGrades.includes(g));
}

/**
 * 2. 同步 Majors 专业映射数据
 */
async function syncMajors(page, catalog) {
  console.log("\n=== [步骤 2] 开始抓取 Majors 专业联动 ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  const { colleges, grades } = catalog;
  // 打开页面以确保联动操作可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  const activeSemester = preferredSemester;

  const startYear = parseInt(activeSemester.match(/^(\d{4})/)?.[1] || "2025", 10);
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';

  // 过滤年级
  let filteredGrades = [];
  try {
    filteredGrades = getActiveGradesBySemester(activeSemester, { originalGrades: grades });
  } catch (err) {
    console.error(`❌ 年级过滤失败: ${err.message}`);
    process.exit(1);
  }

  console.log(`当前学期：${activeSemester}`);
  console.log(`学年起始年份：${startYear}`);
  console.log(`年级过滤模式：${gradeRangeEnv}`);
  console.log(`本次同步年级：${filteredGrades.join(", ")}`);
  console.log(`原始年级数量：${grades.length}`);
  console.log(`过滤后年级数量：${filteredGrades.length}`);
  console.log(`本次联动请求数：${colleges.length} × ${filteredGrades.length} = ${colleges.length * filteredGrades.length}`);

  const allMajors = [];

  let count = 0;
  for (const college of colleges) {
    for (const grade of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] 抓取中: ${college.name} - ${grade}级 ...`);
      
      let responseText = "";
      let success = false;
      let dropdownHtml = "";
      
      // 1. 优先使用 evaluate fetch
      try {
        responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade });
        success = true;
      } catch (ajaxErr) {
        console.warn(`      ⚠️  Ajax 抓取专业失败 (${ajaxErr.message})，尝试使用 DOM 联动 Fallback...`);
      }

      let majors = [];
      if (success && responseText) {
        try {
          majors = parseMajorOptionsFromResponse(responseText, {
            collegeCode: college.code,
            collegeName: college.name,
            grade,
            semester: activeSemester,
            requestUrl: `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}`
          });
        } catch (e) {
          console.warn(`      ⚠️  Ajax 响应解析失败: ${e.message}，将尝试 DOM Fallback...`);
          success = false;
        }
      }

      // 2. 如果 evaluate fetch 失败，采用页面级 DOM 操作联动
      if (!success || majors.length === 0) {
        try {
          // 选择学院
          await page.selectOption("select[name='skyx']", college.code);
          // 选择年级
          await page.selectOption("select[name='sknj']", grade);
          // 等待 DOM 反应
          await page.waitForTimeout(800);
          
          // 获取专业下拉框的 HTML 内容，然后用我们的通用 parser 解析
          dropdownHtml = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            return sel ? sel.outerHTML : "";
          });

          if (dropdownHtml) {
            majors = parseMajorOptionsFromResponse(dropdownHtml, {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: "DOM_SELECT_skzy"
            });
          }
        } catch (domErr) {
          console.error(`      ❌ DOM 联动 Fallback 也彻底失败: ${domErr.message}`);
        }
      }

      if (majors.length > 0) {
        const rawCount = majors.length;
        const emptyNameCount = majors.filter(m => !String(m.name || m.majorName || m.rawLabel || "").trim()).length;
        const validCount = rawCount - emptyNameCount;
        
        console.log(`      原始选项数：${rawCount}`);
        console.log(`      有效专业数：${validCount}`);
        console.log(`      空名称数：${emptyNameCount}`);

        if (emptyNameCount === rawCount) {
          console.warn(`      ⚠️ 严重警告：本次联动只解析到专业 code，没有解析到专业名称，请检查 parser 或 raw response 样本。`);
        }

        if (savedSampleCount < 3) {
          saveMajorResponseSample(
            responseText || dropdownHtml,
            {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: responseText ? `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}` : "DOM_SELECT_skzy",
              method: responseText ? "GET" : "DOM_INTERACTION",
              status: 200,
              contentType: responseText ? (responseText.trim().startsWith("<") ? "text/html" : "application/json") : "text/html"
            },
            rawCount,
            emptyNameCount
          );
        }

        allMajors.push(...majors);
      } else {
        console.log(`      没有专业数据。`);
      }

      await sleep(300); // 适度延时保护教务系统
    }
  }

  console.log(`📊 专业联动抓取完毕，共整理出 ${allMajors.length} 个原始专业数据。`);
  
  // 1. 进行数据清洗
  const { cleaned, droppedEmpty, droppedPlaceholder, generatedCount } = cleanMajorsPayload(allMajors);
  const sampleDroppedItems = [...droppedEmpty, ...droppedPlaceholder].slice(0, 10);

  console.log("\n🧹 === [专业清洗数据统计] ===");
  console.log(`- rawMajorsCount: ${allMajors.length}`);
  console.log(`- cleanedMajorsCount: ${cleaned.length}`);
  console.log(`- droppedEmptyNameCount: ${droppedEmpty.length}`);
  console.log(`- droppedPlaceholderCount: ${droppedPlaceholder.length}`);
  console.log(`- generatedMajorCodeCount: ${generatedCount}`);
  console.log(`- sampleDroppedItems (前 10 条):`, JSON.stringify(sampleDroppedItems, null, 2));
  console.log("=============================\n");

  if (cleaned.length === 0) {
    console.error(`❌ 没有有效专业数据，已停止上传。`);
    console.error(`请检查：`);
    console.error(`1. 当前学期是否正确。`);
    console.error(`2. major-response-samples 中的 raw 响应格式。`);
    console.error(`3. parseMajorOptionsFromResponse 是否正确解析 option text / JSON name 字段。`);
    throw new Error("没有有效专业数据，已停止上传。");
  }

  // 2. 保存调试文件
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  fs.writeFileSync(path.join(debugDir, "last-majors-raw.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(cleaned, null, 2), "utf-8");
  
  // 3. 统计上传摘要数据
  const payloadStr = JSON.stringify(cleaned);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  
  const collegeCodes = new Set(cleaned.map(m => m.collegeCode));
  const majorGrades = new Set(cleaned.map(m => m.grade));
  
  // 统计每个学院的专业数以找出最大值
  const collegeMajorCounts = {};
  cleaned.forEach(m => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  
  const hasEmptyCollegeCode = cleaned.some(m => !m.collegeCode);
  const hasEmptyMajorCode = cleaned.some(m => !m.code);
  
  // 重复 key 校验
  const seenKeys = new Set();
  let hasDuplicateKey = false;
  for (const m of cleaned) {
    const key = `${m.collegeCode}_${m.grade}_${m.code}`;
    if (seenKeys.has(key)) {
      hasDuplicateKey = true;
      break;
    }
    seenKeys.add(key);
  }
  
  console.log("\n📦 === [上传摘要] ===");
  console.log(`- collegesCount: ${collegeCodes.size}`);
  console.log(`- gradesCount: ${majorGrades.size}`);
  console.log(`- majorsCount: ${cleaned.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- 是否存在空 collegeCode: ${hasEmptyCollegeCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在空 majorCode: ${hasEmptyMajorCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在重复 key: ${hasDuplicateKey ? "⚠️ 是" : "否"}`);
  console.log("=====================\n");

  // 4. 上传至 VPS 并做详细的错误捕捉
  try {
    await uploadToVps("/api/admin/sync/majors", cleaned);
  } catch (err) {
    console.error(`❌ Majors 数据同步至 VPS 失败！`);
    if (err.response) {
      console.error(`- status: ${err.response.status}`);
      console.error(`- response body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`- error message: ${err.message}`);
    }
    console.error(`- request payload size: ${payloadSizeKB} KB`);
    console.error(`- 本地调试文件路径: ${debugUploadPath}`);
    throw err;
  }
  
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(cleaned, null, 2), "utf-8");
  console.log("💾 Majors 临时数据已保存至本地 last-majors.json");
  return cleaned;
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
/**
 * 获取当前登录学生的班级名称
 */
async function getCurrentStudentClass(page) {
  console.log("🔍 正在定位当前登录学生的班级信息...");
  try {
    await gotoPage(page, "/xskb/xskb_list.do", { waitUntil: "networkidle" });
    const htmlText = await page.content();
    const $ = cheerio.load(htmlText);
    
    const bodyText = $("body").text();
    let className = "";
    
    // 匹配类似 "班级：[123456] 动物医学2023级1班" 或 "行政班级：动物医学221"
    const match = bodyText.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
    if (match) {
      className = match[1].trim();
      console.log(`🎉 成功识别当前登录学生班级: ${className}`);
      return className;
    }

    // 备选 DOM 遍历
    $("td, th, span, div").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("班级：") || text.includes("行政班级：") || text.includes("班级:")) {
        const m = text.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
        if (m) {
          className = m[1].trim();
        }
      }
    });

    if (className) {
      console.log(`🎉 从页面 DOM 匹配当前登录学生班级: ${className}`);
      return className;
    }
    
    console.warn("⚠️ 个人课表页面中未提取到明确班级文本。");
    return "";
  } catch (error) {
    console.error(`⚠️ 抓取当前学生班级出错: ${error.message}`);
    return "";
  }
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
async function syncClassSchedules(page, catalog, majors) {
  console.log("\n=== [步骤 3] 开始抓取班级课表 Class Schedules ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  if (!majors) {
    if (fs.existsSync(path.join(__dirname, "last-majors.json"))) {
      majors = JSON.parse(fs.readFileSync(path.join(__dirname, "last-majors.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Majors 数据，请先运行 sync:majors");
      return;
    }
  }

  const debugDir = path.join(__dirname, ".debug");
  const rawPagesDir = path.join(debugDir, "raw-pages");
  if (!fs.existsSync(rawPagesDir)) {
    fs.mkdirSync(rawPagesDir, { recursive: true });
  }

  const PROGRESS_PATH = path.join(debugDir, "sync-progress.json");
  let progress = { completed: [] };
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      console.log(`ℹ️ 加载到本地同步进度，已完成 ${progress.completed.length} 个专业。`);
    } catch (e) {
      console.warn("⚠️ 读取断点进度失败，将全新抓取");
    }
  }

  // 默认使用最新学期
  const activeSemester = catalog.semesters[0]?.value || "2025-2026-2";
  console.log(`📅 抓取学期: ${activeSemester}`);

  // 定位当前学生班级
  const currentStudentClass = await getCurrentStudentClass(page);

  // 解析环境变量过滤条件
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map(c => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map(g => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map(m => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);

  if (isFiltered) {
    console.log("ℹ️ 课表同步已启用环境变量限制过滤：");
    if (syncCollegeCodes) console.log(`   - 学院限制: ${syncCollegeCodes.join(", ")}`);
    if (syncGrades) console.log(`   - 年级限制: ${syncGrades.join(", ")}`);
    if (syncMajorCodes) console.log(`   - 专业代码限制: ${syncMajorCodes.join(", ")}`);
  } else {
    console.log("ℹ️ 课表同步未设置环境变量限制。默认将仅同步在校活跃年级，并启用限速。");
  }

  // 筛选出目标专业
  const targetMajors = majors.filter(major => {
    // 1. 如果指定了 collegeCodes 限制且当前 major 不在其中，过滤掉
    if (syncCollegeCodes && !syncCollegeCodes.includes(major.collegeCode)) {
      return false;
    }
    // 2. 如果指定了 grades 限制且当前 major 不在其中，过滤掉
    if (syncGrades && !syncGrades.includes(major.grade)) {
      return false;
    }
    // 3. 如果指定了 majorCodes 限制且当前 major 不在其中，过滤掉
    if (syncMajorCodes && !syncMajorCodes.includes(major.code)) {
      return false;
    }

    // 4. 如果没有指定任何环境变量限制，则默认只同步活跃在校年级
    if (!isFiltered) {
      let activeGrades = [];
      try {
        activeGrades = getActiveGradesBySemester(activeSemester, { originalGrades: catalog.grades });
      } catch (e) {
        // 兜底：如果报错，则默认只同步最近 5 个年级
        const currentYear = new Date().getFullYear();
        for (let i = 4; i >= 0; i--) {
          activeGrades.push(String(currentYear - i));
        }
      }
      if (!activeGrades.includes(major.grade)) {
        return false;
      }
    }

    return true;
  });

  console.log(`🎯 匹配的目标专业总计: ${targetMajors.length} 个。`);

  // 剔除已完成部分
  const pendingMajors = targetMajors.filter(major => {
    const key = `${major.grade}_${major.code}`;
    return !progress.completed.includes(key);
  });

  console.log(`🔄 本轮待同步专业: ${pendingMajors.length} 个。`);

  // 打开行政班级课表页面以确保 Ajax 环境可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const allClassSchedules = [];
  let count = 0;

  for (const major of pendingMajors) {
    count++;
    console.log(`   [${count}/${pendingMajors.length}] 正在抓取: ${major.grade}级 - ${major.name} 专业课表 ...`);

    try {
      // 页面内 POST 请求课表 HTML
      const htmlText = await page.evaluate(async (params) => {
        const formBody = new URLSearchParams({
          xnxqh: params.semester,
          skyx: params.collegeCode,
          sknj: params.grade,
          skzy: params.majorCode,
          zc1: "",
          zc2: "",
          jc1: "",
          jc2: "",
        }).toString();

        const res = await fetch("/kbcx/kbxx_xzb_ifr", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody,
        });
        return res.text();
      }, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
      });

      // 保存 raw HTML 到本地，便于调试且不提交到 git
      const rawHtmlPath = path.join(rawPagesDir, `class_${major.grade}_${major.code}.html`);
      fs.writeFileSync(rawHtmlPath, htmlText, "utf-8");

      // 解析课表 HTML
      const parsed = parser.parseClassScheduleIfrHtml(htmlText, {
        semester: activeSemester,
      });

      // 规范化课表
      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester: activeSemester,
        sourceType: "class",
        audienceType: "student",
      });

      // 按班级名称分组 (Group By)
      const grouped = normalizer.groupCoursesBy(courses, "className", "未命名班级");
      
      const classes = Object.keys(grouped).map((clsName) => ({
        className: clsName,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
        courses: grouped[clsName],
      }));

      if (classes.length > 0) {
        console.log(`      发现班级数: ${classes.length} (${classes.map(c => c.className).join(", ")})`);
        allClassSchedules.push(...classes);
      } else {
        console.log(`      没有排课数据。`);
      }

      // 将该专业标记为已完成
      progress.completed.push(`${major.grade}_${major.code}`);
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf-8");

    } catch (err) {
      console.error(`      ⚠️  抓取失败: ${err.message}`);
    }

    // 随机限流延迟：如果是全量同步则进一步限速保护教务系统
    const delayMin = isFiltered ? 800 : 1500;
    const delayMax = isFiltered ? 1500 : 3000;
    const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    console.log(`      ⏳ 随机等待 ${delay}ms...`);
    await sleep(delay);
  }

  console.log(`📊 班级课表抓取完毕，共整理出 ${allClassSchedules.length} 个行政班级的课表。`);
  
  if (allClassSchedules.length > 0) {
    // 上传至 VPS (默认是 merge 模式，只更新/新增有变动的班级)
    await uploadToVps("/api/admin/sync/class-schedules?mode=merge", allClassSchedules);
    console.log(`✅ 本轮抓取的班级课表数据同步完成！`);
  } else {
    console.log("ℹ️ 本轮没有新抓取到任何班级课表，无需上传。");
  }

  // 如果全部都已同步完成，重置进度文件
  if (progress.completed.length >= targetMajors.length) {
    try {
      fs.unlinkSync(PROGRESS_PATH);
      console.log("🎉 所有目标专业已同步完成，进度已重置。");
    } catch (e) {}
  }
}

/**
 * 主程序入口
 */
async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || "all";

  // 1. 网络连接检测
  const isNetOk = await diagnose();
  if (!isNetOk) {
    console.error("❌ 本地网络未通过校园网/VPN诊断，中止同步任务！");
    process.exit(1);
  }

  // 2. 初始化 Playwright 并启动
  const { browser, context } = await initBrowserContext();
  const page = await context.newPage();

  try {
    // 3. 校验 Session 状态
    const isSessionOk = await checkSession(page);
    if (!isSessionOk) {
      process.exit(1);
    }

    let catalog, majors;

    if (action === "catalog") {
      await syncCatalog(page);
    } else if (action === "majors") {
      await syncMajors(page);
    } else if (action === "class") {
      await syncClassSchedules(page);
    } else if (action === "all") {
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      await syncClassSchedules(page, catalog, majors);
      console.log("\n🎉 [同步大成功] 本地所有数据已全量同步至 VPS！");
    } else {
      console.error(`❌ 未知的同步参数: ${action}`);
      console.log("支持的参数: catalog | majors | class | all");
    }

  } catch (error) {
    console.error(`❌ 执行同步时发生致命异常: ${error.message}`);
    console.error(error.stack);
  } finally {
    await browser.close();
    console.log("浏览器已安全关闭。同步任务结束。");
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    selectSemester,
    getCollegeSlug,
    saveMajorResponseSample,
    parseMajorOptionsFromResponse,
    cleanMajorsPayload,
    normalizeMajorItem
  };
}
