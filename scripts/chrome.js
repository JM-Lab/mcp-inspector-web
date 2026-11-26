/*
 * Drives a headless Chrome over the DevTools protocol, with no extra packages.
 * Used by the browser test (test/browser.test.ts) and the README screenshots (scripts/screenshots.js).
 *
 *   findChrome()                      the Chrome or Chromium to run (CHROME overrides), or null
 *   const b = await openChrome({ width, height, scale })
 *   await b.go(url)                   navigates and waits for the load event
 *   await b.run(js)                   evaluates an expression in the page (promises are awaited) and returns its value
 *   await b.until(js, ms)             waits until an expression is truthy, and returns it
 *   await b.shot(clip)                a PNG (Buffer) of the page, or of clip { x, y, width, height }
 *   b.errors                          uncaught errors and unhandled rejections in the page
 *   await b.close()
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const ON_PATH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const local = CANDIDATES.find((p) => existsSync(p))
  if (local) return local
  for (const name of ON_PATH) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null } catch { /* not there */ }
  }
  return null
}

/* Linux CI runners (GitHub's Ubuntu 24.04) block the user namespaces Chrome's sandbox needs. Only there is it turned off. */
const SANDBOX = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function openChrome({ width = 1200, height = 900, scale = 1 } = {}) {
  const bin = findChrome()
  if (!bin) throw new Error('No Chrome found. Set CHROME to its path.')
  const profile = mkdtempSync(join(tmpdir(), 'mcpi-chrome-'))
  const chrome = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--lang=en-US', ...SANDBOX, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  /* Chrome prints the DevTools address on stderr once it listens. */
  const wsBrowser = await new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000)
    chrome.stderr.on('data', (d) => {
      text += d
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    chrome.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited: ' + text.slice(-400))) })
  })
  const port = new URL(wsBrowser).port
  let target
  for (let i = 0; i < 50 && !target; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
    if (!target) await sleep(100)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })

  let id = 0
  const pending = new Map()
  const waiters = []
  const errors = []
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return }
    if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; errors.push((e.exception && e.exception.description) || e.text) }
    for (const w of waiters.splice(0)) if (w.method === d.method) w.resolve(d.params); else waiters.push(w)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, (d) => (d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result)))
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const event = (method) => new Promise((resolve) => waiters.push({ method, resolve }))

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  await send('Emulation.setLocaleOverride', { locale: 'en-US' })
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  /* Some sites treat HeadlessChrome differently; look like the browser people use. */
  const ua = (await send('Browser.getVersion')).userAgent.replace('HeadlessChrome', 'Chrome')
  await send('Network.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'en-US,en' })

  const run = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    return r.result.value
  }
  return {
    errors,
    send,
    run,
    async go(url) { const loaded = event('Page.loadEventFired'); await send('Page.navigate', { url }); await loaded },
    async until(expression, ms = 10000) {
      const end = Date.now() + ms
      for (;;) {
        const v = await run(expression).catch(() => undefined)
        if (v) return v
        if (Date.now() > end) throw new Error('Timed out waiting for: ' + expression)
        await sleep(50)
      }
    },
    async shot(clip) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!clip, clip: clip ? { ...clip, scale: 1 } : undefined })
      return Buffer.from(r.data, 'base64')
    },
    async close() {
      ws.close()
      const exited = new Promise((r) => chrome.once('exit', r))
      chrome.kill()
      await exited
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    },
  }
}
