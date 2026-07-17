import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './navigation'

describe('navigation', () => {
  it('has core ops items without emoji labels', () => {
    expect(NAV_ITEMS.some((i) => i.id === 'dashboard')).toBe(true)
    expect(NAV_ITEMS.some((i) => i.id === 'sync')).toBe(true)
    for (const item of NAV_ITEMS) {
      expect(item.label).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
      expect(item.icon.length).toBeGreaterThan(10)
    }
  })
})
