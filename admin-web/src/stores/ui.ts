import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  message: string
  kind: ToastKind
}

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(false)
  const toasts = ref<ToastItem[]>([])
  const globalLoading = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toast(message: string, kind: ToastKind = 'info', ttlMs = 3200) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    toasts.value.push({ id, message, kind })
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ttlMs)
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { sidebarCollapsed, toasts, globalLoading, toggleSidebar, toast, dismissToast }
})
