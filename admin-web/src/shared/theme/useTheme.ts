import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'fosu-admin-theme'
const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system')
const resolved = ref<'light' | 'dark'>('light')

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(next: ThemeMode) {
  const effective = next === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : next
  resolved.value = effective
  document.documentElement.setAttribute('data-theme', effective)
}

export function useTheme() {
  function setTheme(next: ThemeMode) {
    mode.value = next
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
  }

  function cycleTheme() {
    const order: ThemeMode[] = ['light', 'dark', 'system']
    const idx = order.indexOf(mode.value)
    setTheme(order[(idx + 1) % order.length])
  }

  if (typeof window !== 'undefined') {
    applyTheme(mode.value)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (mode.value === 'system') applyTheme('system')
    })
  }

  watch(mode, (v) => applyTheme(v))

  return { mode, resolved, setTheme, cycleTheme }
}
