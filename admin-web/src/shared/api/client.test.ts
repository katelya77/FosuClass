import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  api,
  createIdempotencyKey,
  download,
  getCsrfToken,
  setCsrfToken,
  setUnauthorizedHandler,
} from './client'

describe('api client', () => {
  beforeEach(() => {
    setUnauthorizedHandler(null)
    setCsrfToken('')
    vi.unstubAllGlobals()
  })

  it('stores csrf token', () => {
    setCsrfToken('nonce.sig')
    expect(getCsrfToken()).toBe('nonce.sig')
    setCsrfToken('')
    expect(getCsrfToken()).toBe('')
  })

  it('generates wire-compatible UUID idempotency keys for C1 journals', () => {
    const key = createIdempotencyKey('settings-save')
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(key).not.toContain('settings-save')
  })

  it('download supports blob format', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(blob, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    )
    const result = await download('/api/admin/backups/download?filename=x.json', { format: 'blob' })
    expect(result).toBeInstanceOf(Blob)
  })

  it('download 401 invokes unauthorized handler once', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, message: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(download('/api/admin/backups/download?filename=x.json')).rejects.toMatchObject({
      status: 401,
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(String(handler.mock.calls[0][0])).toMatch(/登录|过期/)
  })

  it('adds a reusable idempotency key to every non-GET request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const idempotencyKey = createIdempotencyKey('settings-save')
    await api('/api/admin/settings', { method: 'POST', body: '{}', idempotencyKey })
    await api('/api/admin/settings', { method: 'POST', body: '{}', idempotencyKey })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers)
      expect(headers.get('Idempotency-Key')).toBe(idempotencyKey)
    }
  })

  it('generates distinct idempotency keys when callers do not provide one', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api('/api/admin/settings/preview', { method: 'POST', body: '{}' })
    await api('/api/admin/settings/preview', { method: 'POST', body: '{}' })

    const first = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')
    const second = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('returns committed responses even when durable audit completion is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: true, committed: true, auditPending: true, operationId: 'op-1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    await expect(api('/api/admin/catalog/import/apply', { method: 'POST', body: '{}' })).resolves.toMatchObject({
      committed: true,
      auditPending: true,
      operationId: 'op-1',
    })
  })
})
