<script setup lang="ts">
defineProps<{ label?: string; inline?: boolean }>()
</script>

<template>
  <div class="loading" :class="{ inline }" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true" />
    <span>{{ label || '加载中…' }}</span>
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  color: var(--text-secondary);
}
.loading.inline {
  padding: 8px 0;
  justify-content: flex-start;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--cobalt);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
