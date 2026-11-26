/*
 * Captures the README screenshots (docs/*.png) from the English live demo with headless Chrome (scripts/chrome.js).
 * Only the inspector itself is captured, not the site around it.
 *   npm run screenshots                                         the live demo
 *   PAGE=http://localhost:8787/?lang=en npm run screenshots     the local demo (npm run demo in another terminal)
 *   CHROME=/path/to/chrome                                      another browser
 * It opens Microsoft Learn from the registry, runs a tool and opens History, so it needs the network.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openChrome } from './chrome.js'

const PAGE = process.env.PAGE || 'https://aljal.kr/tools/mcp-inspector'
const outDir = new URL('../docs/', import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await openChrome({ width: 1200, height: 900, scale: 2 })
const shot = async (name, clipExpr) => {
  writeFileSync(new URL(name, outDir), await b.shot(await b.run(clipExpr)))
  console.log('wrote', fileURLToPath(new URL(name, outDir)))
}

try {
  await b.go(PAGE)
  await b.until(`[...document.querySelectorAll('.mcpi-reg')].some((x) => x.textContent.includes('Microsoft Learn'))`, 20000)
  await b.run(`[...document.querySelectorAll('.mcpi-reg')].find((x) => x.textContent.includes('Microsoft Learn')).click()`)
  await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
  await sleep(500)

  /* A site's sticky header would cover the inspector in full-page captures. */
  await b.run(`for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'sticky' || p === 'fixed') && !e.closest('.mcpi')) e.style.display = 'none' }`)

  /* 1. Overview: servers, registry and the open inspector. */
  await b.run('window.scrollTo(0, 0)')
  await shot('overview.png', `(() => { const r = document.querySelector('.mcpi').getBoundingClientRect(); const end = document.querySelector('.mcpi-main').getBoundingClientRect().top + 120; return { x: r.x - 16, y: r.y + scrollY - 16, width: r.width + 32, height: end - r.y + 16 } })()`)

  /* 2. A tool run. */
  await b.run(`(() => { const i = document.getElementById('mcpi-f-query'); i.value = 'Model Context Protocol'; i.dispatchEvent(new Event('input')); document.querySelector('.mcpi-pane .mcpi-run').click() })()`)
  await b.until(`/ms$/.test(document.querySelector('.mcpi-pane .mcpi-out-bar span').textContent)`, 20000)
  await sleep(300)
  const clipOf = (max) => `(() => { const r = document.querySelector('.mcpi-main').getBoundingClientRect(); return { x: r.x - 16, y: r.y + scrollY - 16, width: r.width + 32, height: Math.min(r.height + 32, ${max}) } })()`
  await shot('tool.png', clipOf(720))

  /* 3. History, with one entry open. */
  await b.run(`[...document.querySelectorAll('.mcpi-tab')].find((t) => t.textContent.startsWith('History')).click()`)
  await sleep(200)
  await b.run(`(() => { const d = document.querySelector('.mcpi-history details:nth-child(2)'); if (d) d.open = true })()`)
  await sleep(200)
  await shot('history.png', clipOf(1000))
} finally {
  await b.close()
}
