import { api } from './client'

export type WriteModules = Record<string, boolean>

export type Capabilities = {
  success: boolean
  primary: 'legacy' | 'next'
  legacyEnabled: boolean
  nextEnabled: boolean
  writeModules: WriteModules
  writeModuleList: string[]
  paths: { next: string; legacy: string }
}

let cached: Capabilities | null = null
let inflight: Promise<Capabilities> | null = null

export async function fetchCapabilities(force = false): Promise<Capabilities> {
  if (!force && cached) return cached
  if (!force && inflight) return inflight
  inflight = api<Capabilities>('/api/admin/capabilities', { dedupe: false })
    .then((data) => {
      cached = data
      return data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function canWriteModule(module: string, caps?: Capabilities | null): boolean {
  const map = caps?.writeModules || cached?.writeModules
  if (!map) return false
  return Boolean(map[module])
}

export function clearCapabilitiesCache() {
  cached = null
}
