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
  { key: 'id', label: 'ID' },
  { key: 'status', label: '状态' },
  { key: 'category', label: '分类' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'content', label: '内容' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items?: Record<string, unknown>[]; data?: { items?: Record<string, unknown>[] } }>(
      '/api/admin/feedbacks',
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
        <h2>反馈</h2>
        <p>Tier 2 运营功能；失败不影响课表发布链路。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
    </div>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows" empty-text="暂无反馈" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.error { color: var(--danger); }
</style>
