<script setup lang="ts">
import EmptyState from '@/shared/ui/EmptyState.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import { legacyAdminUrl } from '@/shared/runtime/paths'

const legacyMapHref = legacyAdminUrl('campus-map')
</script>

<template>
  <section class="page">
    <EmptyState
      title="校园地图（Tier 2）"
      description="地图编辑器与资源发布链路保持在旧版与专用工具中，避免实验故障影响 Release。完整写路径仍在迁移。"
    >
      <template #action>
        <a :href="legacyMapHref"><AppButton variant="primary">打开旧版地图运营</AppButton></a>
        <AppButton variant="ghost" @click="$router.push('/dashboard')">返回总览</AppButton>
      </template>
    </EmptyState>
  </section>
</template>

<style scoped>
.page { display: grid; gap: 12px; }
</style>
