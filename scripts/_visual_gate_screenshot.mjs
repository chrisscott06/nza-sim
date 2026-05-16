/**
 * scripts/_visual_gate_screenshot.mjs
 *
 * Visual-checkpoint helper for Brief 28-TB-Simple (Gate TB-V1 onwards).
 *
 * Brief 28-TB-Simple §"Visual checkpoint discipline" requires every gate
 * to end with a screenshot of the working number in the UI. This script
 * is the mechanism: a Playwright (headless Chromium) helper that
 * attaches to the running Vite dev server, navigates to a route at a
 * fixed viewport (1440 x 900 — matches CLAUDE.md verification spec),
 * waits for the app to settle, captures a PNG, and writes it to
 * docs/validation/screenshots/{gate}_{view}.png.
 *
 * Usage:
 *   node scripts/_visual_gate_screenshot.mjs <route> <out_basename> [options]
 *
 *   Required:
 *     route          e.g. "/building", "/balance", "/operation"
 *     out_basename   e.g. "tbv1_building_heat_balance"
 *                    (extension .png is appended; saved under
 *                    docs/validation/screenshots/)
 *
 *   Optional:
 *     --project-id <uuid>   loads /project then forwards to <route>
 *                           after PROJECT_LOAD_WAIT_MS so the app's
 *                           ProjectContext has fetched the project
 *                           before the screenshot fires. Defaults to
 *                           Bridgewater HIX project id.
 *     --base <url>          dev server base URL (default http://localhost:5176)
 *     --wait <ms>           extra settle time after navigation (default 4000)
 *                           Live-calc Sankey + 3D scenes need a beat to
 *                           render past initial mount; 4s is conservative.
 *     --viewport WxH        viewport size (default 1440x900)
 *     --fullpage            capture full page (default: viewport only)
 *
 * Examples:
 *   # Capture Building tab Heat Balance after Bridgewater loads
 *   node scripts/_visual_gate_screenshot.mjs /building tbv1_building_heat_balance
 *
 *   # Capture Balance page full-height (longer scroll)
 *   node scripts/_visual_gate_screenshot.mjs /balance tbv2_balance_page --fullpage
 *
 * Exit codes:
 *   0  screenshot captured and saved
 *   1  dev server unreachable
 *   2  navigation timeout or console error during render
 *   3  bad CLI args
 *
 * Prereqs:
 *   - Vite dev server running (`npm run dev` in frontend/)
 *   - Backend running on 127.0.0.1:8002 (so /api/projects/{id} responds
 *     during the wait window)
 *   - Playwright + Chromium installed (`npm install --save-dev
 *     playwright && npx playwright install chromium` from frontend/)
 *
 * Why Playwright vs Puppeteer: Playwright maintained by Microsoft, MIT
 * license, headless-shell variant is ~110 MB, supports Windows / Linux
 * / macOS uniformly. Either would have worked; Playwright picked for
 * the cleaner waitForLoadState/timeout API.
 *
 * Why dev server vs built dist: dev server matches what Chris sees in
 * the browser at the same moment, including any unminified
 * console.error / React warnings. Built dist would also work but
 * obscures the dev-time error surface.
 *
 * Windows / Git Bash gotcha: msys2 path conversion will mangle a
 * leading-slash route like "/building" into "C:/Program Files/Git/building".
 * Invoke with MSYS_NO_PATHCONV=1 prefix when running from Git Bash:
 *   MSYS_NO_PATHCONV=1 node scripts/_visual_gate_screenshot.mjs /building ...
 * No-op on Linux / macOS / PowerShell / cmd.exe.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

// Playwright lives in frontend/node_modules (frontend owns the package.json
// that listed it as a devDependency). The repo has no root-level
// package.json — scripts/ traditionally imports engine code by relative
// path. Do the same for the playwright npm package: explicit relative
// import bypasses Node's package-resolution walk that would otherwise
// look for scripts/node_modules then root node_modules and find neither.
import { chromium } from '../frontend/node_modules/playwright/index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'docs/validation/screenshots')

// Defaults
const DEFAULT_BASE = 'http://localhost:5176'
const DEFAULT_PROJECT_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'  // Bridgewater HIX
const DEFAULT_WAIT_MS = 4000
const PROJECT_LOAD_WAIT_MS = 2000  // time for ProjectContext to fetch
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

function parseArgs(argv) {
  const positional = []
  const opts = { base: DEFAULT_BASE, wait: DEFAULT_WAIT_MS, projectId: DEFAULT_PROJECT_ID,
                 viewport: DEFAULT_VIEWPORT, fullpage: false, clickText: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base')        opts.base = argv[++i]
    else if (a === '--wait')   opts.wait = Number(argv[++i])
    else if (a === '--project-id') opts.projectId = argv[++i]
    else if (a === '--viewport') {
      const [w, h] = argv[++i].split('x').map(Number)
      opts.viewport = { width: w, height: h }
    }
    else if (a === '--fullpage') opts.fullpage = true
    else if (a === '--click-text') opts.clickText = argv[++i]
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`)
      process.exit(3)
    }
    else positional.push(a)
  }
  if (positional.length !== 2) {
    console.error('Usage: node scripts/_visual_gate_screenshot.mjs <route> <out_basename> [options]')
    process.exit(3)
  }
  opts.route = positional[0]
  opts.outBasename = positional[1].replace(/\.png$/i, '')
  return opts
}

const opts = parseArgs(process.argv)

// Pre-flight: backend + frontend reachable?
async function checkReachable(url, label) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    console.log(`  ${label}: reachable (HTTP ${r.status})`)
    return true
  } catch (err) {
    console.error(`  ${label}: UNREACHABLE — ${err.message}`)
    return false
  }
}

console.log('=== Visual gate screenshot ===')
console.log()
console.log(`  Route       : ${opts.route}`)
console.log(`  Output      : docs/validation/screenshots/${opts.outBasename}.png`)
console.log(`  Viewport    : ${opts.viewport.width} x ${opts.viewport.height}`)
console.log(`  Settle wait : ${opts.wait} ms`)
console.log(`  Project id  : ${opts.projectId}`)
console.log(`  Full page   : ${opts.fullpage}`)
console.log()
console.log('Pre-flight checks:')

const feReachable = await checkReachable(opts.base, 'Frontend dev server')
const beReachable = await checkReachable('http://127.0.0.1:8002/api/projects', 'Backend API')
if (!feReachable) {
  console.error()
  console.error('Frontend dev server unreachable. Start it with `npm run dev` in frontend/.')
  process.exit(1)
}
if (!beReachable) {
  console.error()
  console.error('Backend API unreachable on 127.0.0.1:8002. Start it via go.bat or')
  console.error('`python -m uvicorn api.main:app --host 127.0.0.1 --port 8002` from repo root.')
  process.exit(1)
}

await fs.mkdir(SCREENSHOTS_DIR, { recursive: true })

console.log()
console.log('Launching Chromium (headless)...')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: opts.viewport,
  deviceScaleFactor: 1,
})
const page = await context.newPage()

// Capture console errors so a silent render-failure becomes visible at halt
const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text())
  }
})
page.on('pageerror', err => {
  consoleErrors.push(`PageError: ${err.message}`)
})

try {
  // 1. Land on /project?id=<projectId> first so ProjectContext fetches
  //    the building_config and constructions. Then forward to the
  //    target route — ProjectContext stays populated. We also wait for
  //    the weather hourly fetch to complete here, because downstream
  //    pages that drive calculateInstant in 'envelope-gains' / State 2
  //    depend on weatherData being populated to take the hourly path
  //    (otherwise they fall through to calculateInstantDegreeDay which
  //    doesn't emit losses_at_setpoint).
  const seedUrl = `${opts.base}/project?id=${opts.projectId}`
  console.log(`Seeding ProjectContext via ${seedUrl}...`)
  const weatherResponsePromise = page.waitForResponse(
    r => r.url().includes('/api/weather/') && r.url().endsWith('/hourly'),
    { timeout: 15000 },
  ).catch(() => null)
  await page.goto(seedUrl, { waitUntil: 'load', timeout: 30000 })
  const weatherResp = await weatherResponsePromise
  if (weatherResp) {
    console.log(`  weather hourly loaded (HTTP ${weatherResp.status()})`)
  } else {
    console.warn('  warning: weather hourly fetch not observed within 15s — page may render in degree-day fallback mode')
  }
  await page.waitForTimeout(PROJECT_LOAD_WAIT_MS)

  // 2. Navigate to the target route
  const targetUrl = `${opts.base}${opts.route}`
  console.log(`Navigating to ${targetUrl}...`)
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 })

  // 3a. Optional click-by-text — used to toggle into a specific view (e.g.
  //     the "Heat Balance" toggle on the Building tab's centre column).
  if (opts.clickText) {
    console.log(`Clicking element with text "${opts.clickText}"...`)
    try {
      const el = page.getByText(opts.clickText, { exact: true }).first()
      await el.waitFor({ state: 'visible', timeout: 5000 })
      await el.click()
      // Short settle after click before main settle wait — let any toggle
      // animation / mount complete.
      await page.waitForTimeout(500)
    } catch (err) {
      console.warn(`  WARNING: click-text "${opts.clickText}" failed: ${err.message}`)
      console.warn('  Proceeding to capture without the click — the screenshot may not show the intended view.')
    }
  }

  // 3b. Settle wait — Sankey + Three.js scenes finish hydrating
  console.log(`Settle wait ${opts.wait} ms...`)
  await page.waitForTimeout(opts.wait)

  // 4. Capture
  const outPath = path.join(SCREENSHOTS_DIR, `${opts.outBasename}.png`)
  await page.screenshot({ path: outPath, fullPage: opts.fullpage })

  const stat = await fs.stat(outPath)
  console.log()
  console.log(`Saved ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`)

  if (consoleErrors.length > 0) {
    console.warn()
    console.warn(`WARNING: ${consoleErrors.length} console error(s) during render:`)
    consoleErrors.slice(0, 10).forEach((e, i) => console.warn(`  ${i + 1}. ${e.slice(0, 200)}`))
    if (consoleErrors.length > 10) console.warn(`  ... (${consoleErrors.length - 10} more)`)
    console.warn()
    console.warn('Halt report should mention these — they may indicate the')
    console.warn('display rewire is incomplete or that engine output is malformed.')
  }
} catch (err) {
  console.error()
  console.error(`FAIL: ${err.message}`)
  if (consoleErrors.length > 0) {
    console.error('Console errors during attempt:')
    consoleErrors.forEach(e => console.error(`  - ${e.slice(0, 200)}`))
  }
  await browser.close()
  process.exit(2)
}

await browser.close()
console.log()
console.log('Done.')
