/**
 * Admin API client — same backend as legacy /admin, cookie + CSRF.
 */
export type ApiError = Error & {
  status?: number
  code?: string
  payload?: unknown
}

let csrfToken = ''

export function setCsrfToken(token: string) {
  csrfToken = token || ''
}

export function getCsrfToken() {
  return csrfToken
}

export type RequestOptions = RequestInit & {
  dedupe?: boolean
  raw?: boolean
}

const inflight = new Map<string, Promise<unknown>>()

function buildError(message: string, status?: number, payload?: unknown): ApiError {
  const err = new Error(message) as ApiError
  err.status = status
  err.payload = payload
  if (payload && typeof payload === 'object' && payload !== null && 'code' in payload) {
    err.code = String((payload as { code?: string }).code || '')
  }
  return err
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
    headers.set('Content-Type', 'application/json')
  }
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('X-Fosu-CSRF')) {
    headers.set('X-Fosu-CSRF', csrfToken)
  }

  const key = `${method} ${path}`
  if (method === 'GET' && options.dedupe !== false && inflight.has(key)) {
    return inflight.get(key) as Promise<T>
  }

  const request = fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'include',
  }).then(async (res) => {
    const text = await res.text()
    let data: unknown = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { success: false, message: text || res.statusText }
    }

    if (res.status === 401) {
      throw buildError(
        (data as { message?: string })?.message || '后台登录已过期，请重新登录',
        401,
        data,
      )
    }

    if (!res.ok || (data as { success?: boolean })?.success === false) {
      throw buildError(
        (data as { message?: string })?.message || `HTTP ${res.status}`,
        res.status,
        data,
      )
    }

    return data as T
  }).finally(() => {
    inflight.delete(key)
  })

  if (method === 'GET' && options.dedupe !== false) {
    inflight.set(key, request)
  }

  return request
}

export async function login(password: string) {
  const data = await api<{ success: boolean; csrfToken?: string; data?: { csrfToken?: string } }>(
    '/api/admin/login',
    {
      method: 'POST',
      body: JSON.stringify({ password }),
      dedupe: false,
    },
  )
  const token = data.csrfToken || data.data?.csrfToken || ''
  setCsrfToken(token)
  return data
}

export async function fetchSession() {
  const data = await api<{
    success: boolean
    csrfToken?: string
    authenticated?: boolean
    data?: { csrfToken?: string; authenticated?: boolean }
  }>('/api/admin/session', { dedupe: false }).catch(() => null)

  if (!data) return { authenticated: false, csrfToken: '' }
  const token = data.csrfToken || data.data?.csrfToken || ''
  if (token) setCsrfToken(token)
  const authenticated = Boolean(
    data.authenticated ?? data.data?.authenticated ?? token,
  )
  return { authenticated, csrfToken: token, raw: data }
}

export async function logout() {
  try {
    await api('/api/admin/logout', { method: 'POST', body: '{}' })
  } finally {
    setCsrfToken('')
  }
}
