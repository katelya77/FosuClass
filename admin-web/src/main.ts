import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './shared/api/client'
import { useAuthStore } from './stores/auth'
import './styles/tokens.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

setUnauthorizedHandler((message) => {
  const auth = useAuthStore(pinia)
  auth.clearSession(message)
  const redirect = router.currentRoute.value.fullPath
  if (router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login', query: { redirect } })
  }
})

app.config.errorHandler = (err, _instance, info) => {
  console.error('[admin-web]', info, err)
}

app.mount('#app')
