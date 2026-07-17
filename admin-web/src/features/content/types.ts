export type NoticeItem = {
  id: string
  title: string
  content?: string
  type?: string
  priority?: string
  displayMode?: string
  targetPage?: string
  startAt?: string
  endAt?: string
  enabled?: boolean
  closable?: boolean
  version?: string
  createdAt?: string
  updatedAt?: string
  status?: string
}

export type NewsItem = {
  id: string
  title: string
  summary?: string
  detail?: string
  tag?: string
  link?: string
  date?: string
  enabled?: boolean
  version?: string
  createdAt?: string
  updatedAt?: string
}

export const NOTICE_TYPES = ['info', 'warning', 'success', 'update', 'maintenance'] as const
export const NOTICE_PRIORITIES = ['normal', 'important', 'urgent'] as const
export const NOTICE_DISPLAY_MODES = ['banner', 'modal', 'ticker', 'card'] as const
export const NOTICE_TARGET_PAGES = ['all', 'home', 'today', 'school', 'settings'] as const
