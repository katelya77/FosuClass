<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { useUiStore } from '@/stores/ui'

interface SyncStatus {
  activeReleaseVersion?: string
  releaseVersion?: string
  semester?: string
  releasePackHealthy?: boolean
  stagingNeedsPublish?: boolean
  lastStaticSyncTime?: string
  openRestyStaticSyncStatus?: string
  snapshotUpdatedAt?: string
  nextAction?: string
  opsSummary?: { primaryAction?: string; blockers?: string[] }
}

const loading = ref(true)
const error = ref('')
const status = ref<SyncStatus | null>(null)
const ui = useUiStore()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SyncStatus & { data?: SyncStatus }>('/api/admin/sync/status')
    status.value = (data.data || data) as SyncStatus
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function primaryActionLabel(s: SyncStatus | null) {
  if (!s) return '刷新状态'
  if (s.opsSummary?.primaryAction) return s.opsSummary.primaryAction
  if (s.stagingNeedsPublish) return '去同步中心发布'
  if (s.releasePackHealthy === false) return '检查 Release 健康'
  return '进入同步中心'
}
</script>

<template>
  <section class="dashboard">
    <div class="hero">
      <div>
        <p class="eyebrow">Campus Operations Studio</p>
        <h2>当前系统状态</h2>
        <p class="lead">先回答：Active 是什么、数据是否新鲜、有没有阻断、下一步做什么。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="$router.push('/sync')">
        {{ primaryActionLabel(status) }}
      </AppButton>
    </div>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="error" role="alert">{{ error }}</div>
    <template v-else-if="status">
      <div class="grid">
        <article class="card primary-card">
          <span class="label">Active Release</span>
          <strong>{{ status.activeReleaseVersion || status.releaseVersion || '—' }}</strong>
          <p>学期 {{ status.semester || '—' }}</p>
        </article>
        <article class="card">
          <span class="label">Release 健康</span>
          <strong :class="status.releasePackHealthy === false ? 'bad' : 'good'">
            {{ status.releasePackHealthy === false ? '异常' : status.releasePackHealthy ? '健康' : '未知' }}
          </strong>
          <p>阻断项优先处理</p>
        </article>
        <article class="card">
          <span class="label">静态同步</span>
          <strong>{{ status.openRestyStaticSyncStatus || '—' }}</strong>
          <p>{{ status.lastStaticSyncTime || '尚无同步时间' }}</p>
        </article>
        <article class="card">
          <span class="label">数据新鲜度</span>
          <strong>{{ status.snapshotUpdatedAt ? '已有快照' : '待确认' }}</strong>
          <p>{{ status.snapshotUpdatedAt || '无 snapshot 时间' }}</p>
        </article>
      </div>

      <article class="card next">
        <h3>下一步</h3>
        <p v-if="status.stagingNeedsPublish">Staging 与 Active 不一致，建议进入同步中心完成发布链路。</p>
        <p v-else-if="status.releasePackHealthy === false">Release Pack 健康检查未通过，请先修复后再切换 Active。</p>
        <p v-else>当前无强制阻断。可在同步中心巡检 Staging → Release → 静态 → URL → Active。</p>
        <div class="actions">
          <AppButton variant="primary" @click="$router.push('/sync')">打开同步中心</AppButton>
          <AppButton variant="ghost" @click="load">刷新</AppButton>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: 16px;
}
.hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--brand-red);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
h2 {
  margin: 0;
  font-size: 1.35rem;
}
.lead {
  margin: 6px 0 0;
  color: var(--text-secondary);
  max-width: 52ch;
}
.grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: 12px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
}
.primary-card {
  border-color: color-mix(in srgb, var(--brand-red) 35%, var(--border));
  background: linear-gradient(180deg, var(--brand-red-soft), var(--surface) 70%);
}
.label {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.card strong {
  font-size: 1.15rem;
  word-break: break-all;
}
.card p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.good {
  color: var(--success);
}
.bad {
  color: var(--danger);
}
.next h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}
.next p {
  margin: 0 0 12px;
  color: var(--text-secondary);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.error {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
