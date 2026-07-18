import { api, createIdempotencyKey, download } from '@/shared/api/client'

export const CATALOG_TYPES = ['class', 'teacher', 'classroom', 'course', 'major'] as const
export type CatalogType = (typeof CATALOG_TYPES)[number]

export type CatalogSource = {
  kind: string
  published: boolean
  label?: string
  type?: CatalogType
  generationId?: string
  semesters?: string[]
}

export type CatalogRow = { id: string } & Record<string, unknown>

export type CatalogList = {
  success: boolean
  items: CatalogRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  source: CatalogSource
  generationId: string
}

export type CatalogRelationshipMajor = { id: string; name: string }
export type CatalogRelationshipGrade = { grade: string; majors: CatalogRelationshipMajor[] }
export type CatalogRelationshipCollege = { id: string; name: string; grades: CatalogRelationshipGrade[] }
export type CatalogRelationships = {
  success: boolean
  colleges: CatalogRelationshipCollege[]
  source: CatalogSource
  relationshipVersion: string
  generationId: string
}

export type CatalogImportDocument = {
  type: CatalogType
  semester: string
  items: Array<Record<string, unknown>>
}

export type CatalogDiff = {
  added: CatalogRow[]
  updated: Array<{ before: CatalogRow; after: CatalogRow }>
  unchanged: CatalogRow[]
  deleted: CatalogRow[]
}

export type CatalogImportPreview = {
  success: boolean
  previewId: string
  operationId: string
  baseVersion: string
  sourceFingerprint?: string
  generationId: string
  relationshipVersion: string
  summary: { added: number; updated: number; unchanged: number; deleted: number }
  changes: CatalogDiff
  warnings: Array<{ code: string; message?: string }>
  expiresAt: string
  source?: CatalogSource
}

export type CatalogImportResult = {
  success: boolean
  committed: boolean
  auditPending?: boolean
  operationId: string
  version: string
  generationId: string
  summary?: CatalogImportPreview['summary']
  changes?: CatalogDiff
  warnings?: Array<{ code: string; message?: string }>
}

export type CatalogIndexRebuildResult = {
  generationId: string
  relationshipVersion?: string
  builtAt?: string
  counts?: Record<string, number>
}

export type CatalogIndexRebuildJob = {
  id: string
  type: 'catalog-index-rebuild'
  status: 'queued' | 'running' | 'success' | 'failed' | string
  progress?: number
  message?: string
  error?: string | { code?: string; message?: string }
  result?: CatalogIndexRebuildResult
  createdAt?: string
  updatedAt?: string
}

export type CatalogMetaDocument = {
  success: boolean
  version: string
  etag?: string
  updatedAt?: string | null
  entries: Record<string, Record<string, unknown>>
}

export type CatalogMetaPatch = {
  type: CatalogType
  id: string
  displayName: string
  note: string
  hidden: boolean
  tags: string[]
}

export async function listCatalogResources(query: {
  type: CatalogType
  page?: number
  pageSize?: number
  keyword?: string
  semester?: string
}) {
  const params = new URLSearchParams({
    type: query.type,
    page: String(query.page || 1),
    pageSize: String(query.pageSize || 30),
  })
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim())
  if (query.semester?.trim()) params.set('semester', query.semester.trim())
  return api<CatalogList>(`/api/admin/catalog/resources?${params.toString()}`)
}

export function getCatalogStats() {
  return api<{ success: boolean; data: Record<string, string | number | null> }>('/api/admin/catalog/stats')
}

export function getCatalogRelationships() {
  return api<CatalogRelationships>('/api/admin/catalog/relationships')
}

export function getCatalogMeta() {
  return api<CatalogMetaDocument>('/api/admin/catalog/meta', { dedupe: false })
}

export function saveCatalogMeta(
  patch: CatalogMetaPatch,
  version: string,
  idempotencyKey = createIdempotencyKey('catalog-meta'),
) {
  return api<{ success: boolean; version: string; etag?: string; metaInfo: Record<string, unknown>; auditPending?: boolean }>(
    '/api/admin/catalog/meta',
    {
      method: 'POST',
      headers: version ? { 'If-Match': version } : undefined,
      body: JSON.stringify({ ...patch, expectedVersion: version }),
      idempotencyKey,
    },
  )
}

export async function exportCatalog(query: {
  type: CatalogType
  format: 'json' | 'csv'
  semester?: string
  keyword?: string
}) {
  const params = new URLSearchParams({ type: query.type, format: query.format })
  if (query.semester?.trim()) params.set('semester', query.semester.trim())
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim())
  const response = (await download(`/api/admin/catalog/export?${params.toString()}`, {
    format: 'response',
  })) as Response
  const disposition = response.headers.get('content-disposition') || ''
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || `catalog-${query.type}.${query.format}`,
    generationId: response.headers.get('x-fosu-catalog-generation') || '',
  }
}

export function previewCatalogImport(
  document: CatalogImportDocument,
  idempotencyKey = createIdempotencyKey('catalog-import-preview'),
) {
  return api<CatalogImportPreview>('/api/admin/catalog/import/preview', {
    method: 'POST',
    body: JSON.stringify(document),
    idempotencyKey,
  })
}

export function applyCatalogImport(
  preview: Pick<CatalogImportPreview, 'previewId' | 'baseVersion'>,
  idempotencyKey = createIdempotencyKey(`catalog-import-${preview.previewId}`),
) {
  return api<CatalogImportResult>('/api/admin/catalog/import/apply', {
    method: 'POST',
    headers: { 'If-Match': preview.baseVersion },
    body: JSON.stringify({ previewId: preview.previewId, confirm: true }),
    idempotencyKey,
  })
}

export async function startCatalogIndexRebuild(
  input: { generationId: string; reason: 'operator' },
  idempotencyKey = createIdempotencyKey('catalog-index-rebuild'),
) {
  const response = await api<{ success: boolean; job: CatalogIndexRebuildJob }>(
    '/api/admin/catalog/indexes/rebuild/start',
    {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    },
  )
  return response.job
}

export async function getCatalogIndexRebuild(id: string) {
  const response = await api<{ success: boolean; job: CatalogIndexRebuildJob }>(
    `/api/admin/catalog/indexes/rebuild/${encodeURIComponent(id)}`,
    { dedupe: false },
  )
  return response.job
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
