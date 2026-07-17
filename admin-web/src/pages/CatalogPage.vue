<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api } from '@/shared/api/client'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const types = [
  { value: 'class', label: '班级' },
  { value: 'teacher', label: '教师' },
  { value: 'classroom', label: '教室' },
  { value: 'course', label: '课程' },
  { value: 'major', label: '专业' },
]

const type = ref('class')
const q = ref('')
const page = ref(1)
const loading = ref(false)
const stats = ref<Record<string, unknown> | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const error = ref('')
const writeEnabled = ref(false)
const metaVersion = ref('')
const saving = ref(false)
const ui = useUiStore()

const editOpen = ref(false)
const editForm = reactive({
  type: 'class',
  id: '',
  displayName: '',
  note: '',
  hidden: false,
})

const columns = computed(() => [
  { key: 'id', label: 'ID' },
  { key: 'className', label: '名称' },
  { key: 'displayName', label: '别名' },
  { key: 'collegeName', label: '学院' },
  { key: 'note', label: '备注' },
  { key: 'hidden', label: '隐藏' },
  { key: 'actions', label: '操作', width: '100px' },
])

async function loadStats() {
  try {
    const data = await api<{ data?: Record<string, unknown> }>('/api/admin/catalog/stats')
    stats.value = (data.data || data) as Record<string, unknown>
  } catch {
    stats.value = null
  }
}

async function loadMetaVersion() {
  try {
    const data = await api<{ version?: string }>('/api/admin/catalog/meta')
    metaVersion.value = data.version || ''
  } catch {
    metaVersion.value = ''
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      type: type.value,
      page: String(page.value),
      pageSize: '30',
    })
    if (q.value.trim()) params.set('keyword', q.value.trim())
    const data = await api<{
      items?: Record<string, unknown>[]
      list?: Record<string, unknown>[]
      total?: number
      data?: { items?: Record<string, unknown>[]; list?: Record<string, unknown>[]; total?: number }
    }>(`/api/admin/catalog/list?${params.toString()}`)
    const payload = data.data || data
    rows.value = payload.items || payload.list || []
    total.value = Number(payload.total || rows.value.length)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
    rows.value = []
  } finally {
    loading.value = false
  }
}

function openEdit(row: Record<string, unknown>) {
  if (!writeEnabled.value) return
  editForm.type = type.value
  editForm.id = String(row.id || row.className || row.name || '')
  editForm.displayName = String(row.displayName || '')
  editForm.note = String(row.note || '')
  editForm.hidden = Boolean(row.hidden)
  editOpen.value = true
}

async function saveMeta() {
  saving.value = true
  try {
    const data = await api<{ version?: string }>('/api/admin/catalog/meta', {
      method: 'POST',
      headers: metaVersion.value ? { 'If-Match': metaVersion.value } : undefined,
      body: JSON.stringify({
        type: editForm.type,
        id: editForm.id,
        displayName: editForm.displayName,
        note: editForm.note,
        hidden: editForm.hidden,
        expectedVersion: metaVersion.value,
      }),
    })
    metaVersion.value = data.version || metaVersion.value
    ui.toast('元数据已保存', 'success')
    editOpen.value = false
    await loadList()
    await loadMetaVersion()
  } catch (e) {
    const err = e as { status?: number; message?: string }
    ui.toast(err.status === 409 ? '元数据冲突，请刷新' : err.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function boot() {
  const caps = await fetchCapabilities(true)
  writeEnabled.value = canWriteModule('catalog', caps)
  await Promise.all([loadStats(), loadMetaVersion(), loadList()])
}

watch([type, page], loadList)
onMounted(boot)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>数据资源中心</h2>
        <p>学院/专业/班级/教师/教室/课程 · 搜索筛选分页 · 元数据编辑（版本冲突）。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="loadList">刷新</AppButton>
    </div>

    <div v-if="stats" class="stats">
      <span v-for="(v, k) in stats" :key="k" class="stat">{{ k }}: <strong>{{ v }}</strong></span>
    </div>

    <div class="filters">
      <AppFormField label="类型">
        <select v-model="type">
          <option v-for="t in types" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </AppFormField>
      <AppFormField label="关键词">
        <input v-model="q" placeholder="搜索…" @keydown.enter="loadList" />
      </AppFormField>
      <AppButton variant="secondary" @click="loadList">查询</AppButton>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows" empty-text="暂无资源">
      <template #cell-hidden="{ value }">{{ value ? '是' : '否' }}</template>
      <template #cell-actions="{ row }">
        <AppButton v-if="writeEnabled" variant="ghost" @click="openEdit(row as Record<string, unknown>)">编辑元数据</AppButton>
      </template>
    </AppTable>
    <div class="pager">
      <AppButton variant="ghost" :disabled="page <= 1" @click="page -= 1">上一页</AppButton>
      <span>第 {{ page }} 页 · 共 {{ total }} 条</span>
      <AppButton variant="ghost" @click="page += 1">下一页</AppButton>
    </div>

    <AppModal :open="editOpen" title="编辑资源元数据" @close="editOpen = false">
      <AppFormField label="资源 ID"><input v-model="editForm.id" disabled /></AppFormField>
      <AppFormField label="显示别名"><input v-model="editForm.displayName" /></AppFormField>
      <AppFormField label="备注"><textarea v-model="editForm.note" rows="3" /></AppFormField>
      <label class="check"><input v-model="editForm.hidden" type="checkbox" /> 隐藏</label>
      <template #footer>
        <AppButton variant="ghost" @click="editOpen = false">取消</AppButton>
        <AppButton variant="primary" :loading="saving" @click="saveMeta">保存</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.stats { display: flex; flex-wrap: wrap; gap: 8px; }
.stat { background: var(--bg-muted); padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.85rem; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.error { color: var(--danger); }
.pager { display: flex; gap: 12px; align-items: center; }
.check { display: flex; gap: 8px; align-items: center; }
</style>
