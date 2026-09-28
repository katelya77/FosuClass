const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const { createFosuDirectClient } = require("../miniprogram/services/fosuDirectClient");

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const env = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.indexOf("=") < 0) return;
    const index = trimmed.indexOf("=");
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  });
  return env;
}

function createNodeTransport() {
  return {
    manualRedirect: true,
    request(spec) {
      return new Promise((resolve, reject) => {
        const url = new URL(spec.url);
        const lib = url.protocol === "http:" ? http : https;
        const headers = Object.assign({}, spec.header || {});
        const body = spec.data == null ? null : Buffer.from(String(spec.data));
        if (body && !headers["Content-Length"] && !headers["content-length"]) {
          headers["Content-Length"] = String(body.length);
        }
        const req = lib.request({
          protocol: url.protocol,
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: spec.method || "GET",
          headers,
          timeout: spec.timeout || 15000,
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const data = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode,
              header: res.headers,
              data: spec.responseType === "arraybuffer" ? data : data.toString("utf8"),
              transportPhase: "wx-request-success",
            });
          });
        });
        req.on("error", (error) => {
          const wrapped = new Error("DIRECT_NETWORK_ERROR");
          wrapped.code = "DIRECT_NETWORK_ERROR";
          wrapped.transportPhase = "wx-request-fail";
          wrapped.targetHost = url.hostname;
          wrapped.wxErrorCategory = /timeout/i.test(error && error.message || "") ? "timeout" : "connection";
          wrapped.wxErrMsgSafe = "request:fail";
          reject(wrapped);
        });
        req.on("timeout", () => {
          req.destroy(new Error("timeout"));
        });
        if (body) req.write(body);
        req.end();
      });
    },
  };
}

function line(stage, status, pass) {
  console.log(`${stage.padEnd(14)} ${String(status).padEnd(7)} ${pass ? "PASS" : "FAIL"}`);
}

async function main() {
  const envPath = path.join(__dirname, "../.env.e2e.local");
  const env = loadEnv(envPath);
  const studentId = env.FOSU_E2E_STUDENT_ID || "";
  const password = env.FOSU_E2E_PASSWORD || "";
  if (!studentId || !password) {
    console.log("CREDENTIALS     0       FAIL");
    process.exit(1);
  }
  const client = createFosuDirectClient({ transport: createNodeTransport(), debug: false });
  let result;
  try {
    result = await client.readTimetable({ studentId, password });
  } catch (error) {
    const diagnostics = client.getSafeDiagnostics();
    const last = diagnostics[diagnostics.length - 1] || {};
    line(String(error.stage || last.stage || "FAILED").toUpperCase(), error.statusCode || last.httpStatus || 0, false);
    console.log(JSON.stringify({
      errorCode: error.code || "",
      stage: error.stage || last.stage || "",
      transportPhase: error.transportPhase || last.transportPhase || "",
      targetHost: error.targetHost || last.targetHost || "",
      redirectHost: error.safeRedirect && error.safeRedirect.host || last.redirectHost || "",
      httpStatus: error.statusCode || last.httpStatus || 0,
    }));
    process.exit(2);
  }
  const buffer = Buffer.from(result.timetableBodyBase64, "base64");
  const { parsePersonalScheduleHtml } = require("../server/src/utils/personal-schedule-parser");
  const { createNormalizedPreviewFromImportedData } = require("../server/src/services/scheduleImportNormalizer");
  const html = buffer.toString("utf8");
  const courses = parsePersonalScheduleHtml(html, { source: "personal-xskb" });
  const preview = createNormalizedPreviewFromImportedData(courses.map((course) => ({
    courseName: course.courseName || "",
    weekText: course.weekText || "",
    weeks: course.weeks || [],
    weekday: course.weekday || course.weekDay || "",
    sections: course.sections || [],
    sectionText: course.sectionText || "",
    roomName: course.roomName || course.classroom || "",
    teacherName: course.teacherName || "",
  })), { semester: "当前学期", scheduleOwnership: "personal", source: "client-direct" });
  const course = courses.find((item) => item.courseName && item.weekday && Array.isArray(item.sections) && item.sections.length && Array.isArray(item.weeks) && item.weeks.length);
  const normalized = Boolean(course && preview && preview.buckets);
  const diagnostics = client.getSafeDiagnostics();
  function statusOf(stage) {
    const found = diagnostics.filter((item) => item.stage === stage && item.httpStatus);
    return found.length ? found[found.length - 1].httpStatus : 0;
  }
  line("BOOTSTRAP", statusOf("cas-bootstrap"), statusOf("cas-bootstrap") >= 300);
  line("AUTH_PAGE", statusOf("auth-page"), statusOf("auth-page") === 200);
  line("LOGIN_POST", statusOf("login-post"), statusOf("login-post") >= 300 && statusOf("login-post") < 400);
  line("CAS_CALLBACK", statusOf("cas-callback"), statusOf("cas-callback") > 0);
  line("XS_MAIN", statusOf("xs-main"), statusOf("xs-main") === 200);
  line("TIMETABLE", statusOf("timetable-fetch"), courses.length > 0);
  line("COURSES", courses.length, courses.length > 0);
  line("NORMALIZED", courses.length, normalized);
  if (!courses.length || !normalized) process.exit(3);
}

main().catch((error) => {
  console.log(JSON.stringify({ errorCode: error && error.code || "E2E_FAILED" }));
  process.exit(1);
});
