const express = require("express");

const router = express.Router();

const feedbackAdminHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FosuClass 反馈后台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f2;
      --panel: #ffffff;
      --ink: #17211b;
      --muted: #667269;
      --line: #dfe5dc;
      --accent: #11735c;
      --accent-ink: #ffffff;
      --warn: #b45309;
      --bad: #b91c1c;
      --soft: #e9f4ef;
      --shadow: 0 18px 45px rgba(28, 42, 34, 0.08);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(135deg, rgba(17, 115, 92, 0.10), transparent 34%),
        linear-gradient(315deg, rgba(180, 83, 9, 0.08), transparent 30%),
        var(--bg);
      color: var(--ink);
    }
    button, input, select {
      font: inherit;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      cursor: pointer;
      background: #e7ece7;
      color: var(--ink);
      transition: transform 0.14s ease, background 0.14s ease;
    }
    button:hover { transform: translateY(-1px); background: #dce5df; }
    button.primary { background: var(--accent); color: var(--accent-ink); }
    button.ghost { background: transparent; border: 1px solid var(--line); }
    button.danger { color: var(--bad); }
    input, select {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 11px;
      background: #fff;
      color: var(--ink);
    }
    .shell {
      width: min(1180px, calc(100% - 28px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    .title h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .title p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .auth-panel,
    .panel {
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(223, 229, 220, 0.9);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .auth-panel {
      max-width: 460px;
      margin: 76px auto 0;
      padding: 24px;
    }
    .auth-panel h1 { margin: 0 0 8px; font-size: 24px; }
    .auth-panel p { margin: 0 0 18px; color: var(--muted); }
    .auth-actions {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr auto;
    }
    .error {
      min-height: 22px;
      margin-top: 12px;
      color: var(--bad);
      font-size: 14px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 10px 26px rgba(28, 42, 34, 0.05);
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .stat strong {
      display: block;
      margin-top: 8px;
      font-size: 26px;
      line-height: 1;
    }
    .filters {
      display: grid;
      grid-template-columns: 150px 170px 1fr 150px auto auto;
      gap: 10px;
      align-items: end;
      padding: 14px;
      margin-bottom: 14px;
    }
    .field label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    .feedback-item {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .feedback-summary {
      width: 100%;
      display: grid;
      grid-template-columns: 142px 96px 1fr 150px 190px 156px 104px;
      gap: 12px;
      align-items: center;
      padding: 14px;
      text-align: left;
      background: transparent;
      border-radius: 0;
    }
    .feedback-summary:hover { transform: none; background: #f8faf7; }
    .cell {
      min-width: 0;
      color: var(--ink);
      font-size: 14px;
    }
    .cell.muted {
      color: var(--muted);
      font-size: 13px;
    }
    .summary-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border-radius: 999px;
      padding: 5px 9px;
      background: var(--soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 650;
    }
    .pill.processing { background: #fff5df; color: var(--warn); }
    .pill.resolved { background: #e8f7e8; color: #247136; }
    .pill.ignored { background: #eef0f2; color: #59616a; }
    .details {
      border-top: 1px solid var(--line);
      padding: 14px;
      background: #fbfcfa;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .detail-block {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      min-width: 0;
    }
    .detail-block.full { grid-column: 1 / -1; }
    .detail-block h3 {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
      font-weight: 650;
    }
    pre {
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      color: #25322a;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .empty {
      padding: 30px;
      text-align: center;
      color: var(--muted);
    }
    .status-line {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 12px;
    }
    [hidden] { display: none !important; }
    @media (max-width: 980px) {
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .filters button { min-height: 40px; }
      .feedback-summary {
        grid-template-columns: 1fr;
        gap: 7px;
      }
      .cell.summary-text { white-space: normal; }
      .detail-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .shell { width: min(100% - 18px, 1180px); padding-top: 18px; }
      .topbar { flex-direction: column; }
      .auth-panel { margin-top: 36px; padding: 18px; }
      .auth-actions { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr; }
      .filters { grid-template-columns: 1fr; }
      .title h1 { font-size: 23px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section id="authPanel" class="auth-panel">
      <h1>FosuClass 反馈后台</h1>
      <p>输入 ADMIN_API_TOKEN 后查看用户反馈。</p>
      <div class="auth-actions">
        <input id="tokenInput" type="password" autocomplete="current-password" placeholder="ADMIN_API_TOKEN">
        <button id="saveTokenButton" class="primary">进入</button>
      </div>
      <div id="authError" class="error"></div>
    </section>

    <section id="dashboard" hidden>
      <div class="topbar">
        <div class="title">
          <h1>反馈后台</h1>
          <p id="statusLine">正在加载...</p>
        </div>
        <button id="clearTokenButton" class="ghost">更换令牌</button>
      </div>

      <div id="stats" class="stats"></div>

      <section class="panel filters">
        <div class="field">
          <label for="statusFilter">状态</label>
          <select id="statusFilter">
            <option value="">全部</option>
            <option value="open">open</option>
            <option value="processing">processing</option>
            <option value="resolved">resolved</option>
            <option value="ignored">ignored</option>
          </select>
        </div>
        <div class="field">
          <label for="typeFilter">类型</label>
          <select id="typeFilter">
            <option value="">全部</option>
          </select>
        </div>
        <div class="field">
          <label for="keywordFilter">关键词</label>
          <input id="keywordFilter" type="search" placeholder="内容、联系方式、页面">
        </div>
        <div class="field">
          <label for="daysFilter">时间</label>
          <select id="daysFilter">
            <option value="">全部</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
          </select>
        </div>
        <button id="refreshButton" class="primary">刷新</button>
        <button id="exportButton">导出 CSV</button>
      </section>

      <p id="listStatus" class="status-line"></p>
      <section id="feedbackList" class="list"></section>
    </section>
  </main>

  <script>
    (function () {
      var tokenKey = "FOSU_ADMIN_API_TOKEN";
      var state = {
        token: localStorage.getItem(tokenKey) || "",
        expandedId: "",
        types: []
      };

      var authPanel = document.getElementById("authPanel");
      var dashboard = document.getElementById("dashboard");
      var tokenInput = document.getElementById("tokenInput");
      var authError = document.getElementById("authError");
      var statsNode = document.getElementById("stats");
      var feedbackList = document.getElementById("feedbackList");
      var statusLine = document.getElementById("statusLine");
      var listStatus = document.getElementById("listStatus");
      var statusFilter = document.getElementById("statusFilter");
      var typeFilter = document.getElementById("typeFilter");
      var keywordFilter = document.getElementById("keywordFilter");
      var daysFilter = document.getElementById("daysFilter");

      function showAuth(message) {
        authPanel.hidden = false;
        dashboard.hidden = true;
        authError.textContent = message || "";
        tokenInput.value = state.token || "";
        tokenInput.focus();
      }

      function showDashboard() {
        authPanel.hidden = true;
        dashboard.hidden = false;
      }

      function buildQuery() {
        var params = new URLSearchParams();
        params.set("limit", "100");
        if (statusFilter.value) params.set("status", statusFilter.value);
        if (typeFilter.value) params.set("type", typeFilter.value);
        if (keywordFilter.value.trim()) params.set("keyword", keywordFilter.value.trim());
        if (daysFilter.value) params.set("days", daysFilter.value);
        return params;
      }

      function apiFetch(path, options) {
        options = options || {};
        options.headers = Object.assign({}, options.headers || {}, {
          "Authorization": "Bearer " + state.token
        });
        return fetch(path, options).then(function (response) {
          if (response.status === 401) {
            throw new Error("管理员令牌无效");
          }
          if (!response.ok) {
            throw new Error("请求失败：" + response.status);
          }
          return response;
        });
      }

      function formatDate(value) {
        if (!value) return "-";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        var pad = function (num) { return String(num).padStart(2, "0"); };
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
      }

      function shortText(value, length) {
        var text = String(value || "").replace(/\\s+/g, " ").trim();
        if (text.length <= length) return text || "-";
        return text.slice(0, length - 1) + "…";
      }

      function pretty(value) {
        if (value === null || value === undefined || value === "") return "-";
        if (typeof value === "object") return JSON.stringify(value, null, 2);
        return String(value);
      }

      function appendText(parent, className, text) {
        var node = document.createElement("div");
        node.className = className;
        node.textContent = text;
        parent.appendChild(node);
        return node;
      }

      function renderStats(stats) {
        var labels = [
          ["total", "总反馈数"],
          ["open", "open"],
          ["processing", "processing"],
          ["resolved", "resolved"],
          ["ignored", "ignored"]
        ];
        statsNode.textContent = "";
        labels.forEach(function (pair) {
          var card = document.createElement("div");
          card.className = "stat";
          var label = document.createElement("span");
          label.textContent = pair[1];
          var value = document.createElement("strong");
          value.textContent = stats && stats[pair[0]] !== undefined ? stats[pair[0]] : 0;
          card.appendChild(label);
          card.appendChild(value);
          statsNode.appendChild(card);
        });
      }

      function renderTypeOptions(types) {
        var current = typeFilter.value;
        typeFilter.textContent = "";
        var all = document.createElement("option");
        all.value = "";
        all.textContent = "全部";
        typeFilter.appendChild(all);
        (types || []).forEach(function (type) {
          var option = document.createElement("option");
          option.value = type;
          option.textContent = type;
          typeFilter.appendChild(option);
        });
        typeFilter.value = current;
      }

      function renderDetails(record, item) {
        var details = document.createElement("div");
        details.className = "details";
        var grid = document.createElement("div");
        grid.className = "detail-grid";

        var blocks = [
          ["完整内容", record.content, true],
          ["selectedSchedule", record.selectedSchedule, false],
          ["selectedClass", record.selectedClass, false],
          ["page", record.page, false],
          ["appVersion", record.appVersion, false],
          ["dataVersion", record.dataVersion, false],
          ["userAgent", record.userAgent, true],
          ["createdAt", record.createdAt, false]
        ];
        blocks.forEach(function (block) {
          var box = document.createElement("div");
          box.className = "detail-block" + (block[2] ? " full" : "");
          var title = document.createElement("h3");
          title.textContent = block[0];
          var pre = document.createElement("pre");
          pre.textContent = pretty(block[1]);
          box.appendChild(title);
          box.appendChild(pre);
          grid.appendChild(box);
        });
        details.appendChild(grid);

        var actions = document.createElement("div");
        actions.className = "actions";
        [
          ["processing", "标记为处理中"],
          ["resolved", "标记为已解决"],
          ["ignored", "标记为忽略"]
        ].forEach(function (pair) {
          var button = document.createElement("button");
          button.textContent = pair[1];
          button.dataset.action = "status";
          button.dataset.id = record.id;
          button.dataset.status = pair[0];
          actions.appendChild(button);
        });
        var copyContent = document.createElement("button");
        copyContent.textContent = "复制反馈内容";
        copyContent.dataset.action = "copy";
        copyContent.dataset.copy = record.content || "";
        actions.appendChild(copyContent);
        var copyContact = document.createElement("button");
        copyContact.textContent = "复制联系方式";
        copyContact.dataset.action = "copy";
        copyContact.dataset.copy = record.contact || "";
        actions.appendChild(copyContact);
        details.appendChild(actions);
        item.appendChild(details);
      }

      function renderList(items) {
        feedbackList.textContent = "";
        if (!items || !items.length) {
          var empty = document.createElement("div");
          empty.className = "panel empty";
          empty.textContent = "当前筛选下没有反馈。";
          feedbackList.appendChild(empty);
          return;
        }
        items.forEach(function (record) {
          var item = document.createElement("article");
          item.className = "feedback-item";
          var summary = document.createElement("button");
          summary.className = "feedback-summary";
          summary.dataset.id = record.id;
          summary.dataset.action = "toggle";
          appendText(summary, "cell muted", formatDate(record.createdAt));
          appendText(summary, "cell", record.type || "-");
          appendText(summary, "cell summary-text", shortText(record.content, 120));
          appendText(summary, "cell muted", shortText(record.contact, 42));
          appendText(summary, "cell muted", shortText([
            (record.selectedClass && (record.selectedClass.className || record.selectedClass.majorName || record.selectedClass.name)) || "",
            record.semester || "",
            record.dataVersion || ""
          ].filter(Boolean).join(" / ") || "-", 76));
          appendText(summary, "cell muted", shortText(record.platform || "-", 76));
          var status = document.createElement("div");
          status.className = "cell";
          var pill = document.createElement("span");
          pill.className = "pill " + (record.status || "open");
          pill.textContent = record.status || "open";
          status.appendChild(pill);
          summary.appendChild(status);
          item.appendChild(summary);
          if (state.expandedId === record.id) {
            renderDetails(record, item);
          }
          feedbackList.appendChild(item);
        });
      }

      function loadFeedback() {
        if (!state.token) {
          showAuth();
          return;
        }
        showDashboard();
        statusLine.textContent = "正在加载反馈...";
        listStatus.textContent = "";
        apiFetch("/api/admin/feedback?" + buildQuery().toString())
          .then(function (response) { return response.json(); })
          .then(function (data) {
            if (!data.success) throw new Error(data.message || "请求失败");
            renderStats(data.stats || {});
            renderTypeOptions(data.types || []);
            renderList(data.feedback || data.items || []);
            statusLine.textContent = "最近刷新：" + formatDate(new Date().toISOString());
            listStatus.textContent = "当前列表 " + ((data.feedback || data.items || []).length) + " 条";
          })
          .catch(function (error) {
            if (error.message === "管理员令牌无效") {
              localStorage.removeItem(tokenKey);
              state.token = "";
              showAuth("管理员令牌无效");
              return;
            }
            statusLine.textContent = error.message;
          });
      }

      function updateStatus(id, status) {
        apiFetch("/api/admin/feedback/" + encodeURIComponent(id) + "/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: status })
        })
          .then(function (response) { return response.json(); })
          .then(function () { loadFeedback(); })
          .catch(function (error) { statusLine.textContent = error.message; });
      }

      function copyText(text) {
        text = text || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
        } else {
          var textarea = document.createElement("textarea");
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        listStatus.textContent = "已复制到剪贴板";
      }

      function exportCsv() {
        apiFetch("/api/admin/feedback/export.csv?" + buildQuery().toString())
          .then(function (response) { return response.blob(); })
          .then(function (blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "fosu-feedback.csv";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
          })
          .catch(function (error) { statusLine.textContent = error.message; });
      }

      document.getElementById("saveTokenButton").addEventListener("click", function () {
        state.token = tokenInput.value.trim();
        if (!state.token) {
          authError.textContent = "请输入管理员令牌";
          return;
        }
        localStorage.setItem(tokenKey, state.token);
        loadFeedback();
      });
      tokenInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          document.getElementById("saveTokenButton").click();
        }
      });
      document.getElementById("clearTokenButton").addEventListener("click", function () {
        localStorage.removeItem(tokenKey);
        state.token = "";
        showAuth();
      });
      document.getElementById("refreshButton").addEventListener("click", loadFeedback);
      document.getElementById("exportButton").addEventListener("click", exportCsv);
      [statusFilter, typeFilter, daysFilter].forEach(function (node) {
        node.addEventListener("change", loadFeedback);
      });
      var keywordTimer = null;
      keywordFilter.addEventListener("input", function () {
        clearTimeout(keywordTimer);
        keywordTimer = setTimeout(loadFeedback, 350);
      });
      feedbackList.addEventListener("click", function (event) {
        var target = event.target.closest("[data-action]");
        if (!target) return;
        var action = target.dataset.action;
        if (action === "toggle") {
          state.expandedId = state.expandedId === target.dataset.id ? "" : target.dataset.id;
          loadFeedback();
        }
        if (action === "status") {
          updateStatus(target.dataset.id, target.dataset.status);
        }
        if (action === "copy") {
          copyText(target.dataset.copy);
        }
      });

      if (state.token) {
        loadFeedback();
      } else {
        showAuth();
      }
    })();
  </script>
</body>
</html>`;

router.get("/feedback", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'"
  );
  res.type("html").send(feedbackAdminHtml);
});

module.exports = router;
