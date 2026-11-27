/*
 * Captures the README screenshots (docs/*.png: the hero with desktop and phone, and the four feature shots as cards of one size) from the English live demo with headless Chrome (scripts/chrome.js).
 * Only the inspector itself is captured, not the site around it.
 *   npm run screenshots                                         the live demo
 *   PAGE=http://localhost:8787/?lang=en npm run screenshots     the local demo (npm run demo in another terminal)
 *   CHROME=/path/to/chrome                                      another browser
 *   PAGE_URL=https://…                                          the address links on screen start with (default aljal.kr/miw)
 * It opens Microsoft Learn from the registry, runs a tool, opens Debug, the Share box and the Add to AI popup, so it needs the network.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openChrome } from './chrome.js'

const PAGE = process.env.PAGE || 'https://aljal.kr/miw'
const outDir = new URL('../docs/', import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await openChrome({ width: 1200, height: 900, scale: 2 })
const save = (name, png) => { writeFileSync(new URL(name, outDir), png); console.log('wrote', fileURLToPath(new URL(name, outDir))) }
const grab = async (clipExpr) => b.shot(await b.run(clipExpr))
/* The four feature shots share one shape: taken in a window NARROW wide, each cut SIDE by FRAME (CSS pixels), so they line up in the README's table. */
const NARROW = 560
const SIDE = 510
const FRAME = 610

/*
 * Captured from the local demo, the links on screen would start with localhost. The page is told its public address instead
 * (the pageUrl option), so the Share box and the popup show the links people will get.
 */
const SHOWN = process.env.PAGE_URL || 'https://aljal.kr/miw'
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let v; Object.defineProperty(window, 'MCP_INSPECTOR', { configurable: true, get: () => v, set: (o) => { v = Object.assign({}, o, { pageUrl: ${JSON.stringify(SHOWN)} }) } }) })()` })

try {
  await b.go(PAGE)
  await b.until(`[...document.querySelectorAll('.mcpi-reg')].some((x) => x.textContent.includes('Microsoft Learn'))`, 20000)
  await b.run(`[...document.querySelectorAll('.mcpi-reg')].find((x) => x.textContent.includes('Microsoft Learn')).click()`)
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
  await sleep(500)

  /* A site's sticky header would cover the inspector in full-page captures. */
  await b.run(`for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'sticky' || p === 'fixed') && !e.closest('.mcpi')) e.style.display = 'none' }`)

  /* 1. The desktop half of the hero: servers, registry, and the inspector open right under the card pressed. */
  await b.run('window.scrollTo(0, 0)')
  const desktop = await b.shot(await b.run(`(() => { const r = document.querySelector('.mcpi').getBoundingClientRect(); return { x: r.x - 16, y: r.y + scrollY - 16, width: r.width + 32, height: 760 } })()`))

  /*
   * 2 to 5. The four feature shots, taken in a narrow window so their text is still readable at the size the README's table
   * shows them, and all of one shape so they line up.
   */
  await b.send('Emulation.setDeviceMetricsOverride', { width: NARROW, height: 900, deviceScaleFactor: 2, mobile: false })
  await sleep(300)
  /* Each is cut from inside its box (the server's, or the popup's), SIDE wide from the element named down: no outer border, a white ground. */
  const from = (sel, box = '.mcpi-main') => `(() => { const m = document.querySelector(${JSON.stringify(box)}).getBoundingClientRect(); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: m.x + (m.width - ${SIDE}) / 2, y: Math.max(r.y, m.y + 2) + scrollY, width: ${SIDE}, height: ${FRAME} } })()`

  /* 2. The two links to pass on: the Share box of the open server. */
  await b.run(`document.querySelector('.mcpi-share').open = true`)
  await sleep(200)
  const share = await grab(from('.mcpi-main'))
  await b.run(`document.querySelector('.mcpi-share').open = false`)

  /* 3. A tool run: its form, Run, and the answer. */
  await b.run(`(() => { const i = document.getElementById('mcpi-f-query'); i.value = 'Model Context Protocol'; i.dispatchEvent(new Event('input')); document.querySelector('.mcpi-pane .mcpi-run').click() })()`)
  await b.until(`/ms$/.test(document.querySelector('.mcpi-pane .mcpi-out-bar span').textContent)`, 20000)
  await sleep(300)
  const tool = await grab(from('.mcpi-tabs'))

  /* 4. Debug, with one request open (the tool call, with its message and answer). */
  await b.run(`[...document.querySelectorAll('.mcpi-tab')].find((t) => t.textContent.startsWith('Debug')).click()`)
  await sleep(200)
  await b.run(`(() => { const d = [...document.querySelectorAll('.mcpi-dbg-row')].find((x) => /tools\\/call/.test(x.textContent)); if (d) d.open = true })()`)
  await sleep(200)
  const debug = await grab(from('.mcpi-tabs'))

  /*
   * 5. The Add to AI popup, at the client picked: its command, where to check it, and its two links.
   * The picked client is a command one, so nothing tries to open an app here.
   */
  await b.run(`document.querySelector('.mcpi-share').open = true; document.querySelector('.mcpi-share .mcpi-add-ai').click()`)
  await b.until(`document.querySelector('dialog.mcpi-addto')`, 5000)
  await b.run(`(() => { const d = document.querySelector('dialog.mcpi-addto'); d.querySelector('.mcpi-addto-tile[data-client=claude-code]').click(); d.scrollTop = 0; d.scrollTop = d.querySelector('.mcpi-addto-search').getBoundingClientRect().top - d.getBoundingClientRect().top - 8 })()`)
  await sleep(1200)
  const addTo = await grab(from('dialog.mcpi-addto', 'dialog.mcpi-addto'))
  await b.run(`document.querySelector('dialog.mcpi-addto').close()`)

  /* 6. On a phone: an inspector link opened there, a tool run, its answer. */
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
  await b.go(PAGE + (PAGE.includes('?') ? '&' : '?') + 'r=com.microsoft/microsoft-learn-mcp')
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
  await b.run(`for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'sticky' || p === 'fixed') && !e.closest('.mcpi')) e.style.display = 'none' }`)
  await b.run(`(() => { const i = document.getElementById('mcpi-f-query'); i.value = 'Model Context Protocol'; i.dispatchEvent(new Event('input')); document.querySelector('.mcpi-pane .mcpi-run').click() })()`)
  await b.until(`/ms$/.test(document.querySelector('.mcpi-pane .mcpi-out-bar span').textContent)`, 20000)
  await sleep(400)
  /* One phone screen, from the server's name down to the first lines of its answer. */
  await b.run(`document.querySelector('.mcpi-main').scrollIntoView({ block: 'start' }); window.scrollBy(0, -7)`)
  await sleep(300)
  const phone = await b.shot(null)
  await b.send('Emulation.clearDeviceMetricsOverride')

  /* 7. The hero: the desktop page in a window and the phone beside it, drawn as one picture. */
  const uri = (png) => 'data:image/png;base64,' + png.toString('base64')
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#fff;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
    #hero{position:relative;width:1200px;height:700px;background:#f6f8fb;border-radius:16px;overflow:hidden}
    .win{position:absolute;left:40px;top:44px;width:900px;border-radius:12px;background:#fff;box-shadow:0 12px 36px rgba(11,31,58,.16),0 0 0 1px #d5dde8;overflow:hidden}
    .bar{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;background:#eef3f9;border-bottom:1px solid #d5dde8}
    .bar i{width:10px;height:10px;border-radius:50%;background:#c3cddb}
    .bar span{margin-left:12px;flex:1;max-width:340px;padding:3px 12px;border-radius:999px;background:#fff;border:1px solid #d5dde8;color:#5b6b80;font-size:12px}
    .win img{display:block;width:900px}
    .phone{position:absolute;right:44px;top:96px;width:250px;padding:9px;border-radius:38px;background:#16181d;box-shadow:0 16px 40px rgba(11,31,58,.3)}
    .phone img{display:block;width:250px;border-radius:29px}
  </style><div id="hero"><div class="win"><div class="bar"><i></i><i></i><i></i><span>${SHOWN.replace(/^https?:\/\//, '')}</span></div><img src="${uri(desktop)}"></div><div class="phone"><img src="${uri(phone)}"></div></div>`
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 2, mobile: false })
  await b.go('about:blank')
  const { frameTree } = await b.send('Page.getFrameTree')
  await b.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
  await b.until(`[...document.images].length === 2 && [...document.images].every((i) => i.complete && i.naturalWidth)`, 10000)
  save('hero.png', await b.shot({ x: 0, y: 0, width: 1200, height: 700 }))

  /* 8. The feature shots, each as a card of one size, to sit right above its own text in the README. */
  const cardW = 588
  const cardH = Math.round(cardW * FRAME / SIDE)
  const card = async (name, png) => {
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}#c{box-sizing:border-box;width:${cardW}px;height:${cardH}px;border:1px solid #d5dde8;border-radius:12px;overflow:hidden;padding:10px 12px 0;background:#fff}#c img{display:block;width:100%}</style><div id="c"><img src="${uri(png)}"></div>`
    await b.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
    await b.until(`document.images.length === 1 && document.images[0].complete && document.images[0].naturalWidth`, 10000)
    save(name, await b.shot({ x: 0, y: 0, width: cardW, height: cardH }))
  }
  await card('feature-inspect.png', tool)
  await card('feature-debug.png', debug)
  await card('feature-inspector-link.png', share)
  await card('feature-connect-link.png', addTo)
  await b.send('Emulation.clearDeviceMetricsOverride')
} finally {
  await b.close()
}
