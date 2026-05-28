/**
 * 本地同步核心脚本：负责诊断网络、复用或注入登录状态、抓取教务数据并同步上传至 VPS 后端。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const diagnose = require("./diagnose");
require("dotenv").config();

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
 * 1. 同步 Catalog 基础选项数据
 */
async function syncCatalog(page) {
  console.log("\n=== [步骤 1] 开始抓取 Catalog ===");
  
  // 1. 访问行政班级课表页面获取基础 catalog
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);

  // 解析学期
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });

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
    semesters,
    grades,
    weeks,
    sections: [],
  };

  console.log(`📊 抓取完毕: 学院 ${colleges.length} 个, 学期 ${semesters.length} 个, 年级 ${grades.length} 个`);
  
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
  const activeSemester = catalog.semesters[0]?.value || "2025-2026-2";
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

  // 打开页面以确保联动操作可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  let count = 0;
  for (const college of colleges) {
    for (const grade of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] 抓取中: ${college.name} - ${grade}级 ...`);
      
      let responseText = "";
      let success = false;
      
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
          const parsed = parser.parseMajorAjaxResponse(responseText, { collegeCode: college.code, grade });
          majors = (parsed.majors || [])
            .map((m) => ({
              code: m.code,
              name: m.name,
              collegeCode: college.code,
              grade: grade,
            }));
        } catch (e) {
          console.warn(`      ⚠️  Ajax 响应解析失败: ${e.message}，将尝试 DOM Fallback...`);
          success = false;
        }
      }

      // 2. 如果 evaluate fetch 失败，采用页面级 DOM 操作联动
      if (!success) {
        try {
          // 选择学院
          await page.selectOption("select[name='skyx']", college.code);
          // 选择年级
          await page.selectOption("select[name='sknj']", grade);
          // 等待 DOM 反应
          await page.waitForTimeout(800);
          
          // 获取专业下拉框所有选项
          const options = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            if (!sel) return [];
            return Array.from(sel.options)
              .map(opt => ({ value: opt.value, label: opt.textContent.trim() }))
              .filter(opt => opt.value && !opt.label.includes("选择") && !opt.label.includes("全部"));
          });

          majors = options.map(opt => ({
            code: opt.value,
            name: opt.label.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim(),
            collegeCode: college.code,
            grade: grade,
          }));
        } catch (domErr) {
          console.error(`      ❌ DOM 联动 Fallback 也彻底失败: ${domErr.message}`);
        }
      }

      if (majors.length > 0) {
        console.log(`      成功获取到 ${majors.length} 个专业。`);
        allMajors.push(...majors);
      } else {
        console.log(`      没有专业数据。`);
      }

      await sleep(300); // 适度延时保护教务系统
    }
  }

  console.log(`📊 专业联动抓取完毕，共整理出 ${allMajors.length} 个专业。`);
  
  // 1. 上传前把 majors 数据保存到本地 .debug/last-majors-upload.json
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(allMajors, null, 2), "utf-8");
  
  // 2. 统计上传摘要数据
  const payloadStr = JSON.stringify(allMajors);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  
  const collegeCodes = new Set(allMajors.map(m => m.collegeCode));
  const majorGrades = new Set(allMajors.map(m => m.grade));
  
  // 统计每个学院的专业数以找出最大值
  const collegeMajorCounts = {};
  allMajors.forEach(m => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  
  const hasEmptyCollegeCode = allMajors.some(m => !m.collegeCode);
  const hasEmptyMajorCode = allMajors.some(m => !m.code);
  
  // 重复 key 校验
  const seenKeys = new Set();
  let hasDuplicateKey = false;
  for (const m of allMajors) {
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
  console.log(`- majorsCount: ${allMajors.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- 是否存在空 collegeCode: ${hasEmptyCollegeCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在空 majorCode: ${hasEmptyMajorCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在重复 key: ${hasDuplicateKey ? "⚠️ 是" : "否"}`);
  console.log("=====================\n");

  // 3. 上传至 VPS 并做详细的错误捕捉
  try {
    await uploadToVps("/api/admin/sync/majors", allMajors);
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
  
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  console.log("💾 Majors 临时数据已保存至本地 last-majors.json");
  return allMajors;
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

  // 第一阶段只同步目标专业
  const targetMajors = majors.filter(major => {
    const college = catalog.colleges.find(c => c.code === major.collegeCode);
    const isDongKe = college && college.name.includes("动物科技");
    const is2025 = major.grade === "2025";
    const isDongWu = major.name.includes("动物医学") || major.name.includes("动物科学");
    
    const isCurrentStudentMajor = currentStudentClass && 
      currentStudentClass.includes(major.name) && 
      currentStudentClass.includes(major.grade);

    return (isDongKe && is2025) || isDongWu || isCurrentStudentMajor;
  });

  console.log(`🎯 阶段一目标专业总计: ${targetMajors.length} 个。`);

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

    // 随机限流延迟 (800ms - 1500ms)
    const delay = Math.floor(Math.random() * (1500 - 800 + 1)) + 800;
    await sleep(delay);
  }

  console.log(`📊 班级课表抓取完毕，共整理出 ${allClassSchedules.length} 个行政班级的课表。`);
  
  if (allClassSchedules.length > 0) {
    // 上传至 VPS
    await uploadToVps("/api/admin/sync/class-schedules", allClassSchedules);
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
}
