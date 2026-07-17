<script setup lang="ts">
defineProps<{ open: boolean; title?: string; side?: 'right' | 'left' }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <aside class="drawer" :class="side || 'right'" role="dialog" aria-modal="true">
        <header class="head">
          <h2>{{ title }}</h2>
          <button type="button" class="close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(12, 14, 18, 0.4);
}
.drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: min(420px, 92vw);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
}
.drawer.right {
  right: 0;
  border-right: 0;
}
.drawer.left {
  left: 0;
  border-left: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.head h2 {
  margin: 0;
  font-size: 1rem;
}
.close {
  border: 0;
  background: transparent;
  font-size: 1.4rem;
  cursor: pointer;
  color: var(--text-secondary);
}
.body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
</style>
