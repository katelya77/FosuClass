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
  const browser = await chromium.launch({
    headless: true, // 默默在后台运行
    args: [
      "--disable-blink-features=AutomationControlled",
      "--ignore-certificate-errors",
      "--disable-web-security"
    ],
  });

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
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const html = await page.content();
  const $ = cheerio.load(html);

  // 解析学期
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });

  // 解析学院
  const colleges = [];
  $("select[name='skyx'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && !text.includes("请选择") && !text.includes("全部")) {
      const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
      colleges.push({ code: val, name: cleanName, rawLabel: text });
    }
  });

  // 解析年级
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("选择")) {
      grades.push(val);
    }
  });

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
  const allMajors = [];

  console.log(`🔄 共有 ${colleges.length} 个学院, ${grades.length} 个年级，共计 ${colleges.length * grades.length} 次联动请求。`);

  // 打开页面以确保环境支持 fetch
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  let count = 0;
  for (const college of colleges) {
    for (const grade of grades) {
      count++;
      console.log(`   [${count}/${colleges.length * grades.length}] 抓取中: ${college.name} - ${grade}级 ...`);
      
      try {
        // 在页面上下文执行 fetch
        const responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade });

        // 解析联动数据
        const parsed = parser.parseMajorAjaxResponse(responseText, { collegeCode: college.code, grade });
        const majors = (parsed.majors || [])
          .map((m) => ({
            code: m.code,
            name: m.name,
            collegeCode: college.code,
            grade: grade,
          }));

        if (majors.length > 0) {
          console.log(`      Found ${majors.length} majors.`);
          allMajors.push(...majors);
        }
      } catch (err) {
        console.error(`      ⚠️  抓取失败 ${college.name}-${grade}: ${err.message}`);
      }

      await sleep(150); // 适度延时避免对教务系统造成过大压力
    }
  }

  console.log(`📊 专业联动抓取完毕，共整理出 ${allMajors.length} 个专业。`);
  
  // 上传至 VPS
  await uploadToVps("/api/admin/sync/majors", allMajors);
  
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  console.log("💾 Majors 临时数据已保存至本地 last-majors.json");
  return allMajors;
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

  // 默认使用最新学期
  const activeSemester = catalog.semesters[0]?.value || "2025-2026-2";
  console.log(`📅 抓取学期: ${activeSemester}`);
  console.log(`🔄 共有 ${majors.length} 个专业需抓取班级课表。`);

  // 打开页面以确保 Ajax 环境可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const allClassSchedules = [];
  let count = 0;

  for (const major of majors) {
    count++;
    console.log(`   [${count}/${majors.length}] 正在抓取: ${major.grade}级 - ${major.name} 专业课表 ...`);

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

    } catch (err) {
      console.error(`      ⚠️  抓取失败: ${err.message}`);
    }

    await sleep(250); // 适度延时保护教务系统
  }

  console.log(`📊 班级课表抓取完毕，共整理出 ${allClassSchedules.length} 个行政班级的课表。`);
  
  // 上传至 VPS
  await uploadToVps("/api/admin/sync/class-schedules", allClassSchedules);
  console.log(`✅ 所有班级课表数据同步完成！`);
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
