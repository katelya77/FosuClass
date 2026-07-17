<script setup lang="ts">
defineProps<{
  label: string
  forId?: string
  hint?: string
  error?: string
  required?: boolean
}>()
</script>

<template>
  <div class="field" :class="{ invalid: Boolean(error) }">
    <label v-if="label" :for="forId">
      {{ label }}
      <span v-if="required" class="req">*</span>
    </label>
    <div class="control">
      <slot />
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}
label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-secondary);
}
.req {
  color: var(--danger);
  margin-left: 2px;
}
.control :deep(input),
.control :deep(select),
.control :deep(textarea) {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
}
.control :deep(textarea) {
  min-height: 96px;
  resize: vertical;
}
.invalid .control :deep(input),
.invalid .control :deep(select),
.invalid .control :deep(textarea) {
  border-color: var(--danger);
}
.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--danger);
}
</style>
