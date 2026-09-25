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
    #section-campus-sync .cs-policy { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 10px; }
    #section-campus-sync .cs-policy label, #section-campus-sync .cs-policy div { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    #section-campus-sync .cs-policy input { height: 32px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-primary); padding: 0 8px; }
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
          <div id="csDiagnose" class="cs-muted"></div>
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
          <div id="csChartEmpty" class="cs-empty" hidden>当前时间范围暂无同步请求</div>
          <div class="cs-muted">请求量 · 成功 · 系统失败 · 凭证失败 · 限流</div>
        </div>
        <div class="cs-card" id="csPolicyCard">
          <h3>同步策略</h3>
          <div class="cs-policy">
            <div><span>单用户并发</span><b>1（固定）</b></div>
            <label>短周期最多同步<input id="csRateLimit" type="number" min="1" max="20" step="1"></label>
            <label>周期（秒）<input id="csRateWindow" type="number" min="60" max="3600" step="1"></label>
            <label>每日最多同步<input id="csDailyLimit" type="number" min="1" max="50" step="1"></label>
            <div class="cs-muted">北京时间每日 00:00 重置</div>
            <label>全局进行中任务上限<input id="csGlobalCap" type="number" min="1" max="30" step="1"></label>
            <div><span>WYZ Worker</span><b>1（固定）</b></div>
            <div><span>任务 TTL</span><b id="csJobTtl">90s（只读）</b></div>
          </div>
          <div class="cs-toolbar">
            <button type="button" id="csPolicySave">保存修改</button>
            <button type="button" class="secondary" id="csPolicyCancel">取消编辑</button>
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
          var empty = csNode("csChartEmpty");
          if (!svg) return;
          var rows = points || [];
          var total = rows.reduce(function (sum, row) {
            return sum + (row.attempts || 0) + (row.success || 0) + (row.failed || 0) + (row.systemFailures || 0) + (row.credentialFailures || 0) + (row.rateLimited || 0);
          }, 0);
          if (!rows.length || !total) {
            svg.innerHTML = "";
            if (empty) empty.hidden = false;
            return;
          }
          if (empty) empty.hidden = true;
          var max = 1;
          rows.forEach(function (row) { max = Math.max(max, row.attempts || 0, row.success || 0, row.systemFailures || 0, row.credentialFailures || 0, row.rateLimited || 0); });
          function xAt(index) { return rows.length === 1 ? 320 : 20 + (index * 600 / (rows.length - 1)); }
          function line(key, color) {
            var path = rows.map(function (row, index) {
              var y = 160 - ((row[key] || 0) / max) * 140;
              return (index ? "L" : "M") + xAt(index).toFixed(1) + " " + y.toFixed(1);
            }).join(" ");
            var dots = rows.map(function (row, index) {
              var y = 160 - ((row[key] || 0) / max) * 140;
              return "<circle cx='" + xAt(index).toFixed(1) + "' cy='" + y.toFixed(1) + "' r='3' fill='" + color + "'/>";
            }).join("");
            return "<path d='" + path + "' fill='none' stroke='" + color + "' stroke-width='1.5'/>" + dots;
          }
          svg.innerHTML = line("attempts", "currentColor") + line("success", "#14795a") + line("systemFailures", "#b42318") + line("credentialFailures", "#9a5d08") + line("rateLimited", "#3b6ea5");
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
          var label = { normal: "安全状态正常", watch: "观察到异常", rate_limit: "限流生效中", circuit_open: "熔断已打开" }[posture] || posture;
          csBadge(label, posture === "circuit_open" ? "danger" : (posture === "normal" ? "ok" : "warn"));
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
        function csFillPolicy(policy) {
          if (!policy) return;
          cs.policy = policy;
          ["csRateLimit", "csRateWindow", "csDailyLimit", "csGlobalCap"].forEach(function (id, index) {
            var node = csNode(id);
            var key = ["rateLimit", "rateWindowSeconds", "dailyLimit", "globalActiveCap"][index];
            if (node && document.activeElement !== node) node.value = policy[key];
          });
          var ttl = csNode("csJobTtl");
          if (ttl) ttl.textContent = (policy.jobTtlSeconds || 90) + "s（只读）";
          var meta = csNode("csPolicyMeta");
          if (meta) meta.textContent = (policy.source === "runtime" ? "当前来源：Runtime override" : "当前来源：Environment default") +
            (policy.updatedAt ? " · 最后修改 " + policy.updatedAt : "") + (policy.updatedBy ? " · " + policy.updatedBy : "");
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
        function csLoad() {
          if (!csActive()) return Promise.resolve();
          if (cs.control) cs.control.abort();
          cs.control = typeof AbortController === "function" ? new AbortController() : null;
          var loading = csNode("csLoading");
          return Promise.all([
            api("/api/admin/campus-sync/overview"),
            api("/api/admin/campus-sync/timeseries?range=" + cs.range),
            api("/api/admin/campus-sync/security"),
            api("/api/admin/campus-sync/config"),
            api("/api/admin/campus-sync/policy")
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
            csFillPolicy((parts[4] && parts[4].policy) || null);
            csRenderUsage(parts[4] && parts[4].usage);
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
          csNode("csDiagnoseBtn").addEventListener("click", function () {
            api("/api/admin/campus-sync/actions/diagnose", { method: "POST", body: {} }).then(function (body) {
              csRenderDiagnose(body.report || body);
              return csLoad();
            }).catch(csFail);
          });
          csNode("csPolicyCancel").addEventListener("click", function () { csFillPolicy(cs.policy); });
          csNode("csPolicySave").addEventListener("click", function () {
            var body = {
              rateLimit: Number(csNode("csRateLimit").value),
              rateWindowSeconds: Number(csNode("csRateWindow").value),
              dailyLimit: Number(csNode("csDailyLimit").value),
              globalActiveCap: Number(csNode("csGlobalCap").value)
            };
            if (!Number.isInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 50) {
              csNode("csPolicyMeta").textContent = "每日次数需要在 1 到 50 之间。";
              return;
            }
            var previous = cs.policy && cs.policy.dailyLimit;
            if (!window.confirm("确定将每用户每日同步次数由 " + previous + " 次调整为 " + body.dailyLimit + " 次吗？修改后立即对新请求生效。")) return;
            api("/api/admin/campus-sync/policy", { method: "PUT", body: body }).then(function (result) {
              csFillPolicy(result.policy);
              csNode("csPolicyMeta").textContent = "已保存 · 立即生效";
            }).catch(function () { csNode("csPolicyMeta").textContent = "策略没有保存。"; });
          });
          csNode("csPolicyReset").addEventListener("click", function () {
            if (!window.confirm("确定恢复为环境默认的同步策略吗？修改后立即对新请求生效。")) return;
            api("/api/admin/campus-sync/policy/reset", { method: "POST", body: {} }).then(function (result) {
              csFillPolicy(result.policy);
              csNode("csPolicyMeta").textContent = "已恢复默认值 · 立即生效";
            }).catch(csFail);
          });
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
