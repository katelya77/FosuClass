/**
 * Playwright browser acceptance for admin SPA shell.
 * Installs are optional: if playwright is missing, falls back to HTTP shell checks.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const express = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/node_modules/express'))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'server/public/admin-app')
const reportDir = path.join(root, 'output/admin-modernization-browser')

async function startStaticServer() {
  const app = express()
  const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
  app.use('/admin-app', express.static(outDir, { index: false }))
  const spaHandler = (_req, res) => {
    res.type('html').send(indexHtml)
  }
  app.use('/admin-next', spaHandler)
  app.use('/admin', spaHandler)
  app.get('/api/admin/session', (_req, res) => {
    res.json({ success: true, authenticated: false, csrfToken: '' })
  })
  app.post('/api/admin/login', express.json(), (req, res) => {
    if (req.body && req.body.password === 'test-admin') {
      return res.json({ success: true, csrfToken: 'test.csrf' })
    }
    return res.status(401).json({ success: false, message: 'bad password' })
  })
  app.post('/api/admin/logout', (_req, res) => res.json({ success: true }))
  app.get('/api/admin/sync/status', (req, res) => {
    const auth = String(req.headers.cookie || '')
    if (!auth.includes('logged')) {
      // SPA uses cookie session; mock unauth for direct API
    }
    res.json({
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

  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    try {
      return await import('playwright-core')
    } catch {
      return null
    }
  }
}

async function main() {
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error('Missing admin-app build. Run npm run admin:build first.')
    process.exit(1)
  }

  const pwMod = await loadPlaywright()
  if (!pwMod) {
    console.log('Playwright not installed — running lightweight HTTP shell checks only.')
    const { server, base } = await startStaticServer()
    const res = await fetch(`${base}/admin-next/login`)
    const html = await res.text()
    server.close()
    if (!/admin-app|id="app"/.test(html)) {
      console.error('SPA shell HTML unexpected')
      process.exit(1)
    }
    const resPrimary = await fetch(`${base}/admin/dashboard`)
    if (resPrimary.status !== 200) {
      console.error('primary mount failed')
      process.exit(1)
    }
    console.log('admin browser acceptance: lightweight shell OK')
    process.exit(0)
  }

  const { chromium } = pwMod
  fs.mkdirSync(reportDir, { recursive: true })
  const { server, base } = await startStaticServer()
  const browser = await chromium.launch({ headless: true })
  const widths = [1920, 1440, 1024, 768, 390]
  const results = []

  try {
    for (const width of widths) {
      const height = width <= 390 ? 844 : 900
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: 'light',
      })
      const page = await context.newPage()
      await page.goto(`${base}/admin-next/login`, { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(reportDir, `login-${width}.png`), fullPage: true })

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      results.push({ width, route: '/admin-next/login', overflow })

      await page.fill('#password', 'wrong')
      await page.click('button[type="submit"]')
      await page.waitForTimeout(250)

      await page.fill('#password', 'test-admin')
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(reportDir, `after-login-${width}.png`), fullPage: true })

      await page.goto(`${base}/admin-next/dashboard`, { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(reportDir, `dashboard-${width}.png`), fullPage: true })

      await page.goto(`${base}/admin-next/sync`, { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(reportDir, `sync-${width}.png`), fullPage: true })

      // back/forward
      await page.goBack()
      await page.goForward()

      if (width <= 768) {
        const menu = page.locator('button[aria-label="打开导航菜单"]')
        if ((await menu.count()) > 0) {
          await menu.click()
          await page.waitForTimeout(200)
          await page.screenshot({ path: path.join(reportDir, `drawer-${width}.png`), fullPage: true })
          await page.keyboard.press('Escape')
          await page.waitForTimeout(150)
        }
      }

      await context.close()

      const darkCtx = await browser.newContext({
        viewport: { width, height },
        colorScheme: 'dark',
      })
      const darkPage = await darkCtx.newPage()
      await darkPage.goto(`${base}/admin-next/login`, { waitUntil: 'networkidle' })
      await darkPage.evaluate(() => localStorage.setItem('fosu-admin-theme', 'dark'))
      await darkPage.reload({ waitUntil: 'networkidle' })
      await darkPage.screenshot({ path: path.join(reportDir, `login-dark-${width}.png`), fullPage: true })
      await darkCtx.close()
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const p = await ctx.newPage()
    await p.goto(`${base}/admin/login`, { waitUntil: 'networkidle' })
    await p.screenshot({ path: path.join(reportDir, 'primary-admin-login.png'), fullPage: true })
    await ctx.close()

    fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify({ results, base }, null, 2))
    const anyOverflow = results.some((r) => r.overflow)
    if (anyOverflow) {
      console.error('Horizontal overflow detected', results.filter((r) => r.overflow))
      process.exit(1)
    }
    console.log('Playwright admin acceptance passed.', { reportDir, widths })
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
