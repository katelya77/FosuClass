import { api, createIdempotencyKey } from '@/shared/api/client'

export type QualitySeverity = 'danger' | 'warning' | 'info' | 'critical' | 'high' | 'medium' | 'low'

export type QualityFinding = {
  type: string
  target: string
  fingerprint: string
  severity: QualitySeverity | string
  original?: string
  message?: string
  suggestion?: string
  status?: 'ignored'
  reason?: string
  ignoredAt?: string | null
  createdAt?: string | null
  ruleId?: string | null
}

export type QualityReport = {
  active: QualityFinding[]
  ignored: QualityFinding[]
  summary: Record<string, number> & {
    activeCount: number
    ignoredCount: number
    totalCount: number
  }
  generatedAt: string
}

export type QualityIgnoreDocument = {
  success: boolean
  version: string
  updatedAt: string | null
  rules: Array<Record<string, unknown>>
}

export type QualityJob = {
  id: string
  type: 'quality-recheck'
  status: 'queued' | 'running' | 'success' | 'failed' | string
  progress?: number
  message?: string
  error?: string
  result?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export async function getQualityReport() {
  const response = await api<{ success: boolean; data: QualityReport }>('/api/admin/quality/report')
  return response.data
}

export function getQualityIgnores() {
  return api<QualityIgnoreDocument>('/api/admin/quality/ignores')
}

function findingParts(finding: QualityFinding) {
  if (finding.type && finding.target) return { type: finding.type, target: finding.target }
  const divider = finding.fingerprint.indexOf('::')
  return divider < 0
    ? { type: 'general', target: finding.fingerprint }
    : { type: finding.fingerprint.slice(0, divider), target: finding.fingerprint.slice(divider + 2) }
}

export function setQualityIgnore(
  finding: QualityFinding,
  options: { ignore: boolean; reason: string; version: string; idempotencyKey?: string },
) {
  const parts = findingParts(finding)
  return api<{
    success: boolean
    version: string
    etag?: string
    ignores: Array<Record<string, unknown>>
    auditPending?: boolean
    warnings?: Array<{ code: string; message?: string }>
  }>('/api/admin/quality/mark', {
    method: 'POST',
    headers: options.version ? { 'If-Match': options.version } : undefined,
    body: JSON.stringify({
      ...parts,
      ignore: options.ignore,
      reason: options.reason,
      expectedVersion: options.version,
      severity: finding.severity,
    }),
    idempotencyKey:
      options.idempotencyKey ||
      createIdempotencyKey(`quality-${options.ignore ? 'ignore' : 'restore'}`),
  })
}

export async function startQualityRecheck(
  input: Record<string, unknown> = {},
  idempotencyKey = createIdempotencyKey('quality-recheck'),
) {
  const response = await api<{ success: boolean; job: QualityJob }>('/api/admin/quality/recheck/start', {
    method: 'POST',
    body: JSON.stringify(input),
    idempotencyKey,
  })
  return response.job
}

export async function getQualityRecheck(id: string) {
  const response = await api<{ success: boolean; job: QualityJob }>(
    `/api/admin/quality/recheck/${encodeURIComponent(id)}`,
    { dedupe: false },
  )
  return response.job
}
