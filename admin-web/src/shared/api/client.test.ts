import { describe, expect, it, vi } from 'vitest'
import { download, getCsrfToken, setCsrfToken } from './client'

describe('api client', () => {
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
    vi.unstubAllGlobals()
  })
})
