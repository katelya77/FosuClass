<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  getSettings,
  previewSettings,
  saveSettings,
  type SettingField,
  type SettingScope,
  type SettingsDocument,
  type SettingChange,
} from '@/features/settings/api'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import { createIdempotencyKey, type ApiError } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import EmptyState from '@/shared/ui/EmptyState.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const groupDefinitions: Array<{ scope: SettingScope; title: string; description: string }> = [
  { scope: 'app', title: '应用与发布', description: '客户端名称、发布态与用户可见说明。' },
  { scope: 'term', title: '学期展示', description: '只控制后台展示，不会切换 Active Pointer 或激活学期。' },
  { scope: 'import', title: '导入能力', description: '控制个人课表导入入口，不在此修改服务端凭据。' },
  { scope: 'data', title: '数据文案', description: '维护面向用户的数据版本与来源说明。' },
]

const ui = useUiStore()
const loading = ref(true)
const previewing = ref(false)
const saving = ref(false)
const loadError = ref('')
const actionError = ref('')
const recoveryMessage = ref('')
const writeEnabled = ref(false)
const settings = ref<SettingsDocument | null>(null)
const form = reactive<Record<string, unknown>>({})
const fieldErrors = reactive<Record<string, string>>({})
const previewOpen = ref(false)
const previewChanges = ref<SettingChange[]>([])
const pendingPatch = ref<Record<string, unknown>>({})
const previewOperationKey = ref('')
const saveOperationKey = ref('')
const conflictVersion = ref('')

const version = computed(() => settings.value?.version || '')
const fields = computed(() => settings.value?.fields || [])
const groups = computed(() => groupDefinitions.map((definition) => ({
  ...definition,
  fields: fields.value.filter((field) => field.scope === definition.scope),
})))
const changedCount = computed(() => fields.value.reduce((count, field) => (
  valuesEqual(form[field.key], field.currentValue) ? count : count + 1
), 0))

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function fieldId(key: string) {
  return `setting-${key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function replaceForm(document: SettingsDocument, preservedDraft?: Record<string, unknown>) {
  for (const key of Object.keys(form)) delete form[key]
  for (const field of document.fields) {
    form[field.key] = preservedDraft && Object.prototype.hasOwnProperty.call(preservedDraft, field.key)
      ? preservedDraft[field.key]
      : field.currentValue
  }
}

function draftSnapshot() {
  return Object.fromEntries(fields.value.map((field) => [field.key, form[field.key]]))
}

async function load(options: { preserveDraft?: boolean; refreshCapabilities?: boolean } = {}) {
  const preservedDraft = options.preserveDraft ? draftSnapshot() : undefined
  loading.value = true
  loadError.value = ''
  try {
    if (options.refreshCapabilities !== false) {
      try {
        const capabilities = await fetchCapabilities(true)
        writeEnabled.value = canWriteModule('settings', capabilities)
      } catch {
        writeEnabled.value = false
      }
    }
    const document = await getSettings()
    settings.value = document
    replaceForm(document, preservedDraft)
    previewOpen.value = false
    previewChanges.value = []
    pendingPatch.value = {}
    previewOperationKey.value = ''
    saveOperationKey.value = ''
    actionError.value = ''
    conflictVersion.value = ''
    if (options.preserveDraft) {
      recoveryMessage.value = `已载入最新版本 ${document.version}；你的草稿仍保留，请重新预览差异。`
    } else {
      recoveryMessage.value = ''
    }
  } catch (error) {
    loadError.value = message(error, '设置加载失败')
  } finally {
    loading.value = false
  }
}

function validateField(field: SettingField) {
  const value = form[field.key]
  let error = ''
  if (field.type === 'boolean' && typeof value !== 'boolean') {
    error = '该字段必须是布尔值'
  } else if (field.type === 'enum' && !field.enumValues?.includes(String(value))) {
    error = '请选择有效选项'
  } else if (field.type === 'string' && field.maxLength && String(value ?? '').length > field.maxLength) {
    error = `最多 ${field.maxLength} 个字符`
  }
  fieldErrors[field.key] = error
  return !error
}

function collectPatch() {
  const patch: Record<string, unknown> = {}
  let valid = true
  for (const field of fields.value) {
    valid = validateField(field) && valid
    if (!field.sensitive && !valuesEqual(form[field.key], field.currentValue)) {
      patch[field.key] = form[field.key]
    }
  }
  if (!valid) throw new Error('请先修正表单中的错误')
  return patch
}

async function openPreview() {
  if (!writeEnabled.value || previewing.value) return
  actionError.value = ''
  recoveryMessage.value = ''
  try {
    const patch = collectPatch()
    if (!Object.keys(patch).length) {
      ui.toast('没有需要保存的变更', 'info')
      return
    }
    previewing.value = true
    previewOperationKey.value ||= createIdempotencyKey('settings-preview')
    const preview = await previewSettings(patch, previewOperationKey.value)
    if (preview.version !== version.value) {
      conflictVersion.value = preview.version
      actionError.value = '其他管理员已修改设置。请先载入最新版本，再重新预览你的草稿。'
      return
    }
    pendingPatch.value = patch
    previewChanges.value = preview.changes
    previewOperationKey.value = ''
    if (!preview.changes.length) {
      ui.toast('服务端确认没有实际变更', 'info')
      return
    }
    previewOpen.value = true
  } catch (error) {
    actionError.value = message(error, '变更预览失败')
  } finally {
    previewing.value = false
  }
}

async function save() {
  if (!writeEnabled.value || !previewChanges.value.length) return
  saving.value = true
  actionError.value = ''
  try {
    saveOperationKey.value ||= createIdempotencyKey('settings-save')
    const result = await saveSettings(pendingPatch.value, version.value, saveOperationKey.value)
    saveOperationKey.value = ''
    previewOpen.value = false
    ui.toast(result.auditPending ? '设置已提交，审计记录正在补写' : '设置已保存', result.auditPending ? 'warning' : 'success')
    await load({ refreshCapabilities: false })
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.status === 409) {
      const payload = apiError.payload && typeof apiError.payload === 'object'
        ? apiError.payload as { currentVersion?: string }
        : null
      conflictVersion.value = payload?.currentVersion || ''
      actionError.value = '其他管理员已修改设置。当前草稿尚未丢失，请载入最新版本后重新预览。'
      previewOpen.value = false
    } else if (apiError.status === 428) {
      actionError.value = '缺少设置版本前置条件，请载入最新版本后重试。'
      previewOpen.value = false
    } else {
      actionError.value = message(error, '设置保存失败')
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="page" aria-labelledby="settings-title">
    <header class="page-head">
      <div>
        <p class="eyebrow">SETTINGS · 类型化配置</p>
        <h2 id="settings-title">系统设置</h2>
        <p>先编辑草稿，再查看服务端差异并提交。敏感密钥、GitHub Secrets 与服务器环境变量不在此页面编辑。</p>
      </div>
      <div class="head-actions">
        <span class="version-chip" aria-label="当前设置版本">{{ version || '版本未知' }}</span>
        <AppButton variant="secondary" :loading="loading" @click="load()">刷新</AppButton>
        <AppButton
          variant="primary"
          :disabled="!writeEnabled || changedCount === 0"
          :loading="previewing"
          @click="openPreview"
        >预览变更 <span v-if="changedCount">{{ changedCount }}</span></AppButton>
      </div>
    </header>

    <div v-if="!writeEnabled" class="readonly-banner" role="status">
      生产 Settings 写模块当前关闭；字段可查看，但不能预览或提交写操作。
    </div>

    <div v-if="actionError" class="conflict-banner" role="alert">
      <div><strong>设置版本发生冲突</strong><span>{{ actionError }}<template v-if="conflictVersion"> 服务端版本：{{ conflictVersion }}</template></span></div>
      <AppButton variant="secondary" :loading="loading" @click="load({ preserveDraft: true })">保留草稿并载入最新版本</AppButton>
    </div>
    <div v-else-if="recoveryMessage" class="recovery-banner" role="status">{{ recoveryMessage }}</div>

    <LoadingBlock v-if="loading" label="正在读取类型化设置…" />
    <div v-else-if="loadError" class="load-error" role="alert">
      <strong>设置暂时不可用</strong><span>{{ loadError }}</span><AppButton variant="secondary" @click="load()">重试</AppButton>
    </div>
    <EmptyState v-else-if="!fields.length" title="没有可编辑设置" description="服务端没有返回非敏感的类型化字段。" />
    <form v-else class="settings-workbench" aria-label="系统设置表单" @submit.prevent="openPreview">
      <section v-for="group in groups" :key="group.scope" class="setting-group" :aria-labelledby="`settings-group-${group.scope}`">
        <header>
          <span>{{ group.scope.toUpperCase() }}</span>
          <h3 :id="`settings-group-${group.scope}`">{{ group.title }}</h3>
          <p>{{ group.description }}</p>
        </header>
        <div v-if="group.fields.length" class="field-list">
          <AppFormField
            v-for="field in group.fields"
            :key="field.key"
            :label="field.label"
            :for-id="fieldId(field.key)"
            :hint="field.description"
            :error="fieldErrors[field.key]"
          >
            <select
              v-if="field.type === 'enum'"
              :id="fieldId(field.key)"
              v-model="form[field.key]"
              :name="field.key"
              :disabled="!writeEnabled || field.sensitive"
              @change="validateField(field)"
            >
              <option v-for="option in field.enumValues || []" :key="option" :value="option">{{ option }}</option>
            </select>
            <label v-else-if="field.type === 'boolean'" class="boolean-control" :for="fieldId(field.key)">
              <input
                :id="fieldId(field.key)"
                v-model="form[field.key]"
                :name="field.key"
                type="checkbox"
                :disabled="!writeEnabled || field.sensitive"
                @change="validateField(field)"
              />
              <span>{{ form[field.key] ? '开启' : '关闭' }}</span>
            </label>
            <textarea
              v-else-if="field.maxLength && field.maxLength > 200"
              :id="fieldId(field.key)"
              v-model="form[field.key] as string"
              :name="field.key"
              rows="4"
              :maxlength="field.maxLength"
              :disabled="!writeEnabled || field.sensitive"
              @input="validateField(field)"
            />
            <input
              v-else
              :id="fieldId(field.key)"
              v-model="form[field.key] as string"
              :name="field.key"
              type="text"
              :maxlength="field.maxLength"
              :disabled="!writeEnabled || field.sensitive"
              @input="validateField(field)"
            />
          </AppFormField>
        </div>
        <p v-else class="group-empty">此分组当前没有服务端字段。</p>
      </section>
    </form>

    <AppModal :open="previewOpen" title="变更预览" @close="previewOpen = false">
      <div class="preview-intro">
        <span>{{ version }}</span>
        <p>以下差异由服务端根据当前版本计算；确认后才会写入。</p>
      </div>
      <p v-if="actionError" class="modal-error" role="alert">{{ actionError }}</p>
      <ul class="diff-list">
        <li v-for="change in previewChanges" :key="change.key">
          <div class="diff-title"><strong>{{ change.label }}</strong><code>{{ change.key }}</code></div>
          <dl>
            <div><dt>当前</dt><dd>{{ change.from ?? '—' }}</dd></div>
            <div><dt>目标</dt><dd>{{ change.to ?? '—' }}</dd></div>
          </dl>
          <p v-if="change.requiresRestart" class="restart-note">该字段需要容器重启后生效</p>
        </li>
      </ul>
      <template #footer>
        <AppButton variant="ghost" :disabled="saving" @click="previewOpen = false">返回编辑</AppButton>
        <AppButton variant="primary" :loading="saving" @click="save">确认保存</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 16px; }
.page-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; border-bottom: 1px solid var(--border-strong); padding-bottom: 16px; }
.eyebrow { margin: 0 0 4px; color: var(--cobalt); font-size: .72rem; font-weight: 700; letter-spacing: .13em; }
.page-head h2 { margin: 0; font-size: clamp(1.5rem, 2.4vw, 2.15rem); letter-spacing: -.035em; }
.page-head p:not(.eyebrow) { max-width: 760px; margin: 6px 0 0; color: var(--text-secondary); }
.head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.version-chip { padding: 6px 9px; border: 1px solid var(--border-strong); background: var(--bg-muted); color: var(--text-secondary); font-family: var(--font-mono); font-size: .72rem; }
.readonly-banner, .recovery-banner { border-left: 4px solid var(--warning); background: var(--warning-soft); padding: 10px 12px; color: var(--text-secondary); }
.recovery-banner { border-left-color: var(--success); background: var(--success-soft); }
.conflict-banner, .load-error { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border-left: 4px solid var(--danger); background: var(--danger-soft); color: var(--danger); }
.conflict-banner > div, .load-error { gap: 3px; }
.conflict-banner strong, .conflict-banner span, .load-error strong, .load-error span { display: block; }
.load-error { justify-content: flex-start; flex-wrap: wrap; }
.settings-workbench { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, .9fr); gap: 14px; align-items: start; }
.setting-group { min-width: 0; display: grid; grid-template-columns: minmax(150px, .34fr) minmax(0, 1fr); gap: 20px; padding: 16px; border: 1px solid var(--border); background: var(--surface); }
.setting-group:nth-child(3) { grid-column: 2; grid-row: 1; }
.setting-group:nth-child(4) { grid-column: 2; grid-row: 2; }
.setting-group header > span { color: var(--cobalt); font-family: var(--font-mono); font-size: .68rem; letter-spacing: .12em; }
.setting-group h3 { margin: 4px 0 2px; font-size: 1rem; }
.setting-group header p, .group-empty { margin: 0; color: var(--text-muted); font-size: .8rem; }
.field-list { min-width: 0; }
.field-list :deep(.field:last-child) { margin-bottom: 0; }
.boolean-control { display: flex; align-items: center; gap: 9px; min-height: 38px; width: fit-content; color: var(--text); }
.boolean-control input { width: 18px !important; min-height: 18px !important; margin: 0; }
.preview-intro { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.preview-intro span { font-family: var(--font-mono); font-size: .72rem; }
.preview-intro p { margin: 0; color: var(--text-secondary); font-size: .82rem; }
.modal-error { margin: 12px 0 0; padding: 9px 10px; border-left: 4px solid var(--danger); background: var(--danger-soft); color: var(--danger); }
.diff-list { list-style: none; display: grid; gap: 12px; margin: 14px 0 0; padding: 0; }
.diff-list li { padding: 11px; border: 1px solid var(--border); background: var(--bg-elevated); }
.diff-title { display: flex; justify-content: space-between; gap: 10px; }
.diff-title code { color: var(--text-muted); font-size: .72rem; }
.diff-list dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 9px 0 0; }
.diff-list dl > div { min-width: 0; padding: 8px; background: var(--bg-muted); }
.diff-list dt { color: var(--text-muted); font-size: .7rem; }
.diff-list dd { margin: 2px 0 0; overflow-wrap: anywhere; }
.restart-note { margin: 7px 0 0; color: var(--warning); font-size: .78rem; }
@media (max-width: 1080px) {
  .settings-workbench { grid-template-columns: 1fr; }
  .setting-group:nth-child(3), .setting-group:nth-child(4) { grid-column: auto; grid-row: auto; }
}
@media (max-width: 760px) {
  .page-head { grid-template-columns: 1fr; }
  .head-actions { justify-content: flex-start; }
  .conflict-banner { align-items: stretch; flex-direction: column; }
  .setting-group { grid-template-columns: 1fr; gap: 12px; }
  .diff-list dl { grid-template-columns: 1fr; }
}
</style>
