<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { listAuditLogs, type AuditItem } from '@/features/audit/api'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const loading = ref(true)
const error = ref('')
const rows = ref<AuditItem[]>([])
const moduleFilter = ref('')
const actionFilter = ref('')
const keyword = ref('')

const columns = [
  { key: 'time', label: '时间' },
  { key: 'operator', label: '操作者' },
  { key: 'authMethod', label: '认证' },
  { key: 'action', label: '动作' },
  { key: 'module', label: '模块' },
  { key: 'target', label: '目标' },
  { key: 'summary', label: '摘要' },
]

const filtered = computed(() => {
  return rows.value.filter((row) => {
    if (moduleFilter.value && String(row.module || '') !== moduleFilter.value) return false
    if (actionFilter.value && String(row.action || '') !== actionFilter.value) return false
    if (keyword.value) {
      const hay = JSON.stringify(row).toLowerCase()
      if (!hay.includes(keyword.value.toLowerCase())) return false
    }
    return true
  })
})

const modules = computed(() =>
  [...new Set(rows.value.map((r) => String(r.module || '')).filter(Boolean))].sort(),
)
const actions = computed(() =>
  [...new Set(rows.value.map((r) => String(r.action || '')).filter(Boolean))].sort(),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await listAuditLogs()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>审计日志</h2>
        <p>operator / authMethod / scopes / module / action。只读查询；写操作由各业务域写入。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
    </div>

    <div class="filters">
      <AppFormField label="模块">
        <select v-model="moduleFilter">
          <option value="">全部</option>
          <option v-for="m in modules" :key="m" :value="m">{{ m }}</option>
        </select>
      </AppFormField>
      <AppFormField label="动作">
        <select v-model="actionFilter">
          <option value="">全部</option>
          <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
        </select>
      </AppFormField>
      <AppFormField label="搜索">
        <input v-model="keyword" placeholder="摘要 / 操作者 / 目标…" />
      </AppFormField>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="filtered as any" empty-text="暂无审计记录" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.error { color: var(--danger); }
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}
</style>
