<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/shared/api/client'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { useUiStore } from '@/stores/ui'

const stages = [
  { id: 'staging', title: 'Staging', desc: '待审上传与指纹对比' },
  { id: 'release', title: 'Release Pack', desc: '构建 / 健康 / 发布' },
  { id: 'static', title: '静态目录同步', desc: 'OpenResty / 静态路径' },
  { id: 'verify', title: 'URL 验证', desc: '索引与详情可达' },
  { id: 'active', title: 'Active Pointer', desc: '用户端真正生效' },
]

const loading = ref(true)
const status = ref<Record<string, unknown> | null>(null)
const error = ref('')
const ui = useUiStore()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<Record<string, unknown> & { data?: Record<string, unknown> }>('/api/admin/sync/status')
    status.value = (data.data || data) as Record<string, unknown>
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function val(key: string) {
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
      <li v-for="(stage, index) in stages" :key="stage.id">
        <span class="step">{{ index + 1 }}</span>
        <div>
          <strong>{{ stage.title }}</strong>
          <p>{{ stage.desc }}</p>
        </div>
      </li>
    </ol>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="facts">
      <article>
        <span>Active</span>
        <strong>{{ val('activeReleaseVersion') || val('releaseVersion') }}</strong>
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
      完整上传 / 发布动作仍可在
      <a href="/admin/#sync">旧版同步页</a>
      执行；本页先建立只读运营视图与状态语义，后续阶段接入操作。
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
  background: var(--cobalt);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-weight: 700;
  flex-shrink: 0;
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
