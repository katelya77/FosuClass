<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppTable from '@/shared/ui/AppTable.vue'
// AppFormField used in filters
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import EmptyState from '@/shared/ui/EmptyState.vue'
import { useUiStore } from '@/stores/ui'

const loading = ref(true)
const report = ref<Record<string, unknown> | null>(null)
const anomalies = ref<Record<string, unknown>[]>([])
const ignoresVersion = ref('')
const error = ref('')
const writeEnabled = ref(false)
const keyword = ref('')
const severity = ref('')
const ui = useUiStore()
const busy = ref(false)

const columns = [
  { key: 'type', label: '分类' },
  { key: 'severity', label: '严重度' },
  { key: 'target', label: '资源' },
  { key: 'message', label: '说明' },
  { key: 'suggestion', label: '建议' },
  { key: 'actions', label: '操作', width: '140px' },
]

const filtered = computed(() => {
  return anomalies.value.filter((row) => {
    if (severity.value && String(row.severity || row.level || '') !== severity.value) return false
    if (keyword.value) {
      const hay = JSON.stringify(row).toLowerCase()
      if (!hay.includes(keyword.value.toLowerCase())) return false
    }
    return true
  })
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await fetchCapabilities(true)
    writeEnabled.value = canWriteModule('quality', caps)
    const [rep, ign] = await Promise.all([
      api<{ data?: Record<string, unknown> & { anomalies?: Record<string, unknown>[] }; anomalies?: Record<string, unknown>[] }>(
        '/api/admin/quality/report',
      ),
      api<{ version?: string }>('/api/admin/quality/ignores').catch(() => ({ version: '' })),
    ])
    report.value = (rep.data || rep) as Record<string, unknown>
    const list =
      (rep.data && (rep.data.anomalies as Record<string, unknown>[])) ||
      (rep as { anomalies?: Record<string, unknown>[] }).anomalies ||
      []
    anomalies.value = Array.isArray(list) ? list : []
    ignoresVersion.value = (ign as { version?: string }).version || ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
    report.value = null
    anomalies.value = []
  } finally {
    loading.value = false
  }
}

async function mark(row: Record<string, unknown>, ignore: boolean) {
  if (!writeEnabled.value) return
  busy.value = true
  try {
    const type = String(row.type || row.category || 'general')
    const target = String(row.target || row.id || row.className || row.fingerprint || '')
    await api('/api/admin/quality/mark', {
      method: 'POST',
      headers: ignoresVersion.value ? { 'If-Match': ignoresVersion.value } : undefined,
      body: JSON.stringify({
        type,
        target,
        ignore,
        expectedVersion: ignoresVersion.value,
        reason: ignore ? 'operator ignore' : 'restore',
      }),
    })
    ui.toast(ignore ? '已忽略' : '已恢复', 'success')
    await load()
  } catch (e) {
    const err = e as { status?: number; message?: string }
    ui.toast(err.status === 409 ? '忽略规则冲突，请刷新' : err.message || '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

function exportReport() {
  if (!report.value) return
  const blob = new Blob([JSON.stringify(report.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `quality-report-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>数据质量中心</h2>
        <p>问题列表、严重度、忽略规则（版本冲突）、导出。质量故障不阻断课表读链路。</p>
      </div>
      <div class="actions">
        <AppButton variant="secondary" @click="exportReport">导出报告</AppButton>
        <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
      </div>
    </div>

    <div class="filters">
      <AppFormField label="严重度">
        <select v-model="severity">
          <option value="">全部</option>
          <option value="critical">critical</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
          <option value="info">info</option>
        </select>
      </AppFormField>
      <AppFormField label="搜索">
        <input v-model="keyword" placeholder="资源 / 说明…" />
      </AppFormField>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <EmptyState v-else-if="!filtered.length" title="暂无质量问题" description="或已被忽略规则过滤。" />
    <AppTable v-else :columns="columns" :rows="filtered" empty-text="无匹配项">
      <template #cell-actions="{ row }">
        <div class="row-actions" v-if="writeEnabled">
          <AppButton variant="ghost" :disabled="busy" @click="mark(row as Record<string, unknown>, true)">忽略</AppButton>
          <AppButton variant="ghost" :disabled="busy" @click="mark(row as Record<string, unknown>, false)">恢复</AppButton>
        </div>
      </template>
    </AppTable>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 8px; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.error { color: var(--danger); }
.row-actions { display: flex; gap: 4px; }
</style>
