<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'
import { legacyAdminUrl } from '@/shared/runtime/paths'

const legacySettingsHref = legacyAdminUrl('settings')

const loading = ref(true)
const config = ref<Record<string, unknown> | null>(null)
const error = ref('')
const ui = useUiStore()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<Record<string, unknown> & { data?: Record<string, unknown> }>('/api/admin/config')
    config.value = (data.data || data) as Record<string, unknown>
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
        <h2>设置</h2>
        <p>应用配置只读视图。写入仍走旧版表单，避免配置误改。</p>
      </div>
      <div class="actions">
        <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
        <a :href="legacySettingsHref">旧版设置</a>
      </div>
    </div>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <pre v-else-if="config">{{ JSON.stringify(config, null, 2) }}</pre>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 10px; align-items: center; }
pre {
  margin: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  max-height: 70vh;
}
.error { color: var(--danger); }
</style>
