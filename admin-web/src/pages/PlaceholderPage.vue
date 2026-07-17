<script setup lang="ts">
import { useRoute } from 'vue-router'
import EmptyState from '@/shared/ui/EmptyState.vue'
import AppButton from '@/shared/ui/AppButton.vue'

const route = useRoute()
</script>

<template>
  <section class="page">
    <EmptyState
      :title="`${String(route.meta.title || '页面')} 迁移中`"
      description="新后台骨架已就绪。此模块将在后续阶段接入相同 API，旧版后台功能保持可用。"
    >
      <template #action>
        <AppButton variant="primary" @click="$router.push('/dashboard')">返回总览</AppButton>
        <a class="legacy" href="/admin/">在旧版打开</a>
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
