# ADR-0002: Vue 3 + Vite + TypeScript Admin SPA

## Status

Superseded

Decision: Legacy-only admin retained

## Context

`adminPages.js` 约 17k 行内联 HTML/CSS/JS，难维护、难测、难做现代 UI/UX。

## Decision

新建 `admin-web/`：Vue 3 + Vite + TypeScript + Vue Router + Pinia（仅跨页状态）。  
构建输出到 `server/public/admin-app/`。迁移期 `/admin-next/*`，完成后 `/admin/*`，旧版 `/admin-legacy/*`。

## Consequences

- 组件化、主题、深链与测试可行
- 需维护双后台一段时间
- 不使用 SSR、不使用 iframe 包裹旧后台

## Superseding outcome

独立 Vue SPA 已停止维护。`/admin/*` 永远使用 Legacy 后台；`/admin-next/*` 与 `/admin-legacy/*` 仅保留到对应 `/admin/*` 的兼容重定向。共享 API、Repository、Service、安全与并发控制继续保留。
