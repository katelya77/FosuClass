<script setup lang="ts">
import { onMounted } from 'vue'
import { useTheme } from '@/shared/theme/useTheme'

useTheme()
onMounted(() => {
  document.documentElement.lang = 'zh-CN'
})
</script>

<template>
  <RouterView />
</template>
