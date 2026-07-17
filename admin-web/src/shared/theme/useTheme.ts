import { ref, watch, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'fosu-admin-theme'

const mode: Ref<ThemeMode> = ref<ThemeMode>('system')
const resolved: Ref<'light' | 'dark'> = ref('light')

let initialized = false
let mediaListenerAttached = false
let stopWatch: (() => void) | null = null

function canUseDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStoredMode(): ThemeMode {
  if (!canUseDom()) return 'system'
  try {
    const value = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // ignore
  }
  return 'system'
}

function systemPrefersDark() {
  if (!canUseDom() || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(next: ThemeMode) {
  const effective = next === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : next
  resolved.value = effective
  if (canUseDom()) {
    document.documentElement.setAttribute('data-theme', effective)
  }
}

function ensureInitialized() {
  if (initialized) return
  initialized = true
  mode.value = readStoredMode()
  applyTheme(mode.value)

  if (canUseDom() && !mediaListenerAttached && window.matchMedia) {
    mediaListenerAttached = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (mode.value === 'system') applyTheme('system')
    })
  }

  if (!stopWatch) {
    stopWatch = watch(mode, (v) => applyTheme(v))
  }
}

export function useTheme() {
  ensureInitialized()

  function setTheme(next: ThemeMode) {
    mode.value = next
    if (canUseDom()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
    }
    applyTheme(next)
  }

  function cycleTheme() {
    const order: ThemeMode[] = ['light', 'dark', 'system']
    const idx = order.indexOf(mode.value)
    setTheme(order[(idx + 1) % order.length])
  }

  return { mode, resolved, setTheme, cycleTheme }
}

/** Test helper: reset singleton state between unit tests */
export function __resetThemeForTests() {
  initialized = false
  mediaListenerAttached = false
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  mode.value = 'system'
  resolved.value = 'light'
}
