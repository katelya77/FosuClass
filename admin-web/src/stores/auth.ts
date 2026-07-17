import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchSession, login as apiLogin, logout as apiLogout, type ApiError } from '@/shared/api/client'

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

  function clearSession(message = '') {
    authenticated.value = false
    if (message) error.value = message
  }

  function handleApiError(err: unknown) {
    const e = err as ApiError
    if (e && e.status === 401) {
      clearSession(e.message || '后台登录已过期，请重新登录')
      return true
    }
    return false
  }

  return {
    authenticated,
    loading,
    error,
    bootstrapped,
    bootstrap,
    login,
    logout,
    clearSession,
    handleApiError,
  }
})
