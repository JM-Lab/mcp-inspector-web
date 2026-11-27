/*
 * Captures the README's two OAuth debugging cards (docs/debug-worked.png, docs/debug-failed.png): a sign-in that worked and
 * one that failed, as cards of one size like the feature cards of scripts/screenshots.js.
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
/* Taken in a narrow window so the text stays readable at README size; each cut SIDE by FRAME from inside the server's box. */
const NARROW = 560
const SIDE = 510
const FRAME = 610
const grab = async (sel) => b.shot(await b.run(`(() => { const m = document.querySelector('.mcpi-main').getBoundingClientRect(); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: m.x + (m.width - ${SIDE}) / 2, y: Math.max(r.y, m.y + 2) + scrollY, width: ${SIDE}, height: ${FRAME} } })()`))
const signIn = `[...document.querySelectorAll('button')].find((x) => x.textContent === 'Connect with OAuth (PKCE)').click()`
const debugTab = `[...document.querySelectorAll('.mcpi-tab')].find((t) => t.textContent.startsWith('Debug')).click()`

try {
  await b.send('Emulation.setDeviceMetricsOverride', { width: NARROW, height: 900, deviceScaleFactor: 2, mobile: false })
  await sleep(500)
  /* 1. A sign-in that works: all eight steps done, with the token exchange open (its code and verifier hidden). */
  await b.go(page + '&u=' + mcp.base + '/oauth-mcp&oauth')
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Sign-in needed'`, 10000)
  await b.run(signIn)
  await b.until(`!/code=/.test(location.search) && document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
  await b.run(debugTab)
  await b.run(`document.querySelector('.mcpi-dbg-flow').open = true`)
  await sleep(400)
  const worked = await grab('.mcpi-tabs')

  /* 2. A sign-in that fails: the notice says where and why, and Show in Debug opens that step. */
  await b.run('sessionStorage.clear(); localStorage.clear()')
  await b.go(page + '&u=' + mcp.base + '/nocors-mcp&oauth')
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Sign-in needed'`, 10000)
  await b.run(signIn)
  await b.until(`location.port === '${PORT}' && /is there/.test(document.querySelector('.mcpi-dbg-notice:not([hidden])')?.innerText || '')`, 20000)
  await sleep(300)
  await b.run(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Show in Debug').click()`)
  await sleep(400)
  /* The notice and the failed step in one card: the sign-in form, the Share box and the instructions between them are set aside for the picture. */
  await b.run(`for (const e of document.querySelectorAll('.mcpi-main .mcpi-auth, .mcpi-main .mcpi-share, .mcpi-main .mcpi-instructions')) e.style.display = 'none'; window.scrollTo(0, 0)`)
  await sleep(200)
  const failed = await grab('.mcpi-main')

  /* Each as a card of one size, to sit right above its own text in the README. */
  const uri = (png) => 'data:image/png;base64,' + png.toString('base64')
  const save = (name, png) => { writeFileSync(new URL(name, outDir), png); console.log('wrote', fileURLToPath(new URL(name, outDir))) }
  const cardW = 588
  const cardH = Math.round(cardW * FRAME / SIDE)
  await b.send('Emulation.setDeviceMetricsOverride', { width: cardW, height: cardH, deviceScaleFactor: 2, mobile: false })
  await b.go('about:blank')
  const { frameTree } = await b.send('Page.getFrameTree')
  const card = async (name, png) => {
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}#c{box-sizing:border-box;width:${cardW}px;height:${cardH}px;border:1px solid #d5dde8;border-radius:12px;overflow:hidden;padding:10px 12px 0;background:#fff}#c img{display:block;width:100%}</style><div id="c"><img src="${uri(png)}"></div>`
    await b.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
    await b.until(`document.images.length === 1 && document.images[0].complete && document.images[0].naturalWidth`, 10000)
    save(name, await b.shot({ x: 0, y: 0, width: cardW, height: cardH }))
  }
  await card('debug-worked.png', worked)
  await card('debug-failed.png', failed)
} finally {
  await b.close()
  mcp.close()
  serve.kill()
}
