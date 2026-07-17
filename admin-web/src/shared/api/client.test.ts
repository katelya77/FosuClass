import { describe, expect, it } from 'vitest'
import { getCsrfToken, setCsrfToken } from './client'

describe('api client csrf', () => {
  it('stores csrf token', () => {
    setCsrfToken('nonce.sig')
    expect(getCsrfToken()).toBe('nonce.sig')
    setCsrfToken('')
    expect(getCsrfToken()).toBe('')
  })
})
