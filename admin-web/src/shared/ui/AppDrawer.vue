<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    side?: 'right' | 'left'
    titleId?: string
  }>(),
  { side: 'right', titleId: 'admin-drawer-title' },
)
const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
const closeBtnRef = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !panelRef.value) return
  const focusable = panelRef.value.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  )
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
      await nextTick()
      closeBtnRef.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
      previousFocus?.focus?.()
      previousFocus = null
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <aside
        ref="panelRef"
        class="drawer"
        :class="side"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="head">
          <h2 :id="titleId">{{ title }}</h2>
          <button
            ref="closeBtnRef"
            type="button"
            class="close"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
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
