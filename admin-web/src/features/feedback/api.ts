import { api, download } from '@/shared/api/client'

export type FeedbackItem = {
  id: string
  status?: string
  type?: string
  category?: string
  content?: string
  adminNote?: string
  note?: string
  createdAt?: string
  updatedAt?: string
  semester?: string
  page?: string
  [key: string]: unknown
}

export type FeedbackListResult = {
  items: FeedbackItem[]
  stats?: Record<string, number>
  types?: string[]
  total?: number
}

export async function listFeedbacks(query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v))
  })
  const qs = params.toString()
  const data = await api<{
    success: boolean
    items?: FeedbackItem[]
    stats?: Record<string, number>
    types?: string[]
    total?: number
  }>(`/api/admin/feedbacks${qs ? `?${qs}` : ''}`)
  return {
    items: data.items || [],
    stats: data.stats,
    types: data.types,
    total: data.total,
  } satisfies FeedbackListResult
}

export async function updateFeedback(id: string, body: { status?: string; adminNote?: string; note?: string }) {
  return api<{ success: boolean; item: FeedbackItem }>(`/api/admin/feedbacks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function exportFeedbackCsv(query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v))
  })
  const qs = params.toString()
  const blob = (await download(`/api/admin/feedback/export.csv${qs ? `?${qs}` : ''}`, {
    format: 'blob',
  })) as Blob
  return blob
}
