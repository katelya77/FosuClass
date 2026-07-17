<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    block?: boolean
  }>(),
  { variant: 'secondary', type: 'button', disabled: false, loading: false, block: false },
)
</script>

<template>
  <button
    class="btn"
    :class="[variant, { block, loading }]"
    :type="type"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  border-color: var(--cobalt);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn.block {
  width: 100%;
}
.btn.primary {
  background: var(--cobalt);
  border-color: var(--cobalt);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--cobalt-hover);
  border-color: var(--cobalt-hover);
}
.btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.btn.ghost {
  background: transparent;
  border-color: transparent;
}
.btn.ghost:hover:not(:disabled) {
  background: var(--bg-muted);
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
