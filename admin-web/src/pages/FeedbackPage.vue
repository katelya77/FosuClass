<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {
  exportFeedbackCsv,
  listFeedbacks,
  updateFeedback,
  type FeedbackItem,
} from '@/features/feedback/api'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
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
const writeEnabled = ref(false)
const rows = ref<FeedbackItem[]>([])
const types = ref<string[]>([])
const stats = ref<Record<string, number>>({})
const selected = ref<Set<string>>(new Set())

const filters = reactive({
  status: '',
  type: '',
  keyword: '',
  days: '',
  limit: 100,
})

const drawerOpen = ref(false)
const current = ref<FeedbackItem | null>(null)
const editStatus = ref('open')
const editNote = ref('')

const columns = [
  { key: 'select', label: '', width: '40px' },
  { key: 'id', label: 'ID', width: '120px' },
  { key: 'status', label: '状态' },
  { key: 'type', label: '类型' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'content', label: '内容' },
  { key: 'actions', label: '操作', width: '100px' },
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'open', label: 'open' },
  { value: 'processing', label: 'processing' },
  { value: 'resolved', label: 'resolved' },
  { value: 'ignored', label: 'ignored' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await fetchCapabilities()
    writeEnabled.value = canWriteModule('feedback', caps)
    const data = await listFeedbacks({ ...filters })
    rows.value = data.items
    types.value = data.types || []
    stats.value = data.stats || {}
    selected.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function openDetail(row: FeedbackItem) {
  current.value = row
  editStatus.value = String(row.status || 'open')
  editNote.value = String(row.adminNote || row.note || '')
  drawerOpen.value = true
}

async function saveDetail() {
  if (!current.value || !writeEnabled.value) return
  saving.value = true
  try {
    await updateFeedback(current.value.id, {
      status: editStatus.value,
      adminNote: editNote.value,
    })
    ui.toast('反馈已更新', 'success')
    drawerOpen.value = false
    await load()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '更新失败', 'error')
  } finally {
    saving.value = false
  }
}

async function batchSetStatus(status: string) {
  if (!writeEnabled.value || selected.value.size === 0) return
  saving.value = true
  try {
    const ids = [...selected.value]
    for (const id of ids) {
      await updateFeedback(id, { status })
    }
    ui.toast(`已批量标记 ${ids.length} 条为 ${status}`, 'success')
    await load()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '批量处理失败', 'error')
  } finally {
    saving.value = false
  }
}

async function doExport() {
  try {
    const blob = await exportFeedbackCsv({ ...filters })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fosu-feedback-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ui.toast('导出已开始（敏感字段已脱敏）', 'success')
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '导出失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>反馈</h2>
        <p>筛选、搜索、状态与备注、批量处理、导出。敏感联系方式已在服务端脱敏。</p>
      </div>
      <div class="actions">
        <AppButton variant="secondary" :loading="loading" @click="load">刷新</AppButton>
        <AppButton variant="secondary" @click="doExport">导出 CSV</AppButton>
      </div>
    </div>

    <div class="stats" v-if="stats && Object.keys(stats).length">
      <span v-for="(v, k) in stats" :key="k" class="stat">{{ k }}: <strong>{{ v }}</strong></span>
    </div>

    <div class="filters">
      <AppFormField label="状态">
        <select v-model="filters.status">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </AppFormField>
      <AppFormField label="类型">
        <select v-model="filters.type">
          <option value="">全部类型</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
      </AppFormField>
      <AppFormField label="关键词">
        <input v-model="filters.keyword" placeholder="内容 / ID / 学期…" @keydown.enter="load" />
      </AppFormField>
      <AppFormField label="最近天数">
        <input v-model="filters.days" type="number" min="1" placeholder="如 7" />
      </AppFormField>
      <div class="filter-actions">
        <AppButton variant="primary" :loading="loading" @click="load">查询</AppButton>
      </div>
    </div>

    <div v-if="writeEnabled && selected.size" class="batch">
      <span>已选 {{ selected.size }} 条</span>
      <AppButton variant="secondary" :loading="saving" @click="batchSetStatus('processing')">标为 processing</AppButton>
      <AppButton variant="secondary" :loading="saving" @click="batchSetStatus('resolved')">标为 resolved</AppButton>
      <AppButton variant="secondary" :loading="saving" @click="batchSetStatus('ignored')">标为 ignored</AppButton>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows as any" empty-text="暂无反馈">
      <template #cell-select="{ row }">
        <input
          type="checkbox"
          :checked="selected.has(String((row as FeedbackItem).id))"
          :disabled="!writeEnabled"
          @change="toggleSelect(String((row as FeedbackItem).id))"
        />
      </template>
      <template #cell-content="{ value }">
        <span class="clamp">{{ value }}</span>
      </template>
      <template #cell-actions="{ row }">
        <AppButton variant="ghost" @click="openDetail(row as FeedbackItem)">处理</AppButton>
      </template>
    </AppTable>

    <AppModal :open="drawerOpen" title="处理反馈" @close="drawerOpen = false">
      <template v-if="current">
        <p class="meta">ID: {{ current.id }} · {{ current.createdAt }} · {{ current.type }}</p>
        <p class="body-text">{{ current.content }}</p>
        <AppFormField label="状态">
          <select v-model="editStatus" :disabled="!writeEnabled">
            <option value="open">open</option>
            <option value="processing">processing</option>
            <option value="resolved">resolved</option>
            <option value="ignored">ignored</option>
          </select>
        </AppFormField>
        <AppFormField label="管理员备注">
          <textarea v-model="editNote" rows="3" :disabled="!writeEnabled" />
        </AppFormField>
      </template>
      <template #footer>
        <AppButton variant="ghost" @click="drawerOpen = false">关闭</AppButton>
        <AppButton v-if="writeEnabled" variant="primary" :loading="saving" @click="saveDetail">保存</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 10px; }
.error { color: var(--danger); }
.stats { display: flex; flex-wrap: wrap; gap: 10px; }
.stat {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  font-size: 0.85rem;
}
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  align-items: end;
}
.filter-actions { display: flex; align-items: end; padding-bottom: 14px; }
.batch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 360px;
}
.meta { color: var(--text-muted); font-size: 0.85rem; }
.body-text { white-space: pre-wrap; word-break: break-word; }
</style>
