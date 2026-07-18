import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyCatalogImport,
  exportCatalog,
  getCatalogMeta,
  getCatalogIndexRebuild,
  listCatalogResources,
  previewCatalogImport,
  saveCatalogMeta,
  startCatalogIndexRebuild,
} from '@/features/catalog/api'
import {
  getQualityReport,
  setQualityIgnore,
  startQualityRecheck,
} from '@/features/quality/api'
import {
  getSettings,
  previewSettings,
  saveSettings,
} from '@/features/settings/api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('C1 typed API contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the generation-backed Catalog list contract with exact pagination', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        items: [{ id: 'class:2026:01:2024:0809:1', className: '软件工程 1 班' }],
        total: 31,
        page: 2,
        pageSize: 30,
        totalPages: 2,
        source: { kind: 'catalog-staging', published: false },
        generationId: 'catgen-2',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listCatalogResources({ type: 'class', page: 2, pageSize: 30, keyword: '软件' })

    expect(result.totalPages).toBe(2)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/catalog/resources?type=class&page=2&pageSize=30&keyword=%E8%BD%AF%E4%BB%B6',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('previews and applies Catalog imports with If-Match, literal confirmation and reusable idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url.endsWith('/preview')) {
          return jsonResponse({
            success: true,
            previewId: 'preview-1',
            operationId: 'catop-1',
            baseVersion: 'cat_v1',
            generationId: 'catgen-1',
            relationshipVersion: 'rel-1',
            summary: { added: 1, updated: 0, unchanged: 0, deleted: 0 },
            changes: { added: [{ id: 'major:2026:01:2024:0809' }], updated: [], unchanged: [], deleted: [] },
            warnings: [],
            expiresAt: '2026-07-19T12:10:00.000Z',
          })
        }
        return jsonResponse({
          success: true,
          committed: true,
          auditPending: true,
          operationId: 'catop-1',
          version: 'cat_v2',
          generationId: 'catgen-2',
          warnings: [{ code: 'CATALOG_AUDIT_PENDING' }],
        })
      }),
    )
    const document = {
      type: 'major' as const,
      semester: '2025-2026-2',
      items: [{ collegeCode: '01', grade: '2024', majorCode: '0809', majorName: '计算机科学' }],
    }

    const preview = await previewCatalogImport(document, '00000000-0000-4000-8000-000000000001')
    const applied = await applyCatalogImport(preview, '00000000-0000-4000-8000-000000000002')

    expect(applied.auditPending).toBe(true)
    expect(calls.map((call) => call.url)).toEqual([
      '/api/admin/catalog/import/preview',
      '/api/admin/catalog/import/apply',
    ])
    const previewHeaders = new Headers(calls[0]?.init?.headers)
    const applyHeaders = new Headers(calls[1]?.init?.headers)
    expect(previewHeaders.get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000001')
    expect(applyHeaders.get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000002')
    expect(applyHeaders.get('If-Match')).toBe('cat_v1')
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ previewId: 'preview-1', confirm: true })
  })

  it('downloads Catalog exports from the real binary route', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('[{"id":"teacher:2026:张老师"}]\n', {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="catalog-teacher.json"',
          'x-fosu-catalog-generation': 'catgen-3',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const exported = await exportCatalog({ type: 'teacher', format: 'json' })

    expect(exported.filename).toBe('catalog-teacher.json')
    expect(exported.generationId).toBe('catgen-3')
    expect(await exported.blob.text()).toContain('teacher:2026')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/catalog/export?type=teacher&format=json',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('starts and polls the generation-scoped Catalog index rebuild job', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url.endsWith('/start')) {
          return jsonResponse({ success: true, job: { id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: 'queued', progress: 0 } }, 202)
        }
        return jsonResponse({ success: true, job: {
          id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: 'success', progress: 100,
          result: { generationId: 'catgen-1', relationshipVersion: 'rel-2', builtAt: '2026-07-19T12:00:00.000Z', counts: { majors: 12 } },
        } })
      }),
    )

    const job = await startCatalogIndexRebuild(
      { generationId: 'catgen-1', reason: 'operator' },
      '00000000-0000-4000-8000-000000000008',
    )
    const completed = await getCatalogIndexRebuild(job.id)

    expect(completed.result?.relationshipVersion).toBe('rel-2')
    expect(calls.map((call) => call.url)).toEqual([
      '/api/admin/catalog/indexes/rebuild/start',
      '/api/admin/catalog/indexes/rebuild/catalog-index-job-1',
    ])
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ generationId: 'catgen-1', reason: 'operator' })
    expect(new Headers(calls[0]?.init?.headers).get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000008')
  })

  it('updates Catalog metadata with an optimistic version and stable operation key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        if (!init?.method || init.method === 'GET') {
          return jsonResponse({ success: true, version: 'catmeta_v1', entries: {} })
        }
        return jsonResponse({ success: true, version: 'catmeta_v2', metaInfo: { displayName: '软工一班' } })
      }),
    )

    const meta = await getCatalogMeta()
    await saveCatalogMeta(
      { type: 'class', id: 'class:1', displayName: '软工一班', note: '', hidden: false, tags: ['重点'] },
      meta.version,
      '00000000-0000-4000-8000-000000000003',
    )

    expect(calls.map((call) => call.url)).toEqual(['/api/admin/catalog/meta', '/api/admin/catalog/meta'])
    expect(new Headers(calls[1]?.init?.headers).get('If-Match')).toBe('catmeta_v1')
    expect(new Headers(calls[1]?.init?.headers).get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000003')
  })

  it('keeps active and ignored Quality findings distinct and sends reasoned restore writes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url.endsWith('/report')) {
          return jsonResponse({
            success: true,
            data: {
              active: [{ type: 'missing-room', target: '课程 A', fingerprint: 'missing-room::课程 A', severity: 'warning' }],
              ignored: [{ type: 'missing-room', target: '课程 B', fingerprint: 'missing-room::课程 B', severity: 'warning', status: 'ignored', reason: '场地待定' }],
              summary: { activeCount: 1, ignoredCount: 1, totalCount: 2 },
              generatedAt: '2026-07-19T12:00:00.000Z',
            },
          })
        }
        return jsonResponse({ success: true, version: 'qi_v2', ignores: [] })
      }),
    )

    const report = await getQualityReport()
    await setQualityIgnore(report.ignored[0]!, {
      ignore: false,
      reason: '恢复检查',
      version: 'qi_v1',
      idempotencyKey: '00000000-0000-4000-8000-000000000004',
    })

    expect(report.active).toHaveLength(1)
    expect(report.ignored[0]?.reason).toBe('场地待定')
    const write = calls[1]!
    expect(write.url).toBe('/api/admin/quality/mark')
    expect(new Headers(write.init?.headers).get('If-Match')).toBe('qi_v1')
    expect(new Headers(write.init?.headers).get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000004')
    expect(JSON.parse(String(write.init?.body))).toMatchObject({
      type: 'missing-room',
      target: '课程 B',
      ignore: false,
      reason: '恢复检查',
      expectedVersion: 'qi_v1',
    })
  })

  it('starts asynchronous Quality rechecks with a stable operation key', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ success: true, job: { id: 'quality-job-1', type: 'quality-recheck', status: 'queued', progress: 0 } }, 202),
    )
    vi.stubGlobal('fetch', fetchMock)

    const job = await startQualityRecheck({ reason: 'operator' }, '00000000-0000-4000-8000-000000000005')

    expect(job.id).toBe('quality-job-1')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000005')
  })

  it('uses typed Settings preview/save contracts and preserves optimistic concurrency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if ((init?.method || 'GET') === 'GET') {
          return jsonResponse({
            success: true,
            version: 'cfg_v1',
            fields: [{ key: 'publishStatus', type: 'enum', label: '发布状态', scope: 'app', currentValue: 'online', enumValues: ['online', 'maintenance', 'offline'] }],
          })
        }
        if (url.endsWith('/preview')) {
          return jsonResponse({ success: true, version: 'cfg_v1', changes: [{ key: 'publishStatus', label: '发布状态', from: 'online', to: 'maintenance', requiresRestart: false }] })
        }
        return jsonResponse({ success: true, version: 'cfg_v2', settings: { version: 'cfg_v2', fields: [] } })
      }),
    )

    const settings = await getSettings()
    const preview = await previewSettings({ publishStatus: 'maintenance' }, '00000000-0000-4000-8000-000000000006')
    const saved = await saveSettings({ publishStatus: 'maintenance' }, settings.version, '00000000-0000-4000-8000-000000000007')

    expect(preview.changes).toHaveLength(1)
    expect(saved.version).toBe('cfg_v2')
    expect(calls.map((call) => call.url)).toEqual([
      '/api/admin/settings',
      '/api/admin/settings/preview',
      '/api/admin/settings',
    ])
    expect(new Headers(calls[1]?.init?.headers).get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000006')
    expect(new Headers(calls[2]?.init?.headers).get('If-Match')).toBe('cfg_v1')
    expect(new Headers(calls[2]?.init?.headers).get('Idempotency-Key')).toBe('00000000-0000-4000-8000-000000000007')
  })
})
