import { api } from '@/shared/api/client'

export type AuditItem = {
  time?: string
  operator?: string
  authMethod?: string
  action?: string
  module?: string
  summary?: string
  target?: string
  scopes?: string[]
  [key: string]: unknown
}

export async function listAuditLogs() {
  const data = await api<{ success: boolean; items?: AuditItem[] }>('/api/admin/audit-logs')
  return data.items || []
}
