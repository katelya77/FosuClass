const SCHEDULE_COLLECTOR_CARD = `
        <div class="card" id="scheduleCollectorCard">
          <div class="card-header"><h3>自动同步</h3><span id="scEnabled">检测中</span></div>
          <p id="scSummary" class="muted">Collector 状态加载中</p>
          <p id="scMessage"></p>
          <div id="scDirectProgress" aria-live="polite"></div>
          <p class="muted">仅采集，不发布。新数据完成校验后进入 PENDING REVIEW。</p>
          <div class="button-row">
            <button type="button" id="scRoutineBtn">立即执行日常同步</button>
            <button type="button" class="secondary" id="scFullBtn">执行完整同步</button>
            <button type="button" class="secondary" id="scPauseBtn">暂停自动同步</button>
            <button type="button" class="secondary" id="scResumeBtn">恢复自动同步</button>
            <button type="button" class="secondary" id="scCancelBtn">取消当前任务</button>
            <button type="button" class="secondary" id="scValidateBtn">验证当前 Staging</button>
            <button type="button" class="secondary" id="scPublishBtn">发布当前 Staging</button>
            <button type="button" class="secondary" id="scMirrorBtn">镜像 CloudBase</button>
            <button type="button" class="secondary" id="scReportBtn">查看最新同步报告</button>
          </div>
          <pre id="scReport" hidden></pre>
        </div>`;

const SCHEDULE_COLLECTOR_SCRIPT = `
      (function () {
        var card = document.getElementById("scheduleCollectorCard");
        if (!card || typeof api !== "function") return;
        function text(id, value) { var node = document.getElementById(id); if (node) node.textContent = value; }
        function paint(status) {
          if (!status) return;
          text("scEnabled", (status.enabled ? "采集队列：可执行" : "采集队列：暂停") + (status.timerVerified ? " · 定时已验收" : " · 定时 disabled until verified"));
          text("scSummary", "Collector：" + (status.collectorOnline ? "在线" : "离线")
            + " · 上次心跳 " + (status.lastHeartbeat || "-")
            + " · 上次运行 " + (status.lastRunAt || "-")
            + " · 上次成功 " + (status.lastSuccessAt || "-")
            + " · 下次日常 " + (status.nextRoutineAt || "-")
            + " · 下次完整 " + (status.nextFullAt || "-"));
          var current = status.current;
          text("scMessage", status.sessionMessage || (current ? (current.mode + " / " + current.stage + " / " + (current.result || "进行中")) : "当前阶段：idle"));
          var progress = document.getElementById("scDirectProgress");
          while (progress.firstChild) progress.removeChild(progress.firstChild);
          var summary = (current || {}).directSourceSummary || {};
          ["class", "teacher", "classroom", "course"].forEach(function(kind, index) {
            var stat = summary[kind] || {}, row = document.createElement("p");
            row.textContent = ["班级", "教师", "教室", "课程"][index] + " " + (stat.requestedEntities || 0) + " / " + (stat.discoveredEntities || 0)
              + (stat.entityUnit === "major-request-group" ? " 专业请求组" : " 实体") + " · 文档 " + (stat.scheduleDocuments || 0) + " · 课程事件 " + (stat.courseEvents || 0)
              + " · success " + (stat.success || 0) + " · empty " + (stat.empty || 0) + " · failed " + (stat.failed || 0)
              + " · requests " + (stat.requestCount || 0) + " · 耗时 " + Math.round((stat.elapsedMs || 0) / 1000) + "s"
              + " · 预计剩余 " + Math.round((stat.estimatedRemainingMs || 0) / 1000) + "s";
            progress.appendChild(row);
          });
          text("scReport", JSON.stringify(status.recent && status.recent[0] || {}, null, 2));
        }
        function refresh() { return api("/api/admin/schedule-collector/status").then(function (body) { paint(body.status); }); }
        function post(path) { return api(path, { method: "POST", body: "{}" }).then(refresh); }
        document.getElementById("scRoutineBtn").addEventListener("click", function () {
          if (!window.confirm("确定立即执行一次日常同步吗？")) return;
          post("/api/admin/schedule-collector/actions/routine");
        });
        document.getElementById("scFullBtn").addEventListener("click", function () {
          if (!window.confirm("完整同步会访问较多学校课程资源，建议低峰期执行。确定继续吗？")) return;
          post("/api/admin/schedule-collector/actions/full");
        });
        document.getElementById("scPauseBtn").addEventListener("click", function () {
          if (!window.confirm("确定暂停自动同步吗？已经排队的任务不会自动开始。")) return;
          post("/api/admin/schedule-collector/actions/pause");
        });
        document.getElementById("scResumeBtn").addEventListener("click", function () { post("/api/admin/schedule-collector/actions/resume"); });
        document.getElementById("scCancelBtn").addEventListener("click", function () {
          if (!window.confirm("确定取消当前采集任务吗？")) return;
          post("/api/admin/schedule-collector/actions/cancel");
        });
        document.getElementById("scValidateBtn").addEventListener("click", function () { if (typeof loadStagingPreview === "function") loadStagingPreview(); });
        document.getElementById("scPublishBtn").addEventListener("click", function () { var button = document.getElementById("stagingPublishBtn"); if (button) { button.scrollIntoView(); button.focus(); } });
        document.getElementById("scMirrorBtn").addEventListener("click", function () { if (typeof copyText === "function") copyText("npm run cloudbase:release:sync-active -- --execute --mirror-only"); });
        document.getElementById("scReportBtn").addEventListener("click", function () { document.getElementById("scReport").hidden = !document.getElementById("scReport").hidden; refresh(); });
        refresh();
        var refreshTimer = window.setInterval(function () { if (!document.hidden) refresh().catch(function () {}); }, 10000);
        window.addEventListener("pagehide", function () { window.clearInterval(refreshTimer); });
      })();
`;

module.exports = { SCHEDULE_COLLECTOR_CARD, SCHEDULE_COLLECTOR_SCRIPT };
