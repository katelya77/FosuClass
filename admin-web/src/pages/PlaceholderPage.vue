<script setup lang="ts">
import { useRoute } from 'vue-router'
import EmptyState from '@/shared/ui/EmptyState.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { legacyAdminRoot } from '@/shared/runtime/paths'

const route = useRoute()
const legacyHref = legacyAdminRoot()
</script>

<template>
  <section class="page">
    <EmptyState
      :title="`${String(route.meta.title || '页面')} 迁移中`"
      description="Vue 后台第一阶段为只读运营视图。完整写路径仍在旧版（当前生产主后台）。"
    >
      <template #action>
        <AppButton variant="primary" @click="$router.push('/dashboard')">返回总览</AppButton>
        <a class="legacy" :href="legacyHref">在旧版打开</a>
      </template>
    </EmptyState>
  </section>
</template>

<style scoped>
.page {
  display: grid;
  gap: 12px;
}
.legacy {
  margin-left: 12px;
  font-size: 0.9rem;
}
</style>
