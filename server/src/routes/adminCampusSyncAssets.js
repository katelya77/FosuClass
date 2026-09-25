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
    #section-campus-sync .cs-chart { width: 100%; height: 180px; }
    #section-campus-sync .cs-pipeline { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 8px; }
    #section-campus-sync .cs-error, #section-campus-sync .cs-empty { color: var(--text-muted); font-size: 13px; }
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
            </div>
            <div class="cs-toolbar">
              <span id="csSecurityBadge" class="cs-badge">安全状态</span>
              <button type="button" class="secondary" id="csRefreshBtn">刷新</button>
              <button type="button" class="secondary" id="csPauseBtn">暂停个人同步</button>
              <button type="button" class="secondary" id="csResumeBtn">恢复个人同步</button>
              <button type="button" class="secondary" id="csDiagnoseBtn">轻量诊断</button>
            </div>
          </div>
        </div>
        <div id="csLoading" class="cs-card cs-muted">正在读取同步状态…</div>
        <div id="csError" class="cs-card cs-error" hidden></div>
        <div class="cs-grid" id="csOverview"></div>
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
          <svg id="csChart" class="cs-chart" viewBox="0 0 640 180" role="img" aria-label="同步请求趋势"></svg>
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
          <div id="csEvents" class="cs-table-wrap"></div>
        </div>
        <div class="cs-grid">
          <div class="cs-card"><h3>安全与临时封禁</h3><div id="csSecurity" class="cs-table-wrap"></div></div>
          <div class="cs-card"><h3>运行契约</h3><div id="csConfig"></div></div>
        </div>
      </section>
`;

const CAMPUS_SYNC_SCRIPT = `
      (function () {
        var cs = { range: "24h", cursor: "", timer: null, eventTimer: null, backoff: 12000, control: null };
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
        function csDraw(points) {
          var svg = csNode("csChart");
          if (!svg) return;
          var rows = points || [];
          if (!rows.length) { svg.innerHTML = "<text x='16' y='28' fill='currentColor'>暂无趋势数据</text>"; return; }
          var max = 1;
          rows.forEach(function (row) { max = Math.max(max, row.attempts || 0, row.success || 0, row.failed || 0); });
          function line(key, color) {
            return rows.map(function (row, index) {
              var x = rows.length === 1 ? 20 : 20 + (index * 600 / (rows.length - 1));
              var y = 160 - ((row[key] || 0) / max) * 140;
              return (index ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
            }).join(" ") ;
          }
          svg.innerHTML = "<path d='" + line("attempts", "") + "' fill='none' stroke='currentColor' stroke-width='1.5'/>" +
            "<path d='" + line("success", "") + "' fill='none' stroke='#14795a' stroke-width='1.5'/>" +
            "<path d='" + line("failed", "") + "' fill='none' stroke='#b42318' stroke-width='1.5'/>";
        }
        function csCards(overview) {
          var host = csNode("csOverview");
          if (!host || !overview) return;
          var day = overview.window24h || {};
          var perf = overview.performance || {};
          var agent = overview.agent || {};
          var queue = overview.queue || {};
          var statusLabel = { normal: "正常", busy: "繁忙", degraded: "降级", maintenance: "维护", offline: "离线" }[overview.status] || overview.status || "-";
          var cards = [
            ["同步服务", statusLabel],
            ["Campus Agent", agent.online ? "Online" : "Offline"],
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
          var label = { normal: "安全状态正常", watch: "观察到异常", rate_limit: "Rate Limit 活跃", circuit_open: "Circuit Open" }[posture] || posture;
          csBadge(label, posture === "circuit_open" ? "danger" : (posture === "normal" ? "ok" : "warn"));
        }
        function csRenderPipeline(list) {
          var host = csNode("csPipeline");
          if (!host) return;
          host.innerHTML = (list || []).map(function (item) {
            return "<div class='cs-stat'><b>" + csText(item.label) + "</b><span>" + csText(item.status) + " · 错误 " + (item.errors || 0) + "</span></div>";
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
        function csFail(error) {
          var node = csNode("csError");
          if (node) { node.hidden = false; node.textContent = "同步控制台暂时读不到数据，将稍后重试。"; }
          cs.backoff = Math.min(120000, Math.round(cs.backoff * 1.6));
        }
        function csLoadEvents(reset) {
          if (reset) cs.cursor = "";
          var status = (csNode("csStatusFilter") && csNode("csStatusFilter").value || "").trim();
          var code = (csNode("csCodeFilter") && csNode("csCodeFilter").value || "").trim();
          var query = "/api/admin/campus-sync/events?limit=50" +
            (status ? "&status=" + encodeURIComponent(status) : "") +
            (code ? "&errorCode=" + encodeURIComponent(code) : "") +
            (!reset && cs.cursor ? "&cursor=" + encodeURIComponent(cs.cursor) : "");
          return api(query).then(csRenderEvents).catch(csFail);
        }
        function csLoad() {
          if (!csActive()) return Promise.resolve();
          if (cs.control) cs.control.abort();
          cs.control = typeof AbortController === "function" ? new AbortController() : null;
          var loading = csNode("csLoading");
          return Promise.all([
            api("/api/admin/campus-sync/overview"),
            api("/api/admin/campus-sync/timeseries?range=" + cs.range),
            api("/api/admin/campus-sync/security"),
            api("/api/admin/campus-sync/config")
          ]).then(function (parts) {
            if (loading) loading.hidden = true;
            var error = csNode("csError");
            if (error) error.hidden = true;
            cs.backoff = 12000;
            var overview = parts[0].overview || parts[0];
            csCards(overview);
            csRenderPipeline(overview.pipeline);
            csRenderQueue(overview.queue);
            csRenderErrors(overview.errors, overview.window24h);
            csDraw(parts[1].points || []);
            csRenderSecurity(parts[2].security || parts[2]);
            csRenderConfig(parts[3].config || parts[3]);
          }).catch(csFail);
        }
        function csSchedule() {
          if (cs.timer) clearTimeout(cs.timer);
          if (cs.eventTimer) clearTimeout(cs.eventTimer);
          if (!csActive()) return;
          cs.timer = setTimeout(function () { csLoad().finally(csSchedule); }, cs.backoff);
          cs.eventTimer = setTimeout(function () { if (csActive()) csLoadEvents(true); }, 30000);
        }
        function csAction(path) {
          return api(path, { method: "POST", body: {} }).then(function () { return csLoad(); }).catch(csFail);
        }
        function csBind() {
          var refresh = csNode("csRefreshBtn");
          if (!refresh || refresh.dataset.bound) return;
          refresh.dataset.bound = "1";
          refresh.addEventListener("click", function () { csLoad(); csLoadEvents(true); });
          csNode("csPauseBtn").addEventListener("click", function () { csAction("/api/admin/campus-sync/actions/pause"); });
          csNode("csResumeBtn").addEventListener("click", function () { csAction("/api/admin/campus-sync/actions/resume"); });
          csNode("csDiagnoseBtn").addEventListener("click", function () { csAction("/api/admin/campus-sync/actions/diagnose"); });
          csNode("csEventsBtn").addEventListener("click", function () { csLoadEvents(true); });
          csNode("csEventsMore").addEventListener("click", function () { if (cs.cursor) csLoadEvents(false); });
          document.querySelectorAll("#csRanges button").forEach(function (button) {
            button.addEventListener("click", function () { cs.range = button.getAttribute("data-cs-range") || "24h"; csLoad(); });
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
