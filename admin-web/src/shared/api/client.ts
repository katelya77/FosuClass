/**
 * Admin API client — same backend as legacy /admin, cookie + CSRF.
 */
export type ApiError = Error & {
  status?: number
  code?: string
  payload?: unknown
}

let csrfToken = ''
let onUnauthorized: ((message: string) => void) | null = null

export function setCsrfToken(token: string) {
  csrfToken = token || ''
}

export function getCsrfToken() {
  return csrfToken
}

/** Register once from app bootstrap to clear auth + redirect on 401. */
export function setUnauthorizedHandler(handler: ((message: string) => void) | null) {
  onUnauthorized = handler
}

export type RequestOptions = RequestInit & {
  dedupe?: boolean
}

export type DownloadFormat = 'blob' | 'arrayBuffer' | 'text' | 'response'

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

function withAuthHeaders(headers: Headers, method: string) {
  if (!headers.has('X-Fosu-Admin-Client')) {
    headers.set('X-Fosu-Admin-Client', 'next')
  }
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('X-Fosu-CSRF')) {
    headers.set('X-Fosu-CSRF', csrfToken)
  }
}

let unauthorizedDispatching = false

function notifyUnauthorized(message: string) {
  if (!onUnauthorized || unauthorizedDispatching) return
  unauthorizedDispatching = true
  try {
    onUnauthorized(message)
  } finally {
    // Allow later 401s (e.g. after re-login) to notify again.
    queueMicrotask(() => {
      unauthorizedDispatching = false
    })
  }
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  if (
    !headers.has('Content-Type') &&
    options.body &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob)
  ) {
    headers.set('Content-Type', 'application/json')
  }
  withAuthHeaders(headers, method)

  const key = `${method} ${path}`
  if (method === 'GET' && options.dedupe !== false && inflight.has(key)) {
    return inflight.get(key) as Promise<T>
  }

  const request = fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'include',
  })
    .then(async (res) => {
      const text = await res.text()
      let data: unknown = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { success: false, message: text || res.statusText }
      }

      if (res.status === 401) {
        const message =
          (data as { message?: string })?.message || '后台登录已过期，请重新登录'
        notifyUnauthorized(message)
        throw buildError(message, 401, data)
      }

      if (!res.ok || (data as { success?: boolean })?.success === false) {
        throw buildError(
          (data as { message?: string })?.message || `HTTP ${res.status}`,
          res.status,
          data,
        )
      }

      return data as T
    })
    .finally(() => {
      inflight.delete(key)
    })

  if (method === 'GET' && options.dedupe !== false) {
    inflight.set(key, request)
  }

  return request
}

/**
 * Download binary/text payloads without JSON parsing.
 * Prefer this over a fake `raw` flag on `api()`.
 */
export async function download(
  path: string,
  options: RequestInit & { format?: DownloadFormat } = {},
): Promise<Blob | ArrayBuffer | string | Response> {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  withAuthHeaders(headers, method)
  const format = options.format || 'blob'
  const res = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: 'include',
  })
  if (res.status === 401) {
    const message = '后台登录已过期，请重新登录'
    notifyUnauthorized(message)
    throw buildError(message, 401)
  }
  if (!res.ok) {
    throw buildError(`HTTP ${res.status}`, res.status)
  }
  if (format === 'response') return res
  if (format === 'arrayBuffer') return res.arrayBuffer()
  if (format === 'text') return res.text()
  return res.blob()
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
  }>('/api/admin/session', { dedupe: false }).catch((err: ApiError) => {
    if (err && err.status === 401) throw err
    return null
  })

  if (!data) return { authenticated: false, csrfToken: '' }
  const token = data.csrfToken || data.data?.csrfToken || ''
  if (token) setCsrfToken(token)
  const authenticated = Boolean(data.authenticated ?? data.data?.authenticated ?? false)
  return { authenticated, csrfToken: token, raw: data }
}

export async function logout() {
  try {
    await api('/api/admin/logout', { method: 'POST', body: '{}' })
  } finally {
    setCsrfToken('')
  }
}
