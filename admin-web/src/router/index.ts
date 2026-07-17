import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AdminLayout from '@/app/layouts/AdminLayout.vue'
import LoginPage from '@/pages/LoginPage.vue'
import DashboardPage from '@/pages/DashboardPage.vue'
import SyncCenterPage from '@/pages/SyncCenterPage.vue'
import PlaceholderPage from '@/pages/PlaceholderPage.vue'

const router = createRouter({
  history: createWebHistory('/admin-next/'),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: DashboardPage,
          meta: { title: '运营总览', subtitle: 'Active · 新鲜度 · 阻断 · 下一步' },
        },
        {
          path: 'sync',
          name: 'sync',
          component: SyncCenterPage,
          meta: { title: '同步中心', subtitle: 'Staging → Release → Static → Verify → Active' },
        },
        {
          path: 'catalog',
          name: 'catalog',
          component: PlaceholderPage,
          meta: { title: '数据资源中心' },
        },
        {
          path: 'terms',
          name: 'terms',
          component: PlaceholderPage,
          meta: { title: '学期管理' },
        },
        {
          path: 'quality',
          name: 'quality',
          component: PlaceholderPage,
          meta: { title: '数据质量中心' },
        },
        {
          path: 'content',
          name: 'content',
          component: PlaceholderPage,
          meta: { title: '内容运营' },
        },
        {
          path: 'feedback',
          name: 'feedback',
          component: PlaceholderPage,
          meta: { title: '反馈' },
        },
        {
          path: 'campus-map',
          name: 'campus-map',
          component: PlaceholderPage,
          meta: { title: '校园地图' },
        },
        {
          path: 'security',
          name: 'security',
          component: PlaceholderPage,
          meta: { title: '安全' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: PlaceholderPage,
          meta: { title: '设置' },
        },
        {
          path: 'audit',
          name: 'audit',
          component: PlaceholderPage,
          meta: { title: '审计日志' },
        },
        {
          path: 'legacy',
          name: 'legacy-redirect',
          redirect: () => {
            window.location.href = '/admin/'
            return '/dashboard'
          },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: PlaceholderPage,
      meta: { title: '页面不存在', public: true },
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.bootstrapped) {
    await auth.bootstrap()
  }
  if (to.meta.public) {
    if (to.name === 'login' && auth.authenticated) {
      return { name: 'dashboard' }
    }
    return true
  }
  if (!auth.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
