<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const types = [
  { value: 'colleges', label: '学院' },
  { value: 'majors', label: '专业' },
  { value: 'classes', label: '班级' },
  { value: 'teachers', label: '教师' },
  { value: 'classrooms', label: '教室' },
  { value: 'courses', label: '课程' },
]

const type = ref('colleges')
const q = ref('')
const loading = ref(false)
const stats = ref<Record<string, unknown> | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const error = ref('')
const ui = useUiStore()

const columns = computed(() => {
  if (type.value === 'majors') {
    return [
      { key: 'name', label: '名称' },
      { key: 'code', label: '代码' },
      { key: 'collegeName', label: '学院' },
      { key: 'grade', label: '年级' },
    ]
  }
  if (type.value === 'teachers') {
    return [
      { key: 'name', label: '姓名' },
      { key: 'teacherName', label: '教师名' },
      { key: 'collegeName', label: '学院' },
    ]
  }
  if (type.value === 'classrooms') {
    return [
      { key: 'name', label: '教室' },
      { key: 'roomName', label: '房间' },
      { key: 'campus', label: '校区' },
      { key: 'building', label: '楼栋' },
    ]
  }
  return [
    { key: 'name', label: '名称' },
    { key: 'code', label: '代码' },
    { key: 'id', label: 'ID' },
  ]
})

async function loadStats() {
  try {
    const data = await api<Record<string, unknown> & { data?: Record<string, unknown> }>('/api/admin/catalog/stats')
    stats.value = (data.data || data) as Record<string, unknown>
  } catch {
    stats.value = null
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ type: type.value, limit: '50' })
    if (q.value.trim()) params.set('q', q.value.trim())
    const data = await api<{ items?: Record<string, unknown>[]; data?: { items?: Record<string, unknown>[] } }>(
      `/api/admin/catalog/list?${params.toString()}`,
    )
    rows.value = data.items || data.data?.items || []
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
    rows.value = []
  } finally {
    loading.value = false
  }
}

watch(type, () => loadList())
onMounted(async () => {
  await Promise.all([loadStats(), loadList()])
})
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>数据资源中心</h2>
        <p>浏览学院 / 专业 / 班级 / 教师 / 教室 / 课程目录（只读运营视图）。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="loadList">刷新列表</AppButton>
    </div>

    <div v-if="stats" class="stats">
      <article v-for="(value, key) in stats" :key="String(key)">
        <span>{{ key }}</span>
        <strong>{{ value }}</strong>
      </article>
    </div>

    <div class="toolbar">
      <div class="tabs">
        <button
          v-for="t in types"
          :key="t.value"
          type="button"
          class="tab"
          :class="{ active: type === t.value }"
          @click="type = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <AppFormField label="搜索" for-id="catalog-q">
        <div class="search">
          <input id="catalog-q" v-model="q" placeholder="名称 / 代码" @keyup.enter="loadList" />
          <AppButton @click="loadList">查询</AppButton>
        </div>
      </AppFormField>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <AppTable v-else :columns="columns" :rows="rows" empty-text="没有匹配的资源" />
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.stats article {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}
.stats span { display: block; font-size: 0.75rem; color: var(--text-muted); }
.toolbar { display: grid; gap: 8px; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.tab {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-secondary);
}
.tab.active {
  background: var(--cobalt-soft);
  border-color: var(--cobalt);
  color: var(--cobalt);
  font-weight: 600;
}
.search { display: flex; gap: 8px; }
.error { color: var(--danger); }
</style>
