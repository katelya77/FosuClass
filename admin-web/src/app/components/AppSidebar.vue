<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { GROUP_LABELS, NAV_ITEMS, type NavItem } from '@/app/navigation'
import { useUiStore } from '@/stores/ui'
import AppLogo from './AppLogo.vue'

const route = useRoute()
const ui = useUiStore()

const groups = computed(() => {
  const map = new Map<NavItem['group'], NavItem[]>()
  for (const item of NAV_ITEMS) {
    const list = map.get(item.group) || []
    list.push(item)
    map.set(item.group, list)
  }
  return [...map.entries()]
})

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed }">
    <div class="brand">
      <AppLogo :size="ui.sidebarCollapsed ? 28 : 34" />
      <div v-if="!ui.sidebarCollapsed" class="brand-text">
        <strong>佛课小表</strong>
        <span>校园数据运营台</span>
      </div>
    </div>

    <nav>
      <section v-for="[group, items] in groups" :key="group">
        <p v-if="!ui.sidebarCollapsed" class="group">{{ GROUP_LABELS[group] }}</p>
        <RouterLink
          v-for="item in items"
          :key="item.id"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
          :title="item.label"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path :d="item.icon" fill="currentColor" />
          </svg>
          <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
        </RouterLink>
      </section>
    </nav>

    <div class="footer">
      <a class="legacy" href="/admin/" title="打开旧版后台">旧版后台</a>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: sticky;
  top: 0;
  transition: width 0.18s ease;
}
.sidebar.collapsed {
  width: 72px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 14px;
  border-bottom: 1px solid var(--border);
  min-height: var(--header-height);
}
.brand-text {
  display: grid;
  line-height: 1.2;
}
.brand-text strong {
  font-size: 0.95rem;
}
.brand-text span {
  font-size: 0.72rem;
  color: var(--text-muted);
}
nav {
  flex: 1;
  overflow: auto;
  padding: 10px 8px 16px;
}
.group {
  margin: 12px 10px 6px;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  margin-bottom: 2px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-item:hover {
  background: var(--bg-muted);
  color: var(--text);
  text-decoration: none;
}
.nav-item.active {
  background: var(--cobalt-soft);
  color: var(--cobalt);
  font-weight: 600;
}
.footer {
  padding: 12px;
  border-top: 1px solid var(--border);
}
.legacy {
  font-size: 0.82rem;
  color: var(--text-muted);
}
.collapsed .nav-item {
  justify-content: center;
}
.collapsed .footer {
  text-align: center;
}
@media (max-width: 900px) {
  .sidebar:not(.collapsed) {
    position: fixed;
    z-index: 40;
    box-shadow: var(--shadow-md);
  }
}
</style>
