/**
 * C1 browser acceptance for Catalog, Quality and Settings.
 *
 * The SPA is the real production build. The local API fixture implements only
 * committed backend contracts and rejects unsafe write requests. No production
 * endpoint, secret or data directory is used.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '../..')
const express = require(path.join(root, 'server/node_modules/express'))
const outDir = path.join(root, 'server/public/admin-app')
const reportDir = path.join(root, 'output/playwright/admin-c1')
const sessionCookie = 'fosu_admin_test_session=1'
const csrfToken = 'c1.test.csrf'

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]
  }).filter(([key]) => key))
}

function authenticated(req) {
  return parseCookies(req.headers.cookie).fosu_admin_test_session === '1'
}

function writeContract(req, res, options = {}) {
  const failures = []
  if (!authenticated(req)) failures.push('session')
  if (req.get('x-fosu-admin-client') !== 'next') failures.push('client marker')
  if (req.get('x-fosu-csrf') !== csrfToken) failures.push('csrf')
  if (!String(req.get('origin') || '').startsWith('http://127.0.0.1:')) failures.push('origin')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.get('idempotency-key') || '')) failures.push('idempotency UUID')
  if (options.ifMatch && req.get('if-match') !== options.ifMatch) failures.push('if-match')
  if (failures.length) {
    res.status(403).json({ success: false, code: 'FIXTURE_WRITE_GUARD', message: `missing ${failures.join(', ')}` })
    return false
  }
  return true
}

function catalogList(page) {
  return {
    success: true,
    items: [{
      id: page === 2 ? 'class:last' : 'class:first',
      className: page === 2 ? '软件工程 31 班' : '软件工程 1 班',
      collegeName: '计算机学院',
      semester: '2025-2026-2',
      hidden: false,
    }],
    total: 31,
    page,
    pageSize: 30,
    totalPages: 2,
    generationId: 'catgen-1',
    source: { kind: 'catalog-staging', published: false },
  }
}

async function startServer() {
  const app = express()
  app.use(express.json({ limit: '2mb' }))
  const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
  const state = {
    catalogIndexReads: 0,
    qualityJobReads: 0,
    qualityIgnored: true,
    settingsVersion: 'cfg_v1',
    settingsAppName: '佛课小表',
    settingsConflictSent: false,
    writes: [],
  }

  app.use('/admin-app', express.static(outDir, { index: false }))
  app.use('/admin-next', (_req, res) => res.type('html').send(indexHtml))

  app.get('/api/admin/session', (req, res) => res.json({
    success: true,
    authenticated: authenticated(req),
    csrfToken: authenticated(req) ? csrfToken : '',
  }))
  app.get('/api/admin/capabilities', (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, message: '请先登录后台' })
    return res.json({
      success: true,
      primary: 'legacy',
      legacyEnabled: true,
      nextEnabled: true,
      writeModules: { catalog: true, quality: true, settings: true },
      writeModuleList: ['catalog', 'quality', 'settings'],
      paths: { next: '/admin-next', legacy: '/admin' },
    })
  })

  app.get('/api/admin/catalog/stats', (_req, res) => res.json({ success: true, data: {
    classCount: 31, teacherCount: 12, classroomCount: 8, courseCount: 45,
    collegeCount: 1, semesterCount: 1, gradeCount: 1, currentSemester: '2025-2026-2',
  } }))
  app.get('/api/admin/catalog/resources', (req, res) => res.json(catalogList(Number(req.query.page) === 2 ? 2 : 1)))
  app.get('/api/admin/catalog/relationships', (_req, res) => res.json({
    success: true,
    colleges: [{ id: '01', name: '计算机学院', grades: [{ grade: '2024', majors: [{ id: '0809', name: '软件工程' }] }] }],
    source: { kind: 'catalog-staging', published: false },
    relationshipVersion: 'rel-1',
    generationId: 'catgen-1',
  }))
  app.get('/api/admin/catalog/meta', (_req, res) => res.json({ success: true, version: 'catmeta_v1', entries: {} }))
  app.get('/api/admin/catalog/export', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="catalog-class.json"')
    res.setHeader('X-Fosu-Catalog-Generation', 'catgen-1')
    res.send('[{"id":"class:first"}]\n')
  })
  app.post('/api/admin/catalog/import/preview', (req, res) => {
    if (!writeContract(req, res)) return
    state.writes.push({ route: req.path, body: req.body })
    res.json({
      success: true,
      previewId: 'preview-1',
      operationId: 'catop-1',
      baseVersion: 'cat_v1',
      generationId: 'catgen-1',
      relationshipVersion: 'rel-1',
      summary: { added: 1, updated: 0, unchanged: 0, deleted: 0 },
      changes: { added: req.body.items, updated: [], unchanged: [], deleted: [] },
      warnings: [],
      expiresAt: '2099-07-19T12:10:00.000Z',
    })
  })
  app.post('/api/admin/catalog/import/apply', (req, res) => {
    if (!writeContract(req, res, { ifMatch: 'cat_v1' })) return
    if (req.body?.confirm !== true || req.body?.previewId !== 'preview-1') {
      return res.status(400).json({ success: false, message: 'literal confirmation required' })
    }
    state.writes.push({ route: req.path, body: req.body })
    return res.json({ success: true, committed: true, auditPending: false, operationId: 'catop-1', version: 'cat_v2', generationId: 'catgen-2' })
  })
  app.post('/api/admin/catalog/indexes/rebuild/start', (req, res) => {
    if (!writeContract(req, res)) return
    if (req.body?.generationId !== 'catgen-1' || req.body?.reason !== 'operator') {
      return res.status(400).json({ success: false, message: 'generation-scoped rebuild required' })
    }
    state.catalogIndexReads = 0
    state.writes.push({ route: req.path, body: req.body })
    return res.status(202).json({ success: true, job: { id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: 'queued', progress: 0 } })
  })
  app.get('/api/admin/catalog/indexes/rebuild/catalog-index-job-1', (_req, res) => {
    state.catalogIndexReads += 1
    const success = state.catalogIndexReads > 1
    return res.json({ success: true, job: {
      id: 'catalog-index-job-1', type: 'catalog-index-rebuild', status: success ? 'success' : 'running',
      progress: success ? 100 : 60, message: success ? '目录索引重建完成' : '正在重建派生索引',
      result: success ? { generationId: 'catgen-1', relationshipVersion: 'rel-2', builtAt: '2026-07-19T12:00:00.000Z', counts: { majors: 1 } } : undefined,
    } })
  })

  app.get('/api/admin/quality/report', (_req, res) => res.json({
    success: true,
    data: {
      active: [{ type: 'missing-room', target: '课程 A', fingerprint: 'missing-room::课程 A', severity: 'warning', original: '缺少教室', suggestion: '补充教室' }],
      ignored: state.qualityIgnored
        ? [{ type: 'few-courses', target: '软件 2 班', fingerprint: 'few-courses::软件 2 班', severity: 'info', status: 'ignored', reason: '新开班，课程尚未齐备', ignoredAt: '2026-07-19T12:00:00.000Z' }]
        : [],
      summary: { activeCount: 1, ignoredCount: state.qualityIgnored ? 1 : 0, totalCount: state.qualityIgnored ? 2 : 1 },
      generatedAt: '2026-07-19T12:00:00.000Z',
    },
  }))
  app.get('/api/admin/quality/ignores', (_req, res) => res.json({ success: true, version: state.qualityIgnored ? 'qi_v1' : 'qi_v2', updatedAt: null, rules: [] }))
  app.post('/api/admin/quality/mark', (req, res) => {
    if (!writeContract(req, res, { ifMatch: 'qi_v1' })) return
    state.qualityIgnored = Boolean(req.body?.ignore)
    state.writes.push({ route: req.path, body: req.body })
    return res.json({ success: true, version: 'qi_v2', ignores: [] })
  })
  app.post('/api/admin/quality/recheck/start', (req, res) => {
    if (!writeContract(req, res)) return
    state.qualityJobReads = 0
    state.writes.push({ route: req.path, body: req.body })
    return res.status(202).json({ success: true, job: { id: 'quality-job-1', type: 'quality-recheck', status: 'queued', progress: 0 } })
  })
  app.get('/api/admin/quality/recheck/quality-job-1', (_req, res) => {
    state.qualityJobReads += 1
    const success = state.qualityJobReads > 1
    res.json({ success: true, job: {
      id: 'quality-job-1', type: 'quality-recheck', status: success ? 'success' : 'running',
      progress: success ? 100 : 55, message: success ? '复检完成' : '正在重新检查',
    } })
  })

  function settingsDocument() {
    return {
      success: true,
      version: state.settingsVersion,
      fields: [
        { key: 'appName', type: 'string', label: '应用名称', description: '客户端名称', scope: 'app', currentValue: state.settingsAppName, maxLength: 80 },
        { key: 'publishStatus', type: 'enum', label: '发布状态', scope: 'app', currentValue: 'online', enumValues: ['online', 'maintenance', 'offline'] },
        { key: 'currentSemester', type: 'string', label: '展示学期', scope: 'term', currentValue: '2025-2026-2', maxLength: 40 },
        { key: 'appConfig.enableFosuStudentImport', type: 'boolean', label: '个人课表导入开关', scope: 'import', currentValue: true },
        { key: 'dataVersion.releaseNote', type: 'string', label: '数据版本说明', scope: 'data', currentValue: '全校课表数据已更新', maxLength: 600 },
      ],
    }
  }
  app.get('/api/admin/settings', (_req, res) => res.json(settingsDocument()))
  app.post('/api/admin/settings/preview', (req, res) => {
    if (!writeContract(req, res)) return
    state.writes.push({ route: req.path, body: req.body })
    return res.json({ success: true, version: state.settingsVersion, changes: [{
      key: 'appName', label: '应用名称', from: state.settingsAppName, to: req.body?.appName, requiresRestart: false,
    }] })
  })
  app.post('/api/admin/settings', (req, res) => {
    if (!writeContract(req, res, { ifMatch: state.settingsVersion })) return
    state.writes.push({ route: req.path, body: req.body })
    if (!state.settingsConflictSent) {
      state.settingsConflictSent = true
      state.settingsVersion = 'cfg_v2'
      state.settingsAppName = '佛课小表（他人更新）'
      return res.status(409).json({ success: false, code: 'CONFLICT', message: 'settings were modified', currentVersion: 'cfg_v2' })
    }
    state.settingsAppName = String(req.body?.appName || state.settingsAppName)
    state.settingsVersion = 'cfg_v3'
    return res.json({ success: true, version: state.settingsVersion, settings: settingsDocument() })
  })

  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not expose a port')
  return { server, state, base: `http://127.0.0.1:${address.port}` }
}

function assertNoOverflow(page, route, width) {
  return page.evaluate(({ routeName, viewportWidth }) => {
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    if (overflow) throw new Error(`${routeName} has horizontal overflow at ${viewportWidth}px`)
    return { route: routeName, width: viewportWidth, overflow }
  }, { routeName: route, viewportWidth: width })
}

async function main() {
  if (!fs.existsSync(path.join(outDir, 'index.html'))) throw new Error('Missing admin-app build. Run npm run build first.')
  const { chromium } = await import('playwright')
  fs.mkdirSync(reportDir, { recursive: true })
  const { server, state, base } = await startServer()
  const browser = await chromium.launch({ headless: true })
  const results = []
  const consoleErrors = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addCookies([{ name: 'fosu_admin_test_session', value: '1', url: base, httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    page.on('console', (event) => { if (event.type() === 'error') consoleErrors.push(event.text()) })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(`${base}/admin-next/catalog`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '数据资源台账' }).waitFor()
    await page.getByText('计算机学院', { exact: true }).first().waitFor()
    await page.locator('.relationship-tree li').filter({ hasText: '软件工程' }).waitFor()
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByText('第 2 / 2 页').waitFor()
    if (await page.getByRole('button', { name: '下一页' }).isEnabled()) throw new Error('Catalog next page remained enabled on last page')
    await page.getByRole('button', { name: '导入并预览' }).click()
    await page.locator('#catalog-import-json').fill(JSON.stringify({
      type: 'major', semester: '2025-2026-2', items: [{ collegeCode: '01', grade: '2024', majorCode: '0809', majorName: '软件工程' }],
    }))
    await page.getByRole('button', { name: '生成差异预览' }).click()
    await page.getByRole('heading', { name: '差异预览' }).waitFor()
    await page.getByText('1 新增').waitFor()
    await page.getByRole('button', { name: '确认提交到工作区' }).click()
    await page.getByText('导入已可靠提交').waitFor()
    await page.getByRole('dialog', { name: '目录导入工作台' }).getByRole('button', { name: '关闭', exact: true }).last().click()
    await page.getByRole('button', { name: '重建目录索引' }).click()
    await page.getByText('排队中', { exact: true }).waitFor()
    await page.getByText('目录索引重建完成', { exact: true }).waitFor({ timeout: 5000 })
    await page.getByText('关系版本').filter({ hasText: 'rel-2' }).waitFor()
    results.push({ flow: 'catalog', pagination: '2/2', relationship: 'visible', import: 'previewed-and-applied', indexJob: 'success' })
    await page.screenshot({ path: path.join(reportDir, 'catalog.png'), fullPage: true })

    await page.goto(`${base}/admin-next/quality`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '数据质量台账' }).waitFor()
    await page.getByRole('tab', { name: /已忽略/ }).click()
    await page.getByText('新开班，课程尚未齐备').waitFor()
    await page.getByRole('button', { name: '恢复检查' }).click()
    await page.getByText('没有已忽略的问题').waitFor()
    await page.getByRole('button', { name: '开始异步复检' }).click()
    await page.getByText('排队中').waitFor()
    await page.locator('#quality-job-title').getByText('复检完成', { exact: true }).waitFor({ timeout: 5000 })
    results.push({ flow: 'quality', ignoredReason: 'visible', restore: 'applied', recheck: 'success' })
    await page.screenshot({ path: path.join(reportDir, 'quality.png'), fullPage: true })

    await page.goto(`${base}/admin-next/settings`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '系统设置' }).waitFor()
    for (const group of ['应用与发布', '学期展示', '导入能力', '数据文案']) await page.getByRole('heading', { name: group }).waitFor()
    await page.locator('input[name="appName"]').fill('我的佛课小表')
    await page.getByRole('button', { name: /预览变更/ }).click()
    await page.getByRole('dialog', { name: '变更预览' }).getByText('我的佛课小表').waitFor()
    await page.getByRole('button', { name: '确认保存' }).click()
    await page.getByRole('alert').getByText(/其他管理员已修改设置/).waitFor()
    await page.getByRole('button', { name: '保留草稿并载入最新版本' }).click()
    await page.getByText(/已载入最新版本 cfg_v2/).waitFor()
    if (await page.locator('input[name="appName"]').inputValue() !== '我的佛课小表') throw new Error('Settings draft was lost during conflict recovery')
    await page.getByRole('button', { name: /预览变更/ }).click()
    await page.getByRole('button', { name: '确认保存' }).click()
    await page.getByText('cfg_v3').waitFor()
    results.push({ flow: 'settings', typedGroups: 4, preview: 'server-diff', conflictRecovery: 'draft-preserved', savedVersion: 'cfg_v3' })
    await page.screenshot({ path: path.join(reportDir, 'settings.png'), fullPage: true })

    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      for (const route of ['catalog', 'quality', 'settings']) {
        await page.goto(`${base}/admin-next/${route}`, { waitUntil: 'networkidle' })
        results.push(await assertNoOverflow(page, route, width))
      }
    }

    const expectedConflictLogs = consoleErrors.filter((entry) => /status of 409 \(Conflict\)/.test(entry))
    const unexpectedConsoleErrors = consoleErrors.filter((entry) => !/status of 409 \(Conflict\)/.test(entry))
    if (expectedConflictLogs.length !== 1) {
      throw new Error(`expected one browser 409 log from the conflict fixture, got ${expectedConflictLogs.length}`)
    }
    if (unexpectedConsoleErrors.length) throw new Error(`browser console errors: ${unexpectedConsoleErrors.join(' | ')}`)
    const requiredWrites = [
      '/api/admin/catalog/import/preview', '/api/admin/catalog/import/apply',
      '/api/admin/catalog/indexes/rebuild/start',
      '/api/admin/quality/mark', '/api/admin/quality/recheck/start',
      '/api/admin/settings/preview', '/api/admin/settings',
    ]
    for (const route of requiredWrites) {
      if (!state.writes.some((entry) => entry.route === route)) throw new Error(`C1 flow did not exercise ${route}`)
    }
    fs.writeFileSync(path.join(reportDir, 'results.json'), `${JSON.stringify({ base, results, writes: state.writes.map((entry) => entry.route), expectedConflictLogs, unexpectedConsoleErrors }, null, 2)}\n`)
    console.log('Playwright C1 acceptance passed.', { reportDir, results: results.length, writes: state.writes.length })
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
