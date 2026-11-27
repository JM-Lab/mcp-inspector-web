/*
 * The page in a real browser: headless Chrome, the script tag bundle built from src/, and a local MCP server
 * (test/support/mcp-server.ts) on another origin that allows CORS. No outside network.
 * It clicks through what a person does: open a server, run tools, answer elicitation, cancel, prompts with completion,
 * resources, a list that changes, History, adding a server with a header token, a full OAuth round trip in the browser,
 * and arriving by a link (?r=, ?u= with &oauth or &h=, and the long forms) with the share and install box.
 * Skipped when no Chrome is found (set CHROME to its path); `MCPI_BROWSER=0` turns it off.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'esbuild'
import { findChrome, openChrome } from '../scripts/chrome.js'
import { startMcpServer } from './support/mcp-server.ts'

const chrome = process.env.MCPI_BROWSER === '0' ? null : findChrome()
const skip = process.env.MCPI_BROWSER === '0' ? 'MCPI_BROWSER=0' : !chrome && 'no Chrome found (set CHROME)'
/* On CI a missing Chrome is a broken setup, not a reason to pass with the browser tests left out. */
if (process.env.CI && skip && process.env.MCPI_BROWSER !== '0') throw new Error('CI: browser tests cannot run: ' + skip)

let mcp: Awaited<ReturnType<typeof startMcpServer>>
let page: http.Server
let origin = ''
let b: Awaited<ReturnType<typeof openChrome>>

/* Shortcuts the steps below call in the page. */
const HELPERS = `window.$t = {
  tab: (name) => [...document.querySelectorAll('.mcpi-tab')].find((b) => b.textContent.startsWith(name)),
  count: (name) => Number($t.tab(name).querySelector('i')?.textContent || 0),
  pick: (name) => [...document.querySelectorAll('.mcpi-pick')].find((b) => b.textContent === name).click(),
  status: () => document.querySelector('.mcpi-status')?.textContent,
  out: () => document.querySelector('.mcpi-pane .mcpi-res')?.innerText || '',
  note: () => document.querySelector('.mcpi-pane .mcpi-out-bar span')?.textContent || '',
  set: (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')) },
  field: (name, scope = '.mcpi-pane') => document.querySelector(scope + ' #mcpi-f-' + name),
  run: () => document.querySelector('.mcpi-pane .mcpi-run').click(),
  button: (text, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text),
}; true`
const open = async (query = '') => { await b.go(origin + '/' + query); await b.run(HELPERS) }

before(async () => {
  if (skip) return
  mcp = await startMcpServer({ cors: true })
  const js = (await build({ entryPoints: ['src/auto.js'], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })).outputFiles[0].text
  const css = (await build({ entryPoints: ['src/style.css'], bundle: true, write: false, logLevel: 'silent' })).outputFiles[0].text
  /* The add-to-AI-client component alone, on a page with nothing else (no stylesheet either). */
  const addTo = (await build({ entryPoints: ['src/add-to-ai-auto.js'], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })).outputFiles[0].text
  const addToPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>component</title>
<mcp-add-to-ai id="open" url="https://docs.example/mcp" name="Docs" registry="io.example/docs"></mcp-add-to-ai>
<mcp-add-to-ai id="locked" url="https://k.example/mcp" name="Keyed" header="Authorization"></mcp-add-to-ai>
<mcp-add-to-ai id="ko" url="https://docs.example/mcp" lang="ko"></mcp-add-to-ai>
<mcp-add-to-ai id="byname" registry="io.test/docs" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<mcp-add-to-ai id="renamed" registry="io.test/docs" name="My docs" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<mcp-add-to-ai id="missing" registry="io.test/nothing" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<mcp-add-to-ai id="retired" registry="io.test/retired" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<div id="host"></div><script src="/mcp-add-to-ai.js"></script>`
  /* The module itself (mount and the rest), as a page that imports it would use it. */
  const lib = (await build({ entryPoints: ['src/index.js'], bundle: true, format: 'iife', globalName: 'MCPI', platform: 'browser', write: false, logLevel: 'silent' })).outputFiles[0].text
  const libPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>module</title><div id="x"></div><script src="/lib.js"></script>`
  /* A stand-in for the MCP Registry: one server by name, and an empty list for the panel. */
  const entry = { server: { name: 'io.test/local', title: 'Registry test server', description: 'from the registry', remotes: [{ type: 'streamable-http', url: mcp.base + '/from-registry' }] } }
  const locked = { server: { name: 'io.test/locked', title: 'Locked', remotes: [{ type: 'streamable-http', url: mcp.base + '/token-registry', headers: [{ name: 'x-test-key', value: '\${KEY}', isRequired: true, isSecret: true }] }] } }
  /* For the AI component: an entry with an https remote (what it accepts) and the header it needs. */
  const docs = { server: { name: 'io.test/docs', title: 'Docs from the registry', remotes: [{ type: 'streamable-http', url: 'https://docs.example/mcp', headers: [{ name: 'X-Docs-Key', isSecret: true }] }] } }
  const retired = { server: { name: 'io.test/retired', title: 'Retired', remotes: [{ type: 'streamable-http', url: 'https://retired.example/mcp' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deprecated' } } }
  /* Search results: addresses the panel lists (https only), never connected to here. */
  const found = ['a', 'b'].map((x) => ({ server: { name: 'io.test/' + x, title: 'Found ' + x.toUpperCase(), remotes: [{ type: 'streamable-http', url: 'https://' + x + '.example/mcp' }] } }))
  const registry = { 'io.test/local': entry, 'io.test/locked': locked, 'io.test/docs': docs, 'io.test/retired': retired }
  const options = { lang: 'en', registry: '/registry/v0/servers', openFirst: false, servers: [{ key: 'local', name: 'Local test server', url: mcp.base + '/mcp' }] }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>test</title><link rel="stylesheet" href="/mcp-inspector.css">
<div id="mcpi"></div><script>window.MCP_INSPECTOR = ${JSON.stringify(options)}</script><script src="/mcp-inspector.js"></script>`
  page = http.createServer((req, res) => {
    const full = new URL(req.url!, 'http://x')
    const path = full.pathname
    if (path === '/mcp-inspector.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(js); return }
    if (path.startsWith('/registry/')) {
      const name = decodeURIComponent(path.replace('/registry/v0/servers/', '').replace('/versions/latest', ''))
      const body = path === '/registry/v0/servers' ? { servers: full.searchParams.get('search') ? found : [], metadata: {} } : registry[name as keyof typeof registry]
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body || { error: 'not found' })); return
    }
    if (path === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(lib); return }
    if (path === '/lib.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(libPage); return }
    if (path === '/mcp-add-to-ai.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(addTo); return }
    if (path === '/add-to-ai.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(addToPage); return }
    if (path === '/mcp-inspector.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(css); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html)
  })
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', r))
  origin = 'http://127.0.0.1:' + (page.address() as { port: number }).port
  b = await openChrome()
})
after(async () => {
  if (skip) return
  await b?.close()
  page?.close()
  mcp?.close()
})

test('browser: the page against a local server, as a person uses it', { skip, timeout: 120000 }, async (t) => {
  await t.test('opening a pinned server connects and lists everything', async () => {
    await open('?server=local')
    await b.until(`$t.status() === 'Connected'`)
    assert.deepEqual(await b.run(`[$t.count('Tools'), $t.count('Prompts'), $t.count('Resources')]`), [5, 1, 1])
    assert.match(await b.run(`document.querySelector('.mcpi-info').textContent`), /mcpi-test 0\.0\.1/)
    /* The line is as wide as the panel (a class of the same name on something else once squeezed it into a small box). */
    assert.ok(await b.run(`document.querySelector('.mcpi-info').getBoundingClientRect().width > 300`), 'the server line has its full width')
    assert.equal(await b.run(`document.querySelector('.mcpi-instr pre').textContent`), 'test instructions')
    assert.match(await b.run('location.search'), /\?s=local/)
  })

  await t.test('Run is held back while a required field is empty', async () => {
    await b.run(`$t.pick('echo'); $t.run()`)
    assert.equal(await b.run(`document.querySelector('.mcpi-pane .mcpi-field-err').textContent`), 'This field is required.')
    assert.equal(await b.run(`document.querySelector('.mcpi-pane .mcpi-out').hidden`), true)
  })

  await t.test('a tool runs and its answer shows with timing', async () => {
    await b.run(`$t.set($t.field('text'), 'hello from the browser'); $t.run()`)
    await b.until(`$t.out().includes('hello from the browser')`)
    assert.match(await b.run('$t.note()'), /^\d+ ms$/)
  })

  await t.test('the server asks for input and the answer goes back', async () => {
    await b.run(`$t.pick('ask_name'); $t.run()`)
    await b.until(`document.querySelector('.mcpi-ask')`)
    assert.equal(await b.run(`document.querySelector('.mcpi-ask-msg').textContent`), 'What is your name?')
    await b.run(`$t.set($t.field('name', '.mcpi-ask'), 'Ada'); $t.button('Accept', document.querySelector('.mcpi-ask')).click()`)
    await b.until(`$t.out().includes('Ada')`)
    assert.match(await b.run('$t.out()'), /"action":\s*"accept"/)
    assert.equal(await b.run(`document.querySelector('.mcpi-ask')`), null)
  })

  await t.test('a long request shows progress and can be cancelled', async () => {
    await b.run(`$t.pick('slow'); $t.set($t.field('steps'), '50'); $t.run()`)
    await b.until(`/Asking… \\d+ \\/ 50/.test($t.note())`)
    await b.run(`$t.button('Cancel', document.querySelector('.mcpi-pane')).click()`)
    await b.until(`$t.out() === 'Cancelled'`)
  })

  await t.test('a prompt gets completion suggestions and runs', async () => {
    await b.run(`$t.tab('Prompts').click()`)
    await b.run(`$t.set($t.field('lang'), 'ko')`)
    await b.until(`document.querySelector('#mcpi-f-lang-list option')?.value === 'korean'`)
    await b.run(`$t.set($t.field('lang'), 'korean'); $t.run()`)
    await b.until(`$t.out().includes('hello in korean')`)
    assert.equal(await b.run(`document.querySelector('.mcpi-pane .mcpi-role')?.textContent`), 'user', 'prompt messages show their role')
  })

  await t.test('a resource is read', async () => {
    await b.run(`$t.tab('Resources').click(); $t.run()`)
    await b.until(`$t.out().includes('tick')`)
  })

  await t.test('a list_changed notification refreshes the list', async () => {
    await b.run(`$t.tab('Tools').click(); $t.pick('add_tool'); $t.run()`)
    await b.until(`$t.count('Tools') === 5`)
  })

  await t.test('Debug holds every request with the JSON-RPC message it carried and its answer', async () => {
    await b.run(`$t.tab('Debug').click()`)
    const rows: string[] = await b.run(`[...document.querySelectorAll('.mcpi-dbg-row summary code')].map((c) => c.textContent)`)
    for (const m of ['initialize', 'tools/list', 'tools/call', 'prompts/get', 'completion/complete', 'resources/read', 'notifications/cancelled']) assert.ok(rows.some((r) => r.startsWith('POST /mcp · ' + m)), m + ' is in Debug, on its HTTP request')
    /* Opening a row shows what was sent and what came back. */
    const row = `[...document.querySelectorAll('.mcpi-dbg-row')].find((x) => x.querySelector('code').textContent.startsWith('POST /mcp · tools/list'))`
    await b.run(`${row}.open = true`)
    /* The newest tools/list may still be waiting for its answer (the list just changed): the row fills in when it comes. */
    await b.until(`/"tools": \\[/.test(${row}.textContent)`, 5000)
    const opened = await b.run(`${row}.textContent`)
    assert.match(opened, /"method": "tools\/list"/)
    assert.match(opened, /"tools": \[/)
    assert.match(opened, /mcp-session-id: •••/, 'the session id is hidden')
    /* A row already drawn is left in place when more comes in, so what is open and selected in it stays. */
    await b.run(`window.__row = ${row}; $t.button('Ping').click()`)
    await b.until(`[...document.querySelectorAll('.mcpi-dbg-row summary code')].some((c) => /· ping #/.test(c.textContent))`, 5000)
    assert.equal(await b.run(`window.__row.isConnected && window.__row.open && window.__row === ${row}`), true)
    /* Pressing a filter that hides a row, then asking to show it, still lands on it. */
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-filter=errors]').click()`)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-dbg-row').length`), 0)
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-filter=all]').click()`)
    /* No OAuth here, so no OAuth flow box, and nothing failed. */
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-flow').hidden`), true)
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-notice')?.hidden ?? true`), true)
    /* The plain log, one line each. */
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-mode=log]').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-dbg-log').textContent`), /→ POST {3}http:\/\/127\.0\.0\.1:\d+\/mcp {2}tools\/call #\d+/)
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-mode=list]').click()`)
  })

  await t.test('every action button shows an icon with its word, in one style', async () => {
    /* Tool, prompt and resource panes, the header, the auth box and the Share box: none is left as words alone. Copy is an icon alone, its word in the tooltip. */
    const bare = `[...document.querySelectorAll('.mcpi .mcpi-btn, .mcpi .mcpi-run, .mcpi .mcpi-json, .mcpi-addto-trigger')].filter((b) => !b.querySelector('svg') || (!b.textContent.trim() && !b.classList.contains('mcpi-icon-btn'))).map((b) => b.className + ':' + b.textContent)`
    for (const tab of ['Tools', 'Prompts', 'Resources']) {
      await b.run(`$t.tab('${tab}').click()`)
      assert.deepEqual(await b.run(bare), [], tab)
    }
    await b.run(`$t.tab('Tools').click()`)
    /* The tabs too: each has its icon before its name. */
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-tab')].map((x) => !!x.querySelector('svg') && x.textContent.trim().split(/\\s|\\d/)[0])`), ['Tools', 'Prompts', 'Resources', 'Debug'])
    /* On a phone the four tabs still fit their row, none cut off or scrolled away. */
    await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true })
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(await b.run(`(() => { const t = document.querySelector('.mcpi-tabs'); return t.scrollWidth <= t.clientWidth && [...t.children].every((x) => x.getBoundingClientRect().right <= t.getBoundingClientRect().right + 1) })()`), true)
    await b.send('Emulation.clearDeviceMetricsOverride')
  })

  await t.test('Ping answers with a time', async () => {
    await b.run(`[...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Ping')).click()`)
    await b.until(`[...document.querySelectorAll('button')].some((x) => /^Ping \\d+ ms$/.test(x.textContent))`)
  })

  await t.test('a server added by address with a header token connects and is kept', async () => {
    await open()
    await b.run(`(() => {
      const f = document.querySelector('.mcpi-add')
      $t.set(f.querySelector('input[type=url]'), ${JSON.stringify(mcp.base + '/token')})
      $t.set(f.querySelector('.mcpi-add-auth'), 'header')
      const [name, value] = f.querySelectorAll('.mcpi-add-header input')
      $t.set(name, 'x-test-key'); $t.set(value, 'secret')
      f.requestSubmit()
    })()`)
    await b.until(`$t.status() === 'Connected'`)
    await open()
    const kept = await b.run(`[...document.querySelectorAll('.mcpi-server')].map((c) => c.dataset.key)`)
    assert.ok(kept.includes(mcp.base + '/token'), 'the added server is still listed after a reload')
  })

  await t.test('the header token is hidden on screen, kept for this tab only, and the i says so', async () => {
    const card = `[...document.querySelectorAll('.mcpi-server')].find((c) => c.dataset.key === ${JSON.stringify(mcp.base + '/token')})`
    /* The same tab after a reload: the token is still there, so it connects. */
    await b.run(`${card}.click()`)
    await b.until(`$t.status() === 'Connected' && !document.querySelector('.mcpi-auth').hidden`)
    assert.equal(await b.run(`JSON.stringify(Object.entries(localStorage)).includes('secret')`), false, 'the value is not in localStorage')
    assert.match(await b.run(`sessionStorage.getItem('mcpi:header-tokens')`), /"x-test-key":"secret"/)
    /* Dots until the eye is pressed, and again when pressed once more. */
    const value = `document.querySelectorAll('.mcpi-token input')[1]`
    assert.deepEqual(await b.run(`[${value}.type, ${value}.value]`), ['password', 'secret'])
    await b.run(`document.querySelector('.mcpi-token .mcpi-eye').click()`)
    assert.deepEqual(await b.run(`[${value}.type, document.querySelector('.mcpi-token .mcpi-eye').title]`), ['text', 'Hide the token'])
    await b.run(`document.querySelector('.mcpi-token .mcpi-eye').click()`)
    assert.equal(await b.run(`${value}.type`), 'password')
    /* The i: its words as a tooltip, and on the page when pressed. */
    const info = `document.querySelector('.mcpi-auth .mcpi-i')`
    assert.match(await b.run(`${info}.title`), /kept only until you close this tab/)
    assert.equal(await b.run(`document.querySelector('.mcpi-auth .mcpi-info-note').hidden`), true)
    await b.run(`${info}.click()`)
    assert.equal(await b.run(`getComputedStyle(document.querySelector('.mcpi-auth .mcpi-info-note')).display !== 'none' && ${info}.getAttribute('aria-expanded')`), 'true')
    /* The add form has the same field and the same i. */
    assert.equal(await b.run(`document.querySelector('.mcpi-add-header input[aria-label="Header value"]').type + '|' + !!document.querySelector('.mcpi-add-header .mcpi-i')`), 'password|true')
    /* A new tab (nothing in sessionStorage): the server and its header name are there, the token is not, and it asks for it. */
    const tokens = await b.run(`sessionStorage.getItem('mcpi:header-tokens')`)
    await b.run(`sessionStorage.removeItem('mcpi:header-tokens')`)
    await open()
    await b.run(`${card}.click()`)
    await b.until(`$t.status() === 'Sign-in needed' && !document.querySelector('.mcpi-auth').hidden`)
    assert.equal(await b.run(`document.querySelector('.mcpi-status').dataset.state`), 'auth', 'not shown as a failure')
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-token input')].map((i) => i.value)`), ['x-test-key', ''])
    /* Put back, as the tab had it, for the tests that follow. */
    await b.run(`sessionStorage.setItem('mcpi:header-tokens', ${JSON.stringify(tokens)})`)
    await open()
  })

  /* No token, code or verifier anywhere on the page or in localStorage (tokens live in sessionStorage, by design). */
  const noSecrets = async (secrets: string[]) => {
    await b.run(`document.querySelectorAll('.mcpi-dbg-row').forEach((d) => { d.open = true })`)
    await new Promise((r) => setTimeout(r, 100))
    const seen = await b.run(`document.documentElement.outerHTML + JSON.stringify(Object.entries(localStorage))`)
    for (const s of secrets) assert.ok(!seen.includes(s), s + ' is not on the page or in localStorage')
  }
  const addWithOauth = (path: string) => b.run(`(() => {
    const f = document.querySelector('.mcpi-add')
    $t.set(f.querySelector('input[type=url]'), ${JSON.stringify(mcp.base)} + ${JSON.stringify(path)})
    $t.set(f.querySelector('.mcpi-add-auth'), 'oauth')
    f.requestSubmit()
  })()`)
  const notice = `document.querySelector('.mcpi-dbg-notice:not([hidden])')?.innerText || ''`

  await t.test('OAuth with PKCE, through a real redirect and back', async () => {
    const before = mcp.oauth.tokenCalls
    await b.run(`(() => {
      const f = document.querySelector('.mcpi-add')
      $t.set(f.querySelector('input[type=url]'), ${JSON.stringify(mcp.base + '/oauth-mcp')})
      $t.set(f.querySelector('.mcpi-add-auth'), 'oauth')
      f.requestSubmit()
    })()`)
    /* The page leaves for the authorization server, which sends it back with a code. */
    await b.until(`!/code=/.test(location.search) && /oauth-mcp/.test(decodeURIComponent(location.search)) && document.querySelector('.mcpi-status')?.textContent === 'Connected'`, 20000)
    assert.equal(mcp.oauth.tokenCalls, before + 1, 'the code was exchanged once')
    assert.ok(mcp.oauth.registered >= 1, 'the client registered itself')
    await b.run(HELPERS)
    assert.equal(await b.run(`$t.count('Tools')`), 5)
    assert.equal(await b.run(`Object.keys(sessionStorage).some((k) => k.startsWith('mcpi:tokens:'))`), true, 'tokens are in sessionStorage')
    assert.equal(await b.run(`localStorage.getItem('mcpi:oauth')`), null, 'the pending sign-in was used up')
    /* Nothing failed, so nothing new on screen. In Debug, the OAuth flow from before and after the redirect, all eight steps done. */
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-notice').hidden`), true)
    await b.run(`$t.tab('Debug').click()`)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-dbg-strip [data-step]')].map((x) => x.dataset.step + ':' + x.dataset.status)`),
      ['unauth:ok', 'resource:ok', 'server:ok', 'register:ok', 'redirect:ok', 'return:ok', 'token:ok', 'ready:ok'])
    assert.equal(await b.run(`Object.keys(localStorage).some((k) => k.startsWith('mcpi:trip:'))`), false, 'the kept sign-in was read back and removed')
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-mode=log]').click()`)
    const log = await b.run(`document.querySelector('.mcpi-dbg-log').textContent`)
    assert.match(log, /POST {3}http:\/\/127\.0\.0\.1:\d+\/oauth-as\/token .*"code":"•••","code_verifier":"•••"/)
    assert.match(log, /"access_token":"•••"/)
    await b.run(`document.querySelector('.mcpi-dbg-pill[data-mode=list]').click()`)
    await noSecrets(['good-token', 'code-1'])
  })


  await t.test('OAuth that cannot register: the notice says where it stopped, and its button opens Debug at that step', async () => {
    await open()
    await addWithOauth('/nodcr-mcp')
    await b.until(`/step 4/.test(${notice})`, 10000)
    assert.match(await b.run(notice), /OAuth stopped at step 4, Client registration\.\s*The authorization server offers no dynamic client registration/)
    assert.equal(await b.run('location.origin'), origin, 'still on this page')
    await b.run(`$t.button('Show in Debug').click()`)
    assert.equal(await b.run(`document.querySelector('.mcpi-tab.is-on').textContent.startsWith('Debug')`), true)
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-flow').open`), true)
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-strip [data-step=register]').dataset.status`), 'fail')
    /* The row it points at is the authorization server metadata (no registration_endpoint), opened and marked. */
    assert.match(await b.run(`document.querySelector('.mcpi-dbg-row.is-hit').textContent`), /oauth-authorization-server\/nodcr-as/)
    assert.equal(await b.run(`document.querySelector('.mcpi-dbg-row.is-hit').open`), true)
    /* The Debug tab carries a red mark while the connection is failed. */
    assert.equal(await b.run(`!!document.querySelector('.mcpi-tab i.is-bad')`), true)
  })

  await t.test('a code the token endpoint refuses: stopped at the token exchange with its error, and no second trip by itself', async () => {
    const calls = mcp.oauth.tokenCalls
    await open()
    await addWithOauth('/badtoken-mcp')
    await b.until(`location.origin === ${JSON.stringify(origin)} && /step 7/.test(${notice})`, 20000)
    await b.run(HELPERS)
    assert.match(await b.run(notice), /OAuth stopped at step 7, Token exchange\.\s*The server answered 400: invalid_grant/)
    assert.ok(mcp.oauth.tokenCalls > calls, 'the code was tried')
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(await b.run('location.origin + !/code=/.test(location.search)'), origin + 'true', 'the SDK retrying sign-in by itself does not leave the page')
    await b.run(`$t.button('Show in Debug').click()`)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-dbg-strip [data-step]')].map((x) => x.dataset.status)`), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'fail', 'none'])
    await noSecrets(['code-bad'])
  })

  await t.test('a token endpoint that does not allow the browser: no answer, and the reason is CORS (the server is there)', async () => {
    await open()
    await addWithOauth('/nocors-mcp')
    await b.until(`location.origin === ${JSON.stringify(origin)} && /is there/.test(${notice})`, 20000)
    await b.run(HELPERS)
    assert.match(await b.run(notice), /OAuth stopped at step 7, Token exchange\.\s*127\.0\.0\.1:\d+ is there, but does not allow requests from this page \(CORS\)/)
    await b.run(`$t.button('Show in Debug').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-dbg-row.is-hit').textContent`), /POST \S*nocors-as\/token.*No answer/)
    await noSecrets(['code-1'])
  })

  /* Which revision of the protocol a server speaks: shown in the head, with what it means, and in Debug with how it was found. */
  const proto = `(() => { const p = document.querySelector('.mcpi-proto'); const n = document.querySelector('.mcpi-proto-note'); const d = document.querySelector('.mcpi-dbg-proto'); return { text: p && p.textContent, level: p && p.dataset.level, era: p && p.dataset.era, note: n && !n.hidden ? n.textContent : '', debug: d && !d.hidden ? d.textContent : '', debugLevel: d && d.dataset.level } })()`
  const openAt = async (path: string) => {
    await open('?u=' + mcp.base + path)
    await b.until(`$t.status() === 'Connected' && document.querySelector('.mcpi-proto')`)
    await b.run(`$t.tab('Debug').click()`)
    await b.until(`document.querySelector('.mcpi-dbg-proto') && !document.querySelector('.mcpi-dbg-proto').hidden`, 3000)
    return b.run(proto)
  }

  await t.test('a 2026-07-28 server: shown as current, spoken to without initialize, with Ping, a list change and elicitation working', async () => {
    const p = await openAt('/modern-mcp')
    assert.deepEqual([p.text, p.level, p.era, p.note], ['protocol 2026-07-28 (current)', 'current', 'modern', ''])
    assert.match(p.debug, /^Protocol 2026-07-28 · the server answered server\/discover: no initialize, no session\.$/)
    const rows: string[] = await b.run(`[...document.querySelectorAll('.mcpi-dbg-row summary code')].map((c) => c.textContent)`)
    assert.ok(rows.some((r) => r.includes('server/discover')) && !rows.some((r) => r.includes('initialize')), 'discover, and no initialize')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-dbg-row[data-level=fail]').length`), 0)
    /* The logging level is a 2025 request, so it is not offered. Ping sends server/discover, and says so. */
    assert.equal(await b.run(`document.querySelector('.mcpi-level').hidden`), true)
    assert.match(await b.run(`[...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Ping')).title`), /server\/discover/)
    await b.run(`[...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Ping')).click()`)
    await b.until(`[...document.querySelectorAll('button')].some((x) => /^Ping \\d+ ms$/.test(x.textContent))`)
    /* Elicitation: the server answers "input required", and the same form appears. */
    await b.run(`$t.tab('Tools').click(); $t.pick('ask_name'); $t.run()`)
    await b.until(`document.querySelector('.mcpi-ask')`)
    await b.run(`$t.set($t.field('name', '.mcpi-ask'), 'Ada'); $t.button('Accept', document.querySelector('.mcpi-ask')).click()`)
    await b.until(`$t.out().includes('Ada')`)
    /* A list change arrives on the stream the client opened. */
    const before = await b.run(`$t.count('Tools')`)
    await b.run(`$t.pick('add_tool'); $t.run()`)
    await b.until(`$t.count('Tools') === ${before} + 1`, 5000)
  })

  await t.test('a 2025-11-25 server: an info note that it is the earlier way and fine, and Debug says the probe was not answered', async () => {
    const p = await openAt('/mcp')
    assert.deepEqual([p.text, p.level, p.era], ['protocol 2025-11-25 (earlier way)', 'info', 'legacy'])
    assert.match(p.note, /^Connected the earlier way: an initialize handshake and a session, at revision 2025-11-25\. That is fine, and the specification still allows it\.$/)
    assert.match(p.debug, /^Protocol 2025-11-25 · initialize handshake and a session\. The 2026-07-28 probe \(server\/discover\) was tried first and answered “400 .*”, so the earlier way was used\. That is fine: the specification still allows it\. Show the probe$/)
    assert.equal(p.debugLevel, 'info')
    /* The probe is a row marked as expected, not as failed, and the Debug tab carries no error mark. */
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-dbg-row[data-level=fail]').length`), 0)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-tab i.is-bad')`), false)
    await b.run(`$t.button('Show the probe', document.querySelector('.mcpi-dbg-proto')).click()`)
    await b.until(`document.querySelector('.mcpi-dbg-row.is-hit .mcpi-dbg-hint')`, 3000)
    assert.match(await b.run(`document.querySelector('.mcpi-dbg-row.is-hit').textContent`), /server\/discover.*Nothing is wrong\./)
    assert.equal(await b.run(`document.querySelector('.mcpi-level').hidden`), false, 'the logging level is offered the 2025 way')
  })

  await t.test('an older server: a warning that names what came later, or says that everything works', async () => {
    const old = await openAt('/rev-2025-03-26-mcp')
    assert.deepEqual([old.text, old.level, old.era, old.debugLevel], ['protocol 2025-03-26 (older revision)', 'warn', 'legacy', 'warn'])
    assert.match(old.note, /^This server speaks revision 2025-03-26, an older one\. It works here\. These came with a later revision, so it may not offer them: asking you for input \(elicitation, 2025-06-18\), display titles \(2025-06-18\)\.$/)
    assert.equal(await b.run(`document.querySelector('.mcpi-status').textContent`), 'Connected', 'a warning, not a failure')
    const mid = await openAt('/rev-2025-06-18-mcp')
    assert.deepEqual([mid.text, mid.level], ['protocol 2025-06-18 (older revision)', 'warn'])
    assert.equal(mid.note, 'This server speaks revision 2025-06-18, an older one. Everything this inspector does works with it.')
  })

  await t.test('a registry link opens that server, and the share box offers the same link and the AI button', async () => {
    await open('?r=io.test/local')
    await b.until(`$t.status() === 'Connected'`)
    assert.equal(await b.run(`document.querySelector('.mcpi-id h2').textContent`), 'Registry test server')
    assert.equal(await b.run('location.search'), '?r=io.test/local')
    assert.equal(await b.run(`document.querySelector('.mcpi-share-link').value`), origin + '/?r=io.test/local')
    /* Two links to pass on, each named and with its own sign: the inspector link here, the connect link under the client picked. */
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-share-kind')].map((p) => p.textContent.split(':')[0] + ':' + !!p.querySelector('svg'))`), ['Inspector link:true', 'Connect link:true'])
    assert.match(await b.run(`document.querySelector('.mcpi-card-share').title`), /^Copy inspector link/)
    assert.equal(await b.run(`document.querySelector('.mcpi-card-ai').textContent + '|' + document.querySelector('.mcpi-card-ai').querySelectorAll('svg path').length`), 'Add to AI|3', 'a spark with a plus, and the words')
    assert.equal(await b.run(`document.querySelector('.mcpi-card-share').textContent + '|' + !!document.querySelector('.mcpi-card-share svg')`), 'Inspector link|true', 'the card button says what it copies')
    await b.run(`document.querySelector('.mcpi-share .mcpi-add-ai').click()`)
    await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === 'claude-code').click()`)
    /* Under the client, both links to pass on: the inspector link (a flask) and the connect link (a plug with a spark). */
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-addto-share')].map((x) => x.className.split(' is-').pop() + '|' + x.textContent + '|' + x.dataset.copy)`),
      ['flask|Inspector link|' + origin + '/?r=io.test/local', 'plug|Claude Code connect link|' + origin + '/?r=io.test/local&to=claude-code'])
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail pre').textContent`), 'claude mcp add --transport http local ' + mcp.base + '/from-registry')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
  })

  await t.test('a registry entry that needs a header shows its field at once, and the token reaches the server', async () => {
    await open('?r=io.test/locked')
    await b.until(`!document.querySelector('.mcpi-auth').hidden`)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-token input')].map((i) => i.value || i.placeholder)`), ['x-test-key', '<KEY>'])
    await b.run(`(() => { const [, v] = document.querySelectorAll('.mcpi-token input'); $t.set(v, 'secret'); document.querySelector('.mcpi-token').requestSubmit() })()`)
    await b.until(`$t.status() === 'Connected'`)
    assert.doesNotMatch(await b.run(`document.querySelector('.mcpi-share-link').value + location.search`), /secret/, 'the token is never in a link')
  })

  await t.test('an unknown registry name says so', async () => {
    await open('?r=io.test/nothing')
    await b.until(`document.querySelector('.mcpi-notice')`)
  })

  await t.test('a registry entry marked deprecated is not opened, and says why', async () => {
    await open('?r=io.test/retired')
    await b.until(`document.querySelector('.mcpi-notice')`)
    assert.match(await b.run(`document.querySelector('.mcpi-notice').textContent`), /deprecated/)
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true)
  })

  await t.test('&oauth shows the sign-in button and waits for a press', async () => {
    const calls = mcp.oauth.tokenCalls
    await b.run('sessionStorage.clear()')
    await open('?u=' + mcp.base + '/oauth-mcp&oauth')
    await b.until(`$t.status() === 'Sign-in needed'`)
    assert.equal(await b.run(`$t.button('Connect with OAuth (PKCE)').hidden`), false)
    assert.equal(await b.run('location.origin'), origin, 'still on this page, no redirect')
    assert.equal(mcp.oauth.tokenCalls, calls)
    assert.match(await b.run(`document.querySelector('.mcpi-share-link').value`), /&oauth$/)
  })

  await t.test('&h= names the header, the long form still works, and other query keys stay', async () => {
    await open('?lang=en&url=' + mcp.base + '/token&auth=header&header=x-test-key')
    await b.until(`!document.querySelector('.mcpi-auth').hidden`)
    assert.equal(await b.run(`document.querySelector('.mcpi-token input').value`), 'x-test-key')
    assert.match(await b.run('location.search'), /^\?lang=en&u=http:\/\/127\.0\.0\.1:\d+\/token&h=x-test-key$/, 'rewritten in the short form')
  })

  await t.test('the <mcp-inspector> element mounts from its attributes and options, and closes when removed', async () => {
    await b.go(origin + '/lib.html')
    await b.run(HELPERS)
    const url = JSON.stringify(mcp.base + '/mcp')
    await b.run(`MCPI.defineInspector(); const el = document.createElement('mcp-inspector'); el.setAttribute('lang', 'ko'); el.setAttribute('registry', 'false'); el.setAttribute('sync-url', 'false'); el.setAttribute('page-url', 'https://my.example/miw'); el.options = { servers: [{ key: 'local', name: 'Local', url: ${url} }] }; document.body.append(el); true`)
    await b.until(`document.querySelector('mcp-inspector.mcpi .mcpi-server')`, 4000)
    assert.equal(await b.run(`!!document.querySelector('mcp-inspector .mcpi-registry')`), false, 'registry="false" hides the registry')
    assert.match(await b.run(`document.querySelector('mcp-inspector .mcpi-label').textContent`), /추천 서버|최근|내가/, 'lang="ko"')
    assert.equal(await b.run(`document.querySelector('mcp-inspector .mcpi-card-share').dataset.copy`), 'https://my.example/miw?s=local', 'page-url starts its links')
    await b.until(`$t.status() === 'Connected'`)
    /* A changed attribute mounts it again; removing it takes it down. */
    await b.run(`document.querySelector('mcp-inspector').setAttribute('lang', 'en'); true`)
    await b.until(`/Featured servers/.test(document.querySelector('mcp-inspector .mcpi-label').textContent)`, 4000)
    await b.run(`window.el = document.querySelector('mcp-inspector'); el.remove(); true`)
    assert.equal(await b.run(`el.childElementCount + '|' + el.classList.contains('mcpi') + '|' + (el.inspector === null)`), '0|false|true')
  })

  await t.test('mount returns destroy, which closes its connections and empties the element', async () => {
    await b.go(origin + '/lib.html')
    await b.run(HELPERS)
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: null, servers: [{ key: 'local', name: 'Local', url: ${JSON.stringify(mcp.base + '/mcp')} }], syncUrl: false }); document.querySelector('.mcpi-server').click(); true`)
    await b.until(`$t.status() === 'Connected'`)
    await b.run(`inst.destroy()`)
    assert.equal(await b.run(`document.querySelector('#x').childElementCount`), 0)
    assert.equal(await b.run(`document.querySelector('#x').classList.contains('mcpi')`), false)
    /* Mounted again on the same element, it starts fresh. */
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: null, servers: [{ key: 'local', name: 'Local', url: ${JSON.stringify(mcp.base + '/mcp')} }], syncUrl: false, openFirst: false }); true`)
    assert.equal(await b.run(`document.querySelectorAll('#x .mcpi-server').length >= 1 && document.querySelector('.mcpi-main').hidden`), true)
    await b.run(`inst.destroy(); true`)
  })

  await t.test('one server is always open: the first well-known one on arrival, the next one after removing it', async () => {
    await b.go(origin + '/lib.html')
    await b.run(HELPERS)
    const featured = { servers: [{ id: 'io.test/local', name: 'Featured local', url: mcp.base + '/mcp', open: true }] }
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: '/registry/v0/servers', featured: ${JSON.stringify(featured)}, servers: [{ key: 'pinned', name: 'Pinned', url: ${JSON.stringify(mcp.base + '/from-registry')} }], syncUrl: false }); true`)
    await b.until(`!document.querySelector('.mcpi-main').hidden`, 4000)
    assert.equal(await b.run(`document.querySelector('.mcpi-id h2').textContent`), 'Featured local', 'the first well-known server, not a saved one')
    assert.equal(await b.run(`!!document.querySelector('.mcpi-reg-list .mcpi-main')`), true, 'under its card in the list')
    assert.equal(await b.run(`scrollY`), 0, 'quietly: the page does not scroll')
    await b.until(`$t.status() === 'Connected'`)
    /* Removed: the next saved server opens instead of leaving nothing. */
    await b.run(`[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key === ${JSON.stringify(mcp.base + '/mcp')}).querySelector('.mcpi-remove').click()`)
    await b.until(`document.querySelector('.mcpi-id h2').textContent === 'Pinned'`, 4000)
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), false)
    await b.run(`inst.destroy(); true`)
    /* A link to a registry name that is not there says so, and still leaves a server open. */
    await b.go(origin + '/lib.html?r=io.test/nothing')
    await b.run(HELPERS)
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: '/registry/v0/servers', featured: ${JSON.stringify(featured)}, servers: [], syncUrl: false }); true`)
    await b.until(`document.querySelector('.mcpi-notice') && !document.querySelector('.mcpi-main').hidden`, 4000)
    assert.equal(await b.run(`document.querySelector('.mcpi-id h2').textContent`), 'Featured local')
    await b.run(`[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key === ${JSON.stringify(mcp.base + '/mcp')}).querySelector('.mcpi-remove').click(); inst.destroy(); true`)
  })

  await t.test('a tool marked destructive runs on the second press', async () => {
    await open('?s=local')
    await b.until(`$t.status() === 'Connected'`)
    await b.run(`$t.pick('wipe'); $t.run()`)
    assert.match(await b.run(`document.querySelector('.mcpi-item .mcpi-run').textContent`), /Press again to run/)
    assert.equal(await b.run(`document.querySelector('.mcpi-item .mcpi-out')?.textContent.includes('wiped') || false`), false, 'not run yet')
    await b.run(`document.querySelector('.mcpi-item .mcpi-run').click()`)
    await b.until(`document.querySelector('.mcpi-item').textContent.includes('wiped')`, 4000)
    assert.equal(await b.run(`document.querySelector('.mcpi-item .mcpi-run').textContent`), 'Run')
  })

  await t.test('a link to an address on this computer waits for a press before the page calls it', async () => {
    const target = mcp.base + '/held'
    await b.go(origin + '/lib.html?u=' + target)
    await b.run(HELPERS)
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: null, servers: [], holdPrivate: true }); true`)
    await b.until(`document.querySelector('.mcpi-hold')`, 4000)
    assert.match(await b.run(`document.querySelector('.mcpi-hold').textContent`), /It was not connected/)
    assert.equal(await b.run(`$t.status()`), 'Not connected')
    await b.run(`document.querySelector('.mcpi-hold button').click()`)
    await b.until(`$t.status() === 'Connected'`)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-hold')`), false)
    /* Now it is one of the person's own servers: the same link connects by itself. */
    await b.run(`inst.destroy(); true`)
    await b.run(`window.inst = MCPI.mount(document.querySelector('#x'), { registry: null, servers: [], holdPrivate: true }); true`)
    await b.until(`$t.status() === 'Connected'`)
    await b.run(`[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key.endsWith('/held')).querySelector('.mcpi-remove').click(); inst.destroy(); true`)
  })

  await t.test('every card has a link button that copies its link, and an AI button, and neither opens it', async () => {
    await open()
    const tool = (key: string, sel: string) => `[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key === ${JSON.stringify(key)}).querySelector('${sel}')`
    assert.equal(await b.run(tool('local', '.mcpi-card-share') + '.dataset.copy'), origin + '/?s=local')
    await b.run(tool('local', '.mcpi-card-share') + '.click()')
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true, 'copying the link does not open the server')
    assert.equal(await b.run(tool(mcp.base + '/from-registry', '.mcpi-card-share') + '.dataset.copy'), origin + '/?r=io.test/local', 'a registry server is linked by its name')

    /* A server you added yourself, with a header token: the link names the header, and nothing anywhere holds the token. */
    /* The token lives in this tab only, and an earlier step emptied the tab's storage: put in again, as its person would. */
    await b.run(`sessionStorage.setItem('mcpi:header-tokens', ${JSON.stringify(JSON.stringify({ [mcp.base + '/token']: { 'x-test-key': 'secret' } }))})`)
    await open()
    assert.equal(await b.run(tool(mcp.base + '/token', '.mcpi-card-share') + '.dataset.copy'), origin + '/?u=' + mcp.base + '/token&h=x-test-key')
    await b.run(tool(mcp.base + '/token', '.mcpi-card-ai') + '.click()')
    assert.equal(await b.run(`document.querySelector('dialog.mcpi-addto').open`), true)
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true, 'the AI button does not open the server either')
    await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === 'gemini').click()`)
    /* The inspector adds its own link: this server, tested here, then on to this client (&to=). The header name goes in, never the token. */
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-share.is-plug').dataset.copy`), origin + '/?u=' + mcp.base + '/token&h=x-test-key&to=gemini')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-share.is-flask').dataset.copy`), origin + '/?u=' + mcp.base + '/token&h=x-test-key')
    assert.match(await b.run(`document.querySelector('.mcpi-addto-share.is-plug').title`), /No token goes in it/)
    /* As you set it up here: your token is in, so the command works as it is. */
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-secret input').checked`), true)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail pre').textContent`), /--header "x-test-key: secret"$/)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-note').textContent`), /Your own token is in this/)
    /* Taken out, to pass it on: <token> where it goes, and a note to put yours in. */
    await b.run(`document.querySelector('.mcpi-addto-secret input').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail pre').textContent`), /--header "x-test-key: <token>"$/)
    assert.doesNotMatch(await b.run(`document.querySelector('dialog.mcpi-addto').textContent`), /secret/)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-note').textContent`), /Put yours where <token> is/)
    await b.run(`document.querySelector('dialog.mcpi-addto [aria-label=Close]').click()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
  })

  await t.test("pressing a card opens the inspector right under that card's row, in the registry list too", async () => {
    await open()
    /* Under the row: it shares the card's list, and the card before it sits on the pressed card's row. */
    const under = (card: string) => b.run(`(() => { const m = document.querySelector('.mcpi-main'); const w = ${card}.closest('.mcpi-card-wrap'); return !m.hidden && m.parentElement === w.parentElement && m.previousElementSibling.offsetTop === w.offsetTop })()`)
    await b.run(`document.querySelector('.mcpi-server[data-key=local]').click()`)
    assert.equal(await under(`document.querySelector('.mcpi-server[data-key=local]')`), true, 'under a card of your own')
    /* A registry search result: it goes into recently viewed, and the inspector opens under it there, not up in that list. */
    await b.run(`(() => { const i = document.querySelector('.mcpi-reg-bar input'); i.value = 'locked'; i.dispatchEvent(new Event('input')) })()`)
    await b.until(`document.querySelectorAll('.mcpi-reg').length === 2`, 4000)
    await b.run(`document.querySelectorAll('.mcpi-reg')[1].click()`)
    await b.until(`document.querySelector('.mcpi-id h2').textContent === 'Found B'`, 4000)
    assert.equal(await under(`document.querySelectorAll('.mcpi-reg')[1]`), true, 'under the registry card')
    assert.equal(await b.run(`!!document.querySelector('.mcpi-reg-list .mcpi-main')`), true)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-reg')[1].classList.contains('is-on') && !document.querySelectorAll('.mcpi-reg')[0].classList.contains('is-on')`), true, 'the card it opened under is marked')
    /* Searching again draws the list anew: the inspector goes back under the server's own card instead of vanishing. */
    await b.run(`(() => { const i = document.querySelector('.mcpi-reg-bar input'); i.value = 'other'; i.dispatchEvent(new Event('input')) })()`)
    await b.until(`!document.querySelector('.mcpi-reg-list .mcpi-main') && document.querySelectorAll('.mcpi-reg').length === 2`, 4000)
    assert.equal(await under(`[...document.querySelectorAll('.mcpi-server')].find((x) => x.dataset.key === 'https://b.example/mcp')`), true)
  })

  await t.test('the AI component on a page of its own: one click where the client allows, steps where it does not', async () => {
    await b.go(origin + '/add-to-ai.html')
    assert.equal(await b.run(`document.querySelector('#open button').textContent`), 'Add to an AI client')
    assert.equal(await b.run(`document.querySelector('#ko button').textContent`), 'AI 클라이언트에 추가', 'lang="ko"')
    await b.run(`document.querySelector('#open button').click()`)
    const pick = (id: string) => b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === '${id}').click()`)
    const detail = `document.querySelector('.mcpi-addto-detail')`
    assert.equal(await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].length`), 44)

    await pick('vscode')
    const href = await b.run(detail + `.querySelector('a.mcpi-addto-open').getAttribute('href')`)
    assert.deepEqual(JSON.parse(decodeURIComponent(href.replace('vscode:mcp/install?', ''))), { name: 'docs', type: 'http', url: 'https://docs.example/mcp' })
    await pick('cursor')
    assert.match(await b.run(detail + `.querySelector('a.mcpi-addto-open').href`), /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=docs&config=/)
    await pick('codex')
    assert.equal(await b.run(detail + `.querySelector('pre').textContent`), 'codex mcp add docs --url https://docs.example/mcp')
    await pick('windsurf')
    assert.match(await b.run(detail + `.textContent`), /mcp_config\.json/)
    await pick('claude')
    assert.equal(await b.run(detail + `.querySelectorAll('ol li').length`), 3, 'settings-only clients get steps')
    assert.equal(await b.run(detail + `.querySelector('pre').textContent`), 'https://docs.example/mcp')
    assert.equal(await b.run(`getComputedStyle(document.querySelector('dialog.mcpi-addto')).borderRadius`), '12px', 'it brings its own styles')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* The last choice is remembered, and a server that needs a token gets the note for clients that take none. */
    await b.run(`document.querySelector('#locked button').click()`)
    assert.equal(await b.run(detail + '.dataset.client'), 'claude', 'opens on the client picked last')
    assert.match(await b.run(detail + `.querySelector('.mcpi-addto-note').textContent`), /takes header tokens only in some organizations/)
    await pick('codex')
    assert.match(await b.run(detail + `.querySelector('pre').textContent`), /--bearer-token-env-var KEYED_TOKEN$/)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Given by registry name alone: the address, title and needed header come from the registry. */
    await b.until(`document.querySelector('#byname').dataset.state === 'ready'`)
    await b.run(`document.querySelector('#byname button').click()`)
    await b.until(`document.querySelector('dialog.mcpi-addto')`)
    assert.equal(await b.run(`document.querySelector('dialog.mcpi-addto h2').textContent`), 'Add Docs from the registry to an AI client')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-head code').textContent`), 'https://docs.example/mcp')
    await pick('claude-code')
    assert.equal(await b.run(detail + `.querySelector('pre').textContent`), 'claude mcp add --transport http docs https://docs.example/mcp --header "X-Docs-Key: <token>"', 'named after the registry entry, with its header')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
    /* What is given directly wins over the registry. */
    await b.until(`document.querySelector('#renamed').dataset.state === 'ready'`)
    await b.run(`document.querySelector('#renamed button').click()`)
    await b.until(`document.querySelector('dialog.mcpi-addto')`)
    assert.equal(await b.run(`document.querySelector('dialog.mcpi-addto h2').textContent`), 'Add My docs to an AI client')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
    /* A name the registry does not know says so, on a button that cannot be pressed. */
    await b.until(`document.querySelector('#missing').dataset.state === 'missing'`)
    assert.equal(await b.run(`document.querySelector('#missing button').disabled`), true)
    assert.equal(await b.run(`document.querySelector('#missing button').textContent`), 'Not in the MCP Registry')
    await b.until(`document.querySelector('#retired').dataset.state === 'missing'`)
    assert.equal(await b.run(`document.querySelector('#retired button').textContent`), 'Deprecated in the MCP Registry')
    /* And in JS, a registry name alone opens the popup once it is read. */
    await b.run(`MCPAddToAI.openAddToAi({ id: 'io.test/docs' }, { registryApi: '/registry/v0/servers' })`)
    await b.until(`document.querySelector('dialog.mcpi-addto')`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-head code').textContent`), 'https://docs.example/mcp')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Each client has its icon; one that cannot load shows a letter, and icons: false leaves them out. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { icons: { claude: '/no-such-icon.svg' } })`)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile .mcpi-addto-ico').length`), 44)
    assert.match(await b.run(`document.querySelector('[data-client=vscode] .mcpi-addto-ico').dataset.icon`), /^https:\/\/cdn\.jsdelivr\.net\//)
    assert.equal(await b.run(`document.querySelector('[data-client=cursor] .mcpi-addto-ico').classList.contains('is-mono')`), true, 'a mono icon follows the text color')
    await b.until(`document.querySelector('[data-client=claude] .mcpi-addto-ico').textContent === 'Cl'`)
    assert.equal(await b.run(`document.querySelector('[data-client=droid] .mcpi-addto-ico').textContent`), 'FD', 'no icon on the CDN: initials')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { icons: false })`)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-ico').length`), 0)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /*
     * A one-click client is added by the press on its tile: its link opens at once. With no such app here nothing opens,
     * which it says after a moment, opening the by-hand setup. Other tiles only show their way.
     */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false })`)
    await b.run(`window.went = []; document.querySelector('dialog.mcpi-addto').addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.mcpi-addto-open'); if (a) went.push(a.getAttribute('href').split(':')[0]) }, true); true`)
    await b.run(`document.querySelector('[data-client=codex]').click()`)
    assert.equal(await b.run(`went.length`), 0, 'a command tile starts nothing')
    assert.equal(await b.run(`document.querySelector('[data-client=vscode] span:last-child').textContent`), 'Press to add')
    await b.run(`document.querySelector('[data-client=vscode]').click()`)
    assert.deepEqual(await b.run(`went`), ['vscode'], 'the tile press opened the link')
    /* The same tile again tries the link again, and leaves what is under it as it is (nothing redrawn, nothing jumps). */
    await b.run(`document.querySelector('.mcpi-addto-detail').firstElementChild.dataset.mark = '1'; document.querySelector('[data-client=vscode]').click()`)
    assert.deepEqual(await b.run(`went`), ['vscode', 'vscode'])
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').firstElementChild.dataset.mark`), '1')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail .mcpi-addto-away').hidden`), true)
    await b.until(`!document.querySelector('.mcpi-addto-detail .mcpi-addto-away').hidden`, 6000)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-manual').open`), true)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-get').href`), /^https:\/\/code\.visualstudio\.com\//)
    /*
     * It says to open the app first and press Open again. There is no second add button: one row of buttons, each an icon and a word,
     * opens the link again, copies it to send, and goes to the client's website.
     */
    const away = `document.querySelector('.mcpi-addto-detail .mcpi-addto-away')`
    assert.match(await b.run(away + '.textContent'), /open it first, then press Try again/)
    assert.equal(await b.run(`[...document.querySelectorAll('.mcpi-addto-detail .mcpi-addto-acts > *')].map((x) => x.className.replace('mcpi-addto-go is-quiet ', '') + ':' + x.textContent + ':' + !!x.querySelector('svg')).join()`),
      'mcpi-addto-open:Try again:true,mcpi-addto-get:VS Code website:true,mcpi-addto-install:Install link:true')
    assert.match(await b.run(`document.querySelector('.mcpi-addto-install').dataset.copy`), /^vscode:mcp\/install\?/)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-detail a.mcpi-addto-go:not(.is-quiet)').length`), 0, 'no big add button')
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-share')`), false, 'on its own, the component has no link to this page: that comes from the page using it')
    await b.run(`document.querySelector('.mcpi-addto-open').click()`)
    assert.equal(await b.run(away + '.hidden'), true, 'Try again presses the link once more')
    await b.until(`!${away}.hidden`, 6000)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* A page gives its own link with shareLink, drawn as one more button under the client. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false, client: 'codex', shareLink: (c) => 'https://my.example/?u=x.example/mcp&to=' + c.id })`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-share').dataset.copy`), 'https://my.example/?u=x.example/mcp&to=codex')
    await b.run(`document.querySelector('[data-client=trae]').click()`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-share').dataset.copy + ' ' + !!document.querySelector('.mcpi-addto-install')`), 'https://my.example/?u=x.example/mcp&to=trae false', 'one link to pass on: the page link takes the install link\'s place')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Keys: the search box has focus, arrows move through the tiles and pick, and closing gives focus back to the opener. */
    await b.run(`(() => { const o = document.createElement('button'); o.id = 'opener'; o.textContent = 'open'; document.body.append(o); o.focus(); MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false, client: 'codex' }) })()`)
    assert.equal(await b.run(`document.activeElement.classList.contains('mcpi-addto-search')`), true)
    /* Closing is an × icon, named for screen readers, like the inspector's own. */
    assert.equal(await b.run(`(() => { const c = document.querySelector('.mcpi-addto-close'); return c.textContent === '' && !!c.querySelector('svg') && c.getAttribute('aria-label') })()`), 'Close')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile[tabindex="0"]').length`), 1, 'one tile in the Tab order: the picked one')
    const key = (k: string) => b.run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`)
    await b.run(`document.querySelector('.mcpi-addto-tile[data-client=codex]').focus()`)
    await key('ArrowRight')
    assert.equal(await b.run(`document.activeElement.dataset.client`), 'gemini')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'gemini', 'moving picks')
    await key('ArrowLeft'); await key('ArrowLeft')
    assert.equal(await b.run(`document.activeElement.dataset.client`), 'claude-code')
    await key('End')
    assert.equal(await b.run(`document.activeElement.dataset.client`), 'manus')
    await key('ArrowDown')
    assert.equal(await b.run(`document.activeElement.dataset.client`), 'vscode', 'it wraps around, to the one-click group that leads')
    /* The clients with a one-click link sit together at the top, and no other group repeats them. */
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-group').dataset.group`), 'link')
    assert.equal(await b.run(`[...document.querySelectorAll('.mcpi-addto-group[data-group=link] .mcpi-addto-tile')].map((x) => x.dataset.client).join()`), 'vscode,cursor,vscode-insiders,visual-studio,kiro,lmstudio,trae,replit,goose')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile[data-client=vscode]').length`), 1)
    /* What any client needs to connect by hand stays at the bottom, under the picked client's own way. */
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-any [data-copy]').dataset.copy`), 'https://x.example/mcp')
    assert.equal(await b.run(`!!(document.querySelector('.mcpi-addto-detail').compareDocumentPosition(document.querySelector('.mcpi-addto-any')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true)
    /* Where to get a client is a button to its website, not a sentence. */
    await b.run(`document.querySelector('.mcpi-addto-tile[data-client=gemini]').click()`)
    assert.equal(await b.run(`(() => { const a = document.querySelector('.mcpi-addto-detail a.mcpi-addto-get'); return a.classList.contains('mcpi-addto-go') && a.target === '_blank' && a.href })()`), 'https://github.com/google-gemini/gemini-cli')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-any [data-copy]').dataset.copy`), 'https://x.example/mcp', 'still there after picking another client')
    /* Where to check it is connected, and copying is an icon named for screen readers. */
    assert.match(await b.run(`document.querySelector('.mcpi-addto-check').textContent`), /To check it is connected: \/mcp/)
    assert.equal(await b.run(`(() => { const c = document.querySelector('.mcpi-addto-detail .mcpi-addto-copy'); return c.textContent === '' && !!c.querySelector('svg') && c.getAttribute('aria-label') + '|' + c.title })()`), 'Copy|Copy')
    /* The picked client's way opens right under the row its tile is in, inside that group; the by-hand box stays outside, at the bottom. */
    assert.equal(await b.run(`(() => { const p = document.querySelector('.mcpi-addto-detail'); const g = document.querySelector('[data-client=gemini]'); const prev = p.previousElementSibling; return p.parentElement === g.parentElement && prev.offsetTop === g.offsetTop })()`), true)
    await b.run(`document.querySelector('[data-client=lmstudio]').click()`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').closest('[data-group]').dataset.group`), 'link')
    assert.equal(await b.run(`!document.querySelector('.mcpi-addto-groups .mcpi-addto-any') && document.querySelector('dialog.mcpi-addto').lastElementChild.classList.contains('mcpi-addto-any')`), true)
    /* Searching narrows what the arrows walk through. */
    await b.run(`(() => { const i = document.querySelector('.mcpi-addto-search'); i.value = 'vs'; i.dispatchEvent(new Event('input')) })()`)
    await b.run(`document.querySelector('.mcpi-addto-tile[data-client=vscode]').focus()`)
    await key('ArrowRight')
    assert.equal(await b.run(`document.activeElement.dataset.client`), 'vscode-insiders')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
    assert.equal(await b.run(`document.activeElement.id`), 'opener')

    /* With your own token in, an app link carries it: the popup says not to pass that link on. Off, it says nothing. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp', headers: { Authorization: 'Bearer abc' } }, { mobile: false, client: 'lmstudio' })`)
    assert.match(await b.run(`document.querySelector('[data-warn=link-secret]').textContent`), /carries your token to LM Studio/)
    await b.run(`document.querySelector('.mcpi-addto-secret input').click()`)
    assert.equal(await b.run(`!!document.querySelector('[data-warn=link-secret]')`), false)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* On a phone: said at the top, Claude and ChatGPT first, the rest marked Computer only with their one click off. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: true })`)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-mobile')`), true)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].slice(0, 2).map((x) => x.dataset.client)`), ['claude', 'chatgpt'])
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-group').dataset.group`), 'app', 'chat apps come first')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile.is-away').length`), 34)
    assert.equal(await b.run(`document.querySelector('[data-client=cursor] span:last-child').textContent`), 'Computer only')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'claude', 'it opens on one that works here')
    await b.run(`document.querySelector('[data-client=cursor]').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail .mcpi-addto-away').textContent`), /runs on a computer/)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-detail .mcpi-addto-open, .mcpi-addto-detail .mcpi-addto-install')`), false, 'no one-click link on a phone')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-manual').open`), true, 'the setup is there to copy')
    assert.doesNotMatch(await b.run(`document.querySelector('.mcpi-addto-detail').textContent`), /null|undefined/)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Found on its own, from an iPhone's user agent. */
    const desktopUa = await b.run('navigator.userAgent')
    await b.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
    await b.go(origin + '/add-to-ai.html')
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' })`)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-mobile')`), true, 'an iPhone is detected')
    await b.send('Emulation.setUserAgentOverride', { userAgent: desktopUa })
    await b.go(origin + '/add-to-ai.html')
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' })`)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-mobile')`), false, 'a desktop is not')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Groups, and a search over them: by name or group, Enter picks the first, and no match says so. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false })`)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-addto-group')].map((g) => g.dataset.group)`), ['link', 'agent', 'editor', 'app'])
    const find = (text: string) => b.run(`(() => { const s = document.querySelector('.mcpi-addto-search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input')); return [...document.querySelectorAll('.mcpi-addto-tile')].filter((x) => !x.hidden).map((x) => x.dataset.client) })()`)
    assert.deepEqual(await find('zed'), ['zed'])
    assert.equal((await find('chat apps')).length, 10, 'a group name finds its clients')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-group:not([hidden])').length`), 2, 'empty groups hide (Replit, a chat app, sits with the one-click ones)')
    await find('kiro')
    await b.run(`document.querySelector('.mcpi-addto-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'kiro')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail a.mcpi-addto-open').target`), '_blank', 'a web install link opens in a new tab')
    assert.deepEqual(await find('nothing like this'), [])
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-groups + .mcpi-addto-hint').hidden`), false)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* The same through the script API, into any element. */
    await b.run(`document.querySelector('#host').append(MCPAddToAI.addToAiButton({ url: 'https://x.example/mcp', name: 'X' }, { label: 'Add X' }))`)
    await b.run(`document.querySelector('#host button').click()`)
    assert.equal(await b.run(`document.querySelector('dialog.mcpi-addto h2').textContent`), 'Add X to an AI client')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
  })

  await t.test('&to= hands a server on to an AI client only once it connects here', async () => {
    const popup = `document.querySelector('dialog.mcpi-addto')`
    /* It connects: the popup opens on that client, says the server answered, and the link leaves the address bar. */
    await open('?s=local&to=cursor')
    await b.until(`$t.status() === 'Connected'`)
    await b.until(popup)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'cursor')
    assert.match(await b.run(`document.querySelector('.mcpi-addto-ok').textContent`), /answers here/)
    assert.doesNotMatch(await b.run('location.search'), /to=/)
    /* Its one-click link was tried at once; with no Cursor here, nothing opens and the popup says so. */
    await b.until(`!document.querySelector('.mcpi-addto-detail .mcpi-addto-away').hidden`, 6000)
    await b.run(popup + '.close()')
    await b.until('!' + popup, 2000)

    /* It does not connect (it needs a token not given): nothing is handed on. */
    await b.run('sessionStorage.clear()')
    await open('?u=' + mcp.base + '/locked&to=vscode')
    await b.until(`$t.status() === 'Sign-in needed'`)
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(await b.run(popup), null, 'no popup for a server that did not answer')

    /* OAuth: the sign-in leaves the page and comes back; once connected, the server goes on to the client the link named. */
    await open('?u=' + mcp.base + '/oauth-mcp&oauth&to=claude-code')
    await b.until(`$t.status() === 'Sign-in needed'`)
    await b.run(`$t.button('Connect with OAuth (PKCE)').click()`)
    await b.until(`document.querySelector('.mcpi-status')?.textContent === 'Connected' && document.querySelector('dialog.mcpi-addto')`, 20000)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'claude-code')
    await b.run(popup + '.close()')
    await b.until('!' + popup, 2000)
  })

  await t.test('with no network for icons, cards and the popup show initials on a color of their own', async () => {
    /* The local servers have no https icon at all: their cards already make one from the name. */
    await open()
    const card = `[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key === 'local').querySelector('.mcpi-ico')`
    await b.until(card + `.classList.contains('is-none')`)
    assert.equal(await b.run(card + '.textContent'), 'LT', 'Local test server')
    assert.match(await b.run(card + '.style.background'), /^rgb\(/, 'a color made from the name')

    /* Every CDN icon blocked, as when offline: all 35 clients still get an icon, made from their names. */
    await b.send('Network.enable')
    await b.send('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net*'] })
    try {
      await b.go(origin + '/add-to-ai.html')
      await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false })`)
      await b.until(`[...document.querySelectorAll('.mcpi-addto-tile .mcpi-addto-ico')].every((x) => x.classList.contains('is-letter'))`, 10000)
      assert.equal(await b.run(`document.querySelector('[data-client=vscode] .mcpi-addto-ico').textContent`), 'VC')
      assert.equal(await b.run(`document.querySelector('[data-client=cursor] .mcpi-addto-ico').textContent`), 'Cu', 'a mono icon falls back too')
      await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    } finally {
      await b.send('Network.setBlockedURLs', { urls: [] })
    }
  })

  await t.test('no uncaught errors in the page', () => {
    assert.deepEqual(b.errors, [])
  })
})
