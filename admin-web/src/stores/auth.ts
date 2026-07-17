import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchSession, login as apiLogin, logout as apiLogout } from '@/shared/api/client'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const loading = ref(false)
  const error = ref('')
  const bootstrapped = ref(false)

  async function bootstrap() {
    loading.value = true
    error.value = ''
    try {
      const session = await fetchSession()
      authenticated.value = session.authenticated
    } catch {
      authenticated.value = false
    } finally {
      loading.value = false
      bootstrapped.value = true
    }
  }

  async function login(password: string) {
    loading.value = true
    error.value = ''
    try {
      await apiLogin(password)
      authenticated.value = true
      return true
    } catch (e) {
      authenticated.value = false
      error.value = e instanceof Error ? e.message : '登录失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    loading.value = true
    try {
      await apiLogout()
    } finally {
      authenticated.value = false
      loading.value = false
    }
  }

  return { authenticated, loading, error, bootstrapped, bootstrap, login, logout }
})
