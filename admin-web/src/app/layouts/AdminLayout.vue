<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '@/app/components/AppSidebar.vue'
import AppHeader from '@/app/components/AppHeader.vue'
import ErrorBoundary from '@/shared/ui/ErrorBoundary.vue'
import ToastHost from '@/shared/ui/ToastHost.vue'

const mobileNavOpen = ref(false)
const route = useRoute()

function openMobileNav() {
  mobileNavOpen.value = true
}
function closeMobileNav() {
  mobileNavOpen.value = false
}

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false
  },
)
</script>

<template>
  <div class="shell">
    <AppSidebar :mobile-open="mobileNavOpen" @close-mobile="closeMobileNav" />
    <div class="main-column" :inert="mobileNavOpen || undefined">
      <AppHeader @open-mobile-nav="openMobileNav" />
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
.main-column {
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
