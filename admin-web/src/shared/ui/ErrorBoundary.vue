<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import AppButton from './AppButton.vue'

const error = ref<Error | null>(null)
const emit = defineEmits<{ error: [Error] }>()

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err))
  emit('error', error.value)
  return false
})

function reset() {
  error.value = null
}
</script>

<template>
  <div v-if="error" class="boundary" role="alert">
    <h3>此模块暂时无法显示</h3>
    <p>{{ error.message }}</p>
    <p class="hint">其他后台功能不受影响。可重试或使用旧版后台。</p>
    <div class="actions">
      <AppButton variant="primary" @click="reset">重试</AppButton>
      <a class="legacy" href="/admin/">打开旧版后台</a>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.boundary {
  border: 1px solid var(--danger);
  background: var(--danger-soft);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 20px;
}
h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}
p {
  margin: 0 0 8px;
  color: var(--text-secondary);
}
.hint {
  font-size: 0.85rem;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}
.legacy {
  font-size: 0.9rem;
}
</style>
