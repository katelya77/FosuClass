const express = require("express");
const adminAuth = require("../services/adminAuth");

const router = express.Router();

const adminConsoleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>佛课小表 Admin Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef4fb;
      --surface: rgba(255, 255, 255, 0.86);
      --solid: #ffffff;
      --ink: #182033;
      --muted: #66718a;
      --line: rgba(123, 139, 171, 0.22);
      --blue: #2f6df6;
      --violet: #7957d5;
      --green: #18a77a;
      --amber: #c27c13;
      --rose: #d94c6a;
      --soft-blue: #e9f0ff;
      --shadow: 0 20px 60px rgba(31, 54, 96, 0.12);
      font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 8% 10%, rgba(47, 109, 246, 0.18), transparent 28%),
        radial-gradient(circle at 80% 0%, rgba(121, 87, 213, 0.15), transparent 30%),
        linear-gradient(180deg, #f7fbff 0%, var(--bg) 100%);
      color: var(--ink);
    }
    button, input, textarea, select { font: inherit; }
    button {
      border: 0;
      border-radius: 8px;
      min-height: 38px;
      padding: 0 14px;
      background: #edf3fb;
      color: var(--ink);
      cursor: pointer;
      font-weight: 700;
    }
    button.primary { background: linear-gradient(135deg, var(--blue), var(--violet)); color: #fff; }
    button.danger { background: #fff0f3; color: var(--rose); }
    button.ghost { background: transparent; border: 1px solid var(--line); }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.9);
      color: var(--ink);
      padding: 10px 11px;
      outline: none;
    }
    textarea { min-height: 88px; resize: vertical; line-height: 1.55; }
    label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .login-wrap {
      width: min(430px, calc(100% - 32px));
      margin: 12vh auto;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .login-mark {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #fff;
      font-weight: 900;
      background: linear-gradient(135deg, var(--blue), var(--violet));
      margin-bottom: 18px;
    }
    .login-wrap h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
    .login-wrap p { margin: 8px 0 22px; color: var(--muted); line-height: 1.6; }
    .login-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
    .error-line { min-height: 22px; margin-top: 12px; color: var(--rose); font-size: 13px; }
    .app-shell {
      display: grid;
      grid-template-columns: 232px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar {
      padding: 22px 16px;
      border-right: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.62);
      backdrop-filter: blur(20px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 8px 22px;
    }
    .brand-badge {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #fff;
      font-weight: 900;
      background: linear-gradient(135deg, var(--blue), var(--violet));
    }
    .brand-title { font-size: 18px; font-weight: 900; }
    .brand-subtitle { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .nav { display: grid; gap: 6px; }
    .nav button {
      width: 100%;
      justify-content: flex-start;
      text-align: left;
      background: transparent;
      color: var(--muted);
    }
    .nav button.active {
      background: var(--soft-blue);
      color: var(--blue);
    }
    .main {
      min-width: 0;
      padding: 24px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .topbar h1 { margin: 0; font-size: 28px; }
    .topbar p { margin: 6px 0 0; color: var(--muted); }
    .status-pill {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      color: var(--green);
      background: #e8f8f3;
      font-size: 12px;
      font-weight: 800;
    }
    .section { display: none; }
    .section.active { display: block; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .stat-card, .panel, .list-item, .preview-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 12px 34px rgba(31, 54, 96, 0.08);
      backdrop-filter: blur(16px);
    }
    .stat-card { padding: 16px; }
    .stat-label { color: var(--muted); font-size: 12px; font-weight: 800; }
    .stat-value { margin-top: 8px; font-size: 26px; line-height: 1; font-weight: 900; }
    .panel { padding: 18px; margin-bottom: 16px; }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .panel-title { font-size: 18px; font-weight: 900; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .form-grid .full { grid-column: 1 / -1; }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(310px, 0.95fr);
      gap: 16px;
      align-items: start;
    }
    .list { display: grid; gap: 10px; }
    .list-item { padding: 14px; }
    .item-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .item-title { font-weight: 900; }
    .item-meta { color: var(--muted); font-size: 12px; margin-top: 5px; line-height: 1.5; }
    .item-content { margin-top: 10px; color: #39435a; line-height: 1.55; white-space: pre-wrap; }
    .item-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .tag {
      display: inline-flex;
      height: 24px;
      align-items: center;
      padding: 0 8px;
      border-radius: 999px;
      background: #eef3fa;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }
    .tag.urgent { color: var(--rose); background: #fff0f3; }
    .tag.important { color: var(--amber); background: #fff7e9; }
    .preview-card { padding: 18px; position: sticky; top: 18px; }
    .notice-preview {
      padding: 16px;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(47, 109, 246, 0.12), rgba(121, 87, 213, 0.10));
      border: 1px solid rgba(47, 109, 246, 0.18);
    }
    .notice-preview h3 { margin: 0 0 8px; font-size: 17px; }
    .notice-preview p { margin: 0; color: #47546c; line-height: 1.6; white-space: pre-wrap; }
    .feedback-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px 180px;
      gap: 12px;
      align-items: start;
    }
    .small-note { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    [hidden] { display: none !important; }
    @media (max-width: 1020px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar { position: static; border-right: 0; border-bottom: 1px solid var(--line); }
      .nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .split { grid-template-columns: 1fr; }
      .preview-card { position: static; }
    }
    @media (max-width: 640px) {
      .main { padding: 16px; }
      .topbar { flex-direction: column; align-items: flex-start; }
      .stats-grid, .form-grid, .feedback-row { grid-template-columns: 1fr; }
      .login-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main id="loginView" class="login-wrap" hidden>
    <div class="login-mark">课</div>
    <h1>佛课小表后台</h1>
    <p>使用 ADMIN_PASSWORD 或 ADMIN_TOKEN 登录。登录态写入 httpOnly Cookie，不会暴露给小程序端。</p>
    <div class="login-actions">
      <input id="loginPassword" type="password" autocomplete="current-password" placeholder="后台密码或令牌">
      <button id="loginButton" class="primary">进入</button>
    </div>
    <div id="loginError" class="error-line"></div>
  </main>

  <main id="dashboardView" class="app-shell" hidden>
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-badge">课</div>
        <div>
          <div class="brand-title">Admin Console</div>
          <div class="brand-subtitle">公告 · 数据 · 反馈</div>
        </div>
      </div>
      <nav class="nav">
        <button data-section="dashboard" class="active">数据概览</button>
        <button data-section="notices">公告管理</button>
        <button data-section="news">最新动态</button>
        <button data-section="config">数据版本</button>
        <button data-section="feedback">反馈查看</button>
        <button id="logoutButton">退出登录</button>
      </nav>
    </aside>

    <section class="main">
      <div class="topbar">
        <div>
          <h1 id="pageTitle">数据概览</h1>
          <p id="statusLine">正在加载后台数据...</p>
        </div>
        <div class="toolbar">
          <span class="status-pill" id="publishStatus">online</span>
          <button id="refreshButton" class="ghost">刷新</button>
        </div>
      </div>

      <section id="section-dashboard" class="section active">
        <div id="statsGrid" class="stats-grid"></div>
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">当前运行信息</div>
          </div>
          <div id="runtimeInfo" class="small-note"></div>
        </div>
      </section>

      <section id="section-notices" class="section">
        <div class="split">
          <div class="panel">
            <div class="panel-head">
              <div class="panel-title">编辑公告</div>
              <button id="clearNoticeButton" class="ghost">新建</button>
            </div>
            <div class="form-grid">
              <div><label>标题</label><input id="noticeTitle"></div>
              <div><label>版本号</label><input id="noticeVersion" placeholder="例如 2026.06.01-1"></div>
              <div><label>类型</label><select id="noticeType"><option>info</option><option>warning</option><option>success</option><option>update</option><option>maintenance</option></select></div>
              <div><label>优先级</label><select id="noticePriority"><option>normal</option><option>important</option><option>urgent</option></select></div>
              <div><label>展示模式</label><select id="noticeDisplayMode"><option>banner</option><option>modal</option><option>ticker</option><option>card</option></select></div>
              <div><label>展示位置</label><select id="noticeTargetPage"><option>all</option><option>home</option><option>today</option><option>school</option><option>settings</option></select></div>
              <div><label>开始时间</label><input id="noticeStartAt" placeholder="可留空"></div>
              <div><label>结束时间</label><input id="noticeEndAt" placeholder="可留空"></div>
              <div><label>启用</label><select id="noticeEnabled"><option value="true">启用</option><option value="false">停用</option></select></div>
              <div><label>可关闭</label><select id="noticeClosable"><option value="true">允许关闭</option><option value="false">不可关闭</option></select></div>
              <div class="full"><label>内容</label><textarea id="noticeContent"></textarea></div>
            </div>
            <div class="item-actions"><button id="saveNoticeButton" class="primary">保存公告</button></div>
          </div>
          <div class="preview-card">
            <div class="panel-head"><div class="panel-title">实时预览</div></div>
            <div class="notice-preview">
              <h3 id="noticePreviewTitle">公告标题</h3>
              <p id="noticePreviewContent">公告内容将在这里预览。</p>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">公告列表</div></div>
          <div id="noticeList" class="list"></div>
        </div>
      </section>

      <section id="section-news" class="section">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">编辑最新动态</div>
            <button id="clearNewsButton" class="ghost">新建</button>
          </div>
          <div class="form-grid">
            <div><label>标题</label><input id="newsTitle"></div>
            <div><label>标签</label><input id="newsTag" placeholder="数据更新 / 功能优化"></div>
            <div><label>日期</label><input id="newsDate" placeholder="可留空"></div>
            <div><label>链接</label><input id="newsLink" placeholder="可选"></div>
            <div><label>启用</label><select id="newsEnabled"><option value="true">启用</option><option value="false">停用</option></select></div>
            <div class="full"><label>摘要</label><textarea id="newsSummary"></textarea></div>
            <div class="full"><label>详情</label><textarea id="newsDetail"></textarea></div>
          </div>
          <div class="item-actions"><button id="saveNewsButton" class="primary">保存动态</button></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">动态列表</div></div>
          <div id="newsList" class="list"></div>
        </div>
      </section>

      <section id="section-config" class="section">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">数据版本与说明</div></div>
          <div class="form-grid">
            <div><label>小程序名称</label><input id="configAppName"></div>
            <div><label>当前学期</label><input id="configSemester"></div>
            <div><label>发布状态</label><input id="configPublishStatus"></div>
            <div><label>Release Version</label><input id="configReleaseVersion"></div>
            <div><label>班级课表更新时间</label><input id="configClassUpdatedAt"></div>
            <div><label>教师课表更新时间</label><input id="configTeacherUpdatedAt"></div>
            <div><label>教室课表更新时间</label><input id="configClassroomUpdatedAt"></div>
            <div><label>课程课表更新时间</label><input id="configCourseUpdatedAt"></div>
            <div class="full"><label>Release Note</label><textarea id="configReleaseNote"></textarea></div>
            <div class="full"><label>数据来源标签</label><textarea id="configDataSourceLabel"></textarea></div>
            <div class="full"><label>免责声明</label><textarea id="configDisclaimer"></textarea></div>
          </div>
          <div class="item-actions"><button id="saveConfigButton" class="primary">保存配置</button></div>
        </div>
      </section>

      <section id="section-feedback" class="section">
        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">用户反馈</div>
            <button id="loadFeedbackButton" class="ghost">刷新反馈</button>
          </div>
          <div id="feedbackList" class="list"></div>
        </div>
      </section>
    </section>
  </main>

  <script>
    (function () {
      var state = {
        section: "dashboard",
        dashboard: null,
        config: null,
        notices: [],
        news: [],
        feedbacks: [],
        editingNoticeId: "",
        editingNewsId: ""
      };

      var isLoginPage = location.pathname.indexOf("/login") >= 0;
      var loginView = document.getElementById("loginView");
      var dashboardView = document.getElementById("dashboardView");
      var statusLine = document.getElementById("statusLine");

      function $(id) { return document.getElementById(id); }
      function setStatus(text) { statusLine.textContent = text || ""; }
      function value(id) { return $(id).value.trim(); }
      function setValue(id, val) { $(id).value = val == null ? "" : String(val); }
      function boolValue(id) { return $(id).value === "true"; }
      function textNode(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        node.textContent = text == null ? "" : String(text);
        return node;
      }
      function formatDate(value) {
        if (!value) return "-";
        var d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        var pad = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }
      function api(path, options) {
        options = options || {};
        options.credentials = "include";
        options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        return fetch(path, options).then(function (res) {
          if (res.status === 401) {
            location.href = "/admin/login";
            throw new Error("请先登录后台");
          }
          return res.json().then(function (data) {
            if (!res.ok || data.success === false) {
              throw new Error(data.message || "请求失败");
            }
            return data;
          });
        });
      }
      function showLogin(message) {
        loginView.hidden = false;
        dashboardView.hidden = true;
        $("loginError").textContent = message || "";
        $("loginPassword").focus();
      }
      function showDashboard() {
        loginView.hidden = true;
        dashboardView.hidden = false;
      }
      function login() {
        var password = value("loginPassword");
        if (!password) {
          $("loginError").textContent = "请输入后台密码或令牌";
          return;
        }
        fetch("/api/admin/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password })
        }).then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok || !data.success) throw new Error(data.message || "登录失败");
            location.href = "/admin/dashboard";
          });
        }).catch(function (error) {
          $("loginError").textContent = error.message;
        });
      }
      function logout() {
        api("/api/admin/logout", { method: "POST", body: "{}" }).then(function () {
          location.href = "/admin/login";
        });
      }
      function switchSection(section) {
        state.section = section;
        document.querySelectorAll(".section").forEach(function (node) {
          node.classList.toggle("active", node.id === "section-" + section);
        });
        document.querySelectorAll(".nav button[data-section]").forEach(function (node) {
          node.classList.toggle("active", node.dataset.section === section);
        });
        var titles = {
          dashboard: "数据概览",
          notices: "公告管理",
          news: "最新动态",
          config: "数据版本",
          feedback: "反馈查看"
        };
        $("pageTitle").textContent = titles[section] || "Admin Console";
      }
      function renderDashboard() {
        var data = state.dashboard || {};
        var counts = data.counts || {};
        var version = data.dataVersion || {};
        $("publishStatus").textContent = data.publishStatus || "online";
        var stats = [
          ["当前学期", data.currentSemester || "-"],
          ["班级课表", counts.classScheduleCount || 0],
          ["教师课表", counts.teacherScheduleCount || 0],
          ["教室课表", counts.classroomScheduleCount || 0],
          ["课程课表", counts.courseScheduleCount || 0],
          ["最近反馈", counts.feedbackCount || 0],
          ["公告数量", counts.noticeCount || 0],
          ["启用公告", counts.enabledNoticeCount || 0]
        ];
        var wrap = $("statsGrid");
        wrap.textContent = "";
        stats.forEach(function (item) {
          var card = document.createElement("div");
          card.className = "stat-card";
          card.appendChild(textNode("div", "stat-label", item[0]));
          card.appendChild(textNode("div", "stat-value", item[1]));
          wrap.appendChild(card);
        });
        var lines = [
          "应用：" + (data.appName || "佛课小表"),
          "Release：" + (version.releaseVersion || "-"),
          "班级更新时间：" + formatDate(version.classScheduleUpdatedAt),
          "教师更新时间：" + formatDate(version.teacherScheduleUpdatedAt),
          "教室更新时间：" + formatDate(version.classroomScheduleUpdatedAt),
          "课程更新时间：" + formatDate(version.courseScheduleUpdatedAt),
          "说明：" + (version.releaseNote || "-")
        ];
        $("runtimeInfo").textContent = lines.join("\\n");
      }
      function renderConfigForm() {
        var config = state.config || {};
        var v = config.dataVersion || {};
        setValue("configAppName", config.appName || "");
        setValue("configSemester", config.currentSemester || "");
        setValue("configPublishStatus", config.publishStatus || "online");
        setValue("configReleaseVersion", v.releaseVersion || "");
        setValue("configClassUpdatedAt", v.classScheduleUpdatedAt || "");
        setValue("configTeacherUpdatedAt", v.teacherScheduleUpdatedAt || "");
        setValue("configClassroomUpdatedAt", v.classroomScheduleUpdatedAt || "");
        setValue("configCourseUpdatedAt", v.courseScheduleUpdatedAt || "");
        setValue("configReleaseNote", v.releaseNote || "");
        setValue("configDataSourceLabel", v.dataSourceLabel || "");
        setValue("configDisclaimer", config.disclaimer || "");
      }
      function saveConfig() {
        var payload = {
          appName: value("configAppName"),
          currentSemester: value("configSemester"),
          publishStatus: value("configPublishStatus"),
          disclaimer: value("configDisclaimer"),
          dataVersion: {
            releaseVersion: value("configReleaseVersion"),
            classScheduleUpdatedAt: value("configClassUpdatedAt"),
            teacherScheduleUpdatedAt: value("configTeacherUpdatedAt"),
            classroomScheduleUpdatedAt: value("configClassroomUpdatedAt"),
            courseScheduleUpdatedAt: value("configCourseUpdatedAt"),
            releaseNote: value("configReleaseNote"),
            dataSourceLabel: value("configDataSourceLabel")
          }
        };
        api("/api/admin/config", { method: "POST", body: JSON.stringify(payload) }).then(function () {
          setStatus("配置已保存");
          return loadAll();
        }).catch(function (error) { setStatus(error.message); });
      }
      function noticePayload() {
        return {
          title: value("noticeTitle"),
          content: value("noticeContent"),
          type: $("noticeType").value,
          priority: $("noticePriority").value,
          displayMode: $("noticeDisplayMode").value,
          targetPage: $("noticeTargetPage").value,
          startAt: value("noticeStartAt"),
          endAt: value("noticeEndAt"),
          enabled: boolValue("noticeEnabled"),
          closable: boolValue("noticeClosable"),
          version: value("noticeVersion")
        };
      }
      function updateNoticePreview() {
        $("noticePreviewTitle").textContent = value("noticeTitle") || "公告标题";
        $("noticePreviewContent").textContent = value("noticeContent") || "公告内容将在这里预览。";
      }
      function clearNoticeForm() {
        state.editingNoticeId = "";
        ["noticeTitle", "noticeContent", "noticeVersion", "noticeStartAt", "noticeEndAt"].forEach(function (id) { setValue(id, ""); });
        $("noticeType").value = "info";
        $("noticePriority").value = "normal";
        $("noticeDisplayMode").value = "banner";
        $("noticeTargetPage").value = "all";
        $("noticeEnabled").value = "true";
        $("noticeClosable").value = "true";
        updateNoticePreview();
      }
      function editNotice(item) {
        state.editingNoticeId = item.id;
        setValue("noticeTitle", item.title);
        setValue("noticeContent", item.content);
        setValue("noticeVersion", item.version);
        setValue("noticeStartAt", item.startAt);
        setValue("noticeEndAt", item.endAt);
        $("noticeType").value = item.type || "info";
        $("noticePriority").value = item.priority || "normal";
        $("noticeDisplayMode").value = item.displayMode || "banner";
        $("noticeTargetPage").value = item.targetPage || "all";
        $("noticeEnabled").value = item.enabled ? "true" : "false";
        $("noticeClosable").value = item.closable ? "true" : "false";
        updateNoticePreview();
      }
      function saveNotice() {
        var method = state.editingNoticeId ? "PUT" : "POST";
        var path = state.editingNoticeId ? "/api/admin/notices/" + encodeURIComponent(state.editingNoticeId) : "/api/admin/notices";
        api(path, { method: method, body: JSON.stringify(noticePayload()) }).then(function () {
          clearNoticeForm();
          setStatus("公告已保存");
          return loadNotices();
        }).catch(function (error) { setStatus(error.message); });
      }
      function renderNotices() {
        var wrap = $("noticeList");
        wrap.textContent = "";
        if (!state.notices.length) {
          wrap.appendChild(textNode("div", "small-note", "还没有公告。"));
          return;
        }
        state.notices.forEach(function (item) {
          var row = document.createElement("article");
          row.className = "list-item";
          var top = document.createElement("div");
          top.className = "item-top";
          var left = document.createElement("div");
          left.appendChild(textNode("div", "item-title", item.title));
          left.appendChild(textNode("div", "item-meta", item.targetPage + " / " + item.displayMode + " / " + formatDate(item.updatedAt)));
          var tag = textNode("span", "tag " + item.priority, item.priority + (item.enabled ? " · 启用" : " · 停用"));
          top.appendChild(left);
          top.appendChild(tag);
          row.appendChild(top);
          row.appendChild(textNode("div", "item-content", item.content));
          var actions = document.createElement("div");
          actions.className = "item-actions";
          var edit = document.createElement("button");
          edit.textContent = "编辑";
          edit.onclick = function () { editNotice(item); window.scrollTo({ top: 0, behavior: "smooth" }); };
          var del = document.createElement("button");
          del.className = "danger";
          del.textContent = "删除";
          del.onclick = function () {
            if (!confirm("确定删除这条公告？")) return;
            api("/api/admin/notices/" + encodeURIComponent(item.id), { method: "DELETE" }).then(loadNotices);
          };
          actions.appendChild(edit);
          actions.appendChild(del);
          row.appendChild(actions);
          wrap.appendChild(row);
        });
      }
      function newsPayload() {
        return {
          title: value("newsTitle"),
          summary: value("newsSummary"),
          detail: value("newsDetail"),
          tag: value("newsTag"),
          link: value("newsLink"),
          date: value("newsDate"),
          enabled: boolValue("newsEnabled")
        };
      }
      function clearNewsForm() {
        state.editingNewsId = "";
        ["newsTitle", "newsSummary", "newsDetail", "newsTag", "newsLink", "newsDate"].forEach(function (id) { setValue(id, ""); });
        $("newsEnabled").value = "true";
      }
      function editNews(item) {
        state.editingNewsId = item.id;
        setValue("newsTitle", item.title);
        setValue("newsSummary", item.summary);
        setValue("newsDetail", item.detail);
        setValue("newsTag", item.tag);
        setValue("newsLink", item.link);
        setValue("newsDate", item.date);
        $("newsEnabled").value = item.enabled ? "true" : "false";
      }
      function saveNews() {
        var method = state.editingNewsId ? "PUT" : "POST";
        var path = state.editingNewsId ? "/api/admin/news/" + encodeURIComponent(state.editingNewsId) : "/api/admin/news";
        api(path, { method: method, body: JSON.stringify(newsPayload()) }).then(function () {
          clearNewsForm();
          setStatus("动态已保存");
          return loadNews();
        }).catch(function (error) { setStatus(error.message); });
      }
      function renderNews() {
        var wrap = $("newsList");
        wrap.textContent = "";
        if (!state.news.length) {
          wrap.appendChild(textNode("div", "small-note", "还没有最新动态。"));
          return;
        }
        state.news.forEach(function (item) {
          var row = document.createElement("article");
          row.className = "list-item";
          var top = document.createElement("div");
          top.className = "item-top";
          var left = document.createElement("div");
          left.appendChild(textNode("div", "item-title", item.title));
          left.appendChild(textNode("div", "item-meta", (item.tag || "动态") + " / " + formatDate(item.date) + (item.enabled ? " / 启用" : " / 停用")));
          top.appendChild(left);
          top.appendChild(textNode("span", "tag", item.enabled ? "enabled" : "disabled"));
          row.appendChild(top);
          row.appendChild(textNode("div", "item-content", item.summary || item.detail || ""));
          var actions = document.createElement("div");
          actions.className = "item-actions";
          var edit = document.createElement("button");
          edit.textContent = "编辑";
          edit.onclick = function () { editNews(item); switchSection("news"); window.scrollTo({ top: 0, behavior: "smooth" }); };
          var del = document.createElement("button");
          del.className = "danger";
          del.textContent = "删除";
          del.onclick = function () {
            if (!confirm("确定删除这条动态？")) return;
            api("/api/admin/news/" + encodeURIComponent(item.id), { method: "DELETE" }).then(loadNews);
          };
          actions.appendChild(edit);
          actions.appendChild(del);
          row.appendChild(actions);
          wrap.appendChild(row);
        });
      }
      function renderFeedbacks() {
        var wrap = $("feedbackList");
        wrap.textContent = "";
        if (!state.feedbacks.length) {
          wrap.appendChild(textNode("div", "small-note", "当前没有反馈。"));
          return;
        }
        state.feedbacks.forEach(function (item) {
          var row = document.createElement("article");
          row.className = "list-item";
          var grid = document.createElement("div");
          grid.className = "feedback-row";
          var main = document.createElement("div");
          main.appendChild(textNode("div", "item-title", item.type + " · " + formatDate(item.createdAt)));
          main.appendChild(textNode("div", "item-meta", "页面：" + (item.page || "-") + " / 联系：" + (item.contact || "-")));
          main.appendChild(textNode("div", "item-content", item.content || ""));
          var statusBox = document.createElement("div");
          var select = document.createElement("select");
          ["open", "processing", "resolved", "ignored"].forEach(function (status) {
            var option = document.createElement("option");
            option.value = status;
            option.textContent = status;
            select.appendChild(option);
          });
          select.value = item.status || "open";
          statusBox.appendChild(select);
          var noteBox = document.createElement("div");
          var note = document.createElement("textarea");
          note.value = item.adminNote || "";
          note.placeholder = "管理员备注";
          noteBox.appendChild(note);
          grid.appendChild(main);
          grid.appendChild(statusBox);
          grid.appendChild(noteBox);
          row.appendChild(grid);
          var actions = document.createElement("div");
          actions.className = "item-actions";
          var save = document.createElement("button");
          save.className = "primary";
          save.textContent = "保存处理";
          save.onclick = function () {
            api("/api/admin/feedbacks/" + encodeURIComponent(item.id), {
              method: "PUT",
              body: JSON.stringify({ status: select.value, adminNote: note.value })
            }).then(loadFeedbacks);
          };
          actions.appendChild(save);
          row.appendChild(actions);
          wrap.appendChild(row);
        });
      }
      function loadDashboard() {
        return api("/api/admin/dashboard").then(function (data) {
          state.dashboard = data.data || {};
          renderDashboard();
        });
      }
      function loadConfig() {
        return api("/api/admin/config").then(function (data) {
          state.config = data.data || {};
          renderConfigForm();
        });
      }
      function loadNotices() {
        return api("/api/admin/notices").then(function (data) {
          state.notices = data.items || [];
          renderNotices();
        });
      }
      function loadNews() {
        return api("/api/admin/news").then(function (data) {
          state.news = data.items || [];
          renderNews();
        });
      }
      function loadFeedbacks() {
        return api("/api/admin/feedbacks?limit=100").then(function (data) {
          state.feedbacks = data.items || [];
          renderFeedbacks();
        });
      }
      function loadAll() {
        showDashboard();
        setStatus("正在加载...");
        return Promise.all([loadDashboard(), loadConfig(), loadNotices(), loadNews(), loadFeedbacks()])
          .then(function () { setStatus("最近刷新：" + formatDate(new Date().toISOString())); })
          .catch(function (error) { setStatus(error.message); });
      }
      document.querySelectorAll(".nav button[data-section]").forEach(function (button) {
        button.addEventListener("click", function () { switchSection(button.dataset.section); });
      });
      ["noticeTitle", "noticeContent"].forEach(function (id) { $(id).addEventListener("input", updateNoticePreview); });
      $("loginButton").addEventListener("click", login);
      $("loginPassword").addEventListener("keydown", function (event) { if (event.key === "Enter") login(); });
      $("logoutButton").addEventListener("click", logout);
      $("refreshButton").addEventListener("click", loadAll);
      $("saveConfigButton").addEventListener("click", saveConfig);
      $("saveNoticeButton").addEventListener("click", saveNotice);
      $("clearNoticeButton").addEventListener("click", clearNoticeForm);
      $("saveNewsButton").addEventListener("click", saveNews);
      $("clearNewsButton").addEventListener("click", clearNewsForm);
      $("loadFeedbackButton").addEventListener("click", loadFeedbacks);
      clearNoticeForm();
      clearNewsForm();
      if (isLoginPage) {
        showLogin();
      } else {
        loadAll();
      }
    })();
  </script>
</body>
</html>`;

function sendAdminHtml(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'"
  );
  res.type("html").send(adminConsoleHtml);
}

router.get("/", (req, res) => {
  if (adminAuth.isAdminCookieValid(req)) {
    return res.redirect("/admin/dashboard");
  }
  return res.redirect("/admin/login");
});

router.get("/login", (req, res) => {
  sendAdminHtml(res);
});

router.get(["/dashboard", "/feedback"], (req, res) => {
  if (!adminAuth.isAdminCookieValid(req)) {
    return res.redirect("/admin/login");
  }
  return sendAdminHtml(res);
});

module.exports = router;
