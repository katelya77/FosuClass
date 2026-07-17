<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const loading = ref(true)
const rows = ref<Record<string, unknown>[]>([])
const error = ref('')
const ui = useUiStore()

const columns = [
  { key: 'term', label: '学期' },
  { key: 'status', label: '状态' },
  { key: 'activeReleaseVersion', label: 'Active Release' },
  { key: 'label', label: '备注' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items?: Record<string, unknown>[]; terms?: Record<string, unknown>[]; data?: unknown }>(
      '/api/admin/terms',
    )
    const payload = data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : data
    rows.value = (payload.items || payload.terms || data.items || data.terms || []) as Record<string, unknown>[]
    if (!Array.isArray(rows.value)) rows.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
    rows.value = []
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
        <h2>学期管理</h2>
        <p>查看学期生命周期与绑定 Release。激活/修复等写操作请在确认窗口完成（旧版仍可用）。</p>
      </div>
      <div class="actions">
        <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
        <a href="/admin/#terms">旧版学期页</a>
      </div>
    </div>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows" empty-text="暂无学期记录" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); max-width: 60ch; }
.actions { display: flex; gap: 10px; align-items: center; }
.error { color: var(--danger); }
</style>
