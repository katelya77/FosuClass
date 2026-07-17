<script setup lang="ts">
import EmptyState from '@/shared/ui/EmptyState.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { legacyAdminUrl } from '@/shared/runtime/paths'

const props = defineProps<{ title: string; description: string; legacySection: string }>()
const legacyHref = legacyAdminUrl(props.legacySection)
</script>

<template>
  <section class="page">
    <EmptyState :title="title" :description="description">
      <template #action>
        <a :href="legacyHref"><AppButton variant="primary">旧版入口</AppButton></a>
        <AppButton variant="ghost" @click="$router.push('/dashboard')">返回总览</AppButton>
      </template>
    </EmptyState>
    <p class="note">Tier 3 / 写路径：完整编辑仍在旧版后台；本页失败不会拖垮课表 Active Pointer。</p>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 12px; }
.note { color: var(--text-muted); font-size: 0.85rem; }
</style>
