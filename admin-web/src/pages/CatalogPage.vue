<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  CATALOG_TYPES,
  applyCatalogImport,
  exportCatalog,
  getCatalogIndexRebuild,
  getCatalogMeta,
  getCatalogRelationships,
  getCatalogStats,
  listCatalogResources,
  previewCatalogImport,
  saveCatalogMeta,
  startCatalogIndexRebuild,
  triggerBrowserDownload,
  type CatalogIndexRebuildJob,
  type CatalogImportDocument,
  type CatalogImportPreview,
  type CatalogRelationships,
  type CatalogRow,
  type CatalogType,
} from '@/features/catalog/api'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import { createIdempotencyKey, type ApiError } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import EmptyState from '@/shared/ui/EmptyState.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const typeOptions: Array<{ value: CatalogType; label: string }> = [
  { value: 'class', label: '班级' },
  { value: 'teacher', label: '教师' },
  { value: 'classroom', label: '教室' },
  { value: 'course', label: '课程' },
  { value: 'major', label: '专业' },
]
const statLabels: Record<string, string> = {
  classCount: '班级',
  teacherCount: '教师',
  classroomCount: '教室',
  courseCount: '课程',
  collegeCount: '学院',
  semesterCount: '学期',
  gradeCount: '年级',
  currentSemester: '当前学期',
}

const ui = useUiStore()
const type = ref<CatalogType>('class')
const keyword = ref('')
const page = ref(1)
const pageSize = 30
const loading = ref(true)
const stats = ref<Record<string, string | number | null>>({})
const relationships = ref<CatalogRelationships | null>(null)
const rows = ref<CatalogRow[]>([])
const total = ref(0)
const totalPages = ref(0)
const generationId = ref('')
const listError = ref('')
const writeEnabled = ref(false)
const metaVersion = ref('')
const exporting = ref(false)
const exportFormat = ref<'json' | 'csv'>('json')
const indexJob = ref<CatalogIndexRebuildJob | null>(null)
const indexStarting = ref(false)
const indexError = ref('')
const indexOperationKey = ref('')
let indexPollTimer: number | null = null

const editOpen = ref(false)
const savingMeta = ref(false)
const editForm = reactive({
  type: 'class' as CatalogType,
  id: '',
  displayName: '',
  note: '',
  hidden: false,
  tagsText: '',
})

const importOpen = ref(false)
const importText = ref('')
const importFilename = ref('')
const importError = ref('')
const importPreview = ref<CatalogImportPreview | null>(null)
const previewing = ref(false)
const applying = ref(false)
const previewOperationKey = ref('')
const applyOperationKey = ref('')
const importReceipt = ref<{ operationId: string; generationId: string; auditPending: boolean } | null>(null)

const primaryColumn = computed(() => ({
  class: { key: 'className', label: '班级' },
  teacher: { key: 'teacherName', label: '教师' },
  classroom: { key: 'roomName', label: '教室' },
  course: { key: 'courseName', label: '课程' },
  major: { key: 'majorName', label: '专业' },
})[type.value])

const columns = computed(() => [
  primaryColumn.value,
  { key: 'collegeName', label: '学院' },
  { key: 'semester', label: '学期' },
  { key: 'displayName', label: '显示别名' },
  { key: 'hidden', label: '状态', width: '88px' },
  { key: 'actions', label: '操作', width: '126px' },
])

const canGoNext = computed(() => totalPages.value > 0 && page.value < totalPages.value)
const pageSummary = computed(() => totalPages.value === 0 ? '第 0 / 0 页' : `第 ${page.value} / ${totalPages.value} 页`)
const selectedTypeLabel = computed(() => typeOptions.find((item) => item.value === type.value)?.label || type.value)
const indexProgress = computed(() => Math.max(0, Math.min(100, Number(indexJob.value?.progress || 0))))
const indexStatusLabel = computed(() => {
  if (indexJob.value?.status === 'queued') return '排队中'
  if (indexJob.value?.status === 'running') return '重建中'
  if (indexJob.value?.status === 'success') return '重建完成'
  if (indexJob.value?.status === 'failed') return '重建失败'
  return '尚未运行'
})
const indexRunning = computed(() => Boolean(indexJob.value && ['queued', 'running'].includes(indexJob.value.status)))

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function loadList() {
  loading.value = true
  listError.value = ''
  try {
    const data = await listCatalogResources({
      type: type.value,
      page: page.value,
      pageSize,
      keyword: keyword.value,
    })
    rows.value = data.items
    total.value = data.total
    totalPages.value = data.totalPages
    generationId.value = data.generationId
    if (data.totalPages > 0 && page.value > data.totalPages) {
      page.value = data.totalPages
    }
  } catch (error) {
    listError.value = errorMessage(error, '目录加载失败')
    rows.value = []
    total.value = 0
    totalPages.value = 0
  } finally {
    loading.value = false
  }
}

async function loadSupportingData() {
  const [statsResult, relationshipResult, metaResult] = await Promise.allSettled([
    getCatalogStats(),
    getCatalogRelationships(),
    getCatalogMeta(),
  ])
  stats.value = statsResult.status === 'fulfilled' ? statsResult.value.data : {}
  relationships.value = relationshipResult.status === 'fulfilled' ? relationshipResult.value : null
  metaVersion.value = metaResult.status === 'fulfilled' ? metaResult.value.version : ''
}

async function boot() {
  try {
    const caps = await fetchCapabilities(true)
    writeEnabled.value = canWriteModule('catalog', caps)
  } catch {
    writeEnabled.value = false
  }
  await Promise.all([loadList(), loadSupportingData()])
}

function search() {
  if (page.value !== 1) page.value = 1
  else void loadList()
}

function openEdit(row: CatalogRow) {
  if (!writeEnabled.value) return
  editForm.type = type.value
  editForm.id = row.id
  editForm.displayName = String(row.displayName || '')
  editForm.note = String(row.note || '')
  editForm.hidden = Boolean(row.hidden)
  editForm.tagsText = Array.isArray(row.tags) ? row.tags.map(String).join('，') : ''
  editOpen.value = true
}

async function saveMeta() {
  if (!writeEnabled.value) return
  savingMeta.value = true
  try {
    const result = await saveCatalogMeta(
      {
        type: editForm.type,
        id: editForm.id,
        displayName: editForm.displayName.trim(),
        note: editForm.note.trim(),
        hidden: editForm.hidden,
        tags: editForm.tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      },
      metaVersion.value,
      createIdempotencyKey('catalog-meta'),
    )
    metaVersion.value = result.version
    editOpen.value = false
    ui.toast(result.auditPending ? '元数据已提交，审计记录正在补写' : '元数据已保存', result.auditPending ? 'warning' : 'success')
    await loadList()
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.status === 428) ui.toast('缺少目录版本，请刷新后重试', 'error')
    else if (apiError.status === 409) ui.toast('目录元数据已被其他请求修改，请刷新后重新编辑', 'error')
    else ui.toast(errorMessage(error, '元数据保存失败'), 'error')
  } finally {
    savingMeta.value = false
  }
}

async function runExport() {
  exporting.value = true
  try {
    const result = await exportCatalog({ type: type.value, format: exportFormat.value, keyword: keyword.value })
    triggerBrowserDownload(result.blob, result.filename)
    ui.toast(`已导出 ${selectedTypeLabel.value}目录 · ${result.generationId || '未返回生成号'}`, 'success')
  } catch (error) {
    ui.toast(errorMessage(error, '目录导出失败'), 'error')
  } finally {
    exporting.value = false
  }
}

function resetImportIntent() {
  importPreview.value = null
  importReceipt.value = null
  importError.value = ''
  previewOperationKey.value = ''
  applyOperationKey.value = ''
}

async function onImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importFilename.value = file.name
  importText.value = await file.text()
  resetImportIntent()
}

function parseImportDocument(): CatalogImportDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(importText.value)
  } catch {
    throw new Error('文件不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('导入文档必须是对象')
  const candidate = parsed as Record<string, unknown>
  if (!CATALOG_TYPES.includes(candidate.type as CatalogType)) throw new Error('type 必须是 class、teacher、classroom、course 或 major')
  if (typeof candidate.semester !== 'string' || !candidate.semester.trim()) throw new Error('semester 不能为空')
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) throw new Error('items 必须是非空数组')
  if (!candidate.items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))) {
    throw new Error('items 中每一项都必须是对象')
  }
  return {
    type: candidate.type as CatalogType,
    semester: candidate.semester,
    items: candidate.items as Array<Record<string, unknown>>,
  }
}

async function previewImport() {
  if (!writeEnabled.value) return
  previewing.value = true
  importError.value = ''
  try {
    const document = parseImportDocument()
    previewOperationKey.value ||= createIdempotencyKey('catalog-import-preview')
    importPreview.value = await previewCatalogImport(document, previewOperationKey.value)
    applyOperationKey.value = createIdempotencyKey(`catalog-import-${importPreview.value.previewId}`)
  } catch (error) {
    importError.value = errorMessage(error, '导入预览失败')
  } finally {
    previewing.value = false
  }
}

async function applyImport() {
  if (!writeEnabled.value || !importPreview.value) return
  applying.value = true
  importError.value = ''
  try {
    applyOperationKey.value ||= createIdempotencyKey(`catalog-import-${importPreview.value.previewId}`)
    const result = await applyCatalogImport(importPreview.value, applyOperationKey.value)
    importReceipt.value = {
      operationId: result.operationId,
      generationId: result.generationId,
      auditPending: Boolean(result.auditPending),
    }
    ui.toast(
      result.auditPending ? '目录已提交；审计补写尚未完成，请保留操作号' : '目录导入已提交到未发布工作区',
      result.auditPending ? 'warning' : 'success',
    )
    await Promise.all([loadList(), loadSupportingData()])
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.status === 428) importError.value = '预览缺少 If-Match 版本，请重新生成预览。'
    else if (apiError.status === 409) importError.value = '目录工作区已变化，这份差异预览已失效；请重新预览。'
    else importError.value = errorMessage(error, '目录导入失败')
  } finally {
    applying.value = false
  }
}

function indexJobError(job: CatalogIndexRebuildJob) {
  if (typeof job.error === 'string') return job.error
  return job.error?.message || job.message || '目录索引重建失败'
}

function clearIndexPoll() {
  if (indexPollTimer !== null) window.clearTimeout(indexPollTimer)
  indexPollTimer = null
}

function scheduleIndexPoll() {
  clearIndexPoll()
  if (!indexRunning.value) return
  indexPollTimer = window.setTimeout(() => void pollIndexRebuild(), 700)
}

async function pollIndexRebuild() {
  if (!indexJob.value) return
  try {
    indexJob.value = await getCatalogIndexRebuild(indexJob.value.id)
    if (indexJob.value.status === 'success') {
      indexError.value = ''
      await Promise.all([loadList(), loadSupportingData()])
    } else if (indexJob.value.status === 'failed') {
      indexError.value = indexJobError(indexJob.value)
    }
  } catch (error) {
    indexError.value = errorMessage(error, '目录索引任务状态读取失败')
  }
  scheduleIndexPoll()
}

async function beginIndexRebuild() {
  if (!writeEnabled.value || !generationId.value || indexStarting.value || indexRunning.value) return
  indexStarting.value = true
  indexError.value = ''
  try {
    indexOperationKey.value ||= createIdempotencyKey('catalog-index-rebuild')
    indexJob.value = await startCatalogIndexRebuild(
      { generationId: generationId.value, reason: 'operator' },
      indexOperationKey.value,
    )
    indexOperationKey.value = ''
    scheduleIndexPoll()
  } catch (error) {
    const apiError = error as ApiError
    const payload = apiError.payload && typeof apiError.payload === 'object'
      ? apiError.payload as { job?: CatalogIndexRebuildJob }
      : null
    if (apiError.status === 409 && payload?.job) {
      indexJob.value = payload.job
      indexError.value = '已有目录索引任务正在运行，已接管其进度。'
      indexOperationKey.value = ''
      scheduleIndexPoll()
    } else {
      indexError.value = apiError.status === 409
        ? '已有目录索引任务正在运行，请稍后重试。'
        : errorMessage(error, '无法启动目录索引重建')
    }
  } finally {
    indexStarting.value = false
  }
}

watch(type, () => {
  page.value = 1
  void loadList()
})
watch(page, () => void loadList())
watch(importText, () => resetImportIntent())
onMounted(boot)
onUnmounted(clearIndexPoll)
</script>

<template>
  <section class="page" aria-labelledby="catalog-title">
    <header class="page-head">
      <div class="title-block">
        <p class="eyebrow">CATALOG · 未发布工作区</p>
        <h2 id="catalog-title">数据资源台账</h2>
        <p>检索生成版本、核对学院—专业关系，并通过“文件 → 差异预览 → 明确提交”导入。这里不会切换 Active Pointer。</p>
      </div>
      <div class="head-actions" aria-label="目录操作">
        <select v-model="exportFormat" aria-label="导出格式">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <AppButton variant="secondary" :loading="exporting" @click="runExport">导出当前目录</AppButton>
        <AppButton :disabled="!writeEnabled" variant="primary" @click="importOpen = true">导入并预览</AppButton>
      </div>
    </header>

    <div v-if="!writeEnabled" class="readonly-banner" role="status">
      生产 Catalog 写模块当前关闭；列表、关系与导出保持可用，导入和元数据编辑不可提交。
    </div>

    <div class="metrics" aria-label="目录摘要">
      <div v-for="(value, key) in stats" :key="key" class="metric">
        <span>{{ statLabels[key] || key }}</span>
        <strong>{{ value ?? '—' }}</strong>
      </div>
    </div>

    <div class="workspace">
      <section class="ledger" aria-labelledby="catalog-ledger-title">
        <div class="ledger-toolbar">
          <div>
            <p class="section-kicker">RESOURCE LEDGER</p>
            <h3 id="catalog-ledger-title">{{ selectedTypeLabel }}目录</h3>
          </div>
          <div class="filters" role="search">
            <AppFormField label="资源类型" for-id="catalog-type">
              <select id="catalog-type" v-model="type">
                <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </AppFormField>
            <AppFormField label="关键词" for-id="catalog-keyword">
              <input id="catalog-keyword" v-model="keyword" placeholder="名称、编号或学院" @keydown.enter="search" />
            </AppFormField>
            <AppButton variant="secondary" @click="search">查询</AppButton>
          </div>
        </div>

        <div class="generation-strip" aria-live="polite">
          <span>生成号 <code>{{ generationId || 'UNKNOWN' }}</code></span>
          <span>共 {{ total }} 条</span>
        </div>

        <LoadingBlock v-if="loading" label="正在读取目录工作区…" />
        <div v-else-if="listError" class="error-state" role="alert">
          <strong>目录读取失败</strong><span>{{ listError }}</span>
          <AppButton variant="secondary" @click="loadList">重试</AppButton>
        </div>
        <AppTable v-else :columns="columns" :rows="rows" empty-text="当前筛选条件没有资源">
          <template #cell-hidden="{ value }">
            <span class="status-dot" :class="value ? 'muted' : 'active'">{{ value ? '已隐藏' : '可见' }}</span>
          </template>
          <template #cell-actions="{ row }">
            <AppButton
              variant="ghost"
              :disabled="!writeEnabled"
              @click="openEdit(row as CatalogRow)"
            >编辑元数据</AppButton>
          </template>
        </AppTable>

        <nav class="pager" aria-label="目录分页">
          <AppButton variant="ghost" :disabled="page <= 1 || loading" aria-label="上一页" @click="page -= 1">上一页</AppButton>
          <span aria-live="polite">{{ pageSummary }} · 共 {{ total }} 条</span>
          <AppButton variant="ghost" :disabled="!canGoNext || loading" aria-label="下一页" @click="page += 1">下一页</AppButton>
        </nav>
      </section>

      <aside class="relationship-panel" aria-labelledby="relationship-title">
        <p class="section-kicker">RELATIONSHIP INDEX</p>
        <h3 id="relationship-title">学院—专业关系</h3>
        <p v-if="relationships" class="relationship-meta">
          关系版本 <code>{{ relationships.relationshipVersion }}</code><br />
          生成号 <code>{{ relationships.generationId }}</code>
        </p>
        <EmptyState v-if="!relationships?.colleges.length" title="暂无关系索引" description="后端未返回学院—专业关系。" />
        <div v-else class="relationship-tree">
          <details v-for="college in relationships.colleges" :key="college.id" :open="relationships.colleges.length === 1">
            <summary><strong>{{ college.name || college.id }}</strong><span>{{ college.grades.reduce((sum, grade) => sum + grade.majors.length, 0) }} 个专业</span></summary>
            <div v-for="grade in college.grades" :key="grade.grade" class="grade-row">
              <span>{{ grade.grade }} 级</span>
              <ul>
                <li v-for="major in grade.majors" :key="major.id"><code>{{ major.id }}</code>{{ major.name }}</li>
              </ul>
            </div>
          </details>
        </div>
        <section class="index-job" aria-labelledby="catalog-index-job-title">
          <div class="index-job-head">
            <div><span>DERIVED INDEX JOB</span><strong id="catalog-index-job-title">{{ indexStatusLabel }}</strong></div>
            <AppButton
              variant="secondary"
              :loading="indexStarting"
              :disabled="!writeEnabled || !generationId || indexRunning"
              @click="beginIndexRebuild"
            >重建目录索引</AppButton>
          </div>
          <p v-if="!indexJob" class="index-note">针对当前未发布生成号重建派生索引；不会发布 Release 或切换 Active Pointer。</p>
          <template v-else>
            <div class="index-progress-label"><span>{{ indexJob.message || '等待任务进度' }}</span><strong>{{ indexProgress }}%</strong></div>
            <div class="index-progress" role="progressbar" :aria-valuenow="indexProgress" aria-valuemin="0" aria-valuemax="100" :aria-label="indexStatusLabel"><span :style="{ width: `${indexProgress}%` }" /></div>
            <div v-if="indexJob.result" class="index-result">
              <span>生成号 <code>{{ indexJob.result.generationId }}</code></span>
              <span v-if="indexJob.result.relationshipVersion">关系版本 <code>{{ indexJob.result.relationshipVersion }}</code></span>
              <span v-for="(count, name) in indexJob.result.counts || {}" :key="name">{{ name }} <strong>{{ count }}</strong></span>
            </div>
          </template>
          <p v-if="indexError" class="index-error" role="alert">{{ indexError }}</p>
        </section>
      </aside>
    </div>

    <AppModal :open="editOpen" title="编辑目录元数据" @close="editOpen = false">
      <AppFormField label="稳定资源 ID" for-id="catalog-meta-id"><input id="catalog-meta-id" v-model="editForm.id" disabled /></AppFormField>
      <AppFormField label="显示别名" for-id="catalog-meta-name"><input id="catalog-meta-name" v-model="editForm.displayName" /></AppFormField>
      <AppFormField label="维护备注" for-id="catalog-meta-note"><textarea id="catalog-meta-note" v-model="editForm.note" rows="3" /></AppFormField>
      <AppFormField label="标签" for-id="catalog-meta-tags" hint="使用逗号分隔"><input id="catalog-meta-tags" v-model="editForm.tagsText" /></AppFormField>
      <label class="check"><input v-model="editForm.hidden" type="checkbox" /> 从普通目录视图隐藏</label>
      <template #footer>
        <AppButton variant="ghost" @click="editOpen = false">取消</AppButton>
        <AppButton variant="primary" :loading="savingMeta" @click="saveMeta">保存元数据</AppButton>
      </template>
    </AppModal>

    <AppModal :open="importOpen" title="目录导入工作台" @close="importOpen = false">
      <div class="import-flow">
        <div class="flow-steps" aria-label="导入步骤"><span class="current">1 文件</span><span :class="{ current: importPreview }">2 差异</span><span :class="{ current: importReceipt }">3 回执</span></div>
        <AppFormField label="JSON 导入文件" for-id="catalog-import-file" hint="只接受后端 Catalog import contract；最多 1,000 项。">
          <input id="catalog-import-file" type="file" accept="application/json,.json" @change="onImportFile" />
        </AppFormField>
        <AppFormField label="导入文档" for-id="catalog-import-json" :hint="importFilename || '可直接粘贴 JSON 进行预览'">
          <textarea id="catalog-import-json" v-model="importText" rows="8" spellcheck="false" />
        </AppFormField>
        <div v-if="importError" class="import-error" role="alert">{{ importError }}</div>

        <section v-if="importPreview" class="diff-preview" aria-labelledby="catalog-diff-title">
          <h3 id="catalog-diff-title">差异预览</h3>
          <div class="diff-counts">
            <span><strong>{{ importPreview.summary.added }}</strong> 新增</span>
            <span><strong>{{ importPreview.summary.updated }}</strong> 更新</span>
            <span><strong>{{ importPreview.summary.unchanged }}</strong> 不变</span>
            <span><strong>{{ importPreview.summary.deleted }}</strong> 删除</span>
          </div>
          <p>基线版本 <code>{{ importPreview.baseVersion }}</code> · 预览于 {{ new Date(importPreview.expiresAt).toLocaleString('zh-CN') }} 失效</p>
          <details v-if="importPreview.changes.added.length"><summary>查看新增项</summary><pre>{{ JSON.stringify(importPreview.changes.added, null, 2) }}</pre></details>
          <details v-if="importPreview.changes.updated.length"><summary>查看更新前后</summary><pre>{{ JSON.stringify(importPreview.changes.updated, null, 2) }}</pre></details>
          <p v-if="importPreview.summary.deleted === 0" class="safe-note">此合同为 upsert-only，不会删除现有资源。</p>
        </section>

        <section v-if="importReceipt" class="receipt" :class="{ pending: importReceipt.auditPending }" aria-live="polite">
          <strong>{{ importReceipt.auditPending ? '数据已提交，审计待补写' : '导入已可靠提交' }}</strong>
          <span>操作号 <code>{{ importReceipt.operationId }}</code></span>
          <span>新生成号 <code>{{ importReceipt.generationId }}</code></span>
        </section>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="importOpen = false">关闭</AppButton>
        <AppButton variant="secondary" :loading="previewing" :disabled="!importText.trim() || applying" @click="previewImport">生成差异预览</AppButton>
        <AppButton variant="primary" :loading="applying" :disabled="!importPreview || Boolean(importReceipt)" @click="applyImport">确认提交到工作区</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 16px; }
.page-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; border-bottom: 1px solid var(--border-strong); padding-bottom: 16px; }
.title-block { max-width: 760px; }
.eyebrow, .section-kicker { margin: 0 0 4px; color: var(--cobalt); font-size: .72rem; font-weight: 700; letter-spacing: .13em; }
.page-head h2 { margin: 0; font-size: clamp(1.5rem, 2.4vw, 2.15rem); letter-spacing: -.035em; }
.page-head p:not(.eyebrow) { margin: 6px 0 0; color: var(--text-secondary); }
.head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.head-actions select { min-height: 36px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); padding: 0 9px; }
.readonly-banner { border-left: 4px solid var(--warning); background: var(--warning-soft); padding: 10px 12px; color: var(--text-secondary); }
.metrics { display: flex; gap: 0; overflow-x: auto; border-block: 1px solid var(--border); background: var(--surface); }
.metric { min-width: 112px; padding: 10px 14px; border-right: 1px solid var(--border); }
.metric span { display: block; color: var(--text-muted); font-size: .74rem; }
.metric strong { display: block; margin-top: 2px; font-size: 1.05rem; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 16px; align-items: start; }
.ledger, .relationship-panel { min-width: 0; border: 1px solid var(--border); background: var(--surface); }
.ledger { padding: 14px; }
.relationship-panel { padding: 14px; position: sticky; top: calc(var(--header-height) + 12px); }
.ledger-toolbar { display: flex; justify-content: space-between; align-items: start; gap: 18px; margin-bottom: 8px; }
.ledger h3, .relationship-panel h3 { margin: 0; font-size: 1.05rem; }
.filters { display: grid; grid-template-columns: 126px minmax(180px, 280px) auto; align-items: end; gap: 8px; }
.filters :deep(.field) { margin-bottom: 0; }
.generation-strip { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 12px -14px 0; padding: 7px 14px; border-block: 1px solid var(--border); background: var(--bg-muted); color: var(--text-secondary); font-size: .78rem; }
code { font-family: var(--font-mono); font-size: .82em; overflow-wrap: anywhere; }
.status-dot { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; }
.status-dot::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.status-dot.active { color: var(--success); }
.status-dot.muted { color: var(--text-muted); }
.pager { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-top: 10px; color: var(--text-secondary); font-size: .86rem; }
.relationship-meta { color: var(--text-muted); font-size: .78rem; }
.relationship-tree { display: grid; gap: 8px; max-height: 520px; overflow: auto; }
.relationship-tree details { border-top: 1px solid var(--border); padding-top: 8px; }
.relationship-tree summary { display: flex; justify-content: space-between; gap: 8px; cursor: pointer; }
.relationship-tree summary span { color: var(--text-muted); font-size: .76rem; }
.grade-row { display: grid; grid-template-columns: 56px 1fr; gap: 8px; margin-top: 9px; font-size: .8rem; }
.grade-row > span { color: var(--text-muted); }
.grade-row ul { margin: 0; padding: 0; list-style: none; }
.grade-row li { display: grid; grid-template-columns: 54px 1fr; gap: 5px; padding: 2px 0; }
.index-job { display: grid; gap: 8px; margin-top: 14px; padding: 10px; border: 1px solid var(--border-strong); background: var(--bg-elevated); font-size: .78rem; }
.index-job-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.index-job-head > div { display: grid; }
.index-job-head > div > span { color: var(--cobalt); font-family: var(--font-mono); font-size: .65rem; letter-spacing: .08em; }
.index-note, .index-error { margin: 0; color: var(--text-secondary); }
.index-error { color: var(--danger); }
.index-progress-label { display: flex; justify-content: space-between; gap: 8px; color: var(--text-secondary); }
.index-progress { height: 6px; overflow: hidden; background: var(--bg-muted); }
.index-progress span { display: block; height: 100%; background: var(--cobalt); transition: width .24s ease; }
.index-result { display: grid; gap: 3px; padding-top: 7px; border-top: 1px solid var(--border); }
.error-state, .import-error { display: grid; gap: 6px; margin: 14px 0; padding: 12px; border-left: 4px solid var(--danger); background: var(--danger-soft); color: var(--danger); }
.error-state :deep(button) { justify-self: start; }
.check { display: flex; gap: 8px; align-items: center; }
.import-flow { display: grid; gap: 12px; }
.flow-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border); }
.flow-steps span { padding: 7px 9px; background: var(--bg-muted); color: var(--text-muted); font-size: .75rem; }
.flow-steps .current { color: var(--cobalt); background: var(--cobalt-soft); font-weight: 700; }
.diff-preview { border-top: 1px solid var(--border); padding-top: 12px; }
.diff-preview h3 { margin: 0 0 8px; }
.diff-counts { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border); }
.diff-counts span { padding: 8px; border-right: 1px solid var(--border); font-size: .76rem; }
.diff-counts span:last-child { border-right: 0; }
.diff-counts strong { display: block; font-size: 1.1rem; }
.diff-preview p { color: var(--text-secondary); font-size: .8rem; }
.diff-preview pre { max-height: 220px; overflow: auto; white-space: pre-wrap; background: var(--bg-muted); padding: 8px; font-size: .72rem; }
.safe-note { color: var(--success) !important; }
.receipt { display: grid; gap: 4px; padding: 11px; border-left: 4px solid var(--success); background: var(--success-soft); }
.receipt.pending { border-left-color: var(--warning); background: var(--warning-soft); }
.receipt span { font-size: .8rem; }
@media (max-width: 1080px) { .workspace { grid-template-columns: 1fr; } .relationship-panel { position: static; } }
@media (max-width: 760px) {
  .page-head { grid-template-columns: 1fr; }
  .head-actions { justify-content: flex-start; }
  .ledger-toolbar { display: grid; }
  .filters { grid-template-columns: 1fr; }
  .pager { justify-content: space-between; }
  .diff-counts { grid-template-columns: repeat(2, 1fr); }
  .diff-counts span:nth-child(2) { border-right: 0; }
}
</style>
