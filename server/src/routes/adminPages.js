const express = require("express");
const adminAuth = require("../services/adminAuth");

const router = express.Router();

const ADMIN_LOGO_URL = "/assets/logo.png";
const ADMIN_LOGO_FALLBACK_URL = "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2064%2064%27%3E%3Crect%20width%3D%2764%27%20height%3D%2764%27%20rx%3D%2714%27%20fill%3D%27%23c13b33%27%2F%3E%3Ctext%20x%3D%2732%27%20y%3D%2742%27%20text-anchor%3D%27middle%27%20font-size%3D%2732%27%20font-family%3D%27Arial%2Csans-serif%27%20font-weight%3D%27700%27%20fill%3D%27white%27%3E%E8%AF%BE%3C%2Ftext%3E%3C%2Fsvg%3E";
const ADMIN_LOGO_IMG_ATTRS = `src="${ADMIN_LOGO_URL}" alt="佛课小表" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${ADMIN_LOGO_FALLBACK_URL}';"`;

const adminConsoleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>佛课小表 Admin Console</title>
  <link rel="icon" type="image/png" href="${ADMIN_LOGO_URL}">
  <link rel="apple-touch-icon" href="${ADMIN_LOGO_URL}">
  <script>
    (function () {
      var key = "fosu-admin-theme";
      var allowed = { light: true, dark: true, system: true };
      var preference = "system";
      try {
        preference = localStorage.getItem(key) || "system";
      } catch (error) {
        preference = "system";
      }
      if (!allowed[preference]) preference = "system";
      var isDark = false;
      try {
        isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch (error) {
        isDark = false;
      }
      var resolved = preference === "system" ? (isDark ? "dark" : "light") : preference;
      document.documentElement.dataset.theme = preference;
      document.documentElement.dataset.resolvedTheme = resolved;
      document.documentElement.style.colorScheme = resolved;
    })();
  </script>
  <style>
    :root {
      color-scheme: light dark;
      --page-bg: #f4f2ed;
      --surface: #fbfaf7;
      --surface-raised: #fffefa;
      --surface-muted: #eeece6;
      --surface-sunken: #e8e5de;
      --border: #d9d5cc;
      --border-strong: #b8b2a7;
      --border-hover: #aaa398;
      --text-primary: #181b20;
      --text-secondary: #4b515b;
      --text-muted: #626a75;
      --primary: #3158c7;
      --primary-hover: #2447a9;
      --primary-soft: #e7ecfb;
      --on-primary: #ffffff;
      --brand-accent: #c13b33;
      --brand-soft: #f8e9e6;
      --success: #14795a;
      --success-soft: #e5f3ed;
      --on-success: #ffffff;
      --warning: #9a5d08;
      --warning-soft: #f8edd9;
      --danger: #b42318;
      --danger-soft: #f8e6e3;
      --on-danger: #ffffff;
      --status-success-bg: var(--success-soft);
      --status-warning-bg: var(--warning-soft);
      --status-danger-bg: var(--danger-soft);
      --overlay: rgba(24, 27, 32, 0.5);
      --shadow: 0 1px 2px rgba(31, 28, 23, 0.06);
      --shadow-lg: 0 18px 42px rgba(31, 28, 23, 0.16);
      --code-bg: #ebe8e1;
      --table-hover: #f0f3fb;
      --focus-ring: rgba(49, 88, 199, 0.3);
      --scrollbar-track: #ebe8e1;
      --scrollbar-thumb: #bcb6aa;
      --sidebar-width: 264px;
      --sidebar-collapsed-width: 76px;
      --bg: var(--page-bg);
      --panel: var(--surface);
      --panel-2: var(--surface-muted);
      --text: var(--text-primary);
      --muted: var(--text-muted);
      --radius: 9px;
      --font-family: Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --transition: color 180ms cubic-bezier(0.4, 0, 0.2, 1), background-color 180ms cubic-bezier(0.4, 0, 0.2, 1), border-color 180ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    html[data-resolved-theme="dark"] {
      --page-bg: #101318;
      --surface: #171b21;
      --surface-raised: #1d222a;
      --surface-muted: #222832;
      --surface-sunken: #0c0f13;
      --border: #303742;
      --border-strong: #46505e;
      --border-hover: #586474;
      --text-primary: #f0f2f4;
      --text-secondary: #c2c8d0;
      --text-muted: #949eaa;
      --primary: #7f9df2;
      --primary-hover: #a1b6f6;
      --primary-soft: rgba(127, 157, 242, 0.16);
      --on-primary: #111827;
      --brand-accent: #ed7168;
      --brand-soft: rgba(237, 113, 104, 0.14);
      --success: #5bc69a;
      --success-soft: rgba(91, 198, 154, 0.14);
      --on-success: #102119;
      --warning: #e3ad55;
      --warning-soft: rgba(227, 173, 85, 0.14);
      --danger: #f0877f;
      --danger-soft: rgba(240, 135, 127, 0.14);
      --on-danger: #2a1010;
      --status-success-bg: var(--success-soft);
      --status-warning-bg: var(--warning-soft);
      --status-danger-bg: var(--danger-soft);
      --overlay: rgba(4, 6, 9, 0.74);
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.26);
      --shadow-lg: 0 24px 52px rgba(0, 0, 0, 0.44);
      --code-bg: #0d1117;
      --table-hover: #222b3a;
      --focus-ring: rgba(127, 157, 242, 0.38);
      --scrollbar-track: #11161c;
      --scrollbar-thumb: #46515f;
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

    body, .card, .sidebar, .topbar, input, textarea, select, table, .drawer, .modal, .toast {
      transition: var(--transition);
    }

    ::selection {
      background: var(--primary-soft);
      color: var(--text-primary);
    }

    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    ::-webkit-scrollbar-track {
      background: var(--scrollbar-track);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border: 2px solid var(--scrollbar-track);
      border-radius: 999px;
    }

    :focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }

    .theme-switcher {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
    }

    .theme-switcher button {
      min-width: 42px;
      padding: 6px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
    }

    .theme-switcher button[aria-pressed="true"] {
      background: var(--surface-raised);
      color: var(--text-primary);
      box-shadow: var(--shadow);
    }

    .theme-current-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 8px;
      text-align: center;
    }

    code, pre, .code-block {
      background: var(--code-bg);
      color: var(--text-primary);
      border-color: var(--border);
    }

    table {
      background: var(--surface);
      color: var(--text-primary);
      border-color: var(--border);
    }

    th {
      background: var(--surface-muted) !important;
      color: var(--text-secondary) !important;
      border-color: var(--border) !important;
    }

    td {
      border-color: var(--border) !important;
    }

    tbody tr:hover, tbody tr:hover td {
      background: var(--table-hover) !important;
    }

    .drawer, .catalog-drawer, .feedback-drawer, .modal, .dialog, .phone-preview, .preview-phone {
      background: var(--surface-raised) !important;
      color: var(--text-primary) !important;
      border-color: var(--border) !important;
      box-shadow: var(--shadow-lg);
    }

    .drawer-mask, .catalog-drawer-mask, .feedback-drawer-mask, .sidebar-overlay, .modal-mask {
      background: var(--overlay) !important;
    }

    .toast {
      background: var(--surface-raised) !important;
      color: var(--text-primary) !important;
      border: 1px solid var(--border) !important;
      box-shadow: var(--shadow-lg) !important;
    }

    .empty-state, .upload-list, .preview-list, .mini-schedule, .week-preview, .heatmap-card, .phone-screen {
      background: var(--surface) !important;
      color: var(--text-primary) !important;
      border-color: var(--border) !important;
    }

    .badge.muted, .tag.muted {
      background: var(--surface-muted) !important;
      color: var(--text-secondary) !important;
      border-color: var(--border) !important;
    }

    .badge.success, .tag.success {
      background: var(--success-soft) !important;
      color: var(--success) !important;
    }

    .badge.warning, .tag.warning {
      background: var(--warning-soft) !important;
      color: var(--warning) !important;
    }

    .badge.danger, .tag.danger {
      background: var(--danger-soft) !important;
      color: var(--danger) !important;
    }

    [hidden] {
      display: none !important;
    }

    /* 现代卡片与面板 */
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
      transition: var(--transition);
    }
    .card:hover {
      border-color: var(--border-hover);
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;
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
      padding: 8px 12px;
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
    button, .btn, .pill, .badge, .tag, .segmented-item {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      line-height: 1;
      box-sizing: border-box;
    }
    button, .btn {
      font-size: 14px;
      font-weight: 600;
      padding: 7px 14px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: var(--transition);
      gap: 6px;
      text-decoration: none;
    }
    button.primary, .btn.primary {
      background: var(--primary);
      color: var(--on-primary);
    }
    button.primary:hover, .btn.primary:hover {
      background: var(--primary-hover);
    }
    button.secondary, .btn.secondary {
      background: var(--primary-soft);
      color: var(--primary);
    }
    button.secondary:hover, .btn.secondary:hover {
      background: var(--primary-soft);
      border-color: var(--primary);
    }
    button.danger, .btn.danger {
      background: var(--danger-soft);
      color: var(--danger);
    }
    button.danger:hover, .btn.danger:hover {
      background: var(--danger-soft);
      border-color: var(--danger);
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
      padding: 18px 12px;
      position: sticky;
      top: 0;
      height: 100vh;
      z-index: 50;
    }
    .brand,
    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 0 8px;
      overflow: hidden;
    }
    .brand-logo,
    .login-logo {
      display: block;
      width: 42px;
      height: 42px;
      min-width: 42px;
      border-radius: 12px;
      object-fit: cover;
      object-position: center;
      background: var(--surface-raised);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    }
    .brand-logo {
      flex: 0 0 42px;
    }
    .login-logo {
      margin-bottom: 20px;
    }
    .sidebar-brand-text {
      min-width: 0;
    }
    .brand-title,
    .sidebar-brand-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .brand-subtitle,
    .sidebar-brand-subtitle {
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      padding: 20px 24px;
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
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    .topbar h2 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0;
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
      gap: 8px;
      margin-bottom: 16px;
    }
    .stat-card {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 84px;
      padding: 14px;
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
      gap: 14px;
      align-items: start;
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
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      white-space: nowrap;
    }
    th {
      font-weight: 700;
      background: var(--surface-muted);
      color: var(--muted);
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background: var(--table-hover);
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

    .readiness-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .readiness-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .readiness-group {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .readiness-group-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: var(--panel-2);
      font-size: 12px;
      font-weight: 800;
    }
    .readiness-item {
      padding: 10px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      line-height: 1.5;
    }
    .readiness-item-key {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--text);
      font-weight: 800;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .readiness-item-meta {
      margin-top: 6px;
      color: var(--muted);
      word-break: break-word;
    }
    .readiness-fix {
      margin-top: 6px;
      color: var(--warning);
    }

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
      top: 0; right: 0; bottom: 0;
      width: 100%;
      max-width: 600px;
      background: var(--panel);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
      z-index: 101;
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      visibility: hidden;
      pointer-events: none;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 0.25s;
      border-left: 1px solid var(--border);
    }
    .drawer-mask.show { display: block; opacity: 1; }
    .drawer.show {
      visibility: visible;
      pointer-events: auto;
      transform: translateX(0);
      transition-delay: 0s;
    }
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
    .ai-provider-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
      gap: 16px;
      align-items: start;
    }
    .ai-provider-status {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .ai-provider-status .health-item {
      min-height: 72px;
    }
    .ai-secret-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .ai-provider-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    .ai-verify-box {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .provider-console,
    .kb-console {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .provider-hero,
    .kb-hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .provider-hero h3,
    .kb-hero h3 {
      font-size: 20px;
      line-height: 1.25;
      margin-bottom: 4px;
    }
    .provider-hero p,
    .kb-hero p {
      color: var(--muted);
      font-size: 13px;
      max-width: 760px;
    }
    .env-tabs,
    .kb-tabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
    }
    .env-tabs button,
    .kb-tabs button {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    .env-tabs button.active,
    .kb-tabs button.active {
      background: var(--panel);
      color: var(--text);
      box-shadow: var(--shadow);
    }
    .provider-mode-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      align-items: start;
    }
    .provider-mode-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 16px;
      box-shadow: var(--shadow);
      min-height: 280px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .provider-status-hero strong {
      color: var(--primary);
    }
    .provider-static-landing + .ai-provider-grid {
      display: none;
    }
    .provider-switch-row,
    .provider-checkbox-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      font-size: 13px;
      color: var(--text);
    }
    /* Provider 选择器（卡片网格） */
    .apc-section-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      letter-spacing: 0.02em;
    }
    .apc-pick-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }
    .apc-pick-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--panel-2);
      cursor: pointer;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    }
    .apc-pick-card:hover {
      border-color: var(--border-hover);
      box-shadow: var(--shadow);
    }
    .apc-pick-card:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
    }
    .apc-pick-card.active {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .apc-pick-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.3;
    }
    .apc-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
      display: inline-block;
    }
    .apc-dot.ok { background: var(--success); }
    .apc-dot.off { background: var(--border-strong); }
    .apc-pick-sub {
      margin-top: 3px;
      font-size: 11px;
      color: var(--text-muted);
      word-break: break-all;
    }
    .apc-proto-badge {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--text-muted);
      white-space: nowrap;
    }
    /* 自定义 Provider 管理 */
    .apc-cp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .apc-cp-table th {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      font-weight: 600;
      white-space: nowrap;
    }
    .apc-cp-table td {
      padding: 8px;
      border-bottom: 1px solid var(--surface-muted);
      color: var(--text-primary);
      vertical-align: middle;
    }
    .apc-cp-table tbody tr {
      transition: background 0.15s ease;
    }
    .apc-cp-table tbody tr:hover {
      background: var(--surface-muted);
    }
    .apc-row-btn {
      padding: 3px 8px;
      font-size: 11px;
      margin-right: 4px;
    }
    .apc-danger {
      color: var(--danger);
    }
    .apc-cp-form {
      border: 1px dashed var(--border-strong);
      border-radius: 10px;
      padding: 14px;
      background: var(--panel-2);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .apc-fetch-cell {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }
    .provider-console button {
      cursor: pointer;
    }
    .provider-selected-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .provider-metric span,
    .provider-metric small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .provider-metric strong {
      display: block;
      margin-top: 2px;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .provider-card-grid,
    .kb-list-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .provider-card,
    .kb-entry-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
      cursor: pointer;
      min-height: 154px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .provider-card.active,
    .kb-entry-card.active {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--focus-ring);
    }
    .provider-card-head,
    .kb-entry-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .provider-card-title,
    .kb-entry-title {
      font-weight: 800;
      color: var(--text);
    }
    .provider-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .provider-metric,
    .kb-meta-pill {
      padding: 8px;
      border-radius: 8px;
      background: var(--panel-2);
      min-width: 0;
    }
    .provider-config-panel,
    .kb-editor-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 16px;
      box-shadow: var(--shadow);
      position: sticky;
      top: 16px;
    }
    .provider-actions-row,
    .kb-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .diagnostic-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    .diagnostic-panel summary {
      cursor: pointer;
      padding: 12px 14px;
      font-weight: 800;
      color: var(--text);
    }
    .diagnostic-panel .ai-verify-box {
      margin: 0;
      border: 0;
      border-top: 1px solid var(--border);
      border-radius: 0;
    }
    .kb-tab-panel {
      display: none;
    }
    .kb-tab-panel.active {
      display: block;
    }
    .kb-two-column {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 430px);
      gap: 16px;
      align-items: start;
    }
    .kb-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    @media (max-width: 980px) {
      .provider-mode-grid,
      .kb-two-column {
        grid-template-columns: 1fr;
      }
      .kb-editor-panel {
        position: static;
      }
    }

    .campus-map-stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .campus-map-asset-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 10px;
    }
    .campus-map-asset-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .campus-map-asset-card.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(198, 40, 40, 0.08);
    }
    .campus-map-thumb {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: contain;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
    }
    .campus-map-asset-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      font-weight: 800;
      min-width: 0;
    }
    .campus-map-asset-title strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .campus-map-asset-meta,
    .campus-map-health-grid,
    .campus-map-diff-grid {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      min-width: 0;
    }
    .campus-map-health-grid {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .campus-map-status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .campus-map-status-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px 12px;
      min-width: 0;
    }
    .campus-map-status-card span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
    }
    .campus-map-status-card strong {
      display: block;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .campus-map-status-card.warning {
      border-color: rgba(245, 158, 11, 0.55);
      background: rgba(245, 158, 11, 0.08);
    }
    .campus-map-status-card.blocker {
      border-color: rgba(220, 38, 38, 0.55);
      background: rgba(220, 38, 38, 0.08);
    }
    .campus-map-status-card.success {
      border-color: rgba(22, 163, 74, 0.45);
      background: rgba(22, 163, 74, 0.08);
    }
    .campus-map-diff-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .campus-map-diff-pill {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel-2);
    }
    .campus-map-diff-pill span {
      display: block;
      color: var(--muted);
      font-size: 11px;
    }
    .campus-map-diff-pill strong {
      font-size: 18px;
    }
    .campus-map-issue-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    .campus-map-issue {
      border-left: 3px solid var(--border);
      padding: 6px 8px;
      background: var(--panel-2);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.45;
    }
    .campus-map-issue.blocker { border-left-color: var(--danger); }
    .campus-map-issue.warning { border-left-color: #f59e0b; }
    .campus-map-issue.info { border-left-color: var(--accent); }
    .campus-map-advanced-log {
      margin-top: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel-2);
      font-size: 12px;
    }
    .campus-map-advanced-log pre {
      overflow: auto;
      white-space: pre-wrap;
      color: var(--muted);
    }
    .campus-map-health-item {
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 8px 10px;
      min-width: 0;
    }
    .campus-map-health-item span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 3px;
    }
    .campus-map-health-item strong,
    .campus-map-asset-meta code {
      display: block;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .campus-map-calibration-grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.72fr) minmax(420px, 1.28fr) minmax(280px, 0.85fr);
      gap: 14px;
      align-items: start;
    }
    .campus-map-toolbar,
    .campus-map-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .campus-map-list {
      display: grid;
      gap: 8px;
      max-height: 520px;
      overflow: auto;
    }
    .campus-map-place-btn {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      text-align: left;
    }
    .campus-map-place-btn.active {
      border-color: var(--accent);
      background: rgba(198, 40, 40, 0.08);
    }
    .campus-map-editor {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      user-select: none;
      touch-action: none;
    }
    .campus-map-editor img {
      display: block;
      width: 100%;
      height: auto;
      min-height: 360px;
      object-fit: contain;
      background: var(--surface);
    }
    .campus-map-rect {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #c62828;
      border-radius: 4px;
      background: rgba(198, 40, 40, 0.12);
      cursor: move;
    }
    .campus-map-handle {
      position: absolute;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #c62828;
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
    }
    .campus-map-handle[data-handle="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
    .campus-map-handle[data-handle="n"] { left: calc(50% - 5px); top: -7px; cursor: ns-resize; }
    .campus-map-handle[data-handle="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
    .campus-map-handle[data-handle="e"] { right: -7px; top: calc(50% - 5px); cursor: ew-resize; }
    .campus-map-handle[data-handle="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
    .campus-map-handle[data-handle="s"] { left: calc(50% - 5px); bottom: -7px; cursor: ns-resize; }
    .campus-map-handle[data-handle="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
    .campus-map-handle[data-handle="w"] { left: -7px; top: calc(50% - 5px); cursor: ew-resize; }
    .campus-map-image-error {
      border: 1px solid var(--danger);
      border-radius: 7px;
      padding: 10px;
      background: rgba(220, 38, 38, 0.08);
      color: var(--danger);
      font-size: 12px;
      margin-top: 8px;
    }
    .campus-map-editor-help {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .campus-map-json {
      width: 100%;
      min-height: 110px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12px;
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
    .heatmap-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .heatmap-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      max-width: 520px;
    }
    .heatmap-meta .badge {
      background: var(--panel-2);
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 700;
    }
    .heatmap-alert {
      background: var(--warning-soft);
      color: var(--warning);
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .heatmap-empty {
      background: var(--panel-2);
      border: 1px dashed var(--border-hover);
      border-radius: 8px;
      color: var(--muted);
      padding: 28px 16px;
      text-align: center;
      font-size: 13px;
    }
    .heatmap-container {
      display: grid;
      grid-template-columns: 64px repeat(7, minmax(72px, 1fr));
      gap: 6px;
      margin-top: 10px;
      width: 100%;
      min-width: 720px;
    }
    .heatmap-header {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-align: center;
      padding: 4px;
    }
    .heatmap-cell {
      height: 30px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition);
      cursor: pointer;
      border: 1px solid rgba(15, 23, 42, 0.04);
      color: rgba(15, 23, 42, 0.52);
      font-size: 10px;
      font-weight: 800;
    }
    .heatmap-cell:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
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
      background: var(--surface-muted);
      font-weight: 700;
      padding: 6px 2px;
      text-align: center;
    }
    .mini-sched-row-label {
      background: var(--surface-muted);
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
      background: var(--surface-muted);
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
      color: var(--text-primary);
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
      color: var(--text-primary);
      margin-bottom: 2px;
    }

    /* 模拟小程序公告 */
    .mini-banner {
      background: var(--primary-soft);
      border-left: 3px solid var(--primary);
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 10px;
      color: var(--primary);
    }
    .mini-banner.urgent { background: var(--danger-soft); border-left-color: var(--danger); color: var(--danger); }
    .mini-banner.warning { background: var(--warning-soft); border-left-color: var(--warning); color: var(--warning); }
    
    .mini-modal-mask {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.3);
      display: grid;
      place-items: center;
      padding: 12px;
      z-index: 10;
    }
    .mini-modal {
      background: var(--surface-raised);
      color: var(--text-primary);
      border-radius: 8px;
      width: 100%;
      padding: 12px;
      box-shadow: var(--shadow-lg);
      text-align: center;
    }
    .mini-modal h4 { font-size: 11px; font-weight: 800; margin-bottom: 4px; }
    .mini-modal p { font-size: 9px; color: var(--muted); line-height: 1.4; margin-bottom: 8px; }
    .mini-modal button { padding: 4px; border-radius: 4px; font-size: 10px; width: 100%; background: var(--primary); color: var(--on-primary); border: none;}

    .mini-ticker {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--primary-soft);
      color: var(--primary);
      padding: 6px 8px;
      font-size: 9px;
      overflow: hidden;
      border-radius: 999px;
      border: 1px solid var(--border);
      min-height: 28px;
      cursor: pointer;
    }
    .mini-ticker.important {
      background: var(--warning-soft);
      color: var(--warning);
      border-color: var(--border-strong);
    }
    .mini-ticker.urgent {
      background: var(--danger-soft);
      color: var(--danger);
      border-color: var(--border-strong);
    }
    .mini-ticker-icon {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-raised);
      font-size: 8px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .mini-ticker-track {
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
    }
    .mini-ticker-text {
      display: inline-flex;
      gap: 24px;
      min-width: 100%;
      animation: miniTickerScroll 12s linear infinite;
    }
    @keyframes miniTickerScroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }

    .mini-card {
      background: var(--surface-raised);
      border-radius: 6px;
      padding: 8px;
      border: 1px solid var(--border);
      font-size: 10px;
    }

    .mini-news-card {
      background: var(--surface-raised);
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
      color: var(--on-danger);
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
      background: var(--danger-soft);
      border: 1px solid var(--border-strong);
      color: var(--text-primary);
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
    }
    .admin-runtime-error-bar button:hover {
      background: var(--surface-raised);
      color: var(--danger);
    }

    /* ========================================================
     * 响应式与防重叠优化样式
     * ======================================================== */
    
    /* 强状态防重叠规则 */
    body.is-login-page #loginView {
      display: block !important;
    }
    body.is-login-page #dashboardView {
      display: none !important;
    }
    body.is-dashboard-page #loginView {
      display: none !important;
    }
    body.is-dashboard-page #dashboardView {
      display: grid !important;
    }

    /* 登录页美化及垂直居中 */
    body.is-login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      padding: 16px;
    }
    body.is-login-page #loginView {
      margin: 0 !important;
    }

    /* 顶部导航栏（移动端） */
    .mobile-topbar {
      display: none;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      padding: 0 16px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 99;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
    }
    .mobile-topbar-title {
      min-width: 0;
      flex: 1;
      padding: 0 12px;
      color: var(--text);
      font-size: 15px;
      font-weight: 800;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mobile-logo-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 0 0 auto;
      color: var(--text);
      font-size: 14px;
      font-weight: 800;
    }
    .mobile-menu-toggle {
      border: 1px solid var(--border);
      background: var(--panel-2);
      border-radius: 8px;
      width: 40px;
      height: 40px;
      padding: 0;
      cursor: pointer;
      color: var(--text);
      font-size: 20px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .mobile-menu-toggle:hover {
      background: var(--border);
    }

    /* 侧边栏遮罩 */
    .sidebar-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
      z-index: 98;
      display: none;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .sidebar-overlay.show {
      display: block;
      opacity: 1;
    }

    body.sidebar-drawer-open,
    body.detail-drawer-open {
      overflow: hidden;
    }

    /* 热力图摘要卡片 */
    .heatmap-summary-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .heatmap-summary-card {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      transition: var(--transition);
    }
    .heatmap-summary-card:hover {
      border-color: var(--border-hover);
    }
    .heatmap-summary-title {
      font-size: 11px;
      color: var(--muted);
      font-weight: 700;
      margin-bottom: 4px;
    }
    .heatmap-summary-value {
      font-size: 16px;
      font-weight: 800;
      color: var(--text);
    }
    .heatmap-summary-desc {
      font-size: 10px;
      color: var(--muted);
      margin-top: 2px;
    }

    .heatmap-toolbar {
      display: flex;
      justify-content: flex-end;
      margin: 0 0 14px;
    }
    .heatmap-scroller {
      width: 100%;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .heatmap-legend {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 11px;
    }
    .heatmap-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .heatmap-legend-swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      border: 1px solid rgba(15, 23, 42, 0.08);
    }

    /* 详情面板 */
    .heatmap-detail-panel {
      margin-top: 16px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: none;
      animation: fadeIn 0.2s ease-out;
    }
    .heatmap-detail-panel.show {
      display: block;
    }
    .heatmap-detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 6px;
      margin-top: 12px;
      max-height: 200px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .heatmap-detail-item {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      font-size: 11px;
    }
    .heatmap-detail-room {
      font-weight: 700;
      color: var(--primary);
    }
    .heatmap-detail-course {
      color: var(--text);
      font-weight: 600;
      margin-top: 2px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .heatmap-detail-teacher {
      color: var(--muted);
      margin-top: 2px;
    }
    .heatmap-detail-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      color: var(--text);
      font-size: 14px;
      font-weight: 800;
    }
    .heatmap-detail-stat {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .heatmap-detail-stat div {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .heatmap-detail-stat span {
      display: block;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
    }
    .heatmap-detail-stat strong {
      display: block;
      margin-top: 2px;
      color: var(--text);
      font-size: 14px;
    }

    /* 响应式断点控制 */
    @media (min-width: 768px) and (max-width: 1199.98px) {
      .app-shell {
        grid-template-columns: 80px 1fr;
      }
      .sidebar {
        padding: 20px 8px;
      }
      .sidebar-brand-text {
        display: none;
      }
      .sidebar-brand {
        justify-content: center;
        padding: 0;
      }
      .nav-item button {
        justify-content: center;
        padding: 12px 0;
        font-size: 11px;
        flex-direction: column;
        gap: 4px;
      }
      .sidebar-footer {
        padding-top: 12px;
      }
      .env-info {
        flex-direction: column;
        gap: 6px;
        align-items: center;
      }
      #logoutButton {
        font-size: 10px;
        padding: 4px;
      }
    }

    @media (max-width: 767.98px) {
      html,
      body {
        max-width: 100%;
        overflow-x: hidden;
      }
      .app-shell {
        grid-template-columns: 1fr;
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
      }
      .mobile-topbar {
        display: flex;
        grid-column: 1;
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }
      .sidebar {
        position: fixed;
        grid-column: 1;
        top: 0;
        left: 0;
        width: 78vw;
        max-width: 320px;
        height: 100vh;
        z-index: 100;
        transform: translateX(-105%);
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 4px 0 24px rgba(15, 23, 42, 0.15);
      }
      .sidebar.show {
        transform: translateX(0);
      }
      .main-content {
        grid-column: 1;
        padding: 16px;
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }
      .topbar {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }
      .topbar-actions {
        width: 100%;
        justify-content: flex-end;
      }
      .section,
      .sync-hero,
      .stats-grid,
      .card {
        max-width: 100%;
        min-width: 0;
      }
      .dash-columns {
        grid-template-columns: 1fr;
      }
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .split-layout {
        grid-template-columns: 1fr;
      }
      .ai-provider-grid,
      .campus-map-calibration-grid,
      .ai-provider-status {
        grid-template-columns: 1fr;
      }
      .campus-map-asset-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .table-container {
        width: 100%;
      }
      .heatmap-card-head {
        flex-direction: column;
      }
      .heatmap-meta {
        justify-content: flex-start;
        max-width: none;
      }
      .heatmap-toolbar {
        justify-content: flex-start;
      }
      .heatmap-container {
        min-width: 720px;
      }
      .heatmap-cell span {
        display: none;
      }
      .heatmap-detail-stat {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 479.98px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }
      .form-row {
        grid-template-columns: 1fr !important;
      }
      .campus-map-asset-grid {
        grid-template-columns: 1fr;
      }
      .topbar-actions {
        flex-direction: column;
        align-items: stretch;
      }
      .topbar-actions button {
        width: 100%;
      }
      .tab-filter {
        width: 100%;
        overflow-x: auto;
      }
      .tab-filter button {
        flex: 1;
        white-space: nowrap;
      }
    }
    
    /* === 同步运维与Staging样式 === */
    .sync-wizard-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .sync-range-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    .sync-range-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
    }
    .sync-range-item input[type="checkbox"] {
      width: auto;
      cursor: pointer;
    }
    .command-card-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .command-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      background: var(--panel-2);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: var(--transition);
    }
    .command-card:hover {
      border-color: var(--primary);
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .command-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .command-title {
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .command-tag {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .command-tag.low { background: var(--success-soft); color: var(--success); }
    .command-tag.medium { background: var(--warning-soft); color: var(--warning); }
    .command-tag.high { background: var(--danger-soft); color: var(--danger); }
    
    .command-code-box {
      display: flex;
      align-items: flex-start;
      background: #0f172a;
      color: #38bdf8;
      border-radius: 6px;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      justify-content: space-between;
      gap: 8px;
      max-width: 100%;
      overflow: hidden;
    }
    .command-code-box pre,
    .flow-code-box pre {
      margin: 0;
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      overflow-x: auto;
    }
    .command-code-box code {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }
    .command-code-box button {
      background: var(--surface-muted);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: var(--transition);
      flex: 0 0 auto;
    }
    .command-code-box button:hover {
      background: var(--primary-soft);
      color: var(--primary);
    }
    
    .command-meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      font-size: 12px;
      border-top: 1px dashed var(--border);
      padding-top: 8px;
      margin-top: 2px;
    }
    .command-meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .command-meta-item strong {
      color: var(--muted);
      font-weight: 600;
      font-size: 10px;
    }
    .command-meta-item span {
      color: var(--text);
      font-size: 11px;
    }
    .command-tip-box {
      font-size: 11px;
      color: var(--muted);
      background: rgba(0,0,0,0.02);
      border-left: 3px solid var(--primary);
      padding: 6px 10px;
      border-radius: 0 4px 4px 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sync-mode-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0 14px;
    }
    .sync-mode-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      background: var(--panel);
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
    }
    .sync-mode-card strong {
      color: var(--text);
      font-size: 14px;
    }
    .sync-mode-card p {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
    }
    .sync-mode-card .command-tag {
      width: fit-content;
    }
    .relay-task-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .relay-table td {
      vertical-align: top;
      font-size: 12px;
    }
    .relay-token {
      display: inline-block;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }
    .relay-command {
      display: block;
      max-width: 260px;
      margin-top: 4px;
      overflow-x: auto;
      overflow-y: hidden;
      text-overflow: clip;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .relay-table th,
    .relay-table td,
    #release-history-panel th,
    #release-history-panel td {
      padding: 6px 8px;
      font-size: 12px;
    }
    @media (max-width: 900px) {
      .sync-mode-grid,
      .relay-task-grid {
        grid-template-columns: 1fr;
      }
    }
    
    .staging-preview-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 14px;
      background: var(--panel-2);
      margin-top: 10px;
    }
    .staging-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
    }
    .staging-item {
      background: var(--panel);
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      text-align: center;
      box-shadow: var(--shadow);
    }
    .staging-item-title {
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
    }
    .staging-item-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin: 4px 0;
    }
    .staging-item-diff {
      font-size: 10px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .diff-plus { color: var(--success); }
    .diff-minus { color: var(--danger); }
    .diff-equal { color: var(--muted); }
    
    .warnings-list {
      background: var(--warning-soft);
      border: 1px solid var(--warning);
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 12px;
      color: #854d0e;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .warnings-list strong {
      font-weight: 700;
    }
    
    .diff-classes-list {
      max-height: 140px;
      overflow-y: auto;
      font-size: 11px;
      background: var(--panel);
      padding: 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-top: 8px;
      line-height: 1.6;
    }
    .diff-classes-list strong {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      padding-bottom: 2px;
    }
    .diff-classes-list strong:first-child {
      margin-top: 0;
    }
    .diff-classes-list span {
      display: inline-block;
      margin-right: 8px;
      background: var(--panel-2);
      padding: 1px 6px;
      border-radius: 4px;
      margin-top: 4px;
    }
    
    .wizard-command-preview {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* === 数据同步中心新布局样式 === */
    .sync-hero {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: var(--shadow);
    }
    .sync-hero-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .sync-hero-title {
      color: var(--text);
      font-size: 20px;
      font-weight: 850;
      line-height: 1.1;
    }
    .sync-hero-subtitle {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.5;
    }
    .sync-hero-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
      flex: 0 0 auto;
    }
    .sync-last-refresh {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .sync-hero-badge {
      background: var(--primary-soft);
      color: var(--primary);
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .sync-hero-text {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }
    @media (max-width: 760px) {
      .sync-hero {
        flex-direction: column;
        align-items: stretch;
      }
      .sync-hero-actions {
        justify-content: flex-start;
      }
    }

    .sync-primary-flow {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 0;
      min-width: 0;
      max-width: 100%;
    }
    .flow-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: var(--transition);
      position: relative;
      min-width: 0;
      overflow: hidden;
    }
    .flow-card:hover {
      border-color: var(--primary);
    }
    .flow-step {
      font-size: 10px;
      font-weight: 800;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: var(--primary-soft);
      padding: 2px 6px;
      border-radius: 4px;
      width: fit-content;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .flow-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .flow-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 0 1 auto;
      min-width: 0;
    }
    .flow-field {
      font-size: 12px;
      line-height: 1.4;
    }
    .flow-field strong {
      color: var(--muted);
      font-weight: 600;
    }
    .flow-field span {
      color: var(--text);
    }
    .flow-cmd-section {
      margin-top: 4px;
      border-top: 1px dashed var(--border);
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .flow-cmd-section strong {
      font-size: 11px;
      color: var(--muted);
    }
    .flow-code-box {
      display: flex;
      align-items: flex-start;
      background: #0f172a;
      color: #38bdf8;
      border-radius: 6px;
      padding: 8px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      justify-content: space-between;
      gap: 8px;
      max-width: 100%;
      overflow: hidden;
    }
    .flow-code-box code {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      word-break: break-word;
      overflow-x: auto;
      text-overflow: clip;
      white-space: pre-wrap;
    }
    .copy-flow-btn, .flow-go-btn {
      background: var(--surface-muted);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: var(--transition);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      height: 22px;
      white-space: nowrap;
    }
    .copy-flow-btn:hover, .flow-go-btn:hover {
      background: var(--primary-soft);
      color: var(--primary);
    }
    .flow-action-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: var(--panel-2);
      border-radius: 6px;
      padding: 6px 10px;
      border: 1px solid var(--border);
    }
    .action-hint {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.2;
    }
    .flow-go-btn {
      background: var(--primary-soft);
      border: 1px solid var(--primary);
      color: var(--primary);
      height: 22px;
    }
    .flow-go-btn:hover {
      background: var(--primary);
      color: var(--on-primary);
    }

    .code-preview.command-code-box,
    .code-preview.flow-code-box {
      display: block;
      background: #0d1117;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 0;
      overflow: hidden;
      max-width: 100%;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      min-width: 0;
    }
    .code-preview-toolbar {
      min-height: 34px;
      padding: 7px 8px 7px 12px;
      border-bottom: 1px solid #30363d;
      background: #161b22;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .code-preview-toolbar span {
      color: #8b949e;
      font-size: 11px;
      font-weight: 700;
    }
    .code-preview-toolbar button,
    .code-preview .copy-flow-btn,
    .code-preview .copy-command-btn {
      height: 24px;
      padding: 0 9px;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #21262d;
      color: #f0f6fc;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .code-preview-toolbar button:hover,
    .code-preview .copy-flow-btn:hover,
    .code-preview .copy-command-btn:hover {
      background: #30363d;
    }
    .code-preview .code-raw {
      display: none;
    }
    .code-preview-scroller {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      background: #0d1117;
    }
    .code-preview-lines {
      min-width: 100%;
      display: flex;
      flex-direction: column;
      padding: 6px 0;
    }
    .code-line {
      display: grid;
      grid-template-columns: 48px minmax(max-content, 1fr);
      min-height: 22px;
      line-height: 22px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .code-line-number {
      background: #161b22;
      color: #7d8590;
      text-align: right;
      padding: 0 12px 0 8px;
      border-right: 1px solid #30363d;
      user-select: none;
    }
    .code-line-content {
      background: #0d1117;
      color: #d1d5db;
      white-space: pre;
      padding: 0 14px;
    }

    .sync-dashboard-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
    .sync-section-nav {
      position: sticky;
      top: 0;
      z-index: 4;
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 8px 0 12px;
      margin-bottom: 4px;
      background: linear-gradient(180deg, var(--bg) 70%, rgba(248, 250, 252, 0));
      scrollbar-width: thin;
    }
    .sync-section-nav a {
      flex: 0 0 auto;
      min-height: 32px;
      padding: 7px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }
    .sync-section-nav a:hover {
      border-color: var(--primary);
      color: var(--primary);
      background: var(--primary-soft);
    }
    #section-sync,
    #section-sync * {
      min-width: 0;
      box-sizing: border-box;
    }
    .sync-core-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      align-items: stretch;
    }
    .sync-core-actions button {
      min-height: 42px;
      width: 100%;
      justify-content: center;
    }
    .sync-secondary-heading {
      margin: 18px 0 10px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .sync-copy-value {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      gap: 6px;
      white-space: nowrap;
    }
    .sync-copy-value code,
    .sync-copy-value span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      max-width: 100%;
    }
    .sync-copy-value button {
      flex: 0 0 auto;
      padding: 2px 6px;
      font-size: 11px;
      min-height: 22px;
    }
    .sync-ops-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      margin-bottom: 16px;
      scroll-margin-top: 72px;
    }
    .sync-section-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    .sync-section-heading h3 {
      margin: 0;
      font-size: 15px;
      color: var(--text);
    }
    .sync-section-heading p {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    .sync-ops-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      min-width: 0;
    }
    .sync-compact-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel);
      min-width: 0;
    }
    .sync-compact-card strong {
      display: block;
      font-size: 13px;
      margin-bottom: 5px;
    }
    .sync-compact-card span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .sync-resource-contract {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      min-width: 0;
    }
    .sync-resource-contract .metric {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: var(--panel-2);
      min-width: 0;
    }
    .sync-resource-contract .metric span {
      display: block;
      color: var(--muted);
      font-size: 11px;
    }
    .sync-resource-contract .metric strong {
      display: block;
      margin-top: 3px;
      font-size: 15px;
      overflow-wrap: anywhere;
    }
    .sync-technical-details {
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
    }
    .sync-technical-details summary {
      cursor: pointer;
      font-weight: 700;
      color: var(--muted);
    }
    .sync-technical-details code {
      display: block;
      margin-top: 4px;
      padding: 6px;
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    @media (max-width: 720px) {
      .sync-core-actions {
        grid-template-columns: 1fr;
      }
      .sync-section-heading {
        align-items: flex-start;
        flex-direction: column;
      }
      .sync-section-nav {
        position: static;
      }
    }
    .sync-main-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      width: 100%;
    }
    .section-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .openresty-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    .openresty-card-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.95fr);
      gap: 12px;
      min-width: 0;
    }
    .openresty-url-grid,
    .openresty-meta-grid {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .static-url-pill {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 10px;
      background: var(--panel-2);
      color: var(--text);
      text-decoration: none;
      min-width: 0;
    }
    .static-url-pill span {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .static-url-pill strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      min-width: 0;
    }
    .openresty-meta-item {
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 10px;
      background: var(--panel);
      min-width: 0;
    }
    .openresty-meta-item span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 3px;
    }
    .openresty-meta-item strong {
      display: block;
      color: var(--text);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .openresty-actions,
    .sync-next-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      justify-content: flex-end;
    }
    .static-sync-note {
      margin-top: 10px;
      padding: 9px 10px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .job-progress-panel {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      padding: 10px;
      min-width: 0;
    }
    .job-progress-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .job-progress-track {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: var(--panel-2);
      overflow: hidden;
      margin-bottom: 8px;
    }
    .job-progress-fill {
      height: 100%;
      width: 0;
      background: var(--primary);
      transition: width 0.2s ease;
    }
    .job-progress-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 6px;
      margin-bottom: 8px;
    }
    .job-progress-grid div {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      min-width: 0;
    }
    .job-progress-grid span,
    .job-log-list span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 2px;
    }
    .job-progress-grid strong {
      display: block;
      color: var(--text);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .job-log-list {
      display: grid;
      gap: 4px;
      color: var(--text);
      font-size: 12px;
      min-width: 0;
    }
    .sync-timeline {
      display: grid;
      gap: 8px;
    }
    .sync-flow-step {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 9px 10px;
      background: var(--panel);
      min-width: 0;
    }
    .sync-flow-step-num {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 900;
      background: var(--panel-2);
      color: var(--muted);
      border: 1px solid var(--border);
    }
    .sync-flow-step-title {
      font-weight: 800;
      font-size: 13px;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sync-flow-step-caption {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .sync-flow-step.success .sync-flow-step-num { background: var(--success-soft); color: var(--success); border-color: rgba(22,163,107,.25); }
    .sync-flow-step.running .sync-flow-step-num { background: var(--primary-soft); color: var(--primary); border-color: rgba(37,99,235,.25); }
    .sync-flow-step.failed .sync-flow-step-num { background: var(--danger-soft); color: var(--danger); border-color: rgba(220,38,38,.25); }
    .sync-flow-step.skipped .sync-flow-step-num { background: var(--warning-soft); color: var(--warning); border-color: rgba(146,64,14,.25); }
    .sync-side-col {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
      gap: 12px;
      width: 100%;
      min-width: 0;
    }
    .sync-side-col .health-grid {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .sync-side-col .command-card-list {
      gap: 8px;
    }
    .sync-side-col .command-meta-grid {
      grid-template-columns: 1fr;
    }
    .sync-side-col .command-tip-box {
      display: none;
    }
    
    /* 运维手册折叠样式 */
    .command-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      background: var(--panel);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: var(--transition);
    }
    .command-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .command-title {
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .command-card .command-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .command-card.collapsed .command-body {
      display: none;
    }
    .command-header::after {
      content: '▼';
      font-size: 10px;
      color: var(--muted);
      transition: transform 0.2s;
    }
    .command-card.collapsed .command-header::after {
      transform: rotate(-90deg);
    }
    
    @media (max-width: 1200px) {
      .sync-dashboard-grid {
        grid-template-columns: 1fr;
      }
      .sync-side-col {
        grid-template-columns: 1fr;
      }
      .openresty-card-grid {
        grid-template-columns: 1fr;
      }
      .sync-primary-flow {
        grid-template-columns: 1fr;
      }
    }

    /* Stepper 进度指示器样式 */
    .stepper-indicator {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      position: relative;
    }

    .staging-cli-panel {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
      gap: 12px;
      align-items: stretch;
    }
    .staging-cli-main,
    .staging-cli-side {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .staging-status-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .staging-status-pill {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
      background: var(--panel-2);
      min-width: 0;
    }
    .staging-status-pill strong {
      display: block;
      font-size: 12px;
      margin-bottom: 3px;
    }
    .staging-status-pill span {
      color: var(--muted);
      font-size: 11px;
    }
    .staging-inline-upload {
      border: 1px dashed var(--border);
      border-radius: 6px;
      padding: 14px;
      background: var(--panel-2);
      cursor: pointer;
      min-height: 0;
    }
    .staging-inline-upload:hover {
      border-color: var(--primary);
    }
    .staging-upload-table td {
      vertical-align: top;
      white-space: normal;
    }
    .staging-upload-table {
      min-width: 1120px;
      table-layout: auto;
    }
    .staging-upload-table th,
    .staging-upload-table td {
      padding: 8px 10px;
    }
    .staging-upload-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin: 10px 0;
    }
    .staging-upload-filters,
    .staging-upload-bulk-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .staging-upload-filters input,
    .staging-upload-filters select {
      height: 30px;
      min-width: 128px;
      font-size: 12px;
      padding: 4px 8px;
    }
    .staging-group-row {
      background: var(--panel);
    }
    .staging-group-row td {
      border-top: 1px solid var(--border);
    }
    .staging-detail-row {
      background: var(--panel-2);
    }
    .staging-detail-wrap {
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
    }
    .staging-detail-table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      font-size: 12px;
    }
    .staging-detail-table th,
    .staging-detail-table td {
      padding: 7px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .staging-delete-protection {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
      max-width: 240px;
    }
    .staging-progress {
      min-width: 116px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      color: var(--muted);
    }
    .staging-progress-track {
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .staging-progress-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--primary), var(--success));
    }
    .staging-state-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 22px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      background: var(--primary-soft);
      color: var(--primary);
      white-space: nowrap;
    }
    .staging-state-badge.pending-review {
      background: var(--warning-soft);
      color: var(--warning);
    }
    .staging-state-badge.uploading,
    .staging-state-badge.uploaded,
    .staging-state-badge.validating {
      background: var(--primary-soft);
      color: var(--primary);
    }
    .staging-state-badge.publishing {
      background: #eef2ff;
      color: #4f46e5;
    }
    .staging-state-badge.published {
      background: var(--success-soft);
      color: var(--success);
    }
    .staging-state-badge.active {
      background: #dcfce7;
      color: #166534;
    }
    .staging-state-badge.unchanged {
      background: #e0f2fe;
      color: #0369a1;
    }
    .staging-state-badge.duplicate,
    .staging-state-badge.superseded {
      background: var(--panel-2);
      color: var(--muted);
    }
    .staging-state-badge.failed {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .staging-state-badge.archived,
    .staging-state-badge.deleted {
      background: var(--surface-muted);
      color: var(--text-muted);
    }
    .staging-size-stack,
    .staging-count-stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 120px;
      font-size: 11px;
      color: var(--muted);
    }
    .staging-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    .release-history-wide {
      width: 100%;
      min-width: 0;
    }
    .release-strip {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 10px;
      min-width: 0;
    }
    .release-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .release-card.active {
      border-color: rgba(16, 185, 129, 0.55);
      background: var(--success-soft);
    }
    .release-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .release-version {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-weight: 800;
      color: var(--primary);
      overflow-wrap: anywhere;
    }
    .release-meta,
    .release-counts {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .release-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .release-empty {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 18px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
      background: var(--panel-2);
    }
    @media (max-width: 700px) {
      .release-strip {
        display: flex;
        overflow-x: auto;
        padding-bottom: 4px;
        scroll-snap-type: x proximity;
      }
      .release-card {
        min-width: 260px;
        scroll-snap-align: start;
      }
    }
    .release-history-wide .table-container {
      max-width: 100%;
      overflow-x: auto;
    }
    @media (max-width: 900px) {
      .staging-cli-panel,
      .staging-status-strip {
        grid-template-columns: 1fr;
      }
    }
    .step-indicator-item {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      flex: 1;
    }
    .step-num {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--border);
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      transition: var(--transition);
      border: 2px solid var(--border);
    }
    .step-indicator-item.active .step-num {
      background: var(--primary-soft);
      color: var(--primary);
      border-color: var(--primary);
    }
    .step-indicator-item.completed .step-num {
      background: var(--success);
      color: var(--on-success);
      border-color: var(--success);
    }
    .step-label {
      font-size: 11px;
      margin-top: 5px;
      font-weight: 600;
      color: var(--muted);
      transition: var(--transition);
      text-align: center;
    }
    .step-indicator-item.active .step-label {
      color: var(--primary);
    }
    .step-indicator-item.completed .step-label {
      color: var(--success);
    }

    /* 模式预设卡片样式 */
    .preset-card-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 10px;
    }
    .preset-card {
      background: var(--panel);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      cursor: pointer;
      transition: var(--transition);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .preset-card:hover {
      border-color: var(--border-hover);
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }
    .preset-card.active {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .preset-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
    }
    .preset-desc {
      font-size: 12px;
      color: var(--muted);
    }
    .preset-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }
    .preset-tag {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--panel-2);
      color: var(--muted);
    }
    .preset-card.active .preset-tag {
      background: var(--surface-raised);
      color: var(--primary);
    }

    /* Stepper 内容显示隐藏 */
    .step-content {
      display: none;
      animation: fadeIn 0.2s ease-out;
    }
    .step-content.active {
      display: block;
    }
    .stepper-body {
      padding-top: 12px !important;
      margin-top: 12px !important;
    }

    /* 目标 Shell 按钮组 */
    .segmented-control {
      display: flex;
      background: var(--panel-2);
      padding: 4px;
      border-radius: 8px;
      gap: 2px;
      margin-bottom: 8px;
      width: 100%;
    }
    .segmented-control button {
      flex: 1;
      padding: 8px 12px;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      border: none;
      cursor: pointer;
      transition: var(--transition);
    }
    .segmented-control button.active {
      background: var(--panel);
      color: var(--text);
      box-shadow: var(--shadow);
    }

    .stepper-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 12px;
      border-top: 1px solid var(--border);
      padding-top: 10px;
    }

    /* === Campus Operations Studio / 校园数据运营台 === */
    html {
      background: var(--page-bg);
    }

    body {
      background: var(--page-bg);
      color: var(--text-primary);
      font-size: 14px;
      letter-spacing: 0.002em;
    }

    body,
    button,
    input,
    textarea,
    select {
      font-family: var(--font-family);
    }

    :focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
      box-shadow: 0 0 0 4px var(--focus-ring);
    }

    .skip-link {
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 1000;
      padding: 9px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--surface-raised);
      color: var(--text-primary);
      font-weight: 700;
      text-decoration: none;
      transform: translateY(-160%);
      transition: transform 120ms ease;
    }

    .skip-link:focus {
      transform: translateY(0);
    }

    .page-eyebrow,
    .section-kicker {
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.12em;
      line-height: 1.3;
      text-transform: uppercase;
    }

    .section-kicker {
      margin-bottom: 5px;
    }

    svg.nav-icon,
    button svg,
    .btn svg {
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .icon-button {
      width: 38px;
      height: 38px;
      min-width: 38px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface);
      color: var(--text-secondary);
    }

    .icon-button:hover {
      border-color: var(--border-strong);
      background: var(--surface-muted);
      color: var(--text-primary);
    }

    /* Login: quiet, trustworthy, and visually connected to the console. */
    body.is-login-page {
      position: relative;
      background: var(--page-bg);
    }

    body.is-login-page::before {
      content: "";
      position: fixed;
      inset: 0 auto 0 0;
      width: 6px;
      background: var(--brand-accent);
    }

    .login-wrap {
      width: min(440px, calc(100% - 32px));
      margin: 0 auto;
    }

    .login-panel {
      padding: 34px;
      border-color: var(--border-strong);
      border-radius: 12px;
      background: var(--surface-raised);
      box-shadow: 0 18px 50px rgba(31, 28, 23, 0.1);
    }

    html[data-resolved-theme="dark"] .login-panel {
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.32);
    }

    .login-brand-lockup {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
    }

    .login-logo {
      width: 48px;
      height: 48px;
      min-width: 48px;
      margin: 0;
      border: 1px solid var(--border);
      border-radius: 11px;
      box-shadow: none;
    }

    .login-brand-lockup h1 {
      margin-top: 3px;
      color: var(--text-primary);
      font-size: 21px;
      font-weight: 780;
      letter-spacing: -0.02em;
    }

    .login-intro {
      margin-bottom: 24px;
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }

    .field-group {
      margin-bottom: 16px;
    }

    .login-submit {
      width: 100%;
      min-height: 42px;
    }

    .login-error {
      min-height: 22px;
      margin-top: 10px;
      color: var(--danger);
      font-size: 12px;
    }

    .login-theme-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 12px;
    }

    .login-theme-row + .theme-current-label {
      margin-top: 8px;
      text-align: right;
    }

    /* Shell and navigation */
    .app-shell,
    body.is-dashboard-page #dashboardView {
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
      background: var(--page-bg);
    }

    .app-shell.sidebar-collapsed {
      grid-template-columns: var(--sidebar-collapsed-width) minmax(0, 1fr);
    }

    .sidebar {
      width: var(--sidebar-width);
      min-width: 0;
      padding: 14px 12px 12px;
      overflow: hidden;
      border-right-color: var(--border);
      background: var(--surface);
      box-shadow: none;
      transition: width 180ms ease, transform 180ms ease, background-color 180ms ease, border-color 180ms ease;
    }

    .sidebar-primary {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }

    .sidebar-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-height: 52px;
      margin-bottom: 10px;
    }

    .sidebar-brand {
      min-width: 0;
      margin: 0;
      padding: 0 7px;
      gap: 10px;
    }

    .brand-logo {
      width: 36px;
      height: 36px;
      min-width: 36px;
      flex-basis: 36px;
      border: 1px solid var(--border);
      border-radius: 9px;
      box-shadow: none;
    }

    .sidebar-brand-title {
      font-size: 14px;
      letter-spacing: -0.01em;
    }

    .sidebar-brand-subtitle {
      margin-top: 2px;
      font-size: 10px;
    }

    .sidebar nav {
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }

    .nav-list {
      gap: 2px;
      padding: 0 2px 12px;
    }

    .nav-group-label {
      margin: 14px 9px 5px;
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.12em;
      list-style: none;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .nav-group-label:first-child {
      margin-top: 4px;
    }

    .nav-item button {
      position: relative;
      min-height: 36px;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: 7px;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 650;
      gap: 10px;
    }

    .nav-item button:hover {
      border-color: var(--border);
      background: var(--surface-muted);
      color: var(--text-primary);
    }

    .nav-item.active button {
      border-color: color-mix(in srgb, var(--primary) 22%, var(--border));
      background: var(--primary-soft);
      color: var(--primary);
      box-shadow: none;
    }

    .nav-item.active button::before {
      content: "";
      position: absolute;
      top: 8px;
      bottom: 8px;
      left: -3px;
      width: 2px;
      border-radius: 2px;
      background: var(--primary);
    }

    .nav-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-close-button {
      display: none;
    }

    .sidebar-footer {
      flex: 0 0 auto;
      gap: 8px;
      padding-top: 10px;
    }

    .sidebar-collapse-button,
    .logout-button {
      width: 100%;
      min-height: 34px;
      justify-content: flex-start;
      padding: 7px 9px;
      color: var(--text-secondary);
      font-size: 11px;
      gap: 9px;
    }

    .sidebar-collapse-button svg,
    .logout-button svg {
      width: 16px;
      height: 16px;
    }

    .logout-button:hover {
      border-color: var(--danger);
      background: var(--danger-soft);
      color: var(--danger);
    }

    .account-panel {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 9px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
    }

    .account-mark {
      display: grid;
      width: 30px;
      height: 30px;
      flex: 0 0 30px;
      place-items: center;
      border-radius: 7px;
      background: var(--brand-soft);
      color: var(--brand-accent);
      font-size: 11px;
      font-weight: 850;
    }

    .account-copy {
      min-width: 0;
    }

    .account-copy strong {
      display: block;
      color: var(--text-primary);
      font-size: 11px;
    }

    .account-copy .env-info {
      justify-content: flex-start;
      gap: 6px;
      min-width: 0;
      padding: 0;
    }

    .account-copy #versionLabel {
      max-width: 104px;
      overflow: hidden;
      color: var(--text-muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 9px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .env-tag {
      border: 1px solid currentColor;
      border-radius: 999px;
      background: transparent !important;
      font-size: 8px;
      letter-spacing: 0.06em;
    }

    .env-tag.local {
      color: var(--primary);
    }

    .app-shell.sidebar-collapsed .sidebar {
      width: var(--sidebar-collapsed-width);
      padding-inline: 9px;
    }

    .app-shell.sidebar-collapsed .sidebar-brand-text,
    .app-shell.sidebar-collapsed .nav-label,
    .app-shell.sidebar-collapsed .nav-group-label,
    .app-shell.sidebar-collapsed .account-copy {
      display: none;
    }

    .app-shell.sidebar-collapsed .sidebar-header-row,
    .app-shell.sidebar-collapsed .sidebar-brand,
    .app-shell.sidebar-collapsed .nav-item button,
    .app-shell.sidebar-collapsed .sidebar-collapse-button,
    .app-shell.sidebar-collapsed .logout-button,
    .app-shell.sidebar-collapsed .account-panel {
      justify-content: center;
    }

    .app-shell.sidebar-collapsed .sidebar-brand {
      padding: 0;
    }

    .app-shell.sidebar-collapsed .nav-item button {
      padding-inline: 0;
    }

    .app-shell.sidebar-collapsed .nav-item.active button::before {
      left: -4px;
    }

    .app-shell.sidebar-collapsed .sidebar-collapse-button svg {
      transform: rotate(180deg);
    }

    /* Main work surface */
    .main-content {
      max-width: 1760px;
      min-width: 0;
      padding: 24px 32px 48px;
      margin: 0 auto;
      overflow: visible;
    }

    .topbar {
      min-height: 70px;
      margin-bottom: 22px;
      padding: 0 0 16px;
      border-bottom-color: var(--border-strong);
      background: var(--page-bg);
    }

    .topbar-copy {
      min-width: 0;
    }

    .topbar h2 {
      margin-top: 3px;
      color: var(--text-primary);
      font-size: clamp(21px, 2vw, 27px);
      font-weight: 780;
      letter-spacing: -0.035em;
    }

    .topbar p {
      max-width: 720px;
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 11px;
    }

    .topbar-actions {
      flex: 0 0 auto;
      gap: 8px;
    }

    .system-presence {
      display: inline-flex;
      min-height: 34px;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-secondary);
      font-size: 10px;
      font-weight: 700;
    }

    .status-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      flex: 0 0 7px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 0 3px var(--surface-muted);
    }

    .status-dot.success { background: var(--success); box-shadow: 0 0 0 3px var(--success-soft); }
    .status-dot.warning { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }
    .status-dot.danger { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
    .status-dot.info { background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }

    .theme-switcher {
      min-height: 34px;
      padding: 2px;
      border-radius: 7px;
      background: var(--surface-muted);
    }

    .theme-switcher button {
      min-width: 38px;
      min-height: 28px;
      padding: 5px 7px;
      border-radius: 5px;
      font-size: 10px;
    }

    .theme-switcher button[aria-pressed="true"] {
      border: 1px solid var(--border);
      box-shadow: none;
    }

    .refresh-button {
      min-height: 34px;
      padding: 7px 10px;
      font-size: 11px;
    }

    .refresh-button svg {
      width: 15px;
      height: 15px;
    }

    .section {
      min-width: 0;
    }

    .card {
      border-color: var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .card:hover {
      border-color: var(--border);
    }

    .card-title,
    .section-title,
    .sync-section-heading h3 {
      color: var(--text-primary);
      letter-spacing: -0.015em;
    }

    /* Dashboard command hierarchy */
    .dashboard-command-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(290px, 0.75fr);
      gap: 14px;
      align-items: stretch;
      margin-bottom: 24px;
    }

    .dashboard-system-grid {
      display: grid;
      min-height: 168px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: var(--surface-raised);
      box-shadow: var(--shadow);
    }

    .system-metric {
      position: relative;
      display: flex;
      min-width: 0;
      flex-direction: column;
      justify-content: space-between;
      padding: 18px 16px;
      border-right: 1px solid var(--border);
    }

    .system-metric:last-child {
      border-right: 0;
    }

    .system-metric::after {
      content: "";
      position: absolute;
      right: 16px;
      bottom: 13px;
      left: 16px;
      height: 2px;
      background: var(--surface-sunken);
    }

    .system-metric[data-tone="success"]::after { background: var(--success); }
    .system-metric[data-tone="warning"]::after { background: var(--warning); }
    .system-metric[data-tone="danger"]::after { background: var(--danger); }
    .system-metric[data-tone="info"]::after { background: var(--primary); }

    .system-metric-label {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 780;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .system-metric-value {
      min-width: 0;
      margin: 13px 0 8px;
      overflow: hidden;
      color: var(--text-primary);
      font-size: clamp(18px, 1.7vw, 25px);
      font-weight: 790;
      letter-spacing: -0.035em;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .system-metric-foot {
      min-height: 34px;
      padding-bottom: 10px;
      color: var(--text-muted);
      font-size: 10px;
      line-height: 1.55;
    }

    .attention-panel {
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--border-strong);
      border-left: 3px solid var(--warning);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .attention-panel.is-clear {
      border-left-color: var(--success);
    }

    .attention-panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .attention-panel h3,
    .resource-section-head h3 {
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 760;
    }

    .attention-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .attention-item {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      min-width: 0;
      padding: 9px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--surface-muted);
    }

    .attention-item-copy {
      min-width: 0;
      flex: 1;
    }

    .attention-item strong {
      display: block;
      color: var(--text-primary);
      font-size: 11px;
      line-height: 1.4;
    }

    .attention-item small {
      display: block;
      margin-top: 2px;
      color: var(--text-muted);
      font-size: 9px;
      line-height: 1.5;
    }

    .attention-item button {
      flex: 0 0 auto;
      min-height: 28px;
      padding: 5px 7px;
      font-size: 9px;
    }

    .resource-section-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }

    .dashboard-resource-link {
      min-height: 30px;
      padding: 5px 9px;
      font-size: 10px;
    }

    .resource-metric-strip {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0;
      overflow: hidden;
      margin-bottom: 18px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .resource-metric-strip .stat-card {
      min-height: 112px;
      padding: 14px 16px;
      border: 0;
      border-right: 1px solid var(--border);
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }

    .resource-metric-strip .stat-card:last-child {
      border-right: 0;
    }

    .resource-metric-strip .stat-head {
      justify-content: flex-start;
      color: var(--text-secondary);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .resource-metric-strip .stat-num {
      margin-top: 5px;
      font-size: 25px;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.04em;
    }

    .resource-metric-strip .stat-foot {
      margin-top: 3px;
      font-size: 9px;
    }

    .dash-columns {
      grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
      gap: 14px;
    }

    #section-dashboard > .card {
      box-shadow: none;
    }

    /* Unified data table and toolbar system */
    .filter-bar,
    .catalog-toolbar {
      min-height: 48px;
      margin: -4px -4px 14px;
      padding: 4px;
    }

    .catalog-toolbar .tab-filter {
      max-width: min(100%, 720px);
      overflow-x: auto;
      border: 1px solid var(--border);
      background: var(--surface-muted);
      scrollbar-width: none;
    }

    .catalog-toolbar .tab-filter::-webkit-scrollbar {
      display: none;
    }

    .catalog-toolbar .tab-filter button {
      flex: 0 0 auto;
      min-height: 30px;
      white-space: nowrap;
    }

    .search-input-wrap {
      max-width: 360px;
      margin-left: auto;
    }

    .search-input-wrap::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 11px;
      width: 10px;
      height: 10px;
      border: 1.5px solid var(--text-muted);
      border-radius: 50%;
      transform: translateY(-62%);
      pointer-events: none;
    }

    .search-input-wrap::after {
      content: "";
      position: absolute;
      top: calc(50% + 4px);
      left: 20px;
      width: 5px;
      height: 1.5px;
      background: var(--text-muted);
      transform: rotate(45deg);
      pointer-events: none;
    }

    .search-input-wrap input {
      min-height: 36px;
      padding-left: 32px;
      border-radius: 7px;
      background: var(--surface-raised);
    }

    .catalog-result-count {
      flex: 0 0 auto;
      color: var(--text-muted);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .catalog-loading-state,
    .catalog-error-state {
      padding: 36px 16px !important;
      text-align: center;
    }

    .catalog-loading-state { color: var(--text-muted); }
    .catalog-error-state {
      color: var(--danger);
      background: var(--danger-soft) !important;
    }

    #catalogTable[aria-busy="true"] { opacity: 0.72; }

    .table-container {
      position: relative;
      max-width: 100%;
      overflow: auto;
      border-color: var(--border);
      border-radius: 7px;
      background: var(--surface);
      scrollbar-gutter: stable;
    }

    table {
      width: 100%;
      min-width: 720px;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 38px;
      padding: 9px 11px !important;
      border-bottom: 1px solid var(--border-strong) !important;
      background: var(--surface-muted) !important;
      color: var(--text-secondary) !important;
      font-size: 9px !important;
      font-weight: 800 !important;
      letter-spacing: 0.06em;
      text-align: left;
      text-transform: uppercase;
      white-space: nowrap;
    }

    td {
      max-width: 360px;
      height: 43px;
      padding: 9px 11px !important;
      border-bottom: 1px solid var(--border) !important;
      color: var(--text-secondary);
      vertical-align: middle;
    }

    tbody tr:last-child td {
      border-bottom: 0 !important;
    }

    tbody tr {
      transition: background-color 120ms ease;
    }

    tbody tr:focus-within td {
      background: var(--primary-soft) !important;
    }

    tbody tr:hover td {
      background: var(--table-hover) !important;
    }

    td strong {
      color: var(--text-primary);
      font-weight: 700;
    }

    .action-cell {
      width: 1%;
      text-align: right;
      white-space: nowrap;
    }

    .action-cell .btn,
    .action-cell button {
      min-height: 29px;
      padding: 5px 9px !important;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--surface-raised);
      color: var(--primary);
      font-size: 10px !important;
      box-shadow: var(--shadow);
    }

    .action-cell .btn:hover,
    .action-cell button:hover {
      border-color: var(--primary);
      background: var(--primary-soft);
    }

    .badge,
    .tag,
    .pill {
      min-height: 20px;
      padding: 3px 7px;
      border: 1px solid currentColor;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 760;
      line-height: 1.2;
      white-space: nowrap;
    }

    .badge.info,
    .tag.info {
      border-color: color-mix(in srgb, var(--primary) 44%, transparent);
      background: var(--primary-soft);
      color: var(--primary);
    }

    .pagination {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }

    .pagination-info {
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    /* Form, actions, status and feedback states */
    label {
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 700;
    }

    input,
    textarea,
    select {
      min-height: 38px;
      border-color: var(--border-strong);
      border-radius: 7px;
      background: var(--surface-raised);
      color: var(--text-primary);
    }

    input::placeholder,
    textarea::placeholder {
      color: var(--text-muted);
    }

    input:focus,
    textarea:focus,
    select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--focus-ring);
    }

    button,
    .btn {
      min-height: 34px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 700;
    }

    button.primary,
    .btn.primary {
      border-color: var(--primary);
      background: var(--primary);
      color: var(--on-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--primary) 28%, transparent);
    }

    button.secondary,
    .btn.secondary {
      border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
      background: var(--surface-raised);
      color: var(--primary);
    }

    button.ghost,
    .btn.ghost {
      border-color: var(--border);
      color: var(--text-secondary);
    }

    button.danger,
    .btn.danger {
      border-color: color-mix(in srgb, var(--danger) 42%, var(--border));
      background: var(--danger-soft);
      color: var(--danger);
    }

    button:disabled,
    .btn:disabled {
      cursor: not-allowed;
      filter: saturate(0.55);
      opacity: 0.52;
    }

    button.is-loading,
    .btn.is-loading {
      position: relative;
      padding-left: 32px;
    }

    button.is-loading::before,
    .btn.is-loading::before {
      content: "";
      position: absolute;
      left: 12px;
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: operation-spin 700ms linear infinite;
    }

    @keyframes operation-spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      padding: 32px 20px;
      border: 1px dashed var(--border-strong) !important;
      border-radius: 8px;
      background: var(--surface-muted) !important;
      color: var(--text-muted) !important;
      text-align: center;
    }

    .module-error,
    .error-state {
      border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border));
      border-left: 3px solid var(--danger);
      border-radius: 7px;
      background: var(--danger-soft);
      color: var(--danger);
    }

    .toast {
      min-width: 280px;
      max-width: min(420px, calc(100vw - 32px));
      padding: 12px 14px;
      border-left: 3px solid var(--primary) !important;
      border-radius: 8px;
      color: var(--text-primary) !important;
      font-size: 12px;
    }

    .toast.success { border-left-color: var(--success) !important; }
    .toast.error { border-left-color: var(--danger) !important; }
    .toast.warning { border-left-color: var(--warning) !important; }

    .drawer,
    .catalog-drawer,
    .feedback-drawer {
      width: min(680px, 92vw);
      max-width: 92vw;
      border-left: 1px solid var(--border-strong) !important;
      box-shadow: -18px 0 48px rgba(24, 27, 32, 0.14);
    }

    .drawer-header,
    .drawer-footer {
      border-color: var(--border);
      background: var(--surface-raised);
    }

    .drawer-close {
      display: inline-flex;
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 7px;
      font-size: 18px;
    }

    /* Sync center: one visible path, with operational detail kept below. */
    .sync-hero {
      margin-bottom: 12px;
      padding: 17px 18px;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-left: 4px solid var(--brand-accent);
      border-radius: 9px;
      background: var(--surface-raised);
      box-shadow: var(--shadow);
    }

    .sync-hero-title {
      color: var(--text-primary);
      font-size: 18px;
      letter-spacing: -0.025em;
    }

    .sync-hero-badge {
      border: 1px solid color-mix(in srgb, var(--brand-accent) 40%, var(--border));
      background: var(--brand-soft);
      color: var(--brand-accent);
    }

    .sync-hero-subtitle {
      margin-top: 5px;
      color: var(--text-muted);
      font-size: 11px;
    }

    .sync-pipeline-shell {
      margin-bottom: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .sync-pipeline-summary {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .sync-pipeline-summary h3 {
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 760;
    }

    .sync-pipeline-current {
      display: flex;
      align-items: baseline;
      gap: 7px;
      color: var(--text-muted);
      font-size: 9px;
    }

    .sync-pipeline-current strong {
      color: var(--primary);
      font-size: 11px;
    }

    .sync-pipeline-rail {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
      list-style: none;
    }

    .sync-pipeline-rail li {
      position: relative;
      display: flex;
      min-width: 0;
      min-height: 78px;
      align-items: flex-start;
      gap: 9px;
      padding: 13px 11px;
      border-right: 1px solid var(--border);
      background: var(--surface);
    }

    .sync-pipeline-rail li:last-child {
      border-right: 0;
    }

    .sync-pipeline-rail li::after {
      content: "";
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 2px;
      background: var(--border-strong);
    }

    .sync-pipeline-rail li[data-stage-state="complete"]::after { background: var(--success); }
    .sync-pipeline-rail li[data-stage-state="current"]::after { height: 3px; background: var(--primary); }
    .sync-pipeline-rail li[data-stage-state="blocked"]::after { height: 3px; background: var(--danger); }

    .sync-pipeline-rail li[data-stage-state="complete"] .pipeline-index { background: var(--success-soft); color: var(--success); }
    .sync-pipeline-rail li[data-stage-state="current"] .pipeline-index { background: var(--primary); color: var(--on-primary); }
    .sync-pipeline-rail li[data-stage-state="blocked"] .pipeline-index { background: var(--danger-soft); color: var(--danger); }

    .pipeline-index {
      display: grid;
      width: 25px;
      height: 25px;
      flex: 0 0 25px;
      place-items: center;
      border-radius: 6px;
      background: var(--surface-muted);
      color: var(--text-muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 8px;
      font-weight: 800;
    }

    .sync-pipeline-rail strong,
    .sync-pipeline-rail small {
      display: block;
      min-width: 0;
    }

    .sync-pipeline-rail strong {
      color: var(--text-primary);
      font-size: 10px;
      line-height: 1.4;
    }

    .sync-pipeline-rail small {
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 8px;
      line-height: 1.45;
    }

    .sync-next-guidance {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 11px;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--primary-soft);
      color: var(--text-secondary);
      font-size: 9px;
    }

    .sync-next-guidance strong {
      color: var(--primary);
      font-size: 10px;
    }

    .sync-section-nav {
      top: 10px;
      margin-bottom: 12px;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-raised);
      box-shadow: var(--shadow);
    }

    .sync-section-nav a {
      min-height: 30px;
      padding: 7px 9px;
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 9px;
      font-weight: 700;
    }

    .sync-section-nav a:hover {
      background: var(--surface-muted);
      color: var(--text-primary);
    }

    .sync-ops-section {
      margin-bottom: 12px;
      padding: 15px;
      border-color: var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: none;
    }

    #sync-ops-console {
      border-color: var(--border-strong);
      background: var(--surface-raised);
    }

    .sync-core-actions {
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }

    .sync-core-actions .primary {
      min-height: 38px;
    }

    .sync-secondary-heading {
      margin: 20px 0 10px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    #section-sync > .card,
    #section-sync details,
    #section-sync .sync-card {
      box-shadow: none;
    }

    #section-sync .danger-zone,
    #section-sync [class*="danger-zone"] {
      border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
      background: var(--danger-soft);
    }

    details {
      border-color: var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    summary {
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 700;
    }

    code,
    pre,
    .code-block {
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    /* Tablet: deliberate compact rail. */
    @media (min-width: 1024px) and (max-width: 1199.98px) {
      .app-shell,
      body.is-dashboard-page #dashboardView {
        grid-template-columns: var(--sidebar-collapsed-width) minmax(0, 1fr);
      }

      .sidebar {
        width: var(--sidebar-collapsed-width);
        padding-inline: 9px;
      }

      .sidebar-brand-text,
      .sidebar .nav-label,
      .sidebar .nav-group-label,
      .sidebar .account-copy {
        display: none;
      }

      .sidebar-header-row,
      .sidebar-brand,
      .sidebar .nav-item button,
      .sidebar-collapse-button,
      .logout-button,
      .account-panel {
        justify-content: center;
      }

      .sidebar-brand {
        padding: 0;
      }

      .sidebar-collapse-button {
        display: none;
      }

      .main-content {
        padding-inline: 24px;
      }

      .dashboard-system-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .system-metric:nth-child(2) {
        border-right: 0;
      }

      .system-metric:nth-child(-n + 2) {
        border-bottom: 1px solid var(--border);
      }

      .sync-pipeline-rail {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .sync-pipeline-rail li:nth-child(3) {
        border-right: 0;
      }

      .sync-pipeline-rail li:nth-child(-n + 3) {
        border-bottom: 1px solid var(--border);
      }
    }

    /* Drawer navigation for medium and small screens. */
    @media (max-width: 1023.98px) {
      html,
      body {
        max-width: 100%;
        overflow-x: hidden;
      }

      .app-shell,
      body.is-dashboard-page #dashboardView,
      .app-shell.sidebar-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }

      .mobile-topbar {
        display: flex;
        grid-column: 1;
        height: 58px;
        border-bottom-color: var(--border-strong);
        background: var(--surface-raised);
        box-shadow: none;
      }

      .mobile-logo-wrap .brand-logo {
        width: 30px;
        height: 30px;
        min-width: 30px;
      }

      .sidebar,
      .app-shell.sidebar-collapsed .sidebar {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 100;
        width: min(330px, 88vw);
        height: 100dvh;
        padding: 14px 12px 12px;
        transform: translateX(-105%);
        box-shadow: 16px 0 48px rgba(14, 17, 22, 0.24);
      }

      .sidebar.show,
      .app-shell.sidebar-collapsed .sidebar.show {
        transform: translateX(0);
      }

      .sidebar-brand-text,
      .app-shell.sidebar-collapsed .sidebar-brand-text,
      .sidebar .nav-label,
      .app-shell.sidebar-collapsed .nav-label,
      .sidebar .nav-group-label,
      .app-shell.sidebar-collapsed .nav-group-label,
      .sidebar .account-copy,
      .app-shell.sidebar-collapsed .account-copy {
        display: block;
      }

      .sidebar-header-row,
      .app-shell.sidebar-collapsed .sidebar-header-row {
        justify-content: space-between;
      }

      .sidebar-brand,
      .app-shell.sidebar-collapsed .sidebar-brand,
      .sidebar .nav-item button,
      .app-shell.sidebar-collapsed .nav-item button,
      .sidebar-collapse-button,
      .logout-button,
      .account-panel {
        justify-content: flex-start;
      }

      .sidebar .nav-item button,
      .app-shell.sidebar-collapsed .nav-item button {
        flex-direction: row;
        gap: 10px;
        padding: 9px 10px;
        font-size: 13px;
      }

      .sidebar-brand,
      .app-shell.sidebar-collapsed .sidebar-brand {
        padding: 0 7px;
      }

      .sidebar-close-button {
        display: inline-flex;
      }

      .sidebar-collapse-button {
        display: none;
      }

      .sidebar-overlay {
        backdrop-filter: none;
      }

      .main-content {
        grid-column: 1;
        width: 100%;
        max-width: 100%;
        padding: 20px 22px 40px;
      }

      .dashboard-command-layout {
        grid-template-columns: minmax(0, 1fr);
      }

      .dashboard-system-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .system-metric:nth-child(2) {
        border-right: 0;
      }

      .system-metric:nth-child(-n + 2) {
        border-bottom: 1px solid var(--border);
      }

      .sync-pipeline-rail {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .sync-pipeline-rail li:nth-child(even) {
        border-right: 0;
      }

      .sync-pipeline-rail li:not(:nth-last-child(-n + 2)) {
        border-bottom: 1px solid var(--border);
      }
    }

    @media (max-width: 767.98px) {
      .main-content {
        padding: 16px 14px 32px;
      }

      .topbar {
        min-height: auto;
        align-items: center;
        flex-direction: row;
        gap: 8px;
        margin-bottom: 14px;
        padding-bottom: 12px;
      }

      .topbar-copy {
        flex: 1;
      }

      .topbar-copy h2,
      .topbar-copy .page-eyebrow {
        display: none;
      }

      .topbar p {
        margin: 0;
        overflow: hidden;
        font-size: 9px;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .topbar-actions {
        width: auto;
        flex-direction: row;
        justify-content: flex-end;
      }

      .system-presence {
        display: none;
      }

      .topbar .theme-switcher button {
        min-width: 33px;
        padding-inline: 5px;
      }

      .refresh-button {
        width: 34px !important;
        min-width: 34px;
        padding: 0;
      }

      .refresh-button span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }

      .dashboard-command-layout {
        margin-bottom: 18px;
      }

      .resource-metric-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .resource-metric-strip .stat-card:nth-child(2) {
        border-right: 0;
      }

      .resource-metric-strip .stat-card:nth-child(-n + 2) {
        border-bottom: 1px solid var(--border);
      }

      .dash-columns {
        grid-template-columns: minmax(0, 1fr);
      }

      .catalog-toolbar {
        align-items: stretch;
      }

      .catalog-toolbar .tab-filter,
      .search-input-wrap {
        max-width: none;
        width: 100%;
      }

      .catalog-result-count {
        width: 100%;
      }

      .sync-hero {
        align-items: flex-start;
        flex-direction: column;
      }

      .sync-hero-actions {
        width: 100%;
        justify-content: space-between;
      }

      .sync-pipeline-summary {
        align-items: flex-start;
        flex-direction: column;
      }

      .sync-pipeline-rail {
        grid-template-columns: minmax(0, 1fr);
      }

      .sync-pipeline-rail li,
      .sync-pipeline-rail li:nth-child(even) {
        min-height: 64px;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .sync-pipeline-rail li:last-child {
        border-bottom: 0;
      }

      .sync-next-guidance {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .sync-section-nav {
        position: static;
        flex-wrap: nowrap;
        overflow-x: auto;
      }

      .sync-section-nav a {
        flex: 0 0 auto;
      }

      .drawer,
      .catalog-drawer,
      .feedback-drawer {
        width: 100vw !important;
        max-width: 100vw !important;
      }
    }

    @media (max-width: 479.98px) {
      .mobile-logo-wrap span {
        display: none;
      }

      .mobile-topbar-title {
        text-align: left;
      }

      .dashboard-system-grid {
        grid-template-columns: minmax(0, 1fr);
      }

      .system-metric,
      .system-metric:nth-child(2) {
        min-height: 122px;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .system-metric:last-child {
        border-bottom: 0;
      }

      .resource-section-head {
        align-items: flex-start;
        flex-direction: column;
      }

      .resource-section-head .dashboard-resource-link {
        width: 100%;
      }

      .login-panel {
        padding: 25px 20px;
      }

      .login-theme-row {
        align-items: flex-start;
        flex-direction: column;
      }

      .login-theme-row .theme-switcher {
        width: 100%;
      }

      .login-theme-row .theme-switcher button {
        flex: 1;
      }
    }

    /* Legacy sync operations console: compact task-oriented layout. */ #section-sync { gap: 12px; min-width: 0; }
    #section-sync > *, .sync-tab-panel, .sync-panel-stack, .sync-overview-layout > * { min-width: 0; }
    #section-sync [hidden], .sync-tab-panel[hidden] { display: none !important; }
    #section-sync .sync-hero { min-height: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: none; }
    #section-sync .sync-hero::before, #section-sync .sync-hero::after { display: none; }
    #section-sync .sync-hero-title { margin: 0; color: var(--text-primary); font-size: 20px; line-height: 1.25; }
    #section-sync .sync-hero-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    #section-sync .sync-online-status, #section-sync .sync-last-refresh { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; white-space: nowrap; }
    #section-sync button, #section-sync select { min-height: 34px; }
    .sync-tab-shell { display: flex; align-items: center; min-width: 0; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .sync-tab-list { display: flex; gap: 2px; width: 100%; overflow-x: auto; scrollbar-width: thin; }
    .sync-tab-list [role="tab"] { flex: 1 0 auto; min-width: 132px; height: 34px; padding: 0 14px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 650; box-shadow: none; }
    .sync-tab-list [role="tab"]:hover { background: var(--surface-muted); color: var(--text-primary); }
    .sync-tab-list [role="tab"][aria-selected="true"] { background: var(--primary-soft); color: var(--primary); box-shadow: inset 0 -2px 0 var(--primary); }
    .sync-tab-select-wrap { display: none; width: 100%; gap: 6px; color: var(--text-muted); font-size: 12px; }
    .sync-tab-select-wrap select { width: 100%; }
    .sync-tab-panels, .sync-panel-stack, .sync-overview-primary, .sync-overview-aside { display: grid; gap: 12px; align-content: start; }
    .sync-metric-strip { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .sync-metric-item { min-width: 0; min-height: 66px; padding: 9px 11px; border-right: 1px solid var(--border); }
    .sync-metric-item:last-child { border-right: 0; }
    .sync-metric-item span, .sync-metric-item small { display: block; overflow: hidden; color: var(--text-muted); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .sync-metric-item strong { display: block; overflow: hidden; margin: 4px 0 2px; color: var(--text-primary); font-size: 14px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    #sync-ops-console { margin: 0; padding: 0; border: 0; background: transparent; box-shadow: none; }
    #section-sync .sync-pipeline-shell { display: grid; gap: 5px; min-height: 0; margin: 0; padding: 9px 12px; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: none; }
    #section-sync .sync-pipeline-summary { min-width: 620px; min-height: 0; margin: 0; }
    #section-sync .sync-pipeline-summary .section-kicker { display: none; }
    #section-sync .sync-pipeline-summary h3 { margin: 0; font-size: 13px; }
    #section-sync .sync-pipeline-current { padding: 0; border: 0; background: transparent; font-size: 11px; }
    #section-sync .sync-pipeline-rail { display: grid; grid-template-columns: repeat(5, minmax(116px, 1fr)); min-width: 620px; gap: 6px; margin: 0; padding: 0; }
    #section-sync .sync-pipeline-rail li, #section-sync .sync-pipeline-rail li:nth-child(even) { display: flex; min-width: 0; min-height: 30px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-muted); }
    #section-sync .sync-pipeline-rail li::after { bottom: -1px; }
    #section-sync .sync-pipeline-rail .pipeline-index { width: 20px; height: 20px; font-size: 10px; }
    #section-sync .sync-pipeline-rail strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    #section-sync .sync-pipeline-rail small { display: none; }
    #section-sync .sync-next-guidance { min-width: 620px; margin: 0; padding: 0; border: 0; background: transparent; font-size: 11px; }
    .sync-overview-layout { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
    .sync-overview-primary { grid-column: span 8; }
    .sync-overview-aside { grid-column: span 4; }
    #section-sync .sync-ops-section, #section-sync .card, #section-sync details.sync-card { margin: 0 !important; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: none; }
    #section-sync .sync-section-heading, #section-sync .section-title-row { margin-bottom: 8px; }
    #section-sync .sync-section-heading h3, #section-sync .card-title, #section-sync .section-title { margin-bottom: 0; font-size: 14px; line-height: 1.35; }
    #section-sync .sync-section-heading p, #section-sync .card > p { margin-top: 4px; margin-bottom: 8px; font-size: 12px; line-height: 1.45; }
    #section-sync .sync-ops-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    #section-sync .sync-compact-card { min-height: 0; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-muted); box-shadow: none; }
    .sync-quick-actions { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .sync-recommendation-copy { margin: 0 0 8px; color: var(--text-secondary); font-size: 12px; }
    #section-sync details.sync-technical-details { margin-top: 8px !important; padding: 0; border: 0; background: transparent; }
    #section-sync details.sync-technical-details > summary { cursor: pointer; color: var(--text-muted); font-size: 12px; font-weight: 650; }
    #section-sync details.sync-technical-details[open] > summary { margin-bottom: 8px; }
    #section-sync .mini-list-row strong { max-width: 64%; overflow-wrap: anywhere; text-align: right; }
    .runtime-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .runtime-metric-grid .runtime-metric-item { min-width: 0; min-height: 66px; padding: 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-muted); }
    .runtime-metric-item span, .runtime-metric-item small { display: block; color: var(--text-muted); font-size: 11px; }
    .runtime-metric-item strong { display: block; overflow: hidden; margin-top: 5px; color: var(--text-primary); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    #section-sync .sync-primary-flow { display: grid; gap: 8px; padding: 0; border: 0; background: transparent; }
    #section-sync details.flow-card { margin: 0 !important; padding: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    #section-sync details.flow-card > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 8px 12px; cursor: pointer; list-style: none; }
    #section-sync details.flow-card > summary::-webkit-details-marker { display: none; }
    .flow-summary-main, .flow-summary-meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .flow-summary-main strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .flow-summary-meta { flex: 0 0 auto; color: var(--text-muted); font-size: 11px; }
    #section-sync details.flow-card > .flow-content { padding: 0 12px 12px; }
    #section-sync details.flow-card > .flow-step, #section-sync details.flow-card > .flow-title { display: none; }
    #section-sync .table-container { width: 100%; max-width: 100%; overflow-x: auto; }
    #section-sync table { width: 100%; }
    #section-sync th, #section-sync td { height: 44px; padding: 6px 8px; vertical-align: middle; }
    #section-sync .release-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
    #section-sync .release-card, #section-sync .release-strip > * { min-height: 0; padding: 10px; box-shadow: none; }
    #section-sync .openresty-card-grid, #section-sync .openresty-summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    #section-sync .openresty-summary-grid .openresty-meta-item { min-height: 60px; padding: 9px 10px; }
    #section-sync .sync-health-empty { min-height: 0; display: block; }
    .sync-empty-inline { padding: 7px 0; color: var(--text-muted); font-size: 12px; }
    #staticReleaseSyncSummary { display: block !important; }
    #staticReleaseSyncSummary > details { margin-top: 8px !important; }
    #section-sync .staging-upload-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    #section-sync .staging-upload-filters, #section-sync .staging-upload-bulk-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    #section-sync .staging-upload-filters { flex: 1 1 420px; }
    #section-sync .staging-upload-bulk-actions { flex: 1 1 520px; justify-content: flex-end; }
    #section-sync .staging-upload-table { min-width: 720px; }
    #section-sync .staging-group-row > td { height: 46px; }
    .staging-row-summary { display: block; margin-top: 2px; color: var(--text-muted); font-size: 11px; line-height: 1.3; }
    #section-sync .staging-action-row { display: flex; gap: 5px; flex-wrap: wrap; }
    #section-sync .sync-online-status.is-online { color: var(--text-secondary); }
    #section-sync .sync-online-status.is-offline { color: var(--danger); }
    #section-sync .health-grid:not(.sync-health-empty) { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
    @media (max-width: 1100px) { .sync-metric-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .sync-metric-item:nth-child(3) { border-right: 0; }
    .sync-metric-item:nth-child(-n + 3) { border-bottom: 1px solid var(--border); }
    .sync-overview-primary { grid-column: span 7; }
    .sync-overview-aside { grid-column: span 5; }
    .runtime-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #section-sync .openresty-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
     }
    @media (max-width: 760px) { #section-sync .sync-hero { align-items: flex-start; flex-direction: column; }
    #section-sync .sync-hero-actions { width: 100%; justify-content: flex-start; }
    .sync-overview-primary, .sync-overview-aside { grid-column: 1 / -1; }
    #section-sync .openresty-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
     }
    @media (max-width: 640px) { .sync-tab-list { display: none; }
    .sync-tab-select-wrap { display: grid; }
    .sync-metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sync-metric-item, .sync-metric-item:nth-child(3) { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .sync-metric-item:nth-child(even) { border-right: 0; }
    .sync-metric-item:nth-last-child(-n + 2) { border-bottom: 0; }
    .runtime-metric-grid, #section-sync .openresty-summary-grid { grid-template-columns: minmax(0, 1fr); }
    #section-sync .openresty-actions, #section-sync .sync-next-action-row { display: grid; grid-template-columns: minmax(0, 1fr); }
    #section-sync .openresty-actions button, #section-sync .sync-next-action-row button { width: 100%; }
    .flow-summary-meta span:first-child { display: none; }
     }
  </style>
  </head>
<body>

  <a class="skip-link" id="adminSkipLink" href="#adminMainContent">跳到主要内容</a>

  <!-- 登录页视图 -->
  <main id="loginView" class="login-wrap" tabindex="-1" hidden>
    <div class="card login-panel">
      <div class="login-brand-lockup">
        <img class="login-logo" ${ADMIN_LOGO_IMG_ATTRS}>
        <div>
          <div class="page-eyebrow">Campus Operations Studio</div>
          <h1>佛课小表后台</h1>
        </div>
      </div>
      <p class="login-intro">校园课表数据运营控制台。验证管理员凭据后继续。</p>
      <div class="login-form">
        <div class="field-group">
          <label for="loginPassword">管理员密码或令牌</label>
          <input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码">
        </div>
        <button id="loginButton" class="primary login-submit">验证并进入控制台</button>
        <div id="loginError" role="alert" aria-live="polite" class="login-error"></div>
        <div class="login-theme-row">
          <span>界面主题</span>
          <div class="theme-switcher" role="group" aria-label="后台主题">
          <button type="button" data-theme-choice="system" aria-label="跟随系统主题">系统</button>
          <button type="button" data-theme-choice="light" aria-label="切换浅色主题">浅色</button>
          <button type="button" data-theme-choice="dark" aria-label="切换深色主题">深色</button>
          </div>
        </div>
        <div class="theme-current-label" data-theme-current>当前：跟随系统</div>
      </div>
    </div>
  </main>

  <!-- 控制台主页面 -->
  <main id="dashboardView" class="app-shell" hidden>
    <div class="mobile-topbar" id="mobileAdminTopbar">
      <div class="mobile-logo-wrap">
        <img class="brand-logo" ${ADMIN_LOGO_IMG_ATTRS}>
        <span>佛课小表</span>
      </div>
      <h1 class="mobile-topbar-title" id="mobilePageTitle">数据概览</h1>
      <button id="mobileMenuBtn" class="mobile-menu-toggle icon-button" type="button" aria-label="打开后台导航" aria-expanded="false" aria-controls="appSidebar">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
    <div id="sidebarOverlay" class="sidebar-overlay" aria-hidden="true"></div>

    <!-- 左侧导航侧边栏 -->
    <aside id="appSidebar" class="sidebar" aria-label="后台主导航">
      <div class="sidebar-primary">
        <div class="sidebar-header-row">
          <div class="brand sidebar-brand">
            <img class="brand-logo" ${ADMIN_LOGO_IMG_ATTRS}>
            <div class="sidebar-brand-text">
              <div class="brand-title sidebar-brand-title">佛课小表</div>
              <div class="brand-subtitle sidebar-brand-subtitle">校园数据运营台</div>
            </div>
          </div>
          <button id="sidebarCloseBtn" class="icon-button sidebar-close-button" type="button" aria-label="关闭后台导航">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <nav>
          <ul class="nav-list">
            <li class="nav-group-label" data-nav-group="总览">总览</li>
            <li class="nav-item active" data-section="dashboard"><button type="button" title="数据概览"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg><span class="nav-label">数据概览</span></button></li>

            <li class="nav-group-label" data-nav-group="数据与课表">数据与课表</li>
            <li class="nav-item" data-section="catalog"><button type="button" title="数据资源"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.5C4 5.12 7.58 4 12 4s8 1.12 8 2.5S16.42 9 12 9 4 7.88 4 6.5Zm0 0V12c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5V6.5M4 12v5.5C4 18.88 7.58 20 12 20s8-1.12 8-2.5V12"/></svg><span class="nav-label">数据资源</span></button></li>
            <li class="nav-item" data-section="terms"><button type="button" title="学期管理"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 8h3m2 0h3m-8 4h3m2 0h3"/></svg><span class="nav-label">学期管理</span></button></li>
            <li class="nav-item" data-section="quality"><button type="button" title="数据质量"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.2c0 4.5 3 7.8 7.5 9.8 4.5-2 7.5-5.3 7.5-9.8V6L12 3Zm-3 9 2 2 4-4"/></svg><span class="nav-label">数据质量</span></button></li>

            <li class="nav-group-label" data-nav-group="发布与运维">发布与运维</li>
            <li class="nav-item" data-section="sync"><button type="button" title="同步中心"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7h-7a4 4 0 0 0-4 4v0M16 3l4 4-4 4M4 17h7a4 4 0 0 0 4-4v0m-7 8-4-4 4-4"/></svg><span class="nav-label">同步中心</span></button></li>
            <li class="nav-item" data-section="config"><button type="button" title="数据版本"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Zm-8 9 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></svg><span class="nav-label">数据版本</span></button></li>

            <li class="nav-group-label" data-nav-group="内容管理">内容管理</li>
            <li class="nav-item" data-section="notices"><button type="button" title="公告管理"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13V9l12-5v14L4 13Zm12-4h3a2 2 0 0 1 0 4h-3M6 14l1.5 6h4L10 15"/></svg><span class="nav-label">公告管理</span></button></li>
            <li class="nav-item" data-section="news"><button type="button" title="最新动态"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5V4Zm3 4h8M8 12h8m-8 4h5"/></svg><span class="nav-label">最新动态</span></button></li>
            <li class="nav-item" data-section="campus-map"><button type="button" title="校园地图"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg><span class="nav-label">校园地图</span></button></li>
            <li class="nav-item" data-section="feedback"><button type="button" title="反馈管理"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 4V5Zm4 4h8m-8 4h5"/></svg><span class="nav-label">反馈管理</span></button></li>
            <li class="nav-item" data-section="assistant-kb"><button type="button" title="小佛助手知识库"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11M9 8h6"/></svg><span class="nav-label">助手知识库</span></button></li>

            <li class="nav-group-label" data-nav-group="系统与安全">系统与安全</li>
            <li class="nav-item" data-section="ai-provider"><button type="button" title="查询服务"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4h8v4H8V4ZM5 10h14v10H5V10Zm4 4h.01M15 14h.01M9 17h6"/></svg><span class="nav-label">查询服务</span></button></li>
            <li class="nav-item" data-section="security"><button type="button" title="安全状态"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.2c0 4.5 3 7.8 7.5 9.8 4.5-2 7.5-5.3 7.5-9.8V6L12 3Zm0 5v4m0 4h.01"/></svg><span class="nav-label">安全状态</span></button></li>
            <li class="nav-item" data-section="settings"><button type="button" title="系统设置"><svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm7.4 4a7.7 7.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8.7 8.7 0 0 0-1.8-1L14.8 3h-4l-.3 2.7a8.7 8.7 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a8.7 8.7 0 0 0 1.8 1l.3 2.7h4l.3-2.7a8.7 8.7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7.7 7.7 0 0 0 .1-1.4Z"/></svg><span class="nav-label">系统设置</span></button></li>
          </ul>
        </nav>
      </div>
      <div class="sidebar-footer">
        <button id="sidebarCollapseBtn" class="sidebar-collapse-button ghost" type="button" aria-label="收起侧栏" aria-expanded="true">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 7-5 5 5 5"/></svg><span class="nav-label">收起侧栏</span>
        </button>
        <div class="account-panel">
          <div class="account-mark" aria-hidden="true">管</div>
          <div class="account-copy">
            <strong>管理员</strong>
            <div class="env-info">
              <span id="envTag" class="env-tag local">local</span>
              <span id="versionLabel">-</span>
            </div>
          </div>
        </div>
        <button id="logoutButton" class="logout-button ghost" type="button" aria-label="退出登录" title="退出登录"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H5v14h5m4-4 4-3-4-3m4 3H9"/></svg><span class="nav-label">退出登录</span></button>
      </div>
    </aside>

    <!-- 右侧主体内容 -->
    <div class="main-content" id="adminMainContent" tabindex="-1">
      <div class="topbar">
        <div class="topbar-copy">
          <div class="page-eyebrow" id="pageEyebrow">总览 / 数据运营</div>
          <h2 id="pageTitle">数据概览</h2>
          <p id="statusLine">加载中...</p>
        </div>
        <div class="topbar-actions">
          <div class="system-presence" title="后台会话已连接"><span class="status-dot success"></span><span>控制台在线</span></div>
          <div class="theme-switcher" role="group" aria-label="后台主题">
            <button type="button" data-theme-choice="system" aria-label="跟随系统主题">系统</button>
            <button type="button" data-theme-choice="light" aria-label="切换浅色主题">浅色</button>
            <button type="button" data-theme-choice="dark" aria-label="切换深色主题">深色</button>
          </div>
          <button id="refreshButton" class="ghost refresh-button" type="button" aria-label="刷新当前页面"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg><span>刷新本页</span></button>
        </div>
      </div>

      <!-- 面板一：数据概览 Dashboard -->
      <section id="section-dashboard" class="section active">
        <div class="dashboard-command-layout">
          <div>
            <div class="section-kicker">运行态势</div>
            <div class="dashboard-system-grid" id="dashboardSystemGrid" aria-live="polite">
              <!-- 动态加载系统状态、当前学期、Active Release 与最近同步 -->
            </div>
          </div>
          <aside class="attention-panel" aria-labelledby="dashboardAttentionTitle">
            <div class="attention-panel-head">
              <div>
                <div class="section-kicker">需要关注</div>
                <h3 id="dashboardAttentionTitle">待处理事项</h3>
              </div>
              <span class="badge muted" id="dashboardAttentionCount">0 项</span>
            </div>
            <div id="dashboardAttentionList" class="attention-list" aria-live="polite"></div>
          </aside>
        </div>

        <div class="resource-section-head">
          <div>
            <div class="section-kicker">资源规模</div>
            <h3>核心课表数据</h3>
          </div>
          <button type="button" class="ghost dashboard-resource-link" data-dashboard-target="catalog">进入数据资源</button>
        </div>
        <div class="stats-grid resource-metric-strip" id="statsGrid">
          <!-- 动态加载资源指标 -->
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
          <div class="heatmap-card-head">
            <div>
              <h3 class="card-title" style="margin-bottom: 8px;">全校教室占用热力图</h3>
              <div style="font-size: 12px; color: var(--muted);">
                按星期与节次统计真实教室排课占用情况。
              </div>
            </div>
            <div class="heatmap-meta" id="classroomHeatmapMeta"></div>
          </div>
          <div class="heatmap-summary-container" id="classroomHeatmapSummary"></div>
          <div class="heatmap-toolbar">
            <div class="tab-filter" id="heatmapDayType">
              <button class="active" data-daytype="all">全周</button>
              <button data-daytype="workday">工作日</button>
              <button data-daytype="weekend">周末</button>
            </div>
          </div>
          <div id="classroomHeatmapNotice"></div>
          <div class="heatmap-scroller">
            <div class="heatmap-container" id="classroomHeatmap">
              <!-- 动态生成教室占用热力图 -->
            </div>
          </div>
          <div class="heatmap-legend" id="classroomHeatmapLegend">
            <span>占用度</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #eef3f8;"></span>0%</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #cfe0ff;"></span>1-25%</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #8fbaff;"></span>26-50%</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #4f86e8;"></span>51-75%</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #1d4ed8;"></span>76-100%</span>
          </div>
          <div class="heatmap-detail-panel" id="classroomHeatmapDetailPanel">
            <div class="heatmap-detail-title">
              <span id="heatmapDetailTitle">时段详情</span>
              <button id="closeHmDetailBtn" class="ghost" style="padding: 4px 8px; font-size: 11px;">收起</button>
            </div>
            <div class="heatmap-detail-stat" id="heatmapDetailStats"></div>
            <div class="heatmap-detail-grid" id="heatmapDetailList"></div>
          </div>
        </div>
      </section>

      <!-- 面板二：数据资源 Data Catalog -->
      <section id="section-catalog" class="section">
        <div class="card">
          <div class="filter-bar catalog-toolbar" role="search">
            <div class="tab-filter" id="catalogTabs">
              <button class="active" data-type="class">行政班</button>
              <button data-type="teacher">教师</button>
              <button data-type="classroom">教室</button>
              <button data-type="course">课程</button>
              <button data-type="major">专业</button>
              <button data-type="snapshot">原始快照</button>
            </div>
            <div class="search-input-wrap">
              <input id="catalogSearch" aria-label="搜索数据资源" placeholder="搜索名称 / 别名 / 学院等关键词">
            </div>
            <span class="catalog-result-count" id="catalogResultCount" aria-live="polite">0 条结果</span>
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
      <!-- 面板三：同步中心 Sync Center -->
      <section id="section-sync" class="section">
        <!-- 1. sync-hero -->
        <div class="sync-hero" id="sync-hero">
          <div class="sync-hero-main">
            <h2 class="sync-hero-title">数据同步中心</h2>
          </div>
          <div class="sync-hero-actions">
            <span class="sync-online-status" id="syncOnlineStatus"><span class="status-dot info"></span>在线状态：检测中</span>
            <span class="sync-last-refresh" id="syncLastRefreshAt">最近刷新：-</span>
            <button type="button" class="secondary" id="syncRefreshInlineBtn">刷新状态</button>
          </div>
        </div>

        <div class="sync-tab-shell">
          <div id="syncTaskTabs" class="sync-tab-list" role="tablist" aria-label="同步中心任务">
            <button type="button" id="sync-tab-overview" role="tab" aria-selected="true" aria-controls="sync-panel-overview" tabindex="0" data-sync-tab="overview">运营概览</button>
            <button type="button" id="sync-tab-upload" role="tab" aria-selected="false" aria-controls="sync-panel-upload" tabindex="-1" data-sync-tab="upload">上传与发布</button>
            <button type="button" id="sync-tab-versions" role="tab" aria-selected="false" aria-controls="sync-panel-versions" tabindex="-1" data-sync-tab="versions">版本与回滚</button>
            <button type="button" id="sync-tab-operations" role="tab" aria-selected="false" aria-controls="sync-panel-operations" tabindex="-1" data-sync-tab="operations">运维与诊断</button>
          </div>
          <label class="sync-tab-select-wrap" for="syncTabSelect">
            <span>当前任务</span>
            <select id="syncTabSelect">
              <option value="overview">运营概览</option>
              <option value="upload">上传与发布</option>
              <option value="versions">版本与回滚</option>
              <option value="operations">运维与诊断</option>
            </select>
          </label>
        </div>

        <div class="sync-tab-panels">
          <section id="sync-panel-overview" class="sync-tab-panel" role="tabpanel" aria-labelledby="sync-tab-overview">
            <div id="syncOverviewMetricsMount"></div>
            <div id="syncOverviewPipelineMount"></div>
            <div class="sync-overview-layout">
              <div id="syncOverviewPrimary" class="sync-overview-primary"></div>
              <aside id="syncOverviewAside" class="sync-overview-aside">
                <div id="syncOverviewActiveMount"></div>
                <div class="card sync-quick-actions">
                  <div class="section-title">主要快捷操作</div>
                  <button type="button" class="secondary" id="copyPublisherCommandTopBtn">生成本机一键同步命令</button>
                  <button type="button" class="secondary" id="syncFocusPendingBtn">查看失败/待处理项</button>
                  <button type="button" class="secondary" data-sync-tab-jump="upload">转到上传与发布</button>
                  <button type="button" class="ghost" data-sync-tab-jump="versions">转到版本与回滚</button>
                </div>
              </aside>
            </div>
          </section>
          <section id="sync-panel-upload" class="sync-tab-panel" role="tabpanel" aria-labelledby="sync-tab-upload" hidden inert>
            <div id="syncUploadStack" class="sync-panel-stack"></div>
          </section>
          <section id="sync-panel-versions" class="sync-tab-panel" role="tabpanel" aria-labelledby="sync-tab-versions" hidden inert>
            <div id="syncVersionsStack" class="sync-panel-stack"></div>
          </section>
          <section id="sync-panel-operations" class="sync-tab-panel" role="tabpanel" aria-labelledby="sync-tab-operations" hidden inert>
            <div id="syncOperationsStack" class="sync-panel-stack"></div>
          </section>
        </div>

        <div id="syncTabPayload" hidden>
        <div class="sync-pipeline-shell" id="sync-pipeline-shell" aria-labelledby="syncPipelineTitle">
          <div class="sync-pipeline-summary">
            <div>
              <div class="section-kicker">发布链路</div>
              <h3 id="syncPipelineTitle">从候选数据到线上生效</h3>
            </div>
            <div class="sync-pipeline-current"><span>当前阶段</span><strong id="syncCurrentStageLabel">等待读取状态</strong></div>
          </div>
          <ol class="sync-pipeline-rail" id="syncPipelineRail">
            <li id="syncStageStaging" data-stage-state="pending"><span class="pipeline-index">01</span><div><strong>Staging 上传</strong><small>接收并校验候选数据</small></div></li>
            <li id="syncStageRelease" data-stage-state="pending"><span class="pipeline-index">02</span><div><strong>Release Pack 生成</strong><small>构建不可变发布包</small></div></li>
            <li id="syncStageStatic" data-stage-state="pending"><span class="pipeline-index">03</span><div><strong>OpenResty 静态目录同步</strong><small>复制完整静态资源</small></div></li>
            <li id="syncStageVerify" data-stage-state="pending"><span class="pipeline-index">04</span><div><strong>URL 验证</strong><small>检查关键公网资源</small></div></li>
            <li id="syncStageActive" data-stage-state="pending"><span class="pipeline-index">05</span><div><strong>Active Pointer 生效</strong><small>以运行时指针为准</small></div></li>
          </ol>
          <div class="sync-next-guidance"><span class="status-dot info"></span><span>建议下一步</span><strong id="syncNextStepText">正在分析同步状态…</strong></div>
        </div>

        <div class="sync-ops-section" id="sync-ops-console">
          <div class="sync-metric-strip" id="syncStatsGrid" aria-label="同步核心状态"></div>
        </div>

        <div class="sync-ops-section" id="sync-pending-panel">
          <div class="sync-section-heading">
            <div>
              <h3>待处理</h3>
              <p>只展示待审核、失败、发布受阻、重复上传和等待确认的项目。</p>
            </div>
            <span class="badge info" id="syncPendingBadge">等待读取</span>
          </div>
          <div class="sync-ops-card-grid" id="syncPendingCards">
            <div class="sync-compact-card"><strong>正在读取</strong><span>同步状态加载后显示待处理项。</span></div>
          </div>
        </div>

        <div class="sync-ops-section" id="sync-active-panel">
          <div class="sync-section-heading">
            <div>
              <h3>当前线上</h3>
              <p>仅显示 runtime pointer 指向的 active Release；Published 不等于 Active。</p>
            </div>
            <span class="badge info" id="syncRuntimeStateBadge">未生效</span>
          </div>
          <div id="syncActiveReleaseCards" class="sync-ops-card-grid">
            <div class="sync-compact-card"><strong>当前线上版本</strong><span>等待读取 active pointer。</span></div>
          </div>
          <details class="sync-technical-details sync-resource-details">
            <summary>资源规模</summary>
            <div id="syncActiveResourceContract" class="sync-resource-contract"></div>
          </details>
        </div>

        <div class="card" id="static-release-sync-panel" style="margin-bottom:16px;">
          <div class="section-title-row">
            <div class="section-title">OpenResty 静态同步</div>
            <div class="openresty-badges">
              <span class="badge info" id="openRestySyncBadge">同步状态</span>
              <span class="badge info" id="openRestyEnabledBadge" hidden>状态检测中</span>
              <span class="badge info" id="openRestyConfiguredBadge" hidden>配置检测中</span>
              <span class="badge info" id="openRestyDirBadge" hidden>目录检测中</span>
              <span class="badge info" id="openRestyVersionBadge" hidden>版本检测中</span>
              <span class="badge info" id="openRestyVerifyBadge" hidden>URL 验证</span>
            </div>
          </div>
          <div id="staticReleaseSyncSummary" class="openresty-card-grid">
            <!-- 静态同步状态 -->
          </div>
          <div id="staticSyncStateNote" class="static-sync-note">正在读取静态同步状态...</div>
          <div class="openresty-actions">
            <button type="button" class="secondary" id="copyStaticManifestBtn">复制 manifest URL</button>
            <button type="button" class="secondary" id="verifyStaticUrlBtn">验证静态 URL</button>
            <button type="button" class="secondary" id="manualStaticSyncBtn">手动同步当前 Release</button>
            <button type="button" class="ghost" id="forceStaticSyncBtn">强制重新同步</button>
            <button type="button" class="secondary" id="reconcileLifecycleBtn">重新核对状态</button>
            <button type="button" class="ghost" id="viewStaticSyncLogBtn">查看同步日志</button>
          </div>
          <div id="syncJobLog" class="job-progress-panel" hidden></div>
        </div>

        <div class="card" id="publisher-status-card" style="margin-bottom:16px;">
          <div class="section-title-row">
            <div class="section-title">发布链状态</div>
            <span class="badge info" id="publisherStatusBadge">等待本机回执</span>
          </div>
          <div id="publisherStatusGrid" class="openresty-meta-grid">
            <div class="openresty-meta-item"><span>本地采集</span><strong>等待运行 sync:publish</strong></div>
            <div class="openresty-meta-item"><span>Staging 上传</span><strong>-</strong></div>
            <div class="openresty-meta-item"><span>Oracle 发布</span><strong>-</strong></div>
            <div class="openresty-meta-item"><span>OpenResty</span><strong>-</strong></div>
            <div class="openresty-meta-item"><span>CloudBase</span><strong>-</strong></div>
            <div class="openresty-meta-item"><span>双源一致性</span><strong>-</strong></div>
          </div>
          <div class="openresty-actions">
            <button type="button" class="secondary" id="copyPublisherCommandBtn">生成本机一键同步命令</button>
            <button type="button" class="secondary" id="refreshPublisherStatusBtn">查看本机 Publisher 状态</button>
            <button type="button" class="secondary" id="copyCloudbaseRetryBtn">重试 CloudBase 镜像</button>
            <button type="button" class="ghost" id="copyCloudbaseExportBtn">导出人工上传包</button>
          </div>
          <div id="publisherReceiptNote" class="static-sync-note">后台只显示本机 Publisher 回执，不会直接访问 100 网；全校课表采集必须在校园网/VPN 本机执行。</div>
        </div>

        <div class="card" id="recommended-sync-flow-card" style="margin-bottom:16px;">
          <div class="section-title-row">
            <div class="section-title">推荐操作流程</div>
            <span class="badge info" id="syncNextActionBadge">等待状态</span>
          </div>
          <p class="sync-recommendation-copy" id="syncRecommendationText">正在根据当前状态生成建议。</p>
          <div class="sync-next-action-row">
            <button type="button" class="primary" id="syncNextActionBtn">复制采集命令</button>
          </div>
          <details class="sync-technical-details">
            <summary>技术详情</summary>
            <div class="mini-list">
              <div class="mini-list-row"><span>Active Hash</span><strong id="activeCanonicalHashText">-</strong></div>
              <div class="mini-list-row"><span>Staging Hash</span><strong id="stagingCanonicalHashText">-</strong></div>
              <div class="mini-list-row"><span>数据差异</span><strong id="stagingHashCompareText">等待 hash</strong></div>
              <div class="mini-list-row"><span>发布建议</span><strong id="stagingPublishNeedText">等待判断</strong></div>
            </div>
          </details>
        </div>

        <div class="card" id="runtime-storage-panel" style="margin-bottom:16px;">
          <div class="section-title-row">
            <div class="section-title">运行与存储</div>
            <span class="badge info" id="storageStatusBadge">状态检测中</span>
          </div>
          <div id="runtimeStorageSummary" class="runtime-metric-grid">
            <!-- runtime and storage status -->
          </div>
          <div class="openresty-actions">
            <button type="button" class="secondary" id="refreshStorageStatusBtn">刷新轻量状态</button>
            <button type="button" class="secondary" id="scanStorageBtn">运行存储扫描</button>
            <button type="button" class="secondary" id="previewMaintenanceBtn">预览安全清理</button>
            <button type="button" class="danger" id="runMaintenanceBtn">执行安全清理</button>
          </div>
        </div>

        <div class="sync-dashboard-grid">
          <div class="sync-main-col">
        <!-- 3. sync-primary-flow -->
        <div class="sync-primary-flow" id="sync-primary-flow">
          <!-- Step 1: 本机校园网同步 -->
          <div class="flow-card">
            <div class="flow-step">Step 1</div>
            <div class="flow-title">本机校园网同步</div>
            <div class="flow-content">
              <div class="flow-field"><strong>适用场景：</strong><span>管理员在已连接校园网的本机抓取课表数据并生成 Staging JSON。</span></div>
              <div class="flow-field"><strong>前置条件：</strong><span>本地电脑已接入佛大校园网（有线、无线或 VPN 拨号）。</span></div>
              <div class="flow-field"><strong>预计耗时：</strong><span>3 ~ 15 分钟（视网络情况与教务系统响应而定）。</span></div>
              <div class="flow-field"><strong>常见失败原因：</strong><span>未连校园网、学期填错、教务系统崩溃。</span></div>
              <div class="flow-cmd-section">
                <strong>管理员运行命令：</strong>
                <div class="code-preview flow-code-box">
                  <div class="code-preview-toolbar">
                    <span>PowerShell / 本机采集</span>
                    <button type="button" class="copy-flow-btn" id="flowCopyBtnLocal">复制全部命令</button>
                  </div>
                  <pre class="code-raw"><code id="flowCmdTextLocal">npm run sync:publish</code></pre>
                  <div class="code-preview-scroller"><div class="code-preview-lines"></div></div>
                </div>
                <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">（管理员本机使用，需要进入项目根目录并拥有源码与 Node.js 环境）</div>
              </div>
            </div>
          </div>

          <!-- Step 2: 上传 Staging / 接力代理端 -->
          <div class="flow-card">
            <div class="flow-step">Step 2</div>
            <div class="flow-title">上传 Staging / 接力同步</div>
            <div class="flow-content">
              <div class="flow-field"><strong>适用场景：</strong><span>将本机生成的 JSON 文件上传到后台进行校验，或由在校同学使用 Token 接力上传。</span></div>
              <div class="flow-field"><strong>前置条件：</strong><span>已生成 Staging JSON，或已在下方创建并派发接力任务 Token。</span></div>
              <div class="flow-field"><strong>预计耗时：</strong><span>上传及后台校验秒级完成。</span></div>
              <div class="flow-field"><strong>常见失败原因：</strong><span>JSON 字段缺失、Token 已过期或被吊销。</span></div>
              <div class="flow-cmd-section">
                <strong>接力同学运行命令：</strong>
                <div class="code-preview flow-code-box">
                  <div class="code-preview-toolbar">
                    <span>PowerShell / 接力同步</span>
                    <button type="button" class="copy-flow-btn" id="flowCopyBtnRelay">复制全部命令</button>
                  </div>
                  <pre class="code-raw"><code id="flowCmdTextRelay">npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=YOUR_TOKEN --term=2026-2027-1</code></pre>
                  <div class="code-preview-scroller"><div class="code-preview-lines"></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card" id="staging-cli-upload-panel">
          <h3 class="card-title">Staging JSON 上传 / CLI 上传</h3>
          <p style="font-size: 12px; color: var(--muted); margin-bottom: 12px;">
            主流程使用 CLI gzip 分片上传。网页上传保留为小文件测试和应急入口；全量 100MB+ 文件建议使用 CLI 上传，网页上传仅用于小文件测试。
          </p>
          <div class="staging-cli-panel">
            <div class="staging-cli-main">
              <div class="staging-status-strip">
                <div class="staging-status-pill"><strong>上传中</strong><span>CLI 显示 chunk 进度与速度</span></div>
                <div class="staging-status-pill"><strong>校验中</strong><span>服务端合并、解压、校验 hash/size/schema</span></div>
                <div class="staging-status-pill"><strong>等待发布</strong><span>pending-review，只能管理员发布</span></div>
                <div class="staging-status-pill"><strong>发布成功</strong><span>生成 release 索引并切换小程序数据</span></div>
              </div>
              <div class="code-preview command-code-box">
                <div class="code-preview-toolbar">
                  <span>PowerShell / CLI 上传</span>
                  <button type="button" id="quickCopyUploadCmdBtn">复制全部命令</button>
                </div>
                <pre class="code-raw"><code id="quickUploadCommand">请选择学期后自动生成上传命令</code></pre>
                <div class="code-preview-scroller"><div class="code-preview-lines"></div></div>
              </div>
              <div class="staging-upload-toolbar">
                <div class="staging-upload-filters">
                  <input type="text" id="stagingUploadTermFilter" placeholder="筛选学期">
                  <select id="stagingUploadStateFilter">
                    <option value="">全部状态</option>
                    <option value="pending-review">等待发布</option>
                    <option value="published">已发布</option>
                    <option value="active">Active</option>
                    <option value="failed">失败</option>
                    <option value="duplicate">重复</option>
                    <option value="incomplete">未完成</option>
                  </select>
                  <select id="stagingUploadPageSize">
                    <option value="25">25 条</option>
                    <option value="50" selected>50 条</option>
                    <option value="100">100 条</option>
                  </select>
                  <button type="button" class="secondary" id="refreshStagingUploadsBtn" style="padding: 6px 12px; font-size:12px;">刷新上传列表</button>
                  <button type="button" class="ghost" id="stagingUploadPrevPageBtn" style="padding: 6px 10px; font-size:12px;">上一页</button>
                  <button type="button" class="ghost" id="stagingUploadNextPageBtn" style="padding: 6px 10px; font-size:12px;">下一页</button>
                  <span id="stagingUploadPageInfo" style="font-size:12px;color:var(--muted);">第 1 页</span>
                </div>
                <div class="staging-upload-bulk-actions">
                  <button type="button" class="secondary" id="deleteSelectedStagingUploadsBtn" style="padding:6px 10px;font-size:12px;">删除所选</button>
                  <button type="button" class="secondary" id="purgeDuplicateStagingUploadsBtn" style="padding:6px 10px;font-size:12px;">清理重复项，只保留最新</button>
                  <button type="button" class="secondary" id="purgeFailedStagingUploadsBtn" style="padding:6px 10px;font-size:12px;">清理失败项</button>
                  <button type="button" class="secondary" id="purgeIncompleteStagingUploadsBtn" style="padding:6px 10px;font-size:12px;">清理未完成项</button>
                  <button type="button" class="ghost" id="previewExpiredStagingUploadsBtn" style="padding:6px 10px;font-size:12px;">清理过期项</button>
                  <button type="button" class="ghost" id="rebuildStagingUploadIndexBtn" style="padding:6px 10px;font-size:12px;">重建索引</button>
                </div>
              </div>
              <div class="static-sync-note">
                删除上传记录、删除 Staging 文件、删除 Release 是三类不同操作。Active、正在上传、正在校验、正在发布、当前 staging-latest 唯一来源会被保护。自动清理策略：duplicate &gt; 7 天、failed &gt; 7 天、incomplete &gt; 24 小时、superseded 原始大文件 &gt; 30 天；Active 和每学期最新 Published 永久保留。
              </div>
              <div class="table-container">
                <table class="staging-upload-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" id="stagingUploadSelectAll" aria-label="选择本页全部可删记录"></th>
                      <th>Staging 摘要</th>
                      <th>状态</th>
                      <th>记录数量</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="stagingUploadListBody">
                    <tr><td colspan="5" style="text-align:center;color:var(--muted);padding:12px 0;">暂无 CLI 上传记录</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="staging-cli-side">
              <div class="staging-inline-upload" id="quickUploadDropzone">
                <strong>小文件网页上传入口</strong>
                <p style="font-size:12px;color:var(--muted);margin:6px 0 10px;">适合 debug JSON 或小文件应急测试；185MB 全量包主流程请使用左侧 CLI gzip 分片上传。若仍使用网页入口，浏览器只按 Blob 分片上传，不会一次性 JSON.parse 大文件。</p>
                <input type="file" id="quickSyncFileInput" accept=".json,application/json" style="display:none;">
                <button type="button" class="secondary" id="quickSelectUploadFileBtn" style="padding:6px 10px;font-size:12px;">选择 Staging JSON</button>
                <div id="quickUploadFileInfo" style="font-size:12px;color:var(--muted);margin-top:10px;"></div>
              </div>
              <div class="staging-inline-upload" style="cursor: default;">
                <strong>网页上传失败时的处理</strong>
                <p style="font-size:12px;color:var(--muted);margin:6px 0 0;">常见原因是浏览器内存、反向代理 body 限制或网络中断。直接改用 CLI 分片上传，不需要调大单次 body 作为主方案。</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 5. staging-upload-panel (Stepper container) -->
        <div class="card" id="staging-upload-panel">
              <!-- 新版 6-Step 同步向导与指令生成器 -->
              <div class="wizard-stepper-container" style="position: relative;">
                
                <!-- Stepper Progress Indicator -->
                <div class="stepper-indicator">
                  <div style="position: absolute; top: 15px; left: 0; right: 0; height: 2px; background: var(--border); z-index: 1;"></div>
                  <div id="stepperProgressLine" style="position: absolute; top: 15px; left: 0; width: 0%; height: 2px; background: var(--primary); z-index: 2; transition: var(--transition);"></div>
                  
                  <div class="step-indicator-item active" data-step="1">
                    <div class="step-num">1</div>
                    <div class="step-label">学期/日期</div>
                  </div>
                  <div class="step-indicator-item" data-step="2">
                    <div class="step-num">2</div>
                    <div class="step-label">选择模式</div>
                  </div>
                  <div class="step-indicator-item" data-step="3">
                    <div class="step-num">3</div>
                    <div class="step-label">范围/年级</div>
                  </div>
                  <div class="step-indicator-item" data-step="4">
                    <div class="step-num">4</div>
                    <div class="step-label">生成指令</div>
                  </div>
                  <div class="step-indicator-item" data-step="5">
                    <div class="step-num">5</div>
                    <div class="step-label">上传Staging</div>
                  </div>
                  <div class="step-indicator-item" data-step="6">
                    <div class="step-num">6</div>
                    <div class="step-label">校验发布</div>
                  </div>
                </div>

                <!-- Stepper Content Body -->
                <div class="stepper-body" style="border-top: 1px solid var(--border); padding-top: 20px; margin-top: 20px;">
                  <form id="wizardForm" class="sync-wizard-form" onsubmit="return false;">
                    
                    <!-- Step 1: 选择学期与日期 -->
                    <div class="step-content active" id="step-content-1">
                      <h4 style="font-size: 13.5px; margin-bottom: 12px;">Step 1: 配置目标学期与开学日期</h4>
                      <div class="form-row">
                        <div>
                          <label for="wizardTerm">目标学期 (term)</label>
                          <div style="display: flex; gap: 8px; width: 100%;">
                            <select id="wizardTerm" style="flex: 1;"></select>
                            <input type="text" id="wizardTermCustom" placeholder="自定义学期" style="display: none; flex: 1;">
                          </div>
                        </div>
                        <div>
                          <label for="wizardStartDate">学期开始日期 (StartDate)</label>
                          <input type="date" id="wizardStartDate">
                        </div>
                      </div>
                      <div class="form-row">
                        <div>
                          <label for="wizardVersion">发布版本 (releaseVersion)</label>
                          <input type="text" id="wizardVersion" placeholder="自动生成或自定义" readonly>
                        </div>
                        <div>
                          <label for="wizardSource">数据来源 (source)</label>
                          <select id="wizardSource">
                            <option value="local-campus" selected>本机校园网采集 (local-campus)</option>
                            <option value="relay-agent">接力代理端 (relay-agent)</option>
                            <option value="staging-upload">手动 Staging JSON 上传 (staging-upload)</option>
                            <option value="manual-maintain">手动维护 (manual-maintain)</option>
                            <option value="server-direct">服务器直连兼容模式 (server-direct)</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-row full">
                        <div>
                          <label for="wizardNote">发布说明 (releaseNote)</label>
                          <input type="text" id="wizardNote" placeholder="例如: 2026-2027-1 新学期全校课表首版">
                        </div>
                      </div>
                    </div>

                    <!-- Step 2: 选择同步模式预设 -->
                    <div class="step-content" id="step-content-2">
                      <h4 style="font-size: 13.5px; margin-bottom: 12px;">Step 2: 选择数据同步预设模式</h4>
                      <div class="preset-card-grid">
                        <div class="preset-card active" id="preset-full">
                          <div class="preset-title">全量同步</div>
                          <div class="preset-desc">全部 scope，使用当前学期推导的 5 个活跃年级，适合正式全量候选版本。</div>
                          <div class="preset-tags">
                            <span class="preset-tag">全选</span>
                            <span class="preset-tag">活跃5个年级</span>
                            <span class="preset-tag">延时900ms</span>
                          </div>
                        </div>
                        <div class="preset-card" id="preset-force">
                          <div class="preset-title">只刷新教师课表</div>
                          <div class="preset-desc">仅同步 teacherSchedules 与 teachers，用于教师课表局部更新。</div>
                          <div class="preset-tags">
                            <span class="preset-tag">teacherSchedules</span>
                            <span class="preset-tag">teachers</span>
                          </div>
                        </div>
                        <div class="preset-card" id="preset-fast">
                          <div class="preset-title">新生同步</div>
                          <div class="preset-desc">只同步当前入学年行政班课表，适合新生数据先行验证。</div>
                          <div class="preset-tags">
                            <span class="preset-tag">仅抓新生年级</span>
                            <span class="preset-tag">行政班课表</span>
                          </div>
                        </div>
                        <div class="preset-card" id="preset-resources">
                          <div class="preset-title">轻量同步</div>
                          <div class="preset-desc">只同步 classSchedules、courses、classrooms，适合先生成轻量候选包。</div>
                          <div class="preset-tags">
                            <span class="preset-tag">classSchedules</span>
                            <span class="preset-tag">courses</span>
                            <span class="preset-tag">classrooms</span>
                          </div>
                        </div>
                        <div class="preset-card" id="preset-debug">
                          <div class="preset-title">只刷新教室占用</div>
                          <div class="preset-desc">仅同步 classroomSchedules 与 classrooms，用于教室占用修复。</div>
                          <div class="preset-tags">
                            <span class="preset-tag">classroomSchedules</span>
                            <span class="preset-tag">classrooms</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Step 3: 选择同步范围与过滤 -->
                    <div class="step-content" id="step-content-3">
                      <h4 style="font-size: 13.5px; margin-bottom: 12px;">Step 3: 自定义同步范围与过滤规则</h4>
                      <div style="margin-bottom: 16px;">
                        <label>同步数据模块范围</label>
                        <div class="sync-range-grid">
                          <label class="sync-range-item"><input type="checkbox" id="rangeClass" checked> 行政班课表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeTeacher" checked> 教师课表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeClassroom" checked> 教室课表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeCourse" checked> 课程课表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeClassroomList" checked> 教室列表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeTeacherList" checked> 教师列表</label>
                          <label class="sync-range-item"><input type="checkbox" id="rangeCourseList" checked> 课程列表</label>
                        </div>
                      </div>

                      <div class="form-row" style="margin-bottom: 12px;">
                        <div>
                          <label>年级筛选范围</label>
                          <select id="wizardGradesMode">
                            <option value="recommend" selected>自动推荐 (当前活跃 5 个年级)</option>
                            <option value="all">全部年级 (不限制)</option>
                            <option value="freshman">仅新生年级</option>
                            <option value="custom">自定义输入年级</option>
                          </select>
                        </div>
                        <div id="wizardGradesCustomRow" style="display: none;">
                          <label for="wizardGradesCustom">自定义年级 (逗号分隔)</label>
                          <input type="text" id="wizardGradesCustom" placeholder="例如: 2026,2025,2024">
                        </div>
                      </div>

                      <div class="form-row" id="wizardFiltersRow">
                        <div>
                          <label for="wizardCollegesFilter">精准筛选学院代码 (选填，多值逗号隔开)</label>
                          <input type="text" id="wizardCollegesFilter" placeholder="例如: 01,02">
                        </div>
                        <div>
                          <label for="wizardMajorsFilter">精准筛选专业代码 (选填，多值逗号隔开)</label>
                          <input type="text" id="wizardMajorsFilter" placeholder="例如: 080901,080902">
                        </div>
                      </div>

                      <div class="form-row">
                        <div>
                          <label for="wizardConcurrency">单线程并发数 (concurrency)</label>
                          <select id="wizardConcurrency">
                            <option value="1" selected>1 (推荐安全并发)</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="5">5 (高风险)</option>
                          </select>
                        </div>
                        <div>
                          <label for="wizardDelay">请求间隔延迟毫秒数 (delay)</label>
                          <input type="number" id="wizardDelay" value="900" min="0" step="100">
                        </div>
                      </div>
                      <label class="sync-range-item" style="margin-top: 12px;">
                        <input type="checkbox" id="wizardForceRefresh"> 强制全量刷新，忽略 progress 与无排课缓存
                      </label>
                    </div>

                    <!-- Step 4: 生成命令 -->
                    <div class="step-content" id="step-content-4">
                      <h4 style="font-size: 13.5px; margin-bottom: 8px;">Step 4: 推荐运行的同步命令</h4>
                      
                      <label>目标操作系统 Shell 终端</label>
                      <div class="segmented-control">
                        <button type="button" class="active" id="shell-powershell">PowerShell (Windows)</button>
                        <button type="button" id="shell-cmd">CMD (Windows)</button>
                        <button type="button" id="shell-bash">Bash (macOS/Linux)</button>
                      </div>

                      <div class="wizard-command-preview" style="margin-top: 12px;">
                        <div class="command-code-box" style="margin-top: 4px;">
                          <pre><code id="wizardCommandCode">加载中...</code></pre>
                        </div>
                      </div>

                      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; flex-wrap: wrap;">
                        <button type="button" class="secondary" id="wizardCopyBtn" style="padding: 6px 12px; font-size:12px;">复制当前命令</button>
                        <button type="button" class="secondary" id="downloadCmdBtn" style="padding: 6px 12px; font-size:12px;">下载 run-sync.cmd</button>
                        <button type="button" class="secondary" id="downloadPs1Btn" style="padding: 6px 12px; font-size:12px;">下载 run-sync.ps1</button>
                      </div>
                    </div>

                    <!-- Step 5: 上传 Staging -->
                    <div class="step-content" id="step-content-5">
                      <h4 style="font-size: 13.5px; margin-bottom: 12px;">Step 5: 上传生成的 Staging JSON 文件</h4>
                      <p style="font-size: 12px; color: var(--muted); margin-bottom: 12px;">
                        请在您的本地校园网终端执行上述 Step 4 生成的脚本。执行完毕后，在项目根目录的 <code>staging/</code> 目录下会产生 <code>[学期]-full.json</code> 文件。请将该文件拖入或上传到下方。
                        网页上传只作为小文件/调试入口；全量 100MB+ JSON 的主流程是 CLI gzip chunk 上传。
                      </p>
                      
                      <div style="border: 2px dashed var(--border); border-radius: var(--radius); padding: 30px 20px; text-align: center; font-size: 13px; cursor: pointer; transition: var(--transition); background: var(--panel-2);" id="uploadDropzone" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                        <p style="color: var(--muted); margin-bottom: 10px; font-weight: 600;">点击或拖拽本地生成的 Staging JSON 文件至此</p>
                        <input type="file" id="syncFileInput" style="display: none;" accept=".json">
                        <button type="button" class="secondary" id="syncSelectFileBtn">选择 JSON 文件</button>
                        <div id="uploadFileInfo" style="margin-top: 10px; font-weight: 600; color: var(--primary);"></div>
                      </div>
                    </div>

                    <!-- Step 6: 校验并发布 -->
                    <div class="step-content" id="step-content-6">
                      <h4 style="font-size: 13.5px; margin-bottom: 12px;">Step 6: 比对预览及发布确认</h4>
                      
                      <div id="stagingEmptyState" style="text-align: center; padding: 20px; color: var(--muted); font-size: 13px;">
                        请先在 Step 5 中上传 Staging JSON，系统将自动加载详细的数据比对和发布选项。
                      </div>

                      <!-- Staging 预览比对容器 -->
                      <div id="stagingPreviewBox" style="display: none;">
                        <div class="staging-preview-container">
                          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
                            <strong style="font-size: 14px; color: var(--text);">上传的 Staging 数据预览</strong>
                            <span class="badge info" id="stagingMetaBadge">学期: - | 版本: -</span>
                          </div>

                          <!-- 资源统计与差异 -->
                          <div class="staging-grid">
                            <div class="staging-item">
                              <div class="staging-item-title">行政班课表</div>
                              <div class="staging-item-value" id="stagingValClass">0</div>
                              <div class="staging-item-diff" id="stagingDiffClass">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">教师课表</div>
                              <div class="staging-item-value" id="stagingValTeacher">0</div>
                              <div class="staging-item-diff" id="stagingDiffTeacher">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">教室课表</div>
                              <div class="staging-item-value" id="stagingValClassroom">0</div>
                              <div class="staging-item-diff" id="stagingDiffClassroom">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">课程课表</div>
                              <div class="staging-item-value" id="stagingValCourse">0</div>
                              <div class="staging-item-diff" id="stagingDiffCourse">-</div>
                            </div>
                          </div>

                          <div class="staging-grid">
                            <div class="staging-item">
                              <div class="staging-item-title">教室总数</div>
                              <div class="staging-item-value" id="stagingValRoomCount">0</div>
                              <div class="staging-item-diff" id="stagingDiffRoomCount">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">教师总数</div>
                              <div class="staging-item-value" id="stagingValTeacherCount">0</div>
                              <div class="staging-item-diff" id="stagingDiffTeacherCount">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">课程总数</div>
                              <div class="staging-item-value" id="stagingValCourseCount">0</div>
                              <div class="staging-item-diff" id="stagingDiffCourseCount">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">学院 / 年级</div>
                              <div class="staging-item-value" id="stagingValCollegeGradeCount">0 / 0</div>
                              <div class="staging-item-diff">元数据</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">历史缓存</div>
                              <div class="staging-item-value" id="stagingValCacheUsed">否</div>
                              <div class="staging-item-diff" id="stagingCacheSource">-</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">强制刷新</div>
                              <div class="staging-item-value" id="stagingValForceRefresh">否</div>
                              <div class="staging-item-diff">运行参数</div>
                            </div>
                            <div class="staging-item">
                              <div class="staging-item-title">允许发布</div>
                              <div class="staging-item-value" id="stagingValAllowPublish">待校验</div>
                              <div class="staging-item-diff" id="stagingPublishGate">-</div>
                            </div>
                          </div>

                          <!-- 校验 Warning 列表 -->
                          <div id="stagingWarningsBox" class="warnings-list" style="display: none;">
                            <strong>数据合规性校验警告:</strong>
                            <div id="stagingWarningsList"></div>
                          </div>

                          <!-- 详细班级 Diff 列表 -->
                          <div>
                            <strong style="font-size: 12px; color: var(--text);">行政班级变动明细：</strong>
                            <div class="diff-classes-list" id="stagingDiffClassesList">
                              暂无变动。
                            </div>
                          </div>

                          <!-- 变动熔断与二次强确认发布控制 -->
                          <div style="border-top: 1px solid var(--border); padding-top: 14px; display: flex; flex-direction: column; gap: 10px;">
                          <div id="forceConfirmContainer" style="display: none; background: var(--danger-soft); border: 1px solid var(--danger); padding: 12px; border-radius: 8px; font-size: 12px; color: var(--danger);">
                              <strong>警报: 数据变动幅度超过熔断阈值(30%)!</strong>
                              <p style="margin-top: 4px; margin-bottom: 8px;">本次同步的行政班/课表记录变动量较大，为防止误清空线上数据，直接发布已被拦截。若确属新学期全量重构，请在下方手动勾选确认后强行发布。</p>
                              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--danger); font-weight: 700; margin-bottom:0;">
                                <input type="checkbox" id="stagingForceConfirm"> 我已知晓风险，确认本次数据变动为正常新学期更迭，强行发布
                              </label>
                            </div>

                            <div style="display: flex; justify-content: flex-end; gap: 12px; align-items: center;">
                              <span id="publishStatusText" style="font-size:12px; color:var(--muted);"></span>
                              <button type="button" class="secondary" id="postPublishVerifyBtn" style="padding: 10px 16px;">发布后验证 job</button>
                              <button type="button" class="secondary" id="stagingPublishBtn" style="padding: 10px 20px;">发布为正式版本</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  </form>
                </div>

                <!-- Stepper Actions Navigation -->
                <div class="stepper-actions">
                  <button type="button" class="ghost" id="stepperPrevBtn" disabled>上一步</button>
                  <button type="button" class="secondary" id="stepperNextBtn">下一步</button>
                </div>
              </div>
            </div>


            <!-- 6. relay-task-panel -->
            <div class="card" id="relay-task-panel">
              <h3 class="card-title">接力任务管理</h3>
              <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">
                接力任务适合把采集任务临时交给在校同学。对方只获得一次性 relay token，只能读取任务并上传候选 Staging JSON，不能登录后台、不能发布课表、不能查看管理员配置。
              </p>
              <div class="relay-task-grid">
                <div>
                  <label>目标学期</label>
                  <div style="display: flex; gap: 8px; width: 100%;">
                    <select id="relayTaskTerm" style="flex: 1;"></select>
                    <input type="text" id="relayTaskTermCustom" placeholder="自定义学期" style="display: none; flex: 1;">
                  </div>
                </div>
                <div>
                  <label>有效期</label>
                  <select id="relayTaskExpiresIn">
                    <option value="24">24 小时</option>
                    <option value="168">7 天</option>
                  </select>
                </div>
                <div>
                  <label>最大上传次数</label>
                  <input id="relayTaskMaxUploads" type="number" min="1" max="20" value="1">
                </div>
                <div>
                  <label>任务说明</label>
                  <input id="relayTaskDescription" placeholder="全校课表接力采集">
                </div>
              </div>
              <div style="display:flex; justify-content:flex-end; margin-top: 12px;">
                <button type="button" class="secondary" id="createRelayTaskBtn">创建接力任务</button>
              </div>
              <div class="table-container" style="margin-top: 14px;">
                <table class="relay-table">
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>Token / 命令</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="relayTaskTableBody">
                    <tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px;">暂无接力任务</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="table-container" style="margin-top: 14px;">
                <table class="relay-table">
                  <thead>
                    <tr>
                      <th>上传记录</th>
                      <th>摘要</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody id="relayUploadTableBody">
                    <tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px;">暂无接力上传</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 右栏：辅助信息区 -->
          <div class="sync-side-col">
            <!-- 4. sync-command-accordion -->
            <div class="card" id="sync-command-accordion">
              <h3 class="card-title">同步运维命令手册</h3>
              <div id="syncCommands" class="command-card-list">
                <!-- 动态命令列表 (折叠手风琴) -->
              </div>
            </div>

            <!-- 9. api-health-panel -->
            <div class="card" id="api-health-panel">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h3 class="card-title" style="margin-bottom: 0;">API 健康状态检测</h3>
                <button class="secondary" id="recheckHealthBtn" style="padding: 4px 10px; font-size: 12px;">一键测试</button>
              </div>
              <div id="healthGrid" class="health-grid sync-health-empty">
                <div class="sync-empty-inline">尚未检测；运行后在此展开结果。</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部通栏或双栏自适应布局 -->
        <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr; gap: 12px;">
          <div class="card release-history-wide" id="release-history-panel">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
              <div>
                <h3 class="card-title" style="margin-bottom:4px;">Release 历史</h3>
                <p style="font-size:12px;color:var(--muted);margin:0;">最近 5 个发布快照，支持查看当前状态、回滚和下载摘要。</p>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <label for="releaseTermFilter" style="margin-bottom:0;white-space:nowrap;font-size:12px;font-weight:600;color:var(--muted);">筛选学期：</label>
                <select id="releaseTermFilter" style="width:auto;padding:4px 10px;font-size:12px;height:32px;"></select>
              </div>
            </div>
            <div class="table-container">
                <div id="releasesTableBody" class="release-strip">
                  <div class="release-empty">获取 Release 历史中...</div>
                </div>
            </div>
          </div>
          <!-- 8. sync-log-panel -->
          <div class="card" id="sync-log-panel">
            <h3 class="card-title">最近同步历史日志</h3>
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
        </div>
        </div>
      </section>

      <!-- 面板四：数据质量 Data Quality -->
      <section id="section-terms" class="section">
        <div class="card form-box">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <h3 class="card-title" style="margin-bottom:4px;">学期管理</h3>
              <div style="color:var(--muted);font-size:12px;">创建、绑定、检查、激活和归档学期。激活前必须通过 readiness 检查。</div>
            </div>
            <button id="refreshTermsBtn" class="ghost" type="button">刷新</button>
          </div>
          <div class="form-row">
            <div>
              <label>term</label>
              <input id="termCreateId" placeholder="2026-2027-1">
            </div>
            <div>
              <label>semesterText</label>
              <input id="termCreateText" placeholder="留空自动生成">
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>termStartDate</label>
              <input id="termCreateStart" placeholder="YYYY-MM-DD">
            </div>
            <div>
              <label>totalWeeks</label>
              <input id="termCreateWeeks" type="number" min="1" max="30" value="20">
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>weekStart</label>
              <select id="termCreateWeekStart">
                <option value="monday">monday</option>
                <option value="sunday">sunday</option>
              </select>
            </div>
            <div style="display:flex;align-items:flex-end;">
              <button id="createTermBtn" class="primary" type="button">创建 planned 学期</button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div style="overflow-x:auto;">
            <table>
              <thead>
                <tr>
                  <th>学期</th>
                  <th>名称</th>
                  <th>状态</th>
                  <th>开学日期</th>
                  <th>周数</th>
                  <th>数据</th>
                  <th>Release</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="termsTableBody"></tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <h3 class="card-title">发布前检查</h3>
          <div class="form-row">
            <div>
              <label>目标学期</label>
              <input id="termReadinessId" placeholder="2026-2027-1">
            </div>
            <div>
              <label>Release Version</label>
              <input id="termReadinessRelease" placeholder="已有健康 releaseVersion">
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
            <button id="checkTermReadinessBtn" class="secondary" type="button">运行检查</button>
            <button id="repairCurrentTermReleaseBtn" class="primary" type="button" hidden>修复并重建当前学期 Release</button>
            <button id="rebuildRuntimePointerBtn" class="ghost" type="button">重建 Runtime Pointer</button>
            <button id="bindTermReleaseBtn" class="ghost" type="button">绑定 Release</button>
            <button id="activateTermBtn" class="danger" type="button">激活为当前学期</button>
          </div>
          <div id="termReadinessSummary" class="readiness-summary"></div>
          <div id="termRepairJobLog" class="job-progress-panel" hidden></div>
          <div id="termReadinessChecks" class="readiness-groups"></div>
          <pre id="termReadinessOutput" style="margin-top:12px;background:#0f172a;color:#d1e7ff;border-radius:8px;padding:12px;white-space:pre-wrap;max-height:320px;overflow:auto;">等待检查</pre>
        </div>
      </section>

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
                <span>Wi-Fi</span>
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
                <span>Wi-Fi</span>
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
              <label>当前学期 (YYYY-YYYY-1/2)</label>
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

      <!-- 面板八：查询服务配置 -->
      <section id="section-ai-provider" class="section">
        <div class="provider-console provider-static-landing">
          <div class="provider-hero provider-status-hero">
            <div>
              <h3>小佛助手 Provider 控制台</h3>
              <p>当前小程序实际使用 = <strong>正式版本地规则</strong></p>
            </div>
          </div>
          <div class="provider-mode-grid">
            <section class="provider-mode-card">
              <div class="provider-card-title">正式版 / 公开发布</div>
              <div class="ai-secret-note">本地规则 + 已发布知识库 + 已有工具卡片。</div>
              <button class="primary" type="button">启用正式版本地规则</button>
            </section>
            <section class="provider-mode-card">
              <div class="provider-card-title">体验版 / 开发调试</div>
              <div class="ai-secret-note">开启后选择混元、deepseek 或 coze。</div>
              <button class="secondary" type="button">保存并立即生效</button>
            </section>
          </div>
        </div>
      </section>

      <section id="section-assistant-kb" class="section">
        <div id="assistantKbConsole" class="kb-console"></div>
      </section>

      <section id="section-campus-map" class="section">
        <div class="campus-map-stack">
          <div class="card form-box">
            <h3 class="card-title">底图管理</h3>
            <div class="campus-map-toolbar">
              <select id="campusMapAssetSelect" aria-label="选择底图区域">
                <option value="xianxiNorth">仙溪北区</option>
                <option value="xianxiSouth">仙溪南区</option>
                <option value="jiangwan">江湾</option>
                <option value="hebin">河滨</option>
              </select>
              <button id="campusMapUploadBtn" class="secondary">上传 / 替换</button>
              <button id="campusMapPreviewAssetBtn" class="ghost">预览</button>
              <button id="campusMapDownloadAssetBtn" class="ghost">下载</button>
              <button id="campusMapRepairAssetBtn" class="ghost">修复底图</button>
              <button id="campusMapRefreshHealthBtn" class="ghost">刷新健康状态</button>
              <input id="campusMapAssetFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            </div>
            <div id="campusMapAssetGrid" class="campus-map-asset-grid"></div>
            <div class="campus-map-actions">
              <select id="campusMapAssetHistorySelect" aria-label="历史底图版本"></select>
              <button id="campusMapRestoreAssetBtn" class="secondary">恢复历史版本</button>
            </div>
            <div id="campusMapAssetHealth" class="campus-map-health-grid"></div>
          </div>

          <div class="campus-map-calibration-grid">
            <div class="card form-box">
              <h3 class="card-title">地点校对</h3>
              <div class="campus-map-toolbar">
                <select id="campusMapCampus">
                  <option value="">全部校区</option>
                  <option value="仙溪校区">仙溪校区</option>
                  <option value="江湾校区">江湾校区</option>
                  <option value="河滨校区">河滨校区</option>
                </select>
                <select id="campusMapArea">
                  <option value="">全部区域</option>
                  <option value="北区">北区</option>
                  <option value="南区">南区</option>
                  <option value="江湾校区">江湾校区</option>
                  <option value="河滨校区">河滨校区</option>
                </select>
                <select id="campusMapReviewFilter">
                  <option value="">全部状态</option>
                  <option value="verified">已核对</option>
                  <option value="pending">待核对</option>
                </select>
                <select id="campusMapTypeFilter">
                  <option value="">全部类型</option>
                  <option value="teaching_building">教学楼</option>
                  <option value="library">图书馆</option>
                  <option value="canteen">饭堂</option>
                  <option value="campus">校区</option>
                  <option value="area">区域</option>
                  <option value="place">地点</option>
                </select>
                <input id="campusMapSearch" placeholder="搜索名称、代码、别名">
              </div>
              <div class="campus-map-actions">
                <button id="campusMapAddBtn" class="secondary">新增地点</button>
                <button id="campusMapDuplicateBtn" class="ghost">复制地点</button>
                <button id="campusMapDeleteBtn" class="ghost">删除地点</button>
                <button id="campusMapMarkVerifiedBtn" class="ghost">批量标记已核对</button>
                <button id="campusMapMarkPendingBtn" class="ghost">批量标记待核对</button>
                <button id="campusMapUndoBtn" class="ghost">撤销</button>
                <button id="campusMapRedoBtn" class="ghost">重做</button>
              </div>
              <div id="campusMapPlaceList" class="campus-map-list"></div>
              <div class="ai-secret-note">公众页面只显示搜索结果和对应校区地图，不再显示精确定位框。</div>
            </div>

            <div class="card form-box">
              <h3 class="card-title">地图框选</h3>
              <div id="campusMapEditor" class="campus-map-editor">
                <img id="campusMapAdminImage" alt="校园地图底图">
                <div id="campusMapRect" class="campus-map-rect" hidden>
                  <span class="campus-map-handle" data-handle="nw"></span>
                  <span class="campus-map-handle" data-handle="n"></span>
                  <span class="campus-map-handle" data-handle="ne"></span>
                  <span class="campus-map-handle" data-handle="e"></span>
                  <span class="campus-map-handle" data-handle="se"></span>
                  <span class="campus-map-handle" data-handle="s"></span>
                  <span class="campus-map-handle" data-handle="sw"></span>
                  <span class="campus-map-handle" data-handle="w"></span>
                </div>
              </div>
              <div id="campusMapImageError" class="campus-map-image-error" hidden></div>
              <div class="campus-map-editor-help">点击地图创建矩形；拖动矩形移动；拖动四角或边缘缩放。坐标保存为 0～1。</div>
            </div>

            <div class="card form-box">
              <h3 class="card-title">地点属性</h3>
              <div class="form-row">
                <div>
                  <label>名称</label>
                  <input id="campusMapName" placeholder="例如 C7 医学教学楼">
                </div>
                <div>
                  <label>代码</label>
                  <input id="campusMapCode" placeholder="例如 C7">
                </div>
              </div>
              <div class="form-row">
                <div>
                  <label>校区</label>
                  <select id="campusMapEditCampus">
                    <option value="仙溪校区">仙溪校区</option>
                    <option value="江湾校区">江湾校区</option>
                    <option value="河滨校区">河滨校区</option>
                  </select>
                </div>
                <div>
                  <label>区域</label>
                  <select id="campusMapEditArea">
                    <option value="北区">北区</option>
                    <option value="南区">南区</option>
                    <option value="江湾校区">江湾校区</option>
                    <option value="河滨校区">河滨校区</option>
                  </select>
                </div>
              </div>
              <div class="form-row full">
                <div>
                  <label>别名（逗号分隔）</label>
                  <input id="campusMapAliases" placeholder="C7,C7楼,C7教学楼">
                </div>
              </div>
              <div class="form-row full">
                <div>
                  <label>说明</label>
                  <textarea id="campusMapDescription" placeholder="给用户看的地点说明"></textarea>
                </div>
              </div>
              <div class="form-row">
                <div>
                  <label>核对状态</label>
                  <select id="campusMapVerified">
                    <option value="false">待核对</option>
                    <option value="true">已人工核对</option>
                  </select>
                </div>
                <div>
                  <label>类型</label>
                  <select id="campusMapType">
                    <option value="teaching_building">教学楼</option>
                    <option value="library">图书馆</option>
                    <option value="canteen">饭堂</option>
                    <option value="campus">校区</option>
                    <option value="area">区域</option>
                    <option value="place">地点</option>
                  </select>
                </div>
              </div>
              <div class="campus-map-actions">
                <button id="campusMapSaveDraftBtn" class="primary">保存草稿</button>
                <button id="campusMapCancelBtn" class="ghost">取消修改</button>
                <button id="campusMapExportBtn" class="ghost">导出</button>
              </div>
            </div>
          </div>

          <div class="card form-box">
            <h3 class="card-title">发布管理</h3>
            <div id="campusMapCurrentStatus" class="campus-map-status-grid"></div>
            <h4 class="card-title">差异预览</h4>
            <div id="campusMapDiffPreview" class="ai-verify-box">尚未生成发布差异。</div>
            <h4 class="card-title">操作区</h4>
            <div class="campus-map-actions">
              <button id="campusMapSaveDraftOpsBtn" class="primary">保存草稿</button>
              <button id="campusMapValidateBtn" class="ghost">校验草稿</button>
              <button id="campusMapDiffBtn" class="secondary" type="button">生成差异预览</button>
              <button id="campusMapRepairDraftBtn" class="ghost">自动修复可修复问题</button>
              <button id="campusMapPublishBtn" class="secondary">一键发布</button>
              <button id="campusMapPublishOracleOnlyBtn" class="ghost">发布 Oracle-only 可用版本</button>
              <button id="campusMapVerifyPublishedBtn" class="ghost">重新验证线上版本</button>
              <button id="campusMapBackupBtn" class="ghost">备份</button>
              <select id="campusMapRollbackSelect"></select>
              <button id="campusMapRollbackBtn" class="ghost">回滚上一版</button>
            </div>
            <div class="form-row full">
              <div>
                <label>导入 JSON</label>
                <div class="campus-map-actions" style="margin-bottom:8px;">
                  <select id="campusMapImportPreset">
                    <option value="full-replace">导入地点和底图引用 · 覆盖当前草稿</option>
                    <option value="places-replace">仅导入地点 · 覆盖当前草稿</option>
                    <option value="full-merge">导入地点和底图引用 · 合并到当前草稿</option>
                    <option value="places-merge">仅导入地点 · 合并到当前草稿</option>
                  </select>
                  <button id="campusMapImportFileBtn" class="ghost" type="button">选择 JSON 文件</button>
                  <input id="campusMapImportFile" type="file" accept="application/json,.json" hidden>
                </div>
                <textarea id="campusMapImportJson" class="campus-map-json" placeholder="粘贴 campus map JSON 后点击导入"></textarea>
              </div>
            </div>
            <div class="campus-map-actions">
              <button id="campusMapImportBtn" class="secondary">导入 JSON 到草稿</button>
            </div>
            <details class="campus-map-advanced-log">
              <summary>高级日志</summary>
              <pre id="campusMapAdvancedLog">尚无日志。</pre>
            </details>
            <div id="campusMapStatus" class="ai-verify-box">尚未加载校园地图数据。</div>
          </div>
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
              <input id="feedbackSearch" placeholder="关键词检索内容/班级/页面">
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>反馈详情内容</th>
                  <th>来源页面</th>
                  <th>处理状态</th>
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

      <section id="section-security" class="section">
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-head">Security Mode<span>MODE</span></div>
            <div class="stat-num" id="securityModeValue">-</div>
            <div class="stat-foot" id="securityModeFoot">-</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">动态 API<span>API</span></div>
            <div class="stat-num" id="securityDynamicValue">-</div>
            <div class="stat-foot">X-Fosu-Session</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">静态 Release<span>STATIC</span></div>
            <div class="stat-num" id="securityStaticValue">-</div>
            <div class="stat-foot">X-Fosu-Static-Ticket</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">限速键数<span>RATE</span></div>
            <div class="stat-num" id="securityRateKeysValue">0</div>
            <div class="stat-foot" id="securityRateKeysFoot">-</div>
          </div>
        </div>
        <div class="dash-columns">
          <div class="card" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <h3 class="card-title" style="margin-bottom:0;">安全配置</h3>
              <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                <button id="runSecuritySelfCheckBtn" class="secondary">运行安全自检</button>
                <button id="exportSecurityReportBtn" class="ghost">导出脱敏报告</button>
                <button id="cleanupSecurityStatsBtn" class="ghost">清理过期统计</button>
              </div>
            </div>
            <div class="health-grid" id="securityConfigGrid"></div>
            <div id="securityWarnings" class="health-item" style="align-items:flex-start; white-space:normal;"></div>
          </div>
          <div class="card" style="display: flex; flex-direction: column; gap: 12px;">
            <h3 class="card-title">最近 24 小时</h3>
            <div class="health-grid" id="securityEventGrid"></div>
            <div class="table-container" style="max-height: 360px; overflow-y: auto;">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>路由</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody id="securityEventsTable"></tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- 面板九：系统设置 System Settings -->
      <section id="section-settings" class="section">
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-head">系统安全状态<span class="status-dot info"></span></div>
            <div class="stat-num" id="settingsSecurityStatus">未检测</div>
            <div class="stat-foot">管理员验证状态</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">历史备份数<span class="status-dot info"></span></div>
            <div class="stat-num" id="settingsBackupCount">0 个</div>
            <div class="stat-foot">server/data/backups/</div>
          </div>
          <div class="card stat-card">
            <div class="stat-head">Audit Log 条数<span class="status-dot info"></span></div>
            <div class="stat-num" id="settingsAuditLogCount">0 条</div>
            <div class="stat-foot">管理端操作审计日志</div>
          </div>
        </div>

        <div class="dash-columns">
          <div class="card" style="display: flex; flex-direction: column; gap: 12px;">
            <h3 class="card-title">后台快捷操作</h3>
            <button id="copyAppConfigUrlBtn" class="secondary">复制当前 app-config 接口地址</button>
            <button id="copyPublicConfigJsonBtn" class="secondary">复制公开配置 JSON</button>
            <button id="clearAdminCacheBtn" class="ghost">清理本地后台缓存</button>
          </div>
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
  <div class="drawer-mask" id="feedbackDrawerMask" aria-hidden="true"></div>
  <div class="drawer" id="feedbackDrawer" role="dialog" aria-modal="true" aria-labelledby="feedbackDrawerTitle" aria-hidden="true" tabindex="-1" inert>
    <div class="drawer-header">
      <h3 id="feedbackDrawerTitle">用户反馈详情与备注处理</h3>
      <button class="drawer-close" id="closeFeedbackDrawerBtn" type="button" aria-label="关闭反馈详情抽屉">&times;</button>
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
        <div><span style="color: var(--muted); font-weight: 600;">当前学期:</span> <span id="drawFbSemester">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">数据版本:</span> <span id="drawFbDataVersion">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">应用版本:</span> <span id="drawFbAppVersion">-</span></div>
        <div><span style="color: var(--muted); font-weight: 600;">系统环境:</span> <span id="drawFbPlatform">-</span></div>
      </div>

      <div id="drawFbClassBlock" style="display: none;">
        <label>关联排课班级/课程</label>
        <div id="drawFbClass" style="padding: 8px 12px; background: var(--success-soft); border-radius: 6px; font-size: 12px; color: var(--success); font-weight: 600;">-</div>
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
        <textarea id="drawFbAdminNote" placeholder="在此记录问题排查过程、处理方式或复核结论。"></textarea>
      </div>
    </div>
    <div class="drawer-footer">
      <button class="ghost" id="cancelFbDrawerBtn">取消</button>
      <button class="primary" id="saveFbDrawerBtn">保存备注及状态</button>
    </div>
  </div>

  <!-- 数据资源中心详情 Drawer -->
  <div class="drawer-mask" id="catalogDrawerMask" aria-hidden="true"></div>
  <div class="drawer" id="catalogDrawer" role="dialog" aria-modal="true" aria-labelledby="catalogDrawerTitle" aria-hidden="true" tabindex="-1" inert style="max-width: 640px;">
    <div class="drawer-header">
      <h3 id="catalogDrawerTitle">资源详情</h3>
      <button class="drawer-close" id="closeCatalogDrawerBtn" type="button" aria-label="关闭数据详情抽屉">&times;</button>
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
    function escapeHtml(str) {
      if (str === undefined || str === null) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function showBootFatal(error) {
      var root = document.body;
      if (!root) return;
      
      var errMsg = "";
      var filename = "";
      var lineno = "";
      var colno = "";
      var stack = "";
      
      if (error && typeof error === "object") {
        errMsg = error.message || error.msg || String(error);
        filename = error.filename || error.source || "";
        lineno = error.lineno != null ? error.lineno : "";
        colno = error.colno != null ? error.colno : "";
        stack = error.stack || "";
      } else {
        errMsg = String(error || "未知致命错误");
      }
      
      var errDetail = "错误信息: " + errMsg + "\\n";
      if (filename) errDetail += "文件: " + filename + "\\n";
      if (lineno) errDetail += "行号: " + lineno + "\\n";
      if (colno) errDetail += "列号: " + colno + "\\n";
      if (stack) errDetail += "堆栈信息:\\n" + stack;
      
      root.innerHTML =
        "<div style='display:flex; align-items:center; justify-content:center; min-height:100vh; background:var(--page-bg); font-family:system-ui,-apple-system,sans-serif; padding:20px; box-sizing:border-box; color:var(--text-primary);'>" +
          "<div style='max-width:560px; width:100%; background:var(--surface-raised); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow-lg); padding:32px; box-sizing:border-box;'>" +
            "<div style='display:flex; align-items:center; gap:12px; margin-bottom:20px;'>" +
              "<div style='background:var(--danger-soft); color:var(--danger); width:48px; height:48px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:bold;'>!</div>" +
              "<h1 style='font-size:22px; font-weight:700; color:var(--text-primary); margin:0;'>后台启动失败</h1>" +
            "</div>" +
            "<p style='font-size:14px; color:var(--text-muted); margin-bottom:16px; line-height:1.6;'>后台页面 JavaScript 初始化时发生致命异常。这通常是由于网络传输错误或脚本解析失败导致的。</p>" +
            
            "<div style='background:var(--surface-muted); border-radius:8px; padding:16px; margin-bottom:24px; box-sizing:border-box;'>" +
              "<div style='font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:8px;'>错误详情：</div>" +
              "<div style='font-size:12px; color:var(--text-primary); margin-bottom:4px;'><strong>Message:</strong> " + escapeHtml(errMsg) + "</div>" +
              (filename ? "<div style='font-size:12px; color:var(--text-primary); margin-bottom:4px;'><strong>File:</strong> " + escapeHtml(filename) + "</div>" : "") +
              (lineno ? "<div style='font-size:12px; color:var(--text-primary); margin-bottom:4px;'><strong>Line:</strong> " + escapeHtml(lineno) + " (Col: " + escapeHtml(colno) + ")</div>" : "") +
              (stack ? "<pre style='white-space:pre-wrap; word-break:break-all; font-family:monospace; font-size:11px; color:var(--text-muted); margin-top:8px; border-top:1px solid var(--border); padding-top:8px; max-height:180px; overflow-y:auto;'>" + escapeHtml(stack) + "</pre>" : "") +
            "</div>" +
            
            "<div style='display:flex; gap:12px; flex-wrap:wrap;'>" +
              "<button id='copyErrBtn' style='background:var(--primary-soft); color:var(--primary); border:none; padding:10px 18px; font-size:14px; font-weight:600; border-radius:6px; cursor:pointer; transition:var(--transition);'>复制错误信息</button>" +
              "<button onclick='location.reload()' style='background:var(--primary); color:var(--on-primary); border:none; padding:10px 18px; font-size:14px; font-weight:600; border-radius:6px; cursor:pointer; transition:var(--transition);'>刷新页面</button>" +
              "<button id='logoutErrBtn' style='background:var(--danger-soft); color:var(--danger); border:none; padding:10px 18px; font-size:14px; font-weight:600; border-radius:6px; cursor:pointer; transition:var(--transition);'>退出登录</button>" +
            "</div>" +
          "</div>" +
        "</div>";
        
      var copyBtn = document.getElementById("copyErrBtn");
      if (copyBtn) {
        copyBtn.addEventListener("click", function() {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(errDetail)
              .then(function() { alert("错误信息已复制到剪贴板！"); })
              .catch(function() { fallbackCopy(errDetail); });
          } else {
            fallbackCopy(errDetail);
          }
        });
      }
      
      var logoutBtn = document.getElementById("logoutErrBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", function() {
          document.cookie = "admin_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          location.href = "/admin/login";
        });
      }
      
      function fallbackCopy(text) {
        var textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          alert("错误信息已复制到剪贴板！");
        } catch (err) {
          alert("复制失败，请手动在控制台查看。");
        }
        document.body.removeChild(textArea);
      }
    }

    function showModuleError(section, error) {
      var containerId = "section-" + section;
      var container = document.getElementById(containerId);
      if (!container) {
        if (section === "dashboard") container = document.getElementById("dashboardView");
        else if (section === "sync") container = document.getElementById("syncView");
        else if (section === "feedback") container = document.getElementById("feedbackView");
        else if (section === "settings") container = document.getElementById("settingsView");
      }
      if (container) {
        var errMsg = error && (error.message || String(error)) || "网络请求失败或数据解析异常";
        container.innerHTML = 
          "<div class='card' style='border: 1px solid var(--danger); background: var(--danger-soft); padding: 24px; margin: 16px 0; text-align: center; border-radius: var(--radius);'>" +
            "<h3 style='color: var(--danger); font-size: 16px; margin-bottom: 8px;'>模块加载失败 (" + escapeHtml(section) + ")</h3>" +
            "<p style='font-size: 13px; color: var(--text); margin-bottom: 12px;'>" + escapeHtml(errMsg) + "</p>" +
            "<button class='btn secondary' onclick='location.reload()' style='font-size:12px; padding:4px 10px;'>重试刷新</button>" +
          "</div>";
      }
    }

    function bootFallback(error) {
      try {
        var loginView = document.getElementById("loginView");
        var dashboardView = document.getElementById("dashboardView");
        var isLoginPage = window.location.pathname.indexOf("/login") >= 0;
        if (isLoginPage) {
          if (loginView) loginView.hidden = false;
          if (dashboardView) dashboardView.hidden = true;
          document.body.classList.add("is-login-page");
          document.body.classList.remove("is-dashboard-page");
        } else {
          if (loginView) loginView.hidden = true;
          if (dashboardView) dashboardView.hidden = false;
          document.body.classList.add("is-dashboard-page");
          document.body.classList.remove("is-login-page");
        }
        if (error) {
          showAdminRuntimeError(error);
        }
      } catch (fallbackError) {
        showBootFatal(fallbackError);
      }
    }

    function showAdminRuntimeError(error) {
      var errBar = document.getElementById("adminRuntimeErrorBar");
      if (!errBar) {
        errBar = document.createElement("div");
        errBar.id = "adminRuntimeErrorBar";
        errBar.className = "admin-runtime-error-bar";
        document.body.appendChild(errBar);
      }
      errBar.textContent = "";

      var errorName = "RuntimeError";
      var errorMessage = "脚本运行失败";
      if (typeof error === "string") {
        errorMessage = error;
      } else if (error) {
        errorName = error.name || errorName;
        errorMessage = error.message || String(error);
      }

      var title = document.createElement("strong");
      title.textContent = errorName + ":";
      errBar.appendChild(title);

      var message = document.createElement("span");
      message.textContent = errorMessage;
      errBar.appendChild(message);
      
      var tip = document.createElement("span");
      tip.style = "opacity: 0.8; font-size: 11px; margin-left: 8px;";
      tip.textContent = "请打开 Console 查看完整堆栈。页面: " + window.location.pathname;
      errBar.appendChild(tip);

      var closeBtn = document.createElement("button");
      closeBtn.textContent = "关闭";
      closeBtn.addEventListener("click", function() {
        errBar.remove();
      });
      errBar.appendChild(closeBtn);
    }

    window.onerror = function(message, source, lineno, colno, error) {
      console.error("[Admin Runtime Fatal]", message, source, lineno, colno, error);
      
      var errObj = {
        message: message || "未知错误",
        filename: source || "未知文件",
        lineno: lineno || 0,
        colno: colno || 0,
        stack: error && error.stack ? error.stack : ""
      };
      
      showAdminRuntimeError(error || errObj.message);
      
      if (!window.__adminConsoleBooted) {
        showBootFatal(errObj);
      }
      return false;
    };

    window.addEventListener("error", function(event) {
      console.error("[Admin Runtime Error]", event.error || event.message);
      showAdminRuntimeError(event.error || { name: "Error", message: event.message || "页面脚本运行失败" });
      if (!window.__adminConsoleBooted) {
        showBootFatal(event.error || { name: "Error", message: event.message || "页面脚本运行失败", filename: event.filename, lineno: event.lineno, colno: event.colno });
      }
    });

    window.addEventListener("unhandledrejection", function(event) {
      console.error("[Admin Promise Rejection]", event.reason);
      var err = event.reason || new Error("未处理的 Promise 拒绝");
      showAdminRuntimeError(err);
      if (!window.__adminConsoleBooted) {
        showBootFatal(err);
      }
    });

    (function () {
      // 1. 状态管理
      var state = {
        section: "dashboard",
        dashboard: null,
        dashboardOps: null,
        dashboardOpsLoading: false,
        dashboardOpsUnavailable: false,
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
        relayTasks: [],
        relayUploads: [],
        stagingUploads: [],
        stagingUploadTotal: 0,
        stagingUploadCursor: 0,
        stagingUploadNextCursor: null,
        stagingUploadPageSize: 50,
        stagingUploadFilters: {
          term: "",
          status: "",
        },
        stagingUploadExpandedGroups: {},
        stagingUploadSelected: {},
        apiInflight: {},
        apiAbortControllers: {},
        lastCloudflareToastAt: 0,
        lastSyncLoadAt: 0,
        terms: [],
        termRegistry: null,
        termReleaseIndex: null,
        storageStatus: null,
        healthChecks: [],
        qualityReport: null,
        heatmapDayType: "all",
        classroomHeatmapData: null,
        wizardStartDateTouched: false,
        
        // 系统设置
        backups: [],
        auditLogs: [],
        auditModuleFilter: "all",
        csrfToken: "",
        securityStatus: null,
        aiProviderConfig: null,
        aiProviderEnvironment: "public",
        aiProviderSelectedProvider: "mock",
        aiAgentStatus: null,
        aiAgentEvalReport: null,
        assistantKb: null,
        assistantKbTab: "rules",
        assistantKbSelectedId: "",
        assistantKbImportText: "",
        assistantKbImportPreview: null,
        assistantKbTestQuery: "",
        assistantKbTestEnvironment: "public",
        assistantKbTestResult: null,
        assistantKbDiffText: "",
        campusMap: null,
        campusMapDraft: null,
        campusMapSelectedId: "",
        campusMapSelectedMapKey: "xianxiNorth",
        campusMapAssetHealth: null,
        campusMapDirty: false,
        campusMapLoadedDraftJson: "",
        campusMapHistory: [],
        campusMapUndo: [],
        campusMapRedo: [],
        campusMapDrag: null,
        campusMapLastReceipt: null,
        campusMapLastImport: null,
        
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
      function setStatus(text) {
        if (statusLine) statusLine.textContent = text || "";
      }
      function value(id) {
        var el = $(id);
        return el ? el.value.trim() : "";
      }
      function setValue(id, val) {
        var el = $(id);
        if (el) el.value = val == null ? "" : String(val);
      }
      function boolValue(id) {
        var el = $(id);
        return el ? el.value === "true" : false;
      }

      var ADMIN_SECTION_PATHS = {
        dashboard: "/admin/dashboard",
        catalog: "/admin/timetable",
        sync: "/admin/sync",
        terms: "/admin/terms",
        quality: "/admin/quality",
        notices: "/admin/announcements",
        news: "/admin/news",
        config: "/admin/config",
        "ai-provider": "/admin/ai-provider",
        "assistant-kb": "/admin/assistant-kb",
        "campus-map": "/admin/map",
        feedback: "/admin/feedback",
        security: "/admin/security",
        settings: "/admin/settings"
      };
      var ADMIN_CATALOG_TYPE_PATHS = {
        class: "/admin/classes",
        teacher: "/admin/teachers",
        classroom: "/admin/classrooms",
        course: "/admin/courses"
      };
      var ADMIN_PATH_ROUTES = {
        "/admin": { section: "dashboard", path: "/admin/dashboard" },
        "/admin/dashboard": { section: "dashboard" },
        "/admin/timetable": { section: "catalog" },
        "/admin/catalog": { section: "catalog" },
        "/admin/resources": { section: "catalog" },
        "/admin/classes": { section: "catalog", catalogType: "class" },
        "/admin/teachers": { section: "catalog", catalogType: "teacher" },
        "/admin/classrooms": { section: "catalog", catalogType: "classroom" },
        "/admin/courses": { section: "catalog", catalogType: "course" },
        "/admin/sync": { section: "sync" },
        "/admin/terms": { section: "terms" },
        "/admin/quality": { section: "quality" },
        "/admin/notices": { section: "notices" },
        "/admin/announcements": { section: "notices" },
        "/admin/news": { section: "news" },
        "/admin/config": { section: "config" },
        "/admin/version": { section: "config" },
        "/admin/ai": { section: "ai-provider" },
        "/admin/ai-provider": { section: "ai-provider" },
        "/admin/assistant-kb": { section: "assistant-kb" },
        "/admin/campus-map": { section: "campus-map" },
        "/admin/map": { section: "campus-map" },
        "/admin/feedback": { section: "feedback" },
        "/admin/security": { section: "security" },
        "/admin/settings": { section: "settings" },
        "/admin/logs": { section: "settings" }
      };

      function normalizeAdminPath(pathname) {
        var clean = String(pathname || "/admin/dashboard");
        while (clean.length > 1 && clean.charAt(clean.length - 1) === "/") {
          clean = clean.slice(0, -1);
        }
        return clean || "/admin";
      }

      function getAdminRouteForPath(pathname) {
        var clean = normalizeAdminPath(pathname);
        var route = ADMIN_PATH_ROUTES[clean];
        if (route) {
          return Object.assign({ section: "dashboard", path: clean }, route);
        }
        return { section: "dashboard", path: "/admin/dashboard", unknown: true };
      }

      function normalizeCatalogType(type) {
        return ["class", "teacher", "classroom", "course", "major", "snapshot"].indexOf(type) >= 0 ? type : "";
      }

      function setCatalogType(type, options) {
        var normalized = normalizeCatalogType(type);
        if (!normalized) return;
        options = options || {};
        state.catalogType = normalized;
        if (options.resetPage !== false) {
          state.catalogPage = 1;
        }
        document.querySelectorAll("#catalogTabs button").forEach(function(btn) {
          btn.classList.toggle("active", btn.dataset.type === normalized);
        });
      }

      function getAdminPathForSection(section, options) {
        options = options || {};
        if (options.path) return options.path;
        if (section === "catalog" && options.catalogType && ADMIN_CATALOG_TYPE_PATHS[options.catalogType]) {
          return ADMIN_CATALOG_TYPE_PATHS[options.catalogType];
        }
        return ADMIN_SECTION_PATHS[section] || "/admin/dashboard";
      }

      function updateAdminHistory(section, options) {
        options = options || {};
        if (options.updateHistory === false) return;
        var nextPath = getAdminPathForSection(section, options);
        if (normalizeAdminPath(location.pathname) === normalizeAdminPath(nextPath)) return;
        if (window.history && window.history.pushState) {
          window.history.pushState({ section: section }, "", nextPath);
        } else {
          window.location.href = nextPath;
        }
      }

      function getAdminLoginUrl() {
        var current = location.pathname + location.search + location.hash;
        if (location.pathname.indexOf("/admin/login") === 0) {
          return "/admin/login";
        }
        return "/admin/login?next=" + encodeURIComponent(current);
      }

      function getLoginRedirectTarget() {
        var target = "";
        try {
          target = new URLSearchParams(location.search).get("next") || "";
        } catch (error) {
          target = "";
        }
        if (target && target.indexOf("/admin/") === 0 && target.indexOf("/admin/login") !== 0) {
          return target;
        }
        return "/admin/dashboard";
      }

      var THEME_STORAGE_KEY = "fosu-admin-theme";
      var THEME_LABELS = {
        system: "跟随系统",
        light: "浅色",
        dark: "深色"
      };
      var themeMediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

      function normalizeThemePreference(value) {
        return value === "light" || value === "dark" || value === "system" ? value : "system";
      }

      function getStoredThemePreference() {
        try {
          return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY) || "system");
        } catch (error) {
          return "system";
        }
      }

      function resolveThemePreference(preference) {
        var normalized = normalizeThemePreference(preference);
        if (normalized !== "system") return normalized;
        return themeMediaQuery && themeMediaQuery.matches ? "dark" : "light";
      }

      function applyThemePreference(preference, options) {
        var normalized = normalizeThemePreference(preference);
        var resolved = resolveThemePreference(normalized);
        document.documentElement.dataset.theme = normalized;
        document.documentElement.dataset.resolvedTheme = resolved;
        document.documentElement.style.colorScheme = resolved;
        if (!options || options.persist !== false) {
          try {
            localStorage.setItem(THEME_STORAGE_KEY, normalized);
          } catch (error) {
            // Local preference is best effort only.
          }
        }
        document.querySelectorAll("[data-theme-choice]").forEach(function(button) {
          var active = button.getAttribute("data-theme-choice") === normalized;
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        document.querySelectorAll("[data-theme-current]").forEach(function(node) {
          node.textContent = "当前：" + (THEME_LABELS[normalized] || THEME_LABELS.system);
        });
      }

      function initThemeControls() {
        applyThemePreference(getStoredThemePreference(), { persist: false });
        document.querySelectorAll("[data-theme-choice]").forEach(function(button) {
          button.addEventListener("click", function() {
            applyThemePreference(button.getAttribute("data-theme-choice") || "system");
          });
        });
        if (themeMediaQuery) {
          var handler = function() {
            if (getStoredThemePreference() === "system") {
              applyThemePreference("system", { persist: false });
            }
          };
          if (themeMediaQuery.addEventListener) {
            themeMediaQuery.addEventListener("change", handler);
          } else if (themeMediaQuery.addListener) {
            themeMediaQuery.addListener(handler);
          }
        }
      }

      function safeBind(id, eventName, handler) {
        var el = $(id);
        if (!el) {
          console.warn("[Admin Console] missing element:", id);
          return;
        }
        el.addEventListener(eventName, handler);
      }

      function showLoginView() {
        if (loginView) loginView.hidden = false;
        if (dashboardView) dashboardView.hidden = true;
        if ($("adminSkipLink")) $("adminSkipLink").setAttribute("href", "#loginView");
        document.body.classList.add("is-login-page");
        document.body.classList.remove("is-dashboard-page");
      }

      function showDashboardView() {
        if (loginView) loginView.hidden = true;
        if (dashboardView) dashboardView.hidden = false;
        if ($("adminSkipLink")) $("adminSkipLink").setAttribute("href", "#adminMainContent");
        document.body.classList.remove("is-login-page");
        document.body.classList.add("is-dashboard-page");
      }

      function setElementInert(element, inert) {
        if (!element) return;
        if (inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        try { element.inert = Boolean(inert); } catch (error) {}
      }

      function isMobileDrawerViewport() {
        return Boolean(window.matchMedia && window.matchMedia("(max-width: 1023.98px)").matches);
      }

      function focusableElementsWithin(container) {
        if (!container) return [];
        return Array.prototype.filter.call(container.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ), function (element) {
          return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true";
        });
      }

      function trapFocusWithin(container, event) {
        if (!container || event.key !== "Tab") return;
        var focusable = focusableElementsWithin(container);
        if (!focusable.length) {
          event.preventDefault();
          container.focus();
          return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }

      function syncSidebarAccessibility() {
        var sidebar = $("appSidebar");
        var overlay = $("sidebarOverlay");
        var mobileTopbar = $("mobileAdminTopbar");
        var mainContent = $("adminMainContent");
        var menuButton = $("mobileMenuBtn");
        var drawerMode = isMobileDrawerViewport();
        var isOpen = Boolean(drawerMode && sidebar && sidebar.classList.contains("show"));

        if (!drawerMode && sidebar) sidebar.classList.remove("show");
        setElementInert(sidebar, drawerMode && !isOpen);
        if (sidebar) {
          if (drawerMode) sidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
          else sidebar.removeAttribute("aria-hidden");
        }
        setElementInert(mobileTopbar, isOpen);
        setElementInert(mainContent, isOpen);
        if (overlay) {
          overlay.classList.toggle("show", isOpen);
          overlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
        }
        if (menuButton) menuButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
        document.body.classList.toggle("sidebar-drawer-open", isOpen);
      }

      function openMobileDrawer() {
        var sidebar = $("appSidebar");
        if (!sidebar || !isMobileDrawerViewport()) return;
        sidebar.classList.add("show");
        syncSidebarAccessibility();
        window.setTimeout(function () {
          if ($("sidebarCloseBtn")) $("sidebarCloseBtn").focus();
        }, 0);
      }

      function closeMobileDrawer(returnFocus) {
        var sidebar = $("appSidebar");
        var wasOpen = Boolean(sidebar && sidebar.classList.contains("show"));
        if (sidebar) sidebar.classList.remove("show");
        syncSidebarAccessibility();
        if (wasOpen && returnFocus !== false && $("mobileMenuBtn")) $("mobileMenuBtn").focus();
      }

      var activeDetailDrawer = null;
      var activeDetailDrawerReturnFocus = null;

      function openDetailDrawer(drawerId, maskId, initialFocusId, returnFocusElement) {
        var drawer = $(drawerId);
        var mask = $(maskId);
        if (!drawer) return;
        activeDetailDrawer = drawer;
        activeDetailDrawerReturnFocus = returnFocusElement || document.activeElement;
        drawer.classList.add("show");
        drawer.setAttribute("aria-hidden", "false");
        setElementInert(drawer, false);
        if (mask) {
          mask.classList.add("show");
          mask.setAttribute("aria-hidden", "false");
        }
        setElementInert(dashboardView, true);
        document.body.classList.add("detail-drawer-open");
        window.setTimeout(function () {
          var initialFocus = initialFocusId ? $(initialFocusId) : null;
          (initialFocus || focusableElementsWithin(drawer)[0] || drawer).focus();
        }, 0);
      }

      function closeDetailDrawer(drawerId, maskId, returnFocus) {
        var drawer = $(drawerId);
        var mask = $(maskId);
        var focusTarget = activeDetailDrawer === drawer ? activeDetailDrawerReturnFocus : null;
        if (drawer) {
          drawer.classList.remove("show");
          drawer.setAttribute("aria-hidden", "true");
          setElementInert(drawer, true);
        }
        if (mask) {
          mask.classList.remove("show");
          mask.setAttribute("aria-hidden", "true");
        }
        if (activeDetailDrawer === drawer) {
          activeDetailDrawer = null;
          activeDetailDrawerReturnFocus = null;
          setElementInert(dashboardView, false);
          document.body.classList.remove("detail-drawer-open");
          syncSidebarAccessibility();
          if (returnFocus !== false && focusTarget && document.documentElement.contains(focusTarget)) {
            focusTarget.focus();
          }
        }
      }

      function setSidebarCollapsed(collapsed, persist) {
        var shell = $("dashboardView");
        var button = $("sidebarCollapseBtn");
        if (!shell || !button) return;
        shell.classList.toggle("sidebar-collapsed", Boolean(collapsed));
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        button.setAttribute("aria-label", collapsed ? "展开侧栏" : "收起侧栏");
        var label = button.querySelector(".nav-label");
        if (label) label.textContent = collapsed ? "展开侧栏" : "收起侧栏";
        if (persist !== false) {
          try { localStorage.setItem("fosu-admin-sidebar-collapsed", collapsed ? "1" : "0"); } catch (error) {}
        }
      }

      function initSidebarPreference() {
        var collapsed = false;
        try { collapsed = localStorage.getItem("fosu-admin-sidebar-collapsed") === "1"; } catch (error) {}
        setSidebarCollapsed(collapsed, false);
      }

      function ignoreLoadError(promise) {
        if (promise && typeof promise.catch === "function") {
          promise.catch(function () {});
        }
      }
      
      function escapeHtml(str) {
        if (str === undefined || str === null) return "";
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function renderCodePreview(codeEl) {
        if (!codeEl) return;
        var box = codeEl.closest(".code-preview");
        if (!box) return;
        var linesWrap = box.querySelector(".code-preview-lines");
        if (!linesWrap) return;
        var text = codeEl.textContent || "";
        var lines = text.split(/\\r?\\n/);
        if (lines.length === 0) lines = [""];
        linesWrap.innerHTML = "";
        lines.forEach(function(line, index) {
          var row = document.createElement("div");
          row.className = "code-line";
          var numberCell = document.createElement("span");
          numberCell.className = "code-line-number";
          numberCell.textContent = String(index + 1);
          var contentCell = document.createElement("span");
          contentCell.className = "code-line-content";
          contentCell.textContent = line || " ";
          row.appendChild(numberCell);
          row.appendChild(contentCell);
          linesWrap.appendChild(row);
        });
      }

      function renderAllCodePreviews(root) {
        var scope = root || document;
        scope.querySelectorAll(".code-preview code").forEach(renderCodePreview);
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
        if (type === "error" && /statusCode=504|Cloudflare|Ray ID/i.test(String(message || ""))) {
          var now = Date.now();
          if (state.lastCloudflareToastAt && now - state.lastCloudflareToastAt < 10000) return;
          state.lastCloudflareToastAt = now;
        }
        var toast = document.createElement("div");
        toast.className = "toast " + type;
        toast.setAttribute("role", type === "error" ? "alert" : "status");
        toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.classList.add("show"); }, 50);
        setTimeout(function() {
          toast.classList.remove("show");
          setTimeout(function() { toast.remove(); }, 300);
        }, 3000);
      }

      function setButtonLoading(btn, loadingText) {
        if (!btn) {
          return function() {};
        }
        var originalText = btn.textContent;
        var originalDisabled = btn.disabled;
        btn.disabled = true;
        btn.classList.add("is-loading");
        btn.setAttribute("aria-busy", "true");
        btn.textContent = loadingText || "处理中...";
        return function() {
          btn.disabled = originalDisabled;
          btn.classList.remove("is-loading");
          btn.removeAttribute("aria-busy");
          btn.textContent = originalText;
        };
      }

      function sanitizeHttpErrorText(text, status) {
        var raw = String(text || "");
        var rayMatch = raw.match(/Ray ID\\s*:?\\s*<[^>]*>\\s*([a-zA-Z0-9-]+)/i) ||
          raw.match(/Ray ID\\s*:?\\s*([a-zA-Z0-9-]+)/i) ||
          raw.match(/cf-ray["']?\\s*[:=]\\s*["']?([a-zA-Z0-9-]+)/i);
        var isCloudflareTimeout = status === 504 || /cloudflare|gateway time-out|cf-error|Ray ID/i.test(raw);
        if (isCloudflareTimeout) {
          var parts = ["源站响应超时，可能正在执行重任务或 CPU 过高，请稍后刷新或查看运维诊断。"];
          parts.push("statusCode=" + (status || 0));
          if (rayMatch && rayMatch[1]) parts.push("Ray ID=" + rayMatch[1]);
          parts.push("time=" + new Date().toISOString());
          return parts.join(" · ");
        }
        return raw
          .replace(new RegExp("<scr" + "ipt[\\\\s\\\\S]*?<\\\\/scr" + "ipt>", "gi"), "")
          .replace(/<style[\\s\\S]*?<\\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 240) || ("HTTP " + (status || 0));
      }

      function isAbortError(error) {
        return error && (error.name === "AbortError" || /abort/i.test(String(error.message || "")));
      }

      function api(path, options) {
        options = options || {};
        options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        var method = String(options.method || "GET").toUpperCase();
        var requestKey = method + " " + path;
        if (method === "GET" && options.dedupe !== false && state.apiInflight[requestKey]) {
          return state.apiInflight[requestKey];
        }
        if (state.csrfToken && ["POST", "PUT", "PATCH", "DELETE"].indexOf(method) >= 0 && !options.headers["X-Fosu-CSRF"]) {
          options.headers["X-Fosu-CSRF"] = state.csrfToken;
        }
        options.credentials = "include";
        var fetchOptions = Object.assign({}, options);
        delete fetchOptions.dedupe;
        if (!fetchOptions.signal && typeof AbortController !== "undefined") {
          var controller = new AbortController();
          fetchOptions.signal = controller.signal;
          state.apiAbortControllers[requestKey] = controller;
        }

        var requestPromise = fetch(path, fetchOptions).then(function (res) {
          return res.text().then(function (text) {
            var data = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch (e) {
              data = { success: false, message: sanitizeHttpErrorText(text || res.statusText, res.status), statusCode: res.status };
            }

            if (res.status === 401) {
              var message = data.message || "后台登录已过期，请重新登录";
              var isSessionCheck = path.indexOf("/api/admin/session") >= 0;
              if (isSessionCheck && location.pathname.indexOf("/admin/login") < 0) {
                showToast("后台登录已过期，请重新登录", "error");
                window.location.href = getAdminLoginUrl();
              }
              throw new Error(message);
            }

            if (!res.ok || data.success === false) {
              var httpError = new Error(data.message || ("HTTP " + res.status));
              httpError.status = res.status;
              httpError.code = data.code || "";
              httpError.data = data;
              throw httpError;
            }

            return data;
          });
        }).finally(function() {
          delete state.apiInflight[requestKey];
          delete state.apiAbortControllers[requestKey];
        });
        if (method === "GET" && options.dedupe !== false) {
          state.apiInflight[requestKey] = requestPromise;
        }
        return requestPromise;
      }

      function abortAdminRequests() {
        Object.keys(state.apiAbortControllers || {}).forEach(function(key) {
          var controller = state.apiAbortControllers[key];
          if (controller && typeof controller.abort === "function") {
            try { controller.abort(); } catch (err) {}
          }
        });
        state.apiAbortControllers = {};
        state.apiInflight = {};
      }

      window.addEventListener("beforeunload", abortAdminRequests);

      function safeFetch(path, options) {
        options = options || {};
        var startedAt = Date.now();
        return fetch(path, Object.assign({ credentials: "include" }, options))
          .then(function (res) {
            return res.text().then(function (text) {
              var data = {};
              try {
                data = text ? JSON.parse(text) : {};
              } catch (e) {
                data = { success: false, message: sanitizeHttpErrorText(text || res.statusText, res.status), statusCode: res.status };
              }
              return {
                ok: res.ok && data.success !== false,
                status: res.status,
                duration: Date.now() - startedAt,
                data: data,
                message: data.message || res.statusText || ""
              };
            });
          })
          .catch(function (error) {
            return {
              ok: false,
              status: 0,
              duration: Date.now() - startedAt,
              data: null,
              message: error.message || "网络断开"
            };
          });
      }

      function uploadApi(path, options) {
        return api(path, options || {});
      }

      function ensureAdminSession() {
        return api("/api/admin/session").then(function (res) {
          if (!res.authenticated) {
            showToast("后台登录已过期，请重新登录", "error");
            window.location.href = getAdminLoginUrl();
            throw new Error("后台登录已过期，请重新登录");
          }
          state.csrfToken = res.csrfToken || state.csrfToken || "";
          return res;
        });
      }

      function clearAdminClientState() {
        ["adminToken", "adminSession", "admin_api_token"].forEach(function (key) {
          try { localStorage.removeItem(key); } catch (e) {}
          try { sessionStorage.removeItem(key); } catch (e) {}
        });
      }

      // 登录与登出
      function login() {
        var password = value("loginPassword");
        var loginError = $("loginError");
        var loginButton = $("loginButton");
        if (!password) {
          if (loginError) loginError.textContent = "请输入验证密码";
          if ($("loginPassword")) $("loginPassword").focus();
          return;
        }
        if (loginError) loginError.textContent = "";
        var restoreLoginButton = setButtonLoading(loginButton, "正在验证...");
        api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password: password })
        }).then(function (res) {
          state.csrfToken = res.csrfToken || "";
          if (loginError) loginError.textContent = "";
          window.location.href = getLoginRedirectTarget();
        }).catch(function (error) {
          if (loginError) loginError.textContent = error.message;
        }).finally(function () {
          restoreLoginButton();
        });
      }

      function logout() {
        api("/api/admin/logout", { method: "POST", body: "{}" }).then(function () {
          clearAdminClientState();
          window.location.href = "/admin/login";
        }).catch(function (error) {
          clearAdminClientState();
          console.error("[Admin Console] logout failed:", error);
          window.location.href = "/admin/login";
        });
      }

      // 菜单 Tab 切换
      function switchSection(section, options) {
        options = options || {};
        var mobileDrawerWasOpen = Boolean(isMobileDrawerViewport() && $("appSidebar") && $("appSidebar").classList.contains("show"));
        var targetSection = document.getElementById("section-" + section) ? section : "dashboard";
        if (targetSection === "catalog" && options.catalogType) {
          setCatalogType(options.catalogType, { resetPage: options.resetCatalogPage });
        }
        updateAdminHistory(targetSection, {
          catalogType: options.catalogType,
          path: options.path,
          updateHistory: options.updateHistory
        });
        state.section = targetSection;
        document.querySelectorAll(".section").forEach(function (node) {
          node.classList.toggle("active", node.id === "section-" + targetSection);
        });
        document.querySelectorAll(".sidebar nav ul li").forEach(function (node) {
          var isActive = node.dataset.section === targetSection;
          node.classList.toggle("active", isActive);
          var navButton = node.querySelector("button");
          if (navButton) {
            if (isActive) navButton.setAttribute("aria-current", "page");
            else navButton.removeAttribute("aria-current");
          }
        });
        
        var titles = {
          dashboard: "数据概览",
          catalog: "数据资源中心",
          sync: "数据同步中心",
          terms: "学期管理",
          quality: "数据质量中心",
          notices: "公告管理",
          news: "最新动态",
          config: "数据版本",
          "ai-provider": "查询服务",
          "assistant-kb": "小佛助手知识库",
          "campus-map": "校园地图管理",
          feedback: "反馈管理",
          security: "安全状态",
          settings: "系统设置与日志"
        };
        var nextTitle = titles[targetSection] || "Admin Console";
        var eyebrows = {
          dashboard: "总览 / 数据运营",
          catalog: "数据与课表 / 资源目录",
          terms: "数据与课表 / 学期生命周期",
          quality: "数据与课表 / 质量门禁",
          sync: "发布与运维 / 同步管线",
          config: "发布与运维 / 版本配置",
          notices: "内容管理 / 公告",
          news: "内容管理 / 动态",
          "assistant-kb": "内容管理 / 助手知识库",
          "campus-map": "内容管理 / 校园地图",
          feedback: "内容管理 / 用户反馈",
          "ai-provider": "系统与安全 / 查询服务",
          security: "系统与安全 / 安全状态",
          settings: "系统与安全 / 设置与日志"
        };
        if ($("pageTitle")) {
          $("pageTitle").textContent = nextTitle;
        }
        if ($("pageEyebrow")) {
          $("pageEyebrow").textContent = eyebrows[targetSection] || "校园数据运营台";
        }
        if ($("mobilePageTitle")) {
          $("mobilePageTitle").textContent = nextTitle;
        }
        if ($("refreshButton")) {
          $("refreshButton").hidden = targetSection === "sync";
        }
        closeMobileDrawer(false);
        if (mobileDrawerWasOpen && $("adminMainContent")) {
          window.setTimeout(function () {
            $("adminMainContent").focus();
          }, 0);
        }
        
        // 切页面后自动获取对应页面数据
        if (targetSection === "dashboard") {
          renderDashboard();
          if (!state.dashboardOpsLoading) ignoreLoadError(loadDashboardOperations());
        } else if (targetSection === "catalog") {
          ignoreLoadError(loadCatalog());
        } else if (targetSection === "sync") {
          ignoreLoadError(loadSyncStatus());
        } else if (targetSection === "terms") {
          ignoreLoadError(loadTerms());
        } else if (targetSection === "quality") {
          ignoreLoadError(loadQualityReport());
        } else if (targetSection === "settings") {
          ignoreLoadError(loadSettingsLogs());
        } else if (targetSection === "security") {
          ignoreLoadError(loadSecurityStatus());
        } else if (targetSection === "ai-provider") {
          ignoreLoadError(loadAiProviderConfig());
        } else if (targetSection === "assistant-kb") {
          ignoreLoadError(loadAssistantKb());
        } else if (targetSection === "campus-map") {
          ignoreLoadError(loadCampusMapState());
        } else if (targetSection === "feedback") {
          ignoreLoadError(loadFeedbacks());
        }
      }

      function loadDashboard() {
        setStatus("正在读取后台数据概览...");
        return api("/api/admin/dashboard")
          .then(function (res) {
            state.dashboard = res.data || res || {};
            renderDashboard();
            if (state.section === "dashboard" && !state.dashboardOpsLoading) {
              ignoreLoadError(loadDashboardOperations());
            }
            setStatus("数据概览已更新：" + formatDate(new Date().toISOString()));
            return state.dashboard;
          })
          .catch(function (error) {
            if (isAbortError(error)) return null;
            console.error("[Admin Console] loadDashboard failed:", error);
            setStatus("数据概览加载失败：" + (error.message || "未知错误"));
            showToast(error.message || "数据概览加载失败", "error");
            showModuleError("dashboard", error);
            throw error;
          });
      }

      function loadDashboardOperations() {
        state.dashboardOpsLoading = true;
        state.dashboardOpsUnavailable = false;
        return api("/api/admin/sync/status")
          .then(function (res) {
            state.dashboardOps = res.data || res || {};
            state.dashboardOpsLoading = false;
            state.dashboardOpsUnavailable = false;
            if (state.section === "dashboard") renderDashboard();
            return state.dashboardOps;
          })
          .catch(function (error) {
            state.dashboardOps = null;
            state.dashboardOpsLoading = false;
            state.dashboardOpsUnavailable = true;
            console.warn("[Admin Console] dashboard operations status unavailable:", error.message);
            if (state.section === "dashboard") renderDashboard();
            return null;
          });
      }

      function termStatusText(status, dataAvailable) {
        if (status === "current") return "当前使用";
        if (status === "ready") return "可切换";
        if (status === "archived") return "已归档";
        if (status === "disabled") return "数据异常";
        if (status === "planned" && dataAvailable) return "待审核";
        return "待发布";
      }

      function renderTerms() {
        var tbody = $("termsTableBody");
        if (!tbody) return;
        tbody.textContent = "";
        var terms = state.terms || [];
        if (!terms.length) {
          tbody.innerHTML = "<tr><td colspan='9' style='text-align:center;color:var(--muted);padding:20px;'>暂无学期记录</td></tr>";
          return;
        }
        terms.forEach(function(term) {
          var tr = document.createElement("tr");
          var release = term.releaseVersion || "";
          tr.innerHTML =
            "<td><strong>" + escapeHtml(term.term || "-") + "</strong></td>" +
            "<td>" + escapeHtml(term.semesterText || "-") + "</td>" +
            "<td><span class='badge " + (term.status === "current" ? "success" : (term.status === "disabled" ? "danger" : "info")) + "'>" + escapeHtml(termStatusText(term.status, term.dataAvailable)) + "</span></td>" +
            "<td>" + escapeHtml(term.termStartDate || "-") + "</td>" +
            "<td>" + escapeHtml(term.totalWeeks || "-") + "</td>" +
            "<td>" + (term.dataAvailable ? "可用" : "不可用") + "</td>" +
            "<td>" + escapeHtml(release || "-") + "</td>" +
            "<td>" + escapeHtml(formatDate(term.updatedAt)) + "</td>" +
            "<td><div style='display:flex;gap:6px;flex-wrap:wrap;'></div></td>";
          var actions = tr.querySelector("div");
          function addAction(label, className, handler) {
            var btn = document.createElement("button");
            btn.className = className || "ghost";
            btn.type = "button";
            btn.style = "padding:4px 8px;font-size:12px;";
            btn.textContent = label;
            btn.addEventListener("click", handler);
            actions.appendChild(btn);
          }
          addAction("检查", "secondary", function() {
            setValue("termReadinessId", term.term);
            setValue("termReadinessRelease", release);
            checkTermReadiness();
            switchSection("terms");
          });
          if (term.status !== "current" && term.status !== "disabled") {
            addAction("归档", "ghost", function() { archiveTerm(term.term); });
            addAction("禁用", "danger", function() { disableTerm(term.term); });
          }
          tbody.appendChild(tr);
        });
      }

      function loadTerms() {
        return api("/api/admin/terms")
          .then(function(res) {
            state.terms = res.terms || [];
            state.termRegistry = res.registry || null;
            state.termReleaseIndex = res.releaseIndex || null;
            renderTerms();
            return res;
          })
          .catch(function(error) {
            showToast(error.message || "学期列表加载失败", "error");
            throw error;
          });
      }

      function createTerm() {
        var payload = {
          term: value("termCreateId"),
          semesterText: value("termCreateText"),
          termStartDate: value("termCreateStart"),
          totalWeeks: Number(value("termCreateWeeks")),
          weekStart: value("termCreateWeekStart") || "monday"
        };
        return api("/api/admin/terms", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            showToast("planned 学期已创建", "success");
            return loadTerms().then(function() { return res; });
          })
          .catch(function(error) { showToast(error.message || "创建失败", "error"); });
      }

      function checkTermReadiness() {
        var term = value("termReadinessId");
        var releaseVersion = value("termReadinessRelease");
        if (!term) {
          showToast("请填写目标学期", "error");
          return Promise.resolve(null);
        }
        return api("/api/admin/terms/" + encodeURIComponent(term) + "/readiness?releaseVersion=" + encodeURIComponent(releaseVersion || ""))
          .then(function(res) {
            var readiness = res.readiness || {};
            renderTermReadiness(readiness);
            $("termReadinessOutput").textContent = JSON.stringify(readiness, null, 2);
            var firstFail = (readiness.checks || []).filter(function(item) { return item.status === "fail"; })[0];
            showToast(readiness.ready ? "检查通过" : ("检查未通过：" + (firstFail ? firstFail.key : "查看失败项")), readiness.ready ? "success" : "warning");
            return readiness;
          })
          .catch(function(error) {
            renderTermReadiness(null);
            $("termReadinessOutput").textContent = error.message || "检查失败";
            showToast(error.message || "检查失败", "error");
          });
      }

      function formatReadinessValue(value) {
        if (value === undefined || value === null || value === "") return "-";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }

      function readinessBadge(status) {
        if (status === "pass") return "<span class='badge success'>pass</span>";
        if (status === "warn") return "<span class='badge warning'>warn</span>";
        return "<span class='badge danger'>fail</span>";
      }

      function renderTermReadiness(readiness) {
        var summaryEl = $("termReadinessSummary");
        var checksEl = $("termReadinessChecks");
        if (!summaryEl || !checksEl) return;
        var repairBtn = $("repairCurrentTermReleaseBtn");
        state.termRepairAction = readiness && readiness.repairAction || null;
        if (repairBtn) {
          repairBtn.hidden = !(state.termRepairAction && state.termRepairAction.type === "current-term-release-repair");
        }
        if (!readiness || !Array.isArray(readiness.checks)) {
          summaryEl.innerHTML = "<span class='badge muted'>等待检查</span>";
          checksEl.innerHTML = "";
          if (repairBtn) repairBtn.hidden = true;
          return;
        }
        var summary = readiness.summary || {};
        var calendarSummary = readiness.calendarSummary || {};
        summaryEl.innerHTML = [
          readiness.ready ? "<span class='badge success'>可激活</span>" : "<span class='badge danger'>未通过</span>",
          "<span>term: <strong>" + escapeHtml(readiness.term || "-") + "</strong></span>",
          "<span>release: <strong>" + escapeHtml(readiness.releaseVersion || "-") + "</strong></span>",
          "<span>开学: <strong>" + escapeHtml(calendarSummary.termStartDate || "-") + "</strong></span>",
          "<span>周起始: <strong>" + escapeHtml(calendarSummary.weekStart || "-") + "</strong></span>",
          "<span>总周数: <strong>" + escapeHtml(calendarSummary.totalWeeks || "-") + "</strong></span>",
          "<span>当前周: <strong>" + escapeHtml(calendarSummary.currentWeek || "-") + "</strong></span>",
          "<span>calendar weeks: <strong>" + escapeHtml(calendarSummary.calendarWeeks || "-") + "</strong></span>",
          "<span>release/registry: <strong>" + escapeHtml(calendarSummary.releaseRegistryMatch ? "一致" : "不一致") + "</strong></span>",
          "<span>fail " + escapeHtml(summary.fail || 0) + "</span>",
          "<span>warn " + escapeHtml(summary.warn || 0) + "</span>",
          "<span>pass " + escapeHtml(summary.pass || 0) + "</span>"
        ].join("");
        var categorized = readiness.categorizedChecks || {};
        var groups = [
          { category: "blocker", status: "fail", title: "阻断项" },
          { category: "auto-repairable", status: "fail", title: "可自动修复项" },
          { category: "warning", status: "warn", title: "警告项" },
          { category: "info", status: "pass", title: "信息项" }
        ];
        checksEl.innerHTML = groups.map(function(group) {
          var items = Array.isArray(categorized[group.category])
            ? categorized[group.category]
            : readiness.checks.filter(function(item) {
                return item.category === group.category || (!item.category && item.status === group.status);
              });
          if (!items.length) return "";
          return "<div class='readiness-group'>" +
            "<div class='readiness-group-head'><span>" + escapeHtml(group.title) + "</span><span>" + items.length + "</span></div>" +
            items.map(function(item) {
              return "<div class='readiness-item'>" +
                "<div style='display:flex;justify-content:space-between;gap:8px;align-items:flex-start;'>" +
                  "<div class='readiness-item-key'>" + escapeHtml(item.key || "-") + "</div>" +
                  readinessBadge(item.status) +
                "</div>" +
                "<div>" + escapeHtml(item.message || "-") + "</div>" +
                "<div class='readiness-item-meta'><strong>expected:</strong> " + escapeHtml(formatReadinessValue(item.expected)) + "</div>" +
                "<div class='readiness-item-meta'><strong>actual:</strong> " + escapeHtml(formatReadinessValue(item.actual)) + "</div>" +
                (item.autoRepairable ? "<div class='readiness-item-meta'><strong>auto repair:</strong> safe</div>" : "") +
                "<div class='readiness-fix'><strong>修复建议:</strong> " + escapeHtml(item.fixHint || "-") + "</div>" +
              "</div>";
            }).join("") +
          "</div>";
        }).join("");
      }

      function rebuildRuntimePointerFromPanel() {
        var term = value("termReadinessId");
        var releaseVersion = value("termReadinessRelease");
        if (!term) {
          showToast("请填写目标学期", "error");
          return;
        }
        api("/api/admin/terms/" + encodeURIComponent(term) + "/rebuild-runtime-pointer", {
          method: "POST",
          body: JSON.stringify({ releaseVersion: releaseVersion })
        }).then(function(res) {
          showToast("Runtime Pointer 已重建", "success");
          $("termReadinessOutput").textContent = JSON.stringify(res, null, 2);
          return checkTermReadiness();
        }).catch(function(error) {
          showToast(error.message || "重建失败", "error");
        });
      }

      function repairCurrentTermReleaseFromPanel() {
        var term = value("termReadinessId");
        var releaseVersion = value("termReadinessRelease");
        var btn = $("repairCurrentTermReleaseBtn");
        if (!term || !releaseVersion) {
          showToast("请先运行当前学期旧 Release 检查", "error");
          return;
        }
        var restoreButton = setButtonLoading(btn, "dry-run...");
        api("/api/admin/terms/" + encodeURIComponent(term) + "/repair-release/dry-run", {
          method: "POST",
          body: JSON.stringify({
            sourceReleaseVersion: releaseVersion,
            activateAfterBuild: true,
            syncOpenResty: true
          })
        }).then(function(res) {
          var result = res.result || {};
          if (result.alreadyHealthy) {
            showToast("当前学期 Release 已健康，无需修复", "success");
            $("termReadinessOutput").textContent = JSON.stringify(result, null, 2);
            return Promise.resolve(null);
          }
          var plan = result.plan || {};
          var changes = plan.changes || {};
          var registry = changes.registry || {};
          var lines = plan.confirmLines || [
            "当前学期: " + (result.term || term),
            "旧 Release Version: " + (plan.oldReleaseVersion || releaseVersion),
            "新 Release Version: " + (result.newReleaseVersion || plan.newReleaseVersion || "-"),
            "registry 当前 " + (registry.currentTotalWeeks || "-") + " 周，将修正为 " + (registry.nextTotalWeeks || 19) + " 周",
            "将生成 calendar.json",
            "将更新 manifest calendar 元数据",
            "将保留旧 Release 用于回滚",
            "不重新采集课表",
            "不影响用户本地课表和 XLS 导入"
          ];
          $("termReadinessOutput").textContent = JSON.stringify(result, null, 2);
          if (!window.confirm(lines.concat(["", "确认执行正式修复？"]).join("\\n"))) {
            return Promise.resolve(null);
          }
          restoreButton();
          restoreButton = setButtonLoading(btn, "已启动...");
          return api("/api/admin/terms/" + encodeURIComponent(term) + "/repair-release/start", {
            method: "POST",
            body: JSON.stringify({
              sourceReleaseVersion: releaseVersion,
              newReleaseVersion: result.newReleaseVersion || plan.newReleaseVersion || "",
              activateAfterBuild: true,
              syncOpenResty: true
            })
          }).then(function(startRes) {
            var job = startRes.job || {};
            showToast("学期 Release 修复任务已启动", "success");
            pollAdminJob(job.id, "学期 Release 修复", function(doneJob) {
              restoreButton();
              $("termReadinessOutput").textContent = JSON.stringify(doneJob || {}, null, 2);
              loadTerms();
              loadDashboard();
              checkTermReadiness();
            }, { panelId: "termRepairJobLog" });
          });
        }).catch(function(error) {
          showToast(error.message || "修复启动失败", "error");
        }).finally(function() {
          restoreButton();
        });
      }

      function bindTermRelease() {
        var term = value("termReadinessId");
        var releaseVersion = value("termReadinessRelease");
        if (!term || !releaseVersion) {
          showToast("请填写 term 和 releaseVersion", "error");
          return;
        }
        api("/api/admin/terms/" + encodeURIComponent(term) + "/bind-release", {
          method: "POST",
          body: JSON.stringify({ releaseVersion: releaseVersion })
        }).then(function(res) {
          showToast("Release 已绑定", "success");
          $("termReadinessOutput").textContent = JSON.stringify(res, null, 2);
          loadTerms();
        }).catch(function(error) {
          showToast(error.message || "绑定失败", "error");
        });
      }

      function activateTermFromPanel() {
        var term = value("termReadinessId");
        var releaseVersion = value("termReadinessRelease");
        if (!term || !releaseVersion) {
          showToast("请填写 term 和 releaseVersion", "error");
          return;
        }
        checkTermReadiness().then(function(readiness) {
          if (!readiness || !readiness.ready) return;
          var currentTerm = state.termRegistry && state.termRegistry.activeTerm || state.dashboard && state.dashboard.currentSemester || "-";
          var message = [
            "高风险操作：激活当前学期",
            "旧学期: " + currentTerm,
            "新学期: " + term,
            "Release: " + releaseVersion,
            "开学日期: " + ((readiness.record && readiness.record.termStartDate) || "-"),
            "总周数: " + ((readiness.record && readiness.record.totalWeeks) || "-"),
            "索引 counts: " + JSON.stringify(readiness.counts || {}),
            "OpenResty: " + (readiness.openResty && readiness.openResty.manifestExists ? "manifest exists" : "missing"),
            "回滚目标: " + ((readiness.rollbackTarget && readiness.rollbackTarget.releaseVersion) || "-"),
            "",
            "确认激活？"
          ].join("\\n");
          if (!window.confirm(message)) return;
          api("/api/admin/terms/" + encodeURIComponent(term) + "/activate", {
            method: "POST",
            body: JSON.stringify({ releaseVersion: releaseVersion })
          }).then(function(res) {
            showToast("学期已激活", "success");
            $("termReadinessOutput").textContent = JSON.stringify(res, null, 2);
            loadTerms();
            loadDashboard();
          }).catch(function(error) {
            showToast(error.message || "激活失败", "error");
          });
        });
      }

      function archiveTerm(term) {
        if (!window.confirm("确认归档 " + term + "？历史查询仍可使用已发布 Release。")) return;
        api("/api/admin/terms/" + encodeURIComponent(term) + "/archive", { method: "POST", body: "{}" })
          .then(function() { showToast("已归档", "success"); loadTerms(); })
          .catch(function(error) { showToast(error.message || "归档失败", "error"); });
      }

      function disableTerm(term) {
        if (!window.confirm("确认禁用 " + term + "？普通客户端将不能查询该学期。")) return;
        api("/api/admin/terms/" + encodeURIComponent(term) + "/disable", { method: "POST", body: "{}" })
          .then(function() { showToast("已禁用", "success"); loadTerms(); })
          .catch(function(error) { showToast(error.message || "禁用失败", "error"); });
      }

      function loadConfig() {
        return api("/api/admin/config")
          .then(function (res) {
            state.config = res.data || {};
            renderConfigForm();
            return state.config;
          })
          .catch(function (error) {
            if (isAbortError(error)) return null;
            console.error("[Admin Console] loadConfig failed:", error);
            showToast(error.message || "系统配置加载失败", "error");
            showModuleError("config", error);
            throw error;
          });
      }

      function loadNotices() {
        return api("/api/admin/notices")
          .then(function (res) {
            state.notices = res.items || [];
            renderNotices();
            return state.notices;
          })
          .catch(function (error) {
            if (isAbortError(error)) return null;
            console.error("[Admin Console] loadNotices failed:", error);
            showToast(error.message || "公告配置加载失败", "error");
            showModuleError("notices", error);
            throw error;
          });
      }

      function loadNews() {
        return api("/api/admin/news")
          .then(function (res) {
            state.news = res.items || [];
            renderNews();
            return state.news;
          })
          .catch(function (error) {
            if (isAbortError(error)) return null;
            console.error("[Admin Console] loadNews failed:", error);
            showToast(error.message || "最新动态加载失败", "error");
            showModuleError("news", error);
            throw error;
          });
      }

      // Panel 1: Dashboard 数据渲染
      function renderDashboard() {
        var data = state.dashboard || {};
        var ops = state.dashboardOps || null;
        var opsUnavailable = Boolean(state.dashboardOpsUnavailable);
        var counts = data.counts || {};
        var version = data.dataVersion || {};
        var updateFields = [
          version.classScheduleUpdatedAt,
          version.teacherScheduleUpdatedAt,
          version.classroomScheduleUpdatedAt,
          version.courseScheduleUpdatedAt
        ];
        var validUpdateDates = updateFields.map(function (value) {
          return { raw: value, time: new Date(value).getTime() };
        }).filter(function (item) {
          return Number.isFinite(item.time);
        });
        validUpdateDates.sort(function (a, b) { return b.time - a.time; });
        var latestUpdate = validUpdateDates.length ? validUpdateDates[0].raw : null;
        var latestSync = ops && ops.lastSyncTime || latestUpdate;
        var staleResourceCount = updateFields.filter(function (value) {
          var time = new Date(value).getTime();
          return !Number.isFinite(time) || Date.now() - time > 30 * 24 * 60 * 60 * 1000;
        }).length;
        var isOnline = String(data.publishStatus || "").toLowerCase() === "online";
        var activeRelease = ops
          ? (ops.activeReleaseVersion || "未生效")
          : (opsUnavailable ? "状态不可用" : "正在确认");

        var systemMetrics = [
          { label: "系统状态", value: isOnline ? "运行正常" : (data.publishStatus || "待确认"), foot: isOnline ? "核心后台服务可用" : "请检查发布与运行配置", tone: isOnline ? "success" : "warning" },
          { label: "当前学期", value: data.currentSemester || "未配置", foot: "全局课表数据作用域", tone: data.currentSemester ? "info" : "warning" },
          { label: "Active Release", value: activeRelease, foot: ops ? (ops.activeReleaseVersion ? "已按 runtime pointer 核对" : "当前没有生效的 runtime pointer") : (opsUnavailable ? "同步状态暂不可用，请刷新重试" : "正在读取 runtime pointer"), tone: ops ? (ops.activeReleaseVersion ? "success" : "danger") : (opsUnavailable ? "warning" : "info") },
          { label: "最近数据同步", value: latestSync ? formatDate(latestSync) : "暂无记录", foot: staleResourceCount ? staleResourceCount + " 类资源超过 30 天未更新" : "四类核心资源均在更新窗口内", tone: latestSync ? (staleResourceCount ? "warning" : "success") : "danger" }
        ];

        var systemWrap = $("dashboardSystemGrid");
        if (systemWrap) {
          systemWrap.innerHTML = systemMetrics.map(function (item) {
            return "<div class='system-metric' data-tone='" + item.tone + "'>" +
              "<div class='system-metric-label'><span class='status-dot " + item.tone + "'></span>" + escapeHtml(item.label) + "</div>" +
              "<div class='system-metric-value' title='" + escapeHtml(String(item.value)) + "'>" + escapeHtml(String(item.value)) + "</div>" +
              "<div class='system-metric-foot'>" + escapeHtml(item.foot) + "</div>" +
              "</div>";
          }).join("");
        }

        var attentionItems = [];
        if (!isOnline) attentionItems.push({ tone: "danger", title: "后台发布状态需要确认", detail: "当前状态：" + (data.publishStatus || "unknown"), target: "sync", action: "检查同步" });
        if (opsUnavailable) attentionItems.push({ tone: "warning", title: "运营状态暂时不可用", detail: "未能读取 runtime pointer 与同步状态，请刷新后重试。", target: "dashboard", action: "重新读取" });
        if (ops && !ops.activeReleaseVersion) attentionItems.push({ tone: "danger", title: "当前没有 Active Release", detail: "runtime pointer 尚未生效；Published 不等于 Active。", target: "sync", action: "查看管线" });
        if (staleResourceCount > 0) attentionItems.push({ tone: "warning", title: staleResourceCount + " 类核心资源更新过旧", detail: "超过 30 天未更新，建议先查看质量报告。", target: "quality", action: "查看质量" });
        if ((counts.openFeedbackCount || 0) > 0) attentionItems.push({ tone: "warning", title: (counts.openFeedbackCount || 0) + " 条反馈尚未处理", detail: "及时标记处理状态并记录结论。", target: "feedback", action: "处理反馈" });
        var pendingNoticeCount = Math.max(0, (counts.noticeCount || 0) - (counts.enabledNoticeCount || 0));
        if (pendingNoticeCount > 0) attentionItems.push({ tone: "info", title: pendingNoticeCount + " 条公告未启用", detail: "请确认内容是否需要发布。", target: "notices", action: "查看公告" });
        if (attentionItems.length === 0) attentionItems.push({ tone: "success", title: "当前没有紧急待办", detail: "系统、版本、数据更新与用户反馈均无明显阻塞。" });

        var attentionWrap = $("dashboardAttentionList");
        var attentionPanel = attentionWrap && attentionWrap.closest(".attention-panel");
        if (attentionPanel) attentionPanel.classList.toggle("is-clear", attentionItems.length === 1 && attentionItems[0].tone === "success");
        if ($("dashboardAttentionCount")) {
          var actionableCount = attentionItems.filter(function (item) { return item.tone !== "success"; }).length;
          $("dashboardAttentionCount").className = "badge " + (actionableCount ? "warning" : "success");
          $("dashboardAttentionCount").textContent = actionableCount + " 项";
        }
        if (attentionWrap) {
          attentionWrap.innerHTML = attentionItems.map(function (item) {
            var action = item.target ? "<button type='button' class='ghost' data-dashboard-target='" + item.target + "'>" + escapeHtml(item.action) + "</button>" : "";
            return "<div class='attention-item'><span class='status-dot " + item.tone + "'></span><div class='attention-item-copy'><strong>" + escapeHtml(item.title) + "</strong><small>" + escapeHtml(item.detail) + "</small></div>" + action + "</div>";
          }).join("");
          attentionWrap.querySelectorAll("[data-dashboard-target]").forEach(function (button) {
            button.addEventListener("click", function () { switchSection(button.dataset.dashboardTarget); });
          });
        }

        var stats = [
          { label: "行政班", val: counts.classScheduleCount || 0, foot: "更新于 " + formatDate(version.classScheduleUpdatedAt) },
          { label: "教师", val: counts.teacherScheduleCount || 0, foot: "更新于 " + formatDate(version.teacherScheduleUpdatedAt) },
          { label: "教室", val: counts.classroomScheduleCount || 0, foot: "更新于 " + formatDate(version.classroomScheduleUpdatedAt) },
          { label: "课程", val: counts.courseScheduleCount || 0, foot: "更新于 " + formatDate(version.courseScheduleUpdatedAt) }
        ];

        var wrap = $("statsGrid");
        if (wrap) {
          wrap.textContent = "";
          stats.forEach(function (item) {
            var card = document.createElement("div");
            card.className = "stat-card card";
            var head = document.createElement("div");
            head.className = "stat-head";
            head.textContent = item.label;
            card.appendChild(head);
            var num = document.createElement("div");
            num.className = "stat-num";
            num.textContent = item.val;
            card.appendChild(num);
            var foot = document.createElement("div");
            foot.className = "stat-foot";
            foot.title = item.foot;
            foot.textContent = item.foot;
            card.appendChild(foot);
            wrap.appendChild(card);
          });
        }

        $("envTag").textContent = data.publishStatus === "online" ? "production" : "local";
        $("envTag").className = "env-tag " + (data.publishStatus === "online" ? "production" : "local");
        $("versionLabel").textContent = ops && ops.activeReleaseVersion || version.releaseVersion || "-";

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

        // 2. 真实学院与教室占用横向柱状图
        var collWrap = $("collegeBarChart");
        collWrap.innerHTML = "";

        var collData = data.collegeDistribution || [];
        if (collData.length === 0) {
          collWrap.innerHTML = "<div style='color: var(--muted); font-size: 13px; padding: 12px 0;'>暂无学院分布数据</div>";
        }
        collData.forEach(function(c) {
          var row = document.createElement("div");
          row.className = "bar-chart-row";
          row.innerHTML = "<div class='bar-chart-label'>" + escapeHtml(c.name) + "</div>" +
                          "<div class='bar-chart-track'><div class='bar-chart-bar' style='width: " + c.pct + "%'></div></div>" +
                          "<div class='bar-chart-value'>" + c.count + "</div>";
          collWrap.appendChild(row);
        });

        var classrWrap = $("classroomBarChart");
        classrWrap.innerHTML = "";
        var heatmapMeta = data.classroomHeatmapMeta || {};
        var roomData = heatmapMeta.topRooms || [];
        if (roomData.length === 0) {
          classrWrap.innerHTML = "<div style='color: var(--muted); font-size: 13px; padding: 12px 0;'>暂无真实教室占用排行数据</div>";
        }
        roomData.forEach(function(r) {
          var rate = Number(r.occupationRate || 0);
          var row = document.createElement("div");
          row.className = "bar-chart-row";
          row.innerHTML = "<div class='bar-chart-label'>" + escapeHtml(r.roomName || "-") + "</div>" +
                          "<div class='bar-chart-track'><div class='bar-chart-bar' style='width: " + rate + "%; background: var(--primary);'></div></div>" +
                          "<div class='bar-chart-value'>" + rate + "%</div>";
          classrWrap.appendChild(row);
        });

        // 3. 今日反馈预览
        var feedWrap = $("recentFeedbackPreview");
        feedWrap.textContent = "";
        var recent = state.feedbacks.filter(function(x) { return x.status === "open"; }).slice(0, 3);
        if (recent.length === 0) {
          var emptyDiv = document.createElement("div");
          emptyDiv.style = "color: var(--muted); font-size: 13px; text-align: center; padding: 20px 0;";
          emptyDiv.textContent = "当前没有待处理反馈";
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
          renderGithubStyleHeatmap(data);
        }
      }

      function heatmapColor(value) {
        if (value <= 0) return "#eef3f8";
        if (value <= 25) return "#cfe0ff";
        if (value <= 50) return "#8fbaff";
        if (value <= 75) return "#4f86e8";
        return "#1d4ed8";
      }

      function getHotBuildingsFromDetails(details) {
        var counts = {};
        (details || []).forEach(function(item) {
          var roomName = String(item.roomName || "").trim();
          if (!roomName) return;
          var match = roomName.match(/^([A-Za-z]*\\d+|[^\\d\\s-]+)/);
          var building = match ? match[1] : roomName.split(/[\\s-]/)[0];
          if (!building) return;
          counts[building] = (counts[building] || 0) + 1;
        });
        var ranked = Object.keys(counts).sort(function(left, right) {
          return counts[right] - counts[left];
        });
        return ranked.slice(0, 3).join("、") || "暂无";
      }

      function renderHeatmapMeta(meta) {
        var wrap = $("classroomHeatmapMeta");
        if (!wrap) return;
        wrap.textContent = "";
        [
          "数据源：" + (meta.source || "-"),
          "教室总数：" + (meta.totalClassrooms || 0),
          "已占用峰值：" + (meta.maxOccupancy || 0),
          "更新时间：" + formatDate(meta.updatedAt)
        ].forEach(function(text) {
          var badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = text;
          wrap.appendChild(badge);
        });
      }

      function renderHeatmapSummary(meta) {
        var wrap = $("classroomHeatmapSummary");
        if (!wrap) return;
        wrap.textContent = "";
        var summary = (meta && meta.summary) || {};
        [
          { title: "最繁忙时段", value: summary.maxOccupancyTime || "-", desc: (summary.maxOccupancyRate || 0) + "% 占用率" },
          { title: "最空闲时段", value: summary.minOccupancyTime || "-", desc: (summary.minOccupancyRate || 0) + "% 占用率" },
          { title: "工作日平均占用率", value: (summary.workdayAvg || 0) + "%", desc: "周一至周五" },
          { title: "周末平均占用率", value: (summary.weekendAvg || 0) + "%", desc: "周六至周日" }
        ].forEach(function(item) {
          var card = document.createElement("div");
          card.className = "heatmap-summary-card";
          card.innerHTML = "<div class='heatmap-summary-title'>" + escapeHtml(item.title) + "</div>" +
            "<div class='heatmap-summary-value'>" + escapeHtml(item.value) + "</div>" +
            "<div class='heatmap-summary-desc'>" + escapeHtml(item.desc) + "</div>";
          wrap.appendChild(card);
        });
      }

      function getVisibleHeatmapDays(dayType) {
        if (dayType === "workday") return [0, 1, 2, 3, 4];
        if (dayType === "weekend") return [5, 6];
        return [0, 1, 2, 3, 4, 5, 6];
      }

      function renderHeatmapDetail(payload) {
        var panel = $("classroomHeatmapDetailPanel");
        var title = $("heatmapDetailTitle");
        var stats = $("heatmapDetailStats");
        var list = $("heatmapDetailList");
        if (!panel || !title || !stats || !list) return;

        var details = Array.isArray(payload.details) ? payload.details : [];
        title.textContent = payload.weekdayLabel + " 第" + payload.section + "节";
        stats.innerHTML = "<div><span>当前时段</span><strong>" + escapeHtml(payload.weekdayLabel + " 第" + payload.section + "节") + "</strong></div>" +
          "<div><span>占用率</span><strong>" + payload.rate + "%</strong></div>" +
          "<div><span>占用教室数</span><strong>" + payload.occupied + " / " + payload.totalClassrooms + "</strong></div>";

        list.textContent = "";
        if (details.length === 0) {
          var empty = document.createElement("div");
          empty.className = "heatmap-detail-item";
          empty.textContent = "该时段暂无已识别课程样例。";
          list.appendChild(empty);
          panel.classList.add("show");
          return;
        }

        var roomMap = {};
        details.forEach(function(item) {
          var roomName = item.roomName || "未标明教室";
          if (!roomMap[roomName]) roomMap[roomName] = 0;
          roomMap[roomName] += 1;
        });
        Object.keys(roomMap).sort(function(left, right) {
          return roomMap[right] - roomMap[left];
        }).slice(0, 10).forEach(function(roomName) {
          var item = document.createElement("div");
          item.className = "heatmap-detail-item";
          item.innerHTML = "<span class='heatmap-detail-room'>" + escapeHtml(roomName) + "</span>" +
            "<span class='heatmap-detail-teacher'>占用记录：" + roomMap[roomName] + "</span>";
          list.appendChild(item);
        });

        details.slice(0, 5).forEach(function(course) {
          var item = document.createElement("div");
          item.className = "heatmap-detail-item";
          item.innerHTML = "<span class='heatmap-detail-course'>" + escapeHtml(course.courseName || "未知课程") + "</span>" +
            "<span class='heatmap-detail-room'>" + escapeHtml(course.roomName || "未标明教室") + "</span>" +
            "<span class='heatmap-detail-teacher'>" + escapeHtml(course.teacher || "未知教师") + "</span>";
          list.appendChild(item);
        });

        panel.classList.add("show");
      }

      function renderGithubStyleHeatmap(data, dayType) {
        data = data || {};
        var heatmapWrap = $("classroomHeatmap");
        var noticeWrap = $("classroomHeatmapNotice");
        var heatmapData = data.classroomHeatmap || [];
        var countData = data.classroomHeatmapCounts || [];
        var detailData = data.classroomHeatmapDetails || [];
        var meta = data.classroomHeatmapMeta || {};
        var weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
        var visibleDays = getVisibleHeatmapDays(dayType || state.heatmapDayType || "all");
        state.classroomHeatmapData = data;
        renderHeatmapMeta(meta);
        renderHeatmapSummary(meta);
        if (!heatmapWrap || !noticeWrap) return;
        heatmapWrap.innerHTML = "";
        noticeWrap.textContent = "";

        if ((meta.totalClassrooms || 0) === 0) {
          heatmapWrap.className = "heatmap-empty";
          heatmapWrap.textContent = "缺少可计算的教室课表数据源。当前读取到：" + (meta.source || "未知来源") + "；教室总数 0；已识别占用槽位 " + (meta.totalOccupiedSlots || 0) + "。无法计算原因：" + (meta.emptyReason || "未读取到 classroomSchedules 或 classSchedules。");
          return;
        }

        heatmapWrap.className = "heatmap-container";
        heatmapWrap.style.gridTemplateColumns = "64px repeat(" + visibleDays.length + ", minmax(72px, 1fr))";
        if ((meta.totalOccupiedSlots || 0) === 0) {
          var alert = document.createElement("div");
          alert.className = "heatmap-alert";
          alert.textContent = "已读取到 " + (meta.totalClassrooms || 0) + " 间教室，但未识别到有效节次字段。数据源：" + (meta.source || "-") + "，原因：" + (meta.emptyReason || "no-recognized-course-slots");
          noticeWrap.appendChild(alert);
        }

        ["节次"].concat(visibleDays.map(function(day) { return weekdays[day]; })).forEach(function(label) {
          var div = document.createElement("div");
          div.className = "heatmap-header";
          div.textContent = label;
          heatmapWrap.appendChild(div);
        });

        for (let section = 1; section <= 14; section++) {
          var axis = document.createElement("div");
          axis.className = "heatmap-axis";
          axis.textContent = "第" + section + "节";
          heatmapWrap.appendChild(axis);

          visibleDays.forEach(function(day) {
            var val = heatmapData[day] && heatmapData[day][section - 1] !== undefined
              ? Number(heatmapData[day][section - 1])
              : 0;
            var occupied = countData[day] && countData[day][section - 1] !== undefined
              ? Number(countData[day][section - 1])
              : 0;
            var details = detailData[day] && Array.isArray(detailData[day][section - 1])
              ? detailData[day][section - 1]
              : [];
            var cell = document.createElement("div");
            cell.className = "heatmap-cell";
            cell.style.background = heatmapColor(val);
            var hotBuildings = getHotBuildingsFromDetails(details);
            cell.title = weekdays[day] + " 第" + section + "节\\n占用率：" + val + "%\\n占用教室：" + occupied + "/" + (meta.totalClassrooms || 0) + "\\n热门教学楼：" + hotBuildings;
            cell.setAttribute("aria-label", weekdays[day] + " 第" + section + "节，占用率 " + val + "%");
            var label = document.createElement("span");
            label.textContent = val + "%";
            cell.appendChild(label);
            cell.addEventListener("click", function() {
              renderHeatmapDetail({
                weekdayLabel: weekdays[day],
                section: section,
                rate: val,
                occupied: occupied,
                totalClassrooms: meta.totalClassrooms || 0,
                details: details
              });
            });
            heatmapWrap.appendChild(cell);
          });
        }
      }

      function openFeedbackDrawerById(id) {
        var fb = state.feedbacks.find(x => x.id === id);
        if (fb) openFeedbackDrawer(fb);
      }
      window.openFeedbackDrawerById = openFeedbackDrawerById;

      // Panel 2: 数据资源 Data Catalog
      function loadCatalog() {
        var semester = state.catalogSemester;
        var keyword = state.catalogKeyword;
        var type = state.catalogType;
        var page = state.catalogPage;
        var pageSize = state.catalogPageSize;
        var table = $("catalogTable");
        var tbody = $("catalogListTable");
        
        setStatus("正在获取 " + type + " 资源列表...");
        if (table) table.setAttribute("aria-busy", "true");
        if (tbody) tbody.innerHTML = "<tr><td colspan='8' class='catalog-loading-state'>正在加载数据资源…</td></tr>";
        if ($("catalogResultCount")) $("catalogResultCount").textContent = "正在加载…";
        if ($("catalogPaginationInfo")) $("catalogPaginationInfo").textContent = "正在读取结果";
        if ($("catalogPrevBtn")) $("catalogPrevBtn").disabled = true;
        if ($("catalogNextBtn")) $("catalogNextBtn").disabled = true;
        return api("/api/admin/catalog/list?type=" + type + "&semester=" + semester + "&keyword=" + encodeURIComponent(keyword) + "&page=" + page + "&pageSize=" + pageSize)
          .then(function(data) {
            state.catalogItems = data.items || [];
            state.catalogTotal = data.total || 0;
            renderCatalogTable();
            setStatus("数据获取成功。共 " + state.catalogTotal + " 个实体。");
          })
          .catch(function(err) {
            state.catalogItems = [];
            state.catalogTotal = 0;
            if (tbody) tbody.innerHTML = "<tr><td colspan='8' class='catalog-error-state' role='alert'>资源加载失败：" + escapeHtml(err.message || "未知错误") + "。请刷新后重试。</td></tr>";
            if ($("catalogResultCount")) $("catalogResultCount").textContent = "加载失败";
            if ($("catalogPaginationInfo")) $("catalogPaginationInfo").textContent = "未能读取结果";
            showToast(err.message, "error");
            setStatus(err.message);
          })
          .then(function() {
            if (table) table.removeAttribute("aria-busy");
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
          if ($("catalogResultCount")) $("catalogResultCount").textContent = "0 条结果";
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
        if ($("catalogResultCount")) $("catalogResultCount").textContent = state.catalogTotal + " 条结果";
        
        $("catalogPrevBtn").disabled = state.catalogPage <= 1;
        $("catalogNextBtn").disabled = state.catalogPage * state.catalogPageSize >= state.catalogTotal;
      }

      window.downloadSnapshot = function(filename) {
        window.open("/api/admin/backups/download?filename=../snapshots/" + filename);
      };

      // Drawer 详细信息拉取
      window.openCatalogDetail = function(type, id) {
        var returnFocusElement = document.activeElement;
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
            renderMiniWeekSchedule();
            if ($("catalogRawJson")) {
              $("catalogRawJson").textContent = JSON.stringify(res.data.original || res.data, null, 2);
            }
            openDetailDrawer("catalogDrawer", "catalogDrawerMask", "closeCatalogDrawerBtn", returnFocusElement);
          })
          .catch(function(error) {
            showToast(error.message || "读取资源详情失败", "error");
          });
      };

      function closeCatalogDrawer(returnFocus) {
        closeDetailDrawer("catalogDrawer", "catalogDrawerMask", returnFocus);
      }

      function saveCatalogMetaDetail() {
        var data = state.currentCatalogDetail || {};
        if (!data.type || !data.id) {
          showToast("当前没有可保存的资源详情", "error");
          return;
        }
        api("/api/admin/catalog/meta", {
          method: "POST",
          body: JSON.stringify({
            type: data.type,
            id: data.id,
            displayName: value("catalogMetaDisplayName"),
            note: value("catalogMetaNote"),
            hidden: boolValue("catalogMetaHidden"),
            tags: value("catalogMetaTags").split(",").map(function(item) { return item.trim(); }).filter(Boolean)
          })
        })
          .then(function() {
            showToast("资源元数据已保存", "success");
            closeCatalogDrawer();
            loadCatalog();
          })
          .catch(function(error) {
            showToast(error.message || "保存失败", "error");
          });
      }

      function exportCatalogData(format) {
        var data = state.currentCatalogDetail || {};
        if (!data.type || !data.id) {
          showToast("当前没有可导出的资源详情", "error");
          return;
        }
        window.open("/api/admin/export?type=" + encodeURIComponent(data.type) + "&id=" + encodeURIComponent(data.id) + "&format=" + encodeURIComponent(format || "json"));
      }

      function renderMiniWeekSchedule() {
        var grid = $("miniScheduleGrid");
        if (!grid) return;
        var detail = state.currentCatalogDetail || {};
        var courses = (detail.data && detail.data.courses) || detail.courses || (detail.original && detail.original.courses) || [];
        grid.innerHTML = "";
        if (!Array.isArray(courses) || courses.length === 0) {
          grid.innerHTML = "<div style='padding:12px;color:var(--muted);font-size:12px;'>暂无课程明细可预览。</div>";
          return;
        }
        if ($("previewWeekLabel")) {
          $("previewWeekLabel").textContent = "第 " + state.previewWeek + " 周";
        }
        courses.slice(0, 60).forEach(function(course) {
          var item = document.createElement("div");
          item.className = "mini-course";
          item.innerHTML =
            "<strong>" + escapeHtml(course.courseName || course.displayCourseName || course.name || "课程") + "</strong>" +
            "<span>" + escapeHtml(course.teacherName || course.teacher || "-") + " · " + escapeHtml(course.classroom || course.roomName || course.location || "-") + "</span>";
          grid.appendChild(item);
        });
      }

      function generateTermList(defaultTerm) {
        var currentYear = new Date().getFullYear();
        var startYear = currentYear - 2;
        var terms = [];
        for (var i = 0; i < 5; i++) {
          var y = startYear + i;
          terms.push(y + "-" + (y + 1) + "-1");
          terms.push(y + "-" + (y + 1) + "-2");
        }
        if (defaultTerm && terms.indexOf(defaultTerm) === -1 && defaultTerm !== "custom" && defaultTerm !== "all") {
          terms.push(defaultTerm);
        }
        // 降序排序，最新的学期在最前面
        terms.sort(function(a, b) {
          return b.localeCompare(a);
        });
        return terms;
      }

      function getTermStartDate(term) {
        var terms = state.terms || [];
        var matched = terms.find(function(item) { return item && item.term === term; });
        return matched && matched.termStartDate || "";
      }

      function syncWizardStartDateWithTerm(force) {
        var input = $("wizardStartDate");
        if (!input) return;
        var term = getTermValue("wizardTerm", "wizardTermCustom") || (state.dashboard && state.dashboard.currentSemester) || "";
        var mappedStartDate = getTermStartDate(term);
        if (!mappedStartDate) return;
        if (force || !state.wizardStartDateTouched || !input.value) {
          input.value = mappedStartDate;
        }
      }

      function initTermSelect(selectId, customInputId, defaultTerm, includeAllOption) {
        var select = $(selectId);
        if (!select) return;
        select.innerHTML = "";
        
        if (includeAllOption) {
          var optAll = document.createElement("option");
          optAll.value = "all";
          optAll.textContent = "全部学期";
          select.appendChild(optAll);
        }
        
        var terms = generateTermList(defaultTerm);
        terms.forEach(function(t) {
          var opt = document.createElement("option");
          opt.value = t;
          opt.textContent = t;
          if (t === defaultTerm && !includeAllOption) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
        
        if (customInputId) {
          var optCustom = document.createElement("option");
          optCustom.value = "custom";
          optCustom.textContent = "自定义学期...";
          select.appendChild(optCustom);
          
          var customInput = $(customInputId);
          if (customInput) {
            customInput.style.display = "none";
            customInput.value = defaultTerm || "";
          }
          
          select.addEventListener("change", function() {
            if (select.value === "custom") {
              customInput.style.display = "inline-block";
              customInput.focus();
            } else {
              customInput.style.display = "none";
              customInput.value = select.value;
            }
            if (selectId === "wizardTerm") {
              syncWizardStartDateWithTerm(false);
              updateWizardCommand();
            }
          });
          
          if (customInput) {
            customInput.addEventListener("input", function() {
              if (selectId === "wizardTerm") {
                syncWizardStartDateWithTerm(false);
                updateWizardCommand();
              }
            });
          }
        } else {
          select.addEventListener("change", function() {
            if (selectId === "releaseTermFilter") {
              renderReleaseHistoryTable();
            }
          });
        }
      }

      function getTermValue(selectId, customInputId) {
        var sel = $(selectId);
        if (sel && sel.value === "custom") {
          var customInput = $(customInputId);
          return customInput ? customInput.value.trim() : "";
        }
        return sel ? sel.value : "";
      }

      // Panel 3: 同步中心 Sync Center
      function loadSyncStatusLegacy() {
        setStatus("正在获取系统同步状态与运维指南...");
        return api("/api/admin/sync/status")
          .then(function(res) {
            state.syncStatus = res.data;
            setSyncOnlineState(true);
            renderSyncStatusGrid();
            if ($("syncLastRefreshAt")) {
              $("syncLastRefreshAt").textContent = "最近刷新：" + formatDate(new Date().toISOString());
            }
            
            // 初始化所有学期下拉选择器
            var defaultTerm = state.syncStatus ? state.syncStatus.semester : (state.dashboard && state.dashboard.currentSemester) || "";
            if (!state.termSelectsInitialized) {
              initTermSelect("wizardTerm", "wizardTermCustom", defaultTerm);
              initTermSelect("relayTaskTerm", "relayTaskTermCustom", defaultTerm);
              initTermSelect("releaseTermFilter", null, defaultTerm, true);
              syncWizardStartDateWithTerm(true);
              state.termSelectsInitialized = true;
            }

            // 更新向导命令
            updateWizardCommand();
            
            // 拉取历史
            return api("/api/admin/sync/history");
          })
          .then(function(res) {
            state.syncHistory = res.items || [];
            renderSyncHistoryTable();
            
            // 拉取 release 历史
            return api("/api/admin/sync/releases");
          })
          .then(function(res) {
            state.releasesHistory = res.releases || [];
            renderReleaseHistoryTable();
            return Promise.allSettled([
              api("/api/admin/relay/tasks"),
              api("/api/admin/relay/uploads"),
              api("/api/admin/staging/status"),
              api("/api/admin/system/load"),
              api("/api/admin/storage/status")
            ]);
          })
          .then(function(results) {
            var taskResult = results[0];
            var uploadResult = results[1];
            var stagingUploadResult = results[2];
            var systemLoadResult = results[3];
            var storageStatusResult = results[4];
            if (taskResult && taskResult.status === "fulfilled") {
              state.relayTasks = taskResult.value.tasks || [];
            }
            if (uploadResult && uploadResult.status === "fulfilled") {
              state.relayUploads = uploadResult.value.uploads || [];
            }
            if (stagingUploadResult && stagingUploadResult.status === "fulfilled") {
              state.stagingUploads = stagingUploadResult.value.uploads || [];
            }
            if (systemLoadResult && systemLoadResult.status === "fulfilled") {
              state.systemLoad = systemLoadResult.value || null;
            }
            if (storageStatusResult && storageStatusResult.status === "fulfilled") {
              state.storageStatus = storageStatusResult.value || null;
            }
            renderRelayTasks();
            renderRelayUploads();
            renderStagingUploads();
            renderRuntimeStorage();
          })
          .catch(function(err) {
            setSyncOnlineState(false);
            showToast(err.message, "error");
            showModuleError("sync", err);
          });
      }

      function loadSyncHistoryPanel() {
        return api("/api/admin/sync/history?limit=50")
          .then(function(res) {
            state.syncHistory = res.items || [];
            renderSyncHistoryTable();
            return res;
          })
          .catch(function(err) {
            showModuleError("sync-history", err);
            throw err;
          });
      }

      function loadReleaseHistoryPanel() {
        return api("/api/admin/sync/releases?limit=50")
          .then(function(res) {
            state.releasesHistory = res.releases || [];
            renderReleaseHistoryTable();
            return res;
          })
          .catch(function(err) {
            showModuleError("sync-releases", err);
            throw err;
          });
      }

      function loadRelayPanels() {
        api("/api/admin/relay/tasks")
          .then(function(res) {
            state.relayTasks = res.tasks || [];
            renderRelayTasks();
          })
          .catch(function(err) { showModuleError("relay-tasks", err); });
        api("/api/admin/relay/uploads?limit=50")
          .then(function(res) {
            state.relayUploads = res.uploads || [];
            renderRelayUploads();
          })
          .catch(function(err) { showModuleError("relay-uploads", err); });
      }

      function loadStagingUploadsPanel() {
        var pageSize = Number(state.stagingUploadPageSize || 50) || 50;
        var params = ["limit=" + encodeURIComponent(pageSize), "cursor=" + encodeURIComponent(state.stagingUploadCursor || 0)];
        if (state.stagingUploadFilters && state.stagingUploadFilters.term) {
          params.push("term=" + encodeURIComponent(state.stagingUploadFilters.term));
        }
        if (state.stagingUploadFilters && state.stagingUploadFilters.status && state.stagingUploadFilters.status !== "incomplete") {
          params.push("status=" + encodeURIComponent(state.stagingUploadFilters.status));
        }
        return api("/api/admin/staging/status?" + params.join("&"))
          .then(function(res) {
            state.stagingUploads = res.uploads || [];
            state.stagingUploadTotal = Number(res.total || (res.uploads || []).length || 0);
            state.stagingUploadNextCursor = res.nextCursor == null ? null : Number(res.nextCursor);
            renderStagingUploads();
            return res;
          })
          .catch(function(err) {
            showModuleError("staging-uploads", err);
            renderStagingUploads();
            throw err;
          });
      }

      function loadRuntimeStatusPanel() {
        api("/api/admin/system/load")
          .then(function(res) {
            state.systemLoad = res || null;
          })
          .catch(function(err) { showModuleError("system-load", err); });
        refreshStorageStatus(false).catch(function(err) {
          showModuleError("storage-status", err);
        });
      }

      function renderPublisherStatus(payload) {
        var latest = payload && payload.latest || null;
        var receipt = latest && latest.receipt || {};
        var runState = latest && latest.state || {};
        var error = latest && latest.error || {};
        var oracle = receipt.oracle || receipt.oracleResult || {};
        var cloudbase = receipt.cloudbase || receipt.cloudbaseResult || {};
        var perf = receipt.performanceSummary || {};
        function durationText(ms) {
          var value = Number(ms);
          if (!Number.isFinite(value) || value < 0) return "-";
          if (value < 1000) return Math.round(value) + "ms";
          if (value < 60000) return (value / 1000).toFixed(1) + "s";
          return Math.floor(value / 60000) + "m " + Math.round((value % 60000) / 1000) + "s";
        }
        var overall = receipt.overallStatus || receipt.status || runState.status || (error.message ? "failed" : "waiting");
        var hashUploadMs = perf.hashAndDiffMs == null && perf.gzipAndUploadMs == null ? null : (Number(perf.hashAndDiffMs || 0) + Number(perf.gzipAndUploadMs || 0));
        var rows = [
          ["本地采集", receipt.crawlDurationMs ? ("完成 · " + Math.round(receipt.crawlDurationMs / 1000) + "s") : (runState.stage || "等待运行")],
          ["Staging 上传", receipt.stagingUploadId || receipt.stagingStatus || "-"],
          ["Oracle 发布", oracle.status || receipt.oracleStatus || receipt.oracleReleaseVersion || "-"],
          ["OpenResty", receipt.openRestyStatus || oracle.openRestyStatus || "-"],
          ["CloudBase", cloudbase.status || receipt.cloudbaseStatus || receipt.cloudbaseReleaseVersion || "-"],
          ["双源一致性", receipt.dualSourceConsistent === true ? "一致" : (receipt.dualSourceConsistent === false ? "不一致" : "-")],
          ["session 检查", durationText(perf.sessionCheckMs)],
          ["100 网采集", durationText(perf.directoryAndScheduleFetchMs)],
          ["规范化/生成", durationText(perf.normalizeAndStagingBuildMs)],
          ["hash/gzip/上传", durationText(hashUploadMs)],
          ["服务端校验", durationText(perf.serverValidationMs)],
          ["Release 发布", durationText(perf.releaseMs)],
          ["CloudBase 镜像", durationText(perf.cloudbaseMirrorMs)],
        ];
        var grid = $("publisherStatusGrid");
        if (grid) {
          grid.innerHTML = rows.map(function(row) {
            return "<div class='openresty-meta-item'><span>" + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1] || "-") + "</strong></div>";
          }).join("");
        }
        if ($("publisherStatusBadge")) {
          var ok = overall === "success" || overall === "completed" || overall === "no-change";
          $("publisherStatusBadge").className = "badge " + (ok ? "success" : (overall === "failed" || overall === "partial-success" ? "warning" : "info"));
          $("publisherStatusBadge").textContent = latest ? relayStatusText(overall) : "等待本机回执";
        }
        if ($("publisherReceiptNote")) {
          $("publisherReceiptNote").textContent = latest
            ? ("最近 runId: " + latest.runId + " · 更新时间: " + formatDate(latest.updatedAt) + (error.message ? " · 错误: " + error.message : ""))
            : "后台只显示本机 Publisher 回执，不会直接访问 100 网；全校课表采集必须在校园网/VPN 本机执行。";
        }
      }

      function loadPublisherStatusPanel() {
        return api("/api/admin/publisher/receipt")
          .then(function(res) {
            renderPublisherStatus(res);
            return res;
          })
          .catch(function(err) {
            showModuleError("publisher-status", err);
            renderPublisherStatus(null);
            throw err;
          });
      }

      function loadSyncLazyPanels() {
        ignoreLoadError(loadSyncHistoryPanel());
        ignoreLoadError(loadReleaseHistoryPanel());
        loadRelayPanels();
        ignoreLoadError(loadStagingUploadsPanel());
        ignoreLoadError(loadPublisherStatusPanel());
        loadRuntimeStatusPanel();
      }

      function setSyncOnlineState(online) {
        var badge = $("syncOnlineStatus");
        if (!badge) return;
        badge.className = "sync-online-status " + (online ? "is-online" : "is-offline");
        badge.innerHTML = "<span class='status-dot " + (online ? "success" : "danger") + "'></span>在线状态：" + (online ? "正常" : "异常");
      }

      function loadSyncStatus(options) {
        options = options || {};
        var now = Date.now();
        if (!options.force && state.lastSyncLoadAt && now - state.lastSyncLoadAt < 800 && state.apiInflight["GET /api/admin/sync/status"]) {
          return state.apiInflight["GET /api/admin/sync/status"];
        }
        state.lastSyncLoadAt = now;
        setStatus("正在获取系统同步状态与运维指南...");
        return api("/api/admin/sync/status")
          .then(function(res) {
            state.syncStatus = res.data;
            setSyncOnlineState(true);
            renderSyncStatusGrid();
            if ($("syncLastRefreshAt")) {
              $("syncLastRefreshAt").textContent = "最近刷新：" + formatDate(new Date().toISOString());
            }
            var defaultTerm = state.syncStatus ? state.syncStatus.semester : (state.dashboard && state.dashboard.currentSemester) || "";
            if (!state.termSelectsInitialized) {
              initTermSelect("wizardTerm", "wizardTermCustom", defaultTerm);
              initTermSelect("relayTaskTerm", "relayTaskTermCustom", defaultTerm);
              initTermSelect("releaseTermFilter", null, defaultTerm, true);
              syncWizardStartDateWithTerm(true);
              state.termSelectsInitialized = true;
            }
            updateWizardCommand();
            loadSyncLazyPanels();
            return state.syncStatus;
          })
          .catch(function(err) {
            setSyncOnlineState(false);
            showToast(err.message, "error");
            showModuleError("sync", err);
            throw err;
          });
      }

      function renderSyncPipelineState(data, details) {
        data = data || {};
        details = details || {};
        var stageIds = ["syncStageStaging", "syncStageRelease", "syncStageStatic", "syncStageVerify", "syncStageActive"];
        var labels = ["Staging 上传", "Release Pack 生成", "OpenResty 静态目录同步", "URL 验证", "Active Pointer 生效"];
        var stateLabels = { pending: "待处理", current: "当前阶段", complete: "已完成", blocked: "已阻塞" };
        var states = ["pending", "pending", "pending", "pending", "pending"];
        var pendingItems = Array.isArray(data.pendingItems) ? data.pendingItems : [];
        var hasBlocker = pendingItems.some(function (item) { return item && item.severity === "danger"; });
        var latestStaging = data.latestStagingUpload || null;
        var hasStaging = Boolean(latestStaging || data.stagingCanonicalHash || data.stagingNeedsPublish);
        var hasPublishedVersion = Boolean(data.releaseVersion && data.releaseVersion !== "-");
        var hasActivePointer = Boolean(data.activeReleaseVersion);
        var pointerMatchesRelease = Boolean(hasActivePointer && hasPublishedVersion && data.activeReleaseVersion === data.releaseVersion);
        var releaseHealthy = Boolean(data.releasePackHealthy || data.releasePackStatus && data.releasePackStatus.healthy);
        var staticDirectorySynced = Boolean(details.staticDirectorySynced);
        var staticUrlVerified = Boolean(details.staticUrlVerified);
        var currentIndex = 0;
        var nextText = "上传或确认最新 Staging 候选数据";

        if (hasStaging) {
          states[0] = "complete";
          currentIndex = 1;
          nextText = "生成并验证新的 Release Pack";
        }
        if (hasPublishedVersion) {
          states[0] = "complete";
          currentIndex = 1;
          nextText = "检查或重建当前版本的 Release Pack";
        }
        if (hasPublishedVersion && releaseHealthy) {
          states[0] = "complete";
          states[1] = "complete";
          currentIndex = 2;
          nextText = "同步当前 Release 到 OpenResty 静态目录";
        }
        if (hasPublishedVersion && releaseHealthy && staticDirectorySynced) {
          states[2] = "complete";
          currentIndex = 3;
          nextText = "验证 manifest、class index 与 empty-room URL";
        }
        if (hasPublishedVersion && releaseHealthy && staticDirectorySynced && staticUrlVerified) {
          states[3] = "complete";
          currentIndex = 4;
          nextText = "确认 runtime pointer 指向已验证版本";
        }
        if (pointerMatchesRelease && releaseHealthy && staticDirectorySynced && staticUrlVerified && !hasBlocker) {
          states[4] = "complete";
          currentIndex = 4;
          nextText = "链路已完成；仅在有新数据时再次发布";
        } else {
          states[currentIndex] = hasBlocker ? "blocked" : "current";
        }
        if (hasBlocker) {
          nextText = pendingItems.filter(function (item) { return item && item.severity === "danger"; }).map(function (item) { return item.title; })[0] || "先处理发布阻塞项";
        } else if (data.stagingNeedsPublish && data.nextAction && data.nextAction.message) {
          nextText = data.nextAction.message;
        }

        stageIds.forEach(function (id, index) {
          var stage = $(id);
          if (!stage) return;
          stage.dataset.stageState = states[index];
          stage.setAttribute("aria-label", labels[index] + "：" + stateLabels[states[index]]);
          if (states[index] === "current" || states[index] === "blocked") stage.setAttribute("aria-current", "step");
          else stage.removeAttribute("aria-current");
        });
        if ($("syncCurrentStageLabel")) {
          $("syncCurrentStageLabel").textContent = states[4] === "complete" ? "链路已完成" : (hasBlocker ? labels[currentIndex] + " · 已阻塞" : labels[currentIndex]);
        }
        if ($("syncNextStepText")) $("syncNextStepText").textContent = nextText;
      }

      function deriveStaticDirectorySynced(data, staticSync) {
        data = data || {};
        staticSync = staticSync || {};
        var expectedVersion = data.releaseVersion || data.activeReleaseVersion || "";
        var observedVersion = staticSync.releaseVersion || staticSync.activeReleaseVersion || "";
        return Boolean(
          expectedVersion &&
          observedVersion === expectedVersion &&
          staticSync.enabled &&
          staticSync.configured &&
          staticSync.targetDirExists &&
          staticSync.targetReleaseDirExists &&
          staticSync.localRequiredFilesPresent
        );
      }

      function deriveStaticUrlVerified(staticSync, statusValue) {
        staticSync = staticSync || {};
        var currentStatuses = [staticSync.status, statusValue].map(function (value) {
          return String(value || "").toLowerCase();
        });
        if (staticSync.success === false || currentStatuses.indexOf("failed") >= 0) return false;
        var isVerifiedStatus = function (value) {
          if (typeof value === "number") return value >= 200 && value < 300;
          if (typeof value !== "string") return false;
          var normalized = value.toLowerCase();
          if (/^\d+$/.test(normalized)) {
            var statusCode = Number(normalized);
            return statusCode >= 200 && statusCode < 300;
          }
          return normalized === "ok" || normalized === "success";
        };
        return isVerifiedStatus(staticSync.manifestStatus) &&
          isVerifiedStatus(staticSync.classIndexStatus) &&
          isVerifiedStatus(staticSync.emptyRoomStatus);
      }

      function renderSyncStatusGrid() {
        var data = state.syncStatus || {};
        var wrap = $("syncStatsGrid");
        wrap.innerHTML = "";
        var staticSync = data.staticSync || {};
        var retainedReleases = Array.isArray(data.staticRetainedReleases) ? data.staticRetainedReleases : [];
        var retainedLabels = retainedReleases.map(function(item) {
          if (typeof item === "string") return item;
          return (item.version || "未采集") + " · " + (item.role || "retained");
        });
        var staticSyncStatus = data.openRestyStaticSyncStatus || (data.staticSync && data.staticSync.status) || "-";
        var staticEnabled = Boolean(staticSync.enabled);
        var staticConfigured = Boolean(staticSync.configured);
        var staticWritable = Boolean(staticSync.targetDirWritable);
        var staticVersionMatched = Boolean(staticSync.versionMatched);
        var staticTargetExists = Boolean(staticSync.targetDirExists);
        var releaseHeavyBusy = Boolean(data.releaseHeavyBusy && data.runningReleaseJob);
        var staticUrlVerified = deriveStaticUrlVerified(staticSync, staticSyncStatus);
        var staticDirectorySynced = deriveStaticDirectorySynced(data, staticSync);
        var staticFullySynced = Boolean(staticDirectorySynced && staticUrlVerified);
        renderSyncPipelineState(data, {
          staticDirectorySynced: staticDirectorySynced,
          staticUrlVerified: staticUrlVerified
        });
        var staticSyncReasonText = function() {
          var reason = staticSync.needsSyncReason || "";
          var map = {
            "feature-disabled": "功能未启用。请配置 STATIC_RELEASE_SYNC_ENABLED=true。",
            "target-dir-not-configured": "目录未配置。请配置 OPENRESTY_STATIC_RELEASE_DIR。",
            "target-dir-missing": "目录不存在。请检查 OpenResty 静态目录挂载。",
            "target-dir-not-writable": "目录不可写。请检查容器挂载权限。",
            "target-release-missing": "OpenResty 中缺少当前 active Release 目录。",
            "required-files-missing": "OpenResty 当前版本缺少 manifest、class index 或 empty-room index。",
            "version-mismatch": "active Release 与已同步版本不一致。",
            "not-synced-yet": "当前 active Release 尚未同步到 OpenResty。",
            "last-sync-failed": "最近一次静态同步失败。",
            "url-verification-failed": "公网静态 URL 验证失败。",
            "url-verification-pending": "公网静态 URL 尚未完成验证。",
            "no-active-release": "没有 active release。",
            "already-synced": "当前 active Release 已同步且 URL 验证通过，无需重复复制。"
          };
          if (releaseHeavyBusy) return "Release 重任务锁占用，请等待当前任务完成。";
          if (staticFullySynced) return map["already-synced"];
          return map[reason] || reason || "当前状态需要重新核对。";
        };
        if ($("openRestyEnabledBadge")) {
          $("openRestyEnabledBadge").className = "badge " + (staticEnabled ? "success" : "warning");
          $("openRestyEnabledBadge").textContent = staticEnabled ? "已启用" : "未启用";
        }
        if ($("openRestyConfiguredBadge")) {
          $("openRestyConfiguredBadge").className = "badge " + (staticConfigured ? "success" : "warning");
          $("openRestyConfiguredBadge").textContent = staticConfigured ? "已配置" : "未配置";
        }
        if ($("openRestyDirBadge")) {
          $("openRestyDirBadge").className = "badge " + (staticWritable ? "success" : (staticConfigured ? "danger" : "warning"));
          $("openRestyDirBadge").textContent = staticWritable ? "目录可写" : (staticConfigured ? "目录不可写" : "目录未配置");
        }
        if ($("openRestyVersionBadge")) {
          $("openRestyVersionBadge").className = "badge " + (staticVersionMatched ? "success" : "warning");
          $("openRestyVersionBadge").textContent = staticVersionMatched ? "版本一致" : "待同步";
        }
        if ($("openRestySyncBadge")) {
          var syncHealthy = staticSyncStatus === "success" || staticSyncStatus === "unchanged";
          $("openRestySyncBadge").className = "badge " + (syncHealthy ? "success" : (staticSyncStatus === "failed" ? "danger" : "info"));
          $("openRestySyncBadge").textContent = syncHealthy ? "最近同步成功" : (staticSyncStatus === "failed" ? "最近同步失败" : relayStatusText(staticSyncStatus));
        }
        if ($("openRestyVerifyBadge")) {
          $("openRestyVerifyBadge").className = "badge " + (staticUrlVerified ? "success" : "warning");
          $("openRestyVerifyBadge").textContent = staticUrlVerified ? "URL 验证 OK" : "URL 待验证";
        }
        if ($("activeCanonicalHashText")) $("activeCanonicalHashText").textContent = data.activeCanonicalHash || "当前版本未包含 canonical hash";
        if ($("stagingCanonicalHashText")) $("stagingCanonicalHashText").textContent = data.stagingCanonicalHash || "暂无 Staging";
        if ($("stagingHashCompareText")) {
          $("stagingHashCompareText").textContent = data.stagingSameAsActive ? "与线上一致" : (data.stagingCanonicalHash ? "有差异" : "暂无 staging");
        }
        if ($("stagingPublishNeedText")) {
          $("stagingPublishNeedText").textContent = data.stagingSameAsActive ? "无需发布" : (data.stagingNeedsPublish ? "需要发布" : "等待上传");
        }
        
        var hashStateText = {
          consistent: "一致",
          different: "不一致",
          "active-only": "仅 active",
          "staging-only": "仅 staging",
          unknown: "待确认"
        }[data.dataHashState || "unknown"] || "待确认";
        var list = [
          { label: "Active Release", val: data.activeReleaseVersion || "未生效", foot: "runtime pointer" },
          { label: "Published Release", val: data.releaseVersion || "-", foot: "最近发布候选" },
          { label: "当前学期", val: data.semester || "-", foot: "同步目标" },
          { label: "OpenResty", val: staticFullySynced ? "已同步" : relayStatusText(staticSyncStatus), foot: staticUrlVerified ? "URL 已验证" : "待核对" },
          { label: "CloudBase", val: relayStatusText(data.cloudbaseStatus), foot: data.cloudbaseStatus === "failed" ? "镜像可单独重试" : "最近回执" },
          { label: "数据 Hash", val: hashStateText, foot: data.activeCanonicalHash ? String(data.activeCanonicalHash).slice(0, 12) : "技术详情中查看" },
        ];
        
        list.forEach(function(item) {
          var card = document.createElement("div");
          card.className = "sync-metric-item";
          card.innerHTML = "<span>" + escapeHtml(item.label) + "</span>" +
                           "<strong>" + escapeHtml(item.val || "-") + "</strong>" +
                           "<small>" + escapeHtml(item.foot || "") + "</small>";
          wrap.appendChild(card);
        });

        var staticWrap = $("staticReleaseSyncSummary");
        if (staticWrap) {
          var urlItems = [
            ["manifest", data.staticManifestUrl || "未配置"],
            ["class index", data.staticClassIndexUrl || "未配置"],
            ["empty-room", data.staticEmptyRoomIndexUrl || "未配置"],
          ];
          var summaryRows = [
            ["状态", staticFullySynced ? "已就绪" : relayStatusText(staticSyncStatus)],
            ["Active", data.activeReleaseVersion || "未生效"],
            ["Synced", staticSync.syncedReleaseVersion || "未同步"],
            ["最后同步", data.lastStaticSyncTime ? formatDate(data.lastStaticSyncTime) : "尚未执行"],
            ["URL 验证", staticUrlVerified ? "通过" : "待验证"],
          ];
          var technicalRows = [
            ["Enabled / Configured", (staticEnabled ? "已启用" : "未启用") + " / " + (staticConfigured ? "已配置" : "未配置")],
            ["Directory", staticTargetExists ? (staticWritable ? "存在且可写" : "存在但不可写") : "不存在"],
            ["Version Matched", staticVersionMatched ? "一致" : "待同步"],
            ["Target Dir", staticSync.targetDir || "未配置"],
            ["Retained Releases", retainedLabels.length ? retainedLabels.slice(0, 3).join(" / ") : "未采集"],
            ["Canonical Hash", data.activeCanonicalHash || "当前版本未包含 canonical hash"],
            ["Latest Staging Hash", data.stagingCanonicalHash || "暂无 Staging"],
          ];
          staticWrap.innerHTML =
            "<div class='openresty-summary-grid'>" + summaryRows.map(function(row) {
              return "<div class='openresty-meta-item'><span>" + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1]) + "</strong></div>";
            }).join("") + "</div>" +
            "<details class='sync-technical-details'><summary>技术详情</summary>" +
              "<div class='openresty-url-grid'>" + urlItems.map(function(row) {
                var isUrl = /^https?:\/\//.test(row[1]) || row[1].charAt(0) === "/";
                var tag = isUrl ? "a" : "div";
                var href = isUrl ? " href='" + escapeHtml(row[1]) + "' target='_blank' rel='noreferrer'" : "";
                return "<" + tag + " class='static-url-pill'" + href + ">" +
                  "<span>" + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1]) + "</strong></" + tag + ">";
              }).join("") + "</div>" +
              "<div class='openresty-meta-grid'>" + technicalRows.map(function(row) {
                return "<div class='openresty-meta-item'><span>" + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1]) + "</strong></div>";
              }).join("") + "</div>" +
            "</details>";
        }

        if ($("syncRecommendationText")) {
          $("syncRecommendationText").textContent = data.nextAction && data.nextAction.message
            ? data.nextAction.message
            : (data.stagingNeedsPublish ? "候选数据已就绪，建议进入发布。" : (data.stagingSameAsActive ? "线上数据一致，建议核对静态 URL。" : "请先在校园网本机完成采集与上传。"));
        }
        if ($("syncNextActionBadge")) {
          $("syncNextActionBadge").textContent = data.nextAction && data.nextAction.message ? data.nextAction.message : (data.stagingNeedsPublish ? "下一步：开始发布" : (data.stagingSameAsActive ? "下一步：验证静态 URL" : "下一步：复制采集命令"));
        }
        if ($("syncNextActionBtn")) {
          $("syncNextActionBtn").textContent = data.nextAction && data.nextAction.label ? data.nextAction.label : (data.stagingNeedsPublish ? "开始发布" : (data.stagingSameAsActive ? "验证静态 URL" : "复制采集命令"));
          $("syncNextActionBtn").disabled = Boolean(releaseHeavyBusy && (data.stagingNeedsPublish || data.nextAction && data.nextAction.type === "static-sync"));
          $("syncNextActionBtn").title = releaseHeavyBusy && data.stagingNeedsPublish ? "已有 Release 重任务正在运行" : "";
        }
        if ($("staticSyncStateNote")) {
          $("staticSyncStateNote").textContent = staticSyncReasonText();
        }
        renderSyncOperationsPanels(data);
        if ($("manualStaticSyncBtn")) {
          $("manualStaticSyncBtn").textContent = staticFullySynced ? "✓ 已同步，无需操作" : "手动同步当前 Release";
          $("manualStaticSyncBtn").className = "secondary";
          $("manualStaticSyncBtn").disabled = Boolean(!staticEnabled || !staticConfigured || !staticTargetExists || !staticWritable || releaseHeavyBusy || !data.releaseVersion || staticFullySynced);
          $("manualStaticSyncBtn").title = staticSyncReasonText();
        }
        if ($("forceStaticSyncBtn")) {
          $("forceStaticSyncBtn").disabled = Boolean(!staticEnabled || !staticConfigured || !staticTargetExists || !staticWritable || releaseHeavyBusy || !data.releaseVersion);
          $("forceStaticSyncBtn").title = "重新核对并增量复制当前 Release 文件，不重新构建 Release，不删除 last-known-good，不改变 active pointer。";
        }
        if ($("stagingPublishBtn")) {
          $("stagingPublishBtn").disabled = Boolean(releaseHeavyBusy || !data.stagingNeedsPublish);
          $("stagingPublishBtn").title = releaseHeavyBusy ? "已有 Release 重任务正在运行" : "";
        }
      }

      function renderRuntimeStorage() {
        var wrap = $("runtimeStorageSummary");
        if (!wrap) return;
        var data = state.storageStatus || {};
        var disk = data.disk || {};
        var diskText = disk.usedPercent == null ? "未采集" : (disk.usedPercent + "%");
        if ($("storageStatusBadge")) {
          $("storageStatusBadge").className = "badge " + (data.diskCritical ? "danger" : (data.diskWarning ? "warning" : "success"));
          $("storageStatusBadge").textContent = data.diskCritical ? "磁盘 critical" : (data.diskWarning ? "磁盘 warning" : "运行正常");
        }
        var rows = [
          ["API uptime", data.apiUptimeSeconds != null ? (Math.floor(data.apiUptimeSeconds / 60) + " min") : "未采集"],
          ["API RSS", data.apiRssBytes ? formatBytes(data.apiRssBytes) : "未采集"],
          ["Worker 状态", data.workerStatus || "未采集"],
          ["当前运行 Job", data.runningJob ? ((data.runningJob.type || "job") + " · " + (data.runningJob.progress || 0) + "%") : "空闲"],
          ["load average", Array.isArray(data.loadAverage) ? data.loadAverage.map(function(n) { return Number(n || 0).toFixed(2); }).join(" / ") : "未采集"],
          ["磁盘使用率", diskText],
          ["可用空间", disk.freeBytes ? formatBytes(disk.freeBytes) : "未采集"],
          ["Release 占用", data.releaseBytes == null ? "未扫描" : formatBytes(data.releaseBytes)],
          ["Public Release 占用", data.publicReleaseBytes == null ? "未扫描" : formatBytes(data.publicReleaseBytes)],
          ["Staging 占用", data.stagingBytes == null ? "未扫描" : formatBytes(data.stagingBytes)],
          ["Job/日志占用", data.jobAndLogBytes == null ? "未扫描" : formatBytes(data.jobAndLogBytes)],
          ["最后维护时间", data.lastMaintenanceAt ? formatDate(data.lastMaintenanceAt) : "尚未执行"],
          ["下次维护时间", data.nextMaintenanceAt ? formatDate(data.nextMaintenanceAt) : "未启用定时维护"],
        ];
        wrap.innerHTML = rows.map(function(row) {
          return "<div class='runtime-metric-item'><span>" + escapeHtml(row[0]) + "</span><strong>" + escapeHtml(row[1]) + "</strong></div>";
        }).join("");
      }

      function relayStatusText(status) {
        var map = {
          pending: "未开始",
          running: "运行中",
          queued: "排队中",
          success: "成功",
          failed: "失败",
          "validation-failed": "校验失败",
          "publish-blocked": "发布受阻",
          canceled: "已取消",
          uploaded: "已上传",
          uploading: "上传中",
          validating: "校验中",
          disabled: "未启用",
          "not-run": "尚未执行",
          "not-collected": "未采集",
          skipped: "已跳过",
          unchanged: "数据无变化",
          "pending-review": "待审核",
          publishing: "发布中",
          staged: "已设为 Staging",
          "not-built": "未生成版本",
          building: "版本构建中",
          unhealthy: "版本不健康",
          inactive: "未生效",
          "rollback-target": "回滚候选",
          published: "已发布",
          active: "当前生效",
          duplicate: "重复",
          superseded: "已被取代",
          archived: "已归档",
          deleted: "已删除",
          expired: "已过期",
          revoked: "已吊销",
          "checking-config": "检查配置",
          "checking-source": "检查源目录",
          "copying-files": "复制文件",
          "verifying-local": "本地验证",
          "verifying-public-url": "公网 URL 验证",
          "pruning-old-releases": "清理旧版本",
          "cancel-requested": "请求取消",
          completed: "已完成"
        };
        return map[status] || status || "-";
      }

      function sourceModeText(mode) {
        var map = {
          "legacy-derived": "历史派生口径",
          derived: "历史派生口径",
          "derived-current-run": "本次班级课表派生",
          "network-direct": "100网直接抓取",
          unknown: "未标明"
        };
        return map[mode] || mode || "未标明";
      }

      function metricText(value, unit, status) {
        if (value == null || status === "not-counted") return "未统计";
        return String(value) + (unit || "");
      }

      function resourceMetricCard(label, value, unit, source, status) {
        return "<div class='metric'><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(metricText(value, unit, status)) + "</strong>" +
          (source ? "<span>" + escapeHtml(sourceModeText(source)) + "</span>" : "") + "</div>";
      }

      function renderSyncOperationsPanels(data) {
        data = data || {};
        var hasActiveRelease = Boolean(data.activeReleaseVersion);
        var active = hasActiveRelease ? (data.activeResourceCounts || data.resourceCounts || data.releasePackStatus && data.releasePackStatus.resourceCounts || null) : null;
        var activeCards = $("syncActiveReleaseCards");
        if (activeCards) {
          var runtimeState = hasActiveRelease ? "active" : "inactive";
          if ($("syncRuntimeStateBadge")) {
            $("syncRuntimeStateBadge").className = "badge " + (runtimeState === "active" ? "success" : "warning");
            $("syncRuntimeStateBadge").textContent = runtimeState === "active" ? "当前生效" : "未生效";
          }
          activeCards.innerHTML = [
            ["Pointer 状态", hasActiveRelease ? "Active" : "未生效"],
            ["最近生效", hasActiveRelease ? formatDate(data.activeReleaseActivatedAt || data.activeReleaseUpdatedAt) : "暂无记录"],
            ["最近同步", data.lastSyncTime ? (relayStatusText(data.lastSyncStatus) + " · " + formatDate(data.lastSyncTime)) : "尚无回执"],
            ["Release 健康", data.releasePackHealthy ? "正常" : "待核对"],
          ].map(function(row) {
            return "<div class='sync-compact-card'><strong>" + escapeHtml(row[0]) + "</strong><span>" + escapeHtml(row[1]) + "</span></div>";
          }).join("");
        }
        var contractWrap = $("syncActiveResourceContract");
        if (contractWrap) {
          contractWrap.innerHTML = active ? [
            resourceMetricCard("班级课表", active.class && active.class.scheduleDocuments, "份"),
            resourceMetricCard("行政班", active.class && active.class.administrativeClasses, "个"),
            resourceMetricCard("专业聚合", active.class && active.class.aggregateSchedules, "份"),
            resourceMetricCard("教师目录", active.teacher && active.teacher.directoryEntities, "人", active.teacher && active.teacher.sourceMode, active.teacher && active.teacher.directoryEntitiesStatus),
            resourceMetricCard("教师课表", active.teacher && active.teacher.scheduleDocuments, "份", active.teacher && active.teacher.sourceMode),
            resourceMetricCard("教师课程事件", active.teacher && active.teacher.courseEvents, "条", active.teacher && active.teacher.sourceMode),
            resourceMetricCard("教室目录", active.classroom && active.classroom.directoryEntities, "间", active.classroom && active.classroom.sourceMode, active.classroom && active.classroom.directoryEntitiesStatus),
            resourceMetricCard("教室课表", active.classroom && active.classroom.scheduleDocuments, "份", active.classroom && active.classroom.sourceMode),
            resourceMetricCard("课程目录", active.course && active.course.directoryEntities, "门", active.course && active.course.sourceMode, active.course && active.course.directoryEntitiesStatus),
            resourceMetricCard("课程课表", active.course && active.course.scheduleDocuments, "份", active.course && active.course.sourceMode),
          ].join("") : "<div class='empty-state'><strong>当前没有 Active Release</strong><span>资源规模不会以 Published 候选版本冒充线上数据。</span></div>";
        }

        var pendingWrap = $("syncPendingCards");
        if (!pendingWrap) return;
        var uploads = state.stagingUploads || [];
        var pendingStatuses = {
          "pending-review": true,
          failed: true,
          "validation-failed": true,
          duplicate: true,
          "publish-blocked": true,
          "waiting-confirmation": true
        };
        var pending = Array.isArray(data.pendingItems) && data.pendingItems.length ? data.pendingItems : uploads.filter(function(upload) {
          var stateValue = upload.stagingState || upload.status || "";
          return pendingStatuses[stateValue] || upload.failureReason || upload.blockers && upload.blockers.length;
        }).slice(0, 6);
        if ($("syncPendingBadge")) {
          $("syncPendingBadge").className = "badge " + (pending.length ? "warning" : "success");
          $("syncPendingBadge").textContent = pending.length ? ("待处理 " + pending.length + " 项") : "无待处理";
        }
        if (!pending.length) {
          pendingWrap.innerHTML = "<div class='sync-compact-card'><strong>当前无需处理</strong><span>没有失败、发布阻塞、重复上传或等待确认的项目。</span></div>";
          return;
        }
        pendingWrap.innerHTML = pending.map(function(upload) {
          var summary = upload.summary || {};
          var counts = upload.counts || summary.counts || summary || {};
          var stateValue = upload.stagingState || upload.status || "pending";
          var activeSame = data.activeCanonicalHash && upload.canonicalHash && data.activeCanonicalHash === upload.canonicalHash;
          var duplicateText = activeSame
            ? "与当前线上数据一致"
            : (upload.title || (upload.duplicateCount ? ("重复上传 " + upload.duplicateCount + " 次") : relayStatusText(stateValue)));
          var detail = {
            uploadId: upload.uploadId || "",
            canonicalHash: upload.canonicalHash || summary.canonicalHash || "",
            stagingState: upload.stagingState || "",
            releaseState: upload.releaseState || "",
            runtimeState: upload.runtimeState || "",
            command: upload.command || "",
          };
          return "<div class='sync-compact-card'><strong>" + escapeHtml(duplicateText) + "</strong>" +
            "<span>" + escapeHtml(upload.term || summary.term || "-") + " · " + escapeHtml(relayStatusText(stateValue)) + "</span>" +
            (upload.detail ? "<span>" + escapeHtml(upload.detail) + "</span>" : "<span>班级 " + (counts.classScheduleCount || 0) + " / 教师课表 " + (counts.teacherScheduleCount || 0) + " / 教室 " + (counts.classroomScheduleCount || 0) + " / 课程 " + (counts.courseScheduleCount || 0) + "</span>") +
            (upload.failureReason ? "<span style='color:var(--danger);'>" + escapeHtml(upload.failureReason) + "</span>" : "") +
            (upload.command ? "<button type='button' class='secondary sync-copy-pending-command' data-command='" + escapeHtml(upload.command) + "' style='margin-top:8px;padding:4px 8px;font-size:12px;'>复制建议命令</button>" : "") +
            "<details class='sync-technical-details'><summary>技术详情</summary><code>" + escapeHtml(JSON.stringify(detail, null, 2)) + "</code></details>" +
          "</div>";
        }).join("");
        pendingWrap.querySelectorAll(".sync-copy-pending-command").forEach(function(btn) {
          btn.addEventListener("click", function() {
            copyText(btn.getAttribute("data-command") || "");
          });
        });
      }

      function buildRelayRunCommand(task) {
        return "npm run sync:relay-agent -- --server=" + location.origin + " --token=" + task.relayToken + " --term=" + task.term;
      }

      function renderRelayTasks() {
        var tbody = $("relayTaskTableBody");
        if (!tbody) return;
        var list = state.relayTasks || [];
        
        // 动态更新 Step 2 流程卡片中的接力命令
        var activeRelayTask = list.find(function(t) { return t.status !== "revoked" && t.status !== "expired" && t.status !== "published"; });
        var flowRelayCmd = activeRelayTask ? buildRelayRunCommand(activeRelayTask) : "npm run sync:relay-agent -- --server=" + location.origin + " --token=YOUR_TOKEN --term=2026-2027-1";
        if ($("flowCmdTextRelay")) $("flowCmdTextRelay").textContent = flowRelayCmd;
        
        tbody.innerHTML = "";
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;color:var(--muted);padding:16px;'>暂无接力任务</td></tr>";
          return;
        }
        list.slice(0, 20).forEach(function(task) {
          var tr = document.createElement("tr");
          var command = buildRelayRunCommand(task);
          var progressText = (task.phase || task.status || "-") + " · " + (task.progress || 0) + "%";
          var agentText = task.agent && task.agent.version ? ("Agent " + task.agent.version) : "Agent 未在线";
          var heartbeatText = task.lastHeartbeatAt ? ("心跳 " + formatDate(task.lastHeartbeatAt)) : "等待心跳";
          tr.innerHTML =
            "<td><strong>" + escapeHtml(task.term) + "</strong><br><span style='color:var(--muted);'>" + escapeHtml(task.taskType || "sync:publish") + " · " + escapeHtml(task.description || "") + "</span><br><span style='color:var(--muted);'>有效期：" + formatDate(task.expiresAt) + "</span></td>" +
            "<td><code class='relay-token'>" + escapeHtml(task.relayToken) + "</code><code class='relay-token relay-command'>" + escapeHtml(command) + "</code></td>" +
            "<td><span class='badge info'>" + relayStatusText(task.status) + "</span><br><span style='color:var(--muted);'>" + escapeHtml(progressText) + "</span><br><span style='color:var(--muted);'>" + escapeHtml(agentText) + "</span><br><span style='color:var(--muted);'>" + escapeHtml(heartbeatText) + "</span><br><span style='color:var(--muted);'>上传 " + (task.uploadCount || 0) + "/" + (task.maxUploads || 1) + "</span></td>" +
            "<td class='action-cell'></td>";
          var copyBtn = document.createElement("button");
          copyBtn.className = "btn secondary";
          copyBtn.style = "padding: 3px 8px; font-size:11px;";
          copyBtn.textContent = "复制命令";
          copyBtn.addEventListener("click", function() {
            window.copyText(command);
          });
          tr.querySelector(".action-cell").appendChild(copyBtn);
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          var cancelBtn = document.createElement("button");
          cancelBtn.className = "btn ghost";
          cancelBtn.style = "padding: 3px 8px; font-size:11px;";
          cancelBtn.textContent = "取消";
          cancelBtn.disabled = task.cancelRequested === true || task.status === "revoked" || task.status === "published" || task.status === "expired";
          cancelBtn.addEventListener("click", function() {
            cancelRelayTask(task.id, cancelBtn);
          });
          tr.querySelector(".action-cell").appendChild(cancelBtn);
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          var revokeBtn = document.createElement("button");
          revokeBtn.className = "btn danger";
          revokeBtn.style = "padding: 3px 8px; font-size:11px;";
          revokeBtn.textContent = "吊销";
          revokeBtn.disabled = task.status === "revoked" || task.status === "published";
          revokeBtn.addEventListener("click", function() {
            revokeRelayTask(task.id, revokeBtn);
          });
          tr.querySelector(".action-cell").appendChild(revokeBtn);
          
          tr.querySelector(".action-cell").appendChild(document.createTextNode(" "));
          var deleteBtn = document.createElement("button");
          deleteBtn.className = "btn danger";
          deleteBtn.style = "padding: 3px 8px; font-size:11px;";
          deleteBtn.textContent = "删除";
          deleteBtn.addEventListener("click", function() {
            deleteRelayTask(task.id, deleteBtn);
          });
          tr.querySelector(".action-cell").appendChild(deleteBtn);
          
          tbody.appendChild(tr);
        });
      }

      function renderRelayUploads() {
        var tbody = $("relayUploadTableBody");
        if (!tbody) return;
        var list = state.relayUploads || [];
        tbody.innerHTML = "";
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;color:var(--muted);padding:16px;'>暂无接力上传</td></tr>";
          return;
        }
        list.slice(0, 20).forEach(function(upload) {
          var summary = upload.summary || {};
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td><strong>" + escapeHtml(upload.term || summary.term || "-") + "</strong><br><span style='color:var(--muted);'>" + formatDate(upload.uploadedAt) + "</span><br><span style='color:var(--muted);'>" + escapeHtml(upload.uploaderNote || "-") + "</span></td>" +
            "<td>行政班 " + (summary.classScheduleCount || 0) + "，课程 " + (summary.courseScheduleCount || 0) + "<br>教师 " + (summary.teacherScheduleCount || 0) + "，教室 " + (summary.classroomScheduleCount || 0) + "</td>" +
            "<td><span class='badge info'>" + relayStatusText(upload.status) + "</span></td>" +
            "<td class='action-cell'></td>";
          var promoteBtn = document.createElement("button");
          promoteBtn.className = "btn secondary";
          promoteBtn.style = "padding: 3px 8px; font-size:11px;";
          promoteBtn.textContent = "设为 Staging";
          promoteBtn.disabled = upload.status === "published";
          promoteBtn.addEventListener("click", function() {
            promoteRelayUpload(upload.id, promoteBtn);
          });
          tr.querySelector(".action-cell").appendChild(promoteBtn);
          tbody.appendChild(tr);
        });
      }

      function renderStagingUploadsLegacy() {
        var tbody = $("stagingUploadListBody");
        if (!tbody) return;
        var rawList = state.stagingUploads || [];
        var groupedByHash = {};
        var list = [];
        rawList.forEach(function(item) {
          var hasHash = Boolean(item.canonicalHash || (item.summary && item.summary.canonicalHash));
          var key = item.canonicalHash || (item.summary && item.summary.canonicalHash) || item.uploadId || "";
          if (!key || !hasHash) {
            list.push(item);
            return;
          }
          if (!groupedByHash[key]) {
            groupedByHash[key] = Object.assign({}, item, { historySources: [item] });
            list.push(groupedByHash[key]);
            return;
          }
          groupedByHash[key].historySources.push(item);
          if (new Date(item.updatedAt || item.createdAt || 0).getTime() > new Date(groupedByHash[key].updatedAt || groupedByHash[key].createdAt || 0).getTime()) {
            Object.assign(groupedByHash[key], item, { historySources: groupedByHash[key].historySources });
          }
        });
        tbody.innerHTML = "";
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;color:var(--muted);padding:12px 0;'>暂无 CLI 上传记录</td></tr>";
          return;
        }
        list.slice(0, 10).forEach(function(upload) {
          var summary = upload.summary || {};
          var counts = upload.counts || summary.counts || summary || {};
          var sourceSize = upload.sourceSize || upload.originalSize || 0;
          var gzipSize = upload.gzipSize || (upload.contentEncoding === "gzip" ? upload.uploadSize : 0);
          var uploadedChunks = upload.uploadedChunks || upload.receivedCount || 0;
          var chunkCount = upload.chunkCount || upload.totalChunks || 0;
          var progress = upload.progress != null ? upload.progress : (chunkCount > 0 ? Math.min(100, uploadedChunks / chunkCount * 100) : 0);
          var progressWidth = Math.max(0, Math.min(100, progress));
          var isActiveUpload = Boolean(upload.active || (state.syncStatus && state.syncStatus.activeCanonicalHash && upload.canonicalHash && state.syncStatus.activeCanonicalHash === upload.canonicalHash));
          var statusLabel = isActiveUpload ? "当前生效" : relayStatusText(upload.status);
          var statusClass = String(isActiveUpload ? "active" : (upload.status || "")).replace(/[^a-z0-9_-]/gi, "-");
          var historyCount = Array.isArray(upload.historySources) ? upload.historySources.length : 1;
          var duplicateBadge = historyCount > 1
            ? "<br><span class='badge muted'>同 hash 来源 " + historyCount + " 条</span>"
            : (upload.duplicateReleaseVersion ? "<br><span class='badge warning'>" + (upload.duplicateKeepLatest ? "重复候选版本 · 最新" : "重复候选版本 · 可归档") + "</span>" : "");
          var canonicalShort = upload.canonicalHash ? String(upload.canonicalHash).slice(0, 12) : "未采集";
          var sourceText = upload.source || upload.actorType || "CLI";
          var publishedText = upload.publishedReleaseVersion || upload.publishedVersion || "";
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td><code>" + escapeHtml(upload.uploadId || "-") + "</code><br><span style='color:var(--muted);'>" + escapeHtml(upload.fileName || "") + "</span><br><span class='badge muted'>" + escapeHtml(sourceText) + "</span></td>" +
            "<td><strong>" + escapeHtml(upload.term || summary.term || "-") + "</strong><br><span style='color:var(--muted);'>" + escapeHtml(upload.releaseVersion || summary.releaseVersion || "-") + "</span><br><span style='color:var(--muted);'>hash " + escapeHtml(canonicalShort) + "</span>" + duplicateBadge + "</td>" +
            "<td><div class='staging-size-stack'><span>JSON " + formatBytes(sourceSize) + "</span><span>gzip " + (gzipSize ? formatBytes(gzipSize) : "-") + "</span></div></td>" +
            "<td><div class='staging-progress'><div class='staging-progress-track'><div class='staging-progress-fill' style='width:" + progressWidth.toFixed(1) + "%'></div></div><span>" + progress.toFixed(1) + "% · " + uploadedChunks + "/" + chunkCount + " chunks</span></div></td>" +
            "<td><span class='staging-state-badge " + statusClass + "'>" + escapeHtml(statusLabel) + "</span>" + (publishedText ? "<br><span style='color:var(--muted);font-size:11px;'>Release " + escapeHtml(publishedText) + "</span>" : "") + (upload.failureReason ? "<br><span style='color:var(--danger);font-size:11px;'>" + escapeHtml(upload.failureReason) + "</span>" : "") + "</td>" +
            "<td><div class='staging-count-stack'><span>class " + (counts.classScheduleCount || 0) + "</span><span>teacher " + (counts.teacherScheduleCount || 0) + "</span><span>room " + (counts.classroomScheduleCount || 0) + "</span><span>course " + (counts.courseScheduleCount || 0) + "</span></div></td>" +
            "<td>" + formatDate(upload.updatedAt || upload.createdAt) + "</td>" +
            "<td class='action-cell'><div class='staging-action-row'></div></td>";
          var actions = tr.querySelector(".staging-action-row");
          var previewBtn = document.createElement("button");
          previewBtn.className = "btn ghost";
          previewBtn.style = "padding: 3px 8px; font-size:11px;";
          previewBtn.textContent = "预览";
          previewBtn.disabled = upload.status !== "pending-review" && upload.status !== "published";
          previewBtn.addEventListener("click", function() {
            loadStagingPreview();
            state.activeStep = 6;
            updateStepperUI();
          });
          actions.appendChild(previewBtn);

          var copySummaryBtn = document.createElement("button");
          copySummaryBtn.className = "btn secondary";
          copySummaryBtn.style = "padding: 3px 8px; font-size:11px;";
          copySummaryBtn.textContent = "复制摘要";
          copySummaryBtn.addEventListener("click", function() {
            copyText([
              "uploadId=" + (upload.uploadId || ""),
              "status=" + (isActiveUpload ? "active" : (upload.status || "")),
              "release=" + (publishedText || upload.releaseVersion || ""),
              "canonicalHash=" + (upload.canonicalHash || ""),
              "term=" + (upload.term || summary.term || "")
            ].join("\\n"));
          });
          actions.appendChild(copySummaryBtn);

          if (upload.status === "pending-review" && !isActiveUpload) {
            var publishBtn = document.createElement("button");
            publishBtn.className = "btn secondary";
            publishBtn.style = "padding: 3px 8px; font-size:11px;";
            publishBtn.textContent = "发布";
            publishBtn.addEventListener("click", function() {
              publishStaging(publishBtn);
            });
            actions.appendChild(publishBtn);
          }

          if (!isActiveUpload && upload.status !== "published") {
            var deleteBtn = document.createElement("button");
            deleteBtn.className = "btn danger";
            deleteBtn.style = "padding: 3px 8px; font-size:11px;";
            deleteBtn.textContent = upload.status === "duplicate" || upload.status === "unchanged" ? "归档" : "删除";
            deleteBtn.addEventListener("click", function() {
              deleteStagingUpload(upload.uploadId, deleteBtn);
            });
            actions.appendChild(deleteBtn);
          }
          tbody.appendChild(tr);
        });
      }

      function getStagingUploadHash(upload) {
        var summary = upload && upload.summary || {};
        return String(upload && (upload.canonicalHash || summary.canonicalHash || summary.stagingCanonicalHash) || "");
      }

      function getStagingUploadTerm(upload) {
        var summary = upload && upload.summary || {};
        return String(upload && (upload.term || upload.semester || summary.term || summary.semester) || "");
      }

      function getStagingUploadCounts(upload) {
        var summary = upload && upload.summary || {};
        return upload && (upload.counts || summary.counts || summary) || {};
      }

      function getStagingUploadState(upload) {
        if (!upload) return "unknown";
        if (upload.stagingState) return upload.stagingState;
        if (upload.status === "failed") return "validation-failed";
        if (upload.status === "unchanged") return "duplicate";
        return upload.status || "pending-review";
      }

      function getStagingReleaseState(upload) {
        return upload && (upload.releaseState || (upload.publishedReleaseVersion || upload.publishedVersion ? "published" : "not-built")) || "not-built";
      }

      function getStagingRuntimeState(upload, active) {
        return upload && (upload.runtimeState || (active ? "active" : "inactive")) || (active ? "active" : "inactive");
      }

      function getStagingReleaseVersion(upload) {
        var summary = upload && upload.summary || {};
        return String(upload && (upload.publishedReleaseVersion || upload.publishedVersion || upload.releaseVersion || summary.releaseVersion) || "");
      }

      function isActiveStagingUpload(upload) {
        var hash = getStagingUploadHash(upload);
        var releaseVersion = getStagingReleaseVersion(upload);
        var syncStatus = state.syncStatus || {};
        return Boolean(upload && upload.active || syncStatus.activeCanonicalHash && hash && syncStatus.activeCanonicalHash === hash || syncStatus.releaseVersion && releaseVersion && syncStatus.releaseVersion === releaseVersion);
      }

      function isIncompleteStagingUpload(upload) {
        var status = String(upload && (upload.status || upload.stagingState) || "").toLowerCase();
        return ["initialized", "uploading", "uploaded", "merging", "validating", "unknown"].indexOf(status) >= 0;
      }

      function getUploadAgeHours(upload) {
        var time = Date.parse(upload && (upload.updatedAt || upload.createdAt || upload.uploadedAt) || "");
        if (!time) return 0;
        return (Date.now() - time) / 3600000;
      }

      function getStagingDeleteProtectionReason(upload, group) {
        if (!upload || !upload.uploadId) return "缺少 uploadId";
        if (isActiveStagingUpload(upload)) return "Active 对应记录禁止删除";
        var status = String(upload.status || upload.stagingState || "").toLowerCase();
        var ageHours = getUploadAgeHours(upload);
        if (["uploading", "merging"].indexOf(status) >= 0 && ageHours < 24) return "正在上传或合并";
        if (["validating", "publishing"].indexOf(status) >= 0) return "正在校验或发布";
        if ((status === "initialized" || status === "uploaded") && getUploadAgeHours(upload) < 24) return "未完成不足 24 小时";
        if (upload.isStagingLatestUnique || upload.stagingLatestUnique) return "当前 staging-latest 唯一来源";
        if (group && group.isActive) return "本组包含 Active 记录，请展开只清理非 Active 明细";
        return "";
      }

      function buildStagingUploadGroups() {
        var rawList = state.stagingUploads || [];
        var selectedFilter = state.stagingUploadFilters && state.stagingUploadFilters.status || "";
        if (selectedFilter === "incomplete") {
          rawList = rawList.filter(isIncompleteStagingUpload);
        }
        var grouped = {};
        var list = [];
        rawList.forEach(function(item) {
          var hash = getStagingUploadHash(item);
          var term = getStagingUploadTerm(item);
          var key = item.duplicateGroupKey || (term && hash ? term + ":" + hash : "") || item.uploadId || "";
          if (!grouped[key]) {
            grouped[key] = {
              key: key,
              term: term,
              hash: hash,
              uploads: [],
              latest: item,
              latestTime: 0,
              isActive: false,
            };
            list.push(grouped[key]);
          }
          grouped[key].uploads.push(item);
          if (isActiveStagingUpload(item)) grouped[key].isActive = true;
          var nextTime = Date.parse(item.updatedAt || item.createdAt || item.uploadedAt || "") || 0;
          if (!grouped[key].latestTime || nextTime >= grouped[key].latestTime) {
            grouped[key].latest = item;
            grouped[key].latestTime = nextTime;
          }
        });
        list.sort(function(left, right) { return (right.latestTime || 0) - (left.latestTime || 0); });
        return list;
      }

      function appendStagingUploadActions(actions, upload, group) {
        var hash = getStagingUploadHash(upload);
        var releaseVersion = getStagingReleaseVersion(upload);
        var detailBtn = document.createElement("button");
        detailBtn.className = "btn ghost";
        detailBtn.style = "padding: 3px 8px; font-size:11px;";
        detailBtn.textContent = "查看详情";
        detailBtn.addEventListener("click", function() {
          alert(JSON.stringify({
            uploadId: upload.uploadId || "",
            term: getStagingUploadTerm(upload),
            canonicalHash: hash,
            stagingState: getStagingUploadState(upload),
            releaseState: getStagingReleaseState(upload),
            runtimeState: getStagingRuntimeState(upload, isActiveStagingUpload(upload)),
            releaseVersion: releaseVersion,
            counts: getStagingUploadCounts(upload),
            failureReason: upload.failureReason || upload.error || ""
          }, null, 2));
        });
        actions.appendChild(detailBtn);

        var failureBtn = document.createElement("button");
        failureBtn.className = "btn ghost";
        failureBtn.style = "padding: 3px 8px; font-size:11px;";
        failureBtn.textContent = "查看失败原因";
        failureBtn.disabled = !(upload.failureReason || upload.error);
        failureBtn.addEventListener("click", function() {
          alert(upload.failureReason || upload.error || "当前记录没有失败原因");
        });
        actions.appendChild(failureBtn);

        var releaseBtn = document.createElement("button");
        releaseBtn.className = "btn secondary";
        releaseBtn.style = "padding: 3px 8px; font-size:11px;";
        releaseBtn.textContent = "查看对应 Release";
        releaseBtn.disabled = !releaseVersion;
        releaseBtn.addEventListener("click", function() {
          copyText(releaseVersion);
          showToast("已复制 releaseVersion", "success");
        });
        actions.appendChild(releaseBtn);

        var copyHashBtn = document.createElement("button");
        copyHashBtn.className = "btn secondary";
        copyHashBtn.style = "padding: 3px 8px; font-size:11px;";
        copyHashBtn.textContent = "复制 canonicalHash";
        copyHashBtn.disabled = !hash;
        copyHashBtn.addEventListener("click", function() {
          copyText(hash);
        });
        actions.appendChild(copyHashBtn);

        var protection = getStagingDeleteProtectionReason(upload, null);
        var deleteBtn = document.createElement("button");
        deleteBtn.className = "btn danger";
        deleteBtn.style = "padding: 3px 8px; font-size:11px;";
        deleteBtn.textContent = "删除记录";
        deleteBtn.disabled = Boolean(protection);
        deleteBtn.title = protection || "只删除上传记录和可安全移除的 Staging 文件，不删除 Release";
        deleteBtn.addEventListener("click", function() {
          deleteStagingUpload(upload.uploadId, deleteBtn);
        });
        actions.appendChild(deleteBtn);
      }

      function renderStagingDetailRows(group) {
        var rows = group.uploads.map(function(upload) {
          var counts = getStagingUploadCounts(upload);
          var hash = getStagingUploadHash(upload);
          var active = isActiveStagingUpload(upload);
          var stagingState = getStagingUploadState(upload);
          var releaseState = getStagingReleaseState(upload);
          var runtimeState = getStagingRuntimeState(upload, active);
          var protection = getStagingDeleteProtectionReason(upload, null);
          var uploadId = upload.uploadId || "";
          var disabledText = protection ? " disabled title='" + escapeHtml(protection) + "'" : "";
          return "<tr data-upload-id='" + escapeHtml(uploadId) + "'>" +
            "<td><input type='checkbox' class='staging-upload-row-select' data-upload-id='" + escapeHtml(uploadId) + "'" + disabledText + "></td>" +
            "<td><code>" + escapeHtml(uploadId || "-") + "</code><br><span style='color:var(--muted);'>" + escapeHtml(upload.fileName || upload.source || upload.actorType || "") + "</span></td>" +
            "<td><strong>" + escapeHtml(getStagingUploadTerm(upload) || "-") + "</strong><br><span style='color:var(--muted);'>hash " + escapeHtml(hash ? hash.slice(0, 12) : "-") + "</span></td>" +
            "<td><span class='staging-state-badge " + String(active ? "active" : stagingState).replace(/[^a-z0-9_-]/gi, "-") + "'>" + escapeHtml(active ? "Active" : relayStatusText(stagingState)) + "</span><br><span style='color:var(--muted);font-size:11px;'>Release " + escapeHtml(relayStatusText(releaseState)) + "</span><br><span style='color:var(--muted);font-size:11px;'>Runtime " + escapeHtml(relayStatusText(runtimeState)) + "</span></td>" +
            "<td><div class='staging-count-stack'><span>班级 " + (counts.classScheduleCount || 0) + "</span><span>教师 " + (counts.teacherScheduleCount || 0) + "</span><span>教室 " + (counts.classroomScheduleCount || 0) + "</span><span>课程 " + (counts.courseScheduleCount || 0) + "</span></div></td>" +
            "<td>" + formatDate(upload.updatedAt || upload.createdAt) + "</td>" +
            "<td><div class='staging-delete-protection'>" + escapeHtml(protection || "可删除：不删除 Release；Active、发布中、staging-latest 唯一来源会被保护。") + "</div></td>" +
            "<td class='action-cell'><div class='staging-action-row' data-actions-for='" + escapeHtml(uploadId) + "'></div></td>" +
          "</tr>";
        }).join("");
        return "<div class='staging-detail-wrap'><table class='staging-detail-table'><thead><tr><th>选择</th><th>上传记录</th><th>学期 / hash</th><th>状态</th><th>数据计数</th><th>更新时间</th><th>删除保护</th><th>操作</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
      }

      function hydrateStagingDetailActions(row, upload, group) {
        var actions = row.querySelector(".staging-action-row");
        if (actions) appendStagingUploadActions(actions, upload, group);
      }

      function renderStagingUploads() {
        var tbody = $("stagingUploadListBody");
        if (!tbody) return;
        var groups = buildStagingUploadGroups();
        var pageInfo = $("stagingUploadPageInfo");
        if (pageInfo) {
          var pageSize = Number(state.stagingUploadPageSize || 50) || 50;
          var page = Math.floor((state.stagingUploadCursor || 0) / pageSize) + 1;
          pageInfo.textContent = "第 " + page + " 页 · " + (state.stagingUploadTotal || groups.length) + " 条记录";
        }
        if ($("stagingUploadPrevPageBtn")) $("stagingUploadPrevPageBtn").disabled = (state.stagingUploadCursor || 0) <= 0;
        if ($("stagingUploadNextPageBtn")) $("stagingUploadNextPageBtn").disabled = state.stagingUploadNextCursor == null;
        if ($("stagingUploadSelectAll")) $("stagingUploadSelectAll").checked = false;
        tbody.innerHTML = "";
        if (!groups.length) {
          tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:var(--muted);padding:12px 0;'>暂无 CLI 上传记录</td></tr>";
          return;
        }
        groups.forEach(function(group, index) {
          var upload = group.latest || {};
          var counts = getStagingUploadCounts(upload);
          var hash = group.hash || getStagingUploadHash(upload);
          var releaseVersion = getStagingReleaseVersion(upload) || "-";
          var stagingState = getStagingUploadState(upload);
          var releaseState = getStagingReleaseState(upload);
          var runtimeState = getStagingRuntimeState(upload, group.isActive);
          var statusClass = String(group.isActive ? "active" : stagingState).replace(/[^a-z0-9_-]/gi, "-");
          var groupKey = group.key || ("group-" + index);
          var expanded = Boolean(state.stagingUploadExpandedGroups[groupKey]);
          var canDeleteCount = group.uploads.filter(function(item) { return !getStagingDeleteProtectionReason(item, null); }).length;
          var groupProtection = canDeleteCount ? "" : getStagingDeleteProtectionReason(upload, group) || "本组暂无可删除记录";
          var tr = document.createElement("tr");
          tr.className = "staging-group-row";
          tr.innerHTML =
            "<td><input type='checkbox' class='staging-upload-group-select' data-group-key='" + escapeHtml(groupKey) + "'" + (canDeleteCount ? "" : " disabled title='" + escapeHtml(groupProtection) + "'") + "></td>" +
            "<td><strong>" + escapeHtml(group.term || "-") + "</strong><span class='staging-row-summary'>Release " + escapeHtml(releaseVersion) + " · " + formatDate(upload.updatedAt || upload.createdAt) + "</span></td>" +
            "<td><span class='staging-state-badge " + statusClass + "'>" + escapeHtml(group.isActive ? "Active" : relayStatusText(stagingState)) + "</span><span class='staging-row-summary'>release " + escapeHtml(relayStatusText(releaseState)) + " · runtime " + escapeHtml(relayStatusText(runtimeState)) + "</span></td>" +
            "<td><strong>" + group.uploads.length + "</strong><span class='staging-row-summary'>可删 " + canDeleteCount + " · 展开查看 Hash 与计数</span></td>" +
            "<td class='action-cell'><div class='staging-action-row'></div></td>";
          var actions = tr.querySelector(".staging-action-row");
          var expandBtn = document.createElement("button");
          expandBtn.className = "btn secondary";
          expandBtn.style = "padding: 3px 8px; font-size:11px;";
          expandBtn.textContent = expanded ? "收起组" : "展开组";
          expandBtn.addEventListener("click", function() {
            state.stagingUploadExpandedGroups[groupKey] = !state.stagingUploadExpandedGroups[groupKey];
            renderStagingUploads();
          });
          actions.appendChild(expandBtn);
          var copyHashBtn = document.createElement("button");
          copyHashBtn.className = "btn secondary";
          copyHashBtn.style = "padding: 3px 8px; font-size:11px;";
          copyHashBtn.textContent = "复制 canonicalHash";
          copyHashBtn.disabled = !hash;
          copyHashBtn.addEventListener("click", function() { copyText(hash); });
          actions.appendChild(copyHashBtn);
          if (upload.status === "pending-review" && !group.isActive) {
            var publishBtn = document.createElement("button");
            publishBtn.className = "btn secondary";
            publishBtn.style = "padding: 3px 8px; font-size:11px;";
            publishBtn.textContent = "发布";
            publishBtn.addEventListener("click", function() { publishStaging(publishBtn); });
            actions.appendChild(publishBtn);
          }
          tbody.appendChild(tr);
          if (expanded) {
            var detailRow = document.createElement("tr");
            detailRow.className = "staging-detail-row";
            detailRow.innerHTML = "<td colspan='5'>" + renderStagingDetailRows(group) + "</td>";
            tbody.appendChild(detailRow);
            group.uploads.forEach(function(item) {
              detailRow.querySelectorAll("tr[data-upload-id]").forEach(function(row) {
                if (row.getAttribute("data-upload-id") === String(item.uploadId || "")) hydrateStagingDetailActions(row, item, group);
              });
            });
          }
        });
      }

      function formatBytes(bytes) {
        var value = Number(bytes || 0);
        if (!value) return "-";
        var mb = value / 1024 / 1024;
        if (mb >= 1) return mb.toFixed(2) + " MB";
        return (value / 1024).toFixed(1) + " KB";
      }

      function getWizardScopeList() {
        var scopes = [];
        if ($("rangeClass") && $("rangeClass").checked) scopes.push("classSchedules");
        if ($("rangeTeacher") && $("rangeTeacher").checked) scopes.push("teacherSchedules");
        if ($("rangeClassroom") && $("rangeClassroom").checked) scopes.push("classroomSchedules");
        if ($("rangeCourse") && $("rangeCourse").checked) scopes.push("courseSchedules");
        return scopes;
      }

      function createRelayTask() {
        var relayScopes = getWizardScopeList();
        var taskType = resolveSyncScriptName("local-campus", relayScopes);
        var payload = {
          term: getTermValue("relayTaskTerm", "relayTaskTermCustom") || getTermValue("wizardTerm", "wizardTermCustom") || "2026-2027-1",
          description: value("relayTaskDescription") || "全校课表接力采集",
          expiresInHours: parseInt(value("relayTaskExpiresIn") || "24", 10),
          maxUploads: parseInt(value("relayTaskMaxUploads") || "1", 10),
          taskType: taskType,
          syncPlan: {
            taskType: taskType,
            scopes: relayScopes,
            catalogPolicy: "reuse-validated",
            schedulePolicy: "network-only",
            progressPolicy: "ignore",
            negativeCachePolicy: "ignore",
            mergeOldData: false
          }
        };
        api("/api/admin/relay/tasks", {
          method: "POST",
          body: JSON.stringify(payload)
        })
          .then(function(res) {
            showToast("接力任务已创建", "success");
            if (res.runCommand) {
              window.copyText(res.runCommand);
            }
            return loadSyncStatus();
          })
          .catch(function(error) {
            showToast(error.message, "error");
          });
      }

      function revokeRelayTask(id, btn) {
        if (!confirm("确定吊销这个接力任务吗？吊销后该 relay token 将无法继续上传。")) return;
        var restoreButton = setButtonLoading(btn, "吊销中...");
        api("/api/admin/relay/tasks/" + encodeURIComponent(id) + "/revoke", {
          method: "POST",
          body: "{}"
        })
          .then(function() {
            showToast("接力任务已吊销", "success");
            return loadSyncStatus();
          })
          .catch(function(error) {
            restoreButton();
            showToast(error.message, "error");
          });
      }

      function cancelRelayTask(id, btn) {
        if (!confirm("确定取消这个接力任务吗？Agent 会在下一次心跳或阶段切换时停止。")) return;
        var restoreButton = setButtonLoading(btn, "取消中...");
        api("/api/admin/relay/tasks/" + encodeURIComponent(id) + "/cancel", {
          method: "POST",
          body: "{}"
        })
          .then(function() {
            showToast("已请求取消接力任务", "success");
            return loadSyncStatus();
          })
          .catch(function(error) {
            restoreButton();
            showToast(error.message, "error");
          });
      }

      function deleteRelayTask(id, btn) {
        var msg = "确认删除这个接力任务吗？删除后不会影响已经发布的课表数据，但该 token 和任务记录将从后台列表移除。";
        if (!confirm(msg)) return;
        var restoreButton = setButtonLoading(btn, "删除中...");
        api("/api/admin/relay/tasks/" + encodeURIComponent(id), {
          method: "DELETE"
        })
          .then(function() {
            state.relayTasks = (state.relayTasks || []).filter(function(task) { return task.id !== id; });
            renderRelayTasks();
            showToast("接力任务已彻底删除", "success");
            return loadSyncStatus();
          })
          .catch(function(error) {
            restoreButton();
            showToast(error.message || "删除失败", "error");
          });
      }

      function findStagingUploadById(id) {
        return (state.stagingUploads || []).find(function(item) { return item.uploadId === id; }) || null;
      }

      function collectSelectedStagingUploadIds() {
        var ids = [];
        document.querySelectorAll(".staging-upload-row-select:checked").forEach(function(input) {
          if (!input.disabled && input.dataset.uploadId) ids.push(input.dataset.uploadId);
        });
        document.querySelectorAll(".staging-upload-group-select:checked").forEach(function(input) {
          if (input.disabled) return;
          var groupKey = input.dataset.groupKey;
          buildStagingUploadGroups().forEach(function(group) {
            if (group.key !== groupKey) return;
            group.uploads.forEach(function(upload) {
              if (!getStagingDeleteProtectionReason(upload, null) && upload.uploadId) ids.push(upload.uploadId);
            });
          });
        });
        return ids.filter(function(id, index) { return ids.indexOf(id) === index; });
      }

      function deleteStagingUploadIds(ids, btn, label) {
        ids = (ids || []).filter(Boolean).filter(function(id, index, arr) { return arr.indexOf(id) === index; });
        if (!ids.length) {
          showToast("没有可删除的上传记录", "warning");
          return Promise.resolve();
        }
        if (!confirm("确认" + (label || "删除") + " " + ids.length + " 条上传记录吗？该操作只删除上传记录 / Staging 文件，不会删除 Release；Active、发布中、校验中和 staging-latest 唯一来源会被保护。")) {
          return Promise.resolve();
        }
        var restoreButton = setButtonLoading(btn, "删除中...");
        var deleted = 0;
        var failed = [];
        return ids.reduce(function(promise, id) {
          return promise.then(function() {
            return api("/api/admin/staging/" + encodeURIComponent(id), { method: "DELETE" })
              .then(function() { deleted += 1; })
              .catch(function(error) { failed.push(id + ": " + (error.message || "删除失败")); });
          });
        }, Promise.resolve()).then(function() {
          state.stagingUploads = (state.stagingUploads || []).filter(function(item) { return ids.indexOf(item.uploadId) < 0 || failed.some(function(text) { return text.indexOf(item.uploadId + ":") === 0; }); });
          renderStagingUploads();
          showToast("已删除 " + deleted + " 条，失败 " + failed.length + " 条", failed.length ? "warning" : "success");
          if (failed.length) console.warn("[staging-delete] failed", failed);
          return loadSyncStatus();
        }).finally(function() {
          restoreButton();
        });
      }

      function deleteStagingUpload(id, btn) {
        if (!id) return;
        var upload = findStagingUploadById(id);
        var protection = upload ? getStagingDeleteProtectionReason(upload, null) : "";
        if (protection) {
          showToast(protection, "error");
          return;
        }
        return deleteStagingUploadIds([id], btn, "删除");
      }

      function purgeDuplicateStagingUploads(btn) {
        var ids = [];
        buildStagingUploadGroups().forEach(function(group) {
          if (group.uploads.length <= 1) return;
          var sorted = group.uploads.slice().sort(function(left, right) {
            return (Date.parse(right.updatedAt || right.createdAt || "") || 0) - (Date.parse(left.updatedAt || left.createdAt || "") || 0);
          });
          sorted.slice(1).forEach(function(upload) {
            if (!getStagingDeleteProtectionReason(upload, null) && upload.uploadId) ids.push(upload.uploadId);
          });
        });
        return deleteStagingUploadIds(ids, btn, "清理重复项");
      }

      function purgeFailedStagingUploads(btn) {
        var ids = (state.stagingUploads || []).filter(function(upload) {
          var stateValue = String(getStagingUploadState(upload)).toLowerCase();
          return ["failed", "validation-failed"].indexOf(stateValue) >= 0 && !getStagingDeleteProtectionReason(upload, null);
        }).map(function(upload) { return upload.uploadId; });
        return deleteStagingUploadIds(ids, btn, "清理失败项");
      }

      function purgeIncompleteStagingUploads(btn) {
        var ids = (state.stagingUploads || []).filter(function(upload) {
          return isIncompleteStagingUpload(upload) && getUploadAgeHours(upload) >= 24 && !getStagingDeleteProtectionReason(upload, null);
        }).map(function(upload) { return upload.uploadId; });
        return deleteStagingUploadIds(ids, btn, "清理 24 小时以上未完成项");
      }

      function rebuildStagingUploadIndex(btn) {
        var restoreButton = setButtonLoading(btn, "重建中...");
        return api("/api/admin/staging/upload/rebuild-index", {
          method: "POST",
          body: "{}"
        }).then(function(res) {
          showToast("上传记录索引已重建，共 " + (res.total || (res.records && res.records.length) || 0) + " 条", "success");
          return loadStagingUploadsPanel();
        }).catch(function(error) {
          showToast(error.message || "重建失败", "error");
        }).finally(function() {
          restoreButton();
        });
      }

      function promoteRelayUpload(id, btn) {
        if (!confirm("确定将这次接力上传设为当前 Staging 吗？这不会直接发布到小程序，仍需再执行正式发布。")) return;
        var restoreButton = setButtonLoading(btn, "校验中...");
        api("/api/admin/relay/uploads/" + encodeURIComponent(id) + "/promote-to-staging", {
          method: "POST",
          body: "{}"
        })
          .then(function() {
            showToast("接力上传已设为 Staging，请检查 diff 后发布", "success");
            loadStagingPreview();
            return loadSyncStatus();
          })
          .catch(function(error) {
            restoreButton();
            restoreButton();
            showToast(error.message, "error");
          });
      }

      // 当前选中的 Shell，默认是 powershell
      state.currentShell = "powershell";
      state.activeStep = 1;

      // 自动生成版本号
      function getAutoGeneratedVersion(term) {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, "0");
        var dd = String(now.getDate()).padStart(2, "0");
        var hh = String(now.getHours()).padStart(2, "0");
        var min = String(now.getMinutes()).padStart(2, "0");
        var sec = String(now.getSeconds()).padStart(2, "0");
        
        var termClean = (term || "2026-2027-1").replace(/-/g, "");
        return termClean + "-" + yyyy + mm + dd + "-" + hh + min + sec;
      }

      // 获取推荐的 5 个活跃年级
      function getRecommendGrades(term) {
        var match = term.match(/^(\d{4})/);
        if (match) {
          var startYear = parseInt(match[1], 10);
          var grades = [];
          for (var i = 0; i < 5; i++) {
            grades.push(startYear - i);
          }
          return grades.join(",");
        }
        return "2025,2024,2023,2022,2021";
      }

      function getFreshmanGrade(term) {
        var match = term.match(/^(\d{4})/);
        return match ? match[1] : "2026";
      }

      function resolveSyncScriptName(source, scopes) {
        var selected = Array.isArray(scopes) ? scopes : [];
        if (source === "staging-upload") return "sync:upload-staging";
        if (source === "relay-agent") return "sync:relay-agent";
        if ($("wizardForceRefresh") && $("wizardForceRefresh").checked) return "sync:publish:full";
        return "sync:publish";
      }

      // 更新向导命令预览与运维卡片列表
      function updateWizardCommand() {
        var term = getTermValue("wizardTerm", "wizardTermCustom") || (state.dashboard && state.dashboard.currentSemester) || "";
        var startDate = value("wizardStartDate") || getTermStartDate(term) || "";
        var source = value("wizardSource") || "local-campus";
        var note = value("wizardNote") || (term + " 新学期全校课表首版");
        var forceRefresh = Boolean($("wizardForceRefresh") && $("wizardForceRefresh").checked);

        // 自动计算版本并填充到 UI
        var versionInput = $("wizardVersion");
        if (versionInput) {
          if (!versionInput.dataset.modifiedByUser || !versionInput.value) {
            versionInput.value = getAutoGeneratedVersion(term);
          }
        }
        var version = versionInput ? versionInput.value : "";

        // 提取勾选的同步范围
        var scopes = [];
        if ($("rangeClass") && $("rangeClass").checked) scopes.push("classSchedules");
        if ($("rangeTeacher") && $("rangeTeacher").checked) scopes.push("teacherSchedules");
        if ($("rangeClassroom") && $("rangeClassroom").checked) scopes.push("classroomSchedules");
        if ($("rangeCourse") && $("rangeCourse").checked) scopes.push("courseSchedules");
        if ($("rangeClassroomList") && $("rangeClassroomList").checked) scopes.push("classrooms");
        if ($("rangeTeacherList") && $("rangeTeacherList").checked) scopes.push("teachers");
        if ($("rangeCourseList") && $("rangeCourseList").checked) scopes.push("courses");

        var scopesStr = scopes.join(",");

        // 年级范围
        var gradesMode = value("wizardGradesMode") || "recommend";
        var gradesVal = "";
        if (gradesMode === "recommend") {
          gradesVal = getRecommendGrades(term);
        } else if (gradesMode === "freshman") {
          gradesVal = getFreshmanGrade(term);
        } else if (gradesMode === "custom") {
          gradesVal = (value("wizardGradesCustom") || "").trim();
        }

        // 学院 & 专业过滤
        var collegeCodes = (value("wizardCollegesFilter") || "").trim();
        var majorCodes = (value("wizardMajorsFilter") || "").trim();

        // 并发 & 延迟
        var concurrency = value("wizardConcurrency") || "1";
        var delay = value("wizardDelay") || "900";

        var output = "./staging/" + term + "-full.json";

        // 是否勾选行政班课表
        var hasClassSchedules = scopes.indexOf("classSchedules") >= 0;

        // 生成环境变量
        var envVars = [];
        if (hasClassSchedules) {
          envVars.push({ name: "SYNC_CLASS_SCOPE", val: "all" });
        }
        if (gradesVal) {
          envVars.push({ name: "SYNC_CLASS_GRADES", val: gradesVal });
        }
        if (scopesStr) {
          envVars.push({ name: "SYNC_INCLUDE_SCOPES", val: scopesStr });
        }
        if (concurrency) {
          envVars.push({ name: "SYNC_CLASS_MAX_CONCURRENCY", val: concurrency });
        }
        if (delay) {
          envVars.push({ name: "SYNC_CLASS_REQUEST_DELAY_MS", val: delay });
        }
        if (collegeCodes) {
          envVars.push({ name: "SYNC_CLASS_COLLEGE_CODES", val: collegeCodes });
        }
        if (majorCodes) {
          envVars.push({ name: "SYNC_CLASS_MAJOR_CODES", val: majorCodes });
        }

        // 生成 CLI 参数
        var cliArgs = [
          "--term=" + (term || "请先选择学期"),
          "--term-start-date=" + (startDate || "请管理员填写YYYY-MM-DD"),
          "--output=" + output,
          "--include=" + scopesStr
        ];
        if (hasClassSchedules) {
          cliArgs.push("--class-scope=all");
        }
        if (gradesVal) {
          cliArgs.push("--grades=" + gradesVal);
        }
        if (concurrency) {
          cliArgs.push("--concurrency=" + concurrency);
        }
        if (delay) {
          cliArgs.push("--delay-ms=" + delay);
        }
        if (collegeCodes) {
          cliArgs.push("--college-codes=" + collegeCodes);
        }
        if (majorCodes) {
          cliArgs.push("--major-codes=" + majorCodes);
        }
        if (forceRefresh) {
          cliArgs.push("--force-refresh");
        }

        var scriptName = resolveSyncScriptName(source, scopes);
        var publisherArgs = [];
        if (scriptName === "sync:publish:full") {
          publisherArgs = [
            "--term=" + (term || "请先选择学期"),
            "--term-start-date=" + (startDate || "请管理员填写YYYY-MM-DD"),
            "--total-weeks=20"
          ];
        }
        var cliArgsStr = scriptName === "sync:upload-staging"
          ? "--file=" + output + " --term=" + (term || "请先选择学期")
          : (scriptName.indexOf("sync:publish") === 0 ? publisherArgs.join(" ") : cliArgs.join(" "));
        var commandEnvVars = scriptName.indexOf("sync:publish") === 0 ? [] : envVars;

        // 构造命令文本。换行和 bash 续行符用运行时字符生成，避免服务端模板字符串提前展开成浏览器脚本中的非法换行。
        var commandText = "";
        var shell = state.currentShell || "powershell";
        var lineBreak = String.fromCharCode(10);
        var bashContinuation = " " + String.fromCharCode(92) + lineBreak;
        var winSlash = String.fromCharCode(92);
        var projectDirWin = ["C:", "Users", "Katelya", "Documents", "VScode", "FosuClass"].join(winSlash);
        var projectDirBash = "/c/Users/Katelya/Documents/VScode/FosuClass";

        if (shell === "cmd") {
          commandText += "cd /d " + projectDirWin + lineBreak;
          commandEnvVars.forEach(function(ev) {
            commandText += "set " + ev.name + "=" + ev.val + lineBreak;
          });
          commandText += "npm run " + scriptName + (cliArgsStr ? " -- " + cliArgsStr : "");
        } else if (shell === "powershell") {
          commandText += "cd " + projectDirWin + lineBreak;
          commandEnvVars.forEach(function(ev) {
            commandText += '$env:' + ev.name + '="' + ev.val + '"' + lineBreak;
          });
          commandText += "npm run " + scriptName + (cliArgsStr ? " -- " + cliArgsStr : "");
        } else {
          // bash
          commandText += "cd " + projectDirBash + lineBreak;
          commandEnvVars.forEach(function(ev) {
            commandText += ev.name + "=" + ev.val + bashContinuation;
          });
          commandText += "npm run " + scriptName + (cliArgsStr ? " -- " + cliArgsStr : "");
        }

        // 显示到界面
        if ($("wizardCommandCode")) {
          $("wizardCommandCode").textContent = commandText;
        }
        if ($("flowCmdTextLocal")) {
          $("flowCmdTextLocal").textContent = commandText;
        }
        if ($("quickUploadCommand")) {
          $("quickUploadCommand").textContent = "cd " + projectDirWin + lineBreak + "npm run sync:upload-staging -- --file=" + output + " --term=" + (term || "请先选择学期");
        }
        renderAllCodePreviews();

        // 异步更新右侧运维说明卡片列表
        api("/api/admin/sync/command-guide?term=" + term + "&start=" + startDate)
          .then(function(res) {
            if (res.success && res.commands) {
              var cmds = res.commands;
              var syncCommandsWrap = $("syncCommands");
              if (syncCommandsWrap) {
                syncCommandsWrap.innerHTML = "";
                var normalCmds = cmds;
                normalCmds.forEach(function(c) {
                  var riskClass = c.risk === "low" || c.risk.indexOf("低") >= 0 ? "low" : (c.risk === "high" || c.risk.indexOf("中高") >= 0 ? "high" : "medium");
                  var riskBadge = "<span class='command-tag " + riskClass + "'>风险: " + c.risk + "</span>";
                  var intranetBadge = c.intranetRequired ? "<span class='command-tag high'>需校园网</span>" : "<span class='command-tag low'>外网可用</span>";
                  var isDefaultExpanded = false;
                  
                  var item = document.createElement("div");
                  item.className = "command-card" + (isDefaultExpanded ? "" : " collapsed");
                  item.innerHTML = 
                    "<div class='command-header'>" +
                      "<div class='command-title'>" + escapeHtml(c.name) + "</div>" +
                      "<div style='display:flex; gap:6px; align-items: center;'>" + riskBadge + intranetBadge + "</div>" +
                    "</div>" +
                    "<div class='command-body'>" +
                      "<div class='code-preview command-code-box'>" +
                        "<div class='code-preview-toolbar'><span>PowerShell / 运维命令</span><button type='button' class='copy-command-btn'>复制全部命令</button></div>" +
                        "<pre class='code-raw'><code>" + escapeHtml(c.command) + "</code></pre>" +
                        "<div class='code-preview-scroller'><div class='code-preview-lines'></div></div>" +
                      "</div>" +
                      "<div class='command-meta-grid'>" +
                        "<div class='command-meta-item'><strong>适用场景</strong><span>" + escapeHtml(c.scene) + "</span></div>" +
                        "<div class='command-meta-item'><strong>前置条件</strong><span>" + escapeHtml(c.precondition) + "</span></div>" +
                        "<div class='command-meta-item'><strong>预计耗时</strong><span>" + escapeHtml(c.duration) + "</span></div>" +
                        "<div class='command-meta-item'><strong>常见失败原因</strong><span>" + escapeHtml(c.failureReason) + "</span></div>" +
                      "</div>" +
                      "<div class='command-tip-box'>" +
                        "<strong>修复建议:</strong><span>" + escapeHtml(c.solution) + "</span>" +
                      "</div>" +
                    "</div>";
                  item.__copyCommand = c.command || "";
                  
                  item.querySelector(".command-header").addEventListener("click", function(e) {
                    if (e.target.classList.contains("command-tag")) return;
                    item.classList.toggle("collapsed");
                  });
                  syncCommandsWrap.appendChild(item);
                });
                renderAllCodePreviews(syncCommandsWrap);
                
                syncCommandsWrap.querySelectorAll(".copy-command-btn").forEach(function(btn) {
                  btn.addEventListener("click", function() {
                    var card = btn.closest(".command-card");
                    copyText((card && card.__copyCommand) || "");
                  });
                });
              }
            }
          })
          .catch(function(err) {
            console.error("加载运维指南失败:", err);
          });
      }

      // 绑定向导的表单值变化监听以更新推荐命令
      safeBind("wizardStartDate", "input", function() {
        state.wizardStartDateTouched = true;
        updateWizardCommand();
      });
      safeBind("wizardNote", "input", updateWizardCommand);
      ["wizardTerm", "wizardSource"].forEach(function(id) {
        safeBind(id, "change", updateWizardCommand);
      });
      safeBind("wizardCopyBtn", "click", function() {
        var code = $("wizardCommandCode").textContent;
        if (code && code.indexOf("无需运行命令行") < 0) {
          copyText(code);
        }
      });

      // 渲染 Releases 列表
      function renderReleaseHistoryTable() {
        var list = state.releasesHistory || [];
        var filterTerm = $("releaseTermFilter") ? $("releaseTermFilter").value : "all";
        var filteredList = list;
        if (filterTerm !== "all") {
          filteredList = list.filter(function(r) { return r.semester === filterTerm; });
        }
        var tbody = $("releasesTableBody");
        tbody.innerHTML = "";
        var currentActiveVer = state.syncStatus ? state.syncStatus.releaseVersion : "";
        var compactList = [];
        var seenRelease = {};
        function addReleaseCard(item) {
          if (!item || !item.version || seenRelease[item.version]) return;
          seenRelease[item.version] = true;
          compactList.push(item);
        }
        filteredList.filter(function(r) { return r.version === currentActiveVer; }).forEach(addReleaseCard);
        filteredList.filter(function(r) { return r.version !== currentActiveVer; }).slice(0, 3).forEach(addReleaseCard);
        filteredList.filter(function(r) {
          return r.version !== currentActiveVer && (!r.releasePack || r.releasePack.healthy !== false);
        }).slice(0, 3).forEach(addReleaseCard);
        filteredList = compactList.length ? compactList : filteredList.slice(0, 6);
        
        if (filteredList.length === 0) {
          tbody.innerHTML = "<div class='release-empty'>暂无历史 Release 数据包。</div>";
          return;
        }
        
        filteredList.forEach(function(r) {
          var card = document.createElement("div");
          var isActive = (r.version === currentActiveVer);
          card.className = "release-card" + (isActive ? " active" : "");
          var statusCell = isActive ? "<span class='badge success'>active</span>" : "<span class='badge muted'>archived</span>";
          
          var countText =
            "class " + (r.counts?.classScheduleCount || 0) +
            " / teacher " + (r.counts?.teacherScheduleCount || 0) +
            " / classroom " + (r.counts?.classroomScheduleCount || 0) +
            " / course " + (r.counts?.courseScheduleCount || 0);
          var pack = r.releasePack || {};
          var packText = pack.manifestExists
            ? ("Release Pack " + (pack.healthy ? "OK" : "需检查") + " / detail " + ((pack.detailCounts && pack.detailCounts.class) || 0) + " / " + formatBytes(pack.totalBytes || 0))
            : "Release Pack 未生成";
            
          card.innerHTML =
            "<div class='release-card-head'>" +
              "<div class='release-version'>" + escapeHtml(r.version) + "</div>" +
              statusCell +
            "</div>" +
            "<div class='release-meta'>term " + escapeHtml(r.semester || "-") + "<br>发布 " + formatDate(r.updatedAt) + "</div>" +
            "<div class='release-counts'>" + escapeHtml(countText) + "</div>" +
            "<div class='release-counts'>" + escapeHtml(packText) + "</div>" +
            "<div class='release-actions'></div>";

          var actions = card.querySelector(".release-actions");
          var viewBtn = document.createElement("button");
          viewBtn.className = "btn ghost";
          viewBtn.style = "padding: 3px 8px; font-size:11px;";
          viewBtn.textContent = "查看";
          viewBtn.addEventListener("click", function() {
            copyText(r.version);
          });
          actions.appendChild(viewBtn);

          var actionBtn = document.createElement("button");
          actionBtn.className = "btn ghost";
          actionBtn.style = "padding: 3px 8px; font-size:11px;";
          if (isActive) {
            actionBtn.textContent = "当前活跃";
            actionBtn.disabled = true;
          } else {
            actionBtn.textContent = "回滚";
            actionBtn.addEventListener("click", function() {
              rollbackToVersion(r.version, actionBtn);
            });
          }
          actions.appendChild(actionBtn);

          var rebuildBtn = document.createElement("button");
          rebuildBtn.className = "btn ghost";
          rebuildBtn.style = "padding: 3px 8px; font-size:11px; margin-right: 4px;";
          rebuildBtn.textContent = "重建 Release Pack";
          if (state.systemLoad && state.systemLoad.high) {
            rebuildBtn.disabled = true;
            rebuildBtn.title = "服务器负载较高，请稍后执行重建任务";
          }
          rebuildBtn.addEventListener("click", function() {
            rebuildReleaseIndex(r.version, rebuildBtn);
          });
          actions.appendChild(rebuildBtn);

          var deleteBtn = document.createElement("button");
          deleteBtn.className = "btn danger";
          deleteBtn.style = "padding: 3px 8px; font-size:11px;";
          deleteBtn.textContent = "删除";
          deleteBtn.disabled = isActive;
          deleteBtn.addEventListener("click", function() {
            deleteReleaseVersion(r.version, deleteBtn);
          });
          actions.appendChild(deleteBtn);
          tbody.appendChild(card);
        });
      }

      function rebuildReleaseIndex(version, btn) {
        var restoreButton = setButtonLoading(btn, "已启动...");
        api("/api/admin/release-pack/rebuild/start", {
          method: "POST",
          body: JSON.stringify({ version: version })
        })
          .then(function(res) {
            var job = res.job || {};
            showToast("Release Pack 重建任务已启动", "success");
            pollAdminJob(job.id, "Release Pack 重建", function() {
              restoreButton();
              loadSyncStatus();
            });
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message || "重建 Release Pack 失败", "error");
          });
      }

      function renderJobProgress(job, label, panelId) {
        var panel = $(panelId || "syncJobLog");
        if (!panel || !job) return;
        var logs = Array.isArray(job.logs) ? job.logs : [];
        var lastData = {};
        for (var i = logs.length - 1; i >= 0; i--) {
          if (logs[i] && logs[i].data) {
            lastData = logs[i].data;
            break;
          }
        }
        var result = job.result || {};
        var staticSync = result.staticSync || {};
        var phase = lastData.phase || staticSync.phase || (logs.length ? logs[logs.length - 1].message : "") || job.status || "queued";
        var totalFiles = lastData.totalFiles || staticSync.totalFiles || 0;
        var processedFiles = lastData.processedFiles || staticSync.processedFiles || 0;
        var copiedFiles = lastData.copiedFiles || staticSync.filesCopied || staticSync.copiedFiles || 0;
        var copiedBytes = lastData.copiedBytes || staticSync.bytesCopied || staticSync.copiedBytes || 0;
        var started = job.startedAt ? Date.parse(job.startedAt) : 0;
        var elapsed = started ? Math.max(0, Math.round((Date.now() - started) / 1000)) + "s" : "-";
        var recentLogs = logs.slice(-6).map(function(line) {
          return "<div><span>" + escapeHtml(line.at ? formatDate(line.at) : "") + "</span>" + escapeHtml(line.message || "") + "</div>";
        }).join("");
        if (job.error && job.error.message) {
          recentLogs += "<div><span>失败原因</span>" + escapeHtml(job.error.message) + "</div>";
        }
        panel.hidden = false;
        panel.innerHTML =
          "<div class='job-progress-head'><span>" + escapeHtml(label || job.type || "后台任务") + "</span><span class='badge " + (job.status === "failed" ? "danger" : (job.status === "success" ? "success" : "info")) + "'>" + escapeHtml(relayStatusText(job.status)) + " · " + (job.progress || 0) + "%</span></div>" +
          "<div class='job-progress-track'><div class='job-progress-fill' style='width:" + Math.max(0, Math.min(100, Number(job.progress || 0))) + "%'></div></div>" +
          "<div class='job-progress-grid'>" +
            "<div><span>当前阶段</span><strong>" + escapeHtml(relayStatusText(phase)) + "</strong></div>" +
            "<div><span>文件进度</span><strong>" + escapeHtml(totalFiles ? (processedFiles + " / " + totalFiles) : "-") + "</strong></div>" +
            "<div><span>复制文件</span><strong>" + escapeHtml(String(copiedFiles)) + "</strong></div>" +
            "<div><span>复制字节</span><strong>" + escapeHtml(formatBytes(copiedBytes || 0)) + "</strong></div>" +
            "<div><span>已用时间</span><strong>" + escapeHtml(elapsed) + "</strong></div>" +
          "</div>" +
          "<div class='job-log-list'>" + (recentLogs || "<div><span>最近日志</span>暂无日志</div>") + "</div>";
      }

      function pollAdminJob(jobId, label, onDone, options) {
        if (!jobId) return;
        options = options || {};
        api("/api/admin/jobs/" + encodeURIComponent(jobId))
          .then(function(res) {
            var job = res.job || {};
            var logs = job.logs || [];
            var lastLog = logs.length ? logs[logs.length - 1].message : "";
            renderJobProgress(job, label, options.panelId);
            setStatus(label + "：" + (job.status || "queued") + " · " + (job.progress || 0) + "% " + lastLog);
            if (job.status === "success") {
              showToast(label + "完成", "success");
              if (onDone) onDone(job);
              return;
            }
            if (job.status === "failed") {
              showToast((job.error && job.error.message) || (label + "失败"), "error");
              if (onDone) onDone(job);
              return;
            }
            window.setTimeout(function() { pollAdminJob(jobId, label, onDone, options); }, 1500);
          })
          .catch(function(err) {
            showToast(err.message || (label + "状态读取失败"), "error");
            if (onDone) onDone(null);
          });
      }

      function startPostPublishVerify(btn, version) {
        var restoreButton = setButtonLoading(btn, "Verifying...");
        var payload = {};
        if (version) payload.version = version;
        api("/api/admin/release-pack/verify/start", {
          method: "POST",
          body: JSON.stringify(payload)
        })
          .then(function(res) {
            var job = res.job || {};
            if (!job.id) {
              restoreButton();
              showToast("Verify job was not created", "error");
              return;
            }
            showToast("Post-publish verify job started", "success");
            pollAdminJob(job.id, "Post-publish verify", function(doneJob) {
              restoreButton();
              if (doneJob && doneJob.status === "success") {
                var result = doneJob.result || {};
                setStatus("Post-publish verify OK: classIndex=" + (result.classIndexCount || 0) + ", emptyRoom=" + (result.emptyRoomCount || 0));
                loadSyncStatus();
              }
            });
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message || "Failed to start verify job", "error");
          });
      }

      function startStaticSync(btn, version, options) {
        options = options || {};
        var restoreButton = setButtonLoading(btn, options.force ? "重同步中..." : "同步中...");
        var payload = {};
        if (version) payload.version = version;
        if (options.force) payload.force = true;
        api("/api/admin/static-release-sync/start", {
          method: "POST",
          body: JSON.stringify(payload)
        })
          .then(function(res) {
            var job = res.job || {};
            if (!job.id) {
              restoreButton();
              showToast("静态同步任务未创建", "error");
              return;
            }
            showToast(options.force ? "OpenResty 强制重同步任务已启动" : "OpenResty 静态同步任务已启动", "success");
            pollAdminJob(job.id, options.force ? "OpenResty 强制重同步" : "OpenResty 静态同步", function(doneJob) {
              restoreButton();
              if (doneJob && doneJob.status === "success") {
                loadSyncStatus();
              }
            });
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message || "静态同步启动失败", "error");
          });
      }

      function refreshStorageStatus(force) {
        return api("/api/admin/storage/status" + (force ? "?force=1" : ""))
          .then(function(res) {
            state.storageStatus = res || null;
            renderRuntimeStorage();
            return res;
          });
      }

      function runStorageScan(btn) {
        var restoreButton = setButtonLoading(btn, "扫描中...");
        api("/api/admin/storage/scan", { method: "POST", body: "{}" })
          .then(function() {
            showToast("存储扫描完成", "success");
            return refreshStorageStatus(true);
          })
          .finally(function() {
            restoreButton();
          })
          .catch(function(err) {
            showToast(err.message || "存储扫描失败", "error");
          });
      }

      function runMaintenance(btn, dryRun) {
        var restoreButton = setButtonLoading(btn, dryRun ? "已启动..." : "已启动...");
        api(dryRun ? "/api/admin/storage/maintenance/preview" : "/api/admin/storage/maintenance/run", {
          method: "POST",
          body: "{}"
        })
          .then(function(res) {
            var job = res.job || {};
            if (!job.id) {
              restoreButton();
              showToast("维护任务未创建", "error");
              return;
            }
            showToast(dryRun ? "安全清理预览已进入后台任务" : "安全清理已进入后台任务", "success");
            pollAdminJob(job.id, dryRun ? "存储维护预览" : "存储维护", function(doneJob) {
              restoreButton();
              if (doneJob && doneJob.status === "success") {
                var report = doneJob.result && doneJob.result.report || {};
                showToast((dryRun ? "清理预览完成" : "安全清理完成") + "，释放 " + formatBytes(report.reclaimedBytes || 0), "success");
                refreshStorageStatus(true);
              }
            });
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message || "维护任务失败", "error");
          });
      }

      window.checkActiveReleaseAvailability = function(btn) {
        var restoreButton = setButtonLoading(btn, "已启动...");
        api("/api/admin/release-pack/deep-health/start", { method: "POST", body: JSON.stringify({}) })
          .then(function(res) {
            var job = res.job || {};
            showToast("深度健康检查任务已启动", "success");
            pollAdminJob(job.id, "深度健康检查", function(doneJob) {
              restoreButton();
              if (doneJob && doneJob.status === "success") {
                var status = doneJob.result && doneJob.result.status || {};
                alert("Release Pack 深度健康检查完成\\n\\n版本: " + (status.releaseVersion || "-") + "\\n健康: " + (status.healthy ? "OK" : "Fail") + "\\n总大小: " + formatBytes(status.totalBytes || 0) + "\\nmissing: " + ((status.missing || []).join(", ") || "-") + "\\nhash: " + ((status.hashErrors || []).join(", ") || "-"));
              }
            });
          })
          .catch(function(err) {
            restoreButton();
            showToast("可用性检查失败: " + err.message, "error");
          });
      }

      // 执行回滚
      function rollbackToVersion(version, btn) {
        if (!confirm("警告：确定要将线上全校课表一键回滚到快照 [" + version + "] 吗？\\\\n该操作会立即覆盖小程序端当前的可见数据，并自动创建当前版本的备份！")) {
          return;
        }
        
        setStatus("正在将快照版本回滚为 " + version + "...");
        var restoreButton = setButtonLoading(btn, "回滚中...");
        api("/api/admin/sync/releases/rollback", {
          method: "POST",
          body: JSON.stringify({ version: version })
        })
          .then(function(res) {
            var job = res.job || {};
            if (job.id) {
              pollAdminJob(job.id, "Release 回滚", function(doneJob) {
                restoreButton();
                if (doneJob && doneJob.status === "success") {
                  showToast("回滚成功！系统已被重置为历史版本: " + version, "success");
                }
                loadSyncStatus();
              });
              return;
            }
            restoreButton();
            showToast("回滚任务已启动", "success");
            loadSyncStatus();
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message, "error");
            loadSyncStatus();
          });
      }

      window.copyText = function(text) {
        var value = text == null ? "" : String(text);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          var clipboardSettled = false;
          var clipboardFallbackTimer = window.setTimeout(function() {
            if (clipboardSettled) return;
            clipboardSettled = true;
            fallbackCopyText(value);
          }, 900);
          navigator.clipboard.writeText(value)
            .then(function() {
              if (clipboardSettled) return;
              clipboardSettled = true;
              window.clearTimeout(clipboardFallbackTimer);
              showToast("命令已复制到剪贴板。");
            })
            .catch(function() {
              if (clipboardSettled) return;
              clipboardSettled = true;
              window.clearTimeout(clipboardFallbackTimer);
              fallbackCopyText(value);
            });
          return;
        }
        fallbackCopyText(value);
      };

      function fallbackCopyText(text) {
        var previousFocus = document.activeElement;
        var input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "readonly");
        input.style.position = "fixed";
        input.style.top = "-1000px";
        input.style.left = "-1000px";
        var copied = false;
        try {
          document.body.appendChild(input);
          input.focus();
          input.select();
          copied = document.execCommand("copy") === true;
        } catch (error) {
          copied = false;
        } finally {
          if (input.parentNode) input.parentNode.removeChild(input);
          if (previousFocus && document.documentElement.contains(previousFocus) && previousFocus.focus) previousFocus.focus();
        }
        if (copied) showToast("命令已复制到剪贴板。", "success");
        else showToast("复制失败，请手动选择命令文本后复制。", "error");
        return copied;
      };

      function copyAppConfigUrl() {
        copyText(location.origin + "/api/fosu/app-config");
      }

      function copyPublicConfigJson() {
        safeFetch("/api/fosu/app-config").then(function(result) {
          if (!result.ok) {
            showToast(result.message || "公开配置读取失败", "error");
            return;
          }
          copyText(JSON.stringify(result.data, null, 2));
        });
      }

      function clearAdminCache() {
        clearAdminClientState();
        ["FOSU_ADMIN_CACHE", "FOSU_ADMIN_LAST_SECTION"].forEach(function(key) {
          try { localStorage.removeItem(key); } catch (e) {}
          try { sessionStorage.removeItem(key); } catch (e) {}
        });
        showToast("本地后台缓存已清理", "success");
      }

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
        if (!grid) return;
        grid.classList.remove("sync-health-empty");
        grid.innerHTML = "";
        
        var apis = [
          { name: "/api/health", path: "/api/health" },
          { name: "/api/fosu/app-config", path: "/api/fosu/app-config" },
          { name: "/api/fosu/release-pack/manifest", path: "/api/fosu/release-pack/manifest" },
          { name: "/api/admin/release-pack/quick-health", path: "/api/admin/release-pack/quick-health" },
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
          safeFetch(a.path)
            .then(function(result) {
              var speedBadge = $("health-speed-" + btoa(a.path).replace(/=/g, ""));
              if (speedBadge) {
                if (result.ok) {
                  speedBadge.className = "badge success";
                  speedBadge.textContent = result.status + " · " + result.duration + "ms · 正常";
                } else {
                  speedBadge.className = "badge danger";
                  var summary = result.status === 401 ? "需管理员权限/令牌" : (result.message || "异常");
                  speedBadge.textContent = (result.status || "断开") + " · " + result.duration + "ms · " + summary.slice(0, 18);
                }
              }
            });
        });
      }

      // 上传文件 Staging 后端交互
      safeBind("syncSelectFileBtn", "click", function() {
        var input = $("syncFileInput");
        if (input) input.click();
      });

      function handleStagingFile(file, infoId) {
        if (!file) return;
        
        var uploadInfo = $(infoId || "uploadFileInfo");
        if (!uploadInfo) return;
        if (file.size > 100 * 1024 * 1024) {
          var ok = confirm("该文件超过 100MB。主流程建议使用 CLI gzip chunk 上传。若继续使用网页入口，浏览器将按 Blob 分片上传且不会一次性 JSON.parse。是否继续？");
          if (!ok) {
            uploadInfo.innerHTML = "<span style='color: var(--danger);'>文件 " + escapeHtml(file.name) + " 超过 100MB。全量大文件请使用 CLI 分片上传，网页上传仅用于小文件测试。</span>";
            showToast("100MB+ Staging JSON 请使用 CLI 分片上传", "error");
            return;
          }
        }
        uploadStagingFileByChunks(file, uploadInfo);
      }

      function readFileHead(file, maxBytes) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function(e) {
            resolve(e.target.result || "");
          };
          reader.onerror = function() {
            reject(new Error("文件头读取失败"));
          };
          reader.readAsText(file.slice(0, Math.min(file.size, maxBytes || 4 * 1024 * 1024)));
        });
      }

      function extractStagingMetadataFromHead(head) {
        function pick(key) {
          var re = new RegExp('"' + key + '"\\\\s*:\\\\s*"([^"]+)"');
          var match = re.exec(head || "");
          return match ? match[1] : "";
        }
        return {
          term: pick("term") || pick("semester"),
          releaseVersion: pick("releaseVersion") || pick("version"),
          generatedAt: pick("generatedAt") || pick("updatedAt"),
        };
      }

      function uploadRawChunk(url, blob) {
        var headers = { "Content-Type": "application/octet-stream" };
        if (state.csrfToken) {
          headers["X-Fosu-CSRF"] = state.csrfToken;
        }
        return fetch(url, {
          method: "POST",
          credentials: "include",
          headers: headers,
          body: blob,
        }).then(function(res) {
          return res.text().then(function(text) {
            var data = {};
            try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { message: text }; }
            if (!res.ok || data.success === false) {
              throw new Error(data.message || ("HTTP " + res.status));
            }
            return data;
          });
        });
      }

      function uploadStagingFileByChunks(file, uploadInfo) {
        var chunkSize = 8 * 1024 * 1024;
        var totalChunks = Math.ceil(file.size / chunkSize);
        var uploadId = "";
        uploadInfo.innerHTML = "正在初始化分片上传: <strong>" + escapeHtml(file.name) + "</strong> (" + totalChunks + " chunks)...";

        readFileHead(file, 4 * 1024 * 1024)
          .then(function(head) {
            var meta = extractStagingMetadataFromHead(head);
            if (!meta.term) {
              uploadInfo.innerHTML = "<span style='color: var(--danger);'>错误: 文件头未读取到 term 字段，请确认这是 Staging JSON。</span>";
              throw new Error("Staging JSON 缺少 term 字段");
            }
            return api("/api/admin/staging/upload/init", {
              method: "POST",
              body: JSON.stringify({
                fileName: file.name,
                term: meta.term,
                releaseVersion: meta.releaseVersion || "",
                source: "web-admin-blob-upload",
                contentEncoding: "identity",
                contentType: "application/json",
                chunkSize: chunkSize,
                totalChunks: totalChunks,
                uploadSize: file.size,
                originalSize: file.size,
              })
            });
          })
          .then(function(init) {
            uploadId = init.uploadId || (init.upload && init.upload.uploadId);
            if (!uploadId) {
              throw new Error("上传初始化失败：缺少 uploadId");
            }
            var chain = Promise.resolve();
            for (var index = 0; index < totalChunks; index += 1) {
              (function(chunkIndex) {
                chain = chain.then(function() {
                  var start = chunkIndex * chunkSize;
                  var end = Math.min(file.size, start + chunkSize);
                  uploadInfo.innerHTML = "正在上传分片 " + (chunkIndex + 1) + "/" + totalChunks + " · " + ((end / file.size) * 100).toFixed(1) + "%";
                  return uploadRawChunk("/api/admin/staging/upload/chunk?uploadId=" + encodeURIComponent(uploadId) + "&chunkIndex=" + chunkIndex, file.slice(start, end));
                });
              })(index);
            }
            return chain;
          })
          .then(function() {
            uploadInfo.innerHTML = "分片上传完成，正在服务端合并、校验并进入 pending-review...";
            return api("/api/admin/staging/upload/finalize", {
              method: "POST",
              body: JSON.stringify({
                uploadId: uploadId,
                uploadSize: file.size,
                originalSize: file.size,
                totalChunks: totalChunks,
              })
            });
          })
          .then(function(res) {
            uploadInfo.innerHTML = "<span style='color: var(--success);'>已通过: " + escapeHtml(res.message || "分片上传校验成功，已进入 pending-review。") + "</span>";
            showToast("Staging JSON 已分片上传并进入 pending-review", "success");
            loadStagingPreview();
            return loadSyncStatus();
          })
          .catch(function(err) {
            if (uploadId) {
              api("/api/admin/staging/" + encodeURIComponent(uploadId), { method: "DELETE" }).catch(function() {});
            }
            uploadInfo.innerHTML = "<span style='color: var(--danger);'>上传失败: " + escapeHtml(err.message) + "</span>";
            showToast(err.message, "error");
          });
      }

      function deleteReleaseVersion(version, btn) {
        if (!confirm("确认删除历史 Release [" + version + "] 吗？当前 active 版本不能被删除。")) {
          return;
        }
        var restoreButton = setButtonLoading(btn, "删除中...");
        api("/api/admin/sync/releases/" + encodeURIComponent(version), { method: "DELETE" })
          .then(function() {
            state.releasesHistory = (state.releasesHistory || []).filter(function(item) { return item.version !== version; });
            renderReleaseHistoryTable();
            showToast("历史 Release 已删除", "success");
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message || "删除失败", "error");
          });
      }

      safeBind("syncFileInput", "change", function(e) {
        var file = e.target.files[0];
        handleStagingFile(file, "uploadFileInfo");
      });

      safeBind("quickSyncFileInput", "change", function(e) {
        var file = e.target.files[0];
        handleStagingFile(file, "quickUploadFileInfo");
      });

      safeBind("quickSelectUploadFileBtn", "click", function() {
        var input = $("quickSyncFileInput");
        if (input) input.click();
      });

      safeBind("quickCopyUploadCmdBtn", "click", function() {
        var code = $("quickUploadCommand") ? $("quickUploadCommand").textContent : "";
        if (code) copyText(code);
      });

      safeBind("stagingPublishBtn", "click", function() {
        publishStaging();
      });

      safeBind("postPublishVerifyBtn", "click", function() {
        startPostPublishVerify($("postPublishVerifyBtn"));
      });

      safeBind("refreshStagingUploadsBtn", "click", function() {
        var btn = $("refreshStagingUploadsBtn");
        var restoreButton = setButtonLoading(btn, "刷新中...");
        loadStagingUploadsPanel()
          .then(function(res) {
            showToast("上传列表已刷新", "success");
            restoreButton();
          })
          .catch(function(err) {
            restoreButton();
            showToast(err.message, "error");
          });
      });
      safeBind("stagingUploadTermFilter", "input", function() {
        state.stagingUploadFilters.term = ($("stagingUploadTermFilter").value || "").trim();
        state.stagingUploadCursor = 0;
        loadStagingUploadsPanel().catch(function(err) { showToast(err.message, "error"); });
      });
      safeBind("stagingUploadStateFilter", "change", function() {
        state.stagingUploadFilters.status = $("stagingUploadStateFilter").value || "";
        state.stagingUploadCursor = 0;
        loadStagingUploadsPanel().catch(function(err) { showToast(err.message, "error"); });
      });
      safeBind("stagingUploadPageSize", "change", function() {
        state.stagingUploadPageSize = Number($("stagingUploadPageSize").value || 50) || 50;
        state.stagingUploadCursor = 0;
        loadStagingUploadsPanel().catch(function(err) { showToast(err.message, "error"); });
      });
      safeBind("stagingUploadPrevPageBtn", "click", function() {
        state.stagingUploadCursor = Math.max(0, (state.stagingUploadCursor || 0) - (state.stagingUploadPageSize || 50));
        loadStagingUploadsPanel().catch(function(err) { showToast(err.message, "error"); });
      });
      safeBind("stagingUploadNextPageBtn", "click", function() {
        if (state.stagingUploadNextCursor == null) return;
        state.stagingUploadCursor = state.stagingUploadNextCursor;
        loadStagingUploadsPanel().catch(function(err) { showToast(err.message, "error"); });
      });
      safeBind("stagingUploadSelectAll", "change", function() {
        var checked = Boolean($("stagingUploadSelectAll").checked);
        document.querySelectorAll(".staging-upload-row-select,.staging-upload-group-select").forEach(function(input) {
          if (!input.disabled) input.checked = checked;
        });
      });
      safeBind("deleteSelectedStagingUploadsBtn", "click", function() {
        deleteStagingUploadIds(collectSelectedStagingUploadIds(), $("deleteSelectedStagingUploadsBtn"), "删除所选");
      });
      safeBind("purgeDuplicateStagingUploadsBtn", "click", function() {
        purgeDuplicateStagingUploads($("purgeDuplicateStagingUploadsBtn"));
      });
      safeBind("purgeFailedStagingUploadsBtn", "click", function() {
        purgeFailedStagingUploads($("purgeFailedStagingUploadsBtn"));
      });
      safeBind("purgeIncompleteStagingUploadsBtn", "click", function() {
        purgeIncompleteStagingUploads($("purgeIncompleteStagingUploadsBtn"));
      });
      safeBind("previewExpiredStagingUploadsBtn", "click", function() {
        runMaintenance($("previewExpiredStagingUploadsBtn"), true);
      });
      safeBind("rebuildStagingUploadIndexBtn", "click", function() {
        rebuildStagingUploadIndex($("rebuildStagingUploadIndexBtn"));
      });

      // 拖拽上传支持
      setTimeout(function() {
        var dropzone = $("uploadDropzone");
        if (dropzone) {
          dropzone.addEventListener("dragover", function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = "var(--primary)";
            dropzone.style.background = "var(--primary-soft)";
          });
          dropzone.addEventListener("dragenter", function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = "var(--primary)";
            dropzone.style.background = "var(--primary-soft)";
          });
          dropzone.addEventListener("dragleave", function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = "var(--border)";
            dropzone.style.background = "transparent";
          });
          dropzone.addEventListener("drop", function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = "var(--border)";
            dropzone.style.background = "transparent";
            
            var dt = e.dataTransfer;
            var file = dt.files[0];
            handleStagingFile(file, "uploadFileInfo");
          });
        }

        var quickDropzone = $("quickUploadDropzone");
        if (quickDropzone) {
          quickDropzone.addEventListener("click", function(e) {
            if (e.target && e.target.id === "quickSelectUploadFileBtn") return;
            var input = $("quickSyncFileInput");
            if (input) input.click();
          });
          quickDropzone.addEventListener("dragover", function(e) {
            e.preventDefault();
            e.stopPropagation();
            quickDropzone.style.borderColor = "var(--primary)";
            quickDropzone.style.background = "var(--primary-soft)";
          });
          quickDropzone.addEventListener("dragenter", function(e) {
            e.preventDefault();
            e.stopPropagation();
            quickDropzone.style.borderColor = "var(--primary)";
            quickDropzone.style.background = "var(--primary-soft)";
          });
          quickDropzone.addEventListener("dragleave", function(e) {
            e.preventDefault();
            e.stopPropagation();
            quickDropzone.style.borderColor = "var(--border)";
            quickDropzone.style.background = "transparent";
          });
          quickDropzone.addEventListener("drop", function(e) {
            e.preventDefault();
            e.stopPropagation();
            quickDropzone.style.borderColor = "var(--border)";
            quickDropzone.style.background = "transparent";
            var dt = e.dataTransfer;
            var file = dt.files[0];
            handleStagingFile(file, "quickUploadFileInfo");
          });
        }
      }, 500);

      // 获取 Staging 差异比对与展示
      function loadStagingPreview() {
        var previewBox = $("stagingPreviewBox");
        if (!previewBox) return;
        
        api("/api/admin/sync/staging/current")
          .then(function(res) {
            if (res.success && res.data) {
              previewBox.style.display = "block";
              var d = res.data;
              
              // 1. 元数据与同步范围信息
              var meta = d.meta || {};
              var scopesText = meta.includeScopes ? meta.includeScopes : "全量数据";
              var timeStr = d.generatedAt ? formatDate(d.generatedAt) : "未知";
              
              $("stagingMetaBadge").innerHTML = 
                "目标学期: " + (d.term || meta.term || "-") + 
                " | 版本: " + (d.releaseVersion || "-") + 
                "<br>数据来源: " + (d.source || meta.source || "本机校园网采集") +
                "<br>包含模块: <code style='font-size:11.5px; font-weight:700; color:var(--primary);'>" + scopesText + "</code>" +
                "<br>生成时间: " + timeStr;
              
              // 2. 填充数值
              $("stagingValClass").textContent = d.counts.classScheduleCount;
              $("stagingValTeacher").textContent = d.counts.teacherScheduleCount;
              $("stagingValClassroom").textContent = d.counts.classroomScheduleCount;
              $("stagingValCourse").textContent = d.counts.courseScheduleCount;
              
              $("stagingValRoomCount").textContent = d.counts.classroomCount;
              $("stagingValTeacherCount").textContent = d.counts.teacherCount;
              $("stagingValCourseCount").textContent = d.counts.courseCount;
              if ($("stagingValCollegeGradeCount")) {
                $("stagingValCollegeGradeCount").textContent = (d.counts.collegeCount || 0) + " / " + (d.counts.gradeCount || 0);
              }
              var cacheUsage = meta.cacheUsage || {};
              var usedCache = Boolean(meta.usedClassScheduleCache || cacheUsage.usedClassScheduleCache);
              if ($("stagingValCacheUsed")) {
                $("stagingValCacheUsed").textContent = usedCache ? "是" : "否";
              }
              if ($("stagingCacheSource")) {
                $("stagingCacheSource").textContent = usedCache ? (meta.cacheSource || cacheUsage.cacheSource || "历史 classSchedules") : "-";
              }
              if ($("stagingValForceRefresh")) {
                $("stagingValForceRefresh").textContent = meta.forceRefresh ? "是" : "否";
              }
              var safety = d.safety || {};
              if ($("stagingValAllowPublish")) {
                $("stagingValAllowPublish").textContent = safety.allowPublish === false ? "否" : "是";
              }
              if ($("stagingPublishGate")) {
                $("stagingPublishGate").textContent = safety.allowPublish === false ? "后端已拦截" : (safety.requiresForceConfirm ? "需二次确认" : "可发布");
              }
              
              // 3. 填充差异 Diff 趋势
              var renderDiffSpan = function(elId, delta) {
                var el = $(elId);
                if (!el) return;
                if (delta > 0) {
                  el.className = "staging-item-diff diff-plus";
                  el.textContent = "↑ +" + delta;
                } else if (delta < 0) {
                  el.className = "staging-item-diff diff-minus";
                  el.textContent = "↓ " + delta;
                } else {
                  el.className = "staging-item-diff diff-equal";
                  el.textContent = "— 无变化";
                }
              };
              
              renderDiffSpan("stagingDiffClass", d.diff.classDelta);
              renderDiffSpan("stagingDiffTeacher", d.diff.teacherDelta);
              renderDiffSpan("stagingDiffClassroom", d.diff.classroomDelta);
              renderDiffSpan("stagingDiffCourse", d.diff.courseDelta);
              
              // 资产列表差异 (教室、教师、课程)
              renderDiffSpan("stagingDiffRoomCount", d.diff.classroomDelta);
              renderDiffSpan("stagingDiffTeacherCount", d.diff.teacherDelta);
              renderDiffSpan("stagingDiffCourseCount", d.diff.courseDelta);
              
              // 4. 详细行政班级列表变动明细
              var diffListEl = $("stagingDiffClassesList");
              if (diffListEl) {
                var html = "";
                if (d.diff.deletedCount > 0) {
                  html += "<strong style='color:var(--danger);'>删除了以下行政班 (" + d.diff.deletedCount + " 个)：</strong>";
                  html += "<div>" + d.diff.deletedClasses.map(function(c) { return "<span>" + escapeHtml(c) + "</span>"; }).join("") + "</div>";
                }
                if (d.diff.addedCount > 0) {
                  html += "<strong style='color:var(--success);'>新增了以下行政班 (" + d.diff.addedCount + " 个)：</strong>";
                  html += "<div>" + d.diff.addedClasses.map(function(c) { return "<span>" + escapeHtml(c) + "</span>"; }).join("") + "</div>";
                }
                if (d.diff.deletedCount === 0 && d.diff.addedCount === 0) {
                  html = "<div style='color: var(--muted); padding: 8px 0;'>行政班级名单完全一致，无增删变化。</div>";
                }
                diffListEl.innerHTML = html;
              }
              
              // 5. 校验警告
              var warnBox = $("stagingWarningsBox");
              var warnList = $("stagingWarningsList");
              
              // 默认启用发布按钮
              var publishBtn = $("stagingPublishBtn");
              if (publishBtn) {
                publishBtn.disabled = false;
              }
              
              var warnings = [];
              
              if (safety.riskDrops && safety.riskDrops.length > 0) {
                safety.riskDrops.forEach(function(item) {
                  warnings.push(
                    item.label + ": 线上 " + item.activeCount +
                    " -> Staging " + item.stagingCount +
                    "，下降 " + item.dropPercent + "%" +
                    (item.severity === "danger" ? "，必须强制确认。" : "，请核对。")
                  );
                });
              }
              
              if (res.warnings && res.warnings.length > 0) {
                warnings = warnings.concat(res.warnings);
              }
              if (safety.warnings && safety.warnings.length > 0) {
                warnings = warnings.concat(safety.warnings);
              }
              if (safety.blockerDetails && safety.blockerDetails.length > 0) {
                warnings = warnings.concat(safety.blockerDetails.map(function(item) {
                  var parts = [item.code || "STAGING_SAFETY_BLOCKER"];
                  if (item.resource) parts.push("资源: " + item.resource);
                  if (item.field) parts.push("字段: " + item.field);
                  if (item.activeValue !== undefined) parts.push("线上: " + item.activeValue);
                  if (item.stagingValue !== undefined) parts.push("本次: " + item.stagingValue);
                  if (item.expectedValue !== undefined) parts.push("预期: " + item.expectedValue);
                  if (item.message) parts.push(item.message);
                  return "发布阻断: " + parts.join(" | ");
                }));
                if (publishBtn) publishBtn.disabled = true;
              } else if (safety.blockers && safety.blockers.length > 0) {
                warnings = warnings.concat(safety.blockers.map(function(item) { return "发布阻断: " + item; }));
                if (publishBtn) publishBtn.disabled = true;
              }
              
              // 防呆熔断判断：若 classSchedules 数量为 0 且前端勾选了行政班，强行禁用发布并警告
              var isClassChecked = $("rangeClass") ? $("rangeClass").checked : true;
              if (d.counts.classScheduleCount === 0 && isClassChecked) {
                if (publishBtn) publishBtn.disabled = true;
                if (warnBox && warnList) {
                  warnBox.style.display = "flex";
                  warnList.innerHTML = "<div style='color: var(--danger); font-weight: bold;'>熔断拦截: 本次上传的行政班课表数为 0，但您的同步范围中勾选了行政班。这可能意味着本地同步没有成功跑完行政班抓取，或者没有在本地命令中正确传入 SYNC_CLASS_SCOPE=all。为了防止发布空包清空小程序线上数据，正式发布已被强行禁用！请使用命令生成器推荐的完整命令重新抓取。</div>";
                }
                showToast("行政班课表为空，疑似同步未生效！发布已被强行禁止。", "error");
                
                // 触发熔断二次强确认面板显示为 none 避免混淆
                var forceBox = $("forceConfirmContainer");
                if (forceBox) forceBox.style.display = "none";
                return;
              }
              
              if (warnings.length > 0) {
                if (warnBox && warnList) {
                  warnBox.style.display = "flex";
                  warnList.innerHTML = warnings.map(function(w) { return "<div>• " + escapeHtml(w) + "</div>"; }).join("");
                }
              } else {
                if (warnBox) warnBox.style.display = "none";
              }
              
              // 6. 熔断触发逻辑
              var forceBox = $("forceConfirmContainer");
              var forceCheckbox = $("stagingForceConfirm");
              if (forceBox) {
                if (safety.requiresForceConfirm || Number(d.diff.changeRate || 0) > 50) {
                  forceBox.style.display = "block";
                  if (forceCheckbox) forceCheckbox.checked = false;
                  showToast("上传的数据变动较大，发布需要勾选下方二次确认。", "warning");
                } else {
                  forceBox.style.display = "none";
                }
              }
            }
          })
          .catch(function(err) {
            showToast("拉取 Staging 预览详情失败: " + err.message, "error");
          });
      }

      function publishStaging(sourceButton) {
        var forceConfirm = $("stagingForceConfirm");
        var force = forceConfirm ? forceConfirm.checked : false;
        
        setStatus("正在正式发布课表快照版本...");
        var publishBtn = sourceButton || $("stagingPublishBtn");
        var restoreButton = setButtonLoading(publishBtn, "发布中...");
        
        api("/api/admin/sync/staging/publish/start", {
          method: "POST",
          body: JSON.stringify({ force: force })
        })
          .then(function(res) {
            var publishJob = res.job || {};
            if (publishJob.id) {
              showToast("Publish job started", "success");
              pollAdminJob(publishJob.id, "Staging publish", function(doneJob) {
                restoreButton();
                if (!doneJob || doneJob.status !== "success") return;
                var result = doneJob.result || {};
                showToast("Publish complete. Live release data updated.", "success");
                var verifyCmdFromJob = "npm run verify:release-live -- --server=" + location.origin + (result.term || result.semester ? " --term=" + (result.term || result.semester) : "");
                setStatus("Published. Static pack quick health=" + ((result.quickHealth && result.quickHealth.healthy) ? "OK" : "check required") + ". Verify command: " + verifyCmdFromJob);
                if (typeof copyText === "function") {
                  copyText(verifyCmdFromJob);
                }
                if ($("stagingPreviewBox")) $("stagingPreviewBox").style.display = "none";
                if ($("uploadFileInfo")) $("uploadFileInfo").textContent = "";
                if ($("syncFileInput")) $("syncFileInput").value = "";
                if (forceConfirm) forceConfirm.checked = false;
                if ($("forceConfirmContainer")) $("forceConfirmContainer").style.display = "none";
                loadSyncStatus();
                startPostPublishVerify($("postPublishVerifyBtn"), result.releaseVersion || result.version);
              });
              return;
            }
            restoreButton();
            showToast("发布成功！线上课表数据已更新。", "success");
            var verifyCmd = "npm run verify:release-live -- --server=" + location.origin + (res.term || res.semester ? " --term=" + (res.term || res.semester) : "");
            setStatus("已发布。小程序将在下次打开或进入全校页时检测 releaseVersion/cacheEpoch 并安全刷新。发布后验证命令：" + verifyCmd);
            if (typeof copyText === "function") {
              copyText(verifyCmd);
            }
            // 隐藏 Staging 预览，清空文件信息
            if ($("stagingPreviewBox")) $("stagingPreviewBox").style.display = "none";
            if ($("uploadFileInfo")) $("uploadFileInfo").textContent = "";
            if ($("syncFileInput")) $("syncFileInput").value = "";
            if (forceConfirm) forceConfirm.checked = false;
            if ($("forceConfirmContainer")) $("forceConfirmContainer").style.display = "none";
            // 重新载入状态
            loadSyncStatus();
          })
          .catch(function(err) {
            restoreButton();
            // 如果是因为变动大被拦截且有BIG_CHANGE_BLOCKED代码
            if (err.message.indexOf("安全熔断值") >= 0 || err.message.indexOf("熔断") >= 0) {
              $("forceConfirmContainer").style.display = "block";
              showToast("由于数据变动大已熔断拦截，请二次勾选确认后再提交发布。", "warning");
            } else {
              showToast(err.message, "error");
            }
          });
      }

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
          { label: "课表总节数", val: stats.totalCoursesCount || 0, foot: "当前有效排课记录" },
          { label: "教师缺失课次", val: stats.missingTeacher || 0, foot: "课表中教师为空", highlight: (stats.missingTeacher > 0) },
          { label: "课室缺失课次", val: stats.missingClassroom || 0, foot: "上课教室为空", highlight: (stats.missingClassroom > 0) },
          { label: "严重冲突数", val: stats.duplicateCount || 0, foot: "同人同地同课时冲突", highlight: (stats.duplicateCount > 0) },
        ];
        
        cardList.forEach(function(item) {
          var card = document.createElement("div");
          card.className = "stat-card card";
          if (item.highlight) card.style.borderColor = "var(--danger)";
          card.innerHTML = "<div class='stat-head'>" + item.label + "</div>" +
                           "<div class='stat-num' " + (item.highlight ? "style='color:var(--danger);'" : "") + ">" + item.val + "</div>" +
                           "<div class='stat-foot'>" + item.foot + "</div>";
          wrap.appendChild(card);
        });

        // 渲染异常表格
        var tbody = $("qualityAnomalyTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='6' style='text-align: center; color: var(--muted); padding: 40px 0;'>校验通过：课表数据未发现明显的缺陷和冲突安排。</td></tr>";
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

      safeBind("exportQualityBtn", "click", function() {
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
        return api("/api/admin/feedbacks?status=" + status + "&keyword=" + encodeURIComponent(keyword) + "&limit=100")
          .then(function(res) {
            state.feedbacks = res.items || [];
            state.feedbackFilter.total = state.feedbacks.length;
            renderFeedbacksTable();
            if (state.section === "dashboard" && state.dashboard) {
              renderDashboardVisuals();
            }
            setStatus("反馈载入成功。");
            return state.feedbacks;
          })
          .catch(function(err) {
            showToast(err.message, "error");
            showModuleError("feedback", err);
            throw err;
          });
      }

      function renderFeedbacksTable() {
        var list = state.feedbacks;
        var tbody = $("feedbackListTable");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='5' style='text-align: center; color: var(--muted); padding: 40px 0;'>没有匹配状态或关键字的用户反馈记录。</td></tr>";
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
        
        openDetailDrawer("feedbackDrawer", "feedbackDrawerMask", "closeFeedbackDrawerBtn");
      }

      function closeFeedbackDrawer(returnFocus) {
        closeDetailDrawer("feedbackDrawer", "feedbackDrawerMask", returnFocus);
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
            ignoreLoadError(loadFeedbacks());
            ignoreLoadError(loadDashboard()); // 刷新待处理反馈数
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
          api("/api/admin/audit-logs"),
          api("/api/admin/security/status")
        ])
          .then(function(results) {
            state.backups = results[0].items || [];
            state.auditLogs = results[1].items || [];
            state.securityStatus = results[2] || null;
            
            var security = state.securityStatus && state.securityStatus.security || {};
            $("settingsSecurityStatus").textContent = security.mode || "observe";
            $("settingsSecurityStatus").style.color = security.configurationValid === false ? "var(--danger)" : "var(--success)";
            $("settingsBackupCount").textContent = state.backups.length + " 个";
            $("settingsAuditLogCount").textContent = state.auditLogs.length + " 条";
            
            renderSecurityStatus();
            renderBackupsTable();
            renderAuditLogsTable();
            setStatus("设置数据和审计日志载入完毕。");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          });
      }

      function badgeText(ok) {
        return ok ? "<span class='badge success'>OK</span>" : "<span class='badge danger'>缺失</span>";
      }

      function renderHealthItem(label, value) {
        return "<div class='health-item'><span>" + escapeHtml(label) + "</span><strong>" + value + "</strong></div>";
      }

      function renderSecurityStatus() {
        var payload = state.securityStatus || {};
        var security = payload.security || {};
        var rateLimit = payload.rateLimit || {};
        var events = payload.events || {};
        var readiness = payload.readiness || {};
        var staticReleaseSecurity = payload.staticReleaseSecurity || {};
        var counts = events.counts || {};
        var clientCheck = events.clientCheck || {};

        if ($("securityModeValue")) $("securityModeValue").textContent = security.mode || "-";
        if ($("securityModeFoot")) $("securityModeFoot").textContent = security.modeDescription || (security.configurationValid === false ? "配置存在阻断项" : "配置可用");
        if ($("securityDynamicValue")) $("securityDynamicValue").textContent = security.dynamicApiMode || (security.requireDynamicSession ? "session" : "observe");
        if ($("securityStaticValue")) $("securityStaticValue").textContent = security.staticReleaseMode || (security.requireStaticTicket ? "ticket" : (security.staticAccessMode || "public"));
        if ($("securityRateKeysValue")) $("securityRateKeysValue").textContent = String(rateLimit.keyCount || 0);
        if ($("securityRateKeysFoot")) $("securityRateKeysFoot").textContent = "上限 " + (rateLimit.maxKeys || 0);

        var configGrid = $("securityConfigGrid");
        if (configGrid) {
          configGrid.innerHTML = [
            renderHealthItem("微信 AppID", security.wechatAppidConfigured ? "<code>" + escapeHtml(security.wechatAppidMasked || "configured") + "</code>" : badgeText(false)),
            renderHealthItem("AppSecret", badgeText(Boolean(security.wechatSecretConfigured))),
            renderHealthItem("Session Secret", badgeText(Boolean(security.sessionSecretConfigured))),
            renderHealthItem("Previous Secret", security.sessionPreviousSecretConfigured ? badgeText(true) : "<span class='badge muted'>轮换时补齐</span>"),
            renderHealthItem("Static Ticket Secret", badgeText(Boolean(security.staticTicketSecretConfigured))),
            renderHealthItem("OpenResty 模式", "<code>" + escapeHtml(security.openRestySecurityMode || "public") + "</code>"),
            renderHealthItem("Session KID", "<code>" + escapeHtml(security.sessionSecretKid || "current") + "</code>"),
            renderHealthItem("Static KID", "<code>" + escapeHtml(security.staticTicketSecretKid || "current") + "</code>"),
            renderHealthItem("部署 Commit", "<code>" + escapeHtml(security.deploymentCommitSha || "-") + "</code>"),
            renderHealthItem("客户端 Build", "<code>" + escapeHtml(security.clientBuildId || "-") + "</code>"),
            renderHealthItem("Release Version", "<code>" + escapeHtml(security.activeReleaseVersion || "-") + "</code>"),
            renderHealthItem("进入 session-enforce", readiness.canEnterSessionEnforce ? badgeText(true) : "<strong>继续 observe</strong>"),
            renderHealthItem("静态真实等级", "<strong>" + escapeHtml(staticReleaseSecurity.staticReleaseSecurityLevel || "public") + "</strong>"),
            renderHealthItem("Cloudflare 边缘保护", "<strong>" + escapeHtml(staticReleaseSecurity.cloudflareEdgeProtection || "unknown") + "</strong>")
          ].join("");
        }

        var warnings = (readiness.blocking || []).concat(readiness.warnings || [], security.warnings || []);
        var warningBox = $("securityWarnings");
        if (warningBox) {
          warningBox.innerHTML = warnings.length
            ? "<span>配置告警</span><strong style='white-space:normal; text-align:right;'>" + warnings.map(escapeHtml).join("<br>") + "</strong>"
            : "<span>配置告警</span><strong>无</strong>";
        }

        var eventGrid = $("securityEventGrid");
        if (eventGrid) {
          eventGrid.innerHTML = [
            renderHealthItem("bootstrap", "<strong>" + (counts["security-session-bootstrap-success"] || 0) + "</strong>"),
            renderHealthItem("client-check", "<strong>" + (clientCheck.successCount || 0) + "</strong>"),
            renderHealthItem("最新握手", "<strong>" + escapeHtml(clientCheck.latest && formatDate(clientCheck.latest.time) || "-") + "</strong>"),
            renderHealthItem("无效 session", "<strong>" + (counts["security-session-invalid"] || 0) + "</strong>"),
            renderHealthItem("无效 ticket", "<strong>" + (counts["security-static-ticket-invalid"] || 0) + "</strong>"),
            renderHealthItem("429", "<strong>" + ((counts["security-rate-limit-observed"] || 0) + (counts["security-rate-limit-enforced"] || 0)) + "</strong>"),
            renderHealthItem("Origin 拒绝", "<strong>" + (counts["security-origin-rejected"] || 0) + "</strong>"),
            renderHealthItem("异常扫描", "<strong>" + (counts["security-suspicious-enumeration"] || 0) + "</strong>")
          ].join("");
        }

        var tbody = $("securityEventsTable");
        if (tbody) {
          var list = events.recentEvents || [];
          if (!list.length) {
            tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color:var(--muted); padding:20px 0;'>暂无安全事件</td></tr>";
          } else {
            tbody.innerHTML = list.map(function(item) {
              return "<tr>" +
                "<td>" + formatDate(item.time) + "</td>" +
                "<td><code>" + escapeHtml(item.event || "") + "</code></td>" +
                "<td><code>" + escapeHtml(item.route || "") + "</code></td>" +
                "<td>" + escapeHtml(item.reasonCode || "") + "</td>" +
                "</tr>";
            }).join("");
          }
        }
      }

      function loadSecurityStatus() {
        setStatus("正在读取安全状态...");
        return api("/api/admin/security/status")
          .then(function(res) {
            state.securityStatus = res;
            renderSecurityStatus();
            setStatus("安全状态已更新。");
            return res;
          })
          .catch(function(err) {
            showToast(err.message, "error");
            throw err;
          });
      }

      function runSecuritySelfCheck(btn) {
        var restore = setButtonLoading(btn, "自检中...");
        return api("/api/admin/security/self-check", { method: "POST", body: "{}" })
          .then(function(res) {
            state.securityStatus = res;
            renderSecurityStatus();
            showToast(res.ok ? "安全自检通过" : "安全自检存在告警", res.ok ? "success" : "error");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          })
          .finally(restore);
      }

      function exportSecurityReport(btn) {
        var restore = setButtonLoading(btn, "导出中...");
        return api("/api/admin/security/report")
          .then(function(res) {
            var content = JSON.stringify(res, null, 2);
            var blob = new Blob([content], { type: "application/json;charset=utf-8" });
            var link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "fosu-security-report.json";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast("脱敏安全报告已生成", "success");
          })
          .catch(function(err) {
            showToast(err.message, "error");
          })
          .finally(restore);
      }

      function cleanupSecurityStats(btn) {
        var restore = setButtonLoading(btn, "清理中...");
        return api("/api/admin/security/events/cleanup", { method: "POST", body: "{}" })
          .then(function() {
            showToast("过期安全统计已清理", "success");
            return loadSecurityStatus();
          })
          .catch(function(err) {
            showToast(err.message, "error");
          })
          .finally(restore);
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
          banner.innerHTML = "<div style='font-weight: 800;'>【" + escapeHtml(type) + "】" + escapeHtml(title) + "</div>" +
                             "<div style='margin-top: 4px; font-size: 9px; line-height:1.3;'>" + escapeHtml(content) + "</div>";
          screen.appendChild(banner);
        } else if (mode === "modal") {
          var mask = document.createElement("div");
          mask.className = "mini-modal-mask";
          mask.innerHTML = "<div class='mini-modal'>" +
                           "<h4>" + escapeHtml(title) + "</h4>" +
                           "<p>" + escapeHtml(content) + "</p>" +
                           "<button>我知道了</button>" +
                           "</div>";
          screen.appendChild(mask);
        } else if (mode === "ticker") {
          var ticker = document.createElement("div");
          ticker.className = "mini-ticker " + priority;
          ticker.innerHTML = "<span class='mini-ticker-icon'>告</span>" +
            "<span class='mini-ticker-track'><span class='mini-ticker-text'><span>" +
            escapeHtml(title + " · " + content) + "</span><span>" +
            escapeHtml(title + " · " + content) + "</span></span></span>";
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

      function setSelectValue(id, val) {
        var el = $(id);
        if (el) el.value = val == null ? "" : String(val);
      }

      function loadAiAgentStatus() {
        return api("/api/admin/ai-agent/status")
          .then(function(res) {
            state.aiAgentStatus = res.data || {};
            renderAiAgentStatus();
            return state.aiAgentStatus;
          })
          .catch(function(error) {
            var grid = $("aiAgentStatusGrid");
            if (grid) grid.innerHTML = renderHealthItem("Agent 状态", "<span class='badge danger'>" + escapeHtml(error.message || "加载失败") + "</span>");
            throw error;
          });
      }

      function renderProviderChain(chain) {
        if (!Array.isArray(chain) || !chain.length) return "<span class='badge muted'>未配置</span>";
        return chain.map(function(item, index) {
          var stateClass = item.circuitBreaker && item.circuitBreaker.state === "open" ? "danger" : (item.enabled ? "success" : "muted");
          return "<div style='margin-bottom:6px;'>" +
            "<span class='badge " + stateClass + "'>" + escapeHtml(String(index + 1)) + "</span> " +
            "<code>" + escapeHtml(item.name || "-") + "</code> " +
            "<span class='badge muted'>" + escapeHtml(item.health || "unknown") + "</span>" +
            (item.circuitBreaker ? " <span class='badge muted'>CB " + escapeHtml(item.circuitBreaker.state || "closed") + "</span>" : "") +
            "</div>";
        }).join("");
      }

      function renderAiAgentStatus() {
        var grid = $("aiAgentStatusGrid");
        if (!grid) return;
        var status = state.aiAgentStatus || {};
        var chain = Array.isArray(status.providerChain) ? status.providerChain : [];
        var metrics = status.metrics || {};
        var knowledge = status.knowledgeIndex || {};
        var map = status.campusMap || {};
        var image = status.imageGeneration || {};
        var tools = Array.isArray(status.enabledTools) ? status.enabledTools : [];
        var auth = status.authoritative || {};
        var authStages = auth.stageAssignments || {};
        var lastExternal = status.lastExternalCall || null;
        var naMetric = function(v) { return v === null || v === undefined ? "暂无统计" : String(v); };
        var lastSuccess = chain.map(function(item) { return item.lastSuccessAt; }).filter(Boolean).sort().pop() || "-";
        var lastFailure = chain.map(function(item) { return item.lastFailureAt; }).filter(Boolean).sort().pop() || "-";
        var p50 = chain.reduce(function(max, item) { return Math.max(max, Number(item.p50LatencyMs || 0)); }, 0);
        var p95 = chain.reduce(function(max, item) { return Math.max(max, Number(item.p95LatencyMs || 0)); }, 0);
        grid.innerHTML = [
          renderHealthItem("Agent Protocol", "<code>" + escapeHtml(status.protocolVersion || "agent.v1") + "</code>"),
          renderHealthItem("Runtime Mode", status.runtimeMode === "competition" ? "<span class='badge warning'>trial enhanced</span>" : "<span class='badge success'>public</span>"),
          renderHealthItem("已启用工具", "<strong>" + tools.length + "</strong>"),
          renderHealthItem("权威配置链", "<code>" + escapeHtml(Array.isArray(auth.effectiveChain) && auth.effectiveChain.length ? auth.effectiveChain.join(" → ") : "-") + "</code>"),
          renderHealthItem("阶段分配", "<span>理解 " + escapeHtml(authStages.understanding || "-") + " / 规划 " + escapeHtml(authStages.planner || "-") + " / 回复 " + escapeHtml(authStages.response || "-") + "</span>"),
          renderHealthItem("配置版本", "<code>" + escapeHtml(auth.configVersion || "-") + "</code>"),
          renderHealthItem("最近真实外部调用", lastExternal && lastExternal.provider ? "<span class='badge success'>" + escapeHtml(lastExternal.provider) + "</span> <span>" + escapeHtml(lastExternal.at || "") + "</span>" : "<span class='badge muted'>本进程暂无真实调用</span>"),
          renderHealthItem("Provider Chain", renderProviderChain(chain)),
          renderHealthItem("最近成功", "<span>" + escapeHtml(lastSuccess) + "</span>"),
          renderHealthItem("最近失败", "<span>" + escapeHtml(lastFailure) + "</span>"),
          renderHealthItem("P50 / P95", "<span>" + escapeHtml(String(p50)) + "ms / " + escapeHtml(String(p95)) + "ms</span>"),
          renderHealthItem("fallback 次数", "<strong>" + escapeHtml(String(metrics.fallbackCount || 0)) + "</strong>"),
          renderHealthItem("工具调用量", "<span>" + escapeHtml(naMetric(metrics.toolCallCount)) + "</span>"),
          renderHealthItem("事实类 / 说明类", "<span>" + (metrics.factualQuestionCount === null || metrics.factualQuestionCount === undefined ? "暂无统计" : escapeHtml(String(metrics.factualQuestionCount)) + " / " + escapeHtml(String(metrics.generativeQuestionCount || 0))) + "</span>"),
          renderHealthItem("安全拦截", "<span>" + escapeHtml(naMetric(metrics.safetyInterceptCount)) + "</span>"),
          renderHealthItem("知识库", "<span>" + escapeHtml(String(knowledge.documentCount || 0)) + " docs / " + escapeHtml(String(knowledge.chunkCount || 0)) + " chunks</span>"),
          renderHealthItem("校园地图", "<span>" + escapeHtml(String(map.placeCount || 0)) + " places</span>"),
          renderHealthItem("体验版生图", image.enabled ? "<span class='badge warning'>enabled</span>" : "<span class='badge muted'>disabled</span>"),
          renderHealthItem("混元权益", "<span class='badge muted'>见 Provider 状态</span>"),
          renderHealthItem("体验授权", status.runtimeMode === "competition" ? "<span class='badge warning'>需服务端会话授权</span>" : "<span class='badge success'>public fail-closed</span>")
        ].join("");
      }

      function runAiGoldenEvaluation() {
        var box = $("aiAgentEvalResult");
        if (box) box.textContent = "正在运行 Agent 黄金测试...";
        api("/api/admin/ai-agent/evaluate", { method: "POST", body: "{}" })
          .then(function(res) {
            var report = res.data || {};
            state.aiAgentEvalReport = report;
            var metrics = report.metrics || {};
            var lines = [
              "总通过率: " + Math.round(Number(metrics.passRate || 0) * 100) + "%",
              "工具调用正确率: " + Math.round(Number(metrics.toolCallAccuracy || 0) * 100) + "%",
              "事实一致率: " + Math.round(Number(metrics.factConsistencyRate || 0) * 100) + "%",
              "课程事实幻觉率: " + Math.round(Number(metrics.courseHallucinationRate || 0) * 100) + "%",
              "平均延迟: " + Math.round(Number(metrics.averageLatencyMs || 0)) + "ms",
              "P95 延迟: " + Math.round(Number(metrics.p95LatencyMs || 0)) + "ms",
              "fallback 率: " + Math.round(Number(metrics.fallbackRate || 0) * 100) + "%",
              "安全拦截率: " + Math.round(Number(metrics.safetyInterceptRate || 0) * 100) + "%"
            ];
            if (Array.isArray(report.results)) {
              lines.push("");
              lines.push("失败项:");
              report.results.filter(function(item) { return !item.pass; }).slice(0, 10).forEach(function(item) {
                lines.push("- " + (item.id || "-") + ": " + (Array.isArray(item.reasons) ? item.reasons.join(", ") : "failed"));
              });
            }
            if (box) box.textContent = lines.join("\\n");
            showToast("Agent 黄金测试完成。", "success");
            ignoreLoadError(loadAiAgentStatus());
          })
          .catch(function(error) {
            if (box) box.textContent = "Agent 黄金测试失败：" + error.message;
            showToast(error.message, "error");
          });
      }

      function exportAiEvaluationReport() {
        var report = state.aiAgentEvalReport;
        if (!report) {
          showToast("请先运行 Agent 黄金测试", "warning");
          return;
        }
        var blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "fosu-agent-evaluation-report.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("脱敏评测报告已导出", "success");
      }

      function clearAiLocalMetrics() {
        ["FOSU_AI_GENERATIVE_METRICS", "fosu-admin-ai-metrics"].forEach(function(key) {
          try {
            localStorage.removeItem(key);
          } catch (error) {
            // best effort
          }
        });
        showToast("本地匿名指标已清除", "success");
      }

      var AI_ENV_LABELS = {
        public: "正式版",
        trial: "体验版",
        dev: "开发版"
      };
      var AI_PROVIDER_LABELS = {
        mock: "mock 本地规则",
        "cloudbase-openai": "混元 cloudbase-openai",
        deepseek: "deepseek",
        coze: "coze",
        "custom-openai": "自定义 OpenAI 兼容",
        "custom-anthropic": "自定义 Anthropic 兼容"
      };

      function findAiEnvironment(env) {
        var cfg = state.aiProviderConfig || {};
        var list = Array.isArray(cfg.environments) ? cfg.environments : [];
        return list.find(function(item) { return item.environment === env; }) || list[0] || null;
      }

      function activeAiProfile() {
        var env = findAiEnvironment(state.aiProviderEnvironment || "public");
        return env && env.profile || {};
      }

      function aiConfigInput(id, label, valueText, placeholder, type) {
        return "<div><label>" + label + "</label><input id='" + id + "' type='" + (type || "text") + "' autocomplete='off' value='" + escapeHtml(valueText || "") + "' placeholder='" + escapeHtml(placeholder || "") + "'></div>";
      }

      function renderProviderConfigFields(providerName, profile) {
        if (providerName === "mock") {
          var kb = state.aiProviderConfig && state.aiProviderConfig.knowledgeIndex || {};
          return "<div class='ai-provider-status'>" +
            renderHealthItem("本地规则", "<span class='badge success'>可用</span>") +
            renderHealthItem("知识库版本", "<code>" + escapeHtml(kb.version || kb.currentVersion || "-") + "</code>") +
            renderHealthItem("规则数量", "<strong>" + escapeHtml(String(kb.ruleCount || 0)) + "</strong>") +
            renderHealthItem("chunk 数量", "<strong>" + escapeHtml(String(kb.chunkCount || 0)) + "</strong>") +
          "</div>";
        }
        if (providerName === "custom-openai" || providerName === "custom-anthropic") {
          var selectedEntry = apcSelectedEntry();
          if (!selectedEntry) {
            return "<div class='ai-secret-note'>该协议暂无可用自定义条目，请先在下方「自定义 Provider」中添加并配齐 Base URL、密钥与模型。</div>";
          }
          return "<div class='provider-switch-row' style='flex-direction:column;align-items:flex-start;gap:6px;'>" +
            "<div><strong>" + escapeHtml(selectedEntry.label) + "</strong> <span class='apc-proto-badge'>" + escapeHtml(selectedEntry.protocol) + "</span> " + (selectedEntry.usable ? "<span class='badge success'>可用</span>" : "<span class='badge warning'>待完善</span>") + "</div>" +
            "<div class='ai-secret-note'>" + escapeHtml(selectedEntry.baseUrl) + " · 模型 <code>" + escapeHtml(selectedEntry.model || "-") + "</code> · 密钥 " + (selectedEntry.apiKeyConfigured ? "****" + escapeHtml(selectedEntry.apiKeyLast4 || "") : "未配置") + "</div>" +
            "<div class='ai-secret-note'>在下方「自定义 Provider」中可编辑条目、拉取模型列表或切换其他条目。阶段模型（上方理解/规划模型）留空时使用该条目模型。</div>" +
          "</div>";
        }
        if (providerName === "cloudbase-openai") {
          return "<div class='form-row'>" +
            aiConfigInput("cloudbaseOpenaiBaseUrl", "Base URL", profile.cloudbaseOpenaiBaseUrl, "https://.../v1/ai/cloudbase") +
            aiConfigInput("cloudbaseOpenaiTextModel", "模型名", profile.cloudbaseOpenaiTextModel, "hy3-preview") +
          "</div><div class='form-row'>" +
            aiConfigInput("cloudbaseOpenaiTimeoutMs", "timeout / ms", profile.cloudbaseOpenaiTimeoutMs, "15000") +
            aiConfigInput("cloudbaseOpenaiMaxTokens", "max tokens", profile.cloudbaseOpenaiMaxTokens, "1200") +
          "</div><div class='form-row full'>" +
            aiConfigInput("cloudbaseOpenaiApiKey", "API Key", "", "留空表示保留原密钥", "password") +
          "</div>";
        }
        if (providerName === "coze") {
          return "<div class='form-row'><div><label>接入方式</label><select id='cozeApiMode'><option value='workload'>扣子编程 · 已部署项目 API</option><option value='bot'>标准 Coze Bot API</option></select></div>" +
            aiConfigInput("cozeApiKey", "API Token", "", "留空表示使用已保存 Token", "password") +
          "</div><div id='cozeWorkloadFields'>" +
            "<div class='form-row'>" + aiConfigInput("cozeWorkloadEndpoint", "stream_run 部署入口", profile.cozeWorkloadEndpoint || "", "https://xxxx.coze.site/stream_run") + aiConfigInput("cozeProjectId", "项目 ID", profile.cozeProjectId || "", "部署页调用示例中的 project_id") + "</div>" +
            "<div class='ai-secret-note'>适用于扣子编程部署页生成的项目 API：Bearer Token + stream_run + project_id。Token 只在服务端加密保存，可随时在这里留新值进行轮换。</div>" +
          "</div><div id='cozeBotFields'>" +
            "<div class='form-row'>" + aiConfigInput("cozeBotId", "已发布 Bot ID", profile.cozeBotId || "", "从 Bot 构建页 URL 获取") + aiConfigInput("cozeBaseUrl", "标准 API Base URL", profile.cozeBaseUrl || "https://api.coze.cn", "https://api.coze.cn") + "</div>" +
            "<div class='ai-secret-note'>标准 Bot API 的匿名 user_id 由服务端按 Principal 自动生成。官方 Bot 列表接口还需要 Workspace/Space ID，本项目不伪造只凭 PAT 的选择器。</div>" +
          "</div>" +
          "<div class='provider-actions-row' style='margin-top:12px;'><button id='cozeTestConnectionBtn' class='secondary' type='button'>测试 Coze 连接</button></div>" +
          "<div id='cozeConnectionResult' class='ai-verify-box'>尚未测试。会区分 Token、项目/Bot、部署状态、权限、限流与超时。</div>";
        }
        return "<div class='form-row'>" +
          aiConfigInput("aiBaseUrl", "Base URL", profile.baseUrl, "https://api.deepseek.com") +
          aiConfigInput("aiModel", "快速模型", profile.model, "deepseek-v4-flash") +
        "</div><div class='form-row'>" +
          aiConfigInput("aiReasoningModel", "推理模型", profile.reasoningModel, "deepseek-v4-pro") +
          aiConfigInput("aiTemperature", "temperature", profile.temperature, "0.1") +
        "</div><div class='form-row'>" +
          aiConfigInput("aiMaxTokens", "max tokens", profile.maxTokens, "1200") +
          aiConfigInput("aiApiKey", "API Key", "", "留空表示保留原密钥", "password") +
        "</div><div class='form-row'>" +
          "<div><label>json repair</label><select id='aiJsonRepair'><option value='true'>开启</option><option value='false'>关闭</option></select></div>" +
          "<div><label>Thinking</label><select id='aiThinkingEnabled'><option value='false'>关闭</option><option value='true'>开启</option></select></div>" +
          "</div>";
      }

      function syncCozeModeFields() {
        var mode = value("cozeApiMode") === "bot" ? "bot" : "workload";
        var workload = $("cozeWorkloadFields");
        var bot = $("cozeBotFields");
        if (workload) workload.style.display = mode === "workload" ? "block" : "none";
        if (bot) bot.style.display = mode === "bot" ? "block" : "none";
      }

      function loadAiProviderConfig() {
        var env = state.aiProviderEnvironment || "";
        return api("/api/admin/ai-provider/config" + (env ? "?environment=" + encodeURIComponent(env) : ""))
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            if (!state.aiProviderEnvironment) state.aiProviderEnvironment = state.aiProviderConfig.activeEnvironment || "public";
            var envStatus = findAiEnvironment(state.aiProviderEnvironment);
            state.aiProviderSelectedProvider = state.aiProviderSelectedProvider || (envStatus && envStatus.provider) || "mock";
            renderAiProviderConfig();
            ignoreLoadError(loadAiAgentStatus());
            ignoreLoadError(loadAiReadinessMatrix());
            return state.aiProviderConfig;
          })
          .catch(function(error) {
            showModuleError("ai-provider", error);
            throw error;
          });
      }

      function aiProviderActualUseLabel() {
        var last = state.aiAgentStatus && state.aiAgentStatus.lastExternalCall || null;
        var experience = last && last.provider
          ? (AI_PROVIDER_LABELS[last.provider] || last.provider) + "（最近真实调用 " + (last.at || "-") + "）"
          : "本进程暂无真实调用";
        return "公开发布=正式版本地规则；体验/开发=" + experience;
      }

      function aiExperienceEnvironment() {
        var cfg = state.aiProviderConfig || {};
        if (state.aiProviderEnvironment === "dev" || state.aiProviderEnvironment === "trial") return state.aiProviderEnvironment;
        return cfg.activeEnvironment === "dev" ? "dev" : "trial";
      }

      function isExperienceProvider(name) {
        return ["cloudbase-openai", "deepseek", "coze", "custom-openai", "custom-anthropic"].indexOf(String(name || "").toLowerCase()) >= 0;
      }

      function aiModeMetric(label, valueText, foot) {
        return "<div class='provider-metric'><span>" + escapeHtml(label) + "</span><strong>" + valueText + "</strong>" + (foot ? "<small>" + escapeHtml(foot) + "</small>" : "") + "</div>";
      }

      var AI_STAGE_PROVIDER_OPTIONS = [
        ["", "跟随主 Provider"],
        ["coze", "coze"],
        ["deepseek", "deepseek"],
        ["cloudbase-openai", "混元 cloudbase-openai"],
        ["custom-openai", "自定义 OpenAI 兼容"],
        ["custom-anthropic", "自定义 Anthropic 兼容"],
        ["mock", "mock 本地规则（强制本阶段 deterministic）"]
      ];

      function renderStageAssignSelect(id, label, current) {
        var value = String(current || "");
        return "<div><label>" + escapeHtml(label) + "</label><select id='" + id + "'>" +
          AI_STAGE_PROVIDER_OPTIONS.map(function(pair) {
            return "<option value='" + pair[0] + "'" + (value === pair[0] ? " selected" : "") + ">" + escapeHtml(pair[1]) + "</option>";
          }).join("") + "</select></div>";
      }

      function renderAiReadinessMatrix() {
        var box = $("aiReadinessMatrixBox");
        if (!box) return;
        var matrix = state.aiReadinessMatrix || {};
        var envs = matrix.environments || {};
        var envName = aiExperienceEnvironment();
        var snapshot = envs[envName] || envs.trial || {};
        var items = Array.isArray(snapshot.chainStatus) ? snapshot.chainStatus : [];
        if (!items.length) {
          box.innerHTML = "<span class='badge muted'>当前环境暂无链路数据</span>";
          return;
        }
        var rows = items.map(function(item) {
          var circuit = item.circuitBreaker && item.circuitBreaker.state || "closed";
          var availBadge = item.configuredAvailable ? "<span class='badge success'>是</span>" : "<span class='badge muted'>否</span>";
          var verifiedBadge = item.verified ? "<span class='badge success'>已验证</span>" : "<span class='badge muted'>已配置未验证</span>";
          return "<tr>" +
            "<td><code>" + escapeHtml(item.name || "-") + "</code></td>" +
            "<td>" + availBadge + "</td>" +
            "<td>" + verifiedBadge + "</td>" +
            "<td>" + escapeHtml(circuit) + "</td>" +
            "<td>" + Number(item.p50LatencyMs || 0) + "ms</td>" +
            "<td>" + Number(item.p95LatencyMs || 0) + "ms</td>" +
            "<td>" + escapeHtml(item.lastSuccessAt || "-") + "</td>" +
            "<td>" + escapeHtml(item.lastFailureAt ? (item.fallbackReason || "failed") : "-") + "</td>" +
            "<td><button type='button' class='ghost' data-probe-provider='" + escapeHtml(item.name || "") + "'>立即探测</button></td>" +
          "</tr>";
        }).join("");
        box.innerHTML = "<table style='width:100%;border-collapse:collapse;font-size:12px;'><thead><tr>" +
          ["Provider", "配置可用", "已验证", "熔断", "P50", "P95", "最近成功", "最近失败分类", "操作"].map(function(head) {
            return "<th style='text-align:left;padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.3);'>" + head + "</th>";
          }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
        box.querySelectorAll("[data-probe-provider]").forEach(function(btn) {
          btn.addEventListener("click", function() { probeAiProvider(btn.dataset.probeProvider); });
        });
      }

      function loadAiReadinessMatrix() {
        return api("/api/admin/ai-provider/readiness-matrix")
          .then(function(res) {
            state.aiReadinessMatrix = res.data || {};
            renderAiReadinessMatrix();
            return state.aiReadinessMatrix;
          })
          .catch(function(error) {
            var box = $("aiReadinessMatrixBox");
            if (box) box.innerHTML = "<span class='badge danger'>" + escapeHtml(error.message || "加载失败") + "</span>";
          });
      }

      var aiCallLogTimer = null;

      function renderAiCallLog() {
        var box = $("aiCallLogBox");
        if (!box) return;
        var events = Array.isArray(state.aiCallLogEvents) ? state.aiCallLogEvents : [];
        if (!events.length) {
          box.innerHTML = "<span class='badge muted'>暂无调用记录（发起一次真实问答或探测后可见）</span>";
          return;
        }
        var kindLabel = { structured: "结构化", generate: "生成", probe: "探测" };
        var stageLabel = { understanding: "理解", planner: "规划", response: "回复", health: "健康检查" };
        var rows = events.map(function(item) {
          var at = String(item.at || "").replace("T", " ").slice(5, 19);
          var result = item.ok ? "<span class='badge success'>成功</span>" : "<span class='badge danger'>失败</span>";
          var kind = kindLabel[item.kind] || item.kind || "-";
          var stage = stageLabel[item.stage] || item.stage || "-";
          return "<tr>" +
            "<td style='white-space:nowrap;'>" + escapeHtml(at) + "</td>" +
            "<td><code>" + escapeHtml(item.provider || "-") + "</code></td>" +
            "<td>" + escapeHtml(kind) + "</td>" +
            "<td>" + escapeHtml(stage) + "</td>" +
            "<td>" + result + "</td>" +
            "<td>" + Number(item.latencyMs || 0) + "ms</td>" +
            "<td>" + escapeHtml(item.ok ? "-" : (item.reason || "failed")) + "</td>" +
          "</tr>";
        }).join("");
        box.innerHTML = "<table style='width:100%;border-collapse:collapse;font-size:12px;'><thead><tr>" +
          ["时间", "Provider", "类型", "阶段", "结果", "延迟", "失败分类"].map(function(head) {
            return "<th style='text-align:left;padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.3);'>" + head + "</th>";
          }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
      }

      function loadAiCallLog() {
        return api("/api/admin/ai-provider/call-log?limit=60")
          .then(function(res) {
            var data = res.data || {};
            state.aiCallLogEvents = Array.isArray(data.events) ? data.events : [];
            renderAiCallLog();
            return state.aiCallLogEvents;
          })
          .catch(function(error) {
            var box = $("aiCallLogBox");
            if (box) box.innerHTML = "<span class='badge danger'>" + escapeHtml(error.message || "加载失败") + "</span>";
          });
      }

      function setAiCallLogAutoRefresh(enabled) {
        if (aiCallLogTimer) {
          clearInterval(aiCallLogTimer);
          aiCallLogTimer = null;
        }
        if (enabled) {
          aiCallLogTimer = setInterval(function() {
            if ($("aiCallLogBox")) ignoreLoadError(loadAiCallLog());
          }, 10000);
        }
      }

      function probeAiProvider(name) {
        if (!name) return;
        var box = $("aiReadinessMatrixBox");
        api("/api/admin/ai-provider/probe", { method: "POST", body: JSON.stringify({ provider: name, environment: aiExperienceEnvironment() }) })
          .then(function(res) {
            var data = res.data || {};
            showToast("探测 " + name + "：" + (data.health === "ok" ? "成功" : "失败") + "（" + (data.reasonCode || "ok") + "，" + Number(data.latencyMs || 0) + "ms）", data.health === "ok" ? "success" : "warning");
            ignoreLoadError(loadAiReadinessMatrix());
            ignoreLoadError(loadAiAgentStatus());
          })
          .catch(function(error) {
            if (box) renderAiReadinessMatrix();
            showToast(error.message, "error");
          });
      }

      function apcCustomEntries() {
        var cfg = state.aiProviderConfig || {};
        return Array.isArray(cfg.customProviders) ? cfg.customProviders : [];
      }

      function apcProtocolOfProvider(name) {
        if (name === "custom-openai") return "openai";
        if (name === "custom-anthropic") return "anthropic";
        return "";
      }

      function apcFindEntry(id) {
        return apcCustomEntries().find(function(item) { return item.id === id; }) || null;
      }

      function apcSelectedEntry() {
        var protocol = apcProtocolOfProvider(state.aiProviderSelectedProvider);
        if (!protocol) return null;
        var list = apcCustomEntries();
        var byId = apcFindEntry(state.aiProviderSelectedCustomId);
        if (byId && byId.protocol === protocol) return byId;
        return list.find(function(item) { return item.protocol === protocol && item.usable; }) || list.find(function(item) { return item.protocol === protocol; }) || null;
      }

      // Provider 选择器：内置 + 自定义条目卡片网格（点击即选，保存生效）。
      function renderExperienceProviderPicker(selectedProvider) {
        var envStatus = findAiEnvironment(aiExperienceEnvironment()) || {};
        var providers = Array.isArray(envStatus.providers) ? envStatus.providers : [];
        var statusByName = {};
        providers.forEach(function(item) { statusByName[item.name] = item; });
        var builtin = ["coze", "deepseek", "cloudbase-openai"].map(function(name) {
          var st = statusByName[name] || {};
          var configured = st.configured || st.keyConfigured;
          var active = selectedProvider === name ? " active" : "";
          return "<div class='apc-pick-card" + active + "' data-apc-pick='" + escapeHtml(name) + "' role='button' tabindex='0'>" +
            "<div class='apc-pick-title'><span class='apc-dot " + (configured ? "ok" : "off") + "'></span>" + escapeHtml(AI_PROVIDER_LABELS[name] || name) + "</div>" +
            "<div class='apc-pick-sub'>" + escapeHtml(name) + (configured ? " · 已配置" : " · 未配置") + "</div>" +
          "</div>";
        }).join("");
        var custom = apcCustomEntries().map(function(entry) {
          var canonical = entry.protocol === "anthropic" ? "custom-anthropic" : "custom-openai";
          var active = selectedProvider === canonical && state.aiProviderSelectedCustomId === entry.id ? " active" : "";
          return "<div class='apc-pick-card" + active + "' data-apc-pick='" + canonical + "' data-apc-custom-id='" + escapeHtml(entry.id) + "' role='button' tabindex='0'>" +
            "<div class='apc-pick-title'><span class='apc-dot " + (entry.usable ? "ok" : "off") + "'></span>" + escapeHtml(entry.label) + "<span class='apc-proto-badge'>" + escapeHtml(entry.protocol) + "</span></div>" +
            "<div class='apc-pick-sub'>" + escapeHtml(entry.model || "未设模型") + (entry.usable ? "" : " · 待完善") + "</div>" +
          "</div>";
        }).join("");
        return builtin + custom ||
          "<div class='ai-secret-note'>暂无可用 Provider。</div>";
      }

      function renderCustomProviderManager() {
        var list = apcCustomEntries();
        var rows = list.map(function(entry) {
          var canonical = entry.protocol === "anthropic" ? "custom-anthropic" : "custom-openai";
          var statusBadge = entry.usable
            ? "<span class='badge success'>可用</span>"
            : "<span class='badge warning'>待完善</span>";
          var activeMark = state.aiProviderSelectedCustomId === entry.id ? " <span class='badge muted'>当前选中</span>" : "";
          return "<tr>" +
            "<td><strong>" + escapeHtml(entry.label) + "</strong>" + activeMark + "</td>" +
            "<td><span class='apc-proto-badge'>" + escapeHtml(entry.protocol) + "</span></td>" +
            "<td style='word-break:break-all;max-width:220px;'>" + escapeHtml(entry.baseUrl) + "</td>" +
            "<td><code>" + escapeHtml(entry.model || "-") + "</code></td>" +
            "<td>" + (entry.apiKeyConfigured ? "****" + escapeHtml(entry.apiKeyLast4 || "") : "<span class='badge danger'>未配置</span>") + "</td>" +
            "<td>" + statusBadge + "</td>" +
            "<td style='white-space:nowrap;'>" +
              "<button type='button' class='ghost apc-row-btn' data-cp-primary='" + escapeHtml(entry.id) + "' data-cp-canonical='" + canonical + "'>设为主 Provider</button>" +
              "<button type='button' class='ghost apc-row-btn' data-cp-edit='" + escapeHtml(entry.id) + "'>编辑</button>" +
              "<button type='button' class='ghost apc-row-btn apc-danger' data-cp-delete='" + escapeHtml(entry.id) + "'>删除</button>" +
            "</td>" +
          "</tr>";
        }).join("");
        var table = list.length
          ? "<table class='apc-cp-table'><thead><tr>" +
            ["名称", "协议", "Base URL", "模型", "密钥", "状态", "操作"].map(function(head) { return "<th>" + head + "</th>"; }).join("") +
            "</tr></thead><tbody>" + rows + "</tbody></table>"
          : "<div class='ai-secret-note' style='padding:4px 0;'>尚未添加自定义 Provider。支持任何 OpenAI / Anthropic 协议兼容端点（如 OpenRouter、OneAPI、NewAPI、自建网关、Anthropic 官方等）。</div>";
        var form = state.cpFormOpen
          ? "<div class='apc-cp-form'>" +
            "<div class='form-row'>" +
              aiConfigInput("cpLabel", "名称", state.cpFormLabel || "", "例如：OpenRouter 主力") +
              "<div><label>协议</label><select id='cpProtocol'><option value='openai'>OpenAI 兼容（/chat/completions）</option><option value='anthropic'>Anthropic 兼容（/messages）</option></select></div>" +
            "</div>" +
            "<div class='form-row full'>" + aiConfigInput("cpBaseUrl", "Base URL", state.cpFormBaseUrl || "", "https://api.example.com/v1（Anthropic 会自动补 /v1）") + "</div>" +
            "<div class='form-row full'>" + aiConfigInput("cpApiKey", "API Key", "", state.cpEditingId ? "留空表示保留原密钥" : "必填，仅加密存储", "password") + "</div>" +
            "<div class='form-row'>" +
              "<div><label>模型</label><input id='cpModel' list='cpModelOptions' autocomplete='off' value='" + escapeHtml(state.cpFormModel || "") + "' placeholder='点「获取模型」自动拉取，或手动填写'><datalist id='cpModelOptions'></datalist></div>" +
              "<div class='apc-fetch-cell'><label>&nbsp;</label><button id='cpFetchModelsBtn' type='button' class='secondary'>获取模型</button></div>" +
            "</div>" +
            "<div id='cpFetchResult' class='ai-secret-note'></div>" +
            "<div class='form-row'>" +
              "<label class='provider-checkbox-row' style='flex:1;'><input id='cpStrictJson' type='checkbox' checked><span>严格 JSON 模式（端点支持 response_format 时开启）</span></label>" +
              "<label class='provider-checkbox-row' style='flex:1;'><input id='cpEnabled' type='checkbox' checked><span>启用该条目</span></label>" +
            "</div>" +
            "<div class='provider-actions-row'><button id='cpSaveBtn' class='primary'>" + (state.cpEditingId ? "保存修改" : "添加 Provider") + "</button><button id='cpCancelBtn' class='ghost'>取消</button></div>" +
          "</div>"
          : "";
        return "<section class='provider-mode-card' style='margin-top:16px;'>" +
          "<div class='provider-card-head'><div><div class='provider-card-title'>自定义 Provider（OpenAI / Anthropic 协议）</div><div class='ai-secret-note'>CCSwitch 式管理：添加多个第三方端点，一键把任意条目设为当前环境主 Provider。密钥只加密存储，永不回显。</div></div><button id='cpFormToggleBtn' class='secondary'>" + (state.cpFormOpen ? "收起" : "＋ 添加 Provider") + "</button></div>" +
          "<div style='padding:0 12px 12px;display:flex;flex-direction:column;gap:12px;'>" + table + form + "</div>" +
        "</section>";
      }

      function openCustomProviderForm(editId) {
        var entry = editId ? apcFindEntry(editId) : null;
        state.cpFormOpen = true;
        state.cpEditingId = entry ? entry.id : "";
        state.cpFormLabel = entry ? entry.label : "";
        state.cpFormBaseUrl = entry ? entry.baseUrl : "";
        state.cpFormModel = entry ? entry.model : "";
        state.cpFormProtocol = entry ? entry.protocol : "openai";
        state.cpFormEnabled = entry ? entry.enabled !== false : true;
        state.cpFormStrictJson = entry ? entry.strictJsonMode !== false : true;
        renderAiProviderConfig();
      }

      function submitCustomProviderForm() {
        var payload = {
          entry: {
            id: state.cpEditingId || undefined,
            label: value("cpLabel"),
            protocol: value("cpProtocol") || "openai",
            baseUrl: value("cpBaseUrl"),
            apiKey: value("cpApiKey"),
            model: value("cpModel"),
            enabled: document.getElementById("cpEnabled") ? document.getElementById("cpEnabled").checked : true,
            strictJsonMode: document.getElementById("cpStrictJson") ? document.getElementById("cpStrictJson").checked : true
          }
        };
        if (!payload.entry.baseUrl || !/^https:\\/\\//i.test(payload.entry.baseUrl)) {
          showToast("Base URL 必须是 https 地址。", "warning");
          return;
        }
        if (!state.cpEditingId && !payload.entry.apiKey) {
          showToast("新条目必须填写 API Key。", "warning");
          return;
        }
        api("/api/admin/ai-provider/custom-provider/save", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            state.cpFormOpen = false;
            state.cpEditingId = "";
            renderAiProviderConfig();
            ignoreLoadError(loadAiReadinessMatrix());
            showToast("自定义 Provider 已保存并即时生效。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function deleteCustomProviderEntry(id) {
        var entry = apcFindEntry(id);
        if (!window.confirm("确认删除自定义 Provider「" + (entry ? entry.label : id) + "」？\\n该操作会立即生效。")) return;
        api("/api/admin/ai-provider/custom-provider/delete", { method: "POST", body: JSON.stringify({ id: id }) })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            if (state.aiProviderSelectedCustomId === id) state.aiProviderSelectedCustomId = "";
            renderAiProviderConfig();
            ignoreLoadError(loadAiReadinessMatrix());
            showToast("已删除。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function fetchCustomProviderModels() {
        var box = $("cpFetchResult");
        var payload = {
          protocol: value("cpProtocol") || "openai",
          baseUrl: value("cpBaseUrl"),
          apiKey: value("cpApiKey"),
          id: state.cpEditingId || undefined
        };
        if (box) box.textContent = "正在拉取模型列表…";
        api("/api/admin/ai-provider/fetch-models", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            var data = res.data || {};
            var models = Array.isArray(data.models) ? data.models : [];
            var datalist = $("cpModelOptions");
            if (datalist) {
              datalist.innerHTML = models.map(function(model) { return "<option value='" + escapeHtml(model) + "'></option>"; }).join("");
            }
            if (box) box.textContent = models.length
              ? "拉取成功（" + Number(data.latencyMs || 0) + "ms）：共 " + models.length + " 个模型，点击模型输入框下拉选择。"
              : "端点未返回模型列表，请手动填写模型名。";
            if (models.length) showToast("已获取 " + models.length +  " 个模型。", "success");
          })
          .catch(function(error) {
            if (box) box.textContent = "获取失败：" + error.message;
            showToast(error.message, "error");
          });
      }

      function setPrimaryCustomProvider(id, canonical) {
        var environment = aiExperienceEnvironment();
        var entry = apcFindEntry(id);
        if (!entry || !entry.usable) {
          showToast("该条目还未配齐（需要 baseUrl + 密钥 + 模型），请先编辑完善。", "warning");
          return;
        }
        api("/api/admin/ai-provider/config", {
          method: "POST",
          body: JSON.stringify({
            environment: environment,
            activeEnvironment: environment,
            enabled: true,
            provider: canonical,
            activeCustomId: id,
            providerPolicy: "auto",
            runtimeMode: "competition"
          })
        })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            state.aiProviderSelectedProvider = canonical;
            state.aiProviderSelectedCustomId = id;
            state.aiProviderDraftExperienceEnabled = false;
            renderAiProviderConfig();
            ignoreLoadError(loadAiReadinessMatrix());
            ignoreLoadError(loadAiAgentStatus());
            showToast("已切换主 Provider：" + (entry ? entry.label : id) + "（" + environment + "，立即生效）。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function renderAiProviderConfig() {
        var cfg = state.aiProviderConfig || {};
        var publicEnv = findAiEnvironment("public") || {};
        var publicProfile = publicEnv.profile || {};
        var experienceEnvName = aiExperienceEnvironment();
        var experienceEnv = findAiEnvironment(experienceEnvName) || findAiEnvironment("trial") || {};
        var experienceProfile = experienceEnv.profile || {};
        var kb = cfg.knowledgeIndex || {};
        var toolCount = cfg.toolCount || cfg.enabledToolCount || cfg.protocolToolCount || 0;
        var selectedProvider = state.aiProviderSelectedProvider;
        if (!isExperienceProvider(selectedProvider)) selectedProvider = experienceProfile.provider;
        if (!isExperienceProvider(selectedProvider)) selectedProvider = "coze";
        state.aiProviderSelectedProvider = selectedProvider;
        state.aiProviderEnvironment = experienceEnvName;
        if (!state.aiProviderSelectedCustomId) state.aiProviderSelectedCustomId = experienceProfile.activeCustomId || cfg.activeCustomId || "";
        var formalActive = publicEnv.safePublic === true || ((publicProfile.provider || "mock") === "mock" && publicProfile.enabled === false);
        var experienceEnabled = state.aiProviderDraftExperienceEnabled === true || (experienceProfile.enabled !== false && isExperienceProvider(experienceProfile.provider));
        var selectedLabel = AI_PROVIDER_LABELS[selectedProvider] || selectedProvider;
        var selectedEntry = apcSelectedEntry();
        if (selectedEntry) selectedLabel = selectedEntry.label + "（" + selectedEntry.protocol + "）";
        var experienceLaneLabel = experienceEnabled ? selectedLabel : "增强未启用";
        var section = $("section-ai-provider");
        if (!section) return;
        section.innerHTML = "<div class='provider-console'>" +
          "<div class='provider-hero provider-status-hero'><div><h3>小佛助手 Provider 控制台</h3><p>公开发布 = <strong>正式版本地规则</strong>；体验/开发 = <strong>" + escapeHtml(experienceLaneLabel) + "</strong></p></div><button id='reloadAiProviderBtn' class='ghost'>刷新状态</button></div>" +
          "<div class='provider-mode-grid'>" +
            "<section class='provider-mode-card'>" +
              "<div class='provider-card-head'><div><div class='provider-card-title'>正式版 / 公开发布</div><div class='ai-secret-note'>公开用户默认入口：本地规则 + 已发布知识库 + 已有工具卡片</div></div><span class='badge " + (formalActive ? "success" : "muted") + "'>" + (formalActive ? "当前启用" : "未启用") + "</span></div>" +
              "<div class='provider-metrics'>" +
                aiModeMetric("实际运行", "<code>mock</code>", "tool-only") +
                aiModeMetric("本地规则", escapeHtml(String(kb.ruleCount || 0)), "已发布规则") +
                aiModeMetric("工具数量", escapeHtml(String(toolCount || 0)), "课表/空教室/天气/地图") +
                aiModeMetric("知识库版本", "<code>" + escapeHtml(kb.version || kb.currentVersion || "-") + "</code>", "chunks " + String(kb.chunkCount || 0)) +
                aiModeMetric("最后发布", escapeHtml(kb.publishedAt || "-"), "") +
              "</div>" +
              "<div class='provider-actions-row'><button id='aiPresetPublicSafeBtn' class='primary'>启用正式版本地规则</button></div>" +
            "</section>" +
            "<section class='provider-mode-card'>" +
              "<div class='provider-card-head'><div><div class='provider-card-title'>体验版 / 开发调试</div><div class='ai-secret-note'>只用于增强理解、槽位补全和表达组织；事实任务仍走工具链</div></div><span class='badge " + (experienceEnabled ? "warning" : "muted") + "'>" + (experienceEnabled ? "增强已启用" : "增强未启用") + "</span></div>" +
              "<div class='env-tabs provider-experience-tabs'><button type='button' class='" + (experienceEnvName === "trial" ? "active" : "") + "' data-ai-experience-env='trial'>体验版</button><button type='button' class='" + (experienceEnvName === "dev" ? "active" : "") + "' data-ai-experience-env='dev'>开发版</button></div>" +
              "<label class='provider-switch-row'><span>启用增强理解能力</span><select id='aiExperienceEnabled'><option value='false'>关闭</option><option value='true'>开启</option></select></label>" +
              "<input id='aiProvider' type='hidden' value='" + escapeHtml(selectedProvider) + "'><input id='aiEnabled' type='hidden' value='" + (experienceEnabled ? "true" : "false") + "'><input id='aiProviderPolicy' type='hidden' value='auto'><input id='aiRuntimeMode' type='hidden' value='" + (experienceEnabled ? "competition" : "public") + "'>" +
              (experienceEnabled ? "<div class='apc-section-label'>主 Provider（第一跳）</div><div class='apc-pick-grid'>" + renderExperienceProviderPicker(selectedProvider) + "</div>" +
                "<div class='form-row'>" + renderStageAssignSelect("aiUnderstandingProvider", "理解阶段 Provider（意图识别）", experienceProfile.understandingProvider) + renderStageAssignSelect("aiPlannerProvider", "规划阶段 Provider（Planner）", experienceProfile.plannerProvider) + renderStageAssignSelect("aiResponseProvider", "回复阶段 Provider（Response）", experienceProfile.responseProvider) + "</div>" +
                "<div class='ai-secret-note'>阶段默认「跟随主 Provider」：后台选哪个主 Provider，该阶段第一跳就用哪个；这里可单独覆盖某个阶段（含强制本地规则）。保存后主链会重算为 [主 Provider, ...其余 fallback]。</div>" +
                "<div class='form-row'>" + aiConfigInput("aiUnderstandingModel", "理解模型（AI_UNDERSTANDING_MODEL）", experienceProfile.understandingModel, "留空 = 跟随主模型") + aiConfigInput("aiPlannerModel", "规划模型（AI_PLANNER_MODEL）", experienceProfile.plannerModel, "留空 = 跟随主模型") + "</div>" +
                "<div class='provider-selected-form'>" + renderProviderConfigFields(selectedProvider, experienceProfile) + "</div><label class='provider-checkbox-row'><input id='aiSaveAndVerify' type='checkbox' value='true'><span>保存后运行真实测试</span></label><div class='provider-actions-row'><button id='saveAiProviderBtn' class='primary'>保存并立即生效</button></div>" : "<div class='ai-secret-note'>关闭后会恢复正式版本地规则。需要调试时再开启并选择一个 Provider。</div>") +
            "</section>" +
          "</div>" +
          renderCustomProviderManager() +
          "<section class='provider-mode-card' style='margin-top:16px;'>" +
            "<div class='provider-card-head'><div><div class='provider-card-title'>Provider 就绪矩阵（真实指标）</div><div class='ai-secret-note'>配置可用 = 已配置且未熔断；已验证 = 本进程内有真实成功调用或探测成功。未验证的 Provider 不会标记为「真实可用/已就绪」，只显示「已配置未验证」。</div></div><button id='reloadAiReadinessMatrixBtn' class='ghost'>刷新矩阵</button></div>" +
            "<div id='aiReadinessMatrixBox' style='padding:0 12px 12px;'><span class='badge muted'>尚未加载</span></div>" +
          "</section>" +
          "<section class='provider-mode-card' style='margin-top:16px;'>" +
            "<div class='provider-card-head'><div><div class='provider-card-title'>调用日志（进程内 · 已脱敏）</div><div class='ai-secret-note'>仅记录 Provider / 调用类型 / 阶段 / 耗时 / 成败分类等元信息，绝不记录用户消息与密钥。进程重启后清空。</div></div><div style='display:flex;gap:8px;align-items:center;'><label style='font-size:12px;display:flex;gap:4px;align-items:center;'><input id='aiCallLogAuto' type='checkbox'" + (state.aiCallLogAutoOn === false ? "" : " checked") + "> 10s 自动刷新</label><button id='reloadAiCallLogBtn' class='ghost'>刷新日志</button></div></div>" +
            "<div id='aiCallLogBox' style='padding:0 12px 12px;max-height:320px;overflow:auto;'><span class='badge muted'>尚未加载</span></div>" +
          "</section>" +
          "<details class='diagnostic-panel'><summary>高级诊断</summary><div id='aiVerifyResult' class='ai-verify-box'>尚未测试。运行后会显示 resolvedProvider、latencyMs、fallback、toolCalls、answerSnippet。</div><div class='provider-actions-row' style='padding:12px;'><button id='verifyAiProviderBtn' class='secondary'>运行真实测试</button><button id='forceAiProviderChatBtn' class='secondary'>测试项目问答</button><button id='runAiGoldenEvalBtn' class='secondary'>黄金测试</button><button id='exportAiEvalReportBtn' class='ghost'>导出报告</button><button id='clearAiLocalMetricsBtn' class='ghost'>清除本地指标</button></div><div id='aiAgentStatusGrid' class='ai-provider-status' style='padding:0 12px 12px;'></div><div id='aiAgentEvalResult' class='ai-verify-box'>黄金测试尚未运行。</div></details>" +
        "</div>";
        setSelectValue("aiExperienceEnabled", experienceEnabled ? "true" : "false");
        setSelectValue("cozeApiMode", experienceProfile.cozeApiMode === "bot" ? "bot" : "workload");
        setSelectValue("cozePollEnabled", experienceProfile.cozePollEnabled === false ? "false" : "true");
        setSelectValue("aiJsonRepair", experienceProfile.jsonRepair === false ? "false" : "true");
        setSelectValue("aiThinkingEnabled", experienceProfile.thinkingEnabled ? "true" : "false");
        if (state.cpFormOpen) {
          setSelectValue("cpProtocol", state.cpFormProtocol || "openai");
          var cpEnabledEl = document.getElementById("cpEnabled");
          if (cpEnabledEl) cpEnabledEl.checked = state.cpFormEnabled !== false;
          var cpStrictEl = document.getElementById("cpStrictJson");
          if (cpStrictEl) cpStrictEl.checked = state.cpFormStrictJson !== false;
        }
        bindAiProviderConsoleEvents();
        syncCozeModeFields();
        renderAiAgentStatus();
        renderAiReadinessMatrix();
      }

      function bindAiProviderConsoleEvents() {
        document.querySelectorAll("[data-ai-experience-env]").forEach(function(button) {
          button.addEventListener("click", function() {
            var environment = button.dataset.aiExperienceEnv === "dev" ? "dev" : "trial";
            state.aiProviderEnvironment = environment;
            state.aiProviderDraftExperienceEnabled = false;
            state.aiProviderSelectedCustomId = "";
            var envStatus = findAiEnvironment(environment) || {};
            if (isExperienceProvider(envStatus.provider)) state.aiProviderSelectedProvider = envStatus.provider;
            renderAiProviderConfig();
          });
        });
        document.querySelectorAll("[data-apc-pick]").forEach(function(card) {
          var pick = function() {
            state.aiProviderSelectedProvider = card.dataset.apcPick || "coze";
            state.aiProviderSelectedCustomId = card.dataset.apcCustomId || "";
            renderAiProviderConfig();
          };
          card.addEventListener("click", pick);
          card.addEventListener("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pick();
            }
          });
        });
        safeBind("cpFormToggleBtn", "click", function() {
          if (state.cpFormOpen) {
            state.cpFormOpen = false;
            state.cpEditingId = "";
            renderAiProviderConfig();
          } else {
            openCustomProviderForm("");
          }
        });
        safeBind("cpSaveBtn", "click", submitCustomProviderForm);
        safeBind("cpCancelBtn", "click", function() {
          state.cpFormOpen = false;
          state.cpEditingId = "";
          renderAiProviderConfig();
        });
        safeBind("cpFetchModelsBtn", "click", fetchCustomProviderModels);
        document.querySelectorAll("[data-cp-edit]").forEach(function(btn) {
          btn.addEventListener("click", function() { openCustomProviderForm(btn.dataset.cpEdit); });
        });
        document.querySelectorAll("[data-cp-delete]").forEach(function(btn) {
          btn.addEventListener("click", function() { deleteCustomProviderEntry(btn.dataset.cpDelete); });
        });
        document.querySelectorAll("[data-cp-primary]").forEach(function(btn) {
          btn.addEventListener("click", function() { setPrimaryCustomProvider(btn.dataset.cpPrimary, btn.dataset.cpCanonical); });
        });
        safeBind("saveAiProviderBtn", "click", saveAiProviderConfig);
        safeBind("cozeTestConnectionBtn", "click", testCozeConnection);
        safeBind("cozeApiMode", "change", syncCozeModeFields);
        safeBind("verifyAiProviderBtn", "click", verifyAiProviderConfig);
        safeBind("forceAiProviderChatBtn", "click", forceAiProviderChatTest);
        safeBind("reloadAiProviderBtn", "click", loadAiProviderConfig);
        safeBind("reloadAiReadinessMatrixBtn", "click", loadAiReadinessMatrix);
        safeBind("reloadAiCallLogBtn", "click", loadAiCallLog);
        safeBind("aiCallLogAuto", "change", function() {
          var on = document.getElementById("aiCallLogAuto") ? document.getElementById("aiCallLogAuto").checked : true;
          state.aiCallLogAutoOn = on;
          setAiCallLogAutoRefresh(on);
        });
        ignoreLoadError(loadAiCallLog());
        setAiCallLogAutoRefresh(state.aiCallLogAutoOn !== false);
        safeBind("runAiGoldenEvalBtn", "click", runAiGoldenEvaluation);
        safeBind("exportAiEvalReportBtn", "click", exportAiEvaluationReport);
        safeBind("clearAiLocalMetricsBtn", "click", clearAiLocalMetrics);
        safeBind("aiPresetPublicSafeBtn", "click", function() { saveAiProviderPreset("public-safe", "public", { noConfirm: true }); });
        safeBind("aiExperienceEnabled", "change", function() {
          if (value("aiExperienceEnabled") === "true") {
            state.aiProviderDraftExperienceEnabled = true;
            state.aiProviderEnvironment = aiExperienceEnvironment();
            if (!state.aiProviderSelectedProvider || state.aiProviderSelectedProvider === "mock") state.aiProviderSelectedProvider = "coze";
            renderAiProviderConfig();
          } else {
            state.aiProviderDraftExperienceEnabled = false;
            saveAiExperienceDisabled();
          }
        });
      }

      function aiProviderPayload() {
        var profile = activeAiProfile();
        var provider = state.aiProviderSelectedProvider || value("aiProvider") || profile.provider || "cloudbase-openai";
        var enhanced = value("aiExperienceEnabled") === "true";
        if (!enhanced) {
          return {
            environment: aiExperienceEnvironment(),
            activeEnvironment: "public",
            activeMode: "public",
            enabled: false,
            provider: "mock",
            providerPolicy: "tool-only",
            runtimeMode: "public",
            mirrorEnvironments: ["trial", "dev"]
          };
        }
        var payload = {
          environment: aiExperienceEnvironment(),
          activeEnvironment: aiExperienceEnvironment(),
          activeMode: aiExperienceEnvironment(),
          enabled: true,
          provider: provider,
          providerPolicy: "auto",
          runtimeMode: "competition",
          mirrorEnvironments: []
        };
        payload.understandingProvider = value("aiUnderstandingProvider");
        payload.plannerProvider = value("aiPlannerProvider");
        payload.responseProvider = value("aiResponseProvider");
        payload.understandingModel = value("aiUnderstandingModel");
        payload.plannerModel = value("aiPlannerModel");
        if (provider === "custom-openai" || provider === "custom-anthropic") {
          var pickedEntry = apcSelectedEntry();
          payload.activeCustomId = pickedEntry ? pickedEntry.id : (state.aiProviderSelectedCustomId || "");
        }
        if (provider === "deepseek") {
          Object.assign(payload, { baseUrl: value("aiBaseUrl"), model: value("aiModel"), reasoningModel: value("aiReasoningModel"), temperature: value("aiTemperature"), maxTokens: value("aiMaxTokens"), jsonRepair: boolValue("aiJsonRepair"), thinkingEnabled: boolValue("aiThinkingEnabled") });
          if (value("aiApiKey")) payload.apiKey = value("aiApiKey");
        } else if (provider === "cloudbase-openai") {
          Object.assign(payload, { cloudbaseOpenaiEnabled: true, cloudbaseOpenaiBaseUrl: value("cloudbaseOpenaiBaseUrl"), cloudbaseOpenaiTextModel: value("cloudbaseOpenaiTextModel"), cloudbaseOpenaiTimeoutMs: value("cloudbaseOpenaiTimeoutMs"), cloudbaseOpenaiMaxTokens: value("cloudbaseOpenaiMaxTokens") });
          if (value("cloudbaseOpenaiApiKey")) payload.cloudbaseOpenaiApiKey = value("cloudbaseOpenaiApiKey");
        } else if (provider === "coze") {
          var cozeApiMode = value("cozeApiMode") === "bot" ? "bot" : "workload";
          Object.assign(payload, { cozeApiMode: cozeApiMode, cozePollEnabled: true, cozePollIntervalMs: profile.cozePollIntervalMs || "1000", cozePollMaxAttempts: profile.cozePollMaxAttempts || "12" });
          if (cozeApiMode === "workload") {
            Object.assign(payload, { cozeWorkloadEndpoint: value("cozeWorkloadEndpoint"), cozeProjectId: value("cozeProjectId") });
          } else {
            Object.assign(payload, { cozeBaseUrl: value("cozeBaseUrl") || profile.cozeBaseUrl || "https://api.coze.cn", cozeBotId: value("cozeBotId"), cozeChatEndpoint: "/v3/chat" });
          }
          if (value("cozeApiKey")) payload.cozeApiKey = value("cozeApiKey");
        }
        return payload;
      }

      function testCozeConnection() {
        var box = $("cozeConnectionResult") || $("aiVerifyResult");
        var profile = activeAiProfile();
        var apiMode = value("cozeApiMode") === "bot" ? "bot" : "workload";
        var payload = {
          environment: aiExperienceEnvironment(),
          apiMode: apiMode,
          baseUrl: value("cozeBaseUrl") || profile.cozeBaseUrl || "https://api.coze.cn",
          botId: value("cozeBotId") || profile.cozeBotId || "",
          workloadEndpoint: value("cozeWorkloadEndpoint") || profile.cozeWorkloadEndpoint || "",
          projectId: value("cozeProjectId") || profile.cozeProjectId || ""
        };
        var token = value("cozeApiKey");
        if (token) payload.apiKey = token;
        if (box) box.textContent = apiMode === "workload" ? "正在校验 Token、项目 ID 与 stream_run 部署状态..." : "正在校验 Token、Bot ID 与发布状态...";
        api("/api/admin/ai-provider/test-coze", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            var data = res.data || {};
            var lines = [
              "状态: " + (data.success ? "连接成功" : "连接失败"),
              "分类: " + (data.code || "-"),
              "说明: " + (data.message || "-"),
              "延迟: " + String(data.latencyMs || 0) + "ms",
              (data.apiMode === "workload" ? "Project: " + (data.projectIdMasked || "未配置") : "Bot: " + (data.botIdMasked || "未配置")),
              (data.apiMode === "workload" ? "项目已部署: " + (data.projectDeployed ? "是" : "未验证") : "已发布 API: " + (data.botPublished ? "是" : "未验证")),
              "Bot 选择器: " + (data.botSelectorAvailable ? "可用" : "不提供"),
              data.botSelectorReason || ""
            ].filter(Boolean);
            if (box) box.textContent = lines.join("\\n");
            showToast(data.success ? "Coze 连接验证通过。" : (data.message || "Coze 连接验证失败。"), data.success ? "success" : "warning");
          })
          .catch(function(error) {
            if (box) box.textContent = "连接测试失败：" + error.message;
            showToast(error.message, "error");
          });
      }

      function saveAiProviderConfig() {
        var payload = aiProviderPayload();
        api("/api/admin/ai-provider/config", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            state.aiProviderDraftExperienceEnabled = false;
            state.aiProviderEnvironment = aiExperienceEnvironment();
            if (isExperienceProvider(payload.provider)) state.aiProviderSelectedProvider = payload.provider;
            renderAiProviderConfig();
            ignoreLoadError(loadAiAgentStatus());
            ignoreLoadError(loadAiReadinessMatrix());
            showToast("配置已保存并立即生效。", "success");
            setStatus("小佛助手实际使用：" + aiProviderActualUseLabel());
            var saveAndVerifyEl = $("aiSaveAndVerify");
            if (saveAndVerifyEl && saveAndVerifyEl.checked) {
              if (payload.provider === "coze") testCozeConnection();
              else verifyAiProviderConfig();
            }
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function saveAiProviderPreset(preset, environment, options) {
        var payload = { preset: preset, environment: environment, activeEnvironment: environment, provider: state.aiProviderSelectedProvider || "deepseek" };
        if (preset === "public-safe") {
          payload.provider = "mock";
          payload.providerPolicy = "tool-only";
          payload.enabled = false;
          payload.runtimeMode = "public";
          payload.activeMode = "public";
        }
        if (!options || options.noConfirm !== true) {
          if (!window.confirm(["将应用预设：" + preset, "目标模式：" + (AI_ENV_LABELS[environment] || environment)].join("\\n"))) return;
        }
        api("/api/admin/ai-provider/config", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            state.aiProviderDraftExperienceEnabled = false;
            state.aiProviderEnvironment = environment === "public" ? aiExperienceEnvironment() : environment;
            var envStatus = findAiEnvironment(state.aiProviderEnvironment);
            if (environment !== "public" && envStatus && isExperienceProvider(envStatus.provider)) state.aiProviderSelectedProvider = envStatus.provider;
            renderAiProviderConfig();
            showToast(environment === "public" ? "已启用正式版本地规则。" : "预设已应用。", "success");
            setStatus("小佛助手实际使用：" + aiProviderActualUseLabel());
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function saveAiExperienceDisabled() {
        var payload = {
          environment: aiExperienceEnvironment(),
          activeEnvironment: "public",
          activeMode: "public",
          enabled: false,
          provider: "mock",
          providerPolicy: "tool-only",
          runtimeMode: "public",
          mirrorEnvironments: ["trial", "dev"]
        };
        api("/api/admin/ai-provider/config", { method: "POST", body: JSON.stringify(payload) })
          .then(function(res) {
            state.aiProviderConfig = res.data || {};
            state.aiProviderDraftExperienceEnabled = false;
            state.aiProviderEnvironment = "trial";
            if (!isExperienceProvider(state.aiProviderSelectedProvider)) state.aiProviderSelectedProvider = "cloudbase-openai";
            renderAiProviderConfig();
            ignoreLoadError(loadAiAgentStatus());
            showToast("已关闭体验/开发 AI，正式版本地规则保持启用。", "success");
            setStatus("体验/开发 AI 已关闭；公开发布保持正式版本地规则。");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function formatAiProviderVerifyResult(data) {
        data = data || {};
        var toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
        var lines = [
          "provider: " + (data.provider || "-"),
          "resolvedProvider: " + (data.resolvedProvider || data.provider || "-"),
          "latencyMs: " + (data.latencyMs || data.elapsedMs || 0),
          "fallback: " + (data.fallback || data.fallbackReason ? "true" : "false"),
          "fallbackReason: " + (data.fallbackReason || "-"),
          "toolCalls: " + (toolCalls.length ? toolCalls.map(function(item) { return (item.name || "-") + "/" + (item.status || "-"); }).join(", ") : "-"),
          "answerSnippet: " + (data.answerSnippet || data.answerPreview || "-")
        ];
        ["deterministicToolTest", "projectQaProviderTest", "forceProviderTest"].forEach(function(key) {
          var item = data[key];
          if (!item) return;
          lines.push("");
          lines.push(key + ".resolvedProvider: " + (item.resolvedProvider || item.provider || "-"));
          lines.push(key + ".latencyMs: " + (item.latencyMs || item.elapsedMs || 0));
          lines.push(key + ".fallback: " + (item.fallback || item.fallbackReason ? "true" : "false"));
          lines.push(key + ".toolCalls: " + ((item.toolCalls || []).map(function(call) { return (call.name || "-") + "/" + (call.status || "-"); }).join(", ") || "-"));
          lines.push(key + ".answerSnippet: " + (item.answerSnippet || item.answerPreview || "-"));
        });
        return lines.join("\\n");
      }

      function buildAiProviderVerifyPayload(mode) {
        var environment = aiExperienceEnvironment();
        return {
          mode: mode || "default",
          environment: environment,
          envVersion: environment === "dev" ? "develop" : "trial"
        };
      }

      function verifyAiProviderConfig() {
        var box = $("aiVerifyResult");
        if (box) box.textContent = "正在运行真实测试...";
        api("/api/admin/ai-provider/verify", { method: "POST", body: JSON.stringify(buildAiProviderVerifyPayload("default")) })
          .then(function(res) {
            var data = res.data || {};
            if (box) box.textContent = formatAiProviderVerifyResult(data);
            showToast("Provider 测试完成。", "success");
          })
          .catch(function(error) {
            if (box) box.textContent = "测试失败：" + error.message;
            showToast(error.message, "error");
          });
      }

      function forceAiProviderChatTest() {
        var box = $("aiVerifyResult");
        if (box) box.textContent = "正在测试项目问答...";
        api("/api/admin/ai-provider/verify", { method: "POST", body: JSON.stringify(buildAiProviderVerifyPayload("project_qa")) })
          .then(function(res) {
            var data = res.data || {};
            var project = data.projectQaProviderTest || data;
            if (box) box.textContent = formatAiProviderVerifyResult(Object.assign({}, data, project));
            showToast("项目问答测试完成。", "success");
          })
          .catch(function(error) {
            if (box) box.textContent = "项目问答测试失败：" + error.message;
            showToast(error.message, "error");
          });
      }

      var KB_TAB_LABELS = { rules: "规则问答", docs: "文档知识库", test: "测试预览", versions: "版本发布", audit: "审计与 Diff" };

      function loadAssistantKb() {
        return api("/api/admin/assistant-kb?status=draft")
          .then(function(res) {
            state.assistantKb = res || {};
            renderAssistantKb();
            return state.assistantKb;
          })
          .catch(function(error) {
            showModuleError("assistant-kb", error);
            throw error;
          });
      }

      function assistantKbEntries(type) {
        var kb = state.assistantKb || {};
        return (Array.isArray(kb.entries) ? kb.entries : []).filter(function(item) { return item.type === type; });
      }

      function renderKbEntryCard(entry) {
        var active = state.assistantKbSelectedId === entry.id ? " active" : "";
        // revision/source shown in card body via existing fields when present
        return "<div class='kb-entry-card" + active + "' data-kb-id='" + escapeHtml(entry.id) + "'><div class='kb-entry-head'><div><div class='kb-entry-title'>" + escapeHtml(entry.title || entry.id) + "</div><div class='ai-secret-note'>" + escapeHtml(entry.id) + " · rev " + escapeHtml(String(entry.revision || 1)) + "</div></div><span class='badge " + (entry.status === "disabled" ? "muted" : "success") + "'>" + escapeHtml(entry.status || "draft") + "</span></div><div class='provider-metrics'><div class='kb-meta-pill'>环境<br><strong>" + escapeHtml((entry.scope || []).join(",")) + "</strong></div><div class='kb-meta-pill'>优先级<br><strong>" + escapeHtml(String(entry.priority || 0)) + "</strong></div><div class='kb-meta-pill'>来源<br><strong>" + escapeHtml(entry.authorityLevel || "unknown") + "</strong></div></div><div class='ai-secret-note'>" + escapeHtml((entry.keywords || []).slice(0, 6).join(" / ") || "未设置关键词") + (entry.sourceUrl ? " · " + escapeHtml(String(entry.sourceUrl).slice(0, 60)) : "") + "</div></div>";
      }

      function selectedKbEntry(type) {
        return assistantKbEntries(type).find(function(item) { return item.id === state.assistantKbSelectedId; }) || null;
      }

      function renderKbEditor(type) {
        var entry = selectedKbEntry(type) || { type: type, scope: ["public", "trial", "dev"], tags: [], keywords: [], priority: 0, body: "" };
        return "<div class='kb-editor-panel'><h3 class='card-title'>" + (entry.id ? "编辑知识" : "新增知识") + "</h3><div class='form-row'>" + aiConfigInput("kbEntryId", "id / sourceId", entry.id || "", "留空自动生成") + aiConfigInput("kbEntryTitle", "标题", entry.title || "", "标题") + "</div><div class='form-row'>" + aiConfigInput("kbEntryScope", "适用环境", (entry.scope || []).join(","), "public,trial,dev") + aiConfigInput("kbEntryTags", "标签", (entry.tags || []).join(","), "help,faq") + "</div><div class='form-row'>" + aiConfigInput("kbEntryKeywords", "关键词 / 同义词", (entry.keywords || []).join(","), "关键词逗号分隔") + aiConfigInput("kbEntryPriority", "优先级", entry.priority || "0", "0-999") + "</div>" + (type === "rule" ? "<div class='form-row full'>" + aiConfigInput("kbEntryPatterns", "正则触发", (entry.patterns || []).join(","), "可选") + "</div>" : "") + "<div class='form-row full'><div><label>正文 / 固定回复</label><textarea id='kbEntryBody' style='min-height:180px;'>" + escapeHtml(entry.body || "") + "</textarea></div></div><div class='kb-actions-row'><button id='kbSaveEntryBtn' class='primary'>" + (entry.id ? "保存修改" : "新增") + "</button>" + (entry.id ? "<button id='kbDeleteEntryBtn' class='danger'>删除</button>" : "") + "<button id='kbNewEntryBtn' class='ghost'>清空</button></div></div>";
      }

      function renderKbImportPreview() {
        var preview = state.assistantKbImportPreview;
        if (!preview) return "尚未解析。";
        var risks = (preview.risks || []).map(function(risk) { return risk.level + ":" + risk.code; }).join(", ") || "none";
        return ["标题: " + (preview.entry && preview.entry.title || "-"), "chunks: " + ((preview.chunks || []).length), "conflict: " + (preview.conflict ? "yes" : "no"), "risks: " + risks].join("\\n");
      }

      function renderKbTestResult() {
        var result = state.assistantKbTestResult;
        if (!result) return "输入问题后可查看命中关键词、RAG 文档、分数、最终回答和 fallback。";
        return ["fallback: " + (result.fallback ? "true" : "false"), "score: " + (result.score || 0), "matchedKeywords: " + (result.matchedKeywords || []).join(", "), "documents: " + (result.ragDocuments || []).map(function(item) { return item.title + "(" + item.score + ")"; }).join(", "), "answer: " + (result.finalAnswer || "-")].join("\\n");
      }

      function renderKbBackups() {
        var backups = state.assistantKb && state.assistantKb.backups || [];
        if (!backups.length) return "<tr><td colspan='4'>暂无备份</td></tr>";
        return backups.map(function(item) { return "<tr><td><code>" + escapeHtml(item.versionId || "-") + "</code></td><td>" + escapeHtml(item.createdAt || "-") + "</td><td>" + escapeHtml(String(item.ruleCount || 0)) + " / " + escapeHtml(String(item.docCount || 0)) + "</td><td><button class='ghost kb-rollback-btn' data-version='" + escapeHtml(item.versionId || "") + "'>回滚</button></td></tr>"; }).join("");
      }

      function renderAssistantKb() {
        var wrap = $("assistantKbConsole");
        if (!wrap) return;
        var tab = state.assistantKbTab || "rules";
        var kb = state.assistantKb || {};
        var tabs = ["rules", "docs", "test", "versions", "audit"].map(function(key) { return "<button type='button' class='" + (tab === key ? "active" : "") + "' data-kb-tab='" + key + "'>" + KB_TAB_LABELS[key] + "</button>"; }).join("");
        var rules = assistantKbEntries("rule");
        var docs = assistantKbEntries("doc");
        var cp = kb.controlPlane || {};
        var cpVersion = cp.version || {};
        var auditRecent = Array.isArray(cp.auditRecent) ? cp.auditRecent : [];
        var auditRows = auditRecent.length
          ? auditRecent.map(function(item) {
            return "<tr><td>" + escapeHtml(item.action || "-") + "</td><td>" + escapeHtml(item.targetId || "-") + "</td><td>" + escapeHtml(item.operatorName || item.operatorType || "-") + "</td><td>" + (item.success === false ? "失败" : "成功") + "</td><td>" + escapeHtml(item.createdAt || "-") + "</td></tr>";
          }).join("")
          : "<tr><td colspan='5'>暂无审计记录</td></tr>";
        wrap.innerHTML = "<div class='kb-hero'><div><h3>小佛助手知识库</h3><p>维护规则问答、文档草稿和发布版本。写入经 Knowledge Control Plane：安全校验、revision 并发、幂等与持久审计。发布/回滚仅后台人工确认；MCP 默认 stdio 且不含 publish/rollback。</p></div><div class='kb-tabs'>" + tabs + "</div></div>" +
          "<div class='ai-provider-status' style='margin-bottom:12px;'>" +
            renderHealthItem("已发布版本", "<code>" + escapeHtml(cpVersion.version || (kb.published && kb.published.versionId) || "-") + "</code>") +
            renderHealthItem("草稿", "<strong>" + escapeHtml(String(kb.draft && kb.draft.ruleCount || 0)) + "</strong> rules / <strong>" + escapeHtml(String(kb.draft && kb.draft.docCount || 0)) + "</strong> docs") +
            renderHealthItem("已发布", "<strong>" + escapeHtml(String(kb.published && kb.published.ruleCount || 0)) + "</strong> rules / <strong>" + escapeHtml(String(kb.published && kb.published.docCount || 0)) + "</strong> docs") +
            renderHealthItem("最近更新", "<span>" + escapeHtml(kb.store && kb.store.updatedAt || kb.published && kb.published.publishedAt || "-") + "</span>") +
          "</div>" +
          "<div class='kb-tab-panel " + (tab === "rules" ? "active" : "") + "'><div class='kb-two-column'><div><div class='kb-toolbar'><strong>规则问答</strong><button id='kbRefreshBtn' class='ghost'>刷新</button></div><div class='kb-list-grid'>" + rules.map(renderKbEntryCard).join("") + "</div></div>" + (tab === "rules" ? renderKbEditor("rule") : "") + "</div></div>" +
          "<div class='kb-tab-panel " + (tab === "docs" ? "active" : "") + "'><div class='kb-two-column'><div><div class='kb-toolbar'><strong>文档知识库</strong><div class='kb-actions-row'><button id='kbExportJsonBtn' class='ghost'>导出 JSON</button><button id='kbExportMdBtn' class='ghost'>导出 MD</button></div></div><div class='kb-list-grid'>" + docs.map(renderKbEntryCard).join("") + "</div><div class='card' style='margin-top:12px;'><h3 class='card-title'>导入 Markdown</h3><textarea id='kbImportMarkdown' style='min-height:180px;' placeholder='支持 YAML frontmatter: title/tags/keywords/scope/priority/sourceUrl/authorityLevel'>" + escapeHtml(state.assistantKbImportText || "") + "</textarea><div id='kbImportPreview' class='ai-verify-box'>" + renderKbImportPreview() + "</div><div class='kb-actions-row'><button id='kbPreviewMdBtn' class='secondary'>预览解析</button><button id='kbCommitMdBtn' class='primary'>导入草稿</button></div></div></div>" + (tab === "docs" ? renderKbEditor("doc") : "") + "</div></div>" +
          "<div class='kb-tab-panel " + (tab === "test" ? "active" : "") + "'><div class='card form-box'><h3 class='card-title'>测试预览</h3><div class='form-row'><div><label>用户问题</label><input id='kbTestQuery' value='" + escapeHtml(state.assistantKbTestQuery || "") + "' placeholder='例如：小佛可以做什么'></div><div><label>环境</label><select id='kbTestEnvironment'><option value='public'" + (state.assistantKbTestEnvironment === "public" ? " selected" : "") + ">public</option><option value='trial'" + (state.assistantKbTestEnvironment === "trial" ? " selected" : "") + ">trial</option><option value='dev'" + (state.assistantKbTestEnvironment === "dev" ? " selected" : "") + ">dev</option></select></div></div><button id='kbRunTestBtn' class='primary'>运行测试</button><div id='kbTestResult' class='ai-verify-box'>" + renderKbTestResult() + "</div></div></div>" +
          "<div class='kb-tab-panel " + (tab === "versions" ? "active" : "") + "'><div class='card form-box'><h3 class='card-title'>版本发布</h3><div class='ai-provider-status'>" + renderHealthItem("草稿", "<strong>" + escapeHtml(String(kb.draft && kb.draft.ruleCount || 0)) + "</strong> rules / <strong>" + escapeHtml(String(kb.draft && kb.draft.docCount || 0)) + "</strong> docs") + renderHealthItem("已发布", "<code>" + escapeHtml(kb.published && kb.published.versionId || "-") + "</code>") + renderHealthItem("备份", "<strong>" + escapeHtml(String(kb.store && kb.store.backupCount || 0)) + "</strong>") + "</div><p class='ai-secret-note'>发布与回滚必须人工确认。MCP 不提供 publish/rollback 工具，也不会在此显示完整 service token。</p><div class='kb-actions-row'><button id='kbPublishBtn' class='primary'>发布草稿</button><button id='kbDiffBtn' class='secondary'>查看 Draft/Published Diff</button><button id='kbRefreshVersionsBtn' class='ghost'>刷新</button></div><div id='kbDiffBox' class='ai-verify-box' style='margin-top:12px;'>" + escapeHtml(state.assistantKbDiffText || "点击上方按钮加载字段级 Diff。") + "</div><div class='table-container'><table><thead><tr><th>版本</th><th>时间</th><th>数量</th><th>操作</th></tr></thead><tbody>" + renderKbBackups() + "</tbody></table></div></div></div>" +
          "<div class='kb-tab-panel " + (tab === "audit" ? "active" : "") + "'><div class='card form-box'><h3 class='card-title'>最近审计</h3><p class='ai-secret-note'>" + escapeHtml(cp.mcpNote || "MCP 仅草稿读写与校验；发布/回滚仍须后台人工确认。") + "</p><div class='table-container'><table><thead><tr><th>动作</th><th>目标</th><th>操作者</th><th>结果</th><th>时间</th></tr></thead><tbody>" + auditRows + "</tbody></table></div></div></div>";
        bindAssistantKbEvents();
      }

      function bindAssistantKbEvents() {
        document.querySelectorAll("[data-kb-tab]").forEach(function(btn) { btn.addEventListener("click", function() { state.assistantKbTab = btn.dataset.kbTab || "rules"; state.assistantKbSelectedId = ""; renderAssistantKb(); }); });
        document.querySelectorAll("[data-kb-id]").forEach(function(card) { card.addEventListener("click", function() { state.assistantKbSelectedId = card.dataset.kbId || ""; renderAssistantKb(); }); });
        safeBind("kbRefreshBtn", "click", loadAssistantKb);
        safeBind("kbRefreshVersionsBtn", "click", loadAssistantKb);
        if (state.assistantKbTab === "rules" || state.assistantKbTab === "docs") {
          safeBind("kbSaveEntryBtn", "click", saveAssistantKbEntry);
          if ($("kbDeleteEntryBtn")) safeBind("kbDeleteEntryBtn", "click", deleteAssistantKbEntry);
          safeBind("kbNewEntryBtn", "click", function() { state.assistantKbSelectedId = ""; renderAssistantKb(); });
        }
        safeBind("kbPreviewMdBtn", "click", previewAssistantKbMarkdown);
        safeBind("kbCommitMdBtn", "click", commitAssistantKbMarkdown);
        safeBind("kbRunTestBtn", "click", runAssistantKbTest);
        safeBind("kbImportMarkdown", "input", function() { state.assistantKbImportText = value("kbImportMarkdown"); });
        safeBind("kbTestQuery", "input", function() { state.assistantKbTestQuery = value("kbTestQuery"); });
        safeBind("kbTestEnvironment", "change", function() { state.assistantKbTestEnvironment = value("kbTestEnvironment") || "public"; });
        safeBind("kbPublishBtn", "click", publishAssistantKb);
        safeBind("kbDiffBtn", "click", loadAssistantKbDiff);
        safeBind("kbExportJsonBtn", "click", function() { exportAssistantKb("json"); });
        safeBind("kbExportMdBtn", "click", function() { exportAssistantKb("md"); });
        document.querySelectorAll(".kb-rollback-btn").forEach(function(btn) { btn.addEventListener("click", function() { rollbackAssistantKb(btn.dataset.version); }); });
      }

      function loadAssistantKbDiff() {
        return api("/api/admin/assistant-kb/diff")
          .then(function(res) {
            var diff = res && res.diff || {};
            var summary = diff.summary || {};
            state.assistantKbDiffText = "新增 " + String(summary.added || 0) +
              " / 删除 " + String(summary.removed || 0) +
              " / 修改 " + String(summary.modified || 0) +
              " / 保留 " + String(summary.retained || 0) +
              (diff.highRisk ? " · 含高风险变更" : " · 无高风险标记");
            if (state.assistantKbTab !== "versions") state.assistantKbTab = "versions";
            renderAssistantKb();
          })
          .catch(function(error) {
            state.assistantKbDiffText = "Diff 加载失败：" + (error && error.message || "unknown");
            renderAssistantKb();
          });
      }

      function kbEntryPayload() {
        var type = state.assistantKbTab === "rules" ? "rule" : "doc";
        return { id: value("kbEntryId"), sourceId: value("kbEntryId"), type: type, title: value("kbEntryTitle"), scope: value("kbEntryScope"), tags: value("kbEntryTags"), keywords: value("kbEntryKeywords"), patterns: value("kbEntryPatterns"), priority: value("kbEntryPriority"), body: value("kbEntryBody") };
      }

      function saveAssistantKbEntry() {
        var payload = kbEntryPayload();
        var selected = state.assistantKbSelectedId;
        api(selected ? "/api/admin/assistant-kb/" + encodeURIComponent(selected) : "/api/admin/assistant-kb", { method: selected ? "PUT" : "POST", body: JSON.stringify(payload) })
          .then(function() { showToast("知识已保存。", "success"); state.assistantKbSelectedId = payload.id || selected; return loadAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function deleteAssistantKbEntry() {
        var selected = state.assistantKbSelectedId;
        if (!selected || !confirm("确认删除这条知识？")) return;
        api("/api/admin/assistant-kb/" + encodeURIComponent(selected), { method: "DELETE" })
          .then(function() { state.assistantKbSelectedId = ""; showToast("知识已删除。", "success"); return loadAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function previewAssistantKbMarkdown() {
        state.assistantKbImportText = value("kbImportMarkdown") || state.assistantKbImportText || "";
        api("/api/admin/assistant-kb/import-md", { method: "POST", body: JSON.stringify({ content: state.assistantKbImportText, commit: false }) })
          .then(function(res) { state.assistantKbImportPreview = res.preview || null; renderAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function commitAssistantKbMarkdown() {
        state.assistantKbImportText = value("kbImportMarkdown") || state.assistantKbImportText || "";
        api("/api/admin/assistant-kb/import-md", { method: "POST", body: JSON.stringify({ content: state.assistantKbImportText, commit: true, conflictMode: "overwrite" }) })
          .then(function() { state.assistantKbImportPreview = null; state.assistantKbImportText = ""; showToast("Markdown 已导入草稿。", "success"); return loadAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function runAssistantKbTest() {
        state.assistantKbTestQuery = value("kbTestQuery") || state.assistantKbTestQuery || "";
        state.assistantKbTestEnvironment = value("kbTestEnvironment") || state.assistantKbTestEnvironment || "public";
        api("/api/admin/assistant-kb/test", { method: "POST", body: JSON.stringify({ query: state.assistantKbTestQuery, environment: state.assistantKbTestEnvironment }) })
          .then(function(res) { state.assistantKbTestResult = res; renderAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function publishAssistantKb() {
        if (!confirm("确认发布当前草稿？发布后小程序端会读取新的已发布版本。")) return;
        api("/api/admin/assistant-kb/publish", { method: "POST", body: JSON.stringify({ label: "admin-publish" }) })
          .then(function() { showToast("知识库已发布。", "success"); return loadAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function rollbackAssistantKb(versionId) {
        if (!versionId || !confirm("确认回滚到 " + versionId + "？")) return;
        api("/api/admin/assistant-kb/rollback", { method: "POST", body: JSON.stringify({ versionId: versionId }) })
          .then(function() { showToast("知识库已回滚。", "success"); return loadAssistantKb(); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function exportAssistantKb(format) {
        api("/api/admin/assistant-kb/export?format=" + encodeURIComponent(format || "json"))
          .then(function(res) {
            var blob = new Blob([res.content || ""], { type: format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" });
            var link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "assistant-kb." + (format === "md" ? "md" : "json");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      var CAMPUS_MAP_LABELS = {
        xianxiNorth: "仙溪北区",
        xianxiSouth: "仙溪南区",
        jiangwan: "江湾",
        hebin: "河滨"
      };
      var CAMPUS_MAP_TYPE_LABELS = {
        teaching_building: "教学楼",
        library: "图书馆",
        canteen: "饭堂",
        campus: "校区",
        area: "区域",
        place: "地点"
      };

      function campusMapKey(place) {
        if (place && place.mapKey) return place.mapKey;
        if (!place) return state.campusMapSelectedMapKey || "xianxiNorth";
        if (place.campus === "江湾校区") return "jiangwan";
        if (place.campus === "河滨校区") return "hebin";
        if (place.campus === "仙溪校区") return place.area === "南区" ? "xianxiSouth" : "xianxiNorth";
        return "xianxiNorth";
      }

      function campusMapDefaults(mapKey) {
        if (mapKey === "xianxiSouth") return { campus: "仙溪校区", area: "南区" };
        if (mapKey === "jiangwan") return { campus: "江湾校区", area: "江湾校区" };
        if (mapKey === "hebin") return { campus: "河滨校区", area: "河滨校区" };
        return { campus: "仙溪校区", area: "北区" };
      }

      function cloneCampusMapDraft() {
        return JSON.parse(JSON.stringify(state.campusMapDraft || { places: [], mapAssets: {} }));
      }

      function selectedCampusPlace() {
        var draft = state.campusMapDraft || {};
        var places = Array.isArray(draft.places) ? draft.places : [];
        return places.find(function(place) { return place.id === state.campusMapSelectedId; }) || null;
      }

      function currentCampusMapAssetGroup() {
        var assets = state.campusMap && state.campusMap.assets || {};
        return assets[state.campusMapSelectedMapKey || "xianxiNorth"] || null;
      }

      function currentCampusMapAsset() {
        var group = currentCampusMapAssetGroup();
        if (!group) return null;
        var draft = state.campusMapDraft || {};
        var assetId = draft.mapAssets && draft.mapAssets[state.campusMapSelectedMapKey] || group.draftAssetId;
        return (group.versions || []).find(function(item) { return item.assetId === assetId; }) || group.current || null;
      }

      function campusMapLog(label, payload) {
        var box = $("campusMapAdvancedLog");
        if (!box) return;
        var entry = "[" + new Date().toISOString() + "] " + label;
        if (payload !== undefined) {
          try {
            entry += "\\n" + JSON.stringify(payload, null, 2);
          } catch (error) {
            entry += "\\n" + String(payload);
          }
        }
        box.textContent = entry + "\\n\\n" + (box.textContent || "").slice(0, 6000);
      }

      function setCampusMapStatus(text, payload) {
        var box = $("campusMapStatus");
        if (box) box.textContent = text || "";
        if (payload !== undefined) campusMapLog(text || "校园地图状态", payload);
      }

      function markCampusMapDirty(dirty) {
        state.campusMapDirty = dirty !== false;
        renderCampusMapCurrentStatus();
      }

      function resetCampusMapDirty() {
        state.campusMapLoadedDraftJson = JSON.stringify(state.campusMapDraft || {});
        state.campusMapDirty = false;
        renderCampusMapCurrentStatus();
      }

      function confirmCampusMapUnsaved() {
        if (!state.campusMapDirty) return true;
        return window.confirm("当前校园地图草稿尚未保存到服务器，继续操作？");
      }

      function pushCampusMapUndo() {
        state.campusMapUndo.push(cloneCampusMapDraft());
        if (state.campusMapUndo.length > 40) state.campusMapUndo.shift();
        state.campusMapRedo = [];
      }

      function loadCampusMapState() {
        setCampusMapStatus("正在加载校园地图数据...");
        return api("/api/admin/campus-map/state")
          .then(function(res) {
            var data = res.data || {};
            state.campusMap = data;
            state.campusMapDraft = data.draft || data.published || { places: [], mapAssets: {} };
            state.campusMapHistory = Array.isArray(data.history) ? data.history : [];
            if (!state.campusMapSelectedId && state.campusMapDraft.places && state.campusMapDraft.places.length) {
              state.campusMapSelectedId = state.campusMapDraft.places[0].id;
            }
            state.campusMapSelectedMapKey = campusMapKey(selectedCampusPlace());
            resetCampusMapDirty();
            renderCampusMapAdmin();
            setCampusMapStatus("已加载草稿 " + (state.campusMapDraft.version || "-") + "，地点 " + ((state.campusMapDraft.places || []).length) + " 个。");
            return refreshCampusMapHealth(true).catch(function() { return data; });
          })
          .catch(function(error) {
            setCampusMapStatus("校园地图加载失败：" + error.message);
            throw error;
          });
      }

      function filteredCampusPlaces() {
        var draft = state.campusMapDraft || {};
        var places = Array.isArray(draft.places) ? draft.places : [];
        var campus = value("campusMapCampus");
        var area = value("campusMapArea");
        var review = value("campusMapReviewFilter");
        var type = value("campusMapTypeFilter");
        var keyword = String(value("campusMapSearch") || "").trim().toLowerCase();
        return places.filter(function(place) {
          if (campus && place.campus !== campus) return false;
          if (area && place.area !== area) return false;
          if (review === "verified" && place.verified !== true) return false;
          if (review === "pending" && place.verified === true) return false;
          if (type && place.type !== type) return false;
          if (!keyword) return true;
          var aliases = Array.isArray(place.aliases) ? place.aliases.join(" ") : "";
          return [place.name, place.code, place.campus, place.area, aliases, place.description].join(" ").toLowerCase().indexOf(keyword) >= 0;
        });
      }

      function renderCampusMapList() {
        var list = $("campusMapPlaceList");
        if (!list) return;
        var places = filteredCampusPlaces();
        list.innerHTML = "";
        if (!places.length) {
          list.innerHTML = "<div class='ai-secret-note'>没有匹配地点，可新增或调整筛选。</div>";
          return;
        }
        places.forEach(function(place) {
          var btn = document.createElement("button");
          btn.className = "campus-map-place-btn" + (place.id === state.campusMapSelectedId ? " active" : "");
          btn.type = "button";
          btn.dataset.id = place.id;
          btn.innerHTML = "<strong>" + escapeHtml(place.name || place.id) + "</strong><br><span class='muted'>" +
            escapeHtml([place.code, place.campus, place.area, place.verified ? "已核对" : "待核对"].filter(Boolean).join(" · ")) + "</span>";
          btn.addEventListener("click", function() {
            if (!confirmCampusMapUnsaved()) return;
            patchCampusMapSelectedFromForm({ pushUndo: false, render: false, markDirty: false });
            state.campusMapSelectedId = place.id;
            state.campusMapSelectedMapKey = campusMapKey(place);
            renderCampusMapAdmin();
            var editor = $("campusMapEditor");
            if (editor && editor.scrollIntoView) editor.scrollIntoView({ block: "center", behavior: "smooth" });
          });
          list.appendChild(btn);
        });
      }

      function renderCampusMapForm() {
        var place = selectedCampusPlace();
        if (!place) {
          ["campusMapName", "campusMapCode", "campusMapAliases", "campusMapDescription"].forEach(function(id) { setValue(id, ""); });
          setSelectValue("campusMapVerified", "false");
          setSelectValue("campusMapType", "teaching_building");
          return;
        }
        setValue("campusMapName", place.name || "");
        setValue("campusMapCode", place.code || "");
        setSelectValue("campusMapEditCampus", place.campus || "仙溪校区");
        setSelectValue("campusMapEditArea", place.area || "北区");
        setValue("campusMapAliases", Array.isArray(place.aliases) ? place.aliases.join(",") : "");
        setValue("campusMapDescription", place.description || "");
        setSelectValue("campusMapVerified", place.verified ? "true" : "false");
        setSelectValue("campusMapType", place.type || "teaching_building");
      }

      function campusMapStatusCard(label, value, foot, tone) {
        return "<div class='campus-map-status-card " + escapeHtml(tone || "") + "'><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value || "-") + "</strong>" + (foot ? "<small>" + escapeHtml(foot) + "</small>" : "") + "</div>";
      }

      function renderCampusMapCurrentStatus() {
        var box = $("campusMapCurrentStatus");
        if (!box) return;
        var map = state.campusMap || {};
        var status = map.status || {};
        var validation = map.validation || {};
        var draft = state.campusMapDraft || map.draft || {};
        var published = map.published || {};
        var cloudbase = status.cloudbase || {};
        var oracle = status.oracle || {};
        var blockerCount = validation.summary && validation.summary.blocker || status.draft && status.draft.validation && status.draft.validation.blocker || 0;
        var warningCount = validation.summary && validation.summary.warning || status.draft && status.draft.validation && status.draft.validation.warning || 0;
        var dirtyText = state.campusMapDirty ? "未保存修改" : "已保存";
        box.innerHTML = [
          campusMapStatusCard("草稿", dirtyText, (draft.version || "-") + " · " + ((draft.places || []).length || 0) + " 个地点", state.campusMapDirty ? "warning" : "success"),
          campusMapStatusCard("已发布", published.version || "尚未发布", (published.publishedAt ? formatDate(published.publishedAt) : "-") + " · " + (published.publishMode || "dual-source"), ""),
          campusMapStatusCard("Oracle", oracle.ok === false ? "不可用" : "可用", (oracle.okCount || 0) + "/" + (oracle.total || 4) + " 张底图", oracle.ok === false ? "blocker" : "success"),
          campusMapStatusCard("CloudBase", cloudbase.status === "synced" ? "已同步" : "待同步", (cloudbase.okCount || 0) + "/" + (cloudbase.total || 4) + " 张底图", cloudbase.status === "synced" ? "success" : "warning"),
          campusMapStatusCard("校验", blockerCount ? ("阻断 " + blockerCount + " 项") : "可发布", "warning " + warningCount + " 项", blockerCount ? "blocker" : (warningCount ? "warning" : "success"))
        ].join("");
      }

      function assetStatusBadge(ok, text) {
        return "<span class='badge " + (ok ? "success" : "danger") + "'>" + escapeHtml(text) + "</span>";
      }

      function renderCampusMapAssets() {
        var grid = $("campusMapAssetGrid");
        if (!grid) return;
        var assets = state.campusMap && state.campusMap.assets || {};
        grid.innerHTML = "";
        ["xianxiNorth", "xianxiSouth", "jiangwan", "hebin"].forEach(function(mapKey) {
          var group = assets[mapKey] || {};
          var asset = group.current || (group.versions && group.versions[0]) || null;
          var local = asset && asset.localStatus || {};
          var cloudbase = asset && asset.cloudbase || {};
          var card = document.createElement("button");
          card.type = "button";
          card.className = "campus-map-asset-card" + (state.campusMapSelectedMapKey === mapKey ? " active" : "");
          card.dataset.mapKey = mapKey;
          card.innerHTML = asset ? [
            "<img class='campus-map-thumb' src='" + escapeHtml(asset.adminUrl || asset.oracleUrl || "") + "' alt='" + escapeHtml(CAMPUS_MAP_LABELS[mapKey]) + "底图'>",
            "<div class='campus-map-asset-title'><strong>" + escapeHtml(CAMPUS_MAP_LABELS[mapKey]) + "</strong>" + assetStatusBadge(local.ok, local.ok ? "Oracle 200" : "Oracle 失败") + "</div>",
            "<div class='campus-map-asset-meta'><code>" + escapeHtml(asset.assetVersion || "-") + "</code><span>" + escapeHtml(asset.width + "x" + asset.height + " · " + asset.size + " B") + "</span><span>CloudBase: " + escapeHtml(cloudbase.status || "pending") + "</span></div>"
          ].join("") : "<div class='ai-secret-note'>缺少 " + escapeHtml(CAMPUS_MAP_LABELS[mapKey]) + " 底图</div>";
          card.addEventListener("click", function() {
            state.campusMapSelectedMapKey = mapKey;
            var place = selectedCampusPlace();
            if (place && campusMapKey(place) !== mapKey) state.campusMapSelectedId = "";
            renderCampusMapAdmin();
          });
          grid.appendChild(card);
        });
        setSelectValue("campusMapAssetSelect", state.campusMapSelectedMapKey || "xianxiNorth");
      }

      function renderCampusMapAssetHistory() {
        var select = $("campusMapAssetHistorySelect");
        if (!select) return;
        var group = currentCampusMapAssetGroup();
        select.innerHTML = "";
        (group && group.versions || []).forEach(function(asset) {
          var option = document.createElement("option");
          option.value = asset.assetId;
          option.textContent = (asset.assetVersion || asset.assetId) + " · " + (asset.originalFileName || "-") + (asset.isPublished ? " · published 使用中" : "");
          select.appendChild(option);
        });
      }

      function renderCampusMapAssetHealth() {
        var box = $("campusMapAssetHealth");
        if (!box) return;
        var assets = state.campusMap && state.campusMap.assets || {};
        var healthState = state.campusMapAssetHealth || {};
        var rows = [];
        ["xianxiNorth", "xianxiSouth", "jiangwan", "hebin"].forEach(function(mapKey) {
          var group = assets[mapKey] || {};
          var asset = group.current || null;
          var health = healthState[mapKey] || null;
          if (!asset) {
            rows.push("<div class='campus-map-health-item'><span>" + escapeHtml(CAMPUS_MAP_LABELS[mapKey]) + "</span><strong>缺少底图</strong></div>");
            return;
          }
          var local = asset.localStatus || {};
          var oracle = health && health.oracle || local;
          var cloudbase = health && health.cloudbase || asset.cloudbase || {};
          var cloudbaseStatus = cloudbase.ok ? "200" : (cloudbase.statusCode || cloudbase.status || "pending");
          rows.push("<div class='campus-map-health-item'><span>" + escapeHtml(CAMPUS_MAP_LABELS[mapKey]) + "</span><strong>" +
            "Oracle " + escapeHtml(String(oracle.status || local.status || "-")) + " · " + escapeHtml(oracle.mime || asset.mime || "-") + " · " + escapeHtml(String(oracle.size || asset.size || 0)) + " B" +
            "<br>CloudBase " + escapeHtml(String(cloudbaseStatus)) + " · " + escapeHtml(cloudbase.mime || "-") + " · " + escapeHtml(String(cloudbase.size || 0)) + " B" +
            "<br>hash " + escapeHtml(String(asset.sha256 || "-").slice(0, 16)) +
            "</strong></div>");
        });
        box.innerHTML = rows.join("");
      }

      function renderCampusMapRect() {
        var rect = $("campusMapRect");
        var image = $("campusMapAdminImage");
        var errorBox = $("campusMapImageError");
        var place = selectedCampusPlace();
        if (!rect || !image) return;
        var mapKey = campusMapKey(place);
        state.campusMapSelectedMapKey = mapKey;
        var asset = currentCampusMapAsset();
        var nextSrc = asset && (asset.adminUrl || asset.oracleUrl) || "";
        if (image.dataset.assetId !== (asset && asset.assetId || "") || image.src.indexOf(nextSrc) < 0) {
          image.dataset.assetId = asset && asset.assetId || "";
          image.dataset.mapKey = mapKey;
          image.src = nextSrc || "/api/admin/campus-map/asset?map=" + encodeURIComponent(mapKey);
          if (errorBox) errorBox.hidden = true;
        }
        var region = place && place.mapRegion;
        if (!place || !region || !Number(region.width) || !Number(region.height)) {
          rect.hidden = true;
          return;
        }
        rect.hidden = false;
        rect.style.left = (Math.max(0, Math.min(1, Number(region.x || 0))) * 100) + "%";
        rect.style.top = (Math.max(0, Math.min(1, Number(region.y || 0))) * 100) + "%";
        rect.style.width = (Math.max(0.02, Math.min(1, Number(region.width || 0.12))) * 100) + "%";
        rect.style.height = (Math.max(0.02, Math.min(1, Number(region.height || 0.1))) * 100) + "%";
      }

      function renderCampusMapHistory() {
        var select = $("campusMapRollbackSelect");
        if (!select) return;
        select.innerHTML = "";
        (state.campusMapHistory || []).forEach(function(item) {
          var option = document.createElement("option");
          option.value = item.id;
          option.textContent = (item.publishedAt || item.version || item.id) + " · " + item.placeCount + " 个地点";
          select.appendChild(option);
        });
      }

      function renderCampusMapDiffPreview(data) {
        var box = $("campusMapDiffPreview");
        if (!box) return;
        var payload = data || {};
        var diff = payload.diff || payload;
        var validation = payload.validation || null;
        var summary = diff.summary || {};
        var pills = [
          ["新增", summary.added || 0],
          ["修改", summary.modified || 0],
          ["删除", summary.removed || 0],
          ["坐标变化", summary.coordinateChanges || 0],
          ["待核对", validation && validation.summary ? validation.summary.needsReview || 0 : 0],
          ["底图变化", summary.assetChanges || 0]
        ].map(function(item) {
          return "<div class='campus-map-diff-pill'><span>" + escapeHtml(item[0]) + "</span><strong>" + escapeHtml(item[1]) + "</strong></div>";
        }).join("");
        var html = "<div class='campus-map-diff-summary'>" + pills + "</div>";
        if (validation) {
          var issues = (validation.issues || []).slice(0, 18);
          html += "<div><strong>" + escapeHtml(validation.ok ? "校验通过，可继续发布。" : "校验失败，请先修复 blocker。") + "</strong></div>";
          if (issues.length) {
            html += "<div class='campus-map-issue-list'>" + issues.map(function(item) {
              var level = item.level || "info";
              return "<div class='campus-map-issue " + escapeHtml(level) + "'><strong>" + escapeHtml(level.toUpperCase()) + " · " + escapeHtml(item.message || "") + "</strong>" +
                (item.action ? "<br><span>" + escapeHtml(item.action) + "</span>" : "") + "</div>";
            }).join("") + "</div>";
          }
        }
        var details = [];
        (diff.assetChanges || []).slice(0, 8).forEach(function(item) {
          details.push("底图 " + item.title + ": " + (item.before || "-") + " -> " + (item.after || "-"));
        });
        (diff.coordinateChanges || []).slice(0, 8).forEach(function(item) {
          details.push("坐标 " + (item.name || item.id) + ": " + JSON.stringify(item.before) + " -> " + JSON.stringify(item.after));
        });
        if (details.length) {
          html += "<details class='campus-map-advanced-log'><summary>展开差异详情</summary><pre>" + escapeHtml(details.join("\\n")) + "</pre></details>";
        }
        box.innerHTML = html;
      }

      function renderCampusMapAdmin() {
        renderCampusMapCurrentStatus();
        renderCampusMapAssets();
        renderCampusMapAssetHistory();
        renderCampusMapAssetHealth();
        renderCampusMapList();
        renderCampusMapForm();
        renderCampusMapRect();
        renderCampusMapHistory();
        if (state.campusMap && state.campusMap.diff) renderCampusMapDiffPreview(state.campusMap);
      }

      function patchCampusMapSelectedFromForm(options) {
        var place = selectedCampusPlace();
        if (!place) return;
        if (!options || options.pushUndo !== false) pushCampusMapUndo();
        place.name = value("campusMapName");
        place.code = value("campusMapCode");
        place.campus = value("campusMapEditCampus") || "仙溪校区";
        place.area = value("campusMapEditArea") || "北区";
        place.aliases = String(value("campusMapAliases") || "").split(/[,，]/).map(function(item) { return item.trim(); }).filter(Boolean);
        place.description = value("campusMapDescription");
        place.verified = value("campusMapVerified") === "true";
        place.reviewStatus = place.verified ? "verified" : "needs-review";
        place.type = value("campusMapType") || "teaching_building";
        place.updatedAt = new Date().toISOString();
        state.campusMapSelectedMapKey = campusMapKey(place);
        if (!options || options.markDirty !== false) markCampusMapDirty(true);
        if (!options || options.render !== false) renderCampusMapAdmin();
      }

      function addCampusMapPlace(options) {
        var opts = options || {};
        pushCampusMapUndo();
        var draft = state.campusMapDraft || { places: [], mapAssets: {} };
        if (!Array.isArray(draft.places)) draft.places = [];
        var mapKey = opts.mapKey || state.campusMapSelectedMapKey || "xianxiNorth";
        var defaults = campusMapDefaults(mapKey);
        var id = "place-" + Date.now();
        draft.places.push({
          id: id,
          campus: defaults.campus,
          area: defaults.area,
          name: "新地点",
          code: "",
          type: "teaching_building",
          aliases: [],
          description: "",
          mapRegion: opts.region || { x: 0.4, y: 0.35, width: 0.14, height: 0.1 },
          verified: false,
          reviewStatus: "needs-review",
          confidence: 0,
          neighbors: [],
          updatedAt: new Date().toISOString()
        });
        state.campusMapDraft = draft;
        state.campusMapSelectedId = id;
        state.campusMapSelectedMapKey = mapKey;
        markCampusMapDirty(true);
        if (opts.render !== false) renderCampusMapAdmin();
        return draft.places[draft.places.length - 1];
      }

      function duplicateCampusMapPlace() {
        var place = selectedCampusPlace();
        if (!place) return;
        pushCampusMapUndo();
        var draft = state.campusMapDraft || { places: [] };
        var copy = JSON.parse(JSON.stringify(place));
        copy.id = place.id + "-copy-" + Date.now();
        copy.name = (place.name || "地点") + " 副本";
        copy.verified = false;
        copy.reviewStatus = "needs-review";
        copy.updatedAt = new Date().toISOString();
        draft.places.push(copy);
        state.campusMapSelectedId = copy.id;
        markCampusMapDirty(true);
        renderCampusMapAdmin();
      }

      function deleteCampusMapPlace() {
        var place = selectedCampusPlace();
        if (!place) return;
        if (!window.confirm("确认删除地点「" + (place.name || place.id) + "」？此操作需要保存草稿后才会写入服务器。")) return;
        pushCampusMapUndo();
        var draft = state.campusMapDraft || { places: [] };
        draft.places = (draft.places || []).filter(function(item) { return item.id !== place.id; });
        state.campusMapSelectedId = draft.places[0] && draft.places[0].id || "";
        markCampusMapDirty(true);
        renderCampusMapAdmin();
      }

      function batchMarkCampusMapPlaces(verified) {
        var places = filteredCampusPlaces();
        if (!places.length) {
          showToast("当前筛选条件下没有地点", "warning");
          return;
        }
        var label = verified ? "已核对" : "待核对";
        if (!window.confirm("确认将当前筛选出的 " + places.length + " 个地点批量标记为" + label + "？")) return;
        pushCampusMapUndo();
        var idSet = {};
        places.forEach(function(place) { idSet[place.id] = true; });
        var draft = state.campusMapDraft || { places: [] };
        (draft.places || []).forEach(function(place) {
          if (!idSet[place.id]) return;
          place.verified = verified === true;
          place.reviewStatus = verified ? "verified" : "needs-review";
          place.updatedAt = new Date().toISOString();
        });
        markCampusMapDirty(true);
        renderCampusMapAdmin();
        showToast("已批量标记 " + places.length + " 个地点为" + label + "，请保存草稿。", "success");
      }

      function setCampusMapRegion(region, options) {
        var place = selectedCampusPlace();
        if (!place) return;
        var x = Math.max(0, Math.min(0.98, Number(region.x || 0)));
        var y = Math.max(0, Math.min(0.98, Number(region.y || 0)));
        var width = Math.max(0.02, Math.min(1 - x, Number(region.width || 0.12)));
        var height = Math.max(0.02, Math.min(1 - y, Number(region.height || 0.1)));
        place.mapRegion = { x: x, y: y, width: width, height: height };
        place.updatedAt = new Date().toISOString();
        if (!options || options.markDirty !== false) markCampusMapDirty(true);
        renderCampusMapRect();
      }

      function campusMapPoint(event) {
        var image = $("campusMapAdminImage");
        if (!image) return null;
        var box = image.getBoundingClientRect();
        var x = (event.clientX - box.left) / Math.max(1, box.width);
        var y = (event.clientY - box.top) / Math.max(1, box.height);
        if (x < 0 || y < 0 || x > 1 || y > 1) return null;
        return { x: x, y: y };
      }

      function resizeCampusMapRegion(region, handle, dx, dy) {
        var left = Number(region.x || 0);
        var top = Number(region.y || 0);
        var right = left + Number(region.width || 0.12);
        var bottom = top + Number(region.height || 0.1);
        if (handle.indexOf("w") >= 0) left += dx;
        if (handle.indexOf("e") >= 0) right += dx;
        if (handle.indexOf("n") >= 0) top += dy;
        if (handle.indexOf("s") >= 0) bottom += dy;
        left = Math.max(0, Math.min(0.98, left));
        top = Math.max(0, Math.min(0.98, top));
        right = Math.max(left + 0.02, Math.min(1, right));
        bottom = Math.max(top + 0.02, Math.min(1, bottom));
        return { x: left, y: top, width: right - left, height: bottom - top };
      }

      function campusMapPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        var editor = $("campusMapEditor");
        var rect = $("campusMapRect");
        var point = campusMapPoint(event);
        if (!editor || !point) return;
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false, markDirty: false });
        var place = selectedCampusPlace();
        if (!place) {
          place = addCampusMapPlace({ mapKey: state.campusMapSelectedMapKey, region: { x: point.x, y: point.y, width: 0.14, height: 0.1 }, render: false });
        }
        pushCampusMapUndo();
        var handle = event.target && event.target.dataset && event.target.dataset.handle || "";
        var targetIsRect = rect && (event.target === rect || rect.contains(event.target));
        if (!targetIsRect) {
          setCampusMapRegion({ x: point.x, y: point.y, width: 0.14, height: 0.1 });
          place = selectedCampusPlace();
        }
        state.campusMapDrag = {
          mode: handle ? "resize" : "move",
          handle: handle || "se",
          startX: point.x,
          startY: point.y,
          region: Object.assign({}, place.mapRegion || { x: point.x, y: point.y, width: 0.14, height: 0.1 }),
          pointerId: event.pointerId
        };
        if (editor.setPointerCapture && event.pointerId !== undefined) {
          try { editor.setPointerCapture(event.pointerId); } catch (error) {}
        }
        event.preventDefault();
      }

      function campusMapPointerMove(event) {
        if (!state.campusMapDrag) return;
        var point = campusMapPoint(event);
        if (!point) return;
        var drag = state.campusMapDrag;
        var dx = point.x - drag.startX;
        var dy = point.y - drag.startY;
        if (drag.mode === "resize") {
          setCampusMapRegion(resizeCampusMapRegion(drag.region, drag.handle || "se", dx, dy));
        } else {
          setCampusMapRegion({
            x: drag.region.x + dx,
            y: drag.region.y + dy,
            width: drag.region.width,
            height: drag.region.height
          });
        }
        event.preventDefault();
      }

      function campusMapPointerUp(event) {
        var editor = $("campusMapEditor");
        if (editor && editor.releasePointerCapture && state.campusMapDrag && state.campusMapDrag.pointerId !== undefined) {
          try { editor.releasePointerCapture(state.campusMapDrag.pointerId); } catch (error) {}
        }
        state.campusMapDrag = null;
      }

      function undoCampusMap() {
        if (!state.campusMapUndo.length) return;
        state.campusMapRedo.push(cloneCampusMapDraft());
        state.campusMapDraft = state.campusMapUndo.pop();
        markCampusMapDirty(true);
        renderCampusMapAdmin();
      }

      function redoCampusMap() {
        if (!state.campusMapRedo.length) return;
        state.campusMapUndo.push(cloneCampusMapDraft());
        state.campusMapDraft = state.campusMapRedo.pop();
        markCampusMapDirty(true);
        renderCampusMapAdmin();
      }

      function saveCampusMapDraft() {
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false });
        return api("/api/admin/campus-map/draft", { method: "POST", body: JSON.stringify(state.campusMapDraft || {}) })
          .then(function(res) {
            state.campusMapDraft = res.data || state.campusMapDraft;
            resetCampusMapDirty();
            return loadCampusMapState();
          })
          .then(function() {
            setCampusMapStatus("草稿已保存：" + (state.campusMapDraft.version || "-"));
            showToast("校园地图草稿已保存。", "success");
          })
          .catch(function(error) {
            setCampusMapStatus("草稿保存失败：" + error.message);
            showToast(error.message, "error");
          });
      }

      function validateCampusMapDraft() {
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false });
        return api("/api/admin/campus-map/validate", { method: "POST", body: JSON.stringify(state.campusMapDraft || {}) })
          .then(function(res) {
            state.campusMap = Object.assign({}, state.campusMap || {}, {
              validation: res.data && res.data.validation || {},
              diff: res.data && res.data.diff || {},
              status: res.data && res.data.status || (state.campusMap && state.campusMap.status) || {}
            });
            renderCampusMapDiffPreview(res.data || {});
            renderCampusMapCurrentStatus();
            setCampusMapStatus("草稿校验完成：" + ((res.data && res.data.validation && res.data.validation.ok) ? "可发布" : "有 blocker 需要修复"), res.data);
            return res.data;
          })
          .catch(function(error) {
            setCampusMapStatus("草稿校验失败：" + error.message);
            showToast(error.message, "error");
          });
      }

      function previewCampusMapDiff() {
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false });
        return api("/api/admin/campus-map/diff", { method: "POST", body: JSON.stringify(state.campusMapDraft || {}) })
          .then(function(res) {
            renderCampusMapDiffPreview(res.data || {});
            return res.data;
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function repairCampusMapDraft(btn) {
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false });
        var restoreButton = setButtonLoading(btn || $("campusMapRepairDraftBtn"), "修复中...");
        return api("/api/admin/campus-map/repair", { method: "POST", body: JSON.stringify(state.campusMapDraft || {}) })
          .then(function(res) {
            var nextState = res.state || {};
            state.campusMap = nextState;
            state.campusMapDraft = nextState.draft || res.data && res.data.document || state.campusMapDraft;
            resetCampusMapDirty();
            renderCampusMapAdmin();
            setCampusMapStatus("自动修复完成：" + ((res.data && res.data.repairs && res.data.repairs.length) || 0) + " 项。", res.data);
            showToast("可修复问题已处理。", "success");
            return res.data;
          })
          .catch(function(error) {
            setCampusMapStatus("自动修复失败：" + error.message, error.data || null);
            showToast(error.message, "error");
          })
          .finally(function() { restoreButton(); });
      }

      function publishCampusMap(options) {
        options = options || {};
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false });
        var btn = options.button || $("campusMapPublishBtn");
        var restoreButton = setButtonLoading(btn, options.allowOracleOnly ? "发布 Oracle 中..." : "一键发布中...");
        return api("/api/admin/campus-map/publish", {
          method: "POST",
          body: JSON.stringify(Object.assign({
            document: state.campusMapDraft || {}
          }, options))
        })
          .then(function(res) {
            var nextState = res.state || {};
            state.campusMap = nextState;
            state.campusMapDraft = nextState.draft || res.data || state.campusMapDraft;
            state.campusMapHistory = Array.isArray(nextState.history) ? nextState.history : state.campusMapHistory;
            state.campusMapLastReceipt = res.receipt || null;
            resetCampusMapDirty();
            renderCampusMapAdmin();
            setCampusMapStatus("已发布：" + ((res.data && res.data.version) || "-") + " · " + ((res.receipt && res.receipt.publishMode) || ""), res.receipt || res.data);
            showToast((res.receipt && res.receipt.publishMode) === "oracle-only" ? "已发布 Oracle 可用版本，CloudBase 可稍后补同步。" : "校园地图双源版本已发布。", "success");
            return res;
          })
          .catch(function(error) {
            var data = error.data || {};
            if (error.code === "CAMPUS_MAP_CLOUDBASE_PENDING_CONFIRM") {
              state.campusMap = data.state || state.campusMap;
              if (data.validation || data.diff) renderCampusMapDiffPreview({ validation: data.validation || {}, diff: state.campusMap && state.campusMap.diff || {} });
              renderCampusMapCurrentStatus();
              setCampusMapStatus("CloudBase 还没同步，但 Oracle 已可用。", data);
              if (window.confirm("CloudBase 暂未同步，是否先发布 Oracle 可用版本，稍后再补 CDN？")) {
                restoreButton();
                return publishCampusMap({ allowOracleOnly: true, button: options.button || $("campusMapPublishOracleOnlyBtn") });
              }
              showToast("已取消发布，旧 published 未被覆盖。", "warning");
              return null;
            }
            setCampusMapStatus("发布失败：" + error.message, data || null);
            showToast(error.message, "error");
            return null;
          })
          .finally(function() { restoreButton(); });
      }

      function backupCampusMap() {
        return api("/api/admin/campus-map/backup", { method: "POST", body: JSON.stringify({ label: "manual" }) })
          .then(function(res) {
            setCampusMapStatus("已备份：" + ((res.data && res.data.filename) || "-"));
            showToast("校园地图备份已创建。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function exportCampusMap() {
        patchCampusMapSelectedFromForm({ pushUndo: false, render: false, markDirty: false });
        var blob = new Blob([JSON.stringify(state.campusMapDraft || {}, null, 2)], { type: "application/json;charset=utf-8" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "campus-map-draft.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      function campusMapImportOptionsFromPreset() {
        var preset = value("campusMapImportPreset") || "full-replace";
        return {
          preset: preset,
          scope: preset.indexOf("places") === 0 ? "places-only" : "places-and-assets",
          mode: preset.indexOf("merge") >= 0 ? "merge" : "replace"
        };
      }

      function importCampusMap() {
        var text = value("campusMapImportJson");
        if (!text) {
          showToast("请先粘贴 JSON", "warning");
          return;
        }
        var payload;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          showToast("JSON 解析失败", "error");
          return;
        }
        pushCampusMapUndo();
        var importOptions = campusMapImportOptionsFromPreset();
        return api("/api/admin/campus-map/import", {
          method: "POST",
          body: JSON.stringify({ document: payload, options: importOptions })
        })
          .then(function(res) {
            state.campusMapDraft = res.data || state.campusMapDraft;
            state.campusMapLastImport = res.importResult || null;
            state.campusMapSelectedId = state.campusMapDraft.places && state.campusMapDraft.places[0] && state.campusMapDraft.places[0].id || "";
            resetCampusMapDirty();
            return loadCampusMapState().then(function() {
              renderCampusMapDiffPreview(res.importResult || {});
              var summary = res.importResult && res.importResult.summary || {};
              setCampusMapStatus("导入完成：新增 " + (summary.added || 0) + "，修改 " + (summary.modified || 0) + "，删除 " + (summary.removed || 0) + "，坐标变化 " + (summary.coordinateChanges || 0) + "，待核对 " + (summary.pendingReview || 0) + "，底图变化 " + (summary.mapAssetChanges || 0) + "。", res.importResult || res);
              showToast("已导入到草稿，导入前草稿已自动备份；需要撤销可点“撤销”再保存。", "success");
            });
          })
          .catch(function(error) {
            state.campusMapUndo.pop();
            setCampusMapStatus("导入失败：" + error.message, error.data || null);
            showToast(error.message, "error");
          });
      }

      function rollbackCampusMap() {
        var historyId = value("campusMapRollbackSelect");
        if (!historyId) {
          showToast("没有可回滚版本", "warning");
          return;
        }
        if (!window.confirm("确认回滚 published 地图到选中历史版本？")) return;
        return api("/api/admin/campus-map/rollback", { method: "POST", body: JSON.stringify({ historyId: historyId }) })
          .then(function(res) {
            var nextState = res.state || {};
            state.campusMap = nextState;
            state.campusMapDraft = nextState.draft || res.data || state.campusMapDraft;
            state.campusMapHistory = Array.isArray(nextState.history) ? nextState.history : state.campusMapHistory;
            resetCampusMapDirty();
            renderCampusMapAdmin();
            showToast("校园地图已回滚。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function cancelCampusMapChanges() {
        if (!state.campusMapDirty || window.confirm("确认放弃未保存的校园地图草稿修改？")) {
          state.campusMapDirty = false;
          loadCampusMapState();
        }
      }

      function refreshCampusMapHealth(silent) {
        return api("/api/admin/campus-map/assets/health")
          .then(function(res) {
            state.campusMapAssetHealth = res.data || {};
            renderCampusMapAssetHealth();
            if (!silent) showToast("底图健康状态已刷新。", "success");
            return res.data;
          })
          .catch(function(error) {
            if (!silent) showToast(error.message, "error");
            throw error;
          });
      }

      function readCampusMapFile(file) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() { resolve(String(reader.result || "")); };
          reader.onerror = function() { reject(new Error("读取文件失败")); };
          reader.readAsDataURL(file);
        });
      }

      function readCampusMapJsonFile(file) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() { resolve(String(reader.result || "")); };
          reader.onerror = function() { reject(new Error("读取 JSON 文件失败")); };
          reader.readAsText(file, "utf-8");
        });
      }

      function importCampusMapJsonFile() {
        var input = $("campusMapImportFile");
        var file = input && input.files && input.files[0];
        if (!file) return;
        readCampusMapJsonFile(file)
          .then(function(text) {
            setValue("campusMapImportJson", text);
            showToast("JSON 文件已载入，可选择导入模式后导入。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); })
          .finally(function() { if (input) input.value = ""; });
      }

      function uploadCampusMapAssetFromInput() {
        var input = $("campusMapAssetFile");
        var file = input && input.files && input.files[0];
        if (!file) return;
        if (!/^image\\/(jpeg|png|webp)$/.test(file.type || "")) {
          showToast("只支持 JPG、PNG、WebP。", "error");
          input.value = "";
          return;
        }
        readCampusMapFile(file)
          .then(function(dataUrl) {
            return api("/api/admin/campus-map/assets/upload", {
              method: "POST",
              body: JSON.stringify({
                mapKey: state.campusMapSelectedMapKey,
                originalFileName: file.name,
                mime: file.type,
                dataBase64: dataUrl
              })
            });
          })
          .then(function(res) {
            input.value = "";
            var nextState = res.data && res.data.state || {};
            state.campusMap = nextState;
            state.campusMapDraft = nextState.draft || state.campusMapDraft;
            resetCampusMapDirty();
            renderCampusMapAdmin();
            showToast((res.data && res.data.duplicate) ? "相同哈希底图已存在，已复用。" : "底图已保存到草稿。", "success");
          })
          .catch(function(error) {
            input.value = "";
            showToast(error.message, "error");
          });
      }

      function restoreCampusMapAsset() {
        var assetId = value("campusMapAssetHistorySelect");
        if (!assetId) return;
        return api("/api/admin/campus-map/assets/restore", {
          method: "POST",
          body: JSON.stringify({ mapKey: state.campusMapSelectedMapKey, assetId: assetId })
        })
          .then(function(res) {
            var nextState = res.data && res.data.state || {};
            state.campusMap = nextState;
            state.campusMapDraft = nextState.draft || state.campusMapDraft;
            resetCampusMapDirty();
            renderCampusMapAdmin();
            showToast("历史底图已恢复为草稿。", "success");
          })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function repairCampusMapAsset() {
        var asset = currentCampusMapAsset();
        if (!asset) return;
        return api("/api/admin/campus-map/assets/repair", {
          method: "POST",
          body: JSON.stringify({ mapKey: state.campusMapSelectedMapKey, assetId: asset.assetId })
        })
          .then(function(res) {
            state.campusMap = res.state || state.campusMap;
            renderCampusMapAdmin();
            return refreshCampusMapHealth(true);
          })
          .then(function() { showToast("底图修复检查完成。", "success"); })
          .catch(function(error) { showToast(error.message, "error"); });
      }

      function syncCampusMapCloudBase(options) {
        options = options || {};
        if (options.force && !window.confirm("确认强制重新同步全部底图到 CloudBase？同 SHA 正常情况下不需要重复上传。")) return Promise.resolve();
        var asset = currentCampusMapAsset();
        var body = {};
        if (options.all || options.force || options.missingOnly) {
          body = { force: options.force === true };
        } else {
          body = { mapKey: state.campusMapSelectedMapKey, assetIds: asset ? [asset.assetId] : [] };
        }
        var btn = options.button || $("campusMapSyncCloudBaseBtn");
        var restoreButton = setButtonLoading(btn, options.force ? "强制同步中..." : "同步中...");
        return api("/api/admin/campus-map/assets/sync-cloudbase", {
          method: "POST",
          body: JSON.stringify(body)
        })
          .then(function(res) {
            var data = res.data || {};
            if (data.state) {
              state.campusMap = data.state;
              state.campusMapDraft = data.state.draft || state.campusMapDraft;
              renderCampusMapAdmin();
            }
            setCampusMapStatus(data.status === "pending" ? "CloudBase 还没同步，但 Oracle 已可用。" : "CloudBase 已同步并验证。", data);
            showToast(data.status === "pending" ? "CloudBase 待同步，可以先发布 Oracle 版本。" : "CloudBase 已同步。", data.status === "pending" ? "warning" : "success");
            return refreshCampusMapHealth(true);
          })
          .catch(function(error) {
            setCampusMapStatus("CloudBase 同步失败：" + error.message, error.data || null);
            showToast(error.message, "error");
          })
          .finally(function() { restoreButton(); });
      }

      function verifyCampusMapPublished(btn) {
        var restoreButton = setButtonLoading(btn || $("campusMapVerifyPublishedBtn"), "验证中...");
        return api("/api/admin/campus-map/verify-published", { method: "POST", body: "{}" })
          .then(function(res) {
            state.campusMap = res.state || state.campusMap;
            state.campusMapLastReceipt = res.data && res.data.receipt || null;
            renderCampusMapAdmin();
            setCampusMapStatus("线上版本验证完成：" + ((state.campusMapLastReceipt && state.campusMapLastReceipt.version) || "-"), res.data || res);
            showToast("线上校园地图版本已验证。", "success");
          })
          .catch(function(error) {
            setCampusMapStatus("线上版本验证失败：" + error.message, error.data || null);
            showToast(error.message, "error");
          })
          .finally(function() { restoreButton(); });
      }

      function previewCurrentCampusMapAsset() {
        var asset = currentCampusMapAsset();
        if (asset && (asset.adminUrl || asset.oracleUrl)) window.open(asset.adminUrl || asset.oracleUrl, "_blank");
      }

      function downloadCurrentCampusMapAsset() {
        var asset = currentCampusMapAsset();
        if (!asset) return;
        var link = document.createElement("a");
        link.href = asset.adminUrl || asset.oracleUrl;
        link.download = asset.originalFileName || "campus-map";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

      function getInitialSection() {
        return getAdminRouteForPath(location.pathname).section;
      }

      function applyAdminRouteFromLocation() {
        var route = getAdminRouteForPath(location.pathname);
        switchSection(route.section, {
          catalogType: route.catalogType,
          path: route.path,
          updateHistory: false
        });
      }

      function loadAll(targetSection) {
        try {
          var route = typeof targetSection === "object" && targetSection !== null
            ? targetSection
            : null;
          var section = route
            ? route.section
            : (typeof targetSection === "string" ? targetSection : (state.section || getInitialSection()));
          switchSection(section, {
            catalogType: route && route.catalogType,
            path: route && route.path,
            updateHistory: false
          });
          setStatus("正在获取佛课后台全局配置...");

          return Promise.allSettled([
            loadDashboard(),
            loadConfig(),
            loadAiProviderConfig(),
            loadNotices(),
            loadNews(),
            loadFeedbacks()
          ]).then(function (results) {
            var failed = results.filter(function (r) { return r.status === "rejected"; });
            if (failed.length > 0) {
              console.warn("[Admin Console] partial load failed:", failed);
              setStatus("部分模块加载失败，但后台基础功能可用。失败模块数：" + failed.length);
              showToast("部分模块加载失败，请查看 Console 或接口状态。", "warning");
            } else {
              setStatus("最近一键刷新时间：" + formatDate(new Date().toISOString()));
              showToast("控制台面板状态已同步", "success");
            }
          }).catch(function (error) {
            console.error("[Admin Console] loadAll fatal:", error);
            setStatus("加载异常：" + (error.message || "未知错误"));
            showToast(error.message || "后台数据加载失败", "error");
            showAdminRuntimeError(error);
          });
        } catch (error) {
          console.error("[Admin Console] loadAll exception:", error);
          setStatus("加载异常：" + (error.message || "未知错误"));
          showAdminRuntimeError(error);
        }
      }

      window.openMobileDrawer = openMobileDrawer;
      window.closeMobileDrawer = closeMobileDrawer;
      window.switchAdminPage = switchSection;
      window.loadDashboard = loadDashboard;
      window.renderDashboard = renderDashboard;

      window.addEventListener("popstate", function() {
        applyAdminRouteFromLocation();
      });

      // 绑定导航与事件
      document.querySelectorAll(".sidebar nav ul li[data-section]").forEach(function (item) {
        item.addEventListener("click", function () {
          switchSection(item.dataset.section);
        });
      });

      // 实时预览监听
      ["noticeTitle", "noticeContent", "noticeVersion"].forEach(function (id) {
        safeBind(id, "input", updateNoticePreview);
      });
      ["noticeType", "noticeDisplayMode", "noticePriority"].forEach(function (id) {
        safeBind(id, "change", updateNoticePreview);
      });

      ["newsTitle", "newsSummary", "newsTag", "newsDate"].forEach(function (id) {
        safeBind(id, "input", updateNewsPreview);
      });

      safeBind("loginButton", "click", login);
      safeBind("loginPassword", "keydown", function (event) { if (event.key === "Enter") login(); });
      safeBind("logoutButton", "click", logout);
      safeBind("refreshButton", "click", loadAll);
      safeBind("refreshTermsBtn", "click", loadTerms);
      safeBind("createTermBtn", "click", createTerm);
      safeBind("checkTermReadinessBtn", "click", checkTermReadiness);
      safeBind("repairCurrentTermReleaseBtn", "click", repairCurrentTermReleaseFromPanel);
      safeBind("rebuildRuntimePointerBtn", "click", rebuildRuntimePointerFromPanel);
      safeBind("bindTermReleaseBtn", "click", bindTermRelease);
      safeBind("activateTermBtn", "click", activateTermFromPanel);
      safeBind("saveConfigButton", "click", saveConfig);
      safeBind("saveAiProviderBtn", "click", saveAiProviderConfig);
      safeBind("verifyAiProviderBtn", "click", verifyAiProviderConfig);
      safeBind("forceAiProviderChatBtn", "click", forceAiProviderChatTest);
      safeBind("reloadAiProviderBtn", "click", loadAiProviderConfig);
      safeBind("runAiGoldenEvalBtn", "click", runAiGoldenEvaluation);
      safeBind("exportAiEvalReportBtn", "click", exportAiEvaluationReport);
      safeBind("clearAiLocalMetricsBtn", "click", clearAiLocalMetrics);
      safeBind("campusMapCampus", "change", renderCampusMapList);
      safeBind("campusMapArea", "change", renderCampusMapList);
      safeBind("campusMapReviewFilter", "change", renderCampusMapList);
      safeBind("campusMapTypeFilter", "change", renderCampusMapList);
      safeBind("campusMapSearch", "input", renderCampusMapList);
      safeBind("campusMapAddBtn", "click", addCampusMapPlace);
      safeBind("campusMapDuplicateBtn", "click", duplicateCampusMapPlace);
      safeBind("campusMapDeleteBtn", "click", deleteCampusMapPlace);
      safeBind("campusMapMarkVerifiedBtn", "click", function() { batchMarkCampusMapPlaces(true); });
      safeBind("campusMapMarkPendingBtn", "click", function() { batchMarkCampusMapPlaces(false); });
      safeBind("campusMapUndoBtn", "click", undoCampusMap);
      safeBind("campusMapRedoBtn", "click", redoCampusMap);
      safeBind("campusMapAssetSelect", "change", function() {
        state.campusMapSelectedMapKey = value("campusMapAssetSelect") || "xianxiNorth";
        renderCampusMapAdmin();
      });
      safeBind("campusMapUploadBtn", "click", function() {
        var input = $("campusMapAssetFile");
        if (input) input.click();
      });
      safeBind("campusMapAssetFile", "change", uploadCampusMapAssetFromInput);
      safeBind("campusMapPreviewAssetBtn", "click", previewCurrentCampusMapAsset);
      safeBind("campusMapDownloadAssetBtn", "click", downloadCurrentCampusMapAsset);
      safeBind("campusMapRepairAssetBtn", "click", repairCampusMapAsset);
      safeBind("campusMapRefreshHealthBtn", "click", function() { refreshCampusMapHealth(false); });
      safeBind("campusMapRestoreAssetBtn", "click", restoreCampusMapAsset);
      ["campusMapName", "campusMapCode", "campusMapAliases", "campusMapDescription"].forEach(function(id) {
        safeBind(id, "input", function() { patchCampusMapSelectedFromForm({ pushUndo: false, render: false }); });
      });
      ["campusMapEditCampus", "campusMapEditArea", "campusMapVerified", "campusMapType"].forEach(function(id) {
        safeBind(id, "change", function() { patchCampusMapSelectedFromForm({ pushUndo: false }); });
      });
      safeBind("campusMapEditor", "pointerdown", campusMapPointerDown);
      document.addEventListener("pointermove", campusMapPointerMove);
      document.addEventListener("pointerup", campusMapPointerUp);
      safeBind("campusMapSaveDraftBtn", "click", saveCampusMapDraft);
      safeBind("campusMapSaveDraftOpsBtn", "click", saveCampusMapDraft);
      safeBind("campusMapCancelBtn", "click", cancelCampusMapChanges);
      safeBind("campusMapValidateBtn", "click", validateCampusMapDraft);
      safeBind("campusMapRepairDraftBtn", "click", function() { repairCampusMapDraft($("campusMapRepairDraftBtn")); });
      safeBind("campusMapDiffBtn", "click", previewCampusMapDiff);
      safeBind("campusMapPublishBtn", "click", function() { publishCampusMap({ button: $("campusMapPublishBtn") }); });
      safeBind("campusMapPublishOracleOnlyBtn", "click", function() { publishCampusMap({ allowOracleOnly: true, skipCloudbaseSync: true, button: $("campusMapPublishOracleOnlyBtn") }); });
      safeBind("campusMapVerifyPublishedBtn", "click", function() { verifyCampusMapPublished($("campusMapVerifyPublishedBtn")); });
      safeBind("campusMapBackupBtn", "click", backupCampusMap);
      safeBind("campusMapExportBtn", "click", exportCampusMap);
      safeBind("campusMapImportBtn", "click", importCampusMap);
      safeBind("campusMapImportFileBtn", "click", function() {
        var input = $("campusMapImportFile");
        if (input) input.click();
      });
      safeBind("campusMapImportFile", "change", importCampusMapJsonFile);
      safeBind("campusMapRollbackBtn", "click", rollbackCampusMap);
      safeBind("campusMapAdminImage", "load", function() {
        var errorBox = $("campusMapImageError");
        if (errorBox) errorBox.hidden = true;
      });
      safeBind("campusMapAdminImage", "error", function() {
        var errorBox = $("campusMapImageError");
        var asset = currentCampusMapAsset();
        if (errorBox) {
          errorBox.hidden = false;
          errorBox.textContent = "底图加载失败：" + (asset && (asset.adminUrl || asset.oracleUrl) || "-") + "；请查看上方 Oracle/CloudBase 健康状态。";
        }
      });
      window.addEventListener("beforeunload", function(event) {
        if (!state.campusMapDirty) return;
        event.preventDefault();
        event.returnValue = "校园地图草稿尚未保存。";
      });
      safeBind("saveNoticeButton", "click", saveNotice);
      safeBind("clearNoticeButton", "click", clearNoticeForm);
      safeBind("saveNewsButton", "click", saveNews);
      safeBind("clearNewsButton", "click", clearNewsForm);
      
      document.querySelectorAll(".text-btn-time").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var target = $(btn.dataset.target);
          if (target) target.value = new Date().toISOString();
        });
      });

      safeBind("generateVersionBtn", "click", function(e) {
        e.preventDefault();
        generateReleaseVersion();
      });

      safeBind("disclaimerCollapseHeader", "click", openDisclaimerCollapse);

      // 反馈过滤与搜索
      safeBind("feedbackSearch", "input", function () {
        state.feedbackFilter.keyword = value("feedbackSearch");
        state.feedbackFilter.page = 1;
        ignoreLoadError(loadFeedbacks());
      });

      document.querySelectorAll("#feedbackStatusTabs button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.querySelectorAll("#feedbackStatusTabs button").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.feedbackFilter.status = btn.dataset.status;
          state.feedbackFilter.page = 1;
          ignoreLoadError(loadFeedbacks());
        });
      });

      safeBind("closeFeedbackDrawerBtn", "click", closeFeedbackDrawer);
      safeBind("cancelFbDrawerBtn", "click", closeFeedbackDrawer);
      safeBind("feedbackDrawerMask", "click", closeFeedbackDrawer);
      safeBind("saveFbDrawerBtn", "click", saveFeedbackDrawerDetail);
      safeBind("copyAppConfigUrlBtn", "click", copyAppConfigUrl);
      safeBind("copyPublicConfigJsonBtn", "click", copyPublicConfigJson);
      safeBind("clearAdminCacheBtn", "click", clearAdminCache);

      // 数据资源中心事件绑定
      document.querySelectorAll("#catalogTabs button").forEach(function(btn) {
        btn.addEventListener("click", function() {
          setCatalogType(btn.dataset.type);
          updateAdminHistory("catalog", { catalogType: state.catalogType });
          loadCatalog();
        });
      });

      safeBind("catalogSearch", "input", function() {
        state.catalogKeyword = value("catalogSearch");
        state.catalogPage = 1;
        loadCatalog();
      });

      safeBind("catalogPrevBtn", "click", function() {
        if (state.catalogPage > 1) {
          state.catalogPage--;
          loadCatalog();
        }
      });

      safeBind("catalogNextBtn", "click", function() {
        if (state.catalogPage * state.catalogPageSize < state.catalogTotal) {
          state.catalogPage++;
          loadCatalog();
        }
      });

      safeBind("closeCatalogDrawerBtn", "click", closeCatalogDrawer);
      safeBind("catalogDrawerMask", "click", closeCatalogDrawer);
      safeBind("saveCatalogMetaBtn", "click", saveCatalogMetaDetail);
      
      safeBind("downloadCatalogJsonBtn", "click", function() { exportCatalogData("json"); });
      safeBind("downloadCatalogCsvBtn", "click", function() { exportCatalogData("csv"); });

      // 周课表预览切换
      safeBind("prevPreviewWeekBtn", "click", function() {
        if (state.previewWeek > 1) {
          state.previewWeek--;
          renderMiniWeekSchedule();
        }
      });
      safeBind("nextPreviewWeekBtn", "click", function() {
        if (state.previewWeek < 20) {
          state.previewWeek++;
          renderMiniWeekSchedule();
        }
      });
      safeBind("toggleWeekendPreviewBtn", "click", function() {
        state.showWeekendPreview = !state.showWeekendPreview;
        renderMiniWeekSchedule();
      });

      safeBind("rawJsonCollapseHeader", "click", function() {
        var content = $("rawJsonCollapseContent");
        content.classList.toggle("open");
      });

      // 同步中心事件
      safeBind("recheckHealthBtn", "click", function() {
        runHealthChecks();
        showToast("服务测速完成");
      });
      safeBind("createRelayTaskBtn", "click", createRelayTask);

      // 审计日志模块筛选
      safeBind("auditLogModuleFilter", "change", function() {
        state.auditModuleFilter = $("auditLogModuleFilter").value;
        renderAuditLogsTable();
      });

      // 移动端侧边栏交互绑定
      safeBind("mobileMenuBtn", "click", function() {
        openMobileDrawer();
      });
      safeBind("sidebarCloseBtn", "click", function() {
        closeMobileDrawer();
      });
      safeBind("sidebarCollapseBtn", "click", function() {
        var shell = $("dashboardView");
        setSidebarCollapsed(!(shell && shell.classList.contains("sidebar-collapsed")));
      });
      safeBind("sidebarOverlay", "click", function() {
        closeMobileDrawer();
      });
      document.addEventListener("keydown", function(event) {
        if (activeDetailDrawer) {
          if (event.key === "Escape") {
            event.preventDefault();
            if (activeDetailDrawer.id === "catalogDrawer") closeCatalogDrawer();
            else if (activeDetailDrawer.id === "feedbackDrawer") closeFeedbackDrawer();
          } else {
            trapFocusWithin(activeDetailDrawer, event);
          }
          return;
        }
        var sidebar = $("appSidebar");
        if (sidebar && sidebar.classList.contains("show")) {
          if (event.key === "Escape") {
            event.preventDefault();
            closeMobileDrawer();
          } else {
            trapFocusWithin(sidebar, event);
          }
        }
      });
      var sidebarDrawerMediaQuery = window.matchMedia ? window.matchMedia("(max-width: 1023.98px)") : null;
      var handleSidebarBreakpointChange = function() {
        if (!isMobileDrawerViewport()) closeMobileDrawer(false);
        else syncSidebarAccessibility();
      };
      if (sidebarDrawerMediaQuery && sidebarDrawerMediaQuery.addEventListener) {
        sidebarDrawerMediaQuery.addEventListener("change", handleSidebarBreakpointChange);
      } else if (sidebarDrawerMediaQuery && sidebarDrawerMediaQuery.addListener) {
        sidebarDrawerMediaQuery.addListener(handleSidebarBreakpointChange);
      }
      syncSidebarAccessibility();
      document.querySelectorAll("[data-dashboard-target]").forEach(function(button) {
        button.addEventListener("click", function() {
          switchSection(button.dataset.dashboardTarget);
        });
      });

      // 热力图切换全周/工作日/周末视图绑定
      document.querySelectorAll("#heatmapDayType button").forEach(function(btn) {
        btn.addEventListener("click", function() {
          document.querySelectorAll("#heatmapDayType button").forEach(function(b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.heatmapDayType = btn.dataset.daytype;
          if (state.classroomHeatmapData) {
            renderGithubStyleHeatmap(state.classroomHeatmapData, state.heatmapDayType);
          }
        });
      });

      // 收起热力图详情面板
      safeBind("closeHmDetailBtn", "click", function() {
        var panel = $("classroomHeatmapDetailPanel");
        if (panel) panel.classList.remove("show");
      });

      // 管理员个人 XLS 课表测试调试上传绑定
      if ($("xlsTestSelectBtn") && $("xlsTestInput")) {
        safeBind("xlsTestSelectBtn", "click", function() {
          var input = $("xlsTestInput");
          if (input) input.click();
        });

        safeBind("xlsTestInput", "change", function(e) {
          var file = e.target.files[0];
          if (!file) return;

          if (file.size > 10 * 1024 * 1024) {
            showToast("测试文件大小不能超过 10MB", "error");
            return;
          }

          $("xlsTestInfo").textContent = "正在读取文件：" + file.name + "...";

          var reader = new FileReader();
          reader.onload = function(evt) {
            var base64 = evt.target.result.split(",")[1];
            $("xlsTestInfo").textContent = "正在测试解析中...";

            api("/api/fosu/personal/import-xls", {
              method: "POST",
              body: JSON.stringify({
                filename: file.name,
                fileBase64: base64,
                targetTerm: (state.dashboard && state.dashboard.currentSemester) || ""
              })
            })
            .then(function(res) {
              var resultDiv = $("xlsTestResult");
              if (res.success) {
                $("xlsTestInfo").innerHTML = "解析成功！文件名：" + escapeHtml(res.filename);
                resultDiv.style.display = "block";
                resultDiv.style.borderColor = "var(--success)";

                var html = "<strong>解析概要：</strong><br/>" +
                           "· 学期：" + res.term + "<br/>" +
                           "· 课程总数：" + res.courseCount + " 门<br/><br/>" +
                           "<strong>解析课程明细列表：</strong><br/>";

                res.courses.forEach(function(c, idx) {
                  html += (idx + 1) + ". <strong>" + escapeHtml(c.courseName) + "</strong> - " + escapeHtml(c.teacherName) + " | 周" + c.weekDay + " [" + c.sections.join(",") + "]节 | " + escapeHtml(c.classroom || "无教室") + " | " + c.weeks.length + "周<br/>";
                });
                resultDiv.innerHTML = html;
              } else {
                $("xlsTestInfo").textContent = "解析失败";
                resultDiv.style.display = "block";
                resultDiv.style.borderColor = "var(--danger)";
                resultDiv.innerHTML = "<span style='color: var(--danger); font-weight:700;'>解析错误信息：</span><br/>" + escapeHtml(res.message || "未知错误");
              }
            })
            .catch(function(err) {
              $("xlsTestInfo").textContent = "上传失败";
              var resultDiv = $("xlsTestResult");
              resultDiv.style.display = "block";
              resultDiv.style.borderColor = "var(--danger)";
              resultDiv.innerHTML = "<span style='color: var(--danger); font-weight:700;'>网络请求错误：</span><br/>" + escapeHtml(err.message || "请求失败");
            });
          };
          reader.readAsDataURL(file);
        });
      }

      function runAdminInitModule(name, fn) {
        try {
          return fn();
        } catch (error) {
          console.error("[Admin Console] init module failed:", name, error);
          showAdminRuntimeError(error);
          return null;
        }
      }

      function initAuthView() {
        if (isLoginPage && $("loginPassword")) {
          $("loginPassword").focus();
        }
      }

      function initNavigation() {
        closeMobileDrawer();
        initSidebarPreference();
        var route = getAdminRouteForPath(location.pathname);
        state.section = route.section;
        if (route.catalogType) {
          setCatalogType(route.catalogType, { resetPage: false });
        }
      }

      function initDashboard() {
        setStatus("后台基础界面已启动，正在加载数据模块...");
      }

      function initNoticeModule() {
        if ($("noticeFormTitle")) {
          clearNoticeForm();
        }
      }

      function initNewsModule() {
        if ($("newsFormTitle")) {
          clearNewsForm();
        }
      }

      var syncTabKeys = ["overview", "upload", "versions", "operations"];
      var syncLegacyAnchorMap = {
        "sync-ops-console": "overview",
        "sync-pending-panel": "overview",
        "sync-active-panel": "overview",
        "recommended-sync-flow-card": "overview",
        "sync-primary-flow": "upload",
        "staging-cli-upload-panel": "upload",
        "staging-upload-panel": "upload",
        "publisher-status-card": "upload",
        "relay-task-panel": "upload",
        "static-release-sync-panel": "versions",
        "release-history-panel": "versions",
        "sync-log-panel": "versions",
        "runtime-storage-panel": "operations",
        "api-health-panel": "operations",
        "sync-command-accordion": "operations"
      };

      function syncTabFromHash(hashValue) {
        var anchor = String(hashValue || "").replace(/^#/, "");
        if (syncTabKeys.indexOf(anchor) >= 0) return anchor;
        return syncLegacyAnchorMap[anchor] || "overview";
      }

      function moveSyncPanelNode(nodeId, mountId) {
        var node = $(nodeId);
        var mount = $(mountId);
        if (node && mount) mount.appendChild(node);
      }

      function collapseSyncFlowCards() {
        var cards = document.querySelectorAll("#sync-primary-flow .flow-card");
        Array.prototype.forEach.call(cards, function(card, index) {
          if (String(card.tagName || "").toLowerCase() === "details") return;
          var titleNode = card.querySelector(".flow-title");
          var details = document.createElement("details");
          var summary = document.createElement("summary");
          var riskText = index === 0 ? "需校园网 · 中风险" : "外网可用 · 中风险";
          details.className = card.className;
          summary.innerHTML =
            "<span class='flow-summary-main'><span class='flow-step'>Step " + (index + 1) + "</span><strong>" +
            escapeHtml(titleNode ? titleNode.textContent : "同步流程") +
            "</strong></span><span class='flow-summary-meta'><span>" + riskText + "</span><span>展开命令</span></span>";
          details.appendChild(summary);
          while (card.firstChild) details.appendChild(card.firstChild);
          card.parentNode.replaceChild(details, card);
        });
      }

      function distributeSyncTabPanels() {
        var payload = $("syncTabPayload");
        if (!payload) return;
        moveSyncPanelNode("sync-ops-console", "syncOverviewMetricsMount");
        moveSyncPanelNode("sync-pipeline-shell", "syncOverviewPipelineMount");
        moveSyncPanelNode("sync-pending-panel", "syncOverviewPrimary");
        moveSyncPanelNode("recommended-sync-flow-card", "syncOverviewPrimary");
        moveSyncPanelNode("sync-active-panel", "syncOverviewActiveMount");

        [
          "sync-primary-flow",
          "publisher-status-card",
          "staging-cli-upload-panel",
          "staging-upload-panel",
          "relay-task-panel"
        ].forEach(function(id) { moveSyncPanelNode(id, "syncUploadStack"); });

        [
          "static-release-sync-panel",
          "release-history-panel",
          "sync-log-panel"
        ].forEach(function(id) { moveSyncPanelNode(id, "syncVersionsStack"); });

        [
          "runtime-storage-panel",
          "api-health-panel",
          "sync-command-accordion"
        ].forEach(function(id) { moveSyncPanelNode(id, "syncOperationsStack"); });

        collapseSyncFlowCards();
        payload.remove();
      }

      function activateSyncTab(tabKey, options) {
        options = options || {};
        var key = syncTabKeys.indexOf(tabKey) >= 0 ? tabKey : "overview";
        syncTabKeys.forEach(function(candidate) {
          var tab = $("sync-tab-" + candidate);
          var panel = $("sync-panel-" + candidate);
          var active = candidate === key;
          if (tab) {
            tab.setAttribute("aria-selected", active ? "true" : "false");
            tab.setAttribute("tabindex", active ? "0" : "-1");
          }
          if (panel) {
            panel.hidden = !active;
            if (active) panel.removeAttribute("inert");
            else panel.setAttribute("inert", "");
          }
        });
        if ($("syncTabSelect")) $("syncTabSelect").value = key;
        if (options.updateHash && location.hash !== "#" + key) {
          history.replaceState(null, "", location.pathname + location.search + "#" + key);
        }
        if (options.focus) {
          var activeTab = $("sync-tab-" + key);
          if (activeTab) activeTab.focus();
        }
        return key;
      }

      function initSyncTabs() {
        var tablist = $("syncTaskTabs");
        if (!tablist || tablist.dataset.initialized === "true") return;
        tablist.dataset.initialized = "true";
        var legacyAnchor = String(location.hash || "").replace(/^#/, "");
        distributeSyncTabPanels();

        var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
        tabs.forEach(function(tab, index) {
          tab.addEventListener("click", function() {
            activateSyncTab(tab.getAttribute("data-sync-tab"), { updateHash: true });
          });
          tab.addEventListener("keydown", function(event) {
            var nextIndex = index;
            switch (event.key) {
              case "ArrowLeft":
                nextIndex = (index - 1 + tabs.length) % tabs.length;
                break;
              case "ArrowRight":
                nextIndex = (index + 1) % tabs.length;
                break;
              case "Home":
                nextIndex = 0;
                break;
              case "End":
                nextIndex = tabs.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            activateSyncTab(tabs[nextIndex].getAttribute("data-sync-tab"), { updateHash: true, focus: true });
          });
        });

        if ($("syncTabSelect")) {
          $("syncTabSelect").addEventListener("change", function(event) {
            activateSyncTab(event.target.value, { updateHash: true });
          });
        }
        Array.prototype.forEach.call(document.querySelectorAll("[data-sync-tab-jump]"), function(button) {
          button.addEventListener("click", function() {
            activateSyncTab(button.getAttribute("data-sync-tab-jump"), { updateHash: true });
          });
        });
        window.addEventListener("hashchange", function() {
          activateSyncTab(syncTabFromHash(location.hash));
        });

        var initialKey = syncTabFromHash(location.hash);
        activateSyncTab(initialKey, { updateHash: Boolean(legacyAnchor && syncLegacyAnchorMap[legacyAnchor]) });
        if (syncLegacyAnchorMap[legacyAnchor]) {
          window.requestAnimationFrame(function() {
            var target = $(legacyAnchor);
            if (target) target.scrollIntoView({ block: "start" });
          });
        }
      }

      function initSyncModule() {
        initSyncTabs();
        updateWizardCommand();
        
        // 绑定向导折叠/展开 (如果存在的话，向后兼容)
        var wizardHeader = $("wizardCollapseHeader");
        var wizardBody = $("wizardCollapseBody");
        var wizardIcon = $("wizardCollapseIcon");
        if (wizardHeader && wizardBody) {
          wizardHeader.addEventListener("click", function() {
            var isHidden = wizardBody.style.display === "none";
            wizardBody.style.display = isHidden ? "block" : "none";
            if (wizardIcon) {
              wizardIcon.textContent = isHidden ? "▲" : "▼";
            }
          });
        }

        // 绑定主流程 Step 1 & Step 2 的复制按钮
        safeBind("flowCopyBtnLocal", "click", function() {
          var text = $("flowCmdTextLocal").textContent;
          if (text) copyText(text);
        });
        safeBind("flowCopyBtnRelay", "click", function() {
          var text = $("flowCmdTextRelay").textContent;
          if (text) copyText(text);
        });
        safeBind("copyPublisherCommandBtn", "click", function() {
          var winSlash = String.fromCharCode(92);
          var projectDirWin = ["C:", "Users", "Katelya", "Documents", "VScode", "FosuClass"].join(winSlash);
          copyText("cd " + projectDirWin + String.fromCharCode(10) + "npm run sync:publish");
        });
        safeBind("copyPublisherCommandTopBtn", "click", function() {
          var btn = $("copyPublisherCommandBtn");
          if (btn) btn.click();
        });
        safeBind("syncFocusPendingBtn", "click", function() {
          activateSyncTab("overview", { updateHash: true });
          var target = $("sync-pending-panel");
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        safeBind("refreshPublisherStatusBtn", "click", function() {
          var btn = $("refreshPublisherStatusBtn");
          var restoreButton = setButtonLoading(btn, "读取中...");
          loadPublisherStatusPanel().then(function() {
            showToast("Publisher 状态已刷新", "success");
          }).catch(function(err) {
            showToast(err.message, "error");
          }).finally(function() {
            restoreButton();
          });
        });
        safeBind("copyCloudbaseRetryBtn", "click", function() {
          copyText("npm run sync:publish -- --mode=mirror-only");
        });
        safeBind("copyCloudbaseExportBtn", "click", function() {
          var data = state.syncStatus || {};
          var version = data.releaseVersion || data.activeReleaseVersion || "<releaseVersion>";
          copyText("npm run sync:export-cloudbase -- --release=" + version);
        });
        safeBind("copyStaticManifestBtn", "click", function() {
          var data = state.syncStatus || {};
          if (data.staticManifestUrl) copyText(data.staticManifestUrl);
        });
        safeBind("verifyStaticUrlBtn", "click", function() {
          startPostPublishVerify($("verifyStaticUrlBtn"), (state.syncStatus || {}).releaseVersion);
        });
        safeBind("manualStaticSyncBtn", "click", function() {
          var data = state.syncStatus || {};
          var version = data.releaseVersion || "";
          if (!version) {
            showToast("当前没有 active releaseVersion", "error");
            return;
          }
          startStaticSync($("manualStaticSyncBtn"), version);
        });
        safeBind("forceStaticSyncBtn", "click", function() {
          var data = state.syncStatus || {};
          var version = data.releaseVersion || "";
          if (!version) {
            showToast("当前没有 active releaseVersion", "error");
            return;
          }
          if (!confirm("确认强制重新同步当前 Release？该操作会重新核对并增量复制文件，但不会重新构建 Release，不会删除 last-known-good，也不会改变 active pointer。")) {
            return;
          }
          startStaticSync($("forceStaticSyncBtn"), version, { force: true });
        });
        safeBind("reconcileLifecycleBtn", "click", function() {
          var btn = $("reconcileLifecycleBtn");
          var restoreButton = setButtonLoading(btn, "核对中...");
          api("/api/admin/sync/reconcile", {
            method: "POST",
            body: "{}"
          }).then(function(res) {
            showToast("状态核对完成", "success");
            if (res.lifecycle) state.syncStatus = Object.assign({}, state.syncStatus || {}, res.lifecycle);
            return loadSyncStatus();
          }).catch(function(err) {
            showToast(err.message, "error");
          }).finally(function() {
            restoreButton();
          });
        });
        safeBind("refreshStorageStatusBtn", "click", function() {
          refreshStorageStatus(true).catch(function(err) { showToast(err.message, "error"); });
        });
        safeBind("scanStorageBtn", "click", function() {
          runStorageScan($("scanStorageBtn"));
        });
        safeBind("previewMaintenanceBtn", "click", function() {
          runMaintenance($("previewMaintenanceBtn"), true);
        });
        safeBind("runMaintenanceBtn", "click", function() {
          if (!confirm("确认执行安全清理？该操作会跳过 active / last-known-good / running job，但仍会删除过期临时文件。")) return;
          runMaintenance($("runMaintenanceBtn"), false);
        });
        safeBind("viewStaticSyncLogBtn", "click", function() {
          var el = $("syncJobLog");
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        safeBind("syncNextActionBtn", "click", function() {
          var data = state.syncStatus || {};
          var actionType = data.nextAction && data.nextAction.type || "";
          if (actionType === "publish" || data.stagingNeedsPublish) {
            publishStaging($("syncNextActionBtn"));
            return;
          }
          if (actionType === "static-sync") {
            startStaticSync($("syncNextActionBtn"), data.releaseVersion);
            return;
          }
          if (data.stagingSameAsActive) {
            startPostPublishVerify($("syncNextActionBtn"), data.releaseVersion);
            return;
          }
          var text = $("flowCmdTextLocal") ? $("flowCmdTextLocal").textContent : "";
          if (text) copyText(text);
        });
        safeBind("syncRefreshInlineBtn", "click", function() {
          loadSyncStatus({ force: true });
        });

        // ------------------ 新版同步向导初始化 ------------------
        // 1. Shell 切换绑定
        var shells = ["powershell", "cmd", "bash"];
        shells.forEach(function(sh) {
          var btn = $("shell-" + sh);
          if (btn) {
            btn.addEventListener("click", function() {
              shells.forEach(function(s) {
                var b = $("shell-" + s);
                if (b) b.classList.remove("active");
              });
              btn.classList.add("active");
              state.currentShell = sh;
              updateWizardCommand();
            });
          }
        });

        // 2. Preset 卡片切换绑定
        var presets = ["full", "force", "fast", "resources", "debug"];
        presets.forEach(function(pr) {
          var card = $("preset-" + pr);
          if (card) {
            card.addEventListener("click", function() {
              presets.forEach(function(p) {
                var c = $("preset-" + p);
                if (c) c.classList.remove("active");
              });
              card.classList.add("active");

              // 应用 Preset 配置到 UI 控件
              var forceBox = $("wizardForceRefresh");
              if (forceBox) forceBox.checked = false;

              if (pr === "full") {
                ["rangeClass", "rangeTeacher", "rangeClassroom", "rangeCourse", "rangeClassroomList", "rangeTeacherList", "rangeCourseList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = true;
                });
                var gm = $("wizardGradesMode");
                if (gm) gm.value = "recommend";
                var cc = $("wizardConcurrency");
                if (cc) cc.value = "1";
                var dy = $("wizardDelay");
                if (dy) dy.value = "900";
              } else if (pr === "force") {
                ["rangeTeacher", "rangeTeacherList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = true;
                });
                ["rangeClass", "rangeClassroom", "rangeCourse", "rangeClassroomList", "rangeCourseList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = false;
                });
                var gmTeacher = $("wizardGradesMode");
                if (gmTeacher) gmTeacher.value = "all";
                var ccTeacher = $("wizardConcurrency");
                if (ccTeacher) ccTeacher.value = "1";
                var dyTeacher = $("wizardDelay");
                if (dyTeacher) dyTeacher.value = "900";
              } else if (pr === "fast") {
                ["rangeClass"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = true;
                });
                ["rangeTeacher", "rangeClassroom", "rangeCourse", "rangeClassroomList", "rangeTeacherList", "rangeCourseList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = false;
                });
                var gm = $("wizardGradesMode");
                if (gm) gm.value = "freshman";
                var cc = $("wizardConcurrency");
                if (cc) cc.value = "1";
                var dy = $("wizardDelay");
                if (dy) dy.value = "900";
              } else if (pr === "resources") {
                ["rangeClass", "rangeCourseList", "rangeClassroomList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = true;
                });
                ["rangeTeacher", "rangeClassroom", "rangeCourse", "rangeTeacherList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = false;
                });
                var gm = $("wizardGradesMode");
                if (gm) gm.value = "recommend";
                var cc = $("wizardConcurrency");
                if (cc) cc.value = "1";
                var dy = $("wizardDelay");
                if (dy) dy.value = "900";
              } else if (pr === "debug") {
                ["rangeClassroom", "rangeClassroomList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = true;
                });
                ["rangeClass", "rangeTeacher", "rangeCourse", "rangeTeacherList", "rangeCourseList"].forEach(function(id) {
                  var cb = $(id);
                  if (cb) cb.checked = false;
                });
                var gm = $("wizardGradesMode");
                if (gm) gm.value = "all";
                var cc = $("wizardConcurrency");
                if (cc) cc.value = "1";
                var dy = $("wizardDelay");
                if (dy) dy.value = "900";
              }

              // 触发年级模式切换
              var gmEl = $("wizardGradesMode");
              if (gmEl) gmEl.dispatchEvent(new Event("change"));

              updateWizardCommand();
            });
          }
        });

        // 3. 年级选择模式联动
        safeBind("wizardGradesMode", "change", function() {
          var mode = value("wizardGradesMode");
          var customRow = $("wizardGradesCustomRow");
          if (customRow) {
            if (mode === "custom") {
              customRow.style.display = "block";
            } else {
              customRow.style.display = "none";
            }
          }
          updateWizardCommand();
        });

        // 4. Stepper 导航按钮绑定
        safeBind("stepperPrevBtn", "click", function() {
          if (state.activeStep > 1) {
            state.activeStep--;
            updateStepperUI();
          }
        });

        safeBind("stepperNextBtn", "click", function() {
          if (state.activeStep < 6) {
            state.activeStep++;
            updateStepperUI();
          }
        });

        // 点击指示器也允许跳转
        document.querySelectorAll(".step-indicator-item").forEach(function(item) {
          item.addEventListener("click", function() {
            var step = parseInt(item.dataset.step, 10);
            if (step) {
              state.activeStep = step;
              updateStepperUI();
            }
          });
        });

        // 5. 各种 Input 的变化事件重新生成命令
        safeBind("wizardStartDate", "input", function() {
          state.wizardStartDateTouched = true;
          updateWizardCommand();
        });
        ["wizardNote", "wizardGradesCustom", "wizardCollegesFilter", "wizardMajorsFilter", "wizardDelay"].forEach(function(id) {
          safeBind(id, "input", updateWizardCommand);
        });
        ["wizardTerm", "wizardSource", "wizardConcurrency"].forEach(function(id) {
          safeBind(id, "change", updateWizardCommand);
        });
        safeBind("wizardForceRefresh", "change", updateWizardCommand);
        ["rangeClass", "rangeTeacher", "rangeClassroom", "rangeCourse", "rangeClassroomList", "rangeTeacherList", "rangeCourseList"].forEach(function(id) {
          safeBind(id, "change", updateWizardCommand);
        });

        // 6. 下载脚本绑定
        safeBind("downloadCmdBtn", "click", function() {
          state.currentShell = "cmd";
          updateWizardCommand();
          var content = $("wizardCommandCode").textContent;
          downloadScript("run-sync.cmd", content);
        });

        safeBind("downloadPs1Btn", "click", function() {
          state.currentShell = "powershell";
          updateWizardCommand();
          var content = $("wizardCommandCode").textContent;
          downloadScript("run-sync.ps1", content);
        });

        // 触发一次 UI 刷新
        updateStepperUI();
      }

      function downloadScript(filename, content) {
        var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("脚本文件 " + filename + " 已开始下载");
      }

      function updateStepperUI() {
        var step = state.activeStep;
        
        // 1. 更新 Indicator 状态
        document.querySelectorAll(".step-indicator-item").forEach(function(item) {
          var s = parseInt(item.dataset.step, 10);
          item.classList.remove("active", "completed");
          if (s === step) {
            item.classList.add("active");
          } else if (s < step) {
            item.classList.add("completed");
          }
        });

        // 2. 更新进度条
        var progressLine = $("stepperProgressLine");
        if (progressLine) {
          progressLine.style.width = ((step - 1) / 5) * 100 + "%";
        }

        // 3. 更新内容卡片显隐
        for (var i = 1; i <= 6; i++) {
          var cont = $("step-content-" + i);
          if (cont) {
            if (i === step) {
              cont.classList.add("active");
            } else {
              cont.classList.remove("active");
            }
          }
        }

        // 4. 更新按钮状态
        var prevBtn = $("stepperPrevBtn");
        var nextBtn = $("stepperNextBtn");
        if (prevBtn) {
          prevBtn.disabled = (step === 1);
        }
        if (nextBtn) {
          if (step === 6) {
            nextBtn.textContent = "已是最后一步";
            nextBtn.disabled = true;
          } else {
            nextBtn.textContent = "下一步";
            nextBtn.disabled = false;
          }
        }
      }

      function initFeedbackModule() {
        if (location.pathname.indexOf("/feedback") >= 0) {
          state.section = "feedback";
        }
      }

      function initSettingsModule() {
        safeBind("runSecuritySelfCheckBtn", "click", function() {
          runSecuritySelfCheck($("runSecuritySelfCheckBtn"));
        });
        safeBind("exportSecurityReportBtn", "click", function() {
          exportSecurityReport($("exportSecurityReportBtn"));
        });
        safeBind("cleanupSecurityStatsBtn", "click", function() {
          cleanupSecurityStats($("cleanupSecurityStatsBtn"));
        });
        return true;
      }

      function bootAdminConsole() {
        if (window.__adminConsoleBooted) {
          return;
        }

        try {
          initThemeControls();
          if (isLoginPage) {
            showLoginView();
          } else {
            showDashboardView();
          }
          window.__adminConsoleBooted = true;

          runAdminInitModule("auth", initAuthView);
          if (isLoginPage) {
            return;
          }

          ensureAdminSession()
            .then(function() {
              [
                ["navigation", initNavigation],
                ["dashboard", initDashboard],
                ["notice", initNoticeModule],
                ["news", initNewsModule],
                ["sync", initSyncModule],
                ["feedback", initFeedbackModule],
                ["settings", initSettingsModule],
              ].forEach(function(item) {
                runAdminInitModule(item[0], item[1]);
              });
              return loadAll(getAdminRouteForPath(location.pathname));
            })
            .catch(function(error) {
              console.warn("[Admin Console] session check failed:", error.message);
              showAdminRuntimeError(error);
            });
        } catch (error) {
          console.error("[Admin Console] boot fatal:", error);
          bootFallback(error);
        }
      }

      window.bootAdminConsole = bootAdminConsole;
      document.addEventListener("DOMContentLoaded", bootAdminConsole);
      if (document.readyState === "interactive" || document.readyState === "complete") {
        window.setTimeout(bootAdminConsole, 0);
      }
    })();
  </script>
</body>
</html>`;

function sendAdminHtml(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data: https://pan.katelya.eu.org; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(adminConsoleHtml);
}

function buildAdminLoginRedirect(req) {
  const target = req.originalUrl && req.originalUrl.startsWith("/admin") && !req.originalUrl.startsWith("/admin/login")
    ? `?next=${encodeURIComponent(req.originalUrl)}`
    : "";
  return `/admin/login${target}`;
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

router.get([
  "/dashboard",
  "/timetable",
  "/classes",
  "/teachers",
  "/classrooms",
  "/courses",
  "/feedback",
  "/sync",
  "/terms",
  "/settings",
  "/logs",
  "/catalog",
  "/resources",
  "/quality",
  "/ai-provider",
  "/assistant-kb",
  "/ai",
  "/campus-map",
  "/map",
  "/announcements",
  "/notices",
  "/news",
  "/config",
  "/version",
  "/security",
], (req, res) => {
  if (!adminAuth.isAdminCookieValid(req)) {
    return res.redirect(buildAdminLoginRedirect(req));
  }
  return sendAdminHtml(res);
});

router.get("*", (req, res) => {
  if (!adminAuth.isAdminCookieValid(req)) {
    return res.redirect(buildAdminLoginRedirect(req));
  }
  return res.redirect("/admin/dashboard");
});

router.adminConsoleHtml = adminConsoleHtml;
module.exports = router;
