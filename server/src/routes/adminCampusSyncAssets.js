const fs = require("fs");
const path = require("path");

const CAMPUS_SYNC_TREND_SOURCE = fs.readFileSync(path.join(__dirname, "../services/campusSyncTrendChart.js"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/module\.exports[\s\S]*$/, "");

const CAMPUS_SYNC_STYLES = `
    #section-campus-sync { display: none; gap: 12px; min-width: 0; }
    #section-campus-sync.active { display: grid; }
    #section-campus-sync .cs-hero, #section-campus-sync .cs-card { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 12px 14px; }
    #section-campus-sync h2 { margin: 0; font-size: 20px; line-height: 1.25; }
    #section-campus-sync h3 { margin: 0 0 8px; font-size: 14px; }
    #section-campus-sync .cs-kicker { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
    #section-campus-sync .cs-toolbar, #section-campus-sync .cs-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    #section-campus-sync .cs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    #section-campus-sync .cs-stat { padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-muted); }
    #section-campus-sync .cs-stat b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
    #section-campus-sync .cs-stat span, #section-campus-sync .cs-muted { color: var(--text-muted); font-size: 12px; }
    #section-campus-sync .cs-badge { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; background: var(--surface-muted); color: var(--text-secondary); font-size: 12px; }
    #section-campus-sync .cs-badge.ok { background: var(--success-soft); color: var(--success); }
    #section-campus-sync .cs-badge.warn { background: var(--warning-soft); color: var(--warning); }
    #section-campus-sync .cs-badge.danger { background: var(--danger-soft); color: var(--danger); }
    #section-campus-sync table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #section-campus-sync th, #section-campus-sync td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
    #section-campus-sync .cs-table-wrap { overflow: auto; max-height: 420px; }
    #section-campus-sync .cs-chart-wrap { position: relative; }
    #section-campus-sync .cs-chart { width: 100%; height: auto; display: block; }
    #section-campus-sync .cs-legend { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 8px 0; }
    #section-campus-sync .cs-legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    #section-campus-sync .cs-swatch { width: 18px; height: 0; border-top-width: 3px; border-top-style: solid; }
    #section-campus-sync .cs-tip { position: absolute; z-index: 2; min-width: 140px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-primary); font-size: 12px; line-height: 1.45; white-space: pre-line; pointer-events: none; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12); }
    #section-campus-sync .cs-policy { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 10px; }
    #section-campus-sync .cs-policy label, #section-campus-sync .cs-policy div { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    #section-campus-sync .cs-policy input { height: 32px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-primary); padding: 0 8px; }
    #section-campus-sync .cs-pipeline { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 8px; }
    #section-campus-sync .cs-error, #section-campus-sync .cs-empty { color: var(--text-muted); font-size: 13px; }
    #section-campus-sync .cs-banner { border: 1px solid var(--warning); border-radius: var(--radius); background: var(--warning-soft); color: var(--text-primary); padding: 12px 14px; }
    #section-campus-sync .cs-banner b { display: block; margin-bottom: 4px; }
    #section-campus-sync .cs-help { color: var(--text-muted); font-size: 11px; line-height: 1.4; }
    #section-campus-sync button:disabled { opacity: 0.55; }
    @media (max-width: 860px) {
      #section-campus-sync .cs-pipeline { grid-template-columns: 1fr 1fr; }
    }
`;

const CAMPUS_SYNC_SECTION = `
      <section id="section-campus-sync" class="section">
        <div class="cs-hero">
          <div class="cs-toolbar" style="justify-content: space-between;">
            <div>
              <h2>个人课表同步</h2>
              <div class="cs-kicker">Personal Schedule Sync</div>
              <p class="cs-kicker">监控个人课表同步链路、任务队列、异常、安全事件与服务状态。</p>
              <div id="csRuntimeLine" class="cs-badge">● 正在读取服务状态</div>
            </div>
            <div class="cs-toolbar">
              <span id="csServiceBadge" class="cs-badge">服务：读取中</span>
              <span id="csSecurityBadge" class="cs-badge">安全：读取中</span>
              <button type="button" class="secondary" id="csRefreshBtn">刷新</button>
              <button type="button" class="secondary" id="csPauseBtn">暂停个人同步</button>
              <button type="button" class="secondary" id="csResumeBtn">恢复个人同步</button>
              <button type="button" class="secondary" id="csDiagnoseBtn">轻量诊断</button>
            </div>
          </div>
          <div id="csDiagnose" class="cs-muted"></div>
        </div>
        <div id="csMaintenanceBanner" class="cs-banner" hidden>
          <b>个人课表同步已暂停</b>
          <div>新的同步请求暂时不会进入队列。已经开始执行的任务允许正常结束。</div>
        </div>
        <div id="csPolicyStorage" class="cs-banner" hidden>策略存储异常</div>
        <div id="csLoading" class="cs-card cs-muted">正在读取服务状态…</div>
        <div id="csRefreshed" class="cs-muted"></div>
        <div id="csError" class="cs-card cs-error" hidden></div>
        <div class="cs-grid" id="csOverview"></div>
        <div class="cs-card" id="csObservationCard">
          <h3>过去 24 小时</h3>
          <div id="csObservation" class="cs-muted">正在加载运行观察…</div>
          <div id="csAdvice" class="cs-muted"></div>
        </div>
        <div class="cs-card">
          <div class="cs-toolbar" style="justify-content: space-between;">
            <h3>请求趋势</h3>
            <div class="cs-toolbar" id="csRanges">
              <button type="button" class="secondary" data-cs-range="1h">1 小时</button>
              <button type="button" class="secondary" data-cs-range="24h">24 小时</button>
              <button type="button" class="secondary" data-cs-range="7d">7 天</button>
              <button type="button" class="secondary" data-cs-range="30d">30 天</button>
            </div>
          </div>
          <div id="csChartLegend" class="cs-legend"></div>
          <div class="cs-muted">时间：北京时间</div>
          <div class="cs-chart-wrap">
            <svg id="csChart" class="cs-chart" viewBox="0 0 720 260" role="img" aria-label="同步请求趋势"></svg>
            <div id="csChartTip" class="cs-tip" hidden></div>
          </div>
          <div id="csChartStatus" class="cs-empty">正在加载趋势…</div>
          <div id="csChartEmpty" class="cs-empty" hidden>当前时间范围暂无同步请求</div>
        </div>
        <div class="cs-card" id="csPolicyCard">
          <h3>同步策略</h3>
          <div class="cs-policy">
            <div><span>单用户并发</span><b>1（固定）</b></div>
            <label>短周期最多同步<input id="csRateLimit" type="number" min="1" max="20" step="1"><span class="cs-help">限制单个用户短时间连续触发同步。</span></label>
            <label>周期（秒）<input id="csRateWindow" type="number" min="60" max="3600" step="1"></label>
            <label>每日最多同步<input id="csDailyLimit" type="number" min="1" max="50" step="1"><span class="cs-help">按北京时间自然日计算。</span></label>
            <div class="cs-muted">北京时间每日 00:00 重置</div>
            <label>全局进行中任务上限<input id="csGlobalCap" type="number" min="1" max="30" step="1"><span class="cs-help">限制同时排队和处理的 Route 2 任务数量。</span></label>
            <div><span>WYZ Worker</span><b>1（固定）</b></div>
            <div><span>任务 TTL</span><b id="csJobTtl">90s（只读）</b></div>
          </div>
          <div class="cs-toolbar">
            <button type="button" id="csPolicySave">保存修改</button>
            <button type="button" class="secondary" id="csPolicyCancel">放弃修改</button>
            <button type="button" class="secondary" id="csPolicyReset">恢复默认值</button>
          </div>
          <div id="csPolicyMeta" class="cs-muted"></div>
          <div id="csUsage" class="cs-muted"></div>
        </div>
        <div class="cs-card">
          <h3>链路状态</h3>
          <div id="csPipeline" class="cs-pipeline"></div>
        </div>
        <div class="cs-grid">
          <div class="cs-card"><h3>队列</h3><div id="csQueue"></div></div>
          <div class="cs-card"><h3>错误分析</h3><div id="csErrors" class="cs-table-wrap"></div></div>
        </div>
        <div class="cs-card">
          <div class="cs-toolbar" style="justify-content: space-between;">
            <h3>最近同步事件</h3>
            <div class="cs-toolbar">
              <input id="csStatusFilter" placeholder="状态" aria-label="按状态过滤">
              <input id="csCodeFilter" placeholder="errorCode" aria-label="按错误码过滤">
              <button type="button" class="secondary" id="csEventsBtn">刷新事件</button>
              <button type="button" class="secondary" id="csEventsMore">下一页</button>
            </div>
          </div>
          <div id="csEventsStatus" class="cs-empty">正在加载最近事件…</div>
          <div id="csEvents" class="cs-table-wrap"></div>
        </div>
        <div class="cs-grid">
          <div class="cs-card"><h3>安全与临时封禁</h3><div id="csSecurityStatus" class="cs-empty">正在加载安全状态…</div><div id="csSecurity" class="cs-table-wrap"></div></div>
          <div class="cs-card"><h3>运行契约</h3><div id="csConfigStatus" class="cs-empty">正在加载运行契约…</div><div id="csConfig"></div></div>
        </div>
      </section>
`;

const CAMPUS_SYNC_SCRIPT = `
      (function () {
        var cs = { range: "24h", cursor: "", timers: {}, control: null, policyDirty: false, serverRevision: "", trendGeneration: 0, inflight: {}, criticalReady: false };
        function csNode(id) { return document.getElementById(id); }
        function csActive() {
          var section = csNode("section-campus-sync");
          return section && section.classList.contains("active") && document.visibilityState !== "hidden";
        }
        function csBadge(text, kind) {
          var node = csNode("csSecurityBadge");
          if (!node) return;
          node.className = "cs-badge " + (kind || "");
          node.textContent = text;
        }
        function csText(value) { return value == null || value === "" ? "-" : String(value); }
${CAMPUS_SYNC_TREND_SOURCE}
        function csDraw(points) {
          var svg = csNode("csChart");
          var empty = csNode("csChartEmpty");
          var legend = csNode("csChartLegend");
          var tip = csNode("csChartTip");
          if (!svg || typeof buildCampusSyncTrend !== "function") return;
          var model = buildCampusSyncTrend(points || [], cs.range || "24h");
          cs.trendModel = model;
          svg.setAttribute("viewBox", model.viewBox);
          if (model.empty) {
            svg.innerHTML = "";
            if (empty) empty.hidden = false;
            if (legend) legend.innerHTML = "";
            if (tip) tip.hidden = true;
            return;
          }
          if (empty) empty.hidden = true;
          svg.innerHTML = model.svg;
          if (legend) {
            legend.innerHTML = model.legend.map(function (item) {
              var style = item.dash ? "border-top-style:dashed;" : "";
              return "<span><i class='cs-swatch' style='border-top-color:" + item.color + ";" + style + "'></i>" + item.label + "</span>";
            }).join("");
          }
        }
        function csShowTrendTip(index, event) {
          var tip = csNode("csChartTip");
          var model = cs.trendModel;
          if (!tip || !model || !model.points || !model.points[index]) return;
          var point = model.points[index];
          var lines = [point.time || ""];
          (model.legend || []).forEach(function (item) {
            lines.push(item.label + "：" + (point.values[item.key] || 0));
          });
          tip.hidden = false;
          tip.textContent = lines.filter(Boolean).join("\\n");
          var wrap = tip.parentNode;
          if (!wrap || !event) return;
          var bounds = wrap.getBoundingClientRect();
          tip.style.left = Math.max(8, event.clientX - bounds.left + 12) + "px";
          tip.style.top = Math.max(8, event.clientY - bounds.top + 12) + "px";
        }
        function csCards(overview) {
          var host = csNode("csOverview");
          if (!host || !overview) return;
          var day = overview.window24h || {};
          var perf = overview.performance || {};
          var agent = overview.agent || {};
          var queue = overview.queue || {};
          var statusLabel = { normal: "正常", busy: "繁忙", degraded: "降级", maintenance: "已暂停", offline: "节点离线" }[overview.status] || overview.status || "-";
          var cards = [
            ["同步服务", statusLabel],
            ["校内同步节点", agent.online ? "在线" : "离线"],
            ["心跳年龄", agent.lastHeartbeatAgeMs == null ? "-" : Math.round(agent.lastHeartbeatAgeMs / 1000) + "s"],
            ["Queue / Processing", (queue.queued || 0) + " / " + (queue.processing || 0)],
            ["Active / Cap", (queue.active || 0) + " / " + (queue.cap || 0)],
            ["近24h 请求", day.attempts || 0],
            ["成功 / 失败", (day.success || 0) + " / " + (day.failed || 0)],
            ["成功率", (day.successRate || 0) + "%"],
            ["限流", day.rateLimited || 0],
            ["Avg / P95", (perf.avgDurationMs || 0) + " / " + (perf.p95DurationMs || 0) + " ms"]
          ];
          host.innerHTML = cards.map(function (card) {
            return "<div class='cs-stat'><span>" + card[0] + "</span><b>" + card[1] + "</b></div>";
          }).join("");
          var posture = overview.securityPosture || "normal";
          var label = { normal: "安全：正常", watch: "安全：观察", rate_limit: "安全：限流", circuit_open: "安全：熔断" }[posture] || ("安全：" + posture);
          csBadge(label, posture === "circuit_open" || posture === "rate_limit" ? "danger" : (posture === "normal" ? "ok" : "warn"));
          csSyncRuntime(overview);
        }
        function csSyncRuntime(overview) {
          var paused = !!(overview && overview.maintenance && overview.maintenance.paused);
          var status = overview && overview.status || "";
          var banner = csNode("csMaintenanceBanner");
          if (banner) banner.hidden = !paused;
          var line = csNode("csRuntimeLine");
          var service = csNode("csServiceBadge");
          var running = !paused && (status === "normal" || status === "");
          var serviceText = paused ? "已暂停" : status === "offline" ? "离线" : status === "degraded" ? "降级" : status === "busy" ? "繁忙" : "运行中";
          if (service) {
            service.className = "cs-badge " + (paused || status === "offline" ? "danger" : running ? "ok" : "warn");
            service.textContent = "服务：" + serviceText;
          }
          if (line) {
            line.className = "cs-badge " + (paused ? "danger" : running ? "ok" : "warn");
            line.textContent = paused ? "● 个人课表同步已暂停" : running ? "● 个人课表同步运行中" : "● 个人课表同步" + serviceText;
          }
          var pauseBtn = csNode("csPauseBtn");
          var resumeBtn = csNode("csResumeBtn");
          if (pauseBtn && pauseBtn.dataset.busy !== "1") {
            pauseBtn.disabled = paused;
            pauseBtn.textContent = paused ? "已暂停" : "暂停个人同步";
          }
          if (resumeBtn && resumeBtn.dataset.busy !== "1") {
            resumeBtn.disabled = !paused;
            resumeBtn.textContent = "恢复个人同步";
            resumeBtn.classList.toggle("secondary", !paused);
          }
        }
        function csRenderPipeline(list) {
          var host = csNode("csPipeline");
          if (!host) return;
          var statusText = { ok: "正常", online: "在线", offline: "离线", maintenance: "维护", inferred: "最近真实任务正常", unknown: "暂无近期真实任务", degraded: "异常" };
          host.innerHTML = (list || []).map(function (item) {
            var state = item.schoolNote || statusText[item.status] || item.status;
            return "<div class='cs-stat'><b>" + csText(item.label) + "</b><span>" + csText(item.technical) + " · " + csText(state) + "</span></div>";
          }).join("");
        }
        function csRenderQueue(queue) {
          var host = csNode("csQueue");
          if (!host || !queue) return;
          host.innerHTML = "<div class='cs-muted'>queued " + (queue.queued || 0) + " · processing " + (queue.processing || 0) +
            " · cap " + (queue.cap || 0) + "<br>oldest " + (queue.oldestQueuedMs || 0) + " ms · worker " + (queue.activeWorker || 0) +
            "<br>估算等待 " + (queue.estimatedWaitMs || 0) + " ms（仅供参考）</div>";
        }
        function csRenderErrors(errors, day) {
          var host = csNode("csErrors");
          if (!host) return;
          var codes = Object.keys(errors || {});
          if (!codes.length) { host.innerHTML = "<div class='cs-empty'>最近没有错误样本。</div>"; return; }
          var total = codes.reduce(function (sum, code) { return sum + Number(errors[code] || 0); }, 0) || 1;
          host.innerHTML = "<table><tbody>" + codes.map(function (code) {
            var count = Number(errors[code] || 0);
            return "<tr><td>" + code + "</td><td>" + count + "</td><td>" + Math.round(count / total * 100) + "%</td></tr>";
          }).join("") + "</tbody></table><div class='cs-muted'>系统失败率 " + ((day && day.systemFailureRate) || 0) + "% · 凭据失败率 " + ((day && day.credentialFailureRate) || 0) + "%</div>";
        }
        function csRenderEvents(payload) {
          var host = csNode("csEvents");
          if (!host) return;
          var rows = payload && payload.events || [];
          cs.cursor = payload && payload.nextCursor || "";
          if (!rows.length) { host.innerHTML = "<div class='cs-empty'>没有匹配的同步事件。</div>"; return; }
          host.innerHTML = "<table><thead><tr><th>时间</th><th>Job</th><th>Principal</th><th>状态</th><th>等待</th><th>耗时</th><th>课程数</th><th>重试</th><th>结果</th><th>来源</th><th>Request</th></tr></thead><tbody>" +
            rows.map(function (row) {
              return "<tr><td>" + new Date(row.t).toLocaleString() + "</td><td>" + csText(row.jobIdShort) + "</td><td>" + csText(row.principalHashPrefix) +
                "</td><td>" + csText(row.status) + "</td><td>" + (row.queueWaitMs || 0) + "</td><td>" + (row.durationMs || 0) +
                "</td><td>" + (row.courseCount || 0) + "</td><td>" + (row.retryCount || 0) + "</td><td>" + csText(row.resultCode) +
                "</td><td>" + csText(row.source) + "</td><td>" + csText(row.requestId) + "</td></tr>";
            }).join("") + "</tbody></table>";
        }
        function csRenderSecurity(security) {
          var host = csNode("csSecurity");
          if (!host) return;
          var recent = security && security.recent || [];
          var blocks = security && security.suspensions || [];
          var blockText = blocks.length ? blocks.map(function (item) { return item.principalHashPrefix; }).join(", ") : "无";
          host.innerHTML = "<div class='cs-muted'>当前临时封禁：" + blockText + "</div>" + (recent.length ? "<table><tbody>" + recent.map(function (item) {
            return "<tr><td>" + csText(item.reasonCode) + "</td><td>" + (item.count || 1) + "</td><td>" + csText(item.principalHashPrefix) + "</td><td>" + csText(item.anonymizedIp) + "</td></tr>";
          }).join("") + "</tbody></table>" : "<div class='cs-empty'>近端没有安全事件。</div>");
        }
        function csRenderConfig(config) {
          var host = csNode("csConfig");
          if (!host || !config) return;
          var secrets = config.secrets || {};
          host.innerHTML = "<div class='cs-muted'>并发 " + config.perUserConcurrency + " · 10分钟 " + config.rateLimit +
            " · 每日 " + config.dailyLimit + " · 全局 " + config.globalCap + "<br>TTL " + config.jobTtlSeconds + "s · 预览 " +
            config.previewRetentionSeconds + "s · 心跳 " + config.heartbeatIntervalMs + "ms<br>离线 TTL " + config.offlineTtlMs +
            "ms · Worker " + config.workerConcurrency + " · 熔断 " + ((config.circuit && config.circuit.state) || "-") +
            "<br>Token " + csText(secrets.campusAgentToken) + " · Signing " + csText(secrets.campusAgentSigningSecret) + "</div>";
        }
        function csCardStatus(id, text, failed) {
          var node = csNode(id);
          if (!node) return;
          node.hidden = !text;
          node.textContent = text || "";
          node.className = failed ? "cs-error" : "cs-empty";
        }
        function csSignal() {
          if (cs.control) cs.control.abort();
          cs.control = typeof AbortController === "function" ? new AbortController() : null;
          return cs.control ? cs.control.signal : undefined;
        }
        function csTrack(key, factory) {
          if (cs.inflight[key]) return cs.inflight[key];
          var promise = Promise.resolve().then(factory).finally(function () { delete cs.inflight[key]; });
          cs.inflight[key] = promise;
          return promise;
        }
        function csStamp() {
          var node = csNode("csRefreshed");
          if (node) node.textContent = "最后刷新：" + new Date().toLocaleTimeString("zh-CN", { hour12: false });
        }
        function csApplySnapshot(body) {
          var snap = body.snapshot || body;
          var service = snap.service || {};
          var overview = {
            status: service.status,
            maintenance: service.maintenance,
            agent: service.agent,
            queue: service.queue,
            securityPosture: service.securityPosture || "normal",
            window24h: cs.window24h || {},
            performance: cs.performance || {},
            pipeline: service.pipeline || []
          };
          cs.overview = overview;
          csCards(overview);
          csRenderPipeline(service.pipeline || []);
          csRenderQueue(service.queue);
          if (snap.policy) csFillPolicy(snap.policy);
          var loading = csNode("csLoading");
          if (loading) loading.hidden = true;
          var error = csNode("csError");
          if (error) error.hidden = true;
          cs.criticalReady = true;
          csRenderSafety(snap.queueSafety, snap.recommendation);
          csStamp();
        }
        function csRenderSafety(safety, advice) {
          var node = csNode("csAdvice");
          if (!node) return;
          var parts = [];
          if (advice && advice.label) parts.push("运行建议：" + advice.label);
          if (safety && safety.tailExceedsTtl) parts.push("当前全局任务上限可能导致队尾超过任务 TTL。");
          if (!parts.length) return;
          node.textContent = parts.join(" ");
        }
        function csRenderObservation(overview) {
          var host = csNode("csObservation");
          if (!host || !overview) return;
          var day = overview.window24h || {};
          var safety = overview.queueSafety || {};
          var advice = overview.recommendation || {};
          host.textContent = "成功率 " + (day.successRate || 0) + "% · P50 " + (day.p50DurationMs || 0) + " ms · P95 " + (day.p95DurationMs || 0) +
            " ms · 系统失败率 " + (day.systemFailureRate || 0) + "% · 凭据失败率 " + (day.credentialFailureRate || 0) +
            "% · 限流 " + (day.rateLimited || 0) + " · 最大队列 " + (day.maxQueued || 0) +
            " · 心跳年龄最大 " + (day.maxHeartbeatAgeMs || 0) + " ms · 最近成功 " + csWhen(overview.performance && overview.performance.lastSuccessAt);
          csRenderSafety(safety, advice);
        }
        function csInt(value) {
          var text = String(value == null ? "" : value).trim();
          if (!/^-?[0-9]+$/.test(text)) return null;
          var parsed = Number(text);
          return Number.isSafeInteger(parsed) ? parsed : null;
        }
        function csPolicyError(error) {
          var status = error && error.status;
          if (status === 401) return "权限已过期，请重新登录（HTTP 401）";
          if (status === 403) return "CSRF 校验失败，请刷新页面（HTTP 403）";
          if (status === 400) return "输入值不合法（HTTP 400）";
          if (status === 409) return (error && error.message) || "策略已在其他窗口被修改，请重新加载后再保存。";
          if (status === 503) return "策略文件暂时无法写入（HTTP 503）";
          return "服务器暂时不可用（HTTP " + (status || 0) + "）";
        }
        function csWhen(value) {
          if (!value) return "-";
          var date = new Date(value);
          if (Number.isNaN(date.getTime())) return "-";
          return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
        }
        function csFillPolicy(policy, force) {
          if (!policy) return;
          var previous = cs.serverRevision;
          cs.policy = policy;
          cs.serverPolicy = policy;
          var storage = csNode("csPolicyStorage");
          if (storage) {
            storage.hidden = policy.storageStatus !== "invalid";
            storage.textContent = "策略存储异常";
          }
          if (force) cs.policyDirty = false;
          if (!cs.policyDirty) cs.serverRevision = policy.revision || "";
          ["csRateLimit", "csRateWindow", "csDailyLimit", "csGlobalCap"].forEach(function (id, index) {
            var node = csNode(id);
            var key = ["rateLimit", "rateWindowSeconds", "dailyLimit", "globalActiveCap"][index];
            if (node && !cs.policyDirty && (force || document.activeElement !== node)) node.value = policy[key];
          });
          var ttl = csNode("csJobTtl");
          if (ttl) ttl.textContent = (policy.jobTtlSeconds || 90) + "s（只读）";
          var meta = csNode("csPolicyMeta");
          if (!meta) return;
          if (cs.policyDirty && previous && policy.revision && previous !== policy.revision) meta.textContent = "服务器策略已发生变化，请重新加载后再修改。";
          else if (cs.policyDirty) meta.textContent = "有未保存的修改";
          else meta.textContent = "当前来源：" + (policy.source === "runtime" ? "运行时策略" : "环境默认") +
            " · 最后修改：" + csWhen(policy.updatedAt) + " · 修改者：" + (policy.updatedBy || "-") +
            " · 服务器已应用值 " + policy.rateLimit + " / " + policy.rateWindowSeconds + "s / 每日 " + policy.dailyLimit + " / 全局 " + policy.globalActiveCap;
        }
        function csRenderUsage(usage) {
          var host = csNode("csUsage");
          if (!host || !usage) return;
          var left = usage.remaining || {};
          host.textContent = "今日请求 " + (usage.attempts || 0) + " · 成功 " + (usage.success || 0) + " · 失败 " + (usage.failed || 0) +
            " · 限流 " + (usage.rateLimited || 0) + " · 活跃用户 " + (usage.activeUsers || 0) +
            " · 短周期限制 " + (usage.shortLimitedUsers || 0) + " · 每日限制 " + (usage.dailyLimitedUsers || 0) +
            " · 单用户最高 " + (usage.maxAccepted || 0) + (usage.topUserPrefix ? "（User · " + usage.topUserPrefix + "）" : "") +
            " · 剩余 0:" + (left.zero || 0) + " / 1-3:" + (left.oneToThree || 0) + " / 4-7:" + (left.fourToSeven || 0) + " / 8+:" + (left.eightPlus || 0);
        }
        function csRenderDiagnose(report) {
          var host = csNode("csDiagnose");
          if (!host || !report) return;
          host.textContent = "接口正常 · 调度 " + report.broker + " · 节点 " + report.agentHeartbeat +
            " · 熔断 " + report.circuit + " · 策略 " + ((report.policy && report.policy.source) || "-") +
            " · 配额 " + ((report.quota && report.quota.healthy) ? "正常" : "异常") +
            " · 磁盘 " + (report.diskWritable ? "可写" : "不可写") + " · 学校系统 " + (report.schoolGateway || "暂无近期真实任务");
        }
        function csLoadCritical() {
          if (!csActive()) return Promise.resolve();
          return csTrack("snapshot", function () {
            return api("/api/admin/campus-sync/snapshot", { signal: cs.control && cs.control.signal }).then(csApplySnapshot).catch(function () {
              if (cs.criticalReady) return;
              var node = csNode("csError");
              if (node) { node.hidden = false; node.textContent = "同步控制台暂时读不到数据，将稍后重试。"; }
            });
          });
        }
        function csLoadWindow() {
          return csTrack("overview", function () {
            return api("/api/admin/campus-sync/overview", { signal: cs.control && cs.control.signal }).then(function (body) {
              var overview = body.overview || body;
              cs.window24h = overview.window24h;
              cs.performance = overview.performance;
              if (!cs.overview) return;
              cs.overview.window24h = overview.window24h;
              cs.overview.performance = overview.performance;
              cs.overview.errors = overview.errors;
              cs.overview.pipeline = overview.pipeline || cs.overview.pipeline;
              cs.overview.securityPosture = overview.securityPosture || cs.overview.securityPosture;
              csCards(cs.overview);
              csRenderPipeline(cs.overview.pipeline);
              csRenderErrors(overview.errors, overview.window24h);
              csRenderObservation(overview);
            }).catch(function () {});
          });
        }
        function csLoadTrend() {
          var generation = ++cs.trendGeneration;
          var range = cs.range;
          csCardStatus("csChartStatus", "正在加载趋势…", false);
          return csTrack("trend:" + range, function () {
            return api("/api/admin/campus-sync/timeseries?range=" + encodeURIComponent(range), { signal: cs.control && cs.control.signal }).then(function (body) {
              if (generation !== cs.trendGeneration) return;
              csCardStatus("csChartStatus", "", false);
              csDraw(body.points || []);
            }).catch(function () {
              if (generation !== cs.trendGeneration) return;
              csCardStatus("csChartStatus", "趋势暂时无法刷新", true);
            });
          });
        }
        function csLoadSecurity() {
          return csTrack("security", function () {
            csCardStatus("csSecurityStatus", "正在加载安全状态…", false);
            return api("/api/admin/campus-sync/security", { signal: cs.control && cs.control.signal }).then(function (body) {
              csCardStatus("csSecurityStatus", "", false);
              csRenderSecurity(body.security || body);
            }).catch(function () { csCardStatus("csSecurityStatus", "刷新失败 · 保留上次数据", true); });
          });
        }
        function csLoadConfig() {
          return csTrack("config", function () {
            csCardStatus("csConfigStatus", "正在加载运行契约…", false);
            return api("/api/admin/campus-sync/config", { signal: cs.control && cs.control.signal }).then(function (body) {
              csCardStatus("csConfigStatus", "", false);
              csRenderConfig(body.config || body);
            }).catch(function () { csCardStatus("csConfigStatus", "刷新失败 · 保留上次数据", true); });
          });
        }
        function csLoadPolicy() {
          return csTrack("policy", function () {
            return api("/api/admin/campus-sync/policy", { signal: cs.control && cs.control.signal }).then(function (body) {
              csFillPolicy(body.policy || null);
              csRenderUsage(body.usage);
            }).catch(function () {});
          });
        }
        function csLoadEvents(reset) {
          if (reset) cs.cursor = "";
          var status = (csNode("csStatusFilter") && csNode("csStatusFilter").value || "").trim();
          var code = (csNode("csCodeFilter") && csNode("csCodeFilter").value || "").trim();
          var query = "/api/admin/campus-sync/events?limit=50" +
            (status ? "&status=" + encodeURIComponent(status) : "") +
            (code ? "&errorCode=" + encodeURIComponent(code) : "") +
            (!reset && cs.cursor ? "&cursor=" + encodeURIComponent(cs.cursor) : "");
          return csTrack("events:" + query, function () {
            csCardStatus("csEventsStatus", "正在加载最近事件…", false);
            return api(query, { signal: cs.control && cs.control.signal }).then(function (body) {
              csCardStatus("csEventsStatus", "", false);
              csRenderEvents(body);
            }).catch(function () { csCardStatus("csEventsStatus", "刷新失败 · 保留上次数据", true); });
          });
        }
        function csLoadSecondary() {
          [csLoadTrend, csLoadWindow, csLoadSecurity, csLoadEvents, csLoadConfig, csLoadPolicy].forEach(function (fn, index) {
            setTimeout(function () { if (csActive()) fn(true); }, 120 * (index + 1));
          });
        }
        function csLoad() {
          csSignal();
          return csLoadCritical().then(function () { csLoadSecondary(); });
        }
        function csArm(name, delay, fn) {
          if (cs.timers[name]) clearTimeout(cs.timers[name]);
          if (!csActive()) return;
          cs.timers[name] = setTimeout(function () { fn().finally(function () { csArm(name, delay, fn); }); }, delay);
        }
        function csSchedule() {
          Object.keys(cs.timers).forEach(function (name) { clearTimeout(cs.timers[name]); });
          cs.timers = {};
          if (!csActive()) return;
          csArm("critical", 10000, csLoadCritical);
          csArm("trend", 60000, csLoadTrend);
          csArm("security", 60000, csLoadSecurity);
          csArm("events", 30000, function () { return csLoadEvents(true); });
          csArm("config", 300000, csLoadConfig);
        }
        function csAction(path, button, pending, done, expectPaused) {
          if (!button || button.dataset.busy === "1") return Promise.resolve();
          button.dataset.busy = "1";
          button.disabled = true;
          button.textContent = pending;
          return api(path, { method: "POST", body: "{}" }).then(function () {
            return api("/api/admin/campus-sync/snapshot");
          }).then(function (body) {
            var snap = body.snapshot || body;
            var overview = snap.service || body.overview || body;
            var paused = !!(overview.maintenance && overview.maintenance.paused);
            if (paused !== expectPaused) throw new Error("服务端状态尚未确认");
            csCards(overview);
            var host = csNode("csDiagnose");
            if (host) host.textContent = done;
          }).catch(function (error) {
            var host = csNode("csDiagnose");
            if (host) host.textContent = error && error.message ? error.message : "操作失败";
            var node = csNode("csDiagnose");
            if (node && !node.textContent) node.textContent = "操作失败";
          }).finally(function () {
            button.dataset.busy = "";
            return csLoad();
          });
        }
        function csBind() {
          var refresh = csNode("csRefreshBtn");
          if (!refresh || refresh.dataset.bound) return;
          refresh.dataset.bound = "1";
          var chart = csNode("csChart");
          if (chart) {
            chart.addEventListener("mousemove", function (event) {
              var node = event.target;
              var index = node && node.getAttribute && node.getAttribute("data-i");
              if (index == null || index === "") {
                var idle = csNode("csChartTip");
                if (idle) idle.hidden = true;
                return;
              }
              csShowTrendTip(Number(index), event);
            });
            chart.addEventListener("mouseleave", function () {
              var tip = csNode("csChartTip");
              if (tip) tip.hidden = true;
            });
          }
          refresh.addEventListener("click", function () {
            var label = refresh.textContent;
            refresh.textContent = "正在刷新…";
            csSignal();
            csLoadCritical().finally(function () {
              refresh.textContent = label;
              csLoadSecondary();
            });
          });
          ["csRateLimit", "csRateWindow", "csDailyLimit", "csGlobalCap"].forEach(function (id) {
            csNode(id).addEventListener("input", function () {
              cs.policyDirty = true;
              csNode("csPolicyMeta").textContent = "有未保存的修改";
            });
          });
          csNode("csPauseBtn").addEventListener("click", function () { csAction("/api/admin/campus-sync/actions/pause", this, "正在暂停", "已暂停个人课表同步", true); });
          csNode("csResumeBtn").addEventListener("click", function () { csAction("/api/admin/campus-sync/actions/resume", this, "正在恢复", "个人课表同步已恢复", false); });
          csNode("csDiagnoseBtn").addEventListener("click", function () {
            api("/api/admin/campus-sync/actions/diagnose", { method: "POST", body: "{}" }).then(function (body) {
              csRenderDiagnose(body.report || body);
              return csLoad();
            }).catch(csFail);
          });
          csNode("csPolicyCancel").addEventListener("click", function () {
            cs.policyDirty = false;
            csFillPolicy(cs.serverPolicy || cs.policy, true);
          });
          csNode("csPolicySave").addEventListener("click", function () {
            var button = csNode("csPolicySave");
            var body = {
              rateLimit: csInt(csNode("csRateLimit").value),
              rateWindowSeconds: csInt(csNode("csRateWindow").value),
              dailyLimit: csInt(csNode("csDailyLimit").value),
              globalActiveCap: csInt(csNode("csGlobalCap").value),
              expectedRevision: cs.serverRevision
            };
            if (body.dailyLimit == null || body.dailyLimit < 1 || body.dailyLimit > 50 || body.rateLimit == null || body.rateWindowSeconds == null || body.globalActiveCap == null) {
              csNode("csPolicyMeta").textContent = "输入值不合法（HTTP 400）";
              return;
            }
            var previous = cs.policy && cs.policy.dailyLimit;
            if (!window.confirm("确定将每用户每日同步次数由 " + previous + " 次调整为 " + body.dailyLimit + " 次吗？修改后立即对新请求生效。")) return;
            button.disabled = true;
            button.textContent = "正在保存…";
            api("/api/admin/campus-sync/policy", { method: "PUT", body: JSON.stringify(body) }).then(function () {
              return api("/api/admin/campus-sync/policy");
            }).then(function (fresh) {
              var applied = fresh.policy || {};
              cs.policyDirty = false;
              csFillPolicy(applied, true);
              if (applied.dailyLimit !== body.dailyLimit || applied.rateLimit !== body.rateLimit || applied.rateWindowSeconds !== body.rateWindowSeconds || applied.globalActiveCap !== body.globalActiveCap) {
                csNode("csPolicyMeta").textContent = "服务器返回的策略与提交值不一致";
                return;
              }
              csNode("csPolicyMeta").textContent = "已保存 · 立即生效 · " + csNode("csPolicyMeta").textContent;
            }).catch(function (error) {
              csNode("csPolicyMeta").textContent = csPolicyError(error);
            }).finally(function () {
              button.disabled = false;
              button.textContent = "保存修改";
            });
          });
          csNode("csPolicyReset").addEventListener("click", function () {
            if (!window.confirm("确定恢复为环境默认的同步策略吗？修改后立即对新请求生效。")) return;
            api("/api/admin/campus-sync/policy/reset", { method: "POST", body: "{}" }).then(function () {
              return api("/api/admin/campus-sync/policy");
            }).then(function (fresh) {
              cs.policyDirty = false;
              csFillPolicy(fresh.policy, true);
              csNode("csPolicyMeta").textContent = "已恢复默认值 · 立即生效 · " + csNode("csPolicyMeta").textContent;
            }).catch(function (error) { csNode("csPolicyMeta").textContent = csPolicyError(error); });
          });
          csNode("csEventsBtn").addEventListener("click", function () { csLoadEvents(true); });
          csNode("csEventsMore").addEventListener("click", function () { if (cs.cursor) csLoadEvents(false); });
          document.querySelectorAll("#csRanges button").forEach(function (button) {
            button.addEventListener("click", function () { cs.range = button.getAttribute("data-cs-range") || "24h"; csLoadTrend(); });
          });
          document.addEventListener("visibilitychange", csSchedule);
          var section = csNode("section-campus-sync");
          if (section && window.MutationObserver) {
            new MutationObserver(function () { if (csActive()) { csLoad(); csLoadEvents(true); } csSchedule(); }).observe(section, { attributes: true, attributeFilter: ["class"] });
          }
        }
        csBind();
      })();
`;

module.exports = {
  CAMPUS_SYNC_SCRIPT,
  CAMPUS_SYNC_SECTION,
  CAMPUS_SYNC_STYLES,
};
