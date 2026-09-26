const SCHEDULE_COLLECTOR_CARD = `
        <div class="card" id="scheduleCollectorCard">
          <div class="card-header"><h3>自动同步</h3><span id="scEnabled">检测中</span></div>
          <p id="scSummary" class="muted">Collector 状态加载中</p>
          <p id="scMessage"></p>
          <div class="button-row">
            <button type="button" id="scRoutineBtn">立即执行日常同步</button>
            <button type="button" class="secondary" id="scFullBtn">执行完整同步</button>
            <button type="button" class="secondary" id="scPauseBtn">暂停自动同步</button>
            <button type="button" class="secondary" id="scResumeBtn">恢复自动同步</button>
            <button type="button" class="secondary" id="scCancelBtn">取消当前任务</button>
          </div>
        </div>`;

const SCHEDULE_COLLECTOR_SCRIPT = `
      (function () {
        var card = document.getElementById("scheduleCollectorCard");
        if (!card || typeof api !== "function") return;
        function text(id, value) { var node = document.getElementById(id); if (node) node.textContent = value; }
        function paint(status) {
          if (!status) return;
          text("scEnabled", status.enabled ? "自动同步：开启" : "自动同步：暂停");
          text("scSummary", "Collector：" + (status.collectorOnline ? "在线" : "离线")
            + " · 上次心跳 " + (status.lastHeartbeat || "-")
            + " · 上次运行 " + (status.lastRunAt || "-")
            + " · 上次成功 " + (status.lastSuccessAt || "-")
            + " · 下次日常 " + (status.nextRoutineAt || "-")
            + " · 下次完整 " + (status.nextFullAt || "-"));
          var current = status.current;
          text("scMessage", status.sessionMessage || (current ? (current.mode + " / " + current.stage + " / " + (current.result || "进行中")) : "当前阶段：idle"));
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
        refresh();
      })();
`;

module.exports = { SCHEDULE_COLLECTOR_CARD, SCHEDULE_COLLECTOR_SCRIPT };
