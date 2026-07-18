import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { clearCapabilitiesCache } from '@/shared/api/capabilities'
import CatalogPage from './CatalogPage.vue'
import QualityPage from './QualityPage.vue'
import SettingsPage from './SettingsPage.vue'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function capabilities() {
  return {
    success: true,
    primary: 'legacy',
    legacyEnabled: true,
    nextEnabled: true,
    writeModules: { catalog: true, quality: true, settings: true },
    writeModuleList: ['catalog', 'quality', 'settings'],
    paths: { next: '/admin-next', legacy: '/admin-legacy' },
  }
}

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll('button').find((item) => item.text().includes(label))
  if (!match) throw new Error(`button not found: ${label}`)
  return match
}

describe('C1 pages', () => {
  beforeEach(() => {
    clearCapabilitiesCache()
    document.body.innerHTML = '<div id="test-root"></div>'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('Catalog uses server pagination, disables next on the last page and renders college-major relationships', async () => {
    vi.useFakeTimers()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let indexJobReads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url === '/api/admin/capabilities') return response(capabilities())
        if (url === '/api/admin/catalog/stats') {
          return response({ success: true, data: { classCount: 31, collegeCount: 1, currentSemester: '2025-2026-2' } })
        }
        if (url === '/api/admin/catalog/relationships') {
          return response({
            success: true,
            colleges: [{ id: '01', name: '计算机学院', grades: [{ grade: '2024', majors: [{ id: '0809', name: '软件工程' }] }] }],
            relationshipVersion: 'rel-1',
            generationId: 'catgen-1',
            source: { kind: 'catalog-staging', published: false },
          })
        }
        if (url === '/api/admin/catalog/indexes/rebuild/start') {
          return response({ success: true, job: { id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: 'queued', progress: 0 } }, 202)
        }
        if (url === '/api/admin/catalog/indexes/rebuild/catalog-index-job-1') {
          indexJobReads += 1
          const completed = indexJobReads > 1
          return response({ success: true, job: {
            id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: completed ? 'success' : 'running',
            progress: completed ? 100 : 60, message: completed ? '目录索引重建完成' : '正在重建派生索引',
            result: completed ? { generationId: 'catgen-1', relationshipVersion: 'rel-2', builtAt: '2026-07-19T12:00:00.000Z', counts: { majors: 1 } } : undefined,
          } })
        }
        if (url.includes('page=2')) {
          return response({
            success: true,
            items: [{ id: 'class:last', className: '软件工程 31 班', collegeName: '计算机学院' }],
            total: 31,
            page: 2,
            pageSize: 30,
            totalPages: 2,
            generationId: 'catgen-1',
            source: { kind: 'catalog-staging', published: false },
          })
        }
        if (url.startsWith('/api/admin/catalog/resources?')) {
          return response({
            success: true,
            items: [{ id: 'class:first', className: '软件工程 1 班', collegeName: '计算机学院' }],
            total: 31,
            page: 1,
            pageSize: 30,
            totalPages: 2,
            generationId: 'catgen-1',
            source: { kind: 'catalog-staging', published: false },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(CatalogPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('计算机学院')
    expect(wrapper.text()).toContain('软件工程')
    expect(button(wrapper, '下一页').attributes('disabled')).toBeUndefined()

    await button(wrapper, '下一页').trigger('click')
    await flushPromises()

    expect(calls.some((call) => call.url.includes('/api/admin/catalog/resources?') && call.url.includes('page=2'))).toBe(true)
    expect(wrapper.text()).toContain('第 2 / 2 页')
    expect(button(wrapper, '下一页').attributes()).toHaveProperty('disabled')

    await button(wrapper, '重建目录索引').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('排队中')
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(wrapper.text()).toContain('60%')
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(wrapper.text()).toContain('目录索引重建完成')
    expect(wrapper.text()).toContain('rel-2')
    const startCall = calls.find((call) => call.url === '/api/admin/catalog/indexes/rebuild/start')
    expect(JSON.parse(String(startCall?.init?.body))).toEqual({ generationId: 'catgen-1', reason: 'operator' })
    wrapper.unmount()
  })

  it('Quality exposes ignored reasons, restore action and asynchronous recheck progress', async () => {
    vi.useFakeTimers()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let jobReads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url === '/api/admin/capabilities') return response(capabilities())
        if (url === '/api/admin/quality/report') {
          return response({
            success: true,
            data: {
              active: [{ type: 'missing-room', target: '课程 A', fingerprint: 'missing-room::课程 A', severity: 'warning', original: '缺少教室', suggestion: '补充教室' }],
              ignored: [{ type: 'few-courses', target: '软件 2 班', fingerprint: 'few-courses::软件 2 班', severity: 'info', status: 'ignored', reason: '新开班，课程尚未齐备', ignoredAt: '2026-07-19T12:00:00.000Z' }],
              summary: { activeCount: 1, ignoredCount: 1, totalCount: 2 },
              generatedAt: '2026-07-19T12:00:00.000Z',
            },
          })
        }
        if (url === '/api/admin/quality/ignores') return response({ success: true, version: 'qi_v1', updatedAt: null, rules: [] })
        if (url === '/api/admin/quality/recheck/start') {
          return response({ success: true, job: { id: 'quality-job-1', type: 'quality-recheck', status: 'queued', progress: 0 } }, 202)
        }
        if (url === '/api/admin/quality/recheck/quality-job-1') {
          jobReads += 1
          return response({ success: true, job: { id: 'quality-job-1', type: 'quality-recheck', status: jobReads > 1 ? 'success' : 'running', progress: jobReads > 1 ? 100 : 55, message: jobReads > 1 ? '复检完成' : '正在重新检查' } })
        }
        if (url === '/api/admin/quality/mark') return response({ success: true, version: 'qi_v2', ignores: [] })
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(QualityPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    await button(wrapper, '已忽略').trigger('click')
    expect(wrapper.text()).toContain('新开班，课程尚未齐备')
    expect(wrapper.text()).toContain('恢复检查')

    await button(wrapper, '开始异步复检').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('排队中')

    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(wrapper.text()).toContain('55%')
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()
    expect(wrapper.text()).toContain('复检完成')
    expect(calls.some((call) => call.url === '/api/admin/quality/recheck/start')).toBe(true)
    wrapper.unmount()
  })

  it('Quality remains readable when capability discovery is unavailable', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        if (url === '/api/admin/capabilities') {
          return response({ success: false, message: 'capability service unavailable' }, 503)
        }
        if (url === '/api/admin/quality/report') {
          return response({
            success: true,
            data: {
              active: [{ type: 'missing-room', target: '课程 A', fingerprint: 'missing-room::课程 A', severity: 'warning' }],
              ignored: [],
              summary: { activeCount: 1, ignoredCount: 0, totalCount: 1 },
              generatedAt: '2026-07-19T12:00:00.000Z',
            },
          })
        }
        if (url === '/api/admin/quality/ignores') {
          return response({ success: true, version: 'qi_v1', updatedAt: null, rules: [] })
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(QualityPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    expect(calls).toContain('/api/admin/quality/report')
    expect(wrapper.text()).toContain('课程 A')
    expect(wrapper.text()).toContain('生产 Quality 写模块当前关闭')
    expect(wrapper.text()).not.toContain('质量报告不可用')
    wrapper.unmount()
  })

  it('Quality renders the durable job error message instead of an object placeholder', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url === '/api/admin/capabilities') return response(capabilities())
        if (url === '/api/admin/quality/report') {
          return response({ success: true, data: { active: [], ignored: [], summary: { activeCount: 0, ignoredCount: 0, totalCount: 0 }, generatedAt: '2026-07-19T12:00:00.000Z' } })
        }
        if (url === '/api/admin/quality/ignores') return response({ success: true, version: 'qi_v1', updatedAt: null, rules: [] })
        if (url === '/api/admin/quality/recheck/start') {
          return response({ success: true, job: { id: 'quality-job-failed', type: 'quality-recheck', status: 'queued', progress: 0 } }, 202)
        }
        if (url === '/api/admin/quality/recheck/quality-job-failed') {
          return response({ success: true, job: { id: 'quality-job-failed', type: 'quality-recheck', status: 'failed', progress: 20, error: { code: 'QUALITY_SOURCE_INVALID', message: '质量数据源损坏' } } })
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(QualityPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    await button(wrapper, '开始异步复检').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(800)
    await flushPromises()

    expect(wrapper.get('.job-error').text()).toContain('质量数据源损坏')
    expect(wrapper.get('.job-error').text()).not.toContain('[object Object]')
    wrapper.unmount()
  })

  it('Settings renders typed Chinese groups and retains the draft through a 409 recovery', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let settingsRead = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (url === '/api/admin/capabilities') return response(capabilities())
        if (url === '/api/admin/settings' && (!init?.method || init.method === 'GET')) {
          settingsRead += 1
          return response({
            success: true,
            version: settingsRead > 1 ? 'cfg_v2' : 'cfg_v1',
            fields: [
              { key: 'appName', type: 'string', label: '应用名称', description: '客户端名称', scope: 'app', currentValue: settingsRead > 1 ? '佛课表（他人更新）' : '佛课表', maxLength: 80 },
              { key: 'publishStatus', type: 'enum', label: '发布状态', scope: 'app', currentValue: 'online', enumValues: ['online', 'maintenance', 'offline'] },
              { key: 'appConfig.enableFosuStudentImport', type: 'boolean', label: '个人课表导入开关', scope: 'import', currentValue: true },
              { key: 'dataVersion.releaseNote', type: 'string', label: '数据版本说明', scope: 'data', currentValue: '已更新', maxLength: 600 },
              { key: 'currentSemester', type: 'string', label: '展示学期', scope: 'term', currentValue: '2025-2026-2', maxLength: 40 },
            ],
          })
        }
        if (url === '/api/admin/settings/preview') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          return response({ success: true, version: 'cfg_v1', changes: [{ key: 'appName', label: '应用名称', from: '佛课表', to: body.appName, requiresRestart: false }] })
        }
        if (url === '/api/admin/settings' && init?.method === 'POST') {
          return response({ success: false, code: 'CONFLICT', message: 'settings were modified', currentVersion: 'cfg_v2' }, 409)
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(SettingsPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('应用与发布')
    expect(wrapper.text()).toContain('学期展示')
    expect(wrapper.text()).toContain('导入能力')
    expect(wrapper.text()).toContain('数据文案')
    const nameInput = wrapper.get<HTMLInputElement>('input[name="appName"]')
    await nameInput.setValue('我的佛课表')
    await button(wrapper, '预览变更').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('我的佛课表')

    const confirm = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent?.includes('确认保存'))
    expect(confirm).toBeTruthy()
    confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('其他管理员已修改设置')
    await button(wrapper, '保留草稿并载入最新版本').trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLInputElement>('input[name="appName"]').element.value).toBe('我的佛课表')
    expect(wrapper.text()).toContain('cfg_v2')
    expect(calls.some((call) => call.url === '/api/admin/settings' && call.init?.method === 'POST')).toBe(true)
    wrapper.unmount()
  })

  it('Settings keeps a non-conflict save error visible inside the preview dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/admin/capabilities') return response(capabilities())
        if (url === '/api/admin/settings' && (!init?.method || init.method === 'GET')) {
          return response({ success: true, version: 'cfg_v1', fields: [{ key: 'appName', type: 'string', label: '应用名称', scope: 'app', currentValue: '佛课小表', maxLength: 80 }] })
        }
        if (url === '/api/admin/settings/preview') {
          return response({ success: true, version: 'cfg_v1', changes: [{ key: 'appName', label: '应用名称', from: '佛课小表', to: '新名称' }] })
        }
        if (url === '/api/admin/settings' && init?.method === 'POST') {
          return response({ success: false, code: 'AUDIT_UNAVAILABLE', message: '审计服务暂不可用' }, 503)
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )

    const wrapper = mount(SettingsPage, {
      attachTo: '#test-root',
      global: { plugins: [createPinia()] },
    })
    await flushPromises()
    await wrapper.get<HTMLInputElement>('input[name="appName"]').setValue('新名称')
    await button(wrapper, '预览变更').trigger('click')
    await flushPromises()
    const confirm = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent?.includes('确认保存'))
    confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const dialogAlert = document.body.querySelector('[role="dialog"] [role="alert"]')
    expect(dialogAlert?.textContent).toContain('审计服务暂不可用')
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
    wrapper.unmount()
  })
})
