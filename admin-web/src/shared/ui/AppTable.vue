<script setup lang="ts" generic="T extends Record<string, unknown>">
defineProps<{
  columns: Array<{ key: string; label: string; width?: string }>
  rows: T[]
  rowKey?: string
  loading?: boolean
  emptyText?: string
}>()
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" :style="col.width ? { width: col.width } : undefined">
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td :colspan="columns.length" class="state">加载中…</td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length" class="state">{{ emptyText || '暂无数据' }}</td>
        </tr>
        <tr v-for="(row, index) in rows" :key="String(row[rowKey || 'id'] ?? index)">
          <td v-for="col in columns" :key="col.key">
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] ?? '—' }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}
th,
td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-weight: 600;
  white-space: nowrap;
}
tr:last-child td {
  border-bottom: 0;
}
.state {
  text-align: center;
  color: var(--text-muted);
  padding: 28px 12px;
}
</style>
