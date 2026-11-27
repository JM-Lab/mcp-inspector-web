/*
 * Captures the README's two OAuth debugging screenshots (docs/debug-oauth.png, docs/debug-failed.png).
 * A sign-in cannot be driven on someone else's server, so these use the test MCP server (test/support/mcp-server.ts)
 * and the local demo page, both started here. Run `npm run build` first.
 *   node scripts/screenshots-debug.js
 */
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openChrome } from './chrome.js'
import { startMcpServer } from '../test/support/mcp-server.ts'

const PORT = 8790
const page = 'http://localhost:' + PORT + '/?lang=en'
const outDir = new URL('../docs/', import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const serve = spawn(process.execPath, [fileURLToPath(new URL('./serve.js', import.meta.url))], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
const mcp = await startMcpServer({ cors: true })
const b = await openChrome({ width: 1200, height: 900, scale: 2 })
/* The open server's box, from its top or (from: 'tabs') from its tab row down, at most max tall. */
const shot = async (name, max, from = 'top') => {
  const clip = await b.run(`(() => { const r = document.querySelector('.mcpi-main').getBoundingClientRect(); const top = ${from === 'tabs' ? `document.querySelector('.mcpi-tab').getBoundingClientRect().top - 12` : 'r.y - 16'}; return { x: r.x - 16, y: top + scrollY, width: r.width + 32, height: Math.min(r.bottom + 16 - top, ${max}) } })()`)
  writeFileSync(new URL(name, outDir), await b.shot(clip))
  console.log('wrote', fileURLToPath(new URL(name, outDir)))
}
const signIn = `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Connect with OAuth (PKCE)').click()`
const debugTab = `[...document.querySelectorAll('.mcpi-tab')].find((t) => t.textContent.startsWith('Debug')).click()`

try {
  await sleep(500)
  /* 1. A sign-in that works: all eight steps done, with the token exchange open (its code and verifier hidden). */
  await b.go(page + '&u=' + mcp.base + '/oauth-mcp&oauth')
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Sign-in needed'`, 10000)
  await b.run(signIn)
  await b.until(`!/code=/.test(location.search) && document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
  await b.run(debugTab)
  await b.run(`document.querySelector('.mcpi-dbg-flow').open = true`)
  await sleep(400)
  await shot('debug-oauth.png', 760, 'tabs')

  /* 2. A sign-in that fails: the notice says where and why, and Show in Debug opens that step. */
  await b.run('sessionStorage.clear(); localStorage.clear()')
  await b.go(page + '&u=' + mcp.base + '/nocors-mcp&oauth')
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Sign-in needed'`, 10000)
  await b.run(signIn)
  await b.until(`location.port === '${PORT}' && /is there/.test(document.querySelector('.mcpi-dbg-notice:not([hidden])')?.innerText || '')`, 20000)
  await sleep(300)
  await b.run(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Show in Debug').click()`)
  await sleep(400)
  await shot('debug-failed.png', 1000)
} finally {
  await b.close()
  mcp.close()
  serve.kill()
}
