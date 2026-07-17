import { api, download } from '@/shared/api/client'

export type BackupItem = {
  filename: string
  type?: string
  size?: string
  sizeBytes?: number
  createdAt?: string
  kind?: string
  restorable?: boolean
  downloadPath?: string
}

export type RestorePreflight = {
  ok: boolean
  filename: string
  type?: string
  blockers?: string[]
  warnings?: string[]
  restorable?: boolean
  targetPath?: string | null
  impact?: { affectsMiniprogram?: boolean; rollback?: string }
  itemCount?: number | null
}

export async function listBackups() {
  const data = await api<{ success: boolean; items?: BackupItem[] }>('/api/admin/backups')
  return data.items || []
}

export async function listSnapshots() {
  const data = await api<{ success: boolean; items?: BackupItem[] }>('/api/admin/snapshots')
  return data.items || []
}

export async function downloadBackup(filename: string) {
  const blob = (await download(
    `/api/admin/backups/download?filename=${encodeURIComponent(filename)}`,
    { format: 'blob' },
  )) as Blob
  return blob
}

export async function deleteBackup(filename: string) {
  return api<{ success: boolean }>('/api/admin/backups', {
    method: 'DELETE',
    body: JSON.stringify({ filename, confirm: filename }),
  })
}

export async function preflightRestore(filename: string) {
  const data = await api<{ success: boolean; preflight: RestorePreflight }>('/api/admin/backups/preflight', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  })
  return data.preflight
}

export async function restoreBackup(
  filename: string,
  options: { dryRun?: boolean; confirm?: string; idempotencyKey?: string } = {},
) {
  return api<{ success: boolean; restored?: boolean; dryRun?: boolean; preflight?: RestorePreflight }>(
    '/api/admin/backups/restore',
    {
      method: 'POST',
      body: JSON.stringify({
        filename,
        dryRun: options.dryRun === true,
        confirm: options.confirm || filename,
        idempotencyKey: options.idempotencyKey || `restore-${filename}-${Date.now()}`,
      }),
    },
  )
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
