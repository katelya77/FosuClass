<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  getQualityIgnores,
  getQualityRecheck,
  getQualityReport,
  setQualityIgnore,
  startQualityRecheck,
  type QualityFinding,
  type QualityJob,
  type QualityReport,
} from '@/features/quality/api'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import { createIdempotencyKey, type ApiError } from '@/shared/api/client'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import EmptyState from '@/shared/ui/EmptyState.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

type QualityTab = 'active' | 'ignored'

const ui = useUiStore()
const loading = ref(true)
const error = ref('')
const report = ref<QualityReport | null>(null)
const ignoresVersion = ref('')
const writeEnabled = ref(false)
const tab = ref<QualityTab>('active')
const keyword = ref('')
const severity = ref('')
const busyFingerprint = ref('')
const actionError = ref('')

const reasonOpen = ref(false)
const reason = ref('')
const selectedFinding = ref<QualityFinding | null>(null)
const operationKeys = new Map<string, string>()

const recheckJob = ref<QualityJob | null>(null)
const recheckError = ref('')
const recheckStarting = ref(false)
const recheckOperationKey = ref('')
let pollTimer: number | null = null

const columns = computed(() => [
  { key: 'severity', label: '级别', width: '86px' },
  { key: 'type', label: '检查项' },
  { key: 'target', label: '资源' },
  { key: 'original', label: '发现' },
  ...(tab.value === 'ignored' ? [{ key: 'reason', label: '忽略原因' }] : []),
  { key: 'suggestion', label: '建议' },
  { key: 'actions', label: '操作', width: '128px' },
])

const sourceRows = computed(() => tab.value === 'active' ? report.value?.active || [] : report.value?.ignored || [])
const filteredRows = computed(() => sourceRows.value.filter((finding) => {
  if (severity.value && finding.severity !== severity.value) return false
  if (!keyword.value.trim()) return true
  const needle = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return [finding.type, finding.target, finding.original, finding.message, finding.suggestion, finding.reason]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))
}))

const summary = computed(() => report.value?.summary || { activeCount: 0, ignoredCount: 0, totalCount: 0 })
const jobProgress = computed(() => Math.max(0, Math.min(100, Number(recheckJob.value?.progress || 0))))
const jobStatusLabel = computed(() => {
  const status = recheckJob.value?.status
  if (status === 'queued') return '排队中'
  if (status === 'running') return '复检中'
  if (status === 'success') return '复检完成'
  if (status === 'failed') return '复检失败'
  return status || '未启动'
})

function message(errorValue: unknown, fallback: string) {
  return errorValue instanceof Error ? errorValue.message : fallback
}

async function loadData(options: { capabilities?: boolean } = {}) {
  loading.value = true
  error.value = ''
  try {
    if (options.capabilities !== false) {
      try {
        const caps = await fetchCapabilities(true)
        writeEnabled.value = canWriteModule('quality', caps)
      } catch {
        // Capability discovery is a write-safety gate. A failure must keep the
        // page read-only without hiding the independently readable report.
        writeEnabled.value = false
      }
    }
    const [nextReport, ignoreDocument] = await Promise.all([getQualityReport(), getQualityIgnores()])
    report.value = nextReport
    ignoresVersion.value = ignoreDocument.version
  } catch (loadError) {
    error.value = message(loadError, '质量报告加载失败')
    report.value = null
  } finally {
    loading.value = false
  }
}

function openIgnore(finding: QualityFinding) {
  if (!writeEnabled.value) return
  selectedFinding.value = finding
  reason.value = ''
  actionError.value = ''
  reasonOpen.value = true
}

function operationKey(finding: QualityFinding, action: 'ignore' | 'restore') {
  const key = `${action}:${finding.fingerprint}`
  if (!operationKeys.has(key)) operationKeys.set(key, createIdempotencyKey(`quality-${action}`))
  return { mapKey: key, idempotencyKey: operationKeys.get(key)! }
}

async function mutateFinding(finding: QualityFinding, ignore: boolean, why: string) {
  if (!writeEnabled.value) return
  busyFingerprint.value = finding.fingerprint
  actionError.value = ''
  const key = operationKey(finding, ignore ? 'ignore' : 'restore')
  try {
    const result = await setQualityIgnore(finding, {
      ignore,
      reason: why,
      version: ignoresVersion.value,
      idempotencyKey: key.idempotencyKey,
    })
    operationKeys.delete(key.mapKey)
    reasonOpen.value = false
    ui.toast(
      result.auditPending
        ? `${ignore ? '忽略' : '恢复'}已提交，审计记录正在补写`
        : ignore ? '问题已忽略并记录原因' : '问题已恢复到当前检查',
      result.auditPending ? 'warning' : 'success',
    )
    await loadData({ capabilities: false })
  } catch (mutationError) {
    const apiError = mutationError as ApiError
    if (apiError.status === 428) actionError.value = '缺少质量规则版本；请刷新报告后重试。'
    else if (apiError.status === 409) actionError.value = '质量忽略规则已被其他请求修改；已保留你的操作，请刷新后重试。'
    else actionError.value = message(mutationError, '质量状态更新失败')
  } finally {
    busyFingerprint.value = ''
  }
}

async function confirmIgnore() {
  if (!selectedFinding.value) return
  if (!reason.value.trim()) {
    actionError.value = '请填写可供后续追溯的忽略原因。'
    return
  }
  await mutateFinding(selectedFinding.value, true, reason.value.trim())
}

async function restoreFinding(finding: QualityFinding) {
  await mutateFinding(finding, false, '管理员恢复检查')
}

function clearPoll() {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll() {
  clearPoll()
  if (!recheckJob.value || ['success', 'failed'].includes(recheckJob.value.status)) return
  pollTimer = window.setTimeout(() => void pollRecheck(), 700)
}

async function pollRecheck() {
  if (!recheckJob.value) return
  try {
    recheckJob.value = await getQualityRecheck(recheckJob.value.id)
    if (recheckJob.value.status === 'success') {
      recheckError.value = ''
      await loadData({ capabilities: false })
    } else if (recheckJob.value.status === 'failed') {
      recheckError.value = recheckJob.value.error || recheckJob.value.message || '复检任务失败'
    }
  } catch (pollError) {
    recheckError.value = message(pollError, '复检状态读取失败')
  }
  schedulePoll()
}

async function beginRecheck() {
  if (!writeEnabled.value) return
  recheckStarting.value = true
  recheckError.value = ''
  try {
    recheckOperationKey.value ||= createIdempotencyKey('quality-recheck')
    recheckJob.value = await startQualityRecheck({ reason: 'operator', requestedAt: new Date().toISOString() }, recheckOperationKey.value)
    recheckOperationKey.value = ''
    schedulePoll()
  } catch (startError) {
    const apiError = startError as ApiError
    recheckError.value = apiError.status === 409
      ? '已有质量复检正在运行；请稍后刷新任务状态。'
      : message(startError, '无法启动质量复检')
  } finally {
    recheckStarting.value = false
  }
}

function exportReport() {
  if (!report.value) return
  const blob = new Blob([`${JSON.stringify(report.value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `quality-report-${report.value.generatedAt.replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(() => void loadData())
onUnmounted(clearPoll)
</script>

<template>
  <section class="page" aria-labelledby="quality-title">
    <header class="page-head">
      <div>
        <p class="eyebrow">QUALITY · 可追溯检查</p>
        <h2 id="quality-title">数据质量台账</h2>
        <p>当前问题与已忽略问题分开保留；每次忽略都有原因，恢复会重新进入检查，复检在后台任务中执行。</p>
      </div>
      <div class="head-actions">
        <AppButton variant="secondary" :disabled="!report" @click="exportReport">导出报告</AppButton>
        <AppButton variant="secondary" :loading="loading" @click="loadData()">刷新</AppButton>
        <AppButton variant="primary" :disabled="!writeEnabled" :loading="recheckStarting" @click="beginRecheck">开始异步复检</AppButton>
      </div>
    </header>

    <div v-if="!writeEnabled" class="readonly-banner" role="status">
      生产 Quality 写模块当前关闭；报告和忽略原因可读，忽略、恢复与异步复检不可提交。
    </div>

    <section v-if="recheckJob || recheckError" class="job-strip" :class="{ failed: recheckError }" aria-labelledby="quality-job-title">
      <div>
        <p class="section-kicker">BACKGROUND JOB</p>
        <strong id="quality-job-title">{{ jobStatusLabel }}</strong>
        <span v-if="recheckJob">任务 {{ recheckJob.id }}</span>
      </div>
      <div v-if="recheckJob" class="progress-wrap">
        <div class="progress-label"><span>{{ recheckJob.message || '等待任务进度' }}</span><strong>{{ jobProgress }}%</strong></div>
        <div class="progress" role="progressbar" :aria-valuenow="jobProgress" aria-valuemin="0" aria-valuemax="100" :aria-label="jobStatusLabel">
          <span :style="{ width: `${jobProgress}%` }" />
        </div>
      </div>
      <p v-if="recheckError" class="job-error" role="alert">{{ recheckError }}</p>
    </section>

    <div class="summary" aria-label="质量摘要">
      <div><span>当前问题</span><strong>{{ summary.activeCount }}</strong></div>
      <div><span>已忽略</span><strong>{{ summary.ignoredCount }}</strong></div>
      <div><span>全部发现</span><strong>{{ summary.totalCount }}</strong></div>
      <div><span>报告时间</span><strong class="time">{{ report ? new Date(report.generatedAt).toLocaleString('zh-CN') : '—' }}</strong></div>
    </div>

    <section class="ledger" aria-labelledby="quality-ledger-title">
      <div class="ledger-head">
        <div>
          <p class="section-kicker">FINDING LEDGER</p>
          <h3 id="quality-ledger-title">检查结果</h3>
        </div>
        <div class="tabs" role="tablist" aria-label="问题状态">
          <button type="button" role="tab" :aria-selected="tab === 'active'" :class="{ active: tab === 'active' }" @click="tab = 'active'">当前问题 {{ summary.activeCount }}</button>
          <button type="button" role="tab" :aria-selected="tab === 'ignored'" :class="{ active: tab === 'ignored' }" @click="tab = 'ignored'">已忽略 {{ summary.ignoredCount }}</button>
        </div>
        <div class="filters" role="search">
          <AppFormField label="级别" for-id="quality-severity">
            <select id="quality-severity" v-model="severity">
              <option value="">全部</option>
              <option value="danger">严重</option>
              <option value="warning">警告</option>
              <option value="info">提示</option>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </AppFormField>
          <AppFormField label="关键词" for-id="quality-keyword">
            <input id="quality-keyword" v-model="keyword" placeholder="资源、检查项或原因" />
          </AppFormField>
        </div>
      </div>

      <div v-if="actionError" class="action-error" role="alert">
        <span>{{ actionError }}</span><AppButton variant="secondary" @click="loadData({ capabilities: false })">刷新规则版本</AppButton>
      </div>
      <LoadingBlock v-if="loading" label="正在生成质量报告…" />
      <div v-else-if="error" class="load-error" role="alert"><strong>质量报告不可用</strong><span>{{ error }}</span><AppButton variant="secondary" @click="loadData()">重试</AppButton></div>
      <EmptyState
        v-else-if="!filteredRows.length"
        :title="tab === 'active' ? '当前没有匹配的问题' : '没有已忽略的问题'"
        :description="keyword || severity ? '请清除筛选条件后再查看。' : tab === 'active' ? '本次报告没有需要处理的发现。' : '忽略操作会在这里保留原因与时间。'"
      />
      <AppTable v-else :columns="columns" :rows="filteredRows" row-key="fingerprint">
        <template #cell-severity="{ value }"><span class="severity" :data-level="value">{{ value }}</span></template>
        <template #cell-original="{ row }">{{ (row as QualityFinding).original || (row as QualityFinding).message || '—' }}</template>
        <template #cell-reason="{ row }">
          <div class="reason-cell"><strong>{{ (row as QualityFinding).reason || '未记录原因' }}</strong><span v-if="(row as QualityFinding).ignoredAt">{{ new Date(String((row as QualityFinding).ignoredAt)).toLocaleString('zh-CN') }}</span></div>
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            v-if="tab === 'active'"
            variant="ghost"
            :disabled="!writeEnabled || busyFingerprint === (row as QualityFinding).fingerprint"
            @click="openIgnore(row as QualityFinding)"
          >忽略并说明</AppButton>
          <AppButton
            v-else
            variant="ghost"
            :loading="busyFingerprint === (row as QualityFinding).fingerprint"
            :disabled="!writeEnabled"
            @click="restoreFinding(row as QualityFinding)"
          >恢复检查</AppButton>
        </template>
      </AppTable>
    </section>

    <AppModal :open="reasonOpen" title="记录忽略原因" @close="reasonOpen = false">
      <p class="finding-context"><strong>{{ selectedFinding?.target }}</strong><span>{{ selectedFinding?.original || selectedFinding?.message }}</span></p>
      <AppFormField label="忽略原因" for-id="quality-ignore-reason" required :error="actionError" hint="原因会随规则保留，便于后续恢复和审计。">
        <textarea id="quality-ignore-reason" v-model="reason" rows="4" maxlength="500" autofocus />
      </AppFormField>
      <template #footer>
        <AppButton variant="ghost" @click="reasonOpen = false">取消</AppButton>
        <AppButton variant="primary" :loading="Boolean(busyFingerprint)" @click="confirmIgnore">确认忽略</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 16px; }
.page-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; border-bottom: 1px solid var(--border-strong); padding-bottom: 16px; }
.eyebrow, .section-kicker { margin: 0 0 4px; color: var(--cobalt); font-size: .72rem; font-weight: 700; letter-spacing: .13em; }
.page-head h2 { margin: 0; font-size: clamp(1.5rem, 2.4vw, 2.15rem); letter-spacing: -.035em; }
.page-head p:not(.eyebrow) { max-width: 760px; margin: 6px 0 0; color: var(--text-secondary); }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.readonly-banner { border-left: 4px solid var(--warning); background: var(--warning-soft); padding: 10px 12px; color: var(--text-secondary); }
.job-strip { display: grid; grid-template-columns: 180px minmax(220px, 1fr); gap: 18px; align-items: center; padding: 12px 14px; border: 1px solid var(--border); background: var(--cobalt-soft); }
.job-strip > div:first-child { display: grid; }
.job-strip > div:first-child span { color: var(--text-muted); font-family: var(--font-mono); font-size: .72rem; }
.job-strip.failed { background: var(--danger-soft); border-color: var(--danger); }
.progress-label { display: flex; justify-content: space-between; gap: 8px; font-size: .8rem; }
.progress { height: 7px; margin-top: 6px; background: var(--bg-muted); overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--cobalt); transition: width .24s ease; }
.job-error { grid-column: 1 / -1; margin: 0; color: var(--danger); }
.summary { display: grid; grid-template-columns: repeat(3, minmax(100px, 150px)) minmax(180px, 1fr); border-block: 1px solid var(--border); background: var(--surface); }
.summary > div { padding: 10px 14px; border-right: 1px solid var(--border); }
.summary > div:last-child { border-right: 0; }
.summary span { display: block; color: var(--text-muted); font-size: .74rem; }
.summary strong { display: block; font-size: 1.25rem; }
.summary .time { font-size: .9rem; font-weight: 600; }
.ledger { min-width: 0; border: 1px solid var(--border); background: var(--surface); padding: 14px; }
.ledger-head { display: grid; grid-template-columns: auto auto minmax(300px, 1fr); gap: 16px; align-items: end; margin-bottom: 12px; }
.ledger h3 { margin: 0; font-size: 1.05rem; }
.tabs { display: flex; border: 1px solid var(--border-strong); }
.tabs button { min-height: 36px; padding: 0 11px; border: 0; border-right: 1px solid var(--border-strong); background: var(--surface); color: var(--text-secondary); cursor: pointer; }
.tabs button:last-child { border-right: 0; }
.tabs button.active { background: var(--text); color: var(--text-inverse); }
.filters { display: grid; grid-template-columns: 128px minmax(170px, 1fr); gap: 8px; justify-self: end; width: min(100%, 420px); }
.filters :deep(.field) { margin-bottom: 0; }
.action-error, .load-error { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; padding: 10px 12px; border-left: 4px solid var(--danger); background: var(--danger-soft); color: var(--danger); }
.load-error { display: grid; }
.load-error :deep(button) { justify-self: start; }
.severity { display: inline-block; padding: 2px 7px; border: 1px solid currentColor; color: var(--text-secondary); font-family: var(--font-mono); font-size: .72rem; }
.severity[data-level='danger'], .severity[data-level='critical'], .severity[data-level='high'] { color: var(--danger); background: var(--danger-soft); }
.severity[data-level='warning'], .severity[data-level='medium'] { color: var(--warning); background: var(--warning-soft); }
.severity[data-level='info'], .severity[data-level='low'] { color: var(--info); background: var(--info-soft); }
.reason-cell { display: grid; gap: 2px; }
.reason-cell span { color: var(--text-muted); font-size: .72rem; }
.finding-context { display: grid; gap: 4px; margin: 0 0 14px; padding: 10px; background: var(--bg-muted); }
.finding-context span { color: var(--text-secondary); }
@media (max-width: 1080px) { .ledger-head { grid-template-columns: 1fr auto; } .filters { grid-column: 1 / -1; justify-self: stretch; width: 100%; } }
@media (max-width: 760px) {
  .page-head { grid-template-columns: 1fr; }
  .head-actions { justify-content: flex-start; }
  .job-strip { grid-template-columns: 1fr; }
  .summary { grid-template-columns: repeat(2, 1fr); }
  .summary > div:nth-child(2) { border-right: 0; }
  .ledger-head { grid-template-columns: 1fr; }
  .tabs { width: 100%; }
  .tabs button { flex: 1; }
  .filters { grid-column: auto; grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .progress span { transition: none; } }
</style>
