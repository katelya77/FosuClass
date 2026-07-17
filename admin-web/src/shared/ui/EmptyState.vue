<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <div class="empty" role="status">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    </div>
    <h3>{{ title || '暂无内容' }}</h3>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.action" class="action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}
.icon {
  color: var(--text-muted);
}
h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text);
}
p {
  margin: 0;
  max-width: 36ch;
  font-size: 0.9rem;
}
.action {
  margin-top: 8px;
}
</style>
