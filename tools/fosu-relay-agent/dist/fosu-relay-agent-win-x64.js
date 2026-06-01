#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");

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

function readStagingJson(args, task) {
  const defaultPath = path.resolve(process.cwd(), "staging", `${args.term || task.term}-full.json`);
  const filePath = path.resolve(process.cwd(), args.file || args.input || defaultPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到 Staging JSON: ${filePath}\n请先在校园网电脑生成文件，或使用 --file=路径 指定。`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (containsSensitiveData(data)) {
    throw new Error("Staging JSON 中包含疑似密码、Cookie、ticket、session 或 token 字段，已停止上传。");
  }
  return { filePath, data };
}

function summarize(data) {
  const resources = data.resources || {};
  const classSchedules = Array.isArray(data.classSchedules) ? data.classSchedules : [];
  return {
    term: data.term || data.semester || "",
    releaseVersion: data.releaseVersion || data.version || "",
    generatedAt: data.generatedAt || data.updatedAt || "",
    classScheduleCount: classSchedules.length,
    teacherScheduleCount: Array.isArray(resources.teacherSchedules) ? resources.teacherSchedules.length : 0,
    classroomScheduleCount: Array.isArray(resources.classroomSchedules) ? resources.classroomSchedules.length : 0,
    courseScheduleCount: Array.isArray(resources.courseSchedules) ? resources.courseSchedules.length : 0,
    teacherCount: Array.isArray(resources.teachers) ? resources.teachers.length : 0,
    classroomCount: Array.isArray(resources.classrooms) ? resources.classrooms.length : 0,
    courseCount: Array.isArray(resources.courses) ? resources.courses.length : 0,
  };
}

async function confirmUpload(args, summary) {
  if (args.yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n将要上传的数据摘要：");
    console.log(`- 学期: ${summary.term || "-"}`);
    console.log(`- 行政班课表: ${summary.classScheduleCount}`);
    console.log(`- 教师课表: ${summary.teacherScheduleCount}`);
    console.log(`- 教室课表: ${summary.classroomScheduleCount}`);
    console.log(`- 课程课表: ${summary.courseScheduleCount}`);
    console.log(`- 教师数: ${summary.teacherCount}`);
    console.log(`- 教室数: ${summary.classroomCount}`);
    console.log(`- 课程数: ${summary.courseCount}`);
    console.log(`- 生成时间: ${summary.generatedAt || "-"}`);
    const answer = await rl.question("\n确认上传课程表公开数据且不包含个人密码？输入 yes 继续: ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function upload(server, token, args, data) {
  const payload = {
    token,
    uploaderNote: args.note || "",
    environment: [
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `hostname=${os.hostname()}`,
      `node=${process.version}`,
    ].join("; "),
    data,
  };
  const res = await fetchWithTimeout(`${server}/api/relay/staging/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-relay-token": token,
    },
    body: JSON.stringify(payload),
    timeoutMs: 120000,
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.success === false) {
    throw new Error(result.message || `接力上传失败: HTTP ${res.status}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertRequiredArgs(args);

  const server = normalizeServer(args.server);
  const token = String(args.token);
  console.log("佛课小表接力采集器");
  console.log(`服务器：${server}`);

  const task = await loadTask(server, token);
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
  if (!checks[0].ok || !checks[1].ok) {
    console.log("提示：接力端需要在校园网环境运行；不绕过验证码，不保存密码。");
  }

  const { filePath, data } = readStagingJson(args, task);
  const summary = summarize(data);
  console.log(`\n已读取 Staging JSON：${filePath}`);
  const confirmed = await confirmUpload(args, summary);
  if (!confirmed) {
    console.log("已取消上传。");
    return;
  }

  const result = await upload(server, token, args, data);
  console.log("\n已上传，等待管理员审核发布。");
  console.log(`上传编号：${result.upload && result.upload.id ? result.upload.id : "-"}`);
}

main().catch((error) => {
  console.error(`\n接力采集器执行失败：${error.message}`);
  process.exit(1);
});
