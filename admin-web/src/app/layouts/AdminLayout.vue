<script setup lang="ts">
import AppSidebar from '@/app/components/AppSidebar.vue'
import AppHeader from '@/app/components/AppHeader.vue'
import ErrorBoundary from '@/shared/ui/ErrorBoundary.vue'
import ToastHost from '@/shared/ui/ToastHost.vue'
</script>

<template>
  <div class="shell">
    <AppSidebar />
    <div class="main">
      <AppHeader />
      <main class="content">
        <ErrorBoundary>
          <RouterView v-slot="{ Component }">
            <component :is="Component" />
          </RouterView>
        </ErrorBoundary>
      </main>
    </div>
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--bg);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  padding: 18px 20px 32px;
  max-width: 1400px;
  width: 100%;
}
@media (max-width: 640px) {
  .content {
    padding: 14px 12px 28px;
  }
}
</style>
