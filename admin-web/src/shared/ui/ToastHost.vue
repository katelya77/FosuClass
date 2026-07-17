<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="toasts" aria-live="polite" aria-relevant="additions">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind" role="status">
      <span>{{ t.message }}</span>
      <button type="button" aria-label="关闭" @click="ui.dismissToast(t.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 100;
  display: grid;
  gap: 8px;
  width: min(360px, calc(100vw - 32px));
}
.toast {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  font-size: 0.92rem;
}
.toast.success {
  border-color: var(--success);
  background: var(--success-soft);
}
.toast.warning {
  border-color: var(--warning);
  background: var(--warning-soft);
}
.toast.error {
  border-color: var(--danger);
  background: var(--danger-soft);
}
.toast.info {
  border-color: var(--info);
  background: var(--info-soft);
}
button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
}
</style>
