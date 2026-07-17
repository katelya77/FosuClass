/**
 * Runtime path resolution for dual-mount admin SPA.
 *
 * Mount modes:
 * - /admin-next/*  → migration shell (primary usually still legacy)
 * - /admin/*       → primary SPA when FOSU_ADMIN_PRIMARY=next
 *
 * Assets always live under /admin-app/ (static hosting).
 */

export interface AdminRuntimePaths {
  spaBase: string
  legacyBase: string
  assetBase: string
  mount: 'next' | 'primary'
}

function normalizePathname(pathname: string): string {
  if (!pathname) return '/'
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`
  return withSlash.replace(/\/{2,}/g, '/')
}

/**
 * Derive SPA/legacy bases from the current browser location (or a test pathname).
 */
export function getAdminRuntimePaths(pathname?: string): AdminRuntimePaths {
  const path =
    pathname ??
    (typeof window !== 'undefined' && window.location ? window.location.pathname : '/admin-next/')
  const p = normalizePathname(path)

  const onNext = p === '/admin-next' || p.startsWith('/admin-next/')
  if (onNext) {
    return {
      spaBase: '/admin-next/',
      legacyBase: '/admin/',
      assetBase: '/admin-app/',
      mount: 'next',
    }
  }

  // SPA running as primary under /admin/*
  return {
    spaBase: '/admin/',
    legacyBase: '/admin-legacy/',
    assetBase: '/admin-app/',
    mount: 'primary',
  }
}

/** Absolute URL within the SPA (router-base aware). */
export function spaPath(path: string, pathname?: string): string {
  const { spaBase } = getAdminRuntimePaths(pathname)
  const clean = String(path || '').replace(/^\//, '')
  return `${spaBase}${clean}`
}

/**
 * Build legacy admin console URL for the current mount mode.
 * @param hashSection hash without leading #, e.g. "sync" | "terms" | "settings"
 */
export function legacyAdminUrl(hashSection = '', pathname?: string): string {
  const { legacyBase } = getAdminRuntimePaths(pathname)
  const base = legacyBase.endsWith('/') ? legacyBase : `${legacyBase}/`
  const section = String(hashSection || '').replace(/^#/, '').trim()
  if (!section) return base
  return `${base}#${section}`
}

export function legacyAdminRoot(pathname?: string): string {
  return legacyAdminUrl('', pathname)
}
