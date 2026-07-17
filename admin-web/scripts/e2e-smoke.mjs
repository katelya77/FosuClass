/**
 * Lightweight e2e smoke: ensure production build artifacts and deep-link entry exist.
 * Browser automation is optional; this validates deployable SPA shell contracts.
 */
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.resolve(root, '../server/public/admin-app')
const indexHtml = path.join(outDir, 'index.html')

assert.ok(fs.existsSync(indexHtml), `missing build output: ${indexHtml}. Run npm run admin:build first.`)
const html = fs.readFileSync(indexHtml, 'utf8')
assert.match(html, /admin-app/, 'built index should reference /admin-app/ base')
assert.ok(fs.existsSync(path.join(outDir, 'logo-fallback.svg')), 'logo fallback asset required')

const assetsDir = path.join(outDir, 'assets')
assert.ok(fs.existsSync(assetsDir), 'assets directory required')
const assets = fs.readdirSync(assetsDir)
assert.ok(assets.some((f) => f.endsWith('.js')), 'js bundle required')
assert.ok(assets.some((f) => f.endsWith('.css')), 'css bundle required')

console.log('admin-web e2e smoke passed', { outDir, assetCount: assets.length })
