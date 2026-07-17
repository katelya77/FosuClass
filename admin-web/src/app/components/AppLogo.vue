<script setup lang="ts">
import { ref } from 'vue'

const LOGO_REMOTE =
  'https://pan.katelya.eu.org/file/tgs_eyJ2IjoxLCJmIjoiQWdBQ0FnVUFBeUVGQUFUYW1yME1BQUlCcjJvZEZiTTBGUVFjQzFUclVwVWlDNFdadG0tckFBSnBFR3NidWJQb1ZITjJyQjhxcWZNbkFRQURBZ0FEZVFBRE93USIsImUiOiJqcGciLCJuIjoicGhvdG9fNDMxLmpwZyIsIm0iOiJpbWFnZS9qcGVnIiwicyI6MTE0ODAwLCJ0IjoxNzgwMjkwOTk2MjkyLCJtaWQiOjQzMX0.pCRB9D4sdHdjeP1XpKnQfMVMlSCh37uQE67VGaKBWFw.jpg'

const props = withDefaults(
  defineProps<{ size?: number; alt?: string }>(),
  { size: 32, alt: '佛课小表' },
)

const failed = ref(false)
const src = ref(LOGO_REMOTE)

function onError() {
  if (!failed.value) {
    failed.value = true
    src.value = '/admin-app/logo-fallback.svg'
  }
}
</script>

<template>
  <span class="logo-wrap" :style="{ width: `${props.size}px`, height: `${props.size}px` }">
    <img
      :src="src"
      :alt="alt"
      :width="size"
      :height="size"
      referrerpolicy="no-referrer"
      decoding="async"
      @error="onError"
    />
  </span>
</template>

<style scoped>
.logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--brand-red-soft);
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
