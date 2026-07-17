<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createNews,
  createNotice,
  deleteNews,
  deleteNotice,
  listNews,
  listNotices,
  updateNews,
  updateNotice,
} from '@/features/content/api'
import {
  NOTICE_DISPLAY_MODES,
  NOTICE_PRIORITIES,
  NOTICE_TARGET_PAGES,
  NOTICE_TYPES,
  type NewsItem,
  type NoticeItem,
} from '@/features/content/types'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import type { ApiError } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const tab = ref<'notices' | 'news'>('notices')
const notices = ref<NoticeItem[]>([])
const news = ref<NewsItem[]>([])
const writeEnabled = ref(false)

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorKind = ref<'notice' | 'news'>('notice')
const formError = ref('')
const confirmDeleteOpen = ref(false)
const deleteTarget = ref<{ kind: 'notice' | 'news'; id: string; title: string } | null>(null)

const noticeForm = reactive({
  id: '',
  title: '',
  content: '',
  type: 'info',
  priority: 'normal',
  displayMode: 'banner',
  targetPage: 'all',
  startAt: '',
  endAt: '',
  enabled: true,
  closable: true,
  version: '',
})

const newsForm = reactive({
  id: '',
  title: '',
  summary: '',
  detail: '',
  tag: '',
  link: '',
  date: '',
  enabled: true,
  version: '',
})

const noticeColumns = [
  { key: 'title', label: '标题' },
  { key: 'priority', label: '优先级' },
  { key: 'enabled', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
  { key: 'actions', label: '操作', width: '180px' },
]

const newsColumns = [
  { key: 'title', label: '标题' },
  { key: 'tag', label: '标签' },
  { key: 'enabled', label: '状态' },
  { key: 'date', label: '日期' },
  { key: 'actions', label: '操作', width: '180px' },
]

const previewText = computed(() => {
  if (editorKind.value === 'notice') {
    return `${noticeForm.title || '（无标题）'}\n\n${noticeForm.content || ''}`
  }
  return `${newsForm.title || '（无标题）'}\n\n${newsForm.summary || ''}\n\n${newsForm.detail || ''}`
})

function resetNoticeForm() {
  Object.assign(noticeForm, {
    id: '',
    title: '',
    content: '',
    type: 'info',
    priority: 'normal',
    displayMode: 'banner',
    targetPage: 'all',
    startAt: '',
    endAt: '',
    enabled: true,
    closable: true,
    version: '',
  })
}

function resetNewsForm() {
  Object.assign(newsForm, {
    id: '',
    title: '',
    summary: '',
    detail: '',
    tag: '',
    link: '',
    date: '',
    enabled: true,
    version: '',
  })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await fetchCapabilities()
    writeEnabled.value = canWriteModule('content', caps)
    const [n, w] = await Promise.all([listNotices(), listNews()])
    notices.value = n
    news.value = w
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

function openCreate(kind: 'notice' | 'news') {
  if (!writeEnabled.value) {
    ui.toast('内容写模块未启用', 'error')
    return
  }
  editorKind.value = kind
  editorMode.value = 'create'
  formError.value = ''
  if (kind === 'notice') resetNoticeForm()
  else resetNewsForm()
  editorOpen.value = true
}

function openEditNotice(row: NoticeItem) {
  if (!writeEnabled.value) return
  editorKind.value = 'notice'
  editorMode.value = 'edit'
  formError.value = ''
  Object.assign(noticeForm, {
    id: row.id,
    title: row.title || '',
    content: row.content || '',
    type: row.type || 'info',
    priority: row.priority || 'normal',
    displayMode: row.displayMode || 'banner',
    targetPage: row.targetPage || 'all',
    startAt: row.startAt ? String(row.startAt).slice(0, 16) : '',
    endAt: row.endAt ? String(row.endAt).slice(0, 16) : '',
    enabled: row.enabled !== false,
    closable: row.closable !== false,
    version: row.version || '',
  })
  editorOpen.value = true
}

function openEditNews(row: NewsItem) {
  if (!writeEnabled.value) return
  editorKind.value = 'news'
  editorMode.value = 'edit'
  formError.value = ''
  Object.assign(newsForm, {
    id: row.id,
    title: row.title || '',
    summary: row.summary || '',
    detail: row.detail || '',
    tag: row.tag || '',
    link: row.link || '',
    date: row.date ? String(row.date).slice(0, 16) : '',
    enabled: row.enabled !== false,
    version: row.version || '',
  })
  editorOpen.value = true
}

function validate(): string | null {
  if (editorKind.value === 'notice') {
    if (!noticeForm.title.trim()) return '标题必填'
    if (noticeForm.title.length > 120) return '标题过长'
    if ((noticeForm.content || '').length > 3000) return '正文过长'
  } else {
    if (!newsForm.title.trim()) return '标题必填'
  }
  return null
}

async function save() {
  const v = validate()
  if (v) {
    formError.value = v
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editorKind.value === 'notice') {
      const body = {
        title: noticeForm.title.trim(),
        content: noticeForm.content,
        type: noticeForm.type,
        priority: noticeForm.priority,
        displayMode: noticeForm.displayMode,
        targetPage: noticeForm.targetPage,
        startAt: noticeForm.startAt || undefined,
        endAt: noticeForm.endAt || undefined,
        enabled: noticeForm.enabled,
        closable: noticeForm.closable,
      }
      if (editorMode.value === 'create') {
        await createNotice(body)
        ui.toast('公告已创建', 'success')
      } else {
        await updateNotice(noticeForm.id, body, noticeForm.version || undefined)
        ui.toast('公告已更新', 'success')
      }
    } else {
      const body = {
        title: newsForm.title.trim(),
        summary: newsForm.summary,
        detail: newsForm.detail,
        tag: newsForm.tag,
        link: newsForm.link,
        date: newsForm.date || undefined,
        enabled: newsForm.enabled,
      }
      if (editorMode.value === 'create') {
        await createNews(body)
        ui.toast('动态已创建', 'success')
      } else {
        await updateNews(newsForm.id, body, newsForm.version || undefined)
        ui.toast('动态已更新', 'success')
      }
    }
    editorOpen.value = false
    await load()
  } catch (e) {
    const err = e as ApiError
    if (err.status === 409) {
      formError.value = '保存冲突：数据已被他人修改，请关闭后重新加载再试'
    } else {
      formError.value = err.message || '保存失败'
    }
    ui.toast(formError.value, 'error')
  } finally {
    saving.value = false
  }
}

function askDelete(kind: 'notice' | 'news', id: string, title: string) {
  if (!writeEnabled.value) return
  deleteTarget.value = { kind, id, title }
  confirmDeleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  saving.value = true
  try {
    if (deleteTarget.value.kind === 'notice') {
      await deleteNotice(deleteTarget.value.id)
    } else {
      await deleteNews(deleteTarget.value.id)
    }
    ui.toast('已删除', 'success')
    confirmDeleteOpen.value = false
    deleteTarget.value = null
    await load()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '删除失败', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleNoticeEnabled(row: NoticeItem) {
  if (!writeEnabled.value) return
  saving.value = true
  try {
    await updateNotice(
      row.id,
      { ...row, enabled: !row.enabled },
      row.version,
    )
    ui.toast(row.enabled ? '已停用' : '已启用', 'success')
    await load()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '更新失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>内容运营</h2>
        <p>公告与最新动态：列表、编辑、启停、定时窗口、删除、预览与冲突检测。</p>
      </div>
      <div class="actions">
        <AppButton variant="secondary" :loading="loading" @click="load">刷新</AppButton>
        <AppButton
          v-if="writeEnabled"
          variant="primary"
          @click="openCreate(tab === 'notices' ? 'notice' : 'news')"
        >
          新建{{ tab === 'notices' ? '公告' : '动态' }}
        </AppButton>
      </div>
    </div>

    <p v-if="!writeEnabled" class="hint-banner">内容写模块未启用（检查 FOSU_ADMIN_NEXT_WRITE_MODULES）。当前只读。</p>

    <div class="tabs" role="tablist">
      <button type="button" :class="{ active: tab === 'notices' }" role="tab" @click="tab = 'notices'">公告</button>
      <button type="button" :class="{ active: tab === 'news' }" role="tab" @click="tab = 'news'">最新动态</button>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else-if="tab === 'notices'">
      <AppTable :columns="noticeColumns" :rows="notices as any" empty-text="暂无公告">
        <template #cell-enabled="{ value }">
          <span :class="value === false ? 'badge off' : 'badge on'">{{ value === false ? '停用' : '启用' }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="row-actions">
            <AppButton variant="ghost" @click="openEditNotice(row as NoticeItem)">编辑</AppButton>
            <AppButton variant="ghost" :disabled="!writeEnabled || saving" @click="toggleNoticeEnabled(row as NoticeItem)">
              {{ (row as NoticeItem).enabled === false ? '启用' : '停用' }}
            </AppButton>
            <AppButton
              variant="ghost"
              :disabled="!writeEnabled"
              @click="askDelete('notice', String((row as NoticeItem).id), String((row as NoticeItem).title || ''))"
            >
              删除
            </AppButton>
          </div>
        </template>
      </AppTable>
    </template>

    <template v-else>
      <AppTable :columns="newsColumns" :rows="news as any" empty-text="暂无动态">
        <template #cell-enabled="{ value }">
          <span :class="value === false ? 'badge off' : 'badge on'">{{ value === false ? '停用' : '启用' }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="row-actions">
            <AppButton variant="ghost" @click="openEditNews(row as NewsItem)">编辑</AppButton>
            <AppButton
              variant="ghost"
              :disabled="!writeEnabled"
              @click="askDelete('news', String((row as NewsItem).id), String((row as NewsItem).title || ''))"
            >
              删除
            </AppButton>
          </div>
        </template>
      </AppTable>
    </template>

    <AppModal
      :open="editorOpen"
      :title="editorMode === 'create' ? (editorKind === 'notice' ? '新建公告' : '新建动态') : '编辑'"
      @close="editorOpen = false"
    >
      <div class="editor-grid">
        <div v-if="editorKind === 'notice'" class="form">
          <AppFormField label="标题" required :error="formError && !noticeForm.title ? formError : ''">
            <input v-model="noticeForm.title" maxlength="120" />
          </AppFormField>
          <AppFormField label="正文">
            <textarea v-model="noticeForm.content" rows="5" maxlength="3000" />
          </AppFormField>
          <div class="row2">
            <AppFormField label="类型">
              <select v-model="noticeForm.type">
                <option v-for="t in NOTICE_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
            </AppFormField>
            <AppFormField label="优先级">
              <select v-model="noticeForm.priority">
                <option v-for="t in NOTICE_PRIORITIES" :key="t" :value="t">{{ t }}</option>
              </select>
            </AppFormField>
          </div>
          <div class="row2">
            <AppFormField label="展示模式">
              <select v-model="noticeForm.displayMode">
                <option v-for="t in NOTICE_DISPLAY_MODES" :key="t" :value="t">{{ t }}</option>
              </select>
            </AppFormField>
            <AppFormField label="目标页面">
              <select v-model="noticeForm.targetPage">
                <option v-for="t in NOTICE_TARGET_PAGES" :key="t" :value="t">{{ t }}</option>
              </select>
            </AppFormField>
          </div>
          <div class="row2">
            <AppFormField label="开始时间" hint="定时发布（可选）">
              <input v-model="noticeForm.startAt" type="datetime-local" />
            </AppFormField>
            <AppFormField label="结束时间" hint="过期时间（可选）">
              <input v-model="noticeForm.endAt" type="datetime-local" />
            </AppFormField>
          </div>
          <label class="check"><input v-model="noticeForm.enabled" type="checkbox" /> 启用</label>
          <label class="check"><input v-model="noticeForm.closable" type="checkbox" /> 可关闭</label>
        </div>

        <div v-else class="form">
          <AppFormField label="标题" required>
            <input v-model="newsForm.title" maxlength="140" />
          </AppFormField>
          <AppFormField label="摘要">
            <textarea v-model="newsForm.summary" rows="2" />
          </AppFormField>
          <AppFormField label="详情">
            <textarea v-model="newsForm.detail" rows="4" />
          </AppFormField>
          <div class="row2">
            <AppFormField label="标签">
              <input v-model="newsForm.tag" />
            </AppFormField>
            <AppFormField label="日期">
              <input v-model="newsForm.date" type="datetime-local" />
            </AppFormField>
          </div>
          <AppFormField label="链接">
            <input v-model="newsForm.link" />
          </AppFormField>
          <label class="check"><input v-model="newsForm.enabled" type="checkbox" /> 启用</label>
        </div>

        <aside class="preview" aria-label="预览">
          <h3>预览</h3>
          <pre>{{ previewText }}</pre>
        </aside>
      </div>
      <p v-if="formError" class="error">{{ formError }}</p>
      <template #footer>
        <AppButton variant="ghost" @click="editorOpen = false">取消</AppButton>
        <AppButton variant="primary" :loading="saving" @click="save">保存</AppButton>
      </template>
    </AppModal>

    <AppModal :open="confirmDeleteOpen" title="确认删除" @close="confirmDeleteOpen = false">
      <p>将删除 <strong>{{ deleteTarget?.title }}</strong>。删除前会自动创建备份。</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmDeleteOpen = false">取消</AppButton>
        <AppButton variant="danger" :loading="saving" @click="confirmDelete">删除</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 10px; align-items: center; }
.error { color: var(--danger); }
.hint-banner {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.tabs { display: flex; gap: 8px; }
.tabs button {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
}
.tabs button.active {
  background: var(--cobalt);
  border-color: var(--cobalt);
  color: #fff;
}
.row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.8rem;
}
.badge.on { background: color-mix(in srgb, var(--success, #1a7f4b) 18%, transparent); color: var(--success, #1a7f4b); }
.badge.off { background: var(--bg-muted); color: var(--text-muted); }
.editor-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1.2fr 0.8fr;
}
@media (max-width: 720px) {
  .editor-grid { grid-template-columns: 1fr; }
}
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.9rem; }
.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-muted);
}
.preview h3 { margin: 0 0 8px; font-size: 0.95rem; }
.preview pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.88rem;
  color: var(--text-secondary);
}
:deep(.modal) { width: min(860px, 100%); }
</style>
