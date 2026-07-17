<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/shared/theme/useTheme'
import AppButton from '@/shared/ui/AppButton.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ui = useUiStore()
const { mode, cycleTheme } = useTheme()

async function onLogout() {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <header class="header">
    <div class="left">
      <button type="button" class="icon-btn" aria-label="切换侧栏" @click="ui.toggleSidebar">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
        </svg>
      </button>
      <div class="titles">
        <h1>{{ route.meta.title || '运营台' }}</h1>
        <p v-if="route.meta.subtitle">{{ route.meta.subtitle }}</p>
      </div>
    </div>
    <div class="right">
      <AppButton variant="ghost" @click="cycleTheme">主题 · {{ mode }}</AppButton>
      <AppButton variant="secondary" @click="onLogout">退出</AppButton>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: var(--header-height);
  min-height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  position: sticky;
  top: 0;
  z-index: 20;
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text-secondary);
}
.titles h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.2;
}
.titles p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
@media (max-width: 640px) {
  .titles p {
    display: none;
  }
}
</style>
