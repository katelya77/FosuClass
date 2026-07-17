<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const loading = ref(true)
const notices = ref<Record<string, unknown>[]>([])
const error = ref('')
const ui = useUiStore()
const columns = [
  { key: 'title', label: '标题' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
  { key: 'id', label: 'ID' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items?: Record<string, unknown>[]; data?: { items?: Record<string, unknown>[] } }>(
      '/api/admin/notices',
    )
    notices.value = data.items || data.data?.items || []
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
        <h2>内容运营</h2>
        <p>公告列表（Tier 2）。编辑写入仍可走旧版，避免破坏现有工作流。</p>
      </div>
      <div class="actions">
        <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
        <a href="/admin/#notices">旧版公告</a>
      </div>
    </div>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="notices" empty-text="暂无公告" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 10px; align-items: center; }
.error { color: var(--danger); }
</style>
