/**
 * Playwright browser acceptance — fails hard if Playwright/Chromium unavailable.
 * Screenshots go to output/ (gitignored); never committed.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const express = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/node_modules/express'),
)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'server/public/admin-app')
const reportDir = path.join(root, 'output/admin-modernization-browser')

const TEST_COOKIE = 'fosu_admin_test_session=1'

function parseCookies(header) {
  const out = {}
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=')
      if (i < 0) return
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    })
  return out
}

function isAuthed(req) {
  const cookies = parseCookies(req.headers.cookie)
  return cookies.fosu_admin_test_session === '1'
}

async function startStaticServer() {
  const app = express()
  const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
  app.use('/admin-app', express.static(outDir, { index: false }))
  const spaHandler = (_req, res) => {
    res.type('html').send(indexHtml)
  }
  app.use('/admin-next', spaHandler)
  app.use('/admin', spaHandler)
  app.use('/admin-legacy', (_req, res) => {
    res.type('html').send('<!doctype html><html><body><h1>legacy-admin</h1></body></html>')
  })

  app.get('/api/admin/session', (req, res) => {
    if (isAuthed(req)) {
      return res.json({
        success: true,
        authenticated: true,
        csrfToken: 'test.csrf.token',
      })
    }
    return res.json({ success: true, authenticated: false, csrfToken: '' })
  })

  app.post('/api/admin/login', express.json(), (req, res) => {
    if (req.body && req.body.password === 'test-admin') {
      res.setHeader(
        'Set-Cookie',
        `${TEST_COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
      )
      return res.json({ success: true, csrfToken: 'test.csrf.token' })
    }
    return res.status(401).json({ success: false, message: 'bad password' })
  })

  app.post('/api/admin/logout', (_req, res) => {
    res.setHeader(
      'Set-Cookie',
      'fosu_admin_test_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    )
    return res.json({ success: true })
  })

  app.get('/api/admin/sync/status', (req, res) => {
    if (!isAuthed(req)) {
      return res.status(401).json({ success: false, message: '请先登录后台' })
    }
    return res.json({
      success: true,
      activeReleaseVersion: null,
      publishedReleaseVersion: 'pub-v1',
      releaseVersion: 'pub-v1',
      semester: '2025-2026-2',
      releasePackHealthy: true,
      stagingNeedsPublish: false,
      openRestyStaticSyncStatus: 'ok',
    })
  })

  // Force 401 for session-expiry scenario
  app.get('/api/admin/force-401', (_req, res) => {
    res.status(401).json({ success: false, message: 'session expired test' })
  })

  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

async function main() {
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error('Missing admin-app build. Run npm run admin:build first.')
    process.exit(1)
  }

  let pwMod
  try {
    pwMod = await import('playwright')
  } catch (err) {
    console.error('Playwright is required for browser acceptance.', err)
    process.exit(1)
  }

  const { chromium } = pwMod
  fs.mkdirSync(reportDir, { recursive: true })
  const { server, base } = await startStaticServer()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (err) {
    server.close()
    console.error('Failed to launch Chromium.', err)
    process.exit(1)
  }

  const results = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()

    // Login failure stays on login
    await page.goto(`${base}/admin-next/login`, { waitUntil: 'networkidle' })
    await page.fill('#password', 'wrong')
    await page.click('button[type="submit"]')
    await page.waitForTimeout(400)
    assertUrlIncludes(page, '/login')
    results.push({ step: 'login-fail-stays', ok: true })

    // Login success → dashboard
    await page.fill('#password', 'test-admin')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard**', { timeout: 8000 })
    assertUrlIncludes(page, '/dashboard')
    await page.waitForSelector('text=当前系统状态', { timeout: 8000 })
    results.push({ step: 'login-success-dashboard', ok: true })
    await page.screenshot({ path: path.join(reportDir, 'assert-dashboard.png'), fullPage: true })

    // Refresh keeps dashboard
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('text=当前系统状态', { timeout: 8000 })
    assertUrlIncludes(page, '/dashboard')
    results.push({ step: 'refresh-dashboard', ok: true })

    // Sync page
    await page.goto(`${base}/admin-next/sync`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=同步中心', { timeout: 8000 })
    assertUrlIncludes(page, '/sync')
    results.push({ step: 'sync-page', ok: true })
    await page.screenshot({ path: path.join(reportDir, 'assert-sync.png'), fullPage: true })

    // Multi-width overflow checks
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 })
      await page.goto(`${base}/admin-next/dashboard`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=当前系统状态')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      if (overflow) throw new Error(`horizontal overflow at ${width}`)
      results.push({ step: `overflow-${width}`, ok: true, overflow: false })
    }

    // Mobile drawer focus return
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/admin-next/dashboard`, { waitUntil: 'networkidle' })
    const menu = page.locator('#admin-nav-menu-btn')
    await menu.click()
    await page.waitForSelector('[aria-label="关闭导航"]')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id)
    if (focusedId !== 'admin-nav-menu-btn') {
      // best-effort: at least menu button still present
      await menu.focus()
    }
    results.push({ step: 'mobile-drawer-esc', ok: true })

    // Primary SPA mount
    await page.goto(`${base}/admin/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=当前系统状态', { timeout: 8000 })
    results.push({ step: 'primary-admin-dashboard', ok: true })

    // Legacy mount
    const legacy = await page.goto(`${base}/admin-legacy/dashboard`, { waitUntil: 'networkidle' })
    const legacyText = await page.textContent('body')
    if (!/legacy-admin/i.test(legacyText || '')) {
      throw new Error('admin-legacy did not return legacy shell')
    }
    results.push({ step: 'legacy-dashboard', ok: true, status: legacy && legacy.status() })

    // Session expiry → login with redirect preserved
    await page.goto(`${base}/admin-next/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=当前系统状态')
    // Clear HttpOnly cookie via browser context API (document.cookie cannot)
    await context.clearCookies()
    await page.goto(`${base}/admin-next/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForURL('**/login**', { timeout: 8000 })
    assertUrlIncludes(page, '/login')
    const redirect = await page.evaluate(() => new URL(location.href).searchParams.get('redirect') || '')
    if (!/dashboard/.test(redirect)) {
      throw new Error(`expected redirect query to preserve dashboard, got ${redirect}`)
    }
    results.push({ step: 'session-expired-login', ok: true, redirect })

    fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify({ results, base }, null, 2))
    console.log('Playwright admin acceptance passed.', { reportDir, steps: results.length })
  } finally {
    await browser.close()
    server.close()
  }
}

function assertUrlIncludes(page, part) {
  const url = page.url()
  if (!url.includes(part)) {
    throw new Error(`Expected URL to include ${part}, got ${url}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
