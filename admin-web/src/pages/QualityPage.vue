<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import EmptyState from '@/shared/ui/EmptyState.vue'
import { useUiStore } from '@/stores/ui'

const loading = ref(true)
const report = ref<Record<string, unknown> | null>(null)
const error = ref('')
const ui = useUiStore()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<Record<string, unknown> & { data?: Record<string, unknown> }>('/api/admin/quality/report')
    report.value = (data.data || data) as Record<string, unknown>
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
    report.value = null
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
        <h2>数据质量中心</h2>
        <p>突出异常、待处理事项与可执行下一步，而不是平均铺满指标卡。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新质量报告</AppButton>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <EmptyState v-else-if="!report" title="暂无质量报告" description="发布或同步后将生成诊断摘要。" />
    <div v-else class="layout">
      <article class="focus">
        <h3>优先关注</h3>
        <pre>{{ JSON.stringify(report.summary || report.topIssues || report.issues || report, null, 2).slice(0, 4000) }}</pre>
      </article>
      <article class="side">
        <h3>下一步</h3>
        <ol>
          <li>确认 Active Release 健康</li>
          <li>处理阻断级质量项</li>
          <li>必要时回同步中心重建 / 发布</li>
        </ol>
        <AppButton variant="primary" @click="$router.push('/sync')">前往同步中心</AppButton>
      </article>
    </div>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.layout {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 12px;
}
article {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}
h3 { margin: 0 0 10px; font-size: 1rem; }
pre {
  margin: 0;
  max-height: 480px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
.side ol { margin: 0 0 14px; padding-left: 18px; color: var(--text-secondary); }
.error { color: var(--danger); }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
