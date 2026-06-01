const express = require("express");
const adminAuth = require("../services/adminAuth");

const router = express.Router();

const ADMIN_LOGO_URL = "https://pan.katelya.eu.org/file/tgs_eyJ2IjoxLCJmIjoiQWdBQ0FnVUFBeUVGQUFUYW1yME1BQUlCcjJvZEZiTTBGUVFjQzFUclVwVWlDNFdadG0tckFBSnBFR3NidWJQb1ZITjJyQjhxcWZNbkFRQURBZ0FEZVFBRE93USIsImUiOiJqcGciLCJuIjoicGhvdG9fNDMxLmpwZyIsIm0iOiJpbWFnZS9qcGVnIiwicyI6MTE0ODAwLCJ0IjoxNzgwMjkwOTk2MjkyLCJtaWQiOjQzMX0.pCRB9D4sdHdjeP1XpKnQfMVMlSCh37uQE67VGaKBWFw.jpg";
const ADMIN_LOGO_FALLBACK_URL = "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2064%2064%27%3E%3Cdefs%3E%3ClinearGradient%20id%3D%27g%27%20x1%3D%270%27%20y1%3D%270%27%20x2%3D%271%27%20y2%3D%271%27%3E%3Cstop%20stop-color%3D%27%233b82f6%27%2F%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%238b5cf6%27%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2764%27%20height%3D%2764%27%20rx%3D%2716%27%20fill%3D%27url(%23g)%27%2F%3E%3Crect%20x%3D%2716%27%20y%3D%2716%27%20width%3D%2732%27%20height%3D%2734%27%20rx%3D%276%27%20fill%3D%27white%27%20opacity%3D%27.96%27%2F%3E%3Cpath%20d%3D%27M23%2024h18M23%2032h18M23%2040h10%27%20stroke%3D%27%233b82f6%27%20stroke-width%3D%274%27%20stroke-linecap%3D%27round%27%2F%3E%3C%2Fsvg%3E";
const ADMIN_LOGO_IMG_ATTRS = `src="${ADMIN_LOGO_URL}" alt="佛课小表" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${ADMIN_LOGO_FALLBACK_URL}';"`;

const adminConsoleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>佛课小表 Admin Console</title>
  <link rel="icon" type="image/jpeg" href="${ADMIN_LOGO_URL}">
  <link rel="apple-touch-icon" href="${ADMIN_LOGO_URL}">
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
      --radius: 16px;
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

    [hidden] {
      display: none !important;
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
    .brand,
    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
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
      background: #fff;
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
      color: #92400e;
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
      display: flex;
      align-items: center;
      gap: 6px;
      background: #eff6ff;
      color: #1d4ed8;
      padding: 6px 8px;
      font-size: 9px;
      overflow: hidden;
      border-radius: 999px;
      border: 1px solid #bfdbfe;
      min-height: 28px;
    }
    .mini-ticker.important {
      background: #fff7ed;
      color: #c2410c;
      border-color: #fed7aa;
    }
    .mini-ticker.urgent {
      background: #fef2f2;
      color: #b91c1c;
      border-color: #fecaca;
    }
    .mini-ticker-icon {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.75);
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
    .mini-ticker-action {
      flex: 0 0 auto;
      font-weight: 800;
    }
    @keyframes miniTickerScroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
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
      gap: 8px;
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
      .app-shell {
        grid-template-columns: 1fr;
      }
      .mobile-topbar {
        display: flex;
        grid-column: 1 / -1;
      }
      .sidebar {
        position: fixed;
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
        padding: 16px;
      }
      .topbar {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
      }
      .topbar-actions {
        width: 100%;
        justify-content: flex-end;
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
      align-items: center;
      background: #0f172a;
      color: #38bdf8;
      border-radius: 6px;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      justify-content: space-between;
      gap: 8px;
    }
    .command-code-box code {
      word-break: break-all;
    }
    .command-code-box button {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: var(--transition);
    }
    .command-code-box button:hover {
      background: rgba(255,255,255,0.25);
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
      gap: 12px;
      margin: 16px 0 20px;
    }
    .sync-mode-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      background: var(--panel);
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 150px;
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
      gap: 10px;
    }
    .relay-table td {
      vertical-align: top;
      font-size: 12px;
    }
    .relay-token {
      display: inline-block;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
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
      gap: 16px;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 20px;
      background: var(--panel-2);
      margin-top: 16px;
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
  </style>
</head>
<body>

  <!-- 登录页视图 -->
  <main id="loginView" class="login-wrap" style="width: min(400px, calc(100% - 32px)); margin: 15vh auto;" hidden>
    <div class="card" style="padding: 32px;">
      <img class="login-logo" ${ADMIN_LOGO_IMG_ATTRS}>
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
    <div class="mobile-topbar" id="mobileAdminTopbar">
      <div class="mobile-logo-wrap">
        <img class="brand-logo" ${ADMIN_LOGO_IMG_ATTRS}>
        <span>佛课小表</span>
      </div>
      <div class="mobile-topbar-title" id="mobilePageTitle">数据概览</div>
      <button id="mobileMenuBtn" class="mobile-menu-toggle" type="button" aria-label="打开后台导航">☰</button>
    </div>
    <div id="sidebarOverlay" class="sidebar-overlay"></div>

    <!-- 左侧导航侧边栏 -->
    <aside id="appSidebar" class="sidebar">
      <div>
        <div class="brand sidebar-brand">
          <img class="brand-logo" ${ADMIN_LOGO_IMG_ATTRS}>
          <div class="sidebar-brand-text">
            <div class="brand-title sidebar-brand-title">佛课小表</div>
            <div class="brand-subtitle sidebar-brand-subtitle">Admin Console v1.5</div>
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
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #EEF3F8;"></span>空闲</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #D8E8FF;"></span>较低</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #9CC7FF;"></span>一般</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #4D8FEF;"></span>较高</span>
            <span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background: #1D4ED8;"></span>繁忙</span>
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

        <div class="sync-mode-grid">
          <div class="sync-mode-card">
            <span class="command-tag low">推荐</span>
            <strong>本机校园网同步</strong>
            <p>管理员在已连接校园网的 Windows / Mac / Linux 电脑运行本地同步客户端，访问 100.fosu.edu.cn，生成 Staging JSON 后上传后台。</p>
            <code>npm run sync:local-campus -- --term=2026-2027-1</code>
          </div>
          <div class="sync-mode-card">
            <span class="command-tag low">长期运营推荐</span>
            <strong>接力代理端同步</strong>
            <p>把轻量采集器和 relay token 发给在校同学。接力端只上传 Staging JSON，不拥有后台管理员权限。</p>
            <code>npm run sync:relay-agent -- --token=xxx</code>
          </div>
          <div class="sync-mode-card">
            <span class="command-tag high">兼容模式</span>
            <strong>服务器直连同步</strong>
            <p>仅保留为兼容路径。VPS 无法访问 100.fosu.edu.cn 属于预期情况，不代表本机校园网异常。</p>
            <code>不作为主流程</code>
          </div>
        </div>

        <div class="dash-columns">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- 新学期同步向导 -->
            <div class="card">
              <h3 class="card-title">📅 新学期一键同步向导</h3>
              <form id="wizardForm" class="sync-wizard-form" onsubmit="return false;">
                <div class="form-row">
                  <div>
                    <label for="wizardTerm">目标学期 (term)</label>
                    <input type="text" id="wizardTerm" placeholder="例如: 2026-2027-1" value="2026-2027-1">
                  </div>
                  <div>
                    <label for="wizardStartDate">学期开始日期 (StartDate)</label>
                    <input type="date" id="wizardStartDate" value="2026-09-01">
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

                <div>
                  <label>同步范围</label>
                  <div class="sync-range-grid">
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeClass" checked> 行政班课表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeTeacher" checked> 教师课表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeClassroom" checked> 教室课表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeCourse" checked> 课程课表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeClassroomList" checked> 教室列表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeTeacherList" checked> 教师列表
                    </label>
                    <label class="sync-range-item">
                      <input type="checkbox" id="rangeCourseList" checked> 课程列表
                    </label>
                  </div>
                </div>

                <div class="form-row">
                  <div>
                    <label for="wizardMode">操作模式</label>
                    <select id="wizardMode">
                      <option value="dry-run">只测试不发布 (dry-run)</option>
                      <option value="staging" selected>生成候选版本 (staging)</option>
                      <option value="publish">直接发布 (publish) - [不推荐]</option>
                    </select>
                  </div>
                </div>

                <div class="wizard-command-preview">
                  <label style="margin-bottom: 2px;">📋 推荐运行的同步指令：</label>
                  <div class="command-code-box">
                    <code id="wizardCommandCode">加载中...</code>
                    <button type="button" id="wizardCopyBtn">复制命令</button>
                  </div>
                  <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">
                    提示：主流程是在已连接校园网的本机运行采集命令；VPS 只负责保存、校验、预览、发布和回滚。
                  </div>
                </div>
              </form>
            </div>

            <!-- Staging JSON 上传与校验预览面板 -->
            <div class="card">
              <h3 class="card-title">📤 Staging JSON 上传、比对与发布</h3>
              <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">
                Staging 机制：在本地或校园网电脑运行同步脚本生成 JSON 快照，在此处上传进行安全校验，比对线上数据无误后，再行正式发布。
              </p>
              
              <div style="border: 2px dashed var(--border); border-radius: var(--radius); padding: 30px 20px; text-align: center; font-size: 13px; cursor: pointer; transition: var(--transition);" id="uploadDropzone" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                <p style="color: var(--muted); margin-bottom: 10px; font-weight: 600;">点击或拖拽本地生成的 Staging JSON 文件至此</p>
                <input type="file" id="syncFileInput" style="display: none;" accept=".json">
                <button type="button" class="secondary" id="syncSelectFileBtn">选择 JSON 文件</button>
                <div id="uploadFileInfo" style="margin-top: 10px; font-weight: 600; color: var(--primary);"></div>
              </div>

              <!-- Staging 预览比对容器 -->
              <div id="stagingPreviewBox" style="display: none;">
                <div class="staging-preview-container">
                  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
                    <strong style="font-size: 14px; color: var(--text);">📋 上传的 Staging 数据预览</strong>
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
                  </div>

                  <!-- 校验 Warning 列表 -->
                  <div id="stagingWarningsBox" class="warnings-list" style="display: none;">
                    <strong>⚠️ 数据合规性校验警告:</strong>
                    <div id="stagingWarningsList"></div>
                  </div>

                  <!-- 详细班级 Diff 列表 -->
                  <div>
                    <strong style="font-size: 12px; color: var(--text);">🏫 行政班级变动明细：</strong>
                    <div class="diff-classes-list" id="stagingDiffClassesList">
                      暂无变动。
                    </div>
                  </div>

                  <!-- 变动熔断与二次强确认发布控制 -->
                  <div style="border-top: 1px solid var(--border); padding-top: 14px; display: flex; flex-direction: column; gap: 10px;">
                    <div id="forceConfirmContainer" style="display: none; background: var(--danger-soft); border: 1px solid var(--danger); padding: 12px; border-radius: 8px; font-size: 12px; color: #991b1b;">
                      <strong>⚠️ 警报: 数据变动幅度超过熔断阈值(30%)!</strong>
                      <p style="margin-top: 4px; margin-bottom: 8px;">本次同步的行政班/课表记录变动量较大，为防止误清空线上数据，直接发布已被拦截。若确属新学期全量重构，请在下方手动勾选确认后强行发布。</p>
                      <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: #991b1b; font-weight: 700; margin-bottom:0;">
                        <input type="checkbox" id="stagingForceConfirm"> 我已知晓风险，确认本次数据变动为正常新学期更迭，强行发布
                      </label>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 12px; align-items: center;">
                      <span id="publishStatusText" style="font-size:12px; color:var(--muted);"></span>
                      <button type="button" class="primary" id="stagingPublishBtn" style="padding: 10px 20px;">🚀 发布为正式版本</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 接力任务管理 -->
            <div class="card">
              <h3 class="card-title">接力任务管理</h3>
              <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">
                relay token 只允许接力端读取任务与上传 Staging JSON，不允许访问 /api/admin、发布 release 或读取敏感配置。
              </p>
              <div class="relay-task-grid">
                <div>
                  <label>目标学期</label>
                  <input id="relayTaskTerm" placeholder="2026-2027-1" value="2026-2027-1">
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
                <button type="button" class="primary" id="createRelayTaskBtn">创建接力任务</button>
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

          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- 同步运维命令指南 -->
            <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
              <h3 class="card-title" style="margin-bottom: 0;">🛠️ 同步运维命令说明</h3>
              <div id="syncCommands" class="command-card-list">
                <!-- 动态命令列表 -->
              </div>
            </div>

            <!-- API 健康检测 -->
            <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 class="card-title" style="margin-bottom: 0;">🌐 API 健康状态检测</h3>
                <button class="secondary" id="recheckHealthBtn" style="padding: 4px 10px; font-size: 12px;">一键测试</button>
              </div>
              <div class="health-grid" id="healthGrid">
                <!-- 接口连通度 -->
              </div>
            </div>
          </div>
        </div>

        <!-- 版本发布历史与一键秒级回滚 -->
        <div class="card" style="margin-top: 20px;">
          <h3 class="card-title">⏪ 版本发布历史与回滚控制</h3>
          <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">
            展示最近发布的 5 个课表快照版本。发生数据污染、排课失误或临时调整时，可通过回滚键秒级切回历史版本，即时触碰小程序配置。
          </p>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>版本号</th>
                  <th>目标学期</th>
                  <th>发布时间 / 备份</th>
                  <th>数据范围统计</th>
                  <th>说明备注</th>
                  <th>当前状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="releasesTableBody">
                <tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 20px 0;">获取数据中...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 最近数据同步上报日志 -->
        <div class="card" style="margin-top: 20px;">
          <h3 class="card-title">📜 最近同步历史日志</h3>
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
      const root = document.body;
      root.innerHTML =
        '<main style="max-width:520px;margin:12vh auto;padding:24px;font-family:system-ui">' +
          '<h1>佛课小表后台启动失败</h1>' +
          '<p>后台页面 JS 初始化异常，基础服务可能仍在运行。</p>' +
          '<pre style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px">' +
            escapeHtml(error && (error.stack || error.message) || String(error)) +
          '</pre>' +
          '<button onclick="location.href=\\'/admin/login\\'">返回登录页</button>' +
          '<button onclick="location.reload()">刷新重试</button>' +
        '</main>';
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

    window.addEventListener("error", function(event) {
      console.error("[Admin Runtime Error]", event.error || event.message);
      showAdminRuntimeError(event.error || { name: "Error", message: event.message || "页面脚本运行失败" });
      if (!window.__adminConsoleBooted) {
        bootFallback(event.error || { name: "Error", message: event.message || "页面脚本运行失败" });
      }
    });

    window.addEventListener("unhandledrejection", function(event) {
      console.error("[Admin Promise Rejection]", event.reason);
      showAdminRuntimeError(event.reason || { name: "PromiseRejection", message: "后台接口请求失败" });
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
        relayTasks: [],
        relayUploads: [],
        healthChecks: [],
        qualityReport: null,
        heatmapDayType: "all",
        classroomHeatmapData: null,
        
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
        document.body.classList.add("is-login-page");
        document.body.classList.remove("is-dashboard-page");
      }

      function showDashboardView() {
        if (loginView) loginView.hidden = true;
        if (dashboardView) dashboardView.hidden = false;
        document.body.classList.remove("is-login-page");
        document.body.classList.add("is-dashboard-page");
      }

      function openMobileDrawer() {
        var sidebar = $("appSidebar");
        var overlay = $("sidebarOverlay");
        if (sidebar) sidebar.classList.add("show");
        if (overlay) overlay.classList.add("show");
      }

      function closeMobileDrawer() {
        var sidebar = $("appSidebar");
        var overlay = $("sidebarOverlay");
        if (sidebar) sidebar.classList.remove("show");
        if (overlay) overlay.classList.remove("show");
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
        options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        options.credentials = "include";

        return fetch(path, options).then(function (res) {
          return res.text().then(function (text) {
            var data = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch (e) {
              data = { success: false, message: text || res.statusText };
            }

            if (res.status === 401) {
              var message = data.message || "后台登录已过期，请重新登录";
              var isSessionCheck = path.indexOf("/api/admin/session") >= 0;
              if (isSessionCheck && location.pathname.indexOf("/admin/login") < 0) {
                showToast("后台登录已过期，请重新登录", "error");
                window.location.href = "/admin/login";
              }
              throw new Error(message);
            }

            if (!res.ok || data.success === false) {
              throw new Error(data.message || ("HTTP " + res.status));
            }

            return data;
          });
        });
      }

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
                data = { success: false, message: text || res.statusText };
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
            window.location.href = "/admin/login";
            throw new Error("后台登录已过期，请重新登录");
          }
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
        if (!password) {
          if (loginError) loginError.textContent = "请输入验证密码";
          return;
        }
        api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password: password })
        }).then(function () {
          if (loginError) loginError.textContent = "";
          window.location.href = "/admin/dashboard";
        }).catch(function (error) {
          if (loginError) loginError.textContent = error.message;
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
        var nextTitle = titles[section] || "Admin Console";
        if ($("pageTitle")) {
          $("pageTitle").textContent = nextTitle;
        }
        if ($("mobilePageTitle")) {
          $("mobilePageTitle").textContent = nextTitle;
        }
        closeMobileDrawer();
        
        // 切页面后自动获取对应页面数据
        if (section === "catalog") {
          ignoreLoadError(loadCatalog());
        } else if (section === "sync") {
          ignoreLoadError(loadSyncStatus());
        } else if (section === "quality") {
          ignoreLoadError(loadQualityReport());
        } else if (section === "settings") {
          ignoreLoadError(loadSettingsLogs());
        } else if (section === "feedback") {
          ignoreLoadError(loadFeedbacks());
        }
      }

      function loadDashboard() {
        setStatus("正在读取后台数据概览...");
        return api("/api/admin/dashboard")
          .then(function (res) {
            state.dashboard = res.data || res || {};
            renderDashboard();
            setStatus("数据概览已更新：" + formatDate(new Date().toISOString()));
            return state.dashboard;
          })
          .catch(function (error) {
            console.error("[Admin Console] loadDashboard failed:", error);
            setStatus("数据概览加载失败：" + (error.message || "未知错误"));
            showToast(error.message || "数据概览加载失败", "error");
            throw error;
          });
      }

      function loadConfig() {
        return api("/api/admin/config")
          .then(function (res) {
            state.config = res.data || {};
            renderConfigForm();
            return state.config;
          })
          .catch(function (error) {
            console.error("[Admin Console] loadConfig failed:", error);
            showToast(error.message || "系统配置加载失败", "error");
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
            console.error("[Admin Console] loadNotices failed:", error);
            showToast(error.message || "公告配置加载失败", "error");
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
            console.error("[Admin Console] loadNews failed:", error);
            showToast(error.message || "最新动态加载失败", "error");
            throw error;
          });
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
          renderGithubStyleHeatmap(data);
        }
      }

      function heatmapColor(value) {
        if (value <= 0) return "#EEF3F8";
        if (value <= 25) return "#D8E8FF";
        if (value <= 50) return "#9CC7FF";
        if (value <= 75) return "#4D8FEF";
        return "#1D4ED8";
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
            cell.title = weekdays[day] + " 第" + section + "节\\n占用率：" + val + "%\\n占用教室：" + occupied + "/" + (meta.totalClassrooms || 0);
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
            renderMiniWeekSchedule();
            if ($("catalogRawJson")) {
              $("catalogRawJson").textContent = JSON.stringify(res.data.original || res.data, null, 2);
            }
            if ($("catalogDrawerMask")) $("catalogDrawerMask").classList.add("show");
            if ($("catalogDrawer")) $("catalogDrawer").classList.add("show");
          })
          .catch(function(error) {
            showToast(error.message || "读取资源详情失败", "error");
          });
      };

      function closeCatalogDrawer() {
        if ($("catalogDrawerMask")) $("catalogDrawerMask").classList.remove("show");
        if ($("catalogDrawer")) $("catalogDrawer").classList.remove("show");
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

      // Panel 3: 同步中心 Sync Center
      function loadSyncStatus() {
        setStatus("正在获取系统同步状态与运维指南...");
        return api("/api/admin/sync/status")
          .then(function(res) {
            state.syncStatus = res.data;
            renderSyncStatusGrid();
            
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
              api("/api/admin/relay/uploads")
            ]);
          })
          .then(function(results) {
            var taskResult = results[0];
            var uploadResult = results[1];
            if (taskResult && taskResult.status === "fulfilled") {
              state.relayTasks = taskResult.value.tasks || [];
            }
            if (uploadResult && uploadResult.status === "fulfilled") {
              state.relayUploads = uploadResult.value.uploads || [];
            }
            renderRelayTasks();
            renderRelayUploads();
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
          { label: "配置学期", val: data.semester || "-", icon: "📅", foot: "教务系统学期" },
          { label: "Staging 状态", val: data.latestRelayUpload ? data.latestRelayUpload.status : "等待上传", icon: "📦", foot: "候选数据需审核发布" },
          { label: "接力上传", val: data.latestRelayUpload ? formatDate(data.latestRelayUpload.uploadedAt) : "暂无", icon: "🔁", foot: "最近 relay-agent 上传" },
          { label: "行政班总数", val: (data.counts?.classScheduleCount || 0) + " 个", icon: "🏫", foot: "行政班课表" },
          { label: "课程总数", val: (data.counts?.courseScheduleCount || 0) + " 门", icon: "📚", foot: "资源关联课表" },
          { label: "最后同步时间", val: formatDate(data.classScheduleUpdatedAt), icon: "🕒", foot: "行政班更新" },
        ];
        
        list.forEach(function(item) {
          var card = document.createElement("div");
          card.className = "stat-card card";
          card.innerHTML = "<div class='stat-head'>" + item.label + "<span>" + item.icon + "</span></div>" +
                           "<div class='stat-num' style='font-size:16px;'>" + item.val + "</div>" +
                           "<div class='stat-foot'>" + item.foot + "</div>";
          wrap.appendChild(card);
        });
      }

      function relayStatusText(status) {
        var map = {
          pending: "未开始",
          running: "运行中",
          uploaded: "已上传",
          "pending-review": "待审核",
          staged: "已设为 Staging",
          published: "已发布",
          expired: "已过期",
          revoked: "已吊销"
        };
        return map[status] || status || "-";
      }

      function buildRelayRunCommand(task) {
        return "npm run sync:relay-agent -- --server=" + location.origin + " --token=" + task.relayToken + " --term=" + task.term;
      }

      function renderRelayTasks() {
        var tbody = $("relayTaskTableBody");
        if (!tbody) return;
        var list = state.relayTasks || [];
        tbody.innerHTML = "";
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;color:var(--muted);padding:16px;'>暂无接力任务</td></tr>";
          return;
        }
        list.slice(0, 20).forEach(function(task) {
          var tr = document.createElement("tr");
          var command = buildRelayRunCommand(task);
          tr.innerHTML =
            "<td><strong>" + escapeHtml(task.term) + "</strong><br><span style='color:var(--muted);'>" + escapeHtml(task.description || "") + "</span><br><span style='color:var(--muted);'>有效期：" + formatDate(task.expiresAt) + "</span></td>" +
            "<td><code class='relay-token'>" + escapeHtml(task.relayToken) + "</code><br><code class='relay-token'>" + escapeHtml(command) + "</code></td>" +
            "<td><span class='badge info'>" + relayStatusText(task.status) + "</span><br><span style='color:var(--muted);'>上传 " + (task.uploadCount || 0) + "/" + (task.maxUploads || 1) + "</span></td>" +
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
          var revokeBtn = document.createElement("button");
          revokeBtn.className = "btn danger";
          revokeBtn.style = "padding: 3px 8px; font-size:11px;";
          revokeBtn.textContent = "吊销";
          revokeBtn.disabled = task.status === "revoked" || task.status === "published";
          revokeBtn.addEventListener("click", function() {
            revokeRelayTask(task.id);
          });
          tr.querySelector(".action-cell").appendChild(revokeBtn);
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
          promoteBtn.className = "btn primary";
          promoteBtn.style = "padding: 3px 8px; font-size:11px;";
          promoteBtn.textContent = "设为 Staging";
          promoteBtn.disabled = upload.status === "published";
          promoteBtn.addEventListener("click", function() {
            promoteRelayUpload(upload.id);
          });
          tr.querySelector(".action-cell").appendChild(promoteBtn);
          tbody.appendChild(tr);
        });
      }

      function createRelayTask() {
        var payload = {
          term: value("relayTaskTerm") || value("wizardTerm") || "2026-2027-1",
          description: value("relayTaskDescription") || "全校课表接力采集",
          expiresInHours: parseInt(value("relayTaskExpiresIn") || "24", 10),
          maxUploads: parseInt(value("relayTaskMaxUploads") || "1", 10)
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

      function revokeRelayTask(id) {
        if (!confirm("确定吊销这个接力任务吗？吊销后该 relay token 将无法继续上传。")) return;
        api("/api/admin/relay/tasks/" + encodeURIComponent(id) + "/revoke", {
          method: "POST",
          body: "{}"
        })
          .then(function() {
            showToast("接力任务已吊销", "success");
            return loadSyncStatus();
          })
          .catch(function(error) {
            showToast(error.message, "error");
          });
      }

      function promoteRelayUpload(id) {
        if (!confirm("确定将这次接力上传设为当前 Staging 吗？这不会直接发布到小程序，仍需再执行正式发布。")) return;
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
            showToast(error.message, "error");
          });
      }

      // 生成发布版本号
      function getAutoGeneratedVersion(term) {
        var now = new Date();
        var yyyy = now.getFullYear();
        var mm = String(now.getMonth() + 1).padStart(2, "0");
        var dd = String(now.getDate()).padStart(2, "0");
        var hh = String(now.getHours()).padStart(2, "0");
        var min = String(now.getMinutes()).padStart(2, "0");
        var sec = String(now.getSeconds()).padStart(2, "0");
        
        // 比如 2026-2027-1 -> 202620271
        var termClean = (term || "2026-2027-1").replace(/-/g, "");
        return termClean + "-" + yyyy + mm + dd + "-" + hh + min + sec;
      }

      // 更新向导命令预览与运维卡片列表
      function updateWizardCommand() {
        var term = value("wizardTerm") || "2026-2027-1";
        var startDate = value("wizardStartDate") || "2026-09-01";
        var note = value("wizardNote") || (term + " 新学期全校课表首版");
        var mode = value("wizardMode") || "staging";
        var source = value("wizardSource") || "local-campus";
        
        // 自动计算版本
        var versionInput = $("wizardVersion");
        if (versionInput) {
          if (!versionInput.dataset.modifiedByUser || !versionInput.value) {
            versionInput.value = getAutoGeneratedVersion(term);
          }
        }
        
        var isDryRun = (mode === "dry-run");
        var publish = (mode === "publish");
        
        var query = "?term=" + encodeURIComponent(term) +
                    "&start=" + encodeURIComponent(startDate) +
                    "&note=" + encodeURIComponent(note) +
                    "&dryRun=" + isDryRun +
                    "&publish=" + publish;
                    
        api("/api/admin/sync/command-guide" + query)
          .then(function(res) {
            if (res.success && res.commands) {
              var cmds = res.commands;
              
              var commandIdBySource = {
                "local-campus": "local-campus",
                "relay-agent": "relay-agent",
                "staging-upload": "local-upload",
                "manual-maintain": "local-upload",
                "server-direct": "server-direct"
              };
              var wizardCmd = cmds.find(function(c) { return c.id === commandIdBySource[source]; }) || cmds[0];
              var cmdText = wizardCmd ? wizardCmd.command : "npm run sync:local-campus";
              if ($("wizardCommandCode")) $("wizardCommandCode").textContent = cmdText;
              if ($("wizardCopyBtn")) $("wizardCopyBtn").style.display = "block";
              
              // 2. 渲染动态命令说明卡片列表
              var syncCommandsWrap = $("syncCommands");
              if (syncCommandsWrap) {
                syncCommandsWrap.innerHTML = "";
                
                // 过滤出除了 new-term 以外的前面 5 个命令
                var normalCmds = cmds.filter(function(c) { return c.id !== "new-term"; });
                normalCmds.forEach(function(c) {
                  var riskClass = c.risk.indexOf("低") >= 0 ? "low" : (c.risk.indexOf("中高") >= 0 ? "high" : "medium");
                  var riskBadge = "<span class='command-tag " + riskClass + "'>风险: " + c.risk + "</span>";
                  var intranetBadge = c.intranetRequired ? "<span class='command-tag high'>⚠️ 需校园网</span>" : "<span class='command-tag low'>外网可用</span>";
                  
                  var item = document.createElement("div");
                  item.className = "command-card";
                  item.innerHTML = 
                    "<div class='command-header'>" +
                      "<div class='command-title'>🔧 " + c.name + "</div>" +
                      "<div style='display:flex; gap:6px;'>" + riskBadge + intranetBadge + "</div>" +
                    "</div>" +
                    "<div class='command-code-box'>" +
                      "<code>" + escapeHtml(c.command) + "</code>" +
                      "<button type='button' class='copy-command-btn' data-copy-command='" + escapeHtml(c.command) + "'>复制</button>" +
                    "</div>" +
                    "<div class='command-meta-grid'>" +
                      "<div class='command-meta-item'><strong>适用场景</strong><span>" + c.scene + "</span></div>" +
                      "<div class='command-meta-item'><strong>前置条件</strong><span>" + c.precondition + "</span></div>" +
                      "<div class='command-meta-item'><strong>预计耗时</strong><span>" + c.duration + "</span></div>" +
                      "<div class='command-meta-item'><strong>常见失败原因</strong><span>" + c.failureReason + "</span></div>" +
                    "</div>" +
                    "<div class='command-tip-box'>" +
                      "<strong>💡 修复建议:</strong><span>" + c.solution + "</span>" +
                    "</div>";
                  syncCommandsWrap.appendChild(item);
                });
                syncCommandsWrap.querySelectorAll(".copy-command-btn").forEach(function(btn) {
                  btn.addEventListener("click", function() {
                    copyText(btn.dataset.copyCommand || "");
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
      ["wizardTerm", "wizardStartDate", "wizardNote"].forEach(function(id) {
        safeBind(id, "input", updateWizardCommand);
      });
      ["wizardMode", "wizardSource"].forEach(function(id) {
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
        var tbody = $("releasesTableBody");
        tbody.innerHTML = "";
        
        if (list.length === 0) {
          tbody.innerHTML = "<tr><td colspan='7' style='text-align: center; color: var(--muted); padding: 24px 0;'>暂无历史 Release 数据包。</td></tr>";
          return;
        }
        
        var currentActiveVer = state.syncStatus ? state.syncStatus.releaseVersion : "";
        
        list.forEach(function(r) {
          var tr = document.createElement("tr");
          var isActive = (r.version === currentActiveVer);
          var statusCell = isActive ? "<span class='badge success'>运行中 (Active)</span>" : "<span class='badge muted'>历史版本</span>";
          
          var countText = 
            "行政班: " + (r.counts?.classScheduleCount || 0) + "<br/>" +
            "教师课表: " + (r.counts?.teacherScheduleCount || 0) + "<br/>" +
            "教室课表: " + (r.counts?.classroomScheduleCount || 0) + "<br/>" +
            "课程课表: " + (r.counts?.courseScheduleCount || 0);
            
          var actionBtn = document.createElement("button");
          actionBtn.className = "btn ghost";
          actionBtn.style = "padding: 4px 10px; font-size:12px;";
          if (isActive) {
            actionBtn.textContent = "当前活跃";
            actionBtn.disabled = true;
          } else {
            actionBtn.textContent = "⏪ 一键回滚";
            actionBtn.addEventListener("click", function() {
              rollbackToVersion(r.version);
            });
          }
          
          tr.innerHTML = 
            "<td><strong style='font-family: monospace; font-size:12px; color: var(--primary);'>" + r.version + "</strong></td>" +
            "<td>" + r.semester + "</td>" +
            "<td><span style='font-size:11px;'>" + formatDate(r.updatedAt) + "</span></td>" +
            "<td style='font-size:11px; line-height: 1.4;'>" + countText + "</td>" +
            "<td style='max-width:180px; font-size:12px; white-space:normal;'>" + (r.counts?.releaseNote || "-") + "</td>" +
            "<td>" + statusCell + "</td>" +
            "<td class='action-cell'></td>";
            
          tr.querySelector(".action-cell").appendChild(actionBtn);
          tbody.appendChild(tr);
        });
      }

      // 执行回滚
      function rollbackToVersion(version) {
        if (!confirm("🚨 警告：确定要将线上全校课表一键回滚到快照 [" + version + "] 吗？\\n该操作会立即覆盖小程序端当前的可见数据，并自动创建当前版本的备份！")) {
          return;
        }
        
        setStatus("正在将快照版本回滚为 " + version + "...");
        api("/api/admin/sync/releases/rollback", {
          method: "POST",
          body: JSON.stringify({ version: version })
        })
          .then(function(res) {
            showToast("回滚成功！系统已被重置为历史版本: " + version, "success");
            loadSyncStatus();
          })
          .catch(function(err) {
            showToast(err.message, "error");
            loadSyncStatus();
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

      function handleStagingFile(file) {
        if (!file) return;
        
        var uploadInfo = $("uploadFileInfo");
        uploadInfo.innerHTML = "正在解析并读取: <strong>" + escapeHtml(file.name) + "</strong>...";
        
        var reader = new FileReader();
        reader.onload = function(e) {
          var text = e.target.result;
          try {
            var parsed = JSON.parse(text);
            // 简单校验格式，是否存在基本元数据或资源
            if (!parsed.term) {
              uploadInfo.innerHTML = "<span style='color: var(--danger);'>❌ 错误: JSON 缺少 term (学期) 字段，不符合 Staging 标准格式。</span>";
              return;
            }
            
            uploadInfo.innerHTML = "正在校验并上传至服务器 Staging 区...";
            
            api("/api/admin/sync/staging/upload", {
              method: "POST",
              body: text
            })
              .then(function(res) {
                uploadInfo.innerHTML = "<span style='color: var(--success);'>✓ " + escapeHtml(res.message || "上传校验暂存成功！") + "</span>";
                showToast("Staging JSON 上传并校验成功，请查看下方比对详情并确认发布");
                loadStagingPreview();
              })
              .catch(function(err) {
                uploadInfo.innerHTML = "<span style='color: var(--danger);'>❌ 上传失败: " + escapeHtml(err.message) + "</span>";
                showToast(err.message, "error");
              });
          } catch (err) {
            uploadInfo.innerHTML = "<span style='color: var(--danger);'>❌ 错误: 文件不是合法的 JSON 格式。(" + escapeHtml(err.message) + ")</span>";
            showToast("JSON 格式错误: " + err.message, "error");
          }
        };
        reader.onerror = function() {
          uploadInfo.innerHTML = "<span style='color: var(--danger);'>❌ 错误: 文件读取失败。</span>";
          showToast("文件读取失败", "error");
        };
        reader.readAsText(file);
      }

      safeBind("syncFileInput", "change", function(e) {
        var file = e.target.files[0];
        handleStagingFile(file);
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
            handleStagingFile(file);
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
              
              // 1. 元数据
              var timeStr = d.generatedAt ? formatDate(d.generatedAt) : "未知";
              $("stagingMetaBadge").textContent = "学期: " + d.term + " | 版本: " + d.releaseVersion + " | 生成时间: " + timeStr;
              
              // 2. 填充数值
              $("stagingValClass").textContent = d.counts.classScheduleCount;
              $("stagingValTeacher").textContent = d.counts.teacherScheduleCount;
              $("stagingValClassroom").textContent = d.counts.classroomScheduleCount;
              $("stagingValCourse").textContent = d.counts.courseScheduleCount;
              
              $("stagingValRoomCount").textContent = d.counts.classroomCount;
              $("stagingValTeacherCount").textContent = d.counts.teacherCount;
              $("stagingValCourseCount").textContent = d.counts.courseCount;
              
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
                  html += "<strong style='color:var(--danger);'>❌ 删除了以下行政班 (" + d.diff.deletedCount + " 个)：</strong>";
                  html += "<div>" + d.diff.deletedClasses.map(function(c) { return "<span>" + escapeHtml(c) + "</span>"; }).join("") + "</div>";
                }
                if (d.diff.addedCount > 0) {
                  html += "<strong style='color:var(--success);'>➕ 新增了以下行政班 (" + d.diff.addedCount + " 个)：</strong>";
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
              if (warnBox && warnList) {
                var warnings = [];
                
                // 新生班少判定：行政班课表相比之前减少 50%
                var activeClassCount = d.counts.classScheduleCount - d.diff.classDelta;
                if (activeClassCount > 20 && d.counts.classScheduleCount < activeClassCount * 0.5) {
                  warnings.push("警告: 行政班课表总数 (" + d.counts.classScheduleCount + "个) 相比当前线上版本 (" + activeClassCount + "个) 减少超过 50%，可能导致大范围课表缺失！");
                }
                
                if (res.warnings && res.warnings.length > 0) {
                  warnings = warnings.concat(res.warnings);
                }
                
                if (warnings.length > 0) {
                  warnBox.style.display = "flex";
                  warnList.innerHTML = warnings.map(function(w) { return "<div>• " + escapeHtml(w) + "</div>"; }).join("");
                } else {
                  warnBox.style.display = "none";
                }
              }
              
              // 6. 熔断触发逻辑
              var forceBox = $("forceConfirmContainer");
              var forceCheckbox = $("stagingForceConfirm");
              if (forceBox) {
                if (d.diff.isBigChange) {
                  forceBox.style.display = "block";
                  if (forceCheckbox) forceCheckbox.checked = false;
                  showToast("⚠️ 上传的数据变动率达 " + d.diff.changeRate + "%，已触发安全熔断，发布需要勾选下方二次确认！", "warning");
                } else {
                  forceBox.style.display = "none";
                }
              }
              
              // 启用发布按钮
              var publishBtn = $("stagingPublishBtn");
              if (publishBtn) {
                publishBtn.disabled = false;
              }
            }
          })
          .catch(function(err) {
            showToast("拉取 Staging 预览详情失败: " + err.message, "error");
          });
      }

      function publishStaging() {
        var forceConfirm = $("stagingForceConfirm");
        var force = forceConfirm ? forceConfirm.checked : false;
        
        setStatus("正在正式发布课表快照版本...");
        var publishBtn = $("stagingPublishBtn");
        if (publishBtn) publishBtn.disabled = true;
        
        api("/api/admin/sync/staging/publish", {
          method: "POST",
          body: JSON.stringify({ force: force })
        })
          .then(function(res) {
            showToast("发布成功！线上课表数据已更新。", "success");
            // 隐藏 Staging 预览，清空文件信息
            $("stagingPreviewBox").style.display = "none";
            $("uploadFileInfo").textContent = "";
            $("syncFileInput").value = "";
            if (forceConfirm) forceConfirm.checked = false;
            $("forceConfirmContainer").style.display = "none";
            // 重新载入状态
            loadSyncStatus();
          })
          .catch(function(err) {
            if (publishBtn) publishBtn.disabled = false;
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
            throw err;
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
            escapeHtml(title + " · " + content) + "</span></span></span>" +
            "<span class='mini-ticker-action'>查看</span>";
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

      function getInitialSection() {
        if (location.pathname.indexOf("/feedback") >= 0) return "feedback";
        return "dashboard";
      }

      function loadAll(targetSection) {
        try {
          var section = typeof targetSection === "string" ? targetSection : (state.section || getInitialSection());
          switchSection(section);
          setStatus("正在获取佛课后台全局配置...");

          return Promise.allSettled([
            loadDashboard(),
            loadConfig(),
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

      // 绑定导航与事件
      document.querySelectorAll(".sidebar nav ul li[data-section]").forEach(function (item) {
        item.addEventListener("click", function () {
          switchSection(item.dataset.section);
          closeMobileDrawer();
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
      safeBind("saveConfigButton", "click", saveConfig);
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
          document.querySelectorAll("#catalogTabs button").forEach(function(b) { b.classList.remove("active"); });
          btn.classList.add("active");
          state.catalogType = btn.dataset.type;
          state.catalogPage = 1;
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
      safeBind("sidebarOverlay", "click", function() {
        closeMobileDrawer();
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
                targetTerm: (state.dashboard && state.dashboard.currentSemester) || "2025-2026-2"
              })
            })
            .then(function(res) {
              var resultDiv = $("xlsTestResult");
              if (res.success) {
                $("xlsTestInfo").innerHTML = "✔ 解析成功！文件名：" + escapeHtml(res.filename);
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
                $("xlsTestInfo").textContent = "✘ 解析失败";
                resultDiv.style.display = "block";
                resultDiv.style.borderColor = "var(--danger)";
                resultDiv.innerHTML = "<span style='color: var(--danger); font-weight:700;'>解析错误信息：</span><br/>" + escapeHtml(res.message || "未知错误");
              }
            })
            .catch(function(err) {
              $("xlsTestInfo").textContent = "✘ 上传失败";
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
        state.section = getInitialSection();
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

      function initSyncModule() {
        updateWizardCommand();
      }

      function initFeedbackModule() {
        if (location.pathname.indexOf("/feedback") >= 0) {
          state.section = "feedback";
        }
      }

      function initSettingsModule() {
        return true;
      }

      function bootAdminConsole() {
        if (window.__adminConsoleBooted) {
          return;
        }

        try {
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
              return loadAll(getInitialSection());
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
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data: https://pan.katelya.eu.org; base-uri 'self'; form-action 'self'"
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
