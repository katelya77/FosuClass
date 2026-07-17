<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  deleteBackup,
  downloadBackup,
  listBackups,
  listSnapshots,
  preflightRestore,
  restoreBackup,
  triggerBrowserDownload,
  type BackupItem,
  type RestorePreflight,
} from '@/features/backups/api'
import { canWriteModule, fetchCapabilities } from '@/shared/api/capabilities'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import AppModal from '@/shared/ui/AppModal.vue'
import AppTable from '@/shared/ui/AppTable.vue'
import LoadingBlock from '@/shared/ui/LoadingBlock.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const writeEnabled = ref(false)
const backups = ref<BackupItem[]>([])
const snapshots = ref<BackupItem[]>([])

const deleteOpen = ref(false)
const restoreOpen = ref(false)
const target = ref<BackupItem | null>(null)
const confirmText = ref('')
const preflight = ref<RestorePreflight | null>(null)

const backupColumns = [
  { key: 'filename', label: '文件名' },
  { key: 'type', label: '类型' },
  { key: 'size', label: '大小' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'restorable', label: '可恢复' },
  { key: 'actions', label: '操作', width: '260px' },
]

const snapshotColumns = [
  { key: 'filename', label: '文件名' },
  { key: 'kind', label: '类型' },
  { key: 'size', label: '大小' },
  { key: 'createdAt', label: '时间' },
  { key: 'actions', label: '操作', width: '120px' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await fetchCapabilities()
    writeEnabled.value = canWriteModule('backups', caps)
    const [b, s] = await Promise.all([listBackups(), listSnapshots()])
    backups.value = b
    snapshots.value = s
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    ui.toast(error.value, 'error')
  } finally {
    loading.value = false
  }
}

async function onDownload(filename: string) {
  busy.value = true
  try {
    const blob = await downloadBackup(filename)
    triggerBrowserDownload(blob, filename)
    ui.toast('下载已开始', 'success')
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '下载失败', 'error')
  } finally {
    busy.value = false
  }
}

function askDelete(row: BackupItem) {
  if (!writeEnabled.value) return
  target.value = row
  confirmText.value = ''
  deleteOpen.value = true
}

async function doDelete() {
  if (!target.value) return
  if (confirmText.value !== target.value.filename) {
    ui.toast('请输入完整文件名以确认删除', 'error')
    return
  }
  busy.value = true
  try {
    await deleteBackup(target.value.filename)
    ui.toast('备份已删除', 'success')
    deleteOpen.value = false
    await load()
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '删除失败', 'error')
  } finally {
    busy.value = false
  }
}

async function openRestore(row: BackupItem) {
  if (!writeEnabled.value) return
  target.value = row
  confirmText.value = ''
  preflight.value = null
  restoreOpen.value = true
  busy.value = true
  try {
    preflight.value = await preflightRestore(row.filename)
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '预检失败', 'error')
    restoreOpen.value = false
  } finally {
    busy.value = false
  }
}

async function doRestore(dryRun: boolean) {
  if (!target.value) return
  if (!dryRun && confirmText.value !== target.value.filename) {
    ui.toast('请输入完整文件名以确认恢复', 'error')
    return
  }
  busy.value = true
  try {
    const result = await restoreBackup(target.value.filename, {
      dryRun,
      confirm: target.value.filename,
    })
    if (dryRun) {
      ui.toast('Dry-run 通过，未写入数据', 'success')
    } else {
      ui.toast(result.restored ? '恢复成功' : '恢复完成', 'success')
      restoreOpen.value = false
      await load()
    }
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : '恢复失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <div class="head">
      <div>
        <h2>备份与快照</h2>
        <p>列表、下载、删除与恢复预检。恢复前必须确认文件名；生产自动化不得擅自恢复。</p>
      </div>
      <AppButton variant="primary" :loading="loading" @click="load">刷新</AppButton>
    </div>

    <LoadingBlock v-if="loading" />
    <p v-else-if="error" class="error">{{ error }}</p>

    <template v-else>
      <h3 class="sub">数据备份</h3>
      <AppTable :columns="backupColumns" :rows="backups as any" empty-text="暂无备份">
        <template #cell-restorable="{ value }">
          {{ value ? '是' : '否' }}
        </template>
        <template #cell-actions="{ row }">
          <div class="row-actions">
            <AppButton variant="ghost" :disabled="busy" @click="onDownload(String((row as BackupItem).filename))">
              下载
            </AppButton>
            <AppButton
              v-if="writeEnabled && (row as BackupItem).restorable"
              variant="ghost"
              :disabled="busy"
              @click="openRestore(row as BackupItem)"
            >
              恢复预检
            </AppButton>
            <AppButton
              v-if="writeEnabled"
              variant="ghost"
              :disabled="busy"
              @click="askDelete(row as BackupItem)"
            >
              删除
            </AppButton>
          </div>
        </template>
      </AppTable>

      <h3 class="sub">快照</h3>
      <AppTable :columns="snapshotColumns" :rows="snapshots as any" empty-text="暂无快照">
        <template #cell-actions="{ row }">
          <span class="muted">只读下载请走 API / 旧版高风险入口</span>
          <span class="sr-only">{{ (row as BackupItem).filename }}</span>
        </template>
      </AppTable>
    </template>

    <AppModal :open="deleteOpen" title="删除备份（危险）" @close="deleteOpen = false">
      <div class="danger-box">
        <p>将永久删除备份文件：</p>
        <p><strong>{{ target?.filename }}</strong></p>
        <p>类型：{{ target?.type }} · 大小：{{ target?.size }}</p>
        <p>影响：仅删除备份文件，不修改当前业务数据。删除后无法从该文件恢复。</p>
      </div>
      <AppFormField label="输入完整文件名以确认" required>
        <input v-model="confirmText" :placeholder="target?.filename" autocomplete="off" />
      </AppFormField>
      <template #footer>
        <AppButton variant="ghost" @click="deleteOpen = false">取消</AppButton>
        <AppButton variant="danger" :loading="busy" @click="doDelete">确认删除</AppButton>
      </template>
    </AppModal>

    <AppModal :open="restoreOpen" title="恢复备份（危险）" @close="restoreOpen = false">
      <div class="danger-box">
        <p>目标备份：<strong>{{ target?.filename }}</strong></p>
        <template v-if="preflight">
          <p>类型：{{ preflight.type }} · 可恢复：{{ preflight.restorable ? '是' : '否' }}</p>
          <p>目标路径：{{ preflight.targetPath || '—' }}</p>
          <p>条目/键数量：{{ preflight.itemCount ?? '—' }}</p>
          <p v-if="preflight.impact">回滚点：{{ preflight.impact.rollback }}</p>
          <p v-if="preflight.impact">是否影响小程序：{{ preflight.impact.affectsMiniprogram ? '可能' : '通常否' }}</p>
          <ul v-if="preflight.blockers?.length">
            <li v-for="b in preflight.blockers" :key="b" class="error">阻断：{{ b }}</li>
          </ul>
          <ul v-if="preflight.warnings?.length">
            <li v-for="w in preflight.warnings" :key="w">警告：{{ w }}</li>
          </ul>
        </template>
      </div>
      <AppFormField label="输入完整文件名以确认真实恢复" required>
        <input v-model="confirmText" :placeholder="target?.filename" autocomplete="off" />
      </AppFormField>
      <template #footer>
        <AppButton variant="ghost" @click="restoreOpen = false">取消</AppButton>
        <AppButton variant="secondary" :loading="busy" @click="doRestore(true)">Dry Run</AppButton>
        <AppButton
          variant="danger"
          :loading="busy"
          :disabled="!preflight?.ok"
          @click="doRestore(false)"
        >
          确认恢复
        </AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; }
.head p { margin: 4px 0 0; color: var(--text-secondary); }
.sub { margin: 8px 0 0; font-size: 1rem; }
.error { color: var(--danger); }
.row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.danger-box {
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  margin-bottom: 12px;
}
.danger-box p { margin: 0 0 6px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
