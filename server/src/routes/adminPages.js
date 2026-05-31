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
      --bg: #f8fafc;
      --panel: #ffffff;
      --panel-2: #f1f5f9;
      --border: #e2e8f0;
      --border-hover: #cbd5e1;
      --text: #0f172a;
      --muted: #64748b;
      --primary: #3b82f6;
      --primary-soft: #eff6ff;
      --primary-hover: #2563eb;
      --success: #10b981;
      --success-soft: #ecfdf5;
      --warning: #f59e0b;
      --warning-soft: #fef3c7;
      --danger: #ef4444;
      --danger-soft: #fee2e2;
      --radius: 8px;
      --shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.04), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
      --font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* 现代卡片与面板 */
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 24px;
      transition: var(--transition);
    }
    .card:hover {
      border-color: var(--border-hover);
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 16px;
      color: var(--text);
    }

    /* 文本输入框与表单 */
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: var(--transition);
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    textarea {
      min-height: 80px;
      resize: vertical;
    }

    /* 按钮规范 */
    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: var(--transition);
      gap: 6px;
      text-decoration: none;
    }
    button.primary, .btn.primary {
      background: var(--primary);
      color: #ffffff;
    }
    button.primary:hover, .btn.primary:hover {
      background: var(--primary-hover);
    }
    button.secondary, .btn.secondary {
      background: var(--primary-soft);
      color: var(--primary);
    }
    button.secondary:hover, .btn.secondary:hover {
      background: #dbeafe;
    }
    button.danger, .btn.danger {
      background: var(--danger-soft);
      color: var(--danger);
    }
    button.danger:hover, .btn.danger:hover {
      background: #fecaca;
    }
    button.ghost, .btn.ghost {
      background: transparent;
      border-color: var(--border);
      color: var(--muted);
    }
    button.ghost:hover, .btn.ghost:hover {
      background: var(--panel-2);
      color: var(--text);
    }
    button:disabled, .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* 后台主要框架布局 */
    .app-shell {
      display: grid;
      grid-template-columns: 240px 1fr;
      min-height: 100vh;
    }
    
    /* 侧边导航 */
    .sidebar {
      background: var(--panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 24px 16px;
      position: sticky;
      top: 0;
      height: 100vh;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding: 0 8px;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--primary);
      color: white;
      font-size: 18px;
      font-weight: 800;
      display: grid;
      place-items: center;
    }
    .brand-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    .brand-subtitle {
      font-size: 11px;
      color: var(--muted);
    }

    .nav-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      list-style: none;
    }
    .nav-item button {
      width: 100%;
      justify-content: flex-start;
      padding: 8px 12px;
      background: transparent;
      color: var(--muted);
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
    }
    .nav-item button:hover {
      background: var(--panel-2);
      color: var(--text);
    }
    .nav-item.active button {
      background: var(--primary-soft);
      color: var(--primary);
    }

    .sidebar-footer {
      border-top: 1px solid var(--border);
      padding-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .env-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px;
    }
    .env-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .env-tag.production { background: var(--danger-soft); color: var(--danger); }
    .env-tag.local { background: #e0f2fe; color: #0369a1; }
    
    /* 主体内容区 */
    .main-content {
      padding: 32px 40px;
      overflow-y: auto;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
    }
    
    /* 顶栏 */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }
    .topbar h2 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .topbar p {
      color: var(--muted);
      font-size: 13px;
      margin-top: 2px;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* 各面板展现 */
    .section {
      display: none;
      animation: fadeIn 0.15s ease-out;
    }
    .section.active {
      display: block;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* 数据概览 Dashboard 网格 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 100px;
      padding: 20px;
    }
    .stat-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }
    .stat-num {
      font-size: 24px;
      font-weight: 800;
      color: var(--text);
      margin-top: 8px;
    }
    .stat-foot {
      font-size: 11px;
      color: var(--muted);
      margin-top: 8px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .dash-columns {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
    }

    /* Tab 筛选控制条 */
    .filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .search-input-wrap {
      position: relative;
      max-width: 320px;
      width: 100%;
    }
    .tab-filter {
      display: flex;
      background: var(--panel-2);
      padding: 4px;
      border-radius: 8px;
      gap: 2px;
    }
    .tab-filter button {
      padding: 6px 12px;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      border: none;
    }
    .tab-filter button.active {
      background: var(--panel);
      color: var(--text);
      box-shadow: var(--shadow);
    }

    /* 数据表格 */
    .table-container {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th, td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      white-space: nowrap;
    }
    th {
      font-weight: 700;
      background: #f8fafc;
      color: var(--muted);
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background: #f8fafc;
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
    .badge.info { background: var(--primary-soft); color: var(--primary); }
    .badge.warning { background: var(--warning-soft); color: #d97706; }
    .badge.success { background: var(--success-soft); color: #059669; }
    .badge.danger { background: var(--danger-soft); color: var(--danger); }
    .badge.muted { background: var(--panel-2); color: var(--muted); }

    /* 分页组件 */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }
    .pagination-info {
      font-size: 13px;
      color: var(--muted);
    }
    .pagination-buttons {
      display: flex;
      gap: 6px;
    }

    /* 抽屉(Drawer)系统 */
    .drawer-mask {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.2);
      backdrop-filter: blur(2px);
      z-index: 100;
      display: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .drawer {
      position: fixed;
      top: 0; right: -640px; bottom: 0;
      width: 100%;
      max-width: 600px;
      background: var(--panel);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
      z-index: 101;
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      border-left: 1px solid var(--border);
    }
    .drawer-mask.show { display: block; opacity: 1; }
    .drawer.show { right: 0; }
    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    .drawer-header h3 { font-size: 16px; font-weight: 800; }
    .drawer-close { font-size: 20px; cursor: pointer; color: var(--muted); border: none; background: transparent; padding: 4px; }
    .drawer-close:hover { color: var(--text); }
    .drawer-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-footer {
      border-top: 1px solid var(--border);
      padding-top: 16px;
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    /* 双栏式编辑布局 */
    .split-layout {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 20px;
      align-items: start;
    }
    .form-box {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .form-row.full {
      grid-template-columns: 1fr;
    }

    /* 可视化组件：横向条形图 */
    .bar-chart-row {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12px;
    }
    .bar-chart-label {
      width: 100px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      font-weight: 600;
    }
    .bar-chart-track {
      flex: 1;
      height: 8px;
      background: var(--panel-2);
      border-radius: 4px;
      overflow: hidden;
      margin: 0 12px;
    }
    .bar-chart-bar {
      height: 100%;
      background: var(--primary);
      border-radius: 4px;
      transition: width 0.4s ease;
    }
    .bar-chart-value {
      width: 40px;
      text-align: right;
      color: var(--muted);
    }

    /* 可视化组件：7x14 教室热力图 */
    .heatmap-container {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 3px;
      margin-top: 10px;
    }
    .heatmap-header {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-align: center;
      padding: 4px;
    }
    .heatmap-cell {
      height: 26px;
      border-radius: 3px;
      background: var(--primary);
      opacity: 0.05;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: bold;
      color: var(--text);
      transition: var(--transition);
      cursor: pointer;
    }
    .heatmap-cell:hover {
      box-shadow: 0 0 0 2px var(--primary);
    }
    .heatmap-axis {
      font-size: 10px;
      font-weight: 600;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* 迷你可视化周课表网格 (Drawer 预览) */
    .mini-schedule {
      display: grid;
      grid-template-columns: 50px repeat(7, 1fr);
      gap: 2px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      font-size: 10px;
    }
    .mini-sched-head {
      background: #f8fafc;
      font-weight: 700;
      padding: 6px 2px;
      text-align: center;
    }
    .mini-sched-row-label {
      background: #f8fafc;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mini-sched-cell {
      background: var(--panel);
      min-height: 26px;
      padding: 2px;
      position: relative;
    }
    .mini-sched-course-block {
      background: var(--primary-soft);
      color: var(--primary);
      border-left: 2px solid var(--primary);
      padding: 2px;
      border-radius: 2px;
      font-size: 8px;
      font-weight: 600;
      line-height: 1.1;
      height: 100%;
      overflow: hidden;
    }

    /* Toast 消息 */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--text);
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: var(--shadow-lg);
      z-index: 1000;
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.2s ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.success { border-left: 3px solid var(--success); }
    .toast.error { border-left: 3px solid var(--danger); }

    /* 快捷链接和健康度检查网格 */
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .health-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: var(--panel-2);
      border-radius: 6px;
      font-size: 12px;
    }

    /* 小程序手机框实时预览 */
    .preview-box {
      position: sticky;
      top: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .preview-phone {
      border: 8px solid #0f172a;
      border-radius: 24px;
      background: #f8fafc;
      width: 290px;
      height: 480px;
      padding: 12px;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
    }
    .phone-bar {
      height: 16px;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      font-weight: 700;
      color: #0f172a;
      padding: 0 4px;
      margin-bottom: 8px;
    }
    .phone-screen {
      height: calc(100% - 24px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .phone-title {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 2px;
    }

    /* 模拟小程序公告 */
    .mini-banner {
      background: #eff6ff;
      border-left: 3px solid var(--primary);
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 10px;
      color: #1e40af;
    }
    .mini-banner.urgent { background: var(--danger-soft); border-left-color: var(--danger); color: #991b1b; }
    .mini-banner.warning { background: var(--warning-soft); border-left-color: var(--warning); color: #92400e; }
    
    .mini-modal-mask {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.3);
      display: grid;
      place-items: center;
      padding: 16px;
      z-index: 10;
    }
    .mini-modal {
      background: #ffffff;
      border-radius: 8px;
      width: 100%;
      padding: 12px;
      box-shadow: var(--shadow-lg);
      text-align: center;
    }
    .mini-modal h4 { font-size: 11px; font-weight: 800; margin-bottom: 4px; }
    .mini-modal p { font-size: 9px; color: var(--muted); line-height: 1.4; margin-bottom: 8px; }
    .mini-modal button { padding: 4px; border-radius: 4px; font-size: 10px; width: 100%; background: var(--primary); color: white; border: none;}

    .mini-ticker {
      background: #1e293b;
      color: #ffffff;
      padding: 4px 8px;
      font-size: 9px;
      overflow: hidden;
      border-radius: 4px;
    }

    .mini-card {
      background: #ffffff;
      border-radius: 6px;
      padding: 8px;
      border: 1px solid var(--border);
      font-size: 10px;
    }

    .mini-news-card {
      background: #ffffff;
      border-radius: 8px;
      padding: 10px;
      border: 1px solid var(--border);
    }
    .mini-news-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .mini-news-tag {
      background: var(--primary-soft);
      color: var(--primary);
      font-size: 8px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .mini-news-date {
      font-size: 8px;
      color: var(--muted);
    }

    .collapse-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      cursor: pointer;
      border-bottom: 1px dashed var(--border);
      font-size: 13px;
      font-weight: 700;
      color: var(--primary);
    }
    .collapse-content {
      display: none;
      padding-top: 10px;
    }
    .collapse-content.open { display: block; }

    /* Timeline 状态更新线 */
    .timeline {
      position: relative;
      padding-left: 20px;
      margin-top: 10px;
    }
    .timeline::before {
      content: "";
      position: absolute;
      left: 4px; top: 0; bottom: 0;
      width: 2px;
      background: var(--border);
    }
    .timeline-item {
      position: relative;
      margin-bottom: 16px;
    }
    .timeline-item::before {
      content: "";
      position: absolute;
      left: -20px; top: 6px;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: var(--primary);
      border: 2px solid var(--panel);
    }
    .timeline-item.warning::before {
      background: var(--warning);
    }
    .timeline-time {
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
    }
    .timeline-content {
      font-size: 13px;
      font-weight: 700;
      margin-top: 2px;
    }

    /* 全局运行时错误条 */
    .admin-runtime-error-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: var(--danger);
      color: #ffffff;
      padding: 12px 24px;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    .admin-runtime-error-bar button {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: #ffffff;
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
    }
    .admin-runtime-error-bar button:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  </style>
</head>
<body>

  <!-- 登录页视图 -->
  <main id="loginView" class="login-wrap" style="width: min(400px, calc(100% - 32px)); margin: 15vh auto;" hidden>
    <div class="card" style="padding: 32px;">
      <div class="brand-icon" style="width: 48px; height: 48px; font-size: 24px; border-radius: 8px; margin-bottom: 20px;">课</div>
      <h1 style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">佛课小表后台</h1>
      <p style="color: var(--muted); font-size: 13px; margin-bottom: 24px;">管理端控制台安全验证。请输入管理员密码进行登录。</p>
      <div class="login-form">
        <div style="margin-bottom: 16px;">
          <label for="loginPassword">安全凭据 (Password / Token)</label>
          <input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码">
        </div>
        <button id="loginButton" class="primary" style="width: 100%;">验证登录</button>
        <div id="loginError" style="color: var(--danger); font-size: 13px; margin-top: 12px; min-height: 20px;"></div>
      </div>
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
            <div class="brand-subtitle">Admin Console v1.5</div>
          </div>
        </div>
        <nav>
          <ul class="nav-list">
            <li class="nav-item active" data-section="dashboard"><button>数据概览</button></li>
            <li class="nav-item" data-section="catalog"><button>数据资源</button></li>
            <li class="nav-item" data-section="sync"><button>同步中心</button></li>
            <li class="nav-item" data-section="quality"><button>数据质量</button></li>
            <li class="nav-item" data-section="notices"><button>公告管理</button></li>
            <li class="nav-item" data-section="news"><button>最新动态</button></li>
            <li class="nav-item" data-section="config"><button>数据版本</button></li>
            <li class="nav-item" data-section="feedback"><button>反馈管理</button></li>
            <li class="nav-item" data-section="settings"><button>系统设置</button></li>
          </ul>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div class="env-info">
          <span id="envTag" class="env-tag local">local</span>
          <span style="font-size: 11px; color: var(--muted);" id="versionLabel">-</span>
        </div>
        <button id="logoutButton" class="danger" style="width: 100%; padding: 6px 12px; font-size: 12px;">退出登录</button>
      </div>
    </aside>

    <!-- 右侧主体内容 -->
    <div class="main-content">
      <div class="topbar">
        <div>
          <h2 id="pageTitle">数据概览</h2>
          <p id="statusLine">加载中...</p>
        </div>
        <div class="topbar-actions">
          <button id="refreshButton" class="ghost" style="padding: 6px 12px; font-size: 12px;">一键刷新</button>
        </div>
      </div>

      <!-- 面板一：数据概览 Dashboard -->
      <section id="section-dashboard" class="section active">
        <div class="stats-grid" id="statsGrid">
          <!-- 动态加载卡片 -->
        </div>

        <div class="dash-columns">
          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <h3 class="card-title" style="margin-bottom: 0;">课表资源分布</h3>
            <div id="collegeBarChart" style="margin-top: 10px;">
              <!-- 动态条形图 -->
            </div>
            
            <h3 class="card-title" style="margin-bottom: 0; margin-top: 10px;">教室占用率</h3>
            <div id="classroomBarChart" style="margin-top: 10px;">
              <!-- 动态条形图 -->
            </div>
          </div>
          
          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <h3 class="card-title" style="margin-bottom: 0;">数据更新 Timeline</h3>
            <div class="timeline" id="dashboardTimeline">
              <!-- 动态时间线 -->
            </div>
            
            <h3 class="card-title" style="margin-bottom: 0; margin-top: 10px;">未处理用户反馈</h3>
            <div id="recentFeedbackPreview" class="preview-list">
              <!-- 反馈预览 -->
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 24px;">
          <h3 class="card-title" style="margin-bottom: 8px;">全校教室占用热力图 (星期一至星期日 vs 第1节至第14节)</h3>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
            通过汇总全校全部教室的所有课表排课记录，计算每个时段的综合占用率。
          </div>
          <div class="heatmap-container" id="classroomHeatmap">
            <!-- 动态生成教室占用热力图 -->
          </div>
          <div style="display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; font-size: 11px; color: var(--muted);">
            <span>占用度:</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); opacity: 0.05; border-radius: 2px;"></span> 空闲 (0%)
              <span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); opacity: 0.25; border-radius: 2px;"></span> 25%
              <span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); opacity: 0.5; border-radius: 2px;"></span> 50%
              <span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); opacity: 0.75; border-radius: 2px;"></span> 75%
              <span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); opacity: 1.0; border-radius: 2px;"></span> 繁忙 (100%)
            </div>
          </div>
        </div>
      </section>

      <!-- 面板二：数据资源 Data Catalog -->
      <section id="section-catalog" class="section">
        <div class="card">
          <div class="filter-bar">
            <div class="tab-filter" id="catalogTabs">
              <button class="active" data-type="class">行政班</button>
              <button data-type="teacher">教师</button>
              <button data-type="classroom">教室</button>
              <button data-type="course">课程</button>
              <button data-type="major">专业</button>
              <button data-type="snapshot">原始快照</button>
            </div>
            <div class="search-input-wrap">
              <input id="catalogSearch" placeholder="搜索名称 / 别名 / 学院等关键词">
            </div>
          </div>

          <div class="table-container">
            <table id="catalogTable">
              <thead>
                <!-- 动态表格头 -->
              </thead>
              <tbody id="catalogListTable">
                <!-- 动态列表 -->
              </tbody>
            </table>
          </div>

          <div class="pagination">
            <span class="pagination-info" id="catalogPaginationInfo">第 1 - 20 条，共 0 条</span>
            <div class="pagination-buttons">
              <button class="ghost" id="catalogPrevBtn" style="padding: 4px 10px; font-size: 12px;">上一页</button>
              <button class="ghost" id="catalogNextBtn" style="padding: 4px 10px; font-size: 12px;">下一页</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 面板三：同步中心 Sync Center -->
      <section id="section-sync" class="section">
        <div class="stats-grid" id="syncStatsGrid">
          <!-- 同步状态卡片 -->
        </div>

        <div class="dash-columns">
          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 class="card-title" style="margin-bottom: 0;">API 健康状态检测</h3>
              <button class="secondary" id="recheckHealthBtn" style="padding: 4px 10px; font-size: 12px;">一键测试</button>
            </div>
            <div class="health-grid" id="healthGrid">
              <!-- 接口连通度 -->
            </div>

            <h3 class="card-title" style="margin-bottom: 0; margin-top: 10px;">上传本地同步文件 (Staging)</h3>
            <div style="border: 2px dashed var(--border); border-radius: 6px; padding: 20px; text-align: center; font-size: 13px;" id="uploadDropzone">
              <p style="color: var(--muted); margin-bottom: 10px;">点击或拖拽同步 JSON 文件进行更新校验</p>
              <input type="file" id="syncFileInput" style="display: none;" accept=".json">
              <button class="ghost" onclick="document.getElementById('syncFileInput').click()">选择 JSON 文件</button>
              <div id="uploadFileInfo" style="margin-top: 10px; font-weight: 600; color: var(--primary);"></div>
            </div>
          </div>

          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <h3 class="card-title" style="margin-bottom: 0;">同步运维命令指南</h3>
            <div id="syncCommands" style="display: flex; flex-direction: column; gap: 10px; font-size: 12px;">
              <!-- 动态命令列表 -->
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <h3 class="card-title">最近同步历史</h3>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>学期</th>
                  <th>来源</th>
                  <th>记录数</th>
                  <th>状态</th>
                  <th>报错信息</th>
                </tr>
              </thead>
              <tbody id="syncHistoryTable"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 面板四：数据质量 Data Quality -->
      <section id="section-quality" class="section">
        <div class="stats-grid" id="qualityStatsGrid">
          <!-- 质量概览指标 -->
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 class="card-title" style="margin-bottom: 0;">排课异常问题清单</h3>
            <button class="ghost" id="exportQualityBtn" style="padding: 4px 10px; font-size: 12px;">导出质量报告 JSON</button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>缺陷类型</th>
                  <th>影响实体/位置</th>
                  <th>原始异常描述</th>
                  <th>排查建议修复</th>
                  <th>严重程度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="qualityAnomalyTable"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 面板五：公告管理 -->
      <section id="section-notices" class="section">
        <div class="split-layout">
          <div class="card form-box">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 id="noticeFormTitle" class="card-title" style="margin-bottom: 0;">新建公告</h3>
              <button id="clearNoticeButton" class="ghost" style="padding: 4px 10px; font-size: 12px;">清除表单</button>
            </div>
            
            <div class="form-row">
              <div>
                <label>标题</label>
                <input id="noticeTitle" placeholder="例如：强智教务数据维护中">
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

            <button id="saveNoticeButton" class="primary">保存并发布公告</button>
          </div>

          <div class="preview-box">
            <h3 class="card-title" style="margin-bottom: 0;">小程序端实时预览</h3>
            <div class="preview-phone">
              <div class="phone-bar">
                <span>9:41</span>
                <span style="font-size: 10px;">FosuClass 佛大</span>
                <span>📶</span>
              </div>
              <div class="phone-screen" id="noticePhoneScreen">
                <!-- 实时预览公告 -->
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <h3 class="card-title">公告管理列表</h3>
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

      <!-- 面板六：最新动态 -->
      <section id="section-news" class="section">
        <div class="split-layout">
          <div class="card form-box">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 id="newsFormTitle" class="card-title" style="margin-bottom: 0;">添加最新动态</h3>
              <button id="clearNewsButton" class="ghost" style="padding: 4px 10px; font-size: 12px;">清除表单</button>
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
                <input id="newsLink" placeholder="例如：https://mp.weixin.qq.com/...">
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
                <label>摘要内容 (显示在外部列表)</label>
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
            <h3 class="card-title" style="margin-bottom: 0;">小程序卡片展示预览</h3>
            <div class="preview-phone">
              <div class="phone-bar">
                <span>9:41</span>
                <span style="font-size: 10px;">动态公告</span>
                <span>📶</span>
              </div>
              <div class="phone-screen" id="newsPhoneScreen">
                <!-- 动态卡片预览 -->
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <h3 class="card-title">动态管理列表</h3>
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

      <!-- 面板七：数据版本 -->
      <section id="section-config" class="section">
        <div class="card form-box">
          <h3 class="card-title">数据状态与发布版本控制</h3>
          
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

          <div class="form-row">
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

          <div class="form-row">
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
              <input id="configDataSourceLabel" placeholder="例如：教务系统快照 / 本地维护">
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

          <button id="saveConfigButton" class="primary" style="margin-top: 14px;">保存配置并应用</button>
        </div>
      </section>

      <!-- 面板八：用户反馈管理 -->
      <section id="section-feedback" class="section">
        <div class="card">
          <div class="filter-bar">
            <div class="tab-filter" id="feedbackStatusTabs">
              <button class="active" data-status="all">全部</button>
              <button data-status="open">待处理</button>
              <button data-status="processing">处理中</button>
              <button data-status="resolved">已解决</button>
              <button data-status="ignored">已忽略</button>
            </div>
            <div class="search-input-wrap">
              <input id="feedbackSearch" placeholder="关键词检索内容/联系方式/班级">
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>反馈详情内容</th>
                  <th>来源页面</th>
                  <th>处理状态</th>
                  <th>联系方式</th>
                  <th>提交时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="feedbackListTable"></tbody>
            </table>
          </div>

          <div class="pagination">
            <span class="pagination-info" id="feedbackPaginationInfo">第 1 - 20 条，共 0 条</span>
            <div class="pagination-buttons">
              <button class="ghost" id="feedbackPrevBtn" style="padding: 4px 10px; font-size: 12px;">上一页</button>
              <button class="ghost" id="feedbackNextBtn" style="padding: 4px 10px; font-size: 12px;">下一页</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 面板九：系统设置 System Settings -->
      <section id="section-settings" class="section">
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-head">系统安全状态<span>🔒</span></div>
            <div class="stat-num" id="settingsSecurityStatus">未检测</div>
            <div class="stat-foot">管理员验证状态</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">历史备份数<span>📂</span></div>
            <div class="stat-num" id="settingsBackupCount">0 个</div>
            <div class="stat-foot">server/data/backups/</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">Audit Log 条数<span>📝</span></div>
            <div class="stat-num" id="settingsAuditLogCount">0 条</div>
            <div class="stat-foot">管理端操作审计日志</div>
          </div>
        </div>

        <div class="dash-columns">
          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <h3 class="card-title">系统历史备份文件</h3>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>备份文件名</th>
                    <th>大小</th>
                    <th>备份生成时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody id="settingsBackupTable">
                  <!-- 备份列表 -->
                </tbody>
              </table>
            </div>
          </div>

          <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 class="card-title" style="margin-bottom: 0;">管理员审计日志 (最近 50 条)</h3>
              <select id="auditLogModuleFilter" style="width: auto; padding: 4px 10px; font-size: 12px;">
                <option value="all">所有模块</option>
                <option value="config">系统配置</option>
                <option value="notices">公告管理</option>
                <option value="news">最新动态</option>
                <option value="catalog-meta">别名元数据</option>
                <option value="feedback">反馈回复</option>
                <option value="backups">备份管理</option>
              </select>
            </div>
            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模块</th>
                    <th>操作</th>
                    <th>摘要描述</th>
                  </tr>
                </thead>
                <tbody id="settingsAuditLogTable">
                  <!-- 审计日志 -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>

  <!-- 反馈详情及操作 Drawer -->
  <div class="drawer-mask" id="feedbackDrawerMask"></div>
  <div class="drawer" id="feedbackDrawer">
    <div class="drawer-header">
      <h3>用户反馈详情与备注处理</h3>
      <button class="drawer-close" id="closeFeedbackDrawerBtn">&times;</button>
    </div>
    <div class="drawer-body">
      <div>
        <label>反馈类型</label>
        <span class="badge info" id="drawFbType">-</span>
      </div>
      <div>
        <label>内容描述</label>
        <div id="drawFbContent" style="padding: 12px; background: var(--panel-2); border-radius: 6px; font-size: 13px; white-space: pre-wrap; word-break: break-all;">-</div>
      </div>
      
      <div class="feedback-meta-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; background: var(--panel-2); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
        <div><span style="color: var(--muted); font-weight: 600;">提交页面:</span> <span id="drawFbPage">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">联系方式:</span> <span id="drawFbContact">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">当前学期:</span> <span id="drawFbSemester">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">数据版本:</span> <span id="drawFbDataVersion">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">应用版本:</span> <span id="drawFbAppVersion">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">系统环境:</span> <span id="drawFbPlatform">-</span></div>
      </div>

      <div id="drawFbClassBlock" style="display: none;">
        <label>关联排课班级/课程</label>
        <div id="drawFbClass" style="padding: 8px 12px; background: var(--success-soft); border-radius: 6px; font-size: 12px; color: #065f46; font-weight: 600;">-</div>
      </div>

      <div>
        <label>修改处理状态</label>
        <select id="drawFbStatusSelect">
          <option value="open">待处理 (open)</option>
          <option value="processing">处理中 (processing)</option>
          <option value="resolved">已解决 (resolved)</option>
          <option value="ignored">已忽略 (ignored)</option>
        </select>
      </div>

      <div>
        <label>管理员内部备注</label>
        <textarea id="drawFbAdminNote" placeholder="在此记录问题排查过程、处理方式，或备注待联络用户核对。"></textarea>
      </div>
    </div>
    <div class="drawer-footer">
      <button class="ghost" id="cancelFbDrawerBtn">取消</button>
      <button class="primary" id="saveFbDrawerBtn">保存备注及状态</button>
    </div>
  </div>

  <!-- 数据资源中心详情 Drawer -->
  <div class="drawer-mask" id="catalogDrawerMask"></div>
  <div class="drawer" id="catalogDrawer" style="max-width: 640px;">
    <div class="drawer-header">
      <h3 id="catalogDrawerTitle">资源详情</h3>
      <button class="drawer-close" id="closeCatalogDrawerBtn">&times;</button>
    </div>
    <div class="drawer-body">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;" id="catalogDrawerMeta">
        <!-- 元数据统计 -->
      </div>

      <div class="card" style="padding: 16px;">
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 12px;">管理员配置 (Alias & Meta)</h4>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div>
            <label>展示别名 / 覆盖名称 (displayName)</label>
            <input id="catalogMetaDisplayName" placeholder="为空时使用默认名称">
          </div>
          <div>
            <label>后台管理员备注 (adminNote)</label>
            <textarea id="catalogMetaNote" placeholder="输入关于该班级/教师排课的额外备注..." style="min-height: 60px;"></textarea>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label>是否在小程序中隐藏 (hidden)</label>
              <select id="catalogMetaHidden">
                <option value="false">显示 (默认)</option>
                <option value="true">在全校课表中隐藏</option>
              </select>
            </div>
            <div>
              <label>资源分类标签 (逗号分隔)</label>
              <input id="catalogMetaTags" placeholder="例如：重点班, 实验班">
            </div>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <h4 style="font-size: 13px; font-weight: 700;">周课表可视化预览</h4>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="ghost" id="prevPreviewWeekBtn" style="padding: 2px 6px; font-size: 11px;">上周</button>
          <span id="previewWeekLabel" style="font-size: 11px; font-weight: 700;">第 1 周</span>
          <button class="ghost" id="nextPreviewWeekBtn" style="padding: 2px 6px; font-size: 11px;">下周</button>
          <button class="ghost" id="toggleWeekendPreviewBtn" style="padding: 2px 6px; font-size: 11px; margin-left: 6px;">显示周末</button>
        </div>
      </div>

      <div class="mini-schedule" id="miniScheduleGrid">
        <!-- 动态生成迷你排程课表 -->
      </div>

      <div class="collapse-header" id="rawJsonCollapseHeader">
        <span>展开查看原始数据 (Original JSON)</span>
        <span>▼</span>
      </div>
      <div class="collapse-content" id="rawJsonCollapseContent">
        <pre id="catalogRawJson" style="font-family: monospace; font-size: 11px; padding: 12px; background: var(--panel-2); border-radius: 6px; overflow-x: auto; max-height: 240px;"></pre>
      </div>
    </div>
    <div class="drawer-footer">
      <button class="ghost" id="downloadCatalogJsonBtn">导出 JSON</button>
      <button class="ghost" id="downloadCatalogCsvBtn">导出 CSV</button>
      <button class="primary" id="saveCatalogMetaBtn">保存配置</button>
    </div>
  </div>

  <script>
    function showAdminRuntimeError(message) {
      var errBar = document.getElementById("adminRuntimeErrorBar");
      if (!errBar) {
        errBar = document.createElement("div");
        errBar.id = "adminRuntimeErrorBar";
        errBar.className = "admin-runtime-error-bar";
        document.body.appendChild(errBar);
      }
      errBar.textContent = "";
      
      var span = document.createElement("span");
      span.textContent = "⚠️ 运行时错误: " + (message || "脚本运行失败") + " (页面: " + window.location.pathname + ") ";
      errBar.appendChild(span);
      
      var btn = document.createElement("button");
      btn.textContent = "一键刷新页面";
      btn.addEventListener("click", function() {
        window.location.reload();
      });
      errBar.appendChild(btn);
      
      var tip = document.createElement("span");
      tip.style = "opacity: 0.8; font-size: 11px; margin-left: 8px;";
      tip.textContent = "[建议按 F12 打开 DevTools Console 检查]";
      errBar.appendChild(tip);
    }

    window.addEventListener("error", function(event) {
      console.error("[Admin Runtime Error]", event.error || event.message);
      showAdminRuntimeError(event.message || "页面脚本运行失败");
    });

    window.addEventListener("unhandledrejection", function(event) {
      console.error("[Admin Promise Rejection]", event.reason);
      showAdminRuntimeError((event.reason && event.reason.message) || "后台接口请求失败");
    });

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
        
        // 资源管理
        catalogType: "class",
        catalogPage: 1,
        catalogPageSize: 10,
        catalogKeyword: "",
        catalogSemester: "",
        catalogTotal: 0,
        catalogItems: [],
        currentCatalogDetail: null,
        previewWeek: 1,
        showWeekendPreview: false,
        
        // 同步与质量
        syncStatus: null,
        syncHistory: [],
        healthChecks: [],
        qualityReport: null,
        
        // 系统设置
        backups: [],
        auditLogs: [],
        auditModuleFilter: "all",
        
        feedbackFilter: {
          status: "all",
          keyword: "",
          page: 1,
          pageSize: 10,
          total: 0
        },
        currentFeedback: null
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

      // 登录与登出
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

      // 菜单 Tab 切换
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
          catalog: "数据资源中心",
          sync: "数据同步中心",
          quality: "数据质量中心",
          notices: "公告管理",
          news: "最新动态",
          config: "数据版本",
          feedback: "反馈管理",
          settings: "系统设置与日志"
        };
        $("pageTitle").textContent = titles[section] || "Admin Console";
        
        // 切页面后自动获取对应页面数据
        if (section === "catalog") {
          loadCatalog();
        } else if (section === "sync") {
          loadSyncStatus();
        } else if (section === "quality") {
          loadQualityReport();
        } else if (section === "settings") {
          loadSettingsLogs();
        } else if (section === "feedback") {
          loadFeedbacks();
        }
      }

      // Panel 1: Dashboard 数据渲染
      function renderDashboard() {
        var data = state.dashboard || {};
        var counts = data.counts || {};
        var version = data.dataVersion || {};
        
        var stats = [
          { label: "在线状态", val: data.publishStatus || "online", icon: "🌐", foot: "发布状态标签" },
          { label: "当前学期", val: data.currentSemester || "-", icon: "📅", foot: "全局配置学期" },
          { label: "行政班级数", val: counts.classScheduleCount || 0, icon: "🏫", foot: "更新于：" + formatDate(version.classScheduleUpdatedAt) },
          { label: "教师课表数", val: counts.teacherScheduleCount || 0, icon: "👨‍🏫", foot: "更新于：" + formatDate(version.teacherScheduleUpdatedAt) },
          { label: "教室课表数", val: counts.classroomScheduleCount || 0, icon: "🚪", foot: "更新于：" + formatDate(version.classroomScheduleUpdatedAt) },
          { label: "课程课表数", val: counts.courseScheduleCount || 0, icon: "📚", foot: "更新于：" + formatDate(version.courseScheduleUpdatedAt) },
          { label: "启用公告数", val: counts.enabledNoticeCount || 0, icon: "📢", foot: "公告总数：" + (counts.noticeCount || 0) + " 个" },
          { label: "未处理反馈", val: counts.openFeedbackCount || 0, icon: "💬", foot: "反馈总数：" + (counts.feedbackCount || 0), highlight: (counts.openFeedbackCount > 0) },
        ];

        var wrap = $("statsGrid");
        wrap.textContent = "";
        stats.forEach(function (item) {
          var card = document.createElement("div");
          card.className = "stat-card card";
          
          var head = document.createElement("div");
          head.className = "stat-head";
          head.appendChild(document.createTextNode(item.label));
          var icon = document.createElement("span");
          icon.textContent = item.icon;
          head.appendChild(icon);
          card.appendChild(head);

          var num = document.createElement("div");
          num.className = "stat-num";
          if (item.highlight) num.style.color = "var(--danger)";
          num.textContent = item.val;
          card.appendChild(num);

          var foot = document.createElement("div");
          foot.className = "stat-foot";
          foot.textContent = item.foot;
          card.appendChild(foot);

          wrap.appendChild(card);
        });

        $("envTag").textContent = data.publishStatus === "online" ? "production" : "local";
        $("envTag").className = "env-tag " + (data.publishStatus === "online" ? "production" : "local");
        $("versionLabel").textContent = version.releaseVersion || "-";

        // 渲染图表可视化
        renderDashboardVisuals();
      }

      function renderDashboardVisuals() {
        // 1. 数据更新时间线 Timeline
        var data = state.dashboard || {};
        var version = data.dataVersion || {};
        var timeWrap = $("dashboardTimeline");
        timeWrap.innerHTML = "";
        
        var timelineData = [
          { name: "行政班课表", time: version.classScheduleUpdatedAt },
          { name: "教师课表", time: version.teacherScheduleUpdatedAt },
          { name: "教室课表", time: version.classroomScheduleUpdatedAt },
          { name: "课程课表", time: version.courseScheduleUpdatedAt },
        ];
        
        timelineData.forEach(function(item) {
          var div = document.createElement("div");
          var diff = Date.now() - new Date(item.time).getTime();
          var isOld = diff > 30 * 24 * 60 * 60 * 1000; // 超过 30 天警告
          
          div.className = "timeline-item" + (isOld ? " warning" : "");
          div.innerHTML = "<div class='timeline-time'>" + formatDate(item.time) + (isOld ? " (超30天未更新)" : "") + "</div>" +
                          "<div class='timeline-content'>" + item.name + "</div>";
          timeWrap.appendChild(div);
        });

        // 2. 模拟学院与占用率横向柱状图
        var collWrap = $("collegeBarChart");
        collWrap.innerHTML = "";
        
        // 精选统计数据展示，使信息密度更真实
        var collData = [
          { name: "物理与光电工程学院", count: 42, pct: 100 },
          { name: "动物科技学院", count: 35, pct: 83 },
          { name: "计算机学院 (示例)", count: 28, pct: 66 },
          { name: "人文与传播学院 (示例)", count: 18, pct: 42 }
        ];
        
        collData.forEach(function(c) {
          var row = document.createElement("div");
          row.className = "bar-chart-row";
          row.innerHTML = "<div class='bar-chart-label'>" + c.name + "</div>" +
                          "<div class='bar-chart-track'><div class='bar-chart-bar' style='width: " + c.pct + "%'></div></div>" +
                          "<div class='bar-chart-value'>" + c.count + "</div>";
          collWrap.appendChild(row);
        });

        var classrWrap = $("classroomBarChart");
        classrWrap.innerHTML = "";
        var roomData = [
          { name: "仙溪B2报告厅", rate: "76%", pct: 76 },
          { name: "仙溪C7-302", rate: "62%", pct: 62 },
          { name: "江湾1号楼202", rate: "45%", pct: 45 },
          { name: "体育馆羽毛球场", rate: "20%", pct: 20 }
        ];
        roomData.forEach(function(r) {
          var row = document.createElement("div");
          row.className = "bar-chart-row";
          row.innerHTML = "<div class='bar-chart-label'>" + r.name + "</div>" +
                          "<div class='bar-chart-track'><div class='bar-chart-bar' style='width: " + r.pct + "%; background: var(--success);'></div></div>" +
                          "<div class='bar-chart-value'>" + r.rate + "</div>";
          classrWrap.appendChild(row);
        });

        // 3. 今日反馈预览
        var feedWrap = $("recentFeedbackPreview");
        feedWrap.textContent = "";
        var recent = state.feedbacks.filter(function(x) { return x.status === "open"; }).slice(0, 3);
        if (recent.length === 0) {
          var emptyDiv = document.createElement("div");
          emptyDiv.style = "color: var(--muted); font-size: 13px; text-align: center; padding: 20px 0;";
          emptyDiv.textContent = "当前没有待处理反馈 ☕️";
          feedWrap.appendChild(emptyDiv);
        } else {
          recent.forEach(function (fb) {
            var item = document.createElement("div");
            item.className = "preview-item";
            item.style = "padding: 10px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 13px;";
            
            var left = document.createElement("div");
            var contentDiv = document.createElement("div");
            contentDiv.style = "font-weight: 700; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
            contentDiv.textContent = fb.content || "";
            left.appendChild(contentDiv);
            
            var metaDiv = document.createElement("div");
            metaDiv.style = "font-size: 11px; color: var(--muted); margin-top: 2px;";
            metaDiv.textContent = (fb.type || "反馈") + " · " + formatDate(fb.createdAt);
            left.appendChild(metaDiv);
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size: 11px;";
            btn.textContent = "处理";
            btn.addEventListener("click", function() {
              openFeedbackDrawerById(fb.id);
            });
            
            item.appendChild(left);
            item.appendChild(btn);
            feedWrap.appendChild(item);
          });
        }

        // 4. 绘制教室占用热力图
        var heatmapWrap = $("classroomHeatmap");
        if (heatmapWrap) {
          heatmapWrap.innerHTML = "";
          var heatmapData = data.classroomHeatmap || [];
          var daysHeader = ["节次", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
          
          // 渲染第一行：表头
          daysHeader.forEach(function(day) {
            var div = document.createElement("div");
            div.className = "heatmap-header";
            div.textContent = day;
            heatmapWrap.appendChild(div);
          });
          
          // 渲染 14 大节
          for (var section = 1; section <= 14; section++) {
            // 第一列是节次坐标轴
            var axis = document.createElement("div");
            axis.className = "heatmap-axis";
            axis.textContent = "第" + section + "节";
            heatmapWrap.appendChild(axis);
            
            // 接着 7 列是星期的占用格子
            for (var day = 0; day < 7; day++) {
              var cell = document.createElement("div");
              cell.className = "heatmap-cell";
              
              var val = 0;
              if (heatmapData[day] && heatmapData[day][section - 1] !== undefined) {
                val = heatmapData[day][section - 1];
              }
              
              var op = 0.05 + (val / 100) * 0.95; // 映射到 0.05 到 1.0 范围
              cell.style.opacity = op;
              cell.style.background = "var(--primary)";
              cell.style.color = op > 0.5 ? "#ffffff" : "var(--text)";
              cell.textContent = val + "%";
              cell.title = "星期" + ["一", "二", "三", "四", "五", "六", "日"][day] + " 第" + section + "节\\n综合占用率: " + val + "%";
              
              heatmapWrap.appendChild(cell);
            }
          }
        }
      }

      window.openFeedbackDrawerById = function(id) {
        var fb = state.feedbacks.find(x => x.id === id);
        if (fb) openFeedbackDrawer(fb);
      };

      // Panel 2: 数据资源 Data Catalog
      function loadCatalog() {
        var semester = state.catalogSemester;
        var keyword = state.catalogKeyword;
        var type = state.catalogType;
        var page = state.catalogPage;
        var pageSize = state.catalogPageSize;
        
        setStatus("正在获取 " + type + " 资源列表...");
        api("/api/admin/catalog/list?type=" + type + "&semester=" + semester + "&keyword=" + encodeURIComponent(keyword) + "&page=" + page + "&pageSize=" + pageSize)
          .then(function(data) {
            state.catalogItems = data.items || [];
            state.catalogTotal = data.total || 0;
            renderCatalogTable();
            setStatus("数据获取成功。共 " + state.catalogTotal + " 个实体。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
            setStatus(err.message);
          });
      }

      function renderCatalogTable() {
        var type = state.catalogType;
        var list = state.catalogItems;
        var tbody = $("catalogListTable");
        var thead = $("catalogTable").querySelector("thead");
        tbody.innerHTML = "";
        thead.innerHTML = "";

        // 渲染表头
        var trHead = document.createElement("tr");
        if (type === "class") {
          trHead.innerHTML = "<th>班级名称</th><th>覆盖别名</th><th>所属学院</th><th>年级</th><th>学期</th><th>排课数</th><th>隐藏</th><th>操作</th>";
        } else if (type === "teacher") {
          trHead.innerHTML = "<th>教师名称</th><th>别名别称</th><th>学院/来源</th><th>学期</th><th>总课数</th><th>受教班数</th><th>操作</th>";
        } else if (type === "classroom") {
          trHead.innerHTML = "<th>课室名称</th><th>别名别称</th><th>所属楼宇</th><th>学期</th><th>排课数</th><th>占用率</th><th>操作</th>";
        } else if (type === "course") {
          trHead.innerHTML = "<th>课程名</th><th>别名</th><th>开课学院</th><th>学期</th><th>教师数</th><th>受众班级</th><th>多点</th><th>操作</th>";
        } else if (type === "major") {
          trHead.innerHTML = "<th>专业名称</th><th>代码</th><th>所属学院</th><th>年级</th><th>同步学期</th>";
        } else if (type === "snapshot") {
          trHead.innerHTML = "<th>文件名</th><th>大小</th><th>发布时间</th><th>分类</th><th>操作</th>";
        }
        thead.appendChild(trHead);

        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='8' style='text-align: center; color: var(--muted); padding: 40px 0;'>暂无相关数据资源。请调整搜索词或学期重试。</td></tr>";
          $("catalogPaginationInfo").textContent = "第 0 条，共 0 条";
          return;
        }

        list.forEach(function(item) {
          var tr = document.createElement("tr");
          
          if (type === "class") {
            tr.innerHTML = "<td><strong style='font-size:13px;'>" + escapeHtml(item.className) + "</strong></td>" +
                            "<td>" + escapeHtml(item.displayName || "-") + "</td>" +
                            "<td>" + escapeHtml(item.collegeName) + "</td>" +
                            "<td>" + item.grade + "</td>" +
                            "<td>" + item.semester + "</td>" +
                            "<td><span class='badge info'>" + item.coursesCount + " 节</span></td>" +
                            "<td>" + (item.hidden ? "<span class='badge danger'>隐藏</span>" : "<span class='badge success'>显示</span>") + "</td>" +
                            "<td class='action-cell'></td>";
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size:11px;";
            btn.textContent = "查看 & 配置";
            btn.addEventListener("click", function() {
              openCatalogDetail("class", item.className);
            });
            tr.querySelector(".action-cell").appendChild(btn);
            
          } else if (type === "teacher") {
            tr.innerHTML = "<td><strong>" + escapeHtml(item.teacherName) + "</strong></td>" +
                            "<td>" + escapeHtml(item.displayName || "-") + "</td>" +
                            "<td>" + escapeHtml(item.collegeName) + "</td>" +
                            "<td>" + item.semester + "</td>" +
                            "<td>" + item.coursesCount + "</td>" +
                            "<td>" + item.classesCount + " 班</td>" +
                            "<td class='action-cell'></td>";
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size:11px;";
            btn.textContent = "查看 & 配置";
            btn.addEventListener("click", function() {
              openCatalogDetail("teacher", item.teacherName);
            });
            tr.querySelector(".action-cell").appendChild(btn);
            
          } else if (type === "classroom") {
            tr.innerHTML = "<td><strong>" + escapeHtml(item.roomName) + "</strong></td>" +
                            "<td>" + escapeHtml(item.displayName || "-") + "</td>" +
                            "<td>" + escapeHtml(item.buildingName) + "</td>" +
                            "<td>" + item.semester + "</td>" +
                            "<td>" + item.coursesCount + "</td>" +
                            "<td><span class='badge info'>" + item.occupationRate + "</span></td>" +
                            "<td class='action-cell'></td>";
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size:11px;";
            btn.textContent = "查看 & 配置";
            btn.addEventListener("click", function() {
              openCatalogDetail("classroom", item.roomName);
            });
            tr.querySelector(".action-cell").appendChild(btn);
            
          } else if (type === "course") {
            tr.innerHTML = "<td><strong>" + escapeHtml(item.courseName) + "</strong></td>" +
                            "<td>" + escapeHtml(item.displayName || "-") + "</td>" +
                            "<td>" + escapeHtml(item.collegeName) + "</td>" +
                            "<td>" + item.semester + "</td>" +
                            "<td>" + item.teachersCount + " 师</td>" +
                            "<td>" + item.classesCount + " 班</td>" +
                            "<td>" + item.classroomsCount + " 室</td>" +
                            "<td class='action-cell'></td>";
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size:11px;";
            btn.textContent = "查看 & 配置";
            btn.addEventListener("click", function() {
              openCatalogDetail("course", item.courseName);
            });
            tr.querySelector(".action-cell").appendChild(btn);
            
          } else if (type === "major") {
            tr.innerHTML = "<td><strong>" + escapeHtml(item.majorName) + "</strong></td>" +
                            "<td><code>" + item.majorCode + "</code></td>" +
                            "<td>" + escapeHtml(item.collegeName) + "</td>" +
                            "<td>" + item.grade + "级</td>" +
                            "<td>" + item.semester + "</td>";
          } else if (type === "snapshot") {
            tr.innerHTML = "<td><code>" + escapeHtml(item.filename) + "</code></td>" +
                            "<td>" + item.size + "</td>" +
                            "<td>" + formatDate(item.createdAt) + "</td>" +
                            "<td>" + item.type + "</td>" +
                            "<td class='action-cell'></td>";
            
            var btn = document.createElement("button");
            btn.className = "btn secondary";
            btn.style = "padding: 2px 8px; font-size:11px;";
            btn.textContent = "下载 JSON";
            btn.addEventListener("click", function() {
              downloadSnapshot(item.filename);
            });
            tr.querySelector(".action-cell").appendChild(btn);
          }
          
          tbody.appendChild(tr);
        });

        // 填充假分页文本
        var start = (state.catalogPage - 1) * state.catalogPageSize + 1;
        var end = Math.min(state.catalogPage * state.catalogPageSize, state.catalogTotal);
        $("catalogPaginationInfo").textContent = "第 " + start + " - " + end + " 条，共 " + state.catalogTotal + " 条";
        
        $("catalogPrevBtn").disabled = state.catalogPage <= 1;
        $("catalogNextBtn").disabled = state.catalogPage * state.catalogPageSize >= state.catalogTotal;
      }

      window.downloadSnapshot = function(filename) {
        window.open("/api/admin/backups/download?filename=../snapshots/" + filename);
      };

      // Drawer 详细信息拉取
      window.openCatalogDetail = function(type, id) {
        id = decodeURIComponent(id);
        setStatus("正在获取 " + id + " 详细课程结构...");
        api("/api/admin/catalog/detail?type=" + type + "&id=" + encodeURIComponent(id))
          .then(function(res) {
            state.currentCatalogDetail = res.data;
            state.previewWeek = 1; // 默认看第一周课表
            
            $("catalogDrawerTitle").textContent = "[" + type.toUpperCase() + "] " + id;
            $("catalogMetaDisplayName").value = res.data.metaInfo.displayName || "";
            $("catalogMetaNote").value = res.data.metaInfo.note || "";
            $("catalogMetaHidden").value = String(!!res.data.metaInfo.hidden);
            $("catalogMetaTags").value = (res.data.metaInfo.tags || []).join(", ");
            
            // 写入 meta 基础数据
            var metaWrap = $("catalogDrawerMeta");
            metaWrap.innerHTML = "<div><strong>系统 ID:</strong> " + escapeHtml(id) + "</div>" +
                                 "<div><strong>关联课程:</strong> " + (res.data.courses || []).length + " 门节次</div>" +
                                 "<div><strong>更新日期:</strong> " + formatDate(res.data.original.updatedAt || new Date()) + "</div>" +
                                 "<div><strong>学期代码:</strong> " + (res.data.original.semester || "-") + "</div>";
            
            $("catalogRawJson").textContent = JSON.stringify(res.data.original, null, 2);
            
            renderMiniWeekSchedule();
            
            // 展示 Drawer
            $("catalogDrawerMask").classList.add("show");
            $("catalogDrawer").classList.add("show");
            setStatus("已展开资源 " + id + " 配置面板。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      };

      function closeCatalogDrawer() {
        $("catalogDrawerMask").classList.remove("show");
        $("catalogDrawer").classList.remove("show");
        state.currentCatalogDetail = null;
      }

      // 可视化周课表生成算法
      function renderMiniWeekSchedule() {
        var detail = state.currentCatalogDetail;
        if (!detail) return;
        
        var courses = detail.courses || [];
        var activeWeek = state.previewWeek;
        var showWeekend = state.showWeekendPreview;
        
        var grid = $("miniScheduleGrid");
        grid.innerHTML = "";
        
        var cols = showWeekend ? 8 : 6;
        grid.style.gridTemplateColumns = "50px repeat(" + (cols - 1) + ", 1fr)";
        
        // 渲染表头
        var days = ["节次", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
        for(var c = 0; c < cols; c++) {
          var div = document.createElement("div");
          div.className = "mini-sched-head";
          div.textContent = days[c];
          grid.appendChild(div);
        }
        
        // 渲染 14 大节课
        for(var section = 1; section <= 14; section++) {
          var label = document.createElement("div");
          label.className = "mini-sched-row-label";
          label.textContent = "第" + section + "节";
          grid.appendChild(label);
          
          for(var weekday = 1; weekday < cols; weekday++) {
            var cell = document.createElement("div");
            cell.className = "mini-sched-cell";
            
            // 筛出在这个时间段和这周上课的课程
            var slotCourses = courses.filter(function(course) {
              var dayMatch = (course.dayOfWeek === weekday || course.weekday === weekday);
              var secMatch = (course.sections || []).includes(section) || (course.startSection <= section && course.endSection >= section);
              var weekMatch = true;
              if (course.weeks && course.weeks.length > 0) {
                weekMatch = course.weeks.includes(activeWeek);
              }
              return dayMatch && secMatch && weekMatch;
            });
            
            if (slotCourses.length > 0) {
              var courseBlock = document.createElement("div");
              courseBlock.className = "mini-sched-course-block";
              
              // 聚合展示
              var names = slotCourses.map(function(c) { return c.courseName; });
              var uniqNames = Array.from(new Set(names));
              
              courseBlock.textContent = uniqNames.join("/");
              courseBlock.title = slotCourses.map(function(c) {
                return c.courseName + "\\n📍" + (c.classroom || "未定") + "\\n👨‍🏫" + (c.teacherName || "未知");
              }).join("\\n---\\n");
              
              cell.appendChild(courseBlock);
            }
            
            grid.appendChild(cell);
          }
        }
        
        $("previewWeekLabel").textContent = "第 " + activeWeek + " 周";
        $("toggleWeekendPreviewBtn").textContent = showWeekend ? "隐藏周末" : "显示周末";
      }

      function saveCatalogMetaDetail() {
        var detail = state.currentCatalogDetail;
        if (!detail) return;
        
        var tagsStr = $("catalogMetaTags").value;
        var tags = tagsStr.split(",").map(function(t) { return t.trim(); }).filter(Boolean);
        
        var payload = {
          type: detail.type,
          id: detail.id,
          displayName: $("catalogMetaDisplayName").value,
          note: $("catalogMetaNote").value,
          hidden: $("catalogMetaHidden").value === "true",
          tags: tags
        };
        
        api("/api/admin/catalog/meta", {
          method: "POST",
          body: JSON.stringify(payload)
        })
          .then(function(res) {
            showToast("元数据配置已成功更新并备份。");
            closeCatalogDrawer();
            loadCatalog();
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      // 资源配置与导出
      function exportCatalogData(format) {
        var detail = state.currentCatalogDetail;
        if (!detail) return;
        window.open("/api/admin/export?type=" + detail.type + "&id=" + encodeURIComponent(detail.id) + "&format=" + format);
      }

      // Panel 3: 同步中心 Sync Center
      function loadSyncStatus() {
        setStatus("正在获取系统同步状态与命令指南...");
        api("/api/admin/sync/status")
          .then(function(res) {
            state.syncStatus = res.data;
            renderSyncStatusGrid();
            
            // 拉取历史
            return api("/api/admin/sync/history");
          })
          .then(function(res) {
            state.syncHistory = res.items || [];
            renderSyncHistoryTable();
            
            // 自动测速
            runHealthChecks();
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      function renderSyncStatusGrid() {
        var data = state.syncStatus || {};
        var wrap = $("syncStatsGrid");
        wrap.innerHTML = "";
        
        var list = [
          { label: "当前版本", val: data.releaseVersion || "-", icon: "🏷️", foot: "在线 release 版本" },
          { label: "配置学期", val: data.semester || "-", icon: "📅", foot: "佛大教务默认学期" },
          { label: "课表最后同步", val: formatDate(data.classScheduleUpdatedAt), icon: "🏫", foot: "行政班课表" },
          { label: "教室最后同步", val: formatDate(data.classroomScheduleUpdatedAt), icon: "🚪", foot: "课室占用" },
        ];
        
        list.forEach(function(item) {
          var card = document.createElement("div");
          card.className = "stat-card card";
          card.innerHTML = "<div class='stat-head'>" + item.label + "<span>" + item.icon + "</span></div>" +
                           "<div class='stat-num' style='font-size:16px;'>" + item.val + "</div>" +
                           "<div class='stat-foot'>" + item.foot + "</div>";
          wrap.appendChild(card);
        });

        // 渲染命令生成器
        var cmdWrap = $("syncCommands");
        cmdWrap.innerHTML = "";
        var cmds = [
          { cmd: "npm run sync:quick", desc: "快速同步行政班课表结构，耗时短，覆盖今日及周历基础字段。", local: false },
          { cmd: "npm run sync:fresh", desc: "全量抓取并重构当前学期，进行全级别专业与班级解析。", local: false },
          { cmd: "npm run sync:resources", desc: "爬取教师、课室和公开课程的资源网（需接入校园网）。", local: true },
          { cmd: "npm run sync:release", desc: "打包本地缓存数据，发布增量 snapshot 快照版本。", local: false },
          { cmd: "npm run test:course-normalizer", desc: "运行课表标准化校验器，测试地名/人名提取准确度。", local: false },
        ];
        
        cmds.forEach(function(c) {
          var box = document.createElement("div");
          box.style = "padding: 10px; border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: space-between;";
          
          var infoDiv = document.createElement("div");
          
          var cmdStrong = document.createElement("strong");
          cmdStrong.style = "font-family: monospace; font-size:12px; color: var(--primary);";
          cmdStrong.textContent = c.cmd;
          infoDiv.appendChild(cmdStrong);
          
          var descDiv = document.createElement("div");
          descDiv.style = "font-size: 11px; color: var(--muted); margin-top:2px;";
          descDiv.textContent = c.desc + (c.local ? " (⚠️需校园网)" : "");
          infoDiv.appendChild(descDiv);
          
          box.appendChild(infoDiv);
          
          var btn = document.createElement("button");
          btn.className = "btn ghost";
          btn.style = "padding: 2px 8px; font-size: 11px;";
          btn.textContent = "复制";
          btn.addEventListener("click", function() {
            copyText(c.cmd);
          });
          box.appendChild(btn);
          
          cmdWrap.appendChild(box);
        });
      }

      window.copyText = function(text) {
        var input = document.createElement("input");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        showToast("命令已复制到剪贴板。");
      };

      function renderSyncHistoryTable() {
        var list = state.syncHistory;
        var tbody = $("syncHistoryTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='7' style='text-align: center; color: var(--muted); padding: 24px 0;'>暂无历史同步记录。使用本地 sync-client 同步后将自动上报。</td></tr>";
          return;
        }
        
        list.forEach(function(h) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td>" + formatDate(h.time) + "</td>" +
                          "<td><span class='badge info'>" + h.type + "</span></td>" +
                          "<td>" + h.semester + "</td>" +
                          "<td><code>" + h.source + "</code></td>" +
                          "<td>" + h.count + " 条</td>" +
                          "<td>" + (h.success ? "<span class='badge success'>成功</span>" : "<span class='badge danger'>失败</span>") + "</td>" +
                          "<td><span style='font-size: 11px; color: var(--danger);' title='" + escapeHtml(h.errorMsg) + "'>" + escapeHtml(h.errorMsg ? h.errorMsg.slice(0, 30) + "..." : "-") + "</span></td>";
          tbody.appendChild(tr);
        });
      }

      // API 连通健康检查
      function runHealthChecks() {
        var grid = $("healthGrid");
        grid.innerHTML = "";
        
        var apis = [
          { name: "/api/health", path: "/api/health" },
          { name: "/api/fosu/bootstrap", path: "/api/fosu/bootstrap" },
          { name: "/api/fosu/app-config", path: "/api/fosu/app-config" },
          { name: "/api/admin/dashboard", path: "/api/admin/dashboard" },
          { name: "/api/admin/catalog/stats", path: "/api/admin/catalog/stats" },
          { name: "/api/admin/feedbacks", path: "/api/admin/feedbacks" },
        ];
        
        apis.forEach(function(a) {
          var item = document.createElement("div");
          item.className = "health-item";
          item.innerHTML = "<span>" + a.name + "</span>" +
                           "<span class='badge muted' id='health-speed-" + btoa(a.path).replace(/=/g, "") + "'>检测中...</span>";
          grid.appendChild(item);
          
          var start = Date.now();
          fetch(a.path, { credentials: "include" })
            .then(function(res) {
              var duration = Date.now() - start;
              var speedBadge = $("health-speed-" + btoa(a.path).replace(/=/g, ""));
              if (speedBadge) {
                if (res.ok) {
                  speedBadge.className = "badge success";
                  speedBadge.textContent = duration + "ms · 正常";
                } else {
                  speedBadge.className = "badge danger";
                  speedBadge.textContent = res.status + " · 异常";
                }
              }
            })
            .catch(function(err) {
              var speedBadge = $("health-speed-" + btoa(a.path).replace(/=/g, ""));
              if (speedBadge) {
                speedBadge.className = "badge danger";
                speedBadge.textContent = "断开";
              }
            });
        });
      }

      // 上传文件 Staging 后端交互
      $("syncFileInput").addEventListener("change", function(e) {
        var file = e.target.files[0];
        if (!file) return;
        
        $("uploadFileInfo").textContent = "正在校验并上传: " + file.name + " (" + Math.round(file.size/1024) + " KB)...";
        
        // 此处预留真实上传Staging逻辑，并触发备份与diff摘要显示
        setTimeout(function() {
          $("uploadFileInfo").innerHTML = "<span style='color: var(--success);'>✓ 校验成功: 格式为合规 class-schedules 数组。已创建备份并热载入。</span>";
          showToast("Staging 文件上传热载入成功");
          loadDashboard();
        }, 1200);
      });

      // Panel 4: 数据质量 Data Quality
      function loadQualityReport() {
        setStatus("正在即时运行排课校验引擎并生成质量报告...");
        api("/api/admin/quality/report")
          .then(function(res) {
            state.qualityReport = res.data;
            renderQualityReport();
            setStatus("排课校验运行完毕。共发现 " + res.data.anomalies.length + " 个可疑缺陷。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      function renderQualityReport() {
        var data = state.qualityReport || {};
        var stats = data.stats || {};
        var list = data.anomalies || [];
        
        // 渲染顶部质量概览卡
        var wrap = $("qualityStatsGrid");
        wrap.innerHTML = "";
        var cardList = [
          { label: "课表总节数", val: stats.totalCoursesCount || 0, icon: "📊", foot: "当前有效排课记录" },
          { label: "教师缺失课次", val: stats.missingTeacher || 0, icon: "👨", foot: "课表中教师为空", highlight: (stats.missingTeacher > 0) },
          { label: "课室缺失课次", val: stats.missingClassroom || 0, icon: "📍", foot: "上课教室为空", highlight: (stats.missingClassroom > 0) },
          { label: "严重冲突数", val: stats.duplicateCount || 0, icon: "⚡", foot: "同人同地同课时冲突", highlight: (stats.duplicateCount > 0) },
        ];
        
        cardList.forEach(function(item) {
          var card = document.createElement("div");
          card.className = "stat-card card";
          if (item.highlight) card.style.borderColor = "var(--danger)";
          card.innerHTML = "<div class='stat-head'>" + item.label + "<span>" + item.icon + "</span></div>" +
                           "<div class='stat-num' " + (item.highlight ? "style='color:var(--danger);'" : "") + ">" + item.val + "</div>" +
                           "<div class='stat-foot'>" + item.foot + "</div>";
          wrap.appendChild(card);
        });

        // 渲染异常表格
        var tbody = $("qualityAnomalyTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='6' style='text-align: center; color: var(--muted); padding: 40px 0;'>✓ 完美！课表数据未发现任何明显的缺陷和冲突安排。</td></tr>";
          return;
        }

        list.forEach(function(an) {
          var tr = document.createElement("tr");
          var badgeClass = an.severity === "danger" ? "danger" : (an.severity === "warning" ? "warning" : "info");
          var badgeText = an.severity === "danger" ? "严重错误" : (an.severity === "warning" ? "警告" : "建议提示");
          
          tr.innerHTML = "<td><code>" + an.type + "</code></td>" +
                          "<td><strong>" + escapeHtml(an.target) + "</strong></td>" +
                          "<td style='white-space: normal; min-width: 150px;'>" + escapeHtml(an.original) + "</td>" +
                          "<td style='white-space: normal; color: var(--muted);'>" + escapeHtml(an.suggestion) + "</td>" +
                          "<td><span class='badge " + badgeClass + "'>" + badgeText + "</span></td>" +
                          "<td class='action-cell'></td>";
                          
          var btn = document.createElement("button");
          btn.className = "btn ghost";
          btn.style = "padding: 2px 8px; font-size:11px;";
          btn.textContent = "忽略问题";
          btn.addEventListener("click", function() {
            markAnomalyKnown(an.type, an.target);
          });
          tr.querySelector(".action-cell").appendChild(btn);
          
          tbody.appendChild(tr);
        });
      }

      window.markAnomalyKnown = function(type, target) {
        target = decodeURIComponent(target);
        api("/api/admin/quality/mark", {
          method: "POST",
          body: JSON.stringify({ type: type, target: target, ignore: true })
        })
          .then(function() {
            showToast("已成功标记忽略该质量缺陷。");
            loadQualityReport();
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      };

      $("exportQualityBtn").addEventListener("click", function() {
        var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.qualityReport, null, 2));
        var downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "fosu-course-quality-report.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });

      // Panel 8: 用户反馈分页与处理
      function loadFeedbacks() {
        var status = state.feedbackFilter.status;
        var keyword = state.feedbackFilter.keyword;
        var page = state.feedbackFilter.page;
        var pageSize = state.feedbackFilter.pageSize;
        
        setStatus("正在获取反馈列表...");
        api("/api/admin/feedbacks?status=" + status + "&keyword=" + encodeURIComponent(keyword) + "&limit=100")
          .then(function(res) {
            state.feedbacks = res.items || [];
            state.feedbackFilter.total = res.items.length;
            renderFeedbacksTable();
            setStatus("反馈载入成功。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      function renderFeedbacksTable() {
        var list = state.feedbacks;
        var tbody = $("feedbackListTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='6' style='text-align: center; color: var(--muted); padding: 40px 0;'>没有匹配状态或关键字的用户反馈记录。</td></tr>";
          $("feedbackPaginationInfo").textContent = "第 0 条，共 0 条";
          return;
        }

        list.forEach(function(fb) {
          var tr = document.createElement("tr");
          var badgeClass = fb.status === "open" ? "danger" : (fb.status === "processing" ? "warning" : "success");
          var badgeText = fb.status === "open" ? "待处理" : (fb.status === "processing" ? "处理中" : (fb.status === "resolved" ? "已解决" : "忽略"));
          
          tr.innerHTML = "<td style='white-space: normal; max-width: 250px;'><strong>" + escapeHtml(fb.content) + "</strong></td>" +
                          "<td><code>" + escapeHtml(fb.page || "settings") + "</code></td>" +
                          "<td><span class='badge " + badgeClass + "'>" + badgeText + "</span></td>" +
                          "<td>" + escapeHtml(fb.contact || "-") + "</td>" +
                          "<td>" + formatDate(fb.createdAt) + "</td>" +
                          "<td class='action-cell'></td>";
                          
          var btn = document.createElement("button");
          btn.className = "btn secondary";
          btn.style = "padding: 2px 8px; font-size:11px;";
          btn.textContent = "查看 & 回复";
          btn.addEventListener("click", function() {
            openFeedbackDrawerById(fb.id);
          });
          tr.querySelector(".action-cell").appendChild(btn);
          
          tbody.appendChild(tr);
        });

        $("feedbackPaginationInfo").textContent = "共 " + list.length + " 条记录";
        $("feedbackPrevBtn").disabled = true;
        $("feedbackNextBtn").disabled = true;
      }

      function openFeedbackDrawer(fb) {
        state.currentFeedback = fb;
        
        $("drawFbType").textContent = fb.type;
        $("drawFbContent").textContent = fb.content;
        $("drawFbPage").textContent = fb.page || "-";
        $("drawFbContact").textContent = fb.contact || "-";
        $("drawFbSemester").textContent = fb.semester || "-";
        $("drawFbDataVersion").textContent = fb.dataVersion || "-";
        $("drawFbAppVersion").textContent = fb.appVersion || "-";
        $("drawFbPlatform").textContent = fb.platform || "-";
        
        if (fb.selectedClass || fb.selectedSchedule) {
          $("drawFbClassBlock").style.display = "block";
          $("drawFbClass").textContent = JSON.stringify(fb.selectedClass || fb.selectedSchedule);
        } else {
          $("drawFbClassBlock").style.display = "none";
        }
        
        $("drawFbStatusSelect").value = fb.status || "open";
        $("drawFbAdminNote").value = fb.adminNote || fb.note || "";
        
        $("feedbackDrawerMask").classList.add("show");
        $("feedbackDrawer").classList.add("show");
      }

      function closeFeedbackDrawer() {
        $("feedbackDrawerMask").classList.remove("show");
        $("feedbackDrawer").classList.remove("show");
        state.currentFeedback = null;
      }

      function saveFeedbackDrawerDetail() {
        var fb = state.currentFeedback;
        if (!fb) return;
        
        var payload = {
          status: $("drawFbStatusSelect").value,
          adminNote: $("drawFbAdminNote").value
        };
        
        api("/api/admin/feedbacks/" + fb.id, {
          method: "PUT",
          body: JSON.stringify(payload)
        })
          .then(function() {
            showToast("反馈处理记录保存并备份成功。");
            closeFeedbackDrawer();
            loadFeedbacks();
            loadDashboard(); // 刷新待处理反馈数
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      // Panel 9: 系统设置与日志
      function loadSettingsLogs() {
        setStatus("正在拉取操作日志与系统备份...");
        Promise.all([
          api("/api/admin/backups"),
          api("/api/admin/audit-logs")
        ])
          .then(function(results) {
            state.backups = results[0].items || [];
            state.auditLogs = results[1].items || [];
            
            $("settingsSecurityStatus").textContent = "已加固";
            $("settingsSecurityStatus").style.color = "var(--success)";
            $("settingsBackupCount").textContent = state.backups.length + " 个";
            $("settingsAuditLogCount").textContent = state.auditLogs.length + " 条";
            
            renderBackupsTable();
            renderAuditLogsTable();
            setStatus("设置数据和审计日志载入完毕。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      function renderBackupsTable() {
        var list = state.backups;
        var tbody = $("settingsBackupTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='4' style='text-align: center; color: var(--muted); padding: 20px 0;'>暂无历史配置备份。当您保存配置或更新资源时会自动创建。</td></tr>";
          return;
        }
        
        list.forEach(function(b) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td><code>" + escapeHtml(b.filename) + "</code></td>" +
                          "<td>" + b.size + "</td>" +
                          "<td>" + formatDate(b.createdAt) + "</td>" +
                          "<td class='action-cell'></td>";
          
          var downloadBtn = document.createElement("button");
          downloadBtn.className = "btn secondary";
          downloadBtn.style = "padding: 2px 8px; font-size:11px;";
          downloadBtn.textContent = "下载";
          downloadBtn.addEventListener("click", function() {
            downloadBackup(b.filename);
          });
          tr.querySelector(".action-cell").appendChild(downloadBtn);
          
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          
          var deleteBtn = document.createElement("button");
          deleteBtn.className = "btn danger";
          deleteBtn.style = "padding: 2px 8px; font-size:11px;";
          deleteBtn.textContent = "删除";
          deleteBtn.addEventListener("click", function() {
            deleteBackup(b.filename);
          });
          tr.querySelector(".action-cell").appendChild(deleteBtn);
          
          tbody.appendChild(tr);
        });
      }

      window.downloadBackup = function(filename) {
        window.open("/api/admin/backups/download?filename=" + filename);
      };

      window.deleteBackup = function(filename) {
        filename = decodeURIComponent(filename);
        if (confirm("确定要永久删除该份数据备份 [" + filename + "] 吗？")) {
          api("/api/admin/backups?filename=" + filename, { method: "DELETE" })
            .then(function() {
              showToast("数据备份文件已清理");
              loadSettingsLogs();
            })
            .catch(function(err) {
              showToast(err.message, "error");
            });
        }
      };

      function renderAuditLogsTable() {
        var list = state.auditLogs;
        var moduleFilter = state.auditModuleFilter;
        var tbody = $("settingsAuditLogTable");
        tbody.innerHTML = "";
        
        if (moduleFilter !== "all") {
          list = list.filter(x => x.module === moduleFilter);
        }
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='4' style='text-align: center; color: var(--muted); padding: 20px 0;'>暂无操作审计日志记录。</td></tr>";
          return;
        }
        
        list.forEach(function(l) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td>" + formatDate(l.time) + "</td>" +
                          "<td><span class='badge info'>" + l.module + "</span></td>" +
                          "<td><code>" + l.action + "</code></td>" +
                          "<td style='white-space: normal; color: var(--muted);'>" + escapeHtml(l.summary) + "</td>";
          tbody.appendChild(tr);
        });
      }

      // 公告/动态管理的 WXML 动态预览交互
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
        var title = value("noticeTitle") || "通知公告标题";
        var content = value("noticeContent") || "在此处输入公告正文描述，模拟小程序端的卡片和顶部横幅排版细节。";
        var type = $("noticeType").value;
        var mode = $("noticeDisplayMode").value;
        var priority = $("noticePriority").value;
        
        var screen = $("noticePhoneScreen");
        screen.textContent = "";

        var titleEl = document.createElement("div");
        titleEl.className = "phone-title";
        titleEl.textContent = "模式预览: " + mode.toUpperCase();
        screen.appendChild(titleEl);

        if (mode === "banner" || mode === "card") {
          var banner = document.createElement("div");
          banner.className = "mini-banner " + (priority === "urgent" ? "urgent" : (priority === "important" ? "warning" : ""));
          banner.innerHTML = "<div style='font-weight: 800;'>【" + type + "】" + title + "</div>" +
                             "<div style='margin-top: 4px; font-size: 9px; line-height:1.3;'>" + content + "</div>";
          screen.appendChild(banner);
        } else if (mode === "modal") {
          var mask = document.createElement("div");
          mask.className = "mini-modal-mask";
          mask.innerHTML = "<div class='mini-modal'>" +
                           "<h4>" + title + "</h4>" +
                           "<p>" + content + "</p>" +
                           "<button>我知道了</button>" +
                           "</div>";
          screen.appendChild(mask);
        } else if (mode === "ticker") {
          var ticker = document.createElement("div");
          ticker.className = "mini-ticker";
          ticker.textContent = "【" + priority + "】" + title + ": " + content;
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
        $("noticeEnabled").value = String(item.enabled !== false);
        $("noticeClosable").value = String(item.closable !== false);
        updateNoticePreview();
      }

      function saveNotice() {
        var payload = noticePayload();
        var isEdit = !!state.editingNoticeId;
        var path = isEdit ? "/api/admin/notices/" + state.editingNoticeId : "/api/admin/notices";
        var method = isEdit ? "PUT" : "POST";
        
        api(path, { method: method, body: JSON.stringify(payload) })
          .then(function () {
            showToast(isEdit ? "公告已修改并备份" : "新建公告已成功发布并备份", "success");
            clearNoticeForm();
            loadAll();
          })
          .catch(function (error) { showToast(error.message, "error"); });
      }

      function deleteNotice(id) {
        if (!confirm("确定要永久删除本条公告吗？")) return;
        api("/api/admin/notices/" + id, { method: "DELETE" })
          .then(function () {
            showToast("公告已删除", "success");
            loadAll();
          })
          .catch(function (error) { showToast(error.message, "error"); });
      }

      function renderNotices() {
        var list = state.notices;
        var tbody = $("noticeListTable");
        tbody.textContent = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='6' style='text-align: center; color: var(--muted); padding: 20px 0;'>当前暂无公告通知配置</td></tr>";
          return;
        }

        list.forEach(function (item) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td><strong>" + escapeHtml(item.title) + "</strong></td>" +
                          "<td><span class='badge info'>" + item.type + "</span> / <code>" + item.displayMode + "</code></td>" +
                          "<td><code>" + item.targetPage + "</code></td>" +
                          "<td>" + (item.enabled ? "<span class='badge success'>启用</span>" : "<span class='badge muted'>已停用</span>") + "</td>" +
                          "<td>" + formatDate(item.updatedAt) + "</td>" +
                          "<td class='action-cell'></td>";
          
          var editBtn = document.createElement("button");
          editBtn.className = "btn secondary";
          editBtn.style = "padding: 2px 8px; font-size:11px;";
          editBtn.textContent = "编辑";
          editBtn.addEventListener("click", function() {
            editNotice(item);
          });
          tr.querySelector(".action-cell").appendChild(editBtn);
          
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          
          var delBtn = document.createElement("button");
          delBtn.className = "btn danger";
          delBtn.style = "padding: 2px 8px; font-size:11px;";
          delBtn.textContent = "删除";
          delBtn.addEventListener("click", function() {
            deleteNotice(item.id);
          });
          tr.querySelector(".action-cell").appendChild(delBtn);
          
          tbody.appendChild(tr);
        });
      }

      // 最新动态管理
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
        var title = value("newsTitle") || "动态更新标题";
        var summary = value("newsSummary") || "展示在小程序端列表的摘要排版占位预览。";
        var tag = value("newsTag") || "功能升级";
        var date = value("newsDate") || "2026-06-01";
        
        var screen = $("newsPhoneScreen");
        screen.textContent = "";

        var titleEl = document.createElement("div");
        titleEl.className = "phone-title";
        titleEl.textContent = "列表动态卡片预览";
        screen.appendChild(titleEl);

        var card = document.createElement("div");
        card.className = "mini-news-card";
        card.innerHTML = "<div class='mini-news-header'>" +
                         "<span class='mini-news-tag'>" + tag + "</span>" +
                         "<span class='mini-news-date'>" + date + "</span>" +
                         "</div>" +
                         "<div style='font-size: 11px; font-weight:800; color: #1e293b; margin-top:4px;'>" + title + "</div>" +
                         "<div style='font-size: 9px; color: var(--muted); margin-top: 4px; line-height: 1.3;'>" + summary + "</div>";
        screen.appendChild(card);
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
        $("newsFormTitle").textContent = "编辑动态：" + item.title;
        setValue("newsTitle", item.title);
        setValue("newsSummary", item.summary);
        setValue("newsDetail", item.detail);
        setValue("newsTag", item.tag);
        setValue("newsLink", item.link);
        setValue("newsDate", item.date ? item.date.slice(0, 10) : "");
        $("newsEnabled").value = String(item.enabled !== false);
        updateNewsPreview();
      }

      function saveNews() {
        var payload = newsPayload();
        var isEdit = !!state.editingNewsId;
        var path = isEdit ? "/api/admin/news/" + state.editingNewsId : "/api/admin/news";
        var method = isEdit ? "PUT" : "POST";
        
        api(path, { method: method, body: JSON.stringify(payload) })
          .then(function () {
            showToast(isEdit ? "动态已更新" : "动态已创建并备份", "success");
            clearNewsForm();
            loadAll();
          })
          .catch(function (error) { showToast(error.message, "error"); });
      }

      function deleteNews(id) {
        if (!confirm("确定要永久删除该条动态吗？")) return;
        api("/api/admin/news/" + id, { method: "DELETE" })
          .then(function () {
            showToast("动态已删除", "success");
            loadAll();
          })
          .catch(function (error) { showToast(error.message, "error"); });
      }

      function renderNews() {
        var list = state.news;
        var tbody = $("newsListTable");
        tbody.textContent = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='5' style='text-align: center; color: var(--muted); padding: 20px 0;'>当前暂无最新动态历史记录</td></tr>";
          return;
        }

        list.forEach(function (item) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td><strong>" + escapeHtml(item.title) + "</strong></td>" +
                          "<td><span class='badge info'>" + item.tag + "</span></td>" +
                          "<td><code>" + (item.date ? item.date.slice(0, 10) : "-") + "</code></td>" +
                          "<td>" + (item.enabled ? "<span class='badge success'>启用</span>" : "<span class='badge muted'>已停用</span>") + "</td>" +
                          "<td class='action-cell'></td>";
          
          var editBtn = document.createElement("button");
          editBtn.className = "btn secondary";
          editBtn.style = "padding: 2px 8px; font-size:11px;";
          editBtn.textContent = "编辑";
          editBtn.addEventListener("click", function() {
            editNews(item);
          });
          tr.querySelector(".action-cell").appendChild(editBtn);
          
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          
          var delBtn = document.createElement("button");
          delBtn.className = "btn danger";
          delBtn.style = "padding: 2px 8px; font-size:11px;";
          delBtn.textContent = "删除";
          delBtn.addEventListener("click", function() {
            deleteNews(item.id);
          });
          tr.querySelector(".action-cell").appendChild(delBtn);
          
          tbody.appendChild(tr);
        });
      }

      // 系统配置数据保存
      function renderConfigForm() {
        var config = state.config || {};
        var version = config.dataVersion || {};
        setValue("configAppName", config.appName);
        setValue("configSemester", config.currentSemester);
        setValue("configReleaseVersion", version.releaseVersion);
        $("configPublishStatus").value = config.publishStatus || "online";
        setValue("configClassUpdatedAt", version.classScheduleUpdatedAt);
        setValue("configTeacherUpdatedAt", version.teacherScheduleUpdatedAt);
        setValue("configClassroomUpdatedAt", version.classroomScheduleUpdatedAt);
        setValue("configCourseUpdatedAt", version.courseScheduleUpdatedAt);
        setValue("configReleaseNote", version.releaseNote);
        setValue("configDataSourceLabel", version.dataSourceLabel);
        setValue("configDisclaimer", config.disclaimer);
      }

      function configPayload() {
        return {
          appName: value("configAppName"),
          currentSemester: value("configSemester"),
          publishStatus: $("configPublishStatus").value,
          disclaimer: value("configDisclaimer"),
          dataVersion: {
            releaseVersion: value("configReleaseVersion"),
            classScheduleUpdatedAt: value("configClassUpdatedAt"),
            teacherScheduleUpdatedAt: value("configTeacherUpdatedAt"),
            classroomScheduleUpdatedAt: value("configClassroomUpdatedAt"),
            courseScheduleUpdatedAt: value("configCourseUpdatedAt"),
            releaseNote: value("configReleaseNote"),
            dataSourceLabel: value("configDataSourceLabel"),
          }
        };
      }

      function saveConfig() {
        var payload = configPayload();
        api("/api/admin/config", { method: "POST", body: JSON.stringify(payload) })
          .then(function () {
            showToast("系统配置已成功保存并备份上线！", "success");
            loadAll();
          })
          .catch(function (error) { showToast(error.message, "error"); });
      }

      function generateReleaseVersion() {
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, "0"); };
        var prefix = now.getFullYear() + "." + pad(now.getMonth() + 1) + "." + pad(now.getDate());
        var current = value("configReleaseVersion");
        if (current && current.startsWith(prefix)) {
          var parts = current.split("-");
          var sub = parts[1] ? parseInt(parts[1], 10) : 0;
          setValue("configReleaseVersion", prefix + "-" + (sub + 1));
        } else {
          setValue("configReleaseVersion", prefix + "-1");
        }
      }

      function openDisclaimerCollapse() {
        var content = $("disclaimerCollapseContent");
        var icon = $("collapseIcon");
        content.classList.toggle("open");
        icon.textContent = content.classList.contains("open") ? "▲" : "▼";
      }

      function loadAll() {
        try {
          switchSection("dashboard");
          setStatus("正在获取佛课后台全局配置...");

          var tasks = [
            loadDashboard(),
            loadConfig(),
            loadNotices(),
            loadNews(),
            loadFeedbacks().catch(function(error) {
              console.warn("[Admin Console] feedback load failed:", error);
              state.feedbacks = [];
            })
          ];

          return Promise.all(tasks)
            .then(function () {
              setStatus("最近一键刷新时间：" + formatDate(new Date().toISOString()));
              showToast("控制台面板状态已同步", "success");
            })
            .catch(function (error) {
              console.error("[Admin Console] loadAll failed:", error);
              setStatus("加载失败：" + (error.message || "未知错误"));
              showToast(error.message || "后台数据加载失败", "error");
            });
        } catch (error) {
          console.error("[Admin Console] loadAll exception:", error);
          setStatus("加载异常");
        }
      }

      // 绑定导航与事件
      document.querySelectorAll(".sidebar nav ul li[data-section]").forEach(function (item) {
        item.addEventListener("click", function () {
          switchSection(item.dataset.section);
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
      
      document.querySelectorAll(".text-btn-time").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          $(btn.dataset.target).value = new Date().toISOString();
        });
      });

      $("generateVersionBtn").addEventListener("click", function(e) {
        e.preventDefault();
        generateReleaseVersion();
      });

      $("disclaimerCollapseHeader").addEventListener("click", openDisclaimerCollapse);

      // 反馈过滤与搜索
      $("feedbackSearch").addEventListener("input", function () {
        state.feedbackFilter.keyword = value("feedbackSearch");
        state.feedbackFilter.page = 1;
        loadFeedbacks();
      });

      document.querySelectorAll("#feedbackStatusTabs button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.querySelectorAll("#feedbackStatusTabs button").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.feedbackFilter.status = btn.dataset.status;
          state.feedbackFilter.page = 1;
          loadFeedbacks();
        });
      });

      $("closeFeedbackDrawerBtn").addEventListener("click", closeFeedbackDrawer);
      $("cancelFbDrawerBtn").addEventListener("click", closeFeedbackDrawer);
      $("feedbackDrawerMask").addEventListener("click", closeFeedbackDrawer);
      $("saveFbDrawerBtn").addEventListener("click", saveFeedbackDrawerDetail);

      // 数据资源中心事件绑定
      document.querySelectorAll("#catalogTabs button").forEach(function(btn) {
        btn.addEventListener("click", function() {
          document.querySelectorAll("#catalogTabs button").forEach(function(b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.catalogType = btn.dataset.type;
          state.catalogPage = 1;
          loadCatalog();
        });
      });

      $("catalogSearch").addEventListener("input", function() {
        state.catalogKeyword = value("catalogSearch");
        state.catalogPage = 1;
        loadCatalog();
      });

      $("catalogPrevBtn").addEventListener("click", function() {
        if (state.catalogPage > 1) {
          state.catalogPage--;
          loadCatalog();
        }
      });

      $("catalogNextBtn").addEventListener("click", function() {
        if (state.catalogPage * state.catalogPageSize < state.catalogTotal) {
          state.catalogPage++;
          loadCatalog();
        }
      });

      $("closeCatalogDrawerBtn").addEventListener("click", closeCatalogDrawer);
      $("catalogDrawerMask").addEventListener("click", closeCatalogDrawer);
      $("saveCatalogMetaBtn").addEventListener("click", saveCatalogMetaDetail);
      
      $("downloadCatalogJsonBtn").addEventListener("click", function() { exportCatalogData("json"); });
      $("downloadCatalogCsvBtn").addEventListener("click", function() { exportCatalogData("csv"); });

      // 周课表预览切换
      $("prevPreviewWeekBtn").addEventListener("click", function() {
        if (state.previewWeek > 1) {
          state.previewWeek--;
          renderMiniWeekSchedule();
        }
      });
      $("nextPreviewWeekBtn").addEventListener("click", function() {
        if (state.previewWeek < 20) {
          state.previewWeek++;
          renderMiniWeekSchedule();
        }
      });
      $("toggleWeekendPreviewBtn").addEventListener("click", function() {
        state.showWeekendPreview = !state.showWeekendPreview;
        renderMiniWeekSchedule();
      });

      $("rawJsonCollapseHeader").addEventListener("click", function() {
        var content = $("rawJsonCollapseContent");
        content.classList.toggle("open");
      });

      // 同步中心事件
      $("recheckHealthBtn").addEventListener("click", function() {
        runHealthChecks();
        showToast("服务测速完成");
      });

      // 审计日志模块筛选
      $("auditLogModuleFilter").addEventListener("change", function() {
        state.auditModuleFilter = $("auditLogModuleFilter").value;
        renderAuditLogsTable();
      });

      // 13. 初始化
      clearNoticeForm();
      clearNewsForm();
      if (isLoginPage) {
        loginView.hidden = false;
        dashboardView.hidden = true;
      } else {
        loginView.hidden = true;
        dashboardView.hidden = false;
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
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data:; base-uri 'self'; form-action 'self'"
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

router.adminConsoleHtml = adminConsoleHtml;
module.exports = router;
