<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '@/shared/api/client'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

type Field = {
  key: string
  type: string
  label: string
  description?: string
  currentValue: unknown
  default?: unknown
  enumValues?: string[]
  requiresRestart?: boolean
  sensitive?: boolean
}

const ui = useUiStore()
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const writeEnabled = ref(false)
const version = ref('')
const fields = ref<Field[]>([])
const form = reactive<Record<string, unknown>>({})
const previewOpen = ref(false)
const previewChanges = ref<Array<{ key: string; label: string; from: unknown; to: unknown; requiresRestart?: boolean }>>([])

const groups = computed(() => {
  const map: Record<string, Field[]> = { app: [], term: [], import: [], data: [] }
  for (const f of fields.value) {
    const scope = (f as Field & { scope?: string }).scope || 'app'
    if (!map[scope]) map[scope] = []
    map[scope].push(f)
  }
  return map
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await fetchCapabilities(true)
    writeEnabled.value = canWriteModule('settings', caps)
    const data = await api<{
      fields?: Field[]
      version?: string
      groups?: Record<string, Field[]>
    }>('/api/admin/settings')
    version.value = data.version || ''
    const list = data.fields || Object.values(data.groups || {}).flat()
    fields.value = list as Field[]
    for (const f of fields.value) {
      form[f.key] = f.currentValue
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

async function openPreview() {
  const patch: Record<string, unknown> = {}
  for (const f of fields.value) {
    patch[f.key] = form[f.key]
  }
  const data = await api<{ changes?: typeof previewChanges.value }>('/api/admin/settings/preview', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
  previewChanges.value = data.changes || []
  if (!previewChanges.value.length) {
    ui.toast('没有变更', 'info')
    return
  }
  previewOpen.value = true
}

async function save() {
  if (!writeEnabled.value) return
  saving.value = true
  try {
    const patch: Record<string, unknown> = { expectedVersion: version.value }
    for (const f of fields.value) {
      patch[f.key] = form[f.key]
    }
    const data = await api<{ version?: string; settings?: { fields?: Field[] } }>('/api/admin/settings', {
      method: 'POST',
      headers: version.value ? { 'If-Match': version.value } : undefined,
      body: JSON.stringify(patch),
    })
    ui.toast('设置已保存', 'success')
    previewOpen.value = false
    version.value = data.version || ''
    await load()
  } catch (e) {
    const err = e as { status?: number; message?: string }
    if (err.status === 409) ui.toast('保存冲突：请刷新后重试', 'error')
    else ui.toast(err.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>系统设置</h2>
        <p>类型化表单 · 变更预览 · 版本冲突检测。敏感密钥不会回传明文；不写服务器 .env / GitHub Secrets。</p>
      </div>
      <div class="actions">
        <AppButton variant="secondary" :loading="loading" @click="load">刷新</AppButton>
        <AppButton v-if="writeEnabled" variant="primary" :loading="saving" @click="openPreview">预览并保存</AppButton>
      </div>
    </div>
    <p v-if="!writeEnabled" class="hint">settings 写模块未启用时只读。当前版本：{{ version || '—' }}</p>
    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>
    <div v-else class="groups">
      <section v-for="(list, name) in groups" :key="name" class="card">
        <h3>{{ name }}</h3>
        <template v-for="f in list" :key="f.key">
          <AppFormField :label="f.label" :hint="f.description">
            <select v-if="f.type === 'enum'" v-model="form[f.key]" :disabled="!writeEnabled">
              <option v-for="ev in f.enumValues || []" :key="ev" :value="ev">{{ ev }}</option>
            </select>
            <label v-else-if="f.type === 'boolean'" class="check">
              <input v-model="form[f.key]" type="checkbox" :disabled="!writeEnabled" />
              {{ form[f.key] ? '开启' : '关闭' }}
            </label>
            <textarea v-else-if="String(f.key).includes('disclaimer') || String(f.key).includes('Note')" v-model="form[f.key] as string" rows="3" :disabled="!writeEnabled" />
            <input v-else v-model="form[f.key] as string" :disabled="!writeEnabled" />
          </AppFormField>
        </template>
      </section>
    </div>

    <AppModal :open="previewOpen" title="变更预览" @close="previewOpen = false">
      <ul class="diff">
        <li v-for="c in previewChanges" :key="c.key">
          <strong>{{ c.label }}</strong>
          <div class="row"><span>当前</span><code>{{ c.from }}</code></div>
          <div class="row"><span>目标</span><code>{{ c.to }}</code></div>
          <p v-if="c.requiresRestart" class="warn">需要容器重启后生效</p>
        </li>
      </ul>
      <template #footer>
        <AppButton variant="ghost" @click="previewOpen = false">取消</AppButton>
        <AppButton variant="primary" :loading="saving" @click="save">确认保存</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.actions { display: flex; gap: 8px; }
.hint { color: var(--text-muted); }
.error { color: var(--danger); }
.groups { display: grid; gap: 12px; }
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: 14px 16px;
}
.card h3 { margin: 0 0 10px; text-transform: uppercase; font-size: 0.85rem; color: var(--text-secondary); }
.check { display: flex; align-items: center; gap: 8px; }
.diff { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.diff .row { display: flex; gap: 8px; font-size: 0.9rem; }
.warn { color: var(--danger); margin: 4px 0 0; font-size: 0.85rem; }
</style>
