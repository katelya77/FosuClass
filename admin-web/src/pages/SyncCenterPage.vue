<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { useUiStore } from '@/stores/ui'
import { legacyAdminUrl } from '@/shared/runtime/paths'

type StageState = 'complete' | 'current' | 'pending' | 'blocked' | 'failed'

interface SyncStatus {
  activeReleaseVersion?: string | null
  publishedReleaseVersion?: string | null
  latestPublishedReleaseVersion?: string | null
  releaseVersion?: string | null
  releasePackHealthy?: boolean | null
  stagingNeedsPublish?: boolean
  stagingSameAsActive?: boolean
  openRestyStaticSyncStatus?: string | null
  lastStaticSyncTime?: string | null
  activeCanonicalHash?: string | null
  stagingCanonicalHash?: string | null
  activeRelease?: { version?: string | null }
  latestPublished?: { version?: string | null }
  staticSync?: { status?: string | null; verified?: boolean | null }
}

const loading = ref(true)
const status = ref<SyncStatus | null>(null)
const error = ref('')
const ui = useUiStore()
const legacySyncHref = legacyAdminUrl('sync')

function pickActive(s: SyncStatus | null): string | null {
  if (!s) return null
  const v = s.activeReleaseVersion || s.activeRelease?.version || null
  return v && String(v).trim() ? String(v).trim() : null
}

function pickPublished(s: SyncStatus | null): string | null {
  if (!s) return null
  const v =
    s.publishedReleaseVersion ||
    s.latestPublishedReleaseVersion ||
    s.latestPublished?.version ||
    s.releaseVersion ||
    null
  return v && String(v).trim() ? String(v).trim() : null
}

const pipeline = computed(() => {
  const s = status.value
  const stages: Array<{ id: string; title: string; desc: string; state: StageState; detail: string }> = [
    {
      id: 'staging',
      title: 'Staging',
      desc: '待审上传与指纹对比',
      state: 'pending',
      detail: '—',
    },
    {
      id: 'release',
      title: 'Release Pack',
      desc: '构建 / 健康 / 发布',
      state: 'pending',
      detail: '—',
    },
    {
      id: 'static',
      title: '静态目录同步',
      desc: 'OpenResty / 静态路径',
      state: 'pending',
      detail: '—',
    },
    {
      id: 'verify',
      title: 'URL 验证',
      desc: '索引与详情可达',
      state: 'pending',
      detail: '—',
    },
    {
      id: 'active',
      title: 'Active Pointer',
      desc: '用户端真正生效',
      state: 'pending',
      detail: '—',
    },
  ]

  if (!s) return stages

  const hasStagingHash = Boolean(s.stagingCanonicalHash)
  const needsPublish = Boolean(s.stagingNeedsPublish)
  const sameAsActive = Boolean(s.stagingSameAsActive)
  const published = pickPublished(s)
  const active = pickActive(s)
  const packHealthy = s.releasePackHealthy
  const staticStatus = String(s.openRestyStaticSyncStatus || s.staticSync?.status || '').toLowerCase()
  const staticOk = /ok|success|synced|complete|done|verified/.test(staticStatus)
  const staticFailed = /fail|error|broken/.test(staticStatus)
  const verified = s.staticSync?.verified === true || /verif/.test(staticStatus)

  // Staging
  if (!hasStagingHash && !needsPublish) {
    stages[0].state = 'pending'
    stages[0].detail = '无 Staging 指纹'
  } else if (needsPublish) {
    stages[0].state = 'current'
    stages[0].detail = '与 Active 不一致，待发布'
  } else if (sameAsActive) {
    stages[0].state = 'complete'
    stages[0].detail = '与 Active 一致'
  } else {
    stages[0].state = 'complete'
    stages[0].detail = hasStagingHash ? '已有 Staging' : '—'
  }

  // Release / Published
  if (packHealthy === false) {
    stages[1].state = 'failed'
    stages[1].detail = published ? `Published ${published} · 健康失败` : '健康检查失败'
  } else if (published) {
    stages[1].state = needsPublish ? 'current' : 'complete'
    stages[1].detail = `Published ${published}`
  } else {
    stages[1].state = 'pending'
    stages[1].detail = '尚无 Published'
  }

  // Static
  if (staticFailed) {
    stages[2].state = 'failed'
    stages[2].detail = s.openRestyStaticSyncStatus || '同步失败'
  } else if (staticOk) {
    stages[2].state = 'complete'
    stages[2].detail = s.lastStaticSyncTime || s.openRestyStaticSyncStatus || '已同步'
  } else if (published) {
    stages[2].state = 'current'
    stages[2].detail = s.openRestyStaticSyncStatus || '等待同步'
  } else {
    stages[2].state = 'pending'
    stages[2].detail = '依赖 Published'
  }

  // Verify
  if (verified || (staticOk && packHealthy !== false)) {
    stages[3].state = packHealthy === false ? 'blocked' : 'complete'
    stages[3].detail = packHealthy === false ? '被健康阻断' : '验证通过/可用'
  } else if (staticOk) {
    stages[3].state = 'current'
    stages[3].detail = '待验证'
  } else if (staticFailed) {
    stages[3].state = 'blocked'
    stages[3].detail = '静态失败阻断'
  } else {
    stages[3].state = 'pending'
    stages[3].detail = '等待静态同步'
  }

  // Active
  if (!active) {
    stages[4].state = published ? 'current' : 'pending'
    stages[4].detail = '未生效'
  } else if (packHealthy === false) {
    stages[4].state = 'blocked'
    stages[4].detail = active
  } else {
    stages[4].state = 'complete'
    stages[4].detail = active
  }

  return stages
})

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

function val(key: keyof SyncStatus) {
  if (!status.value) return '—'
  const v = status.value[key]
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return String(v)
}
</script>

<template>
  <section class="sync">
    <div class="head">
      <div>
        <h2>同步中心</h2>
        <p>严格区分 Published / Static / Verified / Active 与用户端真正生效。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新流水线</AppButton>
    </div>

    <ol class="pipeline">
      <li v-for="(stage, index) in pipeline" :key="stage.id" :data-state="stage.state">
        <span class="step" :data-state="stage.state">{{ index + 1 }}</span>
        <div>
          <strong>{{ stage.title }}</strong>
          <p>{{ stage.desc }}</p>
          <span class="state-pill" :data-state="stage.state">{{ stage.state }}</span>
          <p class="detail">{{ stage.detail }}</p>
        </div>
      </li>
    </ol>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="facts">
      <article>
        <span>Active</span>
        <strong :class="{ warn: !pickActive(status) }">{{ pickActive(status) || '未生效' }}</strong>
      </article>
      <article>
        <span>Published</span>
        <strong>{{ pickPublished(status) || '—' }}</strong>
      </article>
      <article>
        <span>Staging 需发布</span>
        <strong>{{ val('stagingNeedsPublish') }}</strong>
      </article>
      <article>
        <span>静态状态</span>
        <strong>{{ val('openRestyStaticSyncStatus') }}</strong>
      </article>
      <article>
        <span>Pack 健康</span>
        <strong>{{ val('releasePackHealthy') }}</strong>
      </article>
      <article>
        <span>Active Hash</span>
        <strong class="mono">{{ val('activeCanonicalHash') }}</strong>
      </article>
      <article>
        <span>Staging Hash</span>
        <strong class="mono">{{ val('stagingCanonicalHash') }}</strong>
      </article>
    </div>

    <p class="note">
      完整上传 / 发布写操作仍在旧版同步页（只读运营视图阶段）。
      <a :href="legacySyncHref">打开旧版同步页</a>
    </p>
  </section>
</template>

<style scoped>
.sync {
  display: grid;
  gap: 16px;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head h2 {
  margin: 0;
}
.head p {
  margin: 4px 0 0;
  color: var(--text-secondary);
}
.pipeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.pipeline li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
}
.step {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-weight: 700;
  flex-shrink: 0;
  color: #fff;
  background: var(--text-muted);
}
.step[data-state='complete'] {
  background: var(--success);
}
.step[data-state='current'] {
  background: var(--cobalt);
}
.step[data-state='pending'] {
  background: var(--text-muted);
}
.step[data-state='blocked'] {
  background: var(--warning);
}
.step[data-state='failed'] {
  background: var(--danger);
}
.pipeline strong {
  display: block;
  font-size: 0.92rem;
}
.pipeline p {
  margin: 2px 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.state-pill {
  display: inline-block;
  margin-top: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.state-pill[data-state='complete'] {
  background: var(--success-soft);
  color: var(--success);
}
.state-pill[data-state='current'] {
  background: var(--cobalt-soft);
  color: var(--cobalt);
}
.state-pill[data-state='blocked'] {
  background: var(--warning-soft);
  color: var(--warning);
}
.state-pill[data-state='failed'] {
  background: var(--danger-soft);
  color: var(--danger);
}
.detail {
  margin-top: 4px !important;
  color: var(--text-secondary) !important;
}
.facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.facts article {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}
.facts span {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.facts strong {
  word-break: break-all;
}
.facts strong.warn {
  color: var(--warning);
}
.mono {
  font-family: var(--font-mono);
  font-size: 0.82rem;
}
.note {
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.error {
  color: var(--danger);
}
@media (max-width: 1024px) {
  .pipeline {
    grid-template-columns: 1fr 1fr;
  }
  .facts {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 640px) {
  .pipeline,
  .facts {
    grid-template-columns: 1fr;
  }
}
</style>
