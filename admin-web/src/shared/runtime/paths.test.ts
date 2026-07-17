import { describe, expect, it } from 'vitest'
import { getAdminRuntimePaths, legacyAdminUrl, spaPath } from './paths'

describe('getAdminRuntimePaths', () => {
  it('resolves admin-next mount to legacy /admin/', () => {
    const paths = getAdminRuntimePaths('/admin-next/dashboard')
    expect(paths.spaBase).toBe('/admin-next/')
    expect(paths.legacyBase).toBe('/admin/')
    expect(paths.assetBase).toBe('/admin-app/')
    expect(paths.mount).toBe('next')
  })

  it('resolves primary /admin mount to legacy /admin-legacy/', () => {
    const paths = getAdminRuntimePaths('/admin/dashboard')
    expect(paths.spaBase).toBe('/admin/')
    expect(paths.legacyBase).toBe('/admin-legacy/')
    expect(paths.assetBase).toBe('/admin-app/')
    expect(paths.mount).toBe('primary')
  })

  it('builds legacy hash links for both modes', () => {
    expect(legacyAdminUrl('sync', '/admin-next/sync')).toBe('/admin/#sync')
    expect(legacyAdminUrl('sync', '/admin/sync')).toBe('/admin-legacy/#sync')
    expect(legacyAdminUrl('terms', '/admin-next/terms')).toBe('/admin/#terms')
    expect(legacyAdminUrl('settings', '/admin/settings')).toBe('/admin-legacy/#settings')
  })

  it('builds spa paths with runtime base', () => {
    expect(spaPath('dashboard', '/admin-next/x')).toBe('/admin-next/dashboard')
    expect(spaPath('/sync', '/admin/x')).toBe('/admin/sync')
  })
})
