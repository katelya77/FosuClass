<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppLogo from '@/app/components/AppLogo.vue'
import AppButton from '@/shared/ui/AppButton.vue'
import AppFormField from '@/shared/ui/AppFormField.vue'
import { getAdminRuntimePaths, legacyAdminRoot } from '@/shared/runtime/paths'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const password = ref('')
const paths = getAdminRuntimePaths()
const legacyHref = legacyAdminRoot()

async function onSubmit() {
  const ok = await auth.login(password.value)
  if (ok) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    router.replace(redirect)
  }
}
</script>

<template>
  <div class="login-page">
    <form class="card" @submit.prevent="onSubmit">
      <div class="brand">
        <AppLogo :size="48" />
        <div>
          <h1>校园数据运营台</h1>
          <p>佛课小表 · 只读运营视图（写路径仍在迁移）</p>
        </div>
      </div>

      <AppFormField label="管理员密码或令牌" for-id="password" required>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="输入 ADMIN_PASSWORD 或 ADMIN_TOKEN"
          required
        />
      </AppFormField>

      <p v-if="auth.error" class="error" role="alert">{{ auth.error }}</p>

      <AppButton type="submit" variant="primary" block :loading="auth.loading">登录</AppButton>

      <p class="foot">
        当前挂载 <code>{{ paths.spaBase }}</code> ·
        <a :href="legacyHref">打开旧版后台（生产主后台）</a>
      </p>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at top right, rgba(198, 40, 40, 0.08), transparent 40%),
    radial-gradient(circle at bottom left, rgba(21, 101, 192, 0.1), transparent 42%),
    var(--bg);
}
.card {
  width: min(420px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 28px 24px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}
.brand h1 {
  margin: 0;
  font-size: 1.2rem;
}
.brand p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.error {
  color: var(--danger);
  margin: 0 0 12px;
  font-size: 0.9rem;
}
.foot {
  margin: 16px 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}
code {
  font-family: var(--font-mono);
  font-size: 0.78rem;
}
</style>
