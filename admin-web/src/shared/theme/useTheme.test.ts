import { describe, expect, it, beforeEach } from 'vitest'
import { __resetThemeForTests, useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    __resetThemeForTests()
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('fosu-admin-theme')
    }
  })

  it('defaults to system and can set light/dark', () => {
    const a = useTheme()
    expect(a.mode.value).toBe('system')
    a.setTheme('dark')
    expect(a.mode.value).toBe('dark')
    expect(a.resolved.value).toBe('dark')
    a.setTheme('light')
    expect(a.resolved.value).toBe('light')
  })

  it('is a singleton: second call does not re-register watch thrice', () => {
    const a = useTheme()
    const b = useTheme()
    a.setTheme('dark')
    expect(b.mode.value).toBe('dark')
    b.cycleTheme()
    expect(a.mode.value).toBe('system')
  })

  it('reads stored preference only after init', () => {
    localStorage.setItem('fosu-admin-theme', 'dark')
    __resetThemeForTests()
    const t = useTheme()
    expect(t.mode.value).toBe('dark')
  })
})
