import { api, createIdempotencyKey } from '@/shared/api/client'

export type SettingFieldType = 'string' | 'boolean' | 'enum'
export type SettingScope = 'app' | 'term' | 'import' | 'data'

export type SettingField = {
  key: string
  type: SettingFieldType
  label: string
  description?: string
  currentValue: unknown
  default?: unknown
  enumValues?: string[]
  requiresRestart?: boolean
  sensitive?: boolean
  scope: SettingScope
  maxLength?: number
}

export type SettingsDocument = {
  success: boolean
  version: string
  etag?: string
  updatedAt?: string | null
  groups?: Partial<Record<SettingScope, SettingField[]>>
  fields: SettingField[]
  rawSafe?: Record<string, unknown>
}

export type SettingChange = {
  key: string
  label: string
  from: unknown
  to: unknown
  requiresRestart?: boolean
}

export type SettingsPreview = {
  success: boolean
  version: string
  changes: SettingChange[]
}

export type SettingsSaveResult = {
  success: boolean
  version: string
  etag?: string
  settings?: SettingsDocument
  auditPending?: boolean
  warnings?: Array<{ code: string; message?: string }>
}

export function getSettings() {
  return api<SettingsDocument>('/api/admin/settings', { dedupe: false })
}

export function previewSettings(
  patch: Record<string, unknown>,
  idempotencyKey = createIdempotencyKey('settings-preview'),
) {
  return api<SettingsPreview>('/api/admin/settings/preview', {
    method: 'POST',
    body: JSON.stringify(patch),
    idempotencyKey,
  })
}

export function saveSettings(
  patch: Record<string, unknown>,
  version: string,
  idempotencyKey = createIdempotencyKey('settings-save'),
) {
  return api<SettingsSaveResult>('/api/admin/settings', {
    method: 'POST',
    headers: version ? { 'If-Match': version } : undefined,
    body: JSON.stringify({ ...patch, expectedVersion: version }),
    idempotencyKey,
  })
}
