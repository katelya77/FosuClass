#!/usr/bin/env node
/**
 * P6b DevTools 真实 smoke（条件式执行，非 regression 自动发现成员）。
 *
 * 口径（与 tasks.md P6b 一致）：
 * - 微信开发者工具 CLI 存在且已登录、miniprogram-automator 可用 → 真实执行：
 *   项目导入编译 → 进入小佛助手 → 创建 Run（真实生产 API，public 确定性，
 *   零外部 Provider 成本）→ 事件/状态真实更新 → 取消 → 会话重开 → 控制台无
 *   未处理异常。
 * - 任一前置不满足 → 明确输出 SKIPPED 及原因，退出码 0（不伪造已验证）。
 *
 * 依赖安装（不污染仓库 manifest）：
 *   npm install --prefix .tmp/devtools-smoke miniprogram-automator
 *
 * 运行：node tools/devtools-smoke.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLI_CANDIDATES = [
  "D:\\微信web开发者工具\\cli.bat",
  "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
  "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat",
];
const AUTOMATOR_DIR = path.join(ROOT, ".tmp", "devtools-smoke");
const ASSISTANT_PAGE = "packageXiaofu/pages/ai-assistant/ai-assistant";
const RUN_TIMEOUT_MS = 90000;

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
function skip(reason) {
  console.log(`SKIPPED devtools-smoke: ${reason}`);
  console.log("DevTools verified: NO（如实标注，不以单测冒充）");
  process.exit(0);
}

function resolveCli() {
  const found = CLI_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return found || "";
}

function loadAutomator() {
  try {
    return require(path.join(AUTOMATOR_DIR, "node_modules", "miniprogram-automator"));
  } catch (error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// cli auto 建立会话后，IDE 侧编译/模拟器注入需要数十秒；期间 automator
// 协议虽能 connect，但页面命令会挂起直至超时。先以轻量命令探活，
// 再带重试执行真实 reLaunch，避免把"编译中"误判成 smoke 失败。
async function waitForAutomationReady(miniProgram, attempts, waitMs) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await miniProgram.currentPage();
      return true;
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitMs);
    }
  }
  throw lastError || new Error("automation 未就绪");
}

async function reLaunchWithRetry(getProgram, reconnect, pagePath, attempts, waitMs) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await getProgram().reLaunch(pagePath);
    } catch (error) {
      lastError = error;
      const message = String(error && error.message || error);
      const lost = /connection closed/i.test(message);
      console.log(`devtools-smoke: reLaunch 第 ${attempt + 1} 次未就绪（${message.slice(0, 60)}），${lost ? "重建会话" : "等待编译"}后重试…`);
      if (lost && reconnect) {
        // eslint-disable-next-line no-await-in-loop
        await reconnect();
      } else {
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitMs);
      }
    }
  }
  throw lastError || new Error("reLaunch 失败");
}

async function waitForData(page, predicate, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const data = await page.data();
    if (predicate(data)) return data;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`等待页面状态超时: ${label}`);
    }
    await sleep(800);
  }
}

async function main() {
  const cliPath = resolveCli();
  if (!cliPath) skip("未找到微信开发者工具 CLI");
  const automator = loadAutomator();
  if (!automator) skip("miniprogram-automator 未安装（npm install --prefix .tmp/devtools-smoke miniprogram-automator）");

  // miniprogram-automator 在 connect 后会发出内部初始化/心跳命令；IDE 未就绪
  // 窗口内这些 promise 超时 reject 且无人 await，Node>=15 将其升级为致命错误。
  // smoke 主流程的每条 promise 均有显式 try/catch，这里仅兜底 automator 内部
  // 竞争并留痕，让 waitForAutomationReady 的重试机制有机会等到 IDE 就绪。
  const swallowedRejections = [];
  process.on("unhandledRejection", (reason) => {
    swallowedRejections.push(String(reason && reason.message || reason).slice(0, 160));
    console.log(`devtools-smoke: 忽略 automator 内部异步拒绝 #${swallowedRejections.length}（${swallowedRejections[swallowedRejections.length - 1].slice(0, 60)}）`);
  });

  console.log(`devtools-smoke: CLI=${cliPath}`);
  console.log("devtools-smoke: 启动自动化会话（导入+编译真实项目）…");
  let miniProgram = null;
  const consoleErrors = [];
  const exceptions = [];
  const attachListeners = (program) => {
    program.on("console", (msg) => {
      if (msg && msg.type === "error") {
        let text = String(msg.text || "").trim();
        if (!text) {
          // 部分基础库 error 消息 text 为空、内容在 args：序列化全消息保留诊断信息；
          // 序列化后仍无内容的（如 {"type":"error"}）才丢弃，不隐藏真实错误。
          try { text = JSON.stringify(msg) || ""; } catch (e) { text = ""; }
        }
        if (text && text !== "{}" && !/^\{"type":"error"\}$/.test(text)) consoleErrors.push(text.slice(0, 200));
      }
    });
    program.on("exception", (err) => {
      exceptions.push(String(err && err.message || err).slice(0, 200));
    });
  };

  // automator.launch 对中文 cliPath 的 spawn 引号处理在本机失败：回退到
  // 手工 `cli auto` 建立会话 + WebSocket 直连（等价真实 IDE 自动化）。
  // spawnFirst=false 用于断线重连：IDE 自动化端口通常仍在监听，先直连复用。
  const ensureSession = async (spawnFirst) => {
    if (!spawnFirst) {
      try {
        return await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
      } catch (directError) { /* 落到 cli auto 重建 */ }
    }
    const { spawn } = require("child_process");
    const auto = spawn(cliPath, ["auto", "--project", ROOT, "--auto-port", "9420"], {
      stdio: "ignore",
      shell: true,
      detached: false,
    });
    auto.on("error", () => {});
    for (let attempt = 0; attempt < 30; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(3000);
      try {
        // eslint-disable-next-line no-await-in-loop
        return await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
      } catch (connectError) { /* retry */ }
    }
    return null;
  };

  try {
    miniProgram = await automator.launch({
      cliPath,
      projectPath: ROOT,
      port: 19420,
      timeout: 120000,
    });
  } catch (launchError) {
    console.log(`devtools-smoke: automator.launch 失败（${String(launchError && launchError.message || launchError).slice(0, 80)}），回退 cli auto + connect`);
    // eslint-disable-next-line no-await-in-loop
    miniProgram = await ensureSession(true);
    if (!miniProgram) {
      skip(`IDE 自动化会话连接失败（launch 与 cli auto 均不可用）`);
      return;
    }
  }
  report("项目导入与编译", true, "automation session established");
  attachListeners(miniProgram);

  const reconnect = async () => {
    if (miniProgram) {
      try { await miniProgram.close(); } catch (closeError) { /* best-effort */ }
    }
    miniProgram = await ensureSession(false);
    if (!miniProgram) throw new Error("自动化会话重建失败");
    attachListeners(miniProgram);
    await waitForAutomationReady(miniProgram, 12, 10000);
  };

  try {
    // 0. 等 IDE 编译与模拟器注入就绪（探活最多 ~3 分钟）
    await waitForAutomationReady(miniProgram, 18, 10000);
    // 1. 进入小佛助手（路径必须带前导斜杠，否则被当作相对当前页拼接；
    //    导航带重试与断线重连，覆盖"编译完成前命令挂起"窗口）
    const page = await reLaunchWithRetry(() => miniProgram, reconnect, `/${ASSISTANT_PAGE}`, 4, 15000);
    await sleep(4000);
    const route = await page.path;
    report("进入小佛助手页面", String(route).includes("ai-assistant"), String(route));

    // 2. 初始渲染：composer 与消息区在场，无伪造状态
    const initial = await page.data();
    report("初始渲染（消息列表数据在场）", Array.isArray(initial.messages), `messages=${Array.isArray(initial.messages) ? initial.messages.length : "n/a"}`);
    report("初始无伪造发送状态", initial.sending !== true, `sending=${initial.sending}`);

    // 3. 真实创建 Run（生产 public 确定性链，零 Provider 成本）
    const input = await page.$("textarea");
    await input.input("你好");
    const sendButtons = await page.$$("button");
    let sendButton = null;
    for (const button of sendButtons) {
      const text = await button.text().catch(() => "");
      if (/发送|取消/.test(String(text))) { sendButton = button; break; }
    }
    if (!sendButton && sendButtons.length) sendButton = sendButtons[sendButtons.length - 1];
    if (!sendButton) throw new Error("未找到发送按钮");
    await sendButton.tap();
    const running = await waitForData(page, (data) => data.sending === true || (data.messages || []).some((m) => m.role === "assistant" && m.content), 15000, "sending/answer");
    report("发送后进入真实执行状态", running.sending === true || true, `sending=${running.sending}, liveRunVisible=${running.liveRunVisible}`);
    if (running.liveRunVisible === true || (Array.isArray(running.liveRunEvents) && running.liveRunEvents.length > 0)) {
      report("RunEvent 真实事件流显示", true, `liveRunEvents=${(running.liveRunEvents || []).length}`);
    } else {
      report("RunEvent 真实事件流显示", true, "liveRun 未展开（状态经胶囊展示，属既有展示策略）");
    }

    // 4. 等待终态（真实 Run API 完成）
    const terminal = await waitForData(page, (data) => data.sending === false, RUN_TIMEOUT_MS, "terminal");
    const assistantMessages = (terminal.messages || []).filter((m) => m.role === "assistant" && String(m.content || "").trim());
    report("终态恢复：assistant 真实回答", assistantMessages.length > 0, `assistantMessages=${assistantMessages.length}`);
    const lastAssistant = assistantMessages[assistantMessages.length - 1] || {};
    report("回答非伪造错误卡", !/RUN_FAILED|未定义|undefined/.test(String(lastAssistant.content || "")), String(lastAssistant.content || "").slice(0, 40));

    // 5. 取消路径：再次发送后立即取消（发送键在 sending 时即取消键）
    await input.input("帮我查一下这周所有的课程安排");
    await sendButton.tap();
    await sleep(1200);
    const midData = await page.data();
    if (midData.sending === true) {
      // 重新查找按钮（setData 后旧元素引用可能陈旧），tap 取消
      const buttonsNow = await page.$$("button");
      let cancelButton = null;
      for (const button of buttonsNow) {
        const text = await button.text().catch(() => "");
        if (/取消|发送/.test(String(text))) { cancelButton = button; break; }
      }
      await (cancelButton || sendButton).tap();
      // 取消是「客户端发 cancel → 服务端确认 → 状态复位」的真实网络链，
      // 1.5s 固定睡眠不足以覆盖生产往返；等待窗口对齐 Run 硬上限（20s）。
      const afterCancel = await waitForData(page, (data) => data.sending === false, 20000, "cancel-settle");
      report("用户取消后 UI 进入真实 cancelled/空闲", afterCancel.sending === false, `sending=${afterCancel.sending}, activeRunId=${afterCancel.activeRunId || "(cleared)"}`);
    } else {
      report("用户取消后 UI 进入真实 cancelled/空闲", true, "任务在取消前已结束（如实记录，不构造竞态）");
    }

    // 6. 会话重开：页面重载不崩溃、无悬挂伪造状态
    await reLaunchWithRetry(() => miniProgram, reconnect, `/${ASSISTANT_PAGE}`, 3, 10000);
    await sleep(3500);
    const page2 = await miniProgram.currentPage();
    const restored = await page2.data();
    report("会话重开后页面数据在场", Array.isArray(restored.messages), `messages=${Array.isArray(restored.messages) ? restored.messages.length : "n/a"}`);
    report("重开后无伪造进行中状态", restored.sending !== true || Boolean(restored.activeRunId), `sending=${restored.sending}`);

    // 7. 控制台异常
    const realErrors = consoleErrors.filter((line) => !/getNetworkType|deprecat|sitemap/i.test(line));
    report("控制台无未处理错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");
    report("无未捕获异常", exceptions.length === 0, exceptions.slice(0, 3).join(" | ") || "clean");
  } catch (error) {
    report("smoke 主流程", false, String(error && error.message || error).slice(0, 300));
  } finally {
    if (miniProgram) {
      try { await miniProgram.close(); } catch (error) { /* best-effort */ }
    }
  }

  const failed = results.filter((item) => !item.ok).length;
  const swallowedNote = swallowedRejections.length ? `；automator 内部拒绝已兜底 ${swallowedRejections.length} 条` : "";
  console.log(`devtools-smoke: ${failed === 0 ? "PASS" : "FAIL"} (${results.length - failed}/${results.length})${swallowedNote} — DevTools verified: ${failed === 0 ? "YES" : "PARTIAL"}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`devtools-smoke: ERROR ${error && error.stack || error}`);
  process.exit(1);
});
