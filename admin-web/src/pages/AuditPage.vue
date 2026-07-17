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
  { key: 'time', label: '时间' },
  { key: 'operator', label: '操作者' },
  { key: 'authMethod', label: '认证' },
  { key: 'action', label: '动作' },
  { key: 'module', label: '模块' },
  { key: 'summary', label: '摘要' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items?: Record<string, unknown>[]; data?: { items?: Record<string, unknown>[] } }>(
      '/api/admin/audit-logs',
    )
    rows.value = data.items || data.data?.items || []
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
        <p>展示 operator / authMethod / scopes 强化后的身份字段。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
    </div>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows" empty-text="暂无审计记录" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.error { color: var(--danger); }
</style>
