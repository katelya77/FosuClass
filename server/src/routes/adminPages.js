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
      --bg: #f3f4f6;
      --card-bg: rgba(255, 255, 255, 0.78);
      --card-border: rgba(99, 102, 241, 0.08);
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --primary-light: #e0e7ff;
      --secondary: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text-main: #1f2937;
      --text-muted: #6b7280;
      --text-light: #9ca3af;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      background: radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.05) 0%, transparent 40%),
                  radial-gradient(circle at 90% 80%, rgba(6, 182, 212, 0.04) 0%, transparent 40%),
                  #f9fafb;
      color: var(--text-main);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* 玻璃拟态卡片 */
    .glass-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.03), 0 8px 10px -6px rgba(0, 0, 0, 0.03);
      padding: 24px;
      transition: var(--transition);
    }
    .glass-card:hover {
      border-color: rgba(99, 102, 241, 0.16);
      box-shadow: 0 20px 30px -10px rgba(99, 102, 241, 0.06);
    }

    /* 通用输入框和表单 */
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      margin-bottom: 6px;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid rgba(209, 213, 219, 0.8);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.9);
      color: var(--text-main);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: var(--transition);
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
    }
    textarea {
      min-height: 80px;
      resize: vertical;
    }

    /* 按钮 */
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: var(--transition);
      gap: 6px;
    }
    button.primary {
      background: linear-gradient(135deg, var(--primary), #6366f1);
      color: #ffffff;
    }
    button.primary:hover {
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
      transform: translateY(-1px);
    }
    button.secondary {
      background: var(--primary-light);
      color: var(--primary);
    }
    button.secondary:hover {
      background: #d0d7f7;
    }
    button.danger {
      background: #fee2e2;
      color: var(--danger);
    }
    button.danger:hover {
      background: #fca5a5;
      color: #7f1d1d;
    }
    button.ghost {
      background: transparent;
      border: 1px solid rgba(209, 213, 219, 0.8);
      color: var(--text-muted);
    }
    button.ghost:hover {
      background: #f3f4f6;
      color: var(--text-main);
    }
    button.text-btn {
      background: transparent;
      color: var(--primary);
      padding: 0;
      font-size: 13px;
    }
    button.text-btn:hover {
      text-decoration: underline;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* 页面骨架 */
    .login-wrap {
      width: min(440px, calc(100% - 32px));
      margin: 15vh auto;
    }
    .login-logo {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      color: white;
      font-size: 26px;
      font-weight: 800;
      display: grid;
      place-items: center;
      margin-bottom: 24px;
      box-shadow: 0 8px 16px rgba(79, 70, 229, 0.2);
    }
    .login-wrap h1 {
      font-size: 26px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .login-wrap p {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
    }
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .login-error {
      color: var(--danger);
      font-size: 13px;
      min-height: 20px;
    }

    /* 后台主 Shell */
    .app-shell {
      display: grid;
      grid-template-columns: 260px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-right: 1px solid rgba(229, 231, 235, 0.8);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 30px 20px;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 30px;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      color: white;
      font-size: 20px;
      font-weight: 800;
      display: grid;
      place-items: center;
      box-shadow: 0 4px 10px rgba(79, 70, 229, 0.15);
    }
    .brand-title {
      font-size: 17px;
      font-weight: 800;
      color: var(--text-main);
    }
    .brand-subtitle {
      font-size: 11px;
      color: var(--text-muted);
    }

    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      list-style: none;
    }
    .nav-item button {
      width: 100%;
      justify-content: flex-start;
      padding: 10px 16px;
      background: transparent;
      color: var(--text-muted);
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .nav-item button:hover {
      background: rgba(243, 244, 246, 0.8);
      color: var(--text-main);
    }
    .nav-item.active button {
      background: var(--primary-light);
      color: var(--primary);
    }

    .sidebar-footer {
      border-top: 1px solid rgba(229, 231, 235, 0.8);
      padding-top: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .env-tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: 999px;
      align-self: flex-start;
    }
    .env-tag.production { background: #fee2e2; color: var(--danger); }
    .env-tag.local { background: #e0f2fe; color: #0369a1; }
    .env-tag.development { background: #fef3c7; color: #b45309; }

    /* 主体内容 */
    .main-content {
      padding: 40px;
      overflow-y: auto;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 30px;
    }
    .topbar h2 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .topbar p {
      color: var(--text-muted);
      font-size: 14px;
      margin-top: 4px;
    }

    /* 模块展现 */
    .section {
      display: none;
      animation: fadeIn 0.3s ease;
    }
    .section.active {
      display: block;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Dashboard 数据卡片 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 18px;
      margin-bottom: 30px;
    }
    .stat-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 108px;
    }
    .stat-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
    }
    .stat-icon {
      font-size: 18px;
      opacity: 0.8;
    }
    .stat-num {
      font-size: 26px;
      font-weight: 800;
      color: var(--text-main);
      margin-top: 8px;
    }
    .stat-foot {
      font-size: 11px;
      color: var(--text-light);
      margin-top: 8px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    /* Dashboard 概览下半部 */
    .dash-columns {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 24px;
    }
    .preview-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 14px;
    }
    .preview-item {
      padding: 12px 16px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.4);
      border: 1px solid rgba(229, 231, 235, 0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .preview-title {
      font-size: 14px;
      font-weight: 600;
    }
    .preview-meta {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 3px;
    }

    /* 健康状态检测 */
    .health-box {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .health-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--text-light);
    }
    .health-dot.checking { background: var(--warning); animation: pulse 1s infinite alternate; }
    .health-dot.healthy { background: var(--success); }
    .health-dot.error { background: var(--danger); }
    @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }

    /* 双栏式编辑布局 */
    .split-layout {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 24px;
      align-items: start;
    }
    .form-box {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .form-row.full {
      grid-template-columns: 1fr;
    }

    /* 实时预览（模拟小程序效果） */
    .preview-box {
      position: sticky;
      top: 30px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .preview-phone {
      border: 10px solid #2d3748;
      border-radius: 28px;
      background: #f3f4f6;
      width: 320px;
      height: 520px;
      padding: 16px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.15);
    }
    .phone-bar {
      height: 20px;
      background: transparent;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      font-weight: 700;
      color: #1a202c;
      padding: 0 8px;
      margin-bottom: 10px;
    }
    .phone-screen {
      height: calc(100% - 30px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .phone-title {
      font-size: 13px;
      font-weight: 800;
      color: #1a202c;
      margin-bottom: 4px;
    }

    /* 小程序模式卡片预览 */
    .mini-banner {
      background: #eef2ff;
      border-left: 4px solid var(--primary);
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 11px;
      color: #3730a3;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    .mini-banner.urgent { background: #fee2e2; border-left-color: var(--danger); color: #991b1b; }
    .mini-banner.warning { background: #fef3c7; border-left-color: var(--warning); color: #92400e; }
    .mini-banner.success { background: #ecfdf5; border-left-color: var(--success); color: #065f46; }

    .mini-modal-mask {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      display: grid;
      place-items: center;
      padding: 24px;
      z-index: 10;
    }
    .mini-modal {
      background: #ffffff;
      border-radius: 12px;
      width: 100%;
      padding: 16px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.1);
      text-align: center;
    }
    .mini-modal h4 { font-size: 13px; font-weight: 800; margin-bottom: 6px; }
    .mini-modal p { font-size: 10px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; }
    .mini-modal button { padding: 4px 12px; border-radius: 6px; font-size: 11px; width: 100%; background: var(--primary); color: white; }

    .mini-ticker {
      background: #1f2937;
      color: #ffffff;
      padding: 6px 12px;
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      border-radius: 4px;
      position: relative;
    }
    .mini-ticker-content {
      display: inline-block;
      animation: marquee 10s linear infinite;
    }
    @keyframes marquee {
      0% { transform: translateX(100%); }
      100% { transform: translateX(-100%); }
    }

    .mini-card {
      background: #ffffff;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
      border: 1px solid rgba(229, 231, 235, 0.8);
      font-size: 11px;
    }
    .mini-card h4 { font-weight: 700; color: #1a202c; margin-bottom: 4px; }
    .mini-card p { color: var(--text-muted); line-height: 1.4; }

    /* 小程序动态预览 */
    .mini-news-card {
      background: #ffffff;
      border-radius: 10px;
      padding: 14px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      border: 1px solid rgba(229, 231, 235, 0.6);
    }
    .mini-news-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .mini-news-tag {
      background: #eff6ff;
      color: #2563eb;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .mini-news-date {
      font-size: 9px;
      color: var(--text-light);
    }
    .mini-news-title {
      font-size: 12px;
      font-weight: 800;
      color: #1e293b;
      margin-bottom: 4px;
    }
    .mini-news-summary {
      font-size: 10px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    /* 数据列表与表格 */
    .table-container {
      overflow-x: auto;
      margin-top: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th, td {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(229, 231, 235, 0.6);
      font-size: 13px;
    }
    th {
      font-weight: 700;
      background: rgba(243, 244, 246, 0.5);
      color: var(--text-muted);
    }
    tr:hover td {
      background: rgba(249, 250, 251, 0.7);
    }

    /* 状态徽章 */
    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .badge.info { background: #e0f2fe; color: #0369a1; }
    .badge.warning { background: #fef3c7; color: #b45309; }
    .badge.success { background: #d1fae5; color: #065f46; }
    .badge.danger { background: #fee2e2; color: #991b1b; }
    .badge.muted { background: #f3f4f6; color: #4b5563; }

    /* 弹出模态框 / 抽屉 */
    .drawer-mask {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(4px);
      z-index: 100;
      display: none;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .drawer {
      position: fixed;
      top: 0; right: -460px; bottom: 0;
      width: 100%;
      max-width: 440px;
      background: #ffffff;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.1);
      z-index: 101;
      padding: 30px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .drawer-mask.show { display: block; opacity: 1; }
    .drawer.show { right: 0; }
    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      border-bottom: 1px solid #f3f4f6;
      padding-bottom: 14px;
    }
    .drawer-header h3 { font-size: 18px; font-weight: 800; }
    .drawer-close { font-size: 22px; cursor: pointer; color: var(--text-light); }
    .drawer-close:hover { color: var(--text-main); }
    
    .drawer-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-footer {
      border-top: 1px solid #f3f4f6;
      padding-top: 20px;
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    /* 反馈卡片布局 */
    .feedback-meta-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      background: #f8fafc;
      padding: 12px;
      border-radius: 8px;
      font-size: 12px;
    }
    .feedback-meta-item {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .feedback-meta-label { color: var(--text-muted); font-weight: 600; margin-right: 4px;}

    /* 搜索栏与过滤 */
    .filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      gap: 12px;
    }
    .search-input-wrap {
      position: relative;
      max-width: 300px;
      width: 100%;
    }
    .tab-filter {
      display: flex;
      background: #f3f4f6;
      padding: 4px;
      border-radius: 8px;
      gap: 2px;
    }
    .tab-filter button {
      padding: 6px 12px;
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
    }
    .tab-filter button.active {
      background: #ffffff;
      color: var(--text-main);
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
    }

    /* Toast 浮层样式 */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1f2937;
      color: white;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      z-index: 1000;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.success { border-left: 4px solid var(--success); }
    .toast.error { border-left: 4px solid var(--danger); }

    /* 折叠组件 */
    .collapse-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      cursor: pointer;
      border-bottom: 1px dashed rgba(229, 231, 235, 0.8);
      font-size: 13px;
      font-weight: 700;
      color: var(--primary);
    }
    .collapse-content {
      display: none;
      padding-top: 12px;
    }
    .collapse-content.open { display: block; }

    @media (max-width: 1024px) {
      .app-shell { grid-template-columns: 1fr; }
      .sidebar { height: auto; border-right: none; border-bottom: 1px solid rgba(229, 231, 235, 0.8); }
      .nav-list { flex-direction: row; flex-wrap: wrap; }
      .split-layout { grid-template-columns: 1fr; }
      .preview-box { position: static; }
      .dash-columns { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <!-- 登录页视图 -->
  <main id="loginView" class="login-wrap glass-card" hidden>
    <div class="login-logo">课</div>
    <h1>佛课小表后台</h1>
    <p>管理端控制台安全验证。请输入管理员密码或 Token 进行授权登录。</p>
    <div class="login-form">
      <div>
        <label for="loginPassword">安全凭据 (Password / Token)</label>
        <input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码">
      </div>
      <button id="loginButton" class="primary">验证登录</button>
      <div id="loginError" class="login-error"></div>
    </div>
  </main>

  <!-- 控制台主页面 -->
  <main id="dashboardView" class="app-shell" hidden>
    <!-- 左侧导航侧边栏 -->
    <aside class="sidebar">
      <div>
        <div class="brand">
          <div class="brand-icon">课</div>
          <div>
            <div class="brand-title">佛课小表</div>
            <div class="brand-subtitle">Admin Console v1.2</div>
          </div>
        </div>
        <nav>
          <ul class="nav-list">
            <li class="nav-item active" data-section="dashboard"><button>数据概览</button></li>
            <li class="nav-item" data-section="notices"><button>公告管理</button></li>
            <li class="nav-item" data-section="news"><button>最新动态</button></li>
            <li class="nav-item" data-section="config"><button>数据版本</button></li>
            <li class="nav-item" data-section="feedback"><button>反馈管理</button></li>
          </ul>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div class="env-info">
          <span id="envTag" class="env-tag local">local</span>
          <span style="font-size: 11px; color: var(--text-light); margin-left: 6px;" id="versionLabel">-</span>
        </div>
        <button id="logoutButton" class="danger">退出登录</button>
      </div>
    </aside>

    <!-- 右侧主体内容 -->
    <div class="main-content">
      <div class="topbar">
        <div>
          <h2 id="pageTitle">数据概览</h2>
          <p id="statusLine">加载中...</p>
        </div>
        <div>
          <button id="refreshButton" class="secondary">一键刷新</button>
        </div>
      </div>

      <!-- 面板一：数据概览 Dashboard -->
      <section id="section-dashboard" class="section active">
        <div class="stats-grid" id="statsGrid">
          <!-- 动态加载 10 张卡片 -->
        </div>

        <div class="dash-columns">
          <div class="glass-card">
            <h3 class="panel-title" style="margin-bottom: 12px;">系统健康状态</h3>
            <div class="health-box">
              <div id="healthStatusDot" class="health-dot"></div>
              <span id="healthStatusLabel" style="font-size: 13px; font-weight: 600;">检测中...</span>
              <button class="text-btn" id="recheckHealthBtn" style="margin-left: auto;">重新检测</button>
            </div>
            
            <h3 class="panel-title" style="margin-top: 24px; margin-bottom: 12px;">快速配置链接</h3>
            <div style="display: flex; gap: 8px;">
              <button id="copyConfigApiBtn" class="ghost" style="flex: 1;">复制 app-config 接口地址</button>
              <button id="openConfigApiBtn" class="ghost" style="flex: 1;">打开公开配置接口</button>
            </div>
          </div>
          
          <div class="glass-card">
            <h3 class="panel-title">最近上报反馈</h3>
            <div id="recentFeedbackPreview" class="preview-list">
              <!-- 加载反馈预览 -->
            </div>
          </div>
        </div>
      </section>

      <!-- 面板二：公告管理 -->
      <section id="section-notices" class="section">
        <div class="split-layout">
          <div class="glass-card form-box">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 id="noticeFormTitle">新建公告</h3>
              <button id="clearNoticeButton" class="ghost">清除表单</button>
            </div>
            
            <div class="form-row">
              <div>
                <label>标题</label>
                <input id="noticeTitle" placeholder="例如：强智教务数据升级维护中">
              </div>
              <div>
                <label>版本标识符 (Version)</label>
                <input id="noticeVersion" placeholder="例如：20260601-1">
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>公告类型 (Type)</label>
                <select id="noticeType">
                  <option value="info">常规 (info)</option>
                  <option value="warning">警告 (warning)</option>
                  <option value="success">成功 (success)</option>
                  <option value="update">更新 (update)</option>
                  <option value="maintenance">维护 (maintenance)</option>
                </select>
              </div>
              <div>
                <label>优先级 (Priority)</label>
                <select id="noticePriority">
                  <option value="normal">普通 (normal)</option>
                  <option value="important">重要 (important)</option>
                  <option value="urgent">紧急 (urgent)</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>展示位置 (Target Page)</label>
                <select id="noticeTargetPage">
                  <option value="all">所有页面 (all)</option>
                  <option value="home">小程序首页 (home)</option>
                  <option value="today">今日课表 (today)</option>
                  <option value="school">全校查询 (school)</option>
                  <option value="settings">个人设置 (settings)</option>
                </select>
              </div>
              <div>
                <label>展示模式 (Display Mode)</label>
                <select id="noticeDisplayMode">
                  <option value="banner">顶部横幅 (banner)</option>
                  <option value="modal">弹窗提醒 (modal)</option>
                  <option value="ticker">跑马灯 ticker</option>
                  <option value="card">普通卡片 (card)</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>生效开始时间 (选填)</label>
                <input id="noticeStartAt" placeholder="YYYY-MM-DD HH:MM">
              </div>
              <div>
                <label>生效结束时间 (选填)</label>
                <input id="noticeEndAt" placeholder="YYYY-MM-DD HH:MM">
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>是否启用</label>
                <select id="noticeEnabled">
                  <option value="true">启用展示</option>
                  <option value="false">停用展示</option>
                </select>
              </div>
              <div>
                <label>是否允许用户关闭</label>
                <select id="noticeClosable">
                  <option value="true">允许关闭 (保留缓存)</option>
                  <option value="false">不可关闭 (强制展示)</option>
                </select>
              </div>
            </div>

            <div class="form-row full">
              <div>
                <label>公告正文内容</label>
                <textarea id="noticeContent" placeholder="在此输入公告正文内容...支持换行。"></textarea>
              </div>
            </div>

            <button id="saveNoticeButton" class="primary">保存并应用公告</button>
          </div>

          <!-- 实时预览区 -->
          <div class="preview-box">
            <h3 style="font-size: 16px; font-weight: 700;">小程序端实时预览</h3>
            <div class="preview-phone">
              <div class="phone-bar">
                <span>9:41</span>
                <span>FosuClass 佛大</span>
              </div>
              <div class="phone-screen" id="noticePhoneScreen">
                <!-- 动态展示四种模式预览 -->
              </div>
            </div>
          </div>
        </div>

        <div class="glass-card" style="margin-top: 24px;">
          <h3 class="panel-title" style="margin-bottom: 16px;">公告列表</h3>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>类型/模式</th>
                  <th>展示页面</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="noticeListTable"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 面板三：最新动态 -->
      <section id="section-news" class="section">
        <div class="split-layout">
          <div class="glass-card form-box">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 id="newsFormTitle">添加最新动态</h3>
              <button id="clearNewsButton" class="ghost">清除表单</button>
            </div>
            
            <div class="form-row">
              <div>
                <label>动态标题</label>
                <input id="newsTitle" placeholder="例如：2026 春季学期全校课表上线">
              </div>
              <div>
                <label>徽章标签 (Tag)</label>
                <input id="newsTag" placeholder="例如：数据更新 / 功能升级">
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>显示日期 (选填)</label>
                <input id="newsDate" placeholder="YYYY-MM-DD">
              </div>
              <div>
                <label>外链链接 (可选)</label>
                <input id="newsLink" placeholder="例如：https://mp.weixin.qq.com/... (选填)">
              </div>
            </div>

            <div class="form-row full">
              <div>
                <label>是否启用</label>
                <select id="newsEnabled">
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </select>
              </div>
            </div>

            <div class="form-row full">
              <div>
                <label>摘要内容 (显示在外面列表)</label>
                <textarea id="newsSummary" placeholder="动态的简要说明，100字以内..."></textarea>
              </div>
            </div>

            <div class="form-row full">
              <div>
                <label>详情正文内容 (折叠或点开后展示)</label>
                <textarea id="newsDetail" placeholder="动态的详细说明，支持多行..."></textarea>
              </div>
            </div>

            <button id="saveNewsButton" class="primary">保存动态</button>
          </div>

          <div class="preview-box">
            <h3 style="font-size: 16px; font-weight: 700;">小程序卡片展示预览</h3>
            <div class="preview-phone">
              <div class="phone-bar">
                <span>9:41</span>
                <span>动态公告</span>
              </div>
              <div class="phone-screen" id="newsPhoneScreen">
                <!-- 动态预览小程序动态卡片 -->
              </div>
            </div>
          </div>
        </div>

        <div class="glass-card" style="margin-top: 24px;">
          <h3 class="panel-title" style="margin-bottom: 16px;">动态列表</h3>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>标签</th>
                  <th>日期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="newsListTable"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 面板四：数据版本 -->
      <section id="section-config" class="section">
        <div class="glass-card form-box">
          <h3 class="panel-title">数据状态中心 (App Config)</h3>
          
          <div class="form-row">
            <div>
              <label>小程序名称</label>
              <input id="configAppName">
            </div>
            <div>
              <label>当前学期 (如 2025-2026-2)</label>
              <input id="configSemester">
            </div>
          </div>

          <div class="form-row">
            <div>
              <label>Release Version (发布版本号)</label>
              <div style="display: flex; gap: 8px;">
                <input id="configReleaseVersion" placeholder="例如：2026.06.01-1">
                <button id="generateVersionBtn" class="secondary" style="white-space: nowrap;">一键生成</button>
              </div>
            </div>
            <div>
              <label>发布状态 (online / upgrade / audit)</label>
              <select id="configPublishStatus">
                <option value="online">在线服务 (online)</option>
                <option value="maintenance">升级维护 (maintenance)</option>
                <option value="audit">提审过审状态 (audit)</option>
              </select>
            </div>
          </div>

          <div class="form-row" style="grid-template-columns: 1fr 1fr;">
            <div>
              <label>行政班级课表数据更新时间</label>
              <div style="display: flex; gap: 6px;">
                <input id="configClassUpdatedAt">
                <button class="secondary text-btn-time" data-target="configClassUpdatedAt" style="white-space: nowrap; font-size: 11px;">设为当前</button>
              </div>
            </div>
            <div>
              <label>教师课表数据更新时间</label>
              <div style="display: flex; gap: 6px;">
                <input id="configTeacherUpdatedAt">
                <button class="secondary text-btn-time" data-target="configTeacherUpdatedAt" style="white-space: nowrap; font-size: 11px;">设为当前</button>
              </div>
            </div>
          </div>

          <div class="form-row" style="grid-template-columns: 1fr 1fr;">
            <div>
              <label>教室课表数据更新时间</label>
              <div style="display: flex; gap: 6px;">
                <input id="configClassroomUpdatedAt">
                <button class="secondary text-btn-time" data-target="configClassroomUpdatedAt" style="white-space: nowrap; font-size: 11px;">设为当前</button>
              </div>
            </div>
            <div>
              <label>全校课程课表数据更新时间</label>
              <div style="display: flex; gap: 6px;">
                <input id="configCourseUpdatedAt">
                <button class="secondary text-btn-time" data-target="configCourseUpdatedAt" style="white-space: nowrap; font-size: 11px;">设为当前</button>
              </div>
            </div>
          </div>

          <div class="form-row full">
            <div>
              <label>更新日志摘要 (Release Note)</label>
              <textarea id="configReleaseNote" placeholder="例如：全校课表数据已更新"></textarea>
            </div>
          </div>

          <div class="form-row full">
            <div>
              <label>数据来源标签 (Data Source Label)</label>
              <input id="configDataSourceLabel" placeholder="例如：教务系统快照 / 用户反馈修正 / 本地维护">
            </div>
          </div>

          <div class="form-row full">
            <div class="collapse-header" id="disclaimerCollapseHeader">
              <span>编辑免责声明条款 (Disclaimer) [点击展开/收起]</span>
              <span id="collapseIcon">▼</span>
            </div>
            <div class="collapse-content" id="disclaimerCollapseContent">
              <label>免责声明详细内容</label>
              <textarea id="configDisclaimer" style="min-height: 120px;"></textarea>
            </div>
          </div>

          <button id="saveConfigButton" class="primary" style="margin-top: 14px;">保存配置并立即发布</button>
        </div>
      </section>

      <!-- 面板五：用户反馈管理 -->
      <section id="section-feedback" class="section">
        <div class="glass-card">
          <div class="filter-bar">
            <div class="search-input-wrap">
              <input id="feedbackSearch" placeholder="关键词搜索 (内容/班级/联系方式)">
            </div>
            <div class="tab-filter" id="feedbackStatusTabs">
              <button class="active" data-status="all">全部</button>
              <button data-status="open">待处理</button>
              <button data-status="processing">处理中</button>
              <button data-status="resolved">已解决</button>
              <button data-status="ignored">已忽略</button>
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>反馈摘要</th>
                  <th>来源页面</th>
                  <th>状态</th>
                  <th>联系方式</th>
                  <th>相关班级/课表</th>
                  <th>提交时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="feedbackListTable"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </main>

  <!-- 反馈详情抽屉 -->
  <div class="drawer-mask" id="drawerMask"></div>
  <div class="drawer" id="feedbackDrawer">
    <div class="drawer-header">
      <h3>反馈详情</h3>
      <span class="drawer-close" id="closeDrawerBtn">&times;</span>
    </div>
    <div class="drawer-body">
      <div>
        <label>反馈类型</label>
        <span class="badge info" id="drawerType">-</span>
      </div>
      <div>
        <label>内容</label>
        <div id="drawerContent" style="padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 13px; white-space: pre-wrap; word-break: break-all;">-</div>
      </div>
      
      <div class="feedback-meta-list">
        <div class="feedback-meta-item"><span class="feedback-meta-label">页面:</span><span id="drawerPage">-</span></div>
        <div class="feedback-meta-item"><span class="feedback-meta-label">联系方式:</span><span id="drawerContact">-</span></div>
        <div class="feedback-meta-item"><span class="feedback-meta-label">当前学期:</span><span id="drawerSemester">-</span></div>
        <div class="feedback-meta-item"><span class="feedback-meta-label">数据版本:</span><span id="drawerDataVersion">-</span></div>
        <div class="feedback-meta-item"><span class="feedback-meta-label">版本:</span><span id="drawerAppVersion">-</span></div>
        <div class="feedback-meta-item"><span class="feedback-meta-label">平台:</span><span id="drawerPlatform">-</span></div>
      </div>

      <div id="drawerScheduleInfoBlock" style="display: none;">
        <label>关联课表/班级</label>
        <div id="drawerScheduleInfo" style="padding: 10px; background: #f0fdf4; border-radius: 8px; font-size: 12px; color: #15803d;">-</div>
      </div>

      <div>
        <label>处理状态</label>
        <select id="drawerStatusSelect">
          <option value="open">待处理 (open)</option>
          <option value="processing">处理中 (processing)</option>
          <option value="resolved">已解决 (resolved)</option>
          <option value="ignored">已忽略 (ignored)</option>
        </select>
      </div>

      <div>
        <label>管理员处理备注</label>
        <textarea id="drawerAdminNote" placeholder="在此处记录处理过程、解决方案或核对结果..."></textarea>
      </div>
    </div>
    <div class="drawer-footer">
      <button class="ghost" id="cancelDrawerBtn">取消</button>
      <button class="primary" id="saveDrawerBtn">保存处理记录</button>
    </div>
  </div>

  <script>
    (function () {
      // 1. 状态管理
      var state = {
        section: "dashboard",
        dashboard: null,
        config: null,
        notices: [],
        news: [],
        feedbacks: [],
        editingNoticeId: "",
        editingNewsId: "",
        feedbackFilter: {
          status: "all",
          keyword: ""
        },
        currentFeedback: null
      };

      var isLoginPage = location.pathname.indexOf("/login") >= 0;
      var loginView = document.getElementById("loginView");
      var dashboardView = document.getElementById("dashboardView");
      var statusLine = document.getElementById("statusLine");

      // 2. 辅助选择器与工具函数
      function $(id) { return document.getElementById(id); }
      function setStatus(text) { statusLine.textContent = text || ""; }
      function value(id) { return $(id).value.trim(); }
      function setValue(id, val) { $(id).value = val == null ? "" : String(val); }
      function boolValue(id) { return $(id).value === "true"; }
      
      // XSS 转义函数
      function escapeHtml(str) {
        if (str === undefined || str === null) return "";
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function formatDate(value) {
        if (!value) return "-";
        var d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        var pad = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }

      // Toast 弹窗系统
      function showToast(message, type) {
        type = type || "success";
        var toast = document.createElement("div");
        toast.className = "toast " + type;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.classList.add("show"); }, 50);
        setTimeout(function() {
          toast.classList.remove("show");
          setTimeout(function() { toast.remove(); }, 300);
        }, 3000);
      }

      // 3. API 请求封装
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

      // 4. 登录/登出处理
      function login() {
        var password = value("loginPassword");
        if (!password) {
          $("loginError").textContent = "请输入验证密码";
          return;
        }
        fetch("/api/admin/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password })
        }).then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok || !data.success) throw new Error(data.message || "密码不正确");
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

      // 5. 导航切换
      function switchSection(section) {
        state.section = section;
        document.querySelectorAll(".section").forEach(function (node) {
          node.classList.toggle("active", node.id === "section-" + section);
        });
        document.querySelectorAll(".sidebar nav ul li").forEach(function (node) {
          node.classList.toggle("active", node.dataset.section === section);
        });
        var titles = {
          dashboard: "数据概览",
          notices: "公告管理",
          news: "最新动态",
          config: "数据版本",
          feedback: "反馈管理"
        };
        $("pageTitle").textContent = titles[section] || "Admin Console";
      }

      // 6. 数据概览 Dashboard 渲染
      function renderDashboard() {
        var data = state.dashboard || {};
        var counts = data.counts || {};
        var version = data.dataVersion || {};
        
        var stats = [
          { label: "发布状态", val: data.publishStatus || "online", key: "publishStatus", icon: "🌐", foot: "小程序端显示配置" },
          { label: "当前学期", val: data.currentSemester || "-", key: "semester", icon: "📅", foot: "数据同步默认学期" },
          { label: "行政班级课表", val: counts.classScheduleCount || 0, key: "class", icon: "🏫", foot: "更新于：" + formatDate(version.classScheduleUpdatedAt) },
          { label: "教师课表数", val: counts.teacherScheduleCount || 0, key: "teacher", icon: "👨‍🏫", foot: "更新于：" + formatDate(version.teacherScheduleUpdatedAt) },
          { label: "教室课表数", val: counts.classroomScheduleCount || 0, key: "classroom", icon: "🚪", foot: "更新于：" + formatDate(version.classroomScheduleUpdatedAt) },
          { label: "课程课表数", val: counts.courseScheduleCount || 0, key: "course", icon: "📚", foot: "更新于：" + formatDate(version.courseScheduleUpdatedAt) },
          { label: "公告总数", val: counts.noticeCount || 0, key: "notice", icon: "📢", foot: "启用中公告：" + (counts.enabledNoticeCount || 0) + " 个" },
          { label: "最新动态数", val: counts.newsCount || 0, key: "news", icon: "✨", foot: "小程序端动态列表" },
          { label: "待处理反馈", val: counts.openFeedbackCount || 0, key: "openFeedback", icon: "💬", foot: "反馈总数：" + (counts.feedbackCount || 0), highlight: (counts.openFeedbackCount > 0) },
          { label: "Release Version", val: version.releaseVersion || "-", key: "release", icon: "🏷️", foot: "版本标记说明：" + (version.releaseNote || "-") }
        ];

        var wrap = $("statsGrid");
        wrap.textContent = "";
        stats.forEach(function (item) {
          var card = document.createElement("div");
          card.className = "stat-card glass-card";
          
          var head = document.createElement("div");
          head.className = "stat-head";
          head.appendChild(document.createTextNode(item.label));
          var icon = document.createElement("span");
          icon.className = "stat-icon";
          icon.textContent = item.icon;
          head.appendChild(icon);
          card.appendChild(head);

          var num = document.createElement("div");
          num.className = "stat-value stat-num";
          if (item.highlight) {
            num.style.color = "var(--danger)";
          }
          num.textContent = item.val;
          card.appendChild(num);

          var foot = document.createElement("div");
          foot.className = "stat-foot";
          foot.textContent = item.foot;
          card.appendChild(foot);

          wrap.appendChild(card);
        });

        // 填充环境标签和版本
        $("envTag").textContent = data.publishStatus === "online" ? "production" : "local";
        $("envTag").className = "env-tag " + (data.publishStatus === "online" ? "production" : "local");
        $("versionLabel").textContent = version.releaseVersion || "-";

        // 填充最近反馈预览
        var feedWrap = $("recentFeedbackPreview");
        feedWrap.textContent = "";
        var recentFeedbacks = state.feedbacks.slice(0, 3);
        if (recentFeedbacks.length === 0) {
          feedWrap.appendChild(document.createTextNode("当前暂无反馈上报。"));
        } else {
          recentFeedbacks.forEach(function (fb) {
            var item = document.createElement("div");
            item.className = "preview-item";
            
            var info = document.createElement("div");
            var title = document.createElement("div");
            title.className = "preview-title";
            title.textContent = escapeHtml(fb.content.slice(0, 20)) + (fb.content.length > 20 ? "..." : "");
            info.appendChild(title);
            
            var meta = document.createElement("div");
            meta.className = "preview-meta";
            meta.textContent = fb.type + " · " + formatDate(fb.createdAt);
            info.appendChild(meta);
            item.appendChild(info);

            var badge = document.createElement("span");
            badge.className = "badge " + (fb.status === "open" ? "danger" : (fb.status === "processing" ? "warning" : "success"));
            badge.textContent = fb.status === "open" ? "待处理" : (fb.status === "processing" ? "处理中" : (fb.status === "resolved" ? "已处理" : "忽略"));
            item.appendChild(badge);

            feedWrap.appendChild(item);
          });
        }
      }

      // 7. 公告管理模块
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
        var title = value("noticeTitle") || "公告标题";
        var content = value("noticeContent") || "公告正文内容，请在此处完善内容排版预览。";
        var type = $("noticeType").value;
        var mode = $("noticeDisplayMode").value;
        var priority = $("noticePriority").value;
        
        var screen = $("noticePhoneScreen");
        screen.textContent = "";

        var titleEl = document.createElement("div");
        titleEl.className = "phone-title";
        titleEl.textContent = "当前展示模式：" + mode;
        screen.appendChild(titleEl);

        if (mode === "banner" || mode === "card") {
          var banner = document.createElement("div");
          banner.className = "mini-banner " + (priority === "urgent" ? "urgent" : (priority === "important" ? "warning" : ""));
          
          var bTitle = document.createElement("div");
          bTitle.style.fontWeight = "bold";
          bTitle.textContent = "【" + type + "】" + title;
          banner.appendChild(bTitle);

          var bContent = document.createElement("div");
          bContent.style.marginTop = "4px";
          bContent.style.fontSize = "10px";
          bContent.textContent = content;
          banner.appendChild(bContent);

          screen.appendChild(banner);
        } else if (mode === "modal") {
          var mask = document.createElement("div");
          mask.className = "mini-modal-mask";
          
          var modal = document.createElement("div");
          modal.className = "mini-modal";
          
          var mTitle = document.createElement("h4");
          mTitle.textContent = title;
          modal.appendChild(mTitle);

          var mContent = document.createElement("p");
          mContent.textContent = content;
          modal.appendChild(mContent);

          var mBtn = document.createElement("button");
          mBtn.textContent = "我知道了";
          modal.appendChild(mBtn);

          mask.appendChild(modal);
          screen.appendChild(mask);
        } else if (mode === "ticker") {
          var ticker = document.createElement("div");
          ticker.className = "mini-ticker";
          
          var tContent = document.createElement("div");
          tContent.className = "mini-ticker-content";
          tContent.textContent = "【" + priority + "】" + title + "：" + content;
          ticker.appendChild(tContent);
          
          screen.appendChild(ticker);
        }
      }

      function clearNoticeForm() {
        state.editingNoticeId = "";
        $("noticeFormTitle").textContent = "新建公告";
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
        $("noticeFormTitle").textContent = "编辑公告：" + item.title;
        setValue("noticeTitle", item.title);
        setValue("noticeContent", item.content);
        setValue("noticeVersion", item.version);
        setValue("noticeStartAt", item.startAt ? formatDate(item.startAt) : "");
        setValue("noticeEndAt", item.endAt ? formatDate(item.endAt) : "");
        $("noticeType").value = item.type || "info";
        $("noticePriority").value = item.priority || "normal";
        $("noticeDisplayMode").value = item.displayMode || "banner";
        $("noticeTargetPage").value = item.targetPage || "all";
        $("noticeEnabled").value = item.enabled ? "true" : "false";
        $("noticeClosable").value = item.closable ? "true" : "false";
        updateNoticePreview();
      }

      function saveNotice() {
        var title = value("noticeTitle");
        var content = value("noticeContent");
        if (!title || !content) {
          showToast("标题和内容不能为空", "error");
          return;
        }
        var method = state.editingNoticeId ? "PUT" : "POST";
        var path = state.editingNoticeId ? "/api/admin/notices/" + encodeURIComponent(state.editingNoticeId) : "/api/admin/notices";
        api(path, { method: method, body: JSON.stringify(noticePayload()) }).then(function () {
          clearNoticeForm();
          showToast("公告保存成功", "success");
          return loadNotices();
        }).catch(function (error) { showToast(error.message, "error"); });
      }

      function renderNotices() {
        var tbody = $("noticeListTable");
        tbody.textContent = "";
        if (!state.notices.length) {
          var tr = document.createElement("tr");
          var td = document.createElement("td");
          td.colSpan = 6;
          td.style.textAlign = "center";
          td.style.color = "var(--text-light)";
          td.textContent = "当前无可运营的系统公告";
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }
        state.notices.forEach(function (item) {
          var tr = document.createElement("tr");
          
          var tdTitle = document.createElement("td");
          tdTitle.style.fontWeight = "600";
          tdTitle.textContent = item.title;
          tr.appendChild(tdTitle);

          var tdType = document.createElement("td");
          var typeBadge = document.createElement("span");
          typeBadge.className = "badge info";
          typeBadge.textContent = item.type + " · " + item.displayMode;
          tdType.appendChild(typeBadge);
          tr.appendChild(tdType);

          var tdPage = document.createElement("td");
          tdPage.textContent = item.targetPage;
          tr.appendChild(tdPage);

          var tdStatus = document.createElement("td");
          var statusBadge = document.createElement("span");
          statusBadge.className = "badge " + (item.enabled ? "success" : "muted");
          statusBadge.textContent = item.enabled ? "展示中" : "已停用";
          tdStatus.appendChild(statusBadge);
          tr.appendChild(tdStatus);

          var tdTime = document.createElement("td");
          tdTime.textContent = formatDate(item.updatedAt);
          tr.appendChild(tdTime);

          var tdOps = document.createElement("td");
          
          var editBtn = document.createElement("button");
          editBtn.className = "ghost";
          editBtn.style.padding = "4px 8px";
          editBtn.style.fontSize = "12px";
          editBtn.textContent = "编辑";
          editBtn.onclick = function () { editNotice(item); window.scrollTo({ top: 0, behavior: "smooth" }); };
          tdOps.appendChild(editBtn);

          var toggleBtn = document.createElement("button");
          toggleBtn.className = "secondary";
          toggleBtn.style.padding = "4px 8px";
          toggleBtn.style.fontSize = "12px";
          toggleBtn.style.marginLeft = "6px";
          toggleBtn.textContent = item.enabled ? "停用" : "启用";
          toggleBtn.onclick = function () {
            var nextEnabled = !item.enabled;
            api("/api/admin/notices/" + encodeURIComponent(item.id), {
              method: "PUT",
              body: JSON.stringify(Object.assign({}, item, { enabled: nextEnabled }))
            }).then(function() {
              showToast(nextEnabled ? "公告已成功启用" : "公告已停用", "success");
              loadNotices();
            });
          };
          tdOps.appendChild(toggleBtn);

          var delBtn = document.createElement("button");
          delBtn.className = "danger";
          delBtn.style.padding = "4px 8px";
          delBtn.style.fontSize = "12px";
          delBtn.style.marginLeft = "6px";
          delBtn.textContent = "删除";
          delBtn.onclick = function () {
            if (!confirm("您确定要彻底删除公告『" + item.title + "』吗？删除后不可恢复。")) return;
            api("/api/admin/notices/" + encodeURIComponent(item.id), { method: "DELETE" }).then(function() {
              showToast("公告删除成功", "success");
              loadNotices();
            });
          };
          tdOps.appendChild(delBtn);

          tr.appendChild(tdOps);
          tbody.appendChild(tr);
        });
      }

      // 8. 最新动态模块
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

      function updateNewsPreview() {
        var title = value("newsTitle") || "动态标题";
        var summary = value("newsSummary") || "动态摘要说明...";
        var tag = value("newsTag") || "数据更新";
        var date = value("newsDate") || "2026-06-01";
        
        var screen = $("newsPhoneScreen");
        screen.textContent = "";

        var phoneTitle = document.createElement("div");
        phoneTitle.className = "phone-title";
        phoneTitle.textContent = "最新动态效果";
        screen.appendChild(phoneTitle);

        var newsCard = document.createElement("div");
        newsCard.className = "mini-news-card";

        var header = document.createElement("div");
        header.className = "mini-news-header";
        
        var tagEl = document.createElement("span");
        tagEl.className = "mini-news-tag";
        tagEl.textContent = tag;
        header.appendChild(tagEl);

        var dateEl = document.createElement("span");
        dateEl.className = "mini-news-date";
        dateEl.textContent = date;
        header.appendChild(dateEl);
        newsCard.appendChild(header);

        var titleEl = document.createElement("h4");
        titleEl.className = "mini-news-title";
        titleEl.textContent = title;
        newsCard.appendChild(titleEl);

        var summaryEl = document.createElement("p");
        summaryEl.className = "mini-news-summary";
        summaryEl.textContent = summary;
        newsCard.appendChild(summaryEl);

        screen.appendChild(newsCard);
      }

      function clearNewsForm() {
        state.editingNewsId = "";
        $("newsFormTitle").textContent = "添加最新动态";
        ["newsTitle", "newsSummary", "newsDetail", "newsTag", "newsLink", "newsDate"].forEach(function (id) { setValue(id, ""); });
        $("newsEnabled").value = "true";
        updateNewsPreview();
      }

      function editNews(item) {
        state.editingNewsId = item.id;
        $("newsFormTitle").textContent = "编辑最新动态：" + item.title;
        setValue("newsTitle", item.title);
        setValue("newsSummary", item.summary);
        setValue("newsDetail", item.detail);
        setValue("newsTag", item.tag);
        setValue("newsLink", item.link);
        setValue("newsDate", item.date ? formatDate(item.date).split(" ")[0] : "");
        $("newsEnabled").value = item.enabled ? "true" : "false";
        updateNewsPreview();
      }

      function saveNews() {
        var title = value("newsTitle");
        if (!title) {
          showToast("标题不能为空", "error");
          return;
        }
        var method = state.editingNewsId ? "PUT" : "POST";
        var path = state.editingNewsId ? "/api/admin/news/" + encodeURIComponent(state.editingNewsId) : "/api/admin/news";
        api(path, { method: method, body: JSON.stringify(newsPayload()) }).then(function () {
          clearNewsForm();
          showToast("动态保存成功", "success");
          return loadNews();
        }).catch(function (error) { showToast(error.message, "error"); });
      }

      function renderNews() {
        var tbody = $("newsListTable");
        tbody.textContent = "";
        if (!state.news.length) {
          var tr = document.createElement("tr");
          var td = document.createElement("td");
          td.colSpan = 5;
          td.style.textAlign = "center";
          td.style.color = "var(--text-light)";
          td.textContent = "当前无可运营的动态内容";
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }
        state.news.forEach(function (item) {
          var tr = document.createElement("tr");

          var tdTitle = document.createElement("td");
          tdTitle.style.fontWeight = "600";
          tdTitle.textContent = item.title;
          tr.appendChild(tdTitle);

          var tdTag = document.createElement("td");
          var tagBadge = document.createElement("span");
          tagBadge.className = "badge info";
          tagBadge.textContent = item.tag || "无";
          tdTag.appendChild(tagBadge);
          tr.appendChild(tdTag);

          var tdDate = document.createElement("td");
          tdDate.textContent = item.date ? formatDate(item.date).split(" ")[0] : "-";
          tr.appendChild(tdDate);

          var tdStatus = document.createElement("td");
          var statusBadge = document.createElement("span");
          statusBadge.className = "badge " + (item.enabled ? "success" : "muted");
          statusBadge.textContent = item.enabled ? "已启用" : "已停用";
          tdStatus.appendChild(statusBadge);
          tr.appendChild(tdStatus);

          var tdOps = document.createElement("td");
          
          var editBtn = document.createElement("button");
          editBtn.className = "ghost";
          editBtn.style.padding = "4px 8px";
          editBtn.style.fontSize = "12px";
          editBtn.textContent = "编辑";
          editBtn.onclick = function () { editNews(item); window.scrollTo({ top: 0, behavior: "smooth" }); };
          tdOps.appendChild(editBtn);

          var toggleBtn = document.createElement("button");
          toggleBtn.className = "secondary";
          toggleBtn.style.padding = "4px 8px";
          toggleBtn.style.fontSize = "12px";
          toggleBtn.style.marginLeft = "6px";
          toggleBtn.textContent = item.enabled ? "禁用" : "启用";
          toggleBtn.onclick = function () {
            var nextEnabled = !item.enabled;
            api("/api/admin/news/" + encodeURIComponent(item.id), {
              method: "PUT",
              body: JSON.stringify(Object.assign({}, item, { enabled: nextEnabled }))
            }).then(function() {
              showToast(nextEnabled ? "动态已成功启用" : "动态已成功禁用", "success");
              loadNews();
            });
          };
          tdOps.appendChild(toggleBtn);

          var delBtn = document.createElement("button");
          delBtn.className = "danger";
          delBtn.style.padding = "4px 8px";
          delBtn.style.fontSize = "12px";
          delBtn.style.marginLeft = "6px";
          delBtn.textContent = "删除";
          delBtn.onclick = function () {
            if (!confirm("确认删除动态『" + item.title + "』吗？")) return;
            api("/api/admin/news/" + encodeURIComponent(item.id), { method: "DELETE" }).then(function() {
              showToast("动态已彻底删除", "success");
              loadNews();
            });
          };
          tdOps.appendChild(delBtn);

          tr.appendChild(tdOps);
          tbody.appendChild(tr);
        });
      }

      // 9. 数据版本与说明配置
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
          showToast("版本配置发布成功", "success");
          return loadAll();
        }).catch(function (error) { showToast(error.message, "error"); });
      }

      function generateReleaseVersion() {
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, "0"); };
        var dateStr = now.getFullYear() + "." + pad(now.getMonth() + 1) + "." + pad(now.getDate());
        var current = value("configReleaseVersion");
        if (current && current.indexOf(dateStr) === 0) {
          var parts = current.split("-");
          if (parts.length === 2 && !isNaN(Number(parts[1]))) {
            setValue("configReleaseVersion", dateStr + "-" + (Number(parts[1]) + 1));
            return;
          }
        }
        setValue("configReleaseVersion", dateStr + "-1");
      }

      function openDisclaimerCollapse() {
        var content = $("disclaimerCollapseContent");
        var icon = $("collapseIcon");
        var isOpen = content.classList.contains("open");
        if (isOpen) {
          content.classList.remove("open");
          icon.textContent = "▼";
        } else {
          content.classList.add("open");
          icon.textContent = "▲";
        }
      }

      // 10. 用户反馈模块
      function openFeedbackDrawer(item) {
        state.currentFeedback = item;
        $("drawerType").textContent = escapeHtml(item.type);
        $("drawerContent").textContent = item.content; // textContent 自动防御 XSS
        $("drawerPage").textContent = escapeHtml(item.page || "-");
        $("drawerContact").textContent = escapeHtml(item.contact || "-");
        $("drawerSemester").textContent = escapeHtml(item.semester || "-");
        $("drawerDataVersion").textContent = escapeHtml(item.dataVersion || "-");
        $("drawerAppVersion").textContent = escapeHtml(item.appVersion || "-");
        $("drawerPlatform").textContent = escapeHtml(item.platform || "-");
        
        var schInfoBlock = $("drawerScheduleInfoBlock");
        if (item.selectedClass || item.selectedSchedule) {
          schInfoBlock.style.display = "block";
          var txt = "";
          if (item.selectedClass) {
            txt += "相关班级: " + JSON.stringify(item.selectedClass) + " ";
          }
          if (item.selectedSchedule) {
            txt += "所选课表: " + JSON.stringify(item.selectedSchedule);
          }
          $("drawerScheduleInfo").textContent = txt;
        } else {
          schInfoBlock.style.display = "none";
        }

        $("drawerStatusSelect").value = item.status || "open";
        setValue("drawerAdminNote", item.adminNote || "");

        $("drawerMask").classList.add("show");
        $("feedbackDrawer").classList.add("show");
      }

      function closeFeedbackDrawer() {
        $("drawerMask").classList.remove("show");
        $("feedbackDrawer").classList.remove("show");
        state.currentFeedback = null;
      }

      function saveFeedbackDrawer() {
        if (!state.currentFeedback) return;
        var nextStatus = $("drawerStatusSelect").value;
        var nextNote = value("drawerAdminNote");

        api("/api/admin/feedbacks/" + encodeURIComponent(state.currentFeedback.id), {
          method: "PUT",
          body: JSON.stringify({ status: nextStatus, adminNote: nextNote })
        }).then(function () {
          showToast("反馈状态处理已保存", "success");
          closeFeedbackDrawer();
          loadFeedbacks();
          loadDashboard();
        }).catch(function (err) {
          showToast(err.message, "error");
        });
      }

      function renderFeedbacks() {
        var tbody = $("feedbackListTable");
        tbody.textContent = "";
        
        // 过滤
        var filtered = state.feedbacks.filter(function (fb) {
          var matchesStatus = state.feedbackFilter.status === "all" || fb.status === state.feedbackFilter.status;
          var matchesKeyword = true;
          if (state.feedbackFilter.keyword) {
            var kw = state.feedbackFilter.keyword.toLowerCase();
            matchesKeyword = (fb.content || "").toLowerCase().indexOf(kw) >= 0 ||
                             (fb.contact || "").toLowerCase().indexOf(kw) >= 0 ||
                             (fb.page || "").toLowerCase().indexOf(kw) >= 0;
          }
          return matchesStatus && matchesKeyword;
        });

        if (filtered.length === 0) {
          var tr = document.createElement("tr");
          var td = document.createElement("td");
          td.colSpan = 7;
          td.style.textAlign = "center";
          td.style.color = "var(--text-light)";
          td.textContent = "无可筛选的反馈数据";
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }

        filtered.forEach(function (item) {
          var tr = document.createElement("tr");
          
          var tdContent = document.createElement("td");
          tdContent.style.maxWidth = "260px";
          tdContent.style.overflow = "hidden";
          tdContent.style.textOverflow = "ellipsis";
          tdContent.style.whiteSpace = "nowrap";
          tdContent.textContent = item.content; // 防御 XSS
          tr.appendChild(tdContent);

          var tdPage = document.createElement("td");
          tdPage.textContent = item.page || "-";
          tr.appendChild(tdPage);

          var tdStatus = document.createElement("td");
          var badge = document.createElement("span");
          var statusMap = { open: "danger", processing: "warning", resolved: "success", ignored: "muted" };
          var statusTextMap = { open: "待处理", processing: "处理中", resolved: "已解决", ignored: "已忽略" };
          badge.className = "badge " + (statusMap[item.status] || "info");
          badge.textContent = statusTextMap[item.status] || item.status;
          tdStatus.appendChild(badge);
          tr.appendChild(tdStatus);

          var tdContact = document.createElement("td");
          tdContact.textContent = item.contact || "-";
          tr.appendChild(tdContact);

          var tdClass = document.createElement("td");
          var rel = "";
          if (item.selectedClass) {
            rel = item.selectedClass.className || item.selectedClass.name || "-";
          } else if (item.selectedSchedule) {
            rel = item.selectedSchedule.name || "-";
          } else {
            rel = "-";
          }
          tdClass.textContent = rel;
          tr.appendChild(tdClass);

          var tdTime = document.createElement("td");
          tdTime.textContent = formatDate(item.createdAt);
          tr.appendChild(tdTime);

          var tdOps = document.createElement("td");
          var detailBtn = document.createElement("button");
          detailBtn.className = "ghost";
          detailBtn.style.padding = "4px 8px";
          detailBtn.style.fontSize = "12px";
          detailBtn.textContent = "处理反馈";
          detailBtn.onclick = function () { openFeedbackDrawer(item); };
          tdOps.appendChild(detailBtn);
          tr.appendChild(tdOps);

          tbody.appendChild(tr);
        });
      }

      // 11. 数据拉取
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
        return api("/api/admin/feedbacks?limit=200").then(function (data) {
          state.feedbacks = data.items || [];
          renderFeedbacks();
        });
      }

      function checkHealth() {
        var dot = $("healthStatusDot");
        var label = $("healthStatusLabel");
        dot.className = "health-dot checking";
        label.textContent = "正在检测接口连通性...";
        
        fetch("/api/fosu/app-config")
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data && data.success) {
              dot.className = "health-dot healthy";
              label.textContent = "健康 (Healthy)";
            } else {
              dot.className = "health-dot error";
              label.textContent = "异常 (API 异常)";
            }
          })
          .catch(function () {
            dot.className = "health-dot error";
            label.textContent = "断开 (超时或CORS阻拦)";
          });
      }

      function loadAll() {
        showDashboard();
        setStatus("正在极速获取最新状态...");
        return Promise.all([loadDashboard(), loadConfig(), loadNotices(), loadNews(), loadFeedbacks()])
          .then(function () {
            setStatus("最近同步：" + formatDate(new Date().toISOString()));
            checkHealth();
            showToast("控制台数据已刷新", "success");
          })
          .catch(function (error) { setStatus(error.message); });
      }

      // 12. 事件绑定
      document.querySelectorAll(".sidebar nav ul li[data-section]").forEach(function (item) {
        item.addEventListener("click", function () {
          switchSection(item.dataset.section);
          if (item.dataset.section === "feedback") {
            renderFeedbacks();
          }
        });
      });

      // 实时预览监听
      ["noticeTitle", "noticeContent", "noticeVersion"].forEach(function (id) {
        $(id).addEventListener("input", updateNoticePreview);
      });
      ["noticeType", "noticeDisplayMode", "noticePriority"].forEach(function (id) {
        $(id).addEventListener("change", updateNoticePreview);
      });

      ["newsTitle", "newsSummary", "newsTag", "newsDate"].forEach(function (id) {
        $(id).addEventListener("input", updateNewsPreview);
      });

      $("loginButton").addEventListener("click", login);
      $("loginPassword").addEventListener("keydown", function (event) { if (event.key === "Enter") login(); });
      $("logoutButton").addEventListener("click", logout);
      $("refreshButton").addEventListener("click", loadAll);
      $("saveConfigButton").addEventListener("click", saveConfig);
      $("saveNoticeButton").addEventListener("click", saveNotice);
      $("clearNoticeButton").addEventListener("click", clearNoticeForm);
      $("saveNewsButton").addEventListener("click", saveNews);
      $("clearNewsButton").addEventListener("click", clearNewsForm);
      
      // 时间字段“设为当前”
      document.querySelectorAll(".text-btn-time").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var targetId = btn.dataset.target;
          setCurrentTime(targetId);
        });
      });
      function setCurrentTime(id) {
        $(id).value = new Date().toISOString();
      }

      $("generateVersionBtn").addEventListener("click", function(e) {
        e.preventDefault();
        generateReleaseVersion();
      });

      $("disclaimerCollapseHeader").addEventListener("click", openDisclaimerCollapse);

      // 反馈过滤与搜索
      $("feedbackSearch").addEventListener("input", function () {
        state.feedbackFilter.keyword = value("feedbackSearch");
        renderFeedbacks();
      });

      document.querySelectorAll("#feedbackStatusTabs button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.querySelectorAll("#feedbackStatusTabs button").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.feedbackFilter.status = btn.dataset.status;
          renderFeedbacks();
        });
      });

      // 抽屉事件
      $("closeDrawerBtn").addEventListener("click", closeFeedbackDrawer);
      $("cancelDrawerBtn").addEventListener("click", closeFeedbackDrawer);
      $("drawerMask").addEventListener("click", closeFeedbackDrawer);
      $("saveDrawerBtn").addEventListener("click", saveFeedbackDrawer);

      // 健康度检测
      $("recheckHealthBtn").addEventListener("click", function (e) {
        e.preventDefault();
        checkHealth();
      });

      // 复制 / 打开公开配置接口
      $("copyConfigApiBtn").addEventListener("click", function () {
        var url = window.location.origin + "/api/fosu/app-config";
        var input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        showToast("接口地址已复制到剪贴板");
      });

      $("openConfigApiBtn").addEventListener("click", function () {
        window.open("/api/fosu/app-config", "_blank");
      });

      // 13. 初始化视图判断
      clearNoticeForm();
      clearNewsForm();
      if (isLoginPage) {
        showLogin();
      } else {
        loadAll();
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
    })();
  </script>
</body>
</html>`;

function sendAdminHtml(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'"
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
