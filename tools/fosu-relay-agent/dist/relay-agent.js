#!/usr/bin/env node

// relay-agent.js
var fs = require("fs");
var os = require("os");
var path = require("path");
var readline = require("readline/promises");
var SECRET_KEY_PATTERN = /(studentId|student_id|password|passwd|pwd|cookie|ticket|execution|session|token|authorization|jsessionid|captcha)/i;
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
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8e3);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}
async function checkUrl(label, url) {
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", timeoutMs: 8e3 });
    return {
      label,
      ok: res.status > 0 && res.status < 500,
      status: res.status,
      duration: Date.now() - startedAt
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      duration: Date.now() - startedAt,
      error: error.message
    };
  }
}
async function loadTask(server, token) {
  const res = await fetchWithTimeout(`${server}/api/relay/tasks/${encodeURIComponent(token)}`, {
    timeoutMs: 12e3
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || `\u63A5\u529B\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25: HTTP ${res.status}`);
  }
  return data.task;
}
function containsSensitiveData(value) {
  if (value === void 0 || value === null) return false;
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
    throw new Error(`\u672A\u627E\u5230 Staging JSON: ${filePath}
\u8BF7\u5148\u5728\u6821\u56ED\u7F51\u7535\u8111\u751F\u6210\u6587\u4EF6\uFF0C\u6216\u4F7F\u7528 --file=\u8DEF\u5F84 \u6307\u5B9A\u3002`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (containsSensitiveData(data)) {
    throw new Error("Staging JSON \u4E2D\u5305\u542B\u7591\u4F3C\u5BC6\u7801\u3001Cookie\u3001ticket\u3001session \u6216 token \u5B57\u6BB5\uFF0C\u5DF2\u505C\u6B62\u4E0A\u4F20\u3002");
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
    courseCount: Array.isArray(resources.courses) ? resources.courses.length : 0
  };
}
async function confirmUpload(args, summary) {
  if (args.yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n\u5C06\u8981\u4E0A\u4F20\u7684\u6570\u636E\u6458\u8981\uFF1A");
    console.log(`- \u5B66\u671F: ${summary.term || "-"}`);
    console.log(`- \u884C\u653F\u73ED\u8BFE\u8868: ${summary.classScheduleCount}`);
    console.log(`- \u6559\u5E08\u8BFE\u8868: ${summary.teacherScheduleCount}`);
    console.log(`- \u6559\u5BA4\u8BFE\u8868: ${summary.classroomScheduleCount}`);
    console.log(`- \u8BFE\u7A0B\u8BFE\u8868: ${summary.courseScheduleCount}`);
    console.log(`- \u6559\u5E08\u6570: ${summary.teacherCount}`);
    console.log(`- \u6559\u5BA4\u6570: ${summary.classroomCount}`);
    console.log(`- \u8BFE\u7A0B\u6570: ${summary.courseCount}`);
    console.log(`- \u751F\u6210\u65F6\u95F4: ${summary.generatedAt || "-"}`);
    const answer = await rl.question("\n\u786E\u8BA4\u4E0A\u4F20\u8BFE\u7A0B\u8868\u516C\u5F00\u6570\u636E\u4E14\u4E0D\u5305\u542B\u4E2A\u4EBA\u5BC6\u7801\uFF1F\u8F93\u5165 yes \u7EE7\u7EED: ");
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
      `node=${process.version}`
    ].join("; "),
    data
  };
  const res = await fetchWithTimeout(`${server}/api/relay/staging/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-relay-token": token
    },
    body: JSON.stringify(payload),
    timeoutMs: 12e4
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.success === false) {
    throw new Error(result.message || `\u63A5\u529B\u4E0A\u4F20\u5931\u8D25: HTTP ${res.status}`);
  }
  return result;
}
function cleanupSession() {
  try {
    const paths = [
      path.resolve(process.cwd(), ".session", "session.json"),
      path.resolve(__dirname, ".session", "session.json")
    ];
    paths.forEach((p) => {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    });
    console.log("\u{1F9F9} \u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\u5DF2\u5B89\u5168\u6E05\u7406\u3002");
  } catch (e) {
    console.warn("\u26A0\uFE0F \u6E05\u7406\u767B\u5F55\u4F1A\u8BDD\u6587\u4EF6\u5931\u8D25: " + e.message);
  }
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  let config = {};
  const configPath = path.resolve(process.cwd(), "config.json");
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
    }
  }
  let token = args.token || config.token;
  let server = args.server || config.server || "https://class.katelya.eu.org";
  if (!token) {
    console.log("\u4F5B\u8BFE\u5C0F\u8868\u63A5\u529B\u91C7\u96C6\u5668 - \u521D\u59CB\u5316\u914D\u7F6E");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const serverInput = await rl.question("\u8BF7\u8F93\u5165/\u786E\u8BA4\u540E\u53F0\u670D\u52A1\u5668 URL (\u9ED8\u8BA4 https://class.katelya.eu.org): ");
      if (serverInput.trim()) {
        server = serverInput.trim();
      }
      const tokenInput = await rl.question("\u8BF7\u8F93\u5165\u60A8\u7684\u63A5\u529B Token (\u5FC5\u586B): ");
      token = tokenInput.trim();
      if (!token) {
        console.error("\u274C \u5FC5\u987B\u8F93\u5165\u63A5\u529B Token \u624D\u80FD\u7EE7\u7EED\u8FD0\u884C\u3002");
        process.exit(1);
      }
      fs.writeFileSync(configPath, JSON.stringify({ server, token }, null, 2), "utf-8");
      console.log(`\u2705 \u63A5\u529B\u914D\u7F6E\u5DF2\u4FDD\u5B58\u5230 config.json`);
    } finally {
      rl.close();
    }
  }
  server = normalizeServer(server);
  token = String(token);
  console.log("\n\u4F5B\u8BFE\u5C0F\u8868\u63A5\u529B\u91C7\u96C6\u5668");
  console.log(`\u670D\u52A1\u5668\uFF1A${server}`);
  const task = await loadTask(server, token);
  console.log(`\u5F53\u524D\u4EFB\u52A1\uFF1A${task.term} ${task.description || "\u5168\u6821\u8BFE\u8868\u91C7\u96C6"}`);
  console.log(`\u4EFB\u52A1\u6709\u6548\u671F\uFF1A${task.expiresAt}`);
  console.log("\n\u7F51\u7EDC\u68C0\u6D4B\uFF1A");
  const checks = await Promise.all([
    checkUrl("100.fosu.edu.cn", "https://100.fosu.edu.cn"),
    checkUrl("authserver.fosu.edu.cn", "https://authserver.fosu.edu.cn"),
    checkUrl(new URL(server).hostname, `${server}/api/health`)
  ]);
  checks.forEach((item) => {
    console.log(`- ${item.label}: ${item.ok ? "\u53EF\u8BBF\u95EE" : "\u4E0D\u53EF\u8BBF\u95EE"} (${item.status || item.error || "no response"}, ${item.duration}ms)`);
  });
  if (!checks[0].ok || !checks[1].ok) {
    console.log("\n\u26A0\uFE0F \u8B66\u544A\uFF1A\u65E0\u6CD5\u6B63\u5E38\u8BBF\u95EE\u5B66\u6821\u6559\u52A1\u7F51\uFF0C\u8BF7\u786E\u4FDD\u60A8\u5F53\u524D\u5DF2\u8FDE\u63A5\u4F5B\u5927\u6821\u56ED\u7F51\u6216\u5DF2\u542F\u52A8\u5B66\u6821 VPN \u62E8\u53F7\u3002");
  }
  console.log("\n================ [\u6B65\u9AA4 1\uFF1A\u767B\u5F55\u6559\u52A1\u7CFB\u7EDF] ================");
  console.log("\u5373\u5C06\u4E3A\u60A8\u542F\u52A8\u7CFB\u7EDF\u6D4F\u89C8\u5668\u767B\u5F55\u6559\u52A1\u7CFB\u7EDF\uFF0C\u8BF7\u5728\u5F39\u51FA\u7684\u6D4F\u89C8\u5668\u4E2D\u624B\u52A8\u767B\u5F55\u3002");
  const child_process = require("child_process");
  try {
    child_process.execSync("node login.js", { stdio: "inherit" });
    console.log("\u2713 \u767B\u5F55\u6210\u529F\u5E76\u5DF2\u4FDD\u5B58\u672C\u5730\u4F1A\u8BDD\u3002");
  } catch (err) {
    console.error("\n\u274C \u767B\u5F55\u6559\u52A1\u7CFB\u7EDF\u5931\u8D25\uFF1A" + err.message);
    cleanupSession();
    process.exit(1);
  }
  console.log("\n================ [\u6B65\u9AA4 2\uFF1A\u6293\u53D6\u5168\u6821\u8BFE\u8868\u6570\u636E] ================");
  console.log(`\u5F00\u59CB\u6293\u53D6\u5168\u6821\u8BFE\u7A0B\u6570\u636E\uFF08\u5B66\u671F\uFF1A${task.term}\uFF09\uFF0C\u6B64\u8FC7\u7A0B\u7EA6\u9700\u8981 10 \u5206\u949F\u3002\u671F\u95F4\u8BF7\u4E0D\u8981\u5173\u95ED\u6D4F\u89C8\u5668\u7A97\u53E3\u3002`);
  try {
    child_process.execSync(`node sync.js local-campus --term=${task.term}`, { stdio: "inherit" });
    console.log("\u2713 \u5168\u6821\u8BFE\u8868\u6570\u636E\u6293\u53D6\u5B8C\u6BD5\uFF0C\u5DF2\u751F\u6210\u672C\u5730 Staging JSON\u3002");
  } catch (err) {
    console.error("\n\u274C \u6293\u53D6\u5168\u6821\u8BFE\u8868\u5931\u8D25\uFF1A" + err.message);
    cleanupSession();
    process.exit(1);
  }
  const { filePath, data } = readStagingJson(args, task);
  const summary = summarize(data);
  console.log(`
\u5DF2\u8BFB\u53D6 Staging JSON\uFF1A${filePath}`);
  const confirmed = await confirmUpload(args, summary);
  if (!confirmed) {
    console.log("\u5DF2\u53D6\u6D88\u4E0A\u4F20\u3002");
    cleanupSession();
    return;
  }
  const result = await upload(server, token, args, data);
  console.log("\n\u5DF2\u6210\u529F\u4E0A\u4F20\u63A5\u529B Staging JSON\uFF0C\u7B49\u5F85\u7BA1\u7406\u5458\u5BA1\u6838\u53D1\u5E03\u3002");
  console.log(`\u4E0A\u4F20\u7F16\u53F7\uFF1A${result.upload && result.upload.id ? result.upload.id : "-"}`);
  cleanupSession();
}
main().catch((error) => {
  console.error(`
\u63A5\u529B\u91C7\u96C6\u5668\u6267\u884C\u5931\u8D25\uFF1A${error.message}`);
  cleanupSession();
  process.exit(1);
});
