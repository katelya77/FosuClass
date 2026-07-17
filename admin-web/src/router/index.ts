import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getAdminRuntimePaths, legacyAdminRoot } from '@/shared/runtime/paths'
import AdminLayout from '@/app/layouts/AdminLayout.vue'
import LoginPage from '@/pages/LoginPage.vue'
import DashboardPage from '@/pages/DashboardPage.vue'
import SyncCenterPage from '@/pages/SyncCenterPage.vue'
import CatalogPage from '@/pages/CatalogPage.vue'
import TermsPage from '@/pages/TermsPage.vue'
import QualityPage from '@/pages/QualityPage.vue'
import ContentPage from '@/pages/ContentPage.vue'
import FeedbackPage from '@/pages/FeedbackPage.vue'
import CampusMapPage from '@/pages/CampusMapPage.vue'
import SecurityPage from '@/pages/SecurityPage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import AuditPage from '@/pages/AuditPage.vue'
import ExperimentalPage from '@/pages/ExperimentalPage.vue'
import BackupsPage from '@/pages/BackupsPage.vue'
import PlaceholderPage from '@/pages/PlaceholderPage.vue'

const runtimePaths = getAdminRuntimePaths()

const router = createRouter({
  history: createWebHistory(runtimePaths.spaBase),
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
          meta: { title: '运营总览', subtitle: 'Active · Published · 新鲜度 · 阻断 · 下一步' },
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
          component: CatalogPage,
          meta: { title: '数据资源中心' },
        },
        {
          path: 'terms',
          name: 'terms',
          component: TermsPage,
          meta: { title: '学期管理' },
        },
        {
          path: 'quality',
          name: 'quality',
          component: QualityPage,
          meta: { title: '数据质量中心' },
        },
        {
          path: 'content',
          name: 'content',
          component: ContentPage,
          meta: { title: '内容运营' },
        },
        {
          path: 'feedback',
          name: 'feedback',
          component: FeedbackPage,
          meta: { title: '反馈' },
        },
        {
          path: 'campus-map',
          name: 'campus-map',
          component: CampusMapPage,
          meta: { title: '校园地图' },
        },
        {
          path: 'assistant',
          name: 'assistant',
          component: ExperimentalPage,
          props: {
            title: '小佛助手知识库（Tier 3）',
            description:
              '实验功能。完整写路径仍在旧版后台；Provider/知识库故障不得阻塞课表。',
            legacySection: 'assistant-kb',
          },
          meta: { title: '小佛助手' },
        },
        {
          path: 'provider',
          name: 'provider',
          component: ExperimentalPage,
          props: {
            title: 'AI Provider（Tier 3）',
            description: 'Provider 配置完整写路径仍在旧版。故障降级不影响 Active Pointer。',
            legacySection: 'ai-provider',
          },
          meta: { title: 'Provider' },
        },
        {
          path: 'security',
          name: 'security',
          component: SecurityPage,
          meta: { title: '安全' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: SettingsPage,
          meta: { title: '设置' },
        },
        {
          path: 'audit',
          name: 'audit',
          component: AuditPage,
          meta: { title: '审计日志' },
        },
        {
          path: 'backups',
          name: 'backups',
          component: BackupsPage,
          meta: { title: '备份', subtitle: '列表 · 下载 · 删除 · 恢复预检' },
        },
        {
          path: 'legacy',
          name: 'legacy-redirect',
          redirect: () => {
            window.location.href = legacyAdminRoot()
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
