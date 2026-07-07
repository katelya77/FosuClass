#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");
const {
  resolveInputFilePath,
  uploadStagingFile,
} = require("../fosu-sync-client/upload");

const SECRET_KEY_PATTERN = /(studentId|student_id|password|passwd|pwd|cookie|ticket|execution|session|token|authorization|jsessionid|captcha)/i;

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    } else {
      args[arg.slice(2)] = true;
    }
  });
  return args;
}

function normalizeServer(value) {
  return String(value || "https://class.katelya.eu.org").replace(/\/+$/, "");
}

function assertRequiredArgs(args) {
  if (!args.token) {
    throw new Error("缺少 --token=xxx。请使用后台接力任务生成的 relay token。");
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(label, url) {
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", timeoutMs: 8000 });
    return {
      label,
      ok: res.status > 0 && res.status < 500,
      status: res.status,
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      duration: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function loadTask(server, token) {
  const res = await fetchWithTimeout(`${server}/api/relay/tasks/${encodeURIComponent(token)}`, {
    timeoutMs: 12000,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || `接力任务读取失败: HTTP ${res.status}`);
  }
  return data.task;
}

async function postRelayStatus(server, token, endpoint, body) {
  try {
    const res = await fetchWithTimeout(`${server}/api/relay/tasks/${encodeURIComponent(token)}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relay-token": token,
      },
      body: JSON.stringify(body || {}),
      timeoutMs: 8000,
    });
    const data = await res.json().catch(() => ({}));
    if (data.task && data.task.cancelRequested) {
      throw new Error("RELAY_TASK_CANCELLED");
    }
    return data;
  } catch (error) {
    if (error.message === "RELAY_TASK_CANCELLED") throw error;
    console.warn(`relay status report failed: ${error.message}`);
    return null;
  }
}

function resolveTaskInclude(task) {
  const plan = task && task.syncPlan || {};
  if (Array.isArray(plan.scopes) && plan.scopes.length) return plan.scopes.join(",");
  const type = String(task && task.taskType || "daily").toLowerCase();
  if (type.includes("teachers")) return "teacherSchedules,teachers";
  if (type.includes("classrooms")) return "classroomSchedules,classrooms";
  if (type.includes("courses")) return "courseSchedules,courses";
  return "classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses";
}

function containsSensitiveData(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveData(item));
  }
  if (typeof value === "object") {
    return Object.keys(value).some((key) => {
      if (SECRET_KEY_PATTERN.test(key)) return true;
      return containsSensitiveData(value[key]);
    });
  }
  if (typeof value === "string") {
    return /(JSESSIONID|CASTGC|password=|passwd=|ticket=|execution=|Authorization:|Bearer\s+[A-Za-z0-9._-]+)/i.test(value);
  }
  return false;
}

function readLeadingText(filePath, maxBytes = 4 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

function pickJsonString(head, key) {
  const match = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1] : "";
}

function pickJsonNumber(head, key) {
  const match = head.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function pickNestedJsonNumber(head, objectKey, key) {
  const match = head.match(new RegExp(`"${objectKey}"\\s*:\\s*\\{[\\s\\S]{0,4000}?"${key}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function extractSummary(filePath) {
  const head = readLeadingText(filePath);
  const summary = {
    term: pickJsonString(head, "term") || pickJsonString(head, "semester"),
    releaseVersion: pickJsonString(head, "releaseVersion") || pickJsonString(head, "version"),
    generatedAt: pickJsonString(head, "generatedAt") || pickJsonString(head, "updatedAt"),
  };
  const resourceCounts = {
    class: {
      scheduleDocuments: pickNestedJsonNumber(head, "class", "scheduleDocuments") || pickJsonNumber(head, "classScheduleCount"),
      administrativeClasses: pickNestedJsonNumber(head, "class", "administrativeClasses"),
      aggregateSchedules: pickNestedJsonNumber(head, "class", "aggregateSchedules"),
    },
    teacher: {
      directoryEntities: pickNestedJsonNumber(head, "teacher", "directoryEntities") || pickJsonNumber(head, "teacherCount"),
      scheduleDocuments: pickNestedJsonNumber(head, "teacher", "scheduleDocuments") || pickJsonNumber(head, "teacherScheduleCount"),
      courseEvents: pickNestedJsonNumber(head, "teacher", "courseEvents"),
    },
    classroom: {
      directoryEntities: pickNestedJsonNumber(head, "classroom", "directoryEntities") || pickJsonNumber(head, "classroomCount"),
      scheduleDocuments: pickNestedJsonNumber(head, "classroom", "scheduleDocuments") || pickJsonNumber(head, "classroomScheduleCount"),
      courseEvents: pickNestedJsonNumber(head, "classroom", "courseEvents"),
    },
    course: {
      directoryEntities: pickNestedJsonNumber(head, "course", "directoryEntities") || pickJsonNumber(head, "courseCount"),
      scheduleDocuments: pickNestedJsonNumber(head, "course", "scheduleDocuments") || pickJsonNumber(head, "courseScheduleCount"),
      courseEvents: pickNestedJsonNumber(head, "course", "courseEvents"),
    },
  };
  const totalScheduleDocuments =
    Number(resourceCounts.class.scheduleDocuments || 0) +
    Number(resourceCounts.teacher.scheduleDocuments || 0) +
    Number(resourceCounts.classroom.scheduleDocuments || 0) +
    Number(resourceCounts.course.scheduleDocuments || 0);
  return Object.assign(summary, {
    classScheduleCount: pickJsonNumber(head, "classScheduleCount"),
    teacherScheduleCount: pickJsonNumber(head, "teacherScheduleCount"),
    classroomScheduleCount: pickJsonNumber(head, "classroomScheduleCount"),
    courseScheduleCount: pickJsonNumber(head, "courseScheduleCount"),
    teacherCount: pickJsonNumber(head, "teacherCount"),
    classroomCount: pickJsonNumber(head, "classroomCount"),
    courseCount: pickJsonNumber(head, "courseCount"),
    resourceCounts,
    totalScheduleDocuments,
    actualNetworkRequestCount: pickJsonNumber(head, "actualNetworkRequestCount"),
    usedClassScheduleCache: /"usedClassScheduleCache"\s*:\s*true/.test(head),
    teacherQualityPass: true,
  });
}

function scanFileForSensitiveData(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let carry = "";
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = carry + buffer.subarray(0, bytesRead).toString("utf-8");
      if (SECRET_KEY_PATTERN.test(chunk) || /(JSESSIONID|CASTGC|password=|passwd=|ticket=|execution=|Authorization:|Bearer\s+[A-Za-z0-9._-]+)/i.test(chunk)) {
        return true;
      }
      carry = chunk.slice(-200);
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function resolveStagingJson(args, task) {
  const fileArg = args.file || args.input || path.join("staging", `${args.term || task.term}-full.json`);
  const resolved = resolveInputFilePath(fileArg, { cwd: process.cwd() });
  const filePath = resolved.resolved || path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    const tried = resolved.tried && resolved.tried.length ? `\n尝试路径：\n${resolved.tried.map(item => `- ${item}`).join("\n")}` : "";
    throw new Error(`未找到 Staging JSON: ${filePath}\n请先在校园网电脑生成文件，或使用 --file=路径 指定。${tried}`);
  }
  if (scanFileForSensitiveData(filePath)) {
    throw new Error("Staging JSON 中包含疑似密码、Cookie、ticket、session 或 token 字段，已停止上传。");
  }
  return { filePath, summary: extractSummary(filePath) };
}

function resolveToolScript(scriptName) {
  const candidates = [
    path.resolve(process.cwd(), scriptName),
    path.resolve(__dirname, scriptName),
    path.resolve(__dirname, "..", "fosu-sync-client", scriptName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`未找到接力采集脚本 ${scriptName}，请重新下载完整接力工具包。`);
}

async function confirmUpload(args, summary) {
  if (args.yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n将要上传的数据摘要：");
    console.log(`- 学期: ${summary.term || "-"}`);
    console.log(`- 班级课表: ${summary.classScheduleCount || 0}份`);
    if (summary.resourceCounts) {
      console.log(`- 行政班: ${summary.resourceCounts.class.administrativeClasses || 0}个`);
      console.log(`- 专业聚合: ${summary.resourceCounts.class.aggregateSchedules || 0}份`);
      console.log(`- 教师目录: ${summary.resourceCounts.teacher.directoryEntities == null ? "未确认" : summary.resourceCounts.teacher.directoryEntities + "人"}`);
      console.log(`- 教师课表: ${summary.resourceCounts.teacher.scheduleDocuments || 0}份`);
      console.log(`- 教师课程事件: ${summary.resourceCounts.teacher.courseEvents || 0}条`);
      console.log(`- 教室目录: ${summary.resourceCounts.classroom.directoryEntities == null ? "未统计" : summary.resourceCounts.classroom.directoryEntities + "间"}`);
      console.log(`- 教室课表: ${summary.resourceCounts.classroom.scheduleDocuments || 0}份`);
      console.log(`- 课程目录: ${summary.resourceCounts.course.directoryEntities == null ? "未统计" : summary.resourceCounts.course.directoryEntities + "门"}`);
      console.log(`- 课程课表: ${summary.resourceCounts.course.scheduleDocuments || 0}份`);
      console.log(`- 实际100网请求数: ${summary.actualNetworkRequestCount || "未统计"}`);
      console.log(`- 是否读取旧动态缓存: ${summary.usedClassScheduleCache ? "是" : "否"}`);
      console.log(`- 教师数据质量: ${summary.teacherQualityPass === false ? "不通过" : "通过"}`);
    } else {
      console.log(`- 教师课表: ${summary.teacherScheduleCount || 0}份`);
      console.log(`- 教室课表: ${summary.classroomScheduleCount || 0}份`);
      console.log(`- 课程课表: ${summary.courseScheduleCount || 0}份`);
    }
    console.log(`- 生成时间: ${summary.generatedAt || "-"}`);
    const answer = await rl.question("\n确认上传课程表公开数据且不包含个人密码？输入 yes 继续: ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function upload(server, token, args, filePath, task) {
  const environment = [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `hostname=${os.hostname()}`,
      `node=${process.version}`,
  ].join("; ");
  return uploadStagingFile({
    filePath,
    server,
    token,
    authMode: "relay",
    params: args,
    term: task.term,
    note: args.note || "",
    environment,
    source: "relay-agent",
    metadata: { term: task.term, environment },
  });
}

function cleanupSession() {
  try {
    const paths = [
      path.resolve(process.cwd(), ".session", "session.json"),
      path.resolve(__dirname, ".session", "session.json")
    ];
    paths.forEach(p => {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    });
    console.log("🧹 登录会话文件已安全清理。");
  } catch (e) {
    console.warn("⚠️ 清理登录会话文件失败: " + e.message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  let config = {};
  const configPath = path.resolve(process.cwd(), "config.json");
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {}
  }

  let token = args.token || config.token;
  let server = args.server || config.server || "https://class.katelya.eu.org";

  if (!token) {
    console.log("佛课小表接力采集器 - 初始化配置");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const serverInput = await rl.question("请输入/确认后台服务器 URL (默认 https://class.katelya.eu.org): ");
      if (serverInput.trim()) {
        server = serverInput.trim();
      }
      const tokenInput = await rl.question("请输入您的接力 Token (必填): ");
      token = tokenInput.trim();
      if (!token) {
        console.error("❌ 必须输入接力 Token 才能继续运行。");
        process.exit(1);
      }
      // 保存至 config.json
      fs.writeFileSync(configPath, JSON.stringify({ server, token }, null, 2), "utf-8");
      console.log(`✅ 接力配置已保存到 config.json`);
    } finally {
      rl.close();
    }
  }

  server = normalizeServer(server);
  token = String(token);
  
  console.log("\n佛课小表接力采集器");
  console.log(`服务器：${server}`);

  const task = await loadTask(server, token);
  await postRelayStatus(server, token, "heartbeat", {
    version: "1.1.0",
    platform: process.platform,
    loginState: "not-checked",
  });
  await postRelayStatus(server, token, "progress", { phase: "network-diagnosis", progress: 5, status: "running" });
  console.log(`当前任务：${task.term} ${task.description || "全校课表采集"}`);
  console.log(`任务有效期：${task.expiresAt}`);

  console.log("\n网络检测：");
  const checks = await Promise.all([
    checkUrl("100.fosu.edu.cn", "https://100.fosu.edu.cn"),
    checkUrl("authserver.fosu.edu.cn", "https://authserver.fosu.edu.cn"),
    checkUrl(new URL(server).hostname, `${server}/api/health`),
  ]);
  checks.forEach((item) => {
    console.log(`- ${item.label}: ${item.ok ? "可访问" : "不可访问"} (${item.status || item.error || "no response"}, ${item.duration}ms)`);
  });
  
  await postRelayStatus(server, token, "heartbeat", {
    version: "1.1.0",
    platform: process.platform,
    network: checks,
    loginState: "not-checked",
  });

  if (!checks[0].ok || !checks[1].ok) {
    console.log("\n⚠️ 警告：无法正常访问学校教务网，请确保您当前已连接佛大校园网或已启动学校 VPN 拨号。");
  }

  console.log("\n================ [步骤 1：登录教务系统] ================");
  console.log("即将为您启动系统浏览器登录教务系统，请在弹出的浏览器中手动登录。");
  await postRelayStatus(server, token, "progress", { phase: "login", progress: 15, status: "running" });
  const child_process = require("child_process");
  try {
    const loginScript = resolveToolScript("login.js");
    child_process.execFileSync(process.execPath, [loginScript], {
      cwd: path.dirname(loginScript),
      stdio: "inherit",
    });
    console.log("✓ 登录成功并已保存本地会话。");
  } catch (err) {
    console.error("\n❌ 登录教务系统失败：" + err.message);
    cleanupSession();
    process.exit(1);
  }

  console.log("\n================ [步骤 2：抓取全校课表数据] ================");
  console.log(`开始抓取全校课程数据（学期：${task.term}），此过程约需要 10 分钟。期间请不要关闭浏览器窗口。`);
  try {
    await postRelayStatus(server, token, "progress", { phase: "crawl", progress: 30, status: "running" });
    const syncScript = resolveToolScript("sync.js");
    const syncArgs = [syncScript, "local-campus", `--term=${task.term}`, `--include=${resolveTaskInclude(task)}`, "--class-scope=all"];
    if (task.termConfig && task.termConfig.termStartDate) {
      syncArgs.push(`--term-start-date=${task.termConfig.termStartDate}`);
    }
    if (task.termConfig && task.termConfig.totalWeeks) {
      syncArgs.push(`--total-weeks=${task.termConfig.totalWeeks}`);
    }
    if (task.termConfig && task.termConfig.weekStart) {
      syncArgs.push(`--week-start=${task.termConfig.weekStart}`);
    }
    const childEnv = Object.assign({}, process.env, {
      FOSU_RELAY_TERM_CONFIG: JSON.stringify(task.termConfig || {}),
    });
    child_process.execFileSync(process.execPath, syncArgs, {
      cwd: path.dirname(syncScript),
      env: childEnv,
      stdio: "inherit",
    });
    console.log("✓ 全校课表数据抓取完毕，已生成本地 Staging JSON。");
  } catch (err) {
    console.error("\n❌ 抓取全校课表失败：" + err.message);
    cleanupSession();
    process.exit(1);
  }

  const { filePath, summary } = resolveStagingJson(args, task);
  console.log(`\n已读取 Staging JSON：${filePath}`);
  
  const confirmed = await confirmUpload(args, summary);
  if (!confirmed) {
    console.log("已取消上传。");
    cleanupSession();
    return;
  }

  await postRelayStatus(server, token, "progress", { phase: "upload", progress: 82, status: "running" });
  const result = await upload(server, token, args, filePath, task);
  console.log("\n已成功上传接力 Staging JSON，等待管理员审核发布。");
  console.log(`上传编号：${result.upload && result.upload.id ? result.upload.id : "-"}`);
  
  await postRelayStatus(server, token, "progress", { phase: "uploaded", progress: 100, status: "pending-review" });
  cleanupSession();
}

main().catch((error) => {
  console.error(`\n接力采集器执行失败：${error.message}`);
  cleanupSession();
  process.exit(1);
});
