import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
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
})
