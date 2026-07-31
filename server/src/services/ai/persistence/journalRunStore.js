/**
 * P5a WS3：一体化（file 后端）durable Run/Event/Trace store——
 * 持久卷上的 append-only journal + 原子 snapshot（design.md §8.2）。
 *
 * 布局（默认 root = FOSU_DATA_DIR 约定的 server/data/ai/run-store/，
 * 可用 FOSU_AGENT_RUN_STORE_PATH 或 options.root 重定向）：
 *   - journal.jsonl：append-only 操作日志。每条记录一行 JSON：
 *       {v, seq, at, kind, ...}，kind ∈ run_created / event_appended /
 *       run_updated / runs_pruned / trace_recorded / traces_cleared；
 *   - snapshot.json：writeJsonAtomic（tmp+rename）原子替换的压缩点，
 *     内容为 {version, createdAt, journalSeq, runs, traces}——
 *     即「原子 snapshot/pointer」：rename 本身就是指针切换。
 *
 * 崩溃安全：
 *   - 启动重放 = snapshot（seq ≤ journalSeq 跳过）+ journal 逐条 fold，
 *     fold 幂等（event 按 (runId, sequence) 去重、trace 按 traceId 去重），
 *     因此「snapshot 已写、journal 未截断」的崩溃窗口重放也只会应用一次；
 *   - journal 尾部半行（写中途崩溃）解析失败即跳过；
 *   - 截断（compaction）在 exclusiveFileLockService 排他文件锁内执行，
 *     复用仓库既有锁与原子写机制。journal 追加本身沿用 taskStore 的
 *     「文件模式单进程写入」约定，不承诺跨进程并发写同一 root。
 *
 * 保留策略（runRetentionPolicy 单一定义）：
 *   - Run/Event 保留窗口 ≥ 客户端断线恢复窗口（默认 30min，可配），
 *     窗口外数据在 compaction 时物理剔除（snapshot 只收窗口内文档 +
 *     journal 截断）；服务层内存投影的 expiresAtMs 用同一窗口计算，
 *     因此 prune→onRunsPruned→journal 记录的链路在窗口到达时即逻辑删除；
 *   - trace 沿用 manifest 口径（traceRetentionMs / maxTraceEntries）。
 *
 * 恢复语义：重放只恢复数据（Run 文档 + 事件流 + trace），不重复执行任何
 * 副作用；accepted/running Run 的「如实终止标记」由服务层 adopt 时追加
 * （RUN_EXECUTOR_LOST），store 不发明状态。
 */

const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const { readJsonFile, writeJsonAtomic } = require("../../../utils/jsonFileStore");
const { resolveRunRetentionMs, resolveTraceMaxEntries, resolveTraceRetentionMs } = require("./runRetentionPolicy");

function logStoreEvent(entry) {
  try {
    // 延迟加载，避免循环依赖；仅安全字段（操作名 + 错误码），不含任何负载。
    const { safeLog } = require("../../../utils/safeLogger");
    safeLog("agent-run-store-journal", entry);
  } catch (_) {
    // 可观测性不得影响持久化链路。
  }
}

const SNAPSHOT_VERSION = 1;
const MAX_EVENTS_PER_RUN = 80; // 与服务层事件环形缓冲一致

function defaultRoot() {
  return process.env.FOSU_AGENT_RUN_STORE_PATH
    || path.join(
      path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data")),
      "ai",
      "run-store"
    );
}

function createJournalRunStore(options = {}) {
  const root = path.resolve(options.root || defaultRoot());
  const journalPath = path.join(root, "journal.jsonl");
  const snapshotPath = path.join(root, "snapshot.json");
  const retentionMs = resolveRunRetentionMs(options.retentionMs);
  const traceRetentionMs = resolveTraceRetentionMs(options.traceRetentionMs, options.manifestTraceRetentionMs);
  const traceMaxEntries = resolveTraceMaxEntries(options.traceMaxEntries, options.manifestTraceMaxEntries);
  const compactAfterRecords = Math.max(16, Number(options.compactAfterRecords || 512) || 512);

  let state = null; // { runs: Map, traces: [], journalSeq, recordsSinceCompaction }

  function fold(record) {
    if (!record || typeof record.kind !== "string") return;
    if (record.kind === "run_created") {
      const doc = record.run;
      if (doc && typeof doc.runId === "string" && doc.runId) state.runs.set(doc.runId, doc);
      return;
    }
    if (record.kind === "event_appended") {
      const run = state.runs.get(String(record.runId || ""));
      if (!run) return; // 所属 Run 已淘汰 → 事件一并丢弃
      const event = record.event;
      if (event && Number.isInteger(event.sequence) && !run.events.some((item) => item && item.sequence === event.sequence)) {
        run.events.push(event);
        if (run.events.length > MAX_EVENTS_PER_RUN) run.events = run.events.slice(-MAX_EVENTS_PER_RUN);
      }
      run.sequence = Math.max(Number(run.sequence || 0), Number(record.sequence || 0));
      run.status = String(record.status || run.status);
      return;
    }
    if (record.kind === "run_updated") {
      const run = state.runs.get(String(record.runId || ""));
      if (!run) return;
      if (Object.prototype.hasOwnProperty.call(record, "status")) run.status = String(record.status || run.status);
      if (Object.prototype.hasOwnProperty.call(record, "result")) run.result = record.result || null;
      if (Object.prototype.hasOwnProperty.call(record, "cancelled")) run.cancelled = record.cancelled === true;
      if (Object.prototype.hasOwnProperty.call(record, "expiresAtMs")) run.expiresAtMs = Number(record.expiresAtMs) || run.expiresAtMs;
      return;
    }
    if (record.kind === "runs_pruned") {
      (Array.isArray(record.runIds) ? record.runIds : []).forEach((runId) => state.runs.delete(String(runId || "")));
      return;
    }
    if (record.kind === "trace_recorded") {
      const trace = record.trace;
      if (!trace || !trace.traceId) return;
      if (state.traces.some((item) => item && item.traceId === trace.traceId)) return;
      state.traces.push(trace);
      return;
    }
    if (record.kind === "traces_cleared") {
      state.traces = [];
    }
  }

  function replay() {
    state = { runs: new Map(), traces: [], journalSeq: 0, recordsSinceCompaction: 0 };
    const snapshot = readJsonFile(snapshotPath, null);
    if (snapshot && snapshot.version === SNAPSHOT_VERSION) {
      (Array.isArray(snapshot.runs) ? snapshot.runs : []).forEach((doc) => {
        if (doc && typeof doc.runId === "string" && doc.runId) state.runs.set(doc.runId, doc);
      });
      state.traces = (Array.isArray(snapshot.traces) ? snapshot.traces : []).slice();
      state.journalSeq = Math.max(0, Number(snapshot.journalSeq || 0) || 0);
    }
    let text = "";
    try {
      text = fs.readFileSync(journalPath, "utf8");
    } catch (_) {
      // 无 journal = 首次启动
    }
    text.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let record = null;
      try {
        record = JSON.parse(trimmed);
      } catch (_) {
        return; // 崩溃截断的尾部半行：跳过，不阻断恢复
      }
      const seq = Number(record && record.seq || 0) || 0;
      if (seq <= state.journalSeq) return; // snapshot 已覆盖的历史
      fold(record);
      state.journalSeq = seq;
      state.recordsSinceCompaction += 1;
    });
  }

  function compact() {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const release = acquireExclusiveFileLock(journalPath, {
      codePrefix: "AGENT_RUN_STORE",
      waitMs: 2000,
      staleMs: 30_000,
    });
    try {
      const now = Date.now();
      const traceCutoff = now - traceRetentionMs;
      const runs = Array.from(state.runs.values()).filter((doc) => Number(doc && doc.expiresAtMs || 0) > now);
      const traces = state.traces
        .filter((trace) => {
          const at = Date.parse(trace && trace.recordedAt || "");
          return Number.isFinite(at) && at >= traceCutoff;
        })
        .slice(-traceMaxEntries);
      // 先原子落 snapshot（rename = pointer 切换），再截断 journal；
      // 中途崩溃 → 重放靠 seq 去重，语义安全（见文件头）。
      writeJsonAtomic(snapshotPath, {
        version: SNAPSHOT_VERSION,
        createdAt: new Date().toISOString(),
        journalSeq: state.journalSeq,
        runs,
        traces,
      });
      fs.writeFileSync(journalPath, "", "utf8");
      state.runs = new Map(runs.map((doc) => [doc.runId, doc]));
      state.traces = traces;
      state.recordsSinceCompaction = 0;
    } finally {
      release();
    }
  }

  function appendRecord(record) {
    try {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      state.journalSeq += 1;
      const line = JSON.stringify(Object.assign({ v: 1, seq: state.journalSeq, at: new Date().toISOString() }, record));
      fs.appendFileSync(journalPath, `${line}\n`, "utf8");
      state.recordsSinceCompaction += 1;
      if (state.recordsSinceCompaction >= compactAfterRecords) compact();
    } catch (error) {
      // 持久化失败（卷满 / 权限 / 锁超时）只记录：内存投影仍是在线事实源，
      // 不得让 journal I/O 击落 Run 执行链（与 pgRunStore 写失败降级同规）。
      logStoreEvent({ op: String(record && record.kind || "append"), code: String((error && error.code) || "UNKNOWN").slice(0, 80) });
      return;
    }
    fold(record);
  }

  replay();

  function hydrate() {
    // 每次从当前恢复态深拷贝：服务层 adopt 后会原地推进文档（追加中断标记
    // 等），不得污染 store 内恢复态；run service 与 trace recorder 各取所需。
    return {
      runs: Array.from(state.runs.values()).map((doc) => JSON.parse(JSON.stringify(doc))),
      traces: state.traces.map((trace) => JSON.parse(JSON.stringify(trace))),
    };
  }

  return {
    kind: "journal",
    retentionMs,
    terminalRetentionMs: retentionMs,
    onRunCreated(doc) {
      appendRecord({ kind: "run_created", run: JSON.parse(JSON.stringify(doc)) });
    },
    onEvent(runId, event, doc) {
      appendRecord({
        kind: "event_appended",
        runId: String(runId || ""),
        event: JSON.parse(JSON.stringify(event)),
        sequence: Number(doc && doc.sequence || 0) || 0,
        status: String(doc && doc.status || ""),
      });
    },
    onRunUpdated(doc) {
      appendRecord({
        kind: "run_updated",
        runId: String(doc && doc.runId || ""),
        status: String(doc && doc.status || ""),
        result: doc && doc.result !== undefined ? JSON.parse(JSON.stringify(doc.result)) : null,
        cancelled: Boolean(doc && doc.cancelled),
        expiresAtMs: Number(doc && doc.expiresAtMs || 0) || 0,
      });
    },
    onRunsPruned(runIds) {
      const ids = (Array.isArray(runIds) ? runIds : []).map((id) => String(id || "")).filter(Boolean);
      if (!ids.length) return;
      appendRecord({ kind: "runs_pruned", runIds: ids });
    },
    onTrace(trace) {
      appendRecord({ kind: "trace_recorded", trace: JSON.parse(JSON.stringify(trace)) });
    },
    onTracesCleared() {
      appendRecord({ kind: "traces_cleared" });
    },
    hydrate,
    listEventsAfter(runId, afterSequence) {
      const run = state.runs.get(String(runId || ""));
      const after = Math.max(0, Number(afterSequence || 0) || 0);
      if (!run) return [];
      return run.events.filter((item) => item && item.sequence > after).map((item) => JSON.parse(JSON.stringify(item)));
    },
    resetForTests() {
      state = { runs: new Map(), traces: [], journalSeq: 0, recordsSinceCompaction: 0 };
      [journalPath, snapshotPath].forEach((filePath) => {
        try {
          fs.unlinkSync(filePath);
        } catch (_) {
          // 不存在即已清空
        }
      });
    },
    closeForTests() {},
    // 测试/诊断观察口：当前恢复态统计与手工压缩。
    statsForTests() {
      return {
        root,
        journalPath,
        snapshotPath,
        runCount: state.runs.size,
        traceCount: state.traces.length,
        journalSeq: state.journalSeq,
        recordsSinceCompaction: state.recordsSinceCompaction,
      };
    },
    compactForTests() {
      compact();
    },
  };
}

module.exports = Object.freeze({
  createJournalRunStore,
});
