<script setup lang="ts">
import EmptyState from '@/shared/ui/EmptyState.vue'
import AppButton from '@/shared/ui/AppButton.vue'

defineProps<{ title: string; description: string; legacyHash: string }>()
</script>

<template>
  <section class="page">
    <EmptyState :title="title" :description="description">
      <template #action>
        <a :href="`/admin/${legacyHash}`"><AppButton variant="primary">旧版入口</AppButton></a>
        <AppButton variant="ghost" @click="$router.push('/dashboard')">返回总览</AppButton>
      </template>
    </EmptyState>
    <p class="note">Tier 3 故障隔离：本页失败不会拖垮课表 Active Pointer 与发布链路。</p>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 12px; }
.note { color: var(--text-muted); font-size: 0.85rem; }
</style>
