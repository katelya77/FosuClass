import { api } from '@/shared/api/client'
import type { NewsItem, NoticeItem } from './types'

type ListResponse<T> = { success: boolean; items?: T[] }

export async function listNotices() {
  const data = await api<ListResponse<NoticeItem>>('/api/admin/notices')
  return data.items || []
}

export async function createNotice(body: Partial<NoticeItem>) {
  return api<{ success: boolean; item: NoticeItem }>('/api/admin/notices', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateNotice(id: string, body: Partial<NoticeItem>, expectedVersion?: string) {
  const payload = { ...body, expectedVersion: expectedVersion || body.version }
  return api<{ success: boolean; item: NoticeItem }>(`/api/admin/notices/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: expectedVersion ? { 'If-Match': expectedVersion } : undefined,
    body: JSON.stringify(payload),
  })
}

export async function deleteNotice(id: string) {
  return api<{ success: boolean }>(`/api/admin/notices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function listNews() {
  const data = await api<ListResponse<NewsItem>>('/api/admin/news')
  return data.items || []
}

export async function createNews(body: Partial<NewsItem>) {
  return api<{ success: boolean; item: NewsItem }>('/api/admin/news', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateNews(id: string, body: Partial<NewsItem>, expectedVersion?: string) {
  const payload = { ...body, expectedVersion: expectedVersion || body.version }
  return api<{ success: boolean; item: NewsItem }>(`/api/admin/news/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: expectedVersion ? { 'If-Match': expectedVersion } : undefined,
    body: JSON.stringify(payload),
  })
}

export async function deleteNews(id: string) {
  return api<{ success: boolean }>(`/api/admin/news/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
