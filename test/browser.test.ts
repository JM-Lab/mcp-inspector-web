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
  /* A stand-in for the MCP Registry: one server by name, and an empty list for the panel. */
  const entry = { server: { name: 'io.test/local', title: 'Registry test server', description: 'from the registry', remotes: [{ type: 'streamable-http', url: mcp.base + '/from-registry' }] } }
  const locked = { server: { name: 'io.test/locked', title: 'Locked', remotes: [{ type: 'streamable-http', url: mcp.base + '/token-registry', headers: [{ name: 'x-test-key', value: '\${KEY}', isRequired: true, isSecret: true }] }] } }
  const registry = { 'io.test/local': entry, 'io.test/locked': locked }
  const options = { lang: 'en', registry: '/registry/v0/servers', servers: [{ key: 'local', name: 'Local test server', url: mcp.base + '/mcp' }] }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>test</title><link rel="stylesheet" href="/mcp-inspector.css">
<div id="mcpi"></div><script>window.MCP_INSPECTOR = ${JSON.stringify(options)}</script><script src="/mcp-inspector.js"></script>`
  page = http.createServer((req, res) => {
    const path = new URL(req.url!, 'http://x').pathname
    if (path === '/mcp-inspector.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(js); return }
    if (path.startsWith('/registry/')) {
      const name = decodeURIComponent(path.replace('/registry/v0/servers/', '').replace('/versions/latest', ''))
      const body = path === '/registry/v0/servers' ? { servers: [], metadata: {} } : registry[name as keyof typeof registry]
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body || { error: 'not found' })); return
    }
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
    assert.deepEqual(await b.run(`[$t.count('Tools'), $t.count('Prompts'), $t.count('Resources')]`), [4, 1, 1])
    assert.match(await b.run(`document.querySelector('.mcpi-info').textContent`), /mcpi-test 0\.0\.1/)
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

  await t.test('History holds every message with its answer', async () => {
    await b.run(`$t.tab('History').click()`)
    const rows = await b.run(`[...document.querySelectorAll('.mcpi-history summary code')].map((c) => c.textContent)`)
    for (const m of ['initialize', 'tools/list', 'tools/call', 'prompts/get', 'completion/complete', 'resources/read', 'notifications/cancelled']) assert.ok(rows.includes(m), m + ' is in History')
  })

  await t.test('Ping answers with a time', async () => {
    await b.run(`$t.button('Ping').click()`)
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
    assert.equal(await b.run(`$t.count('Tools')`), 4)
    assert.equal(await b.run(`Object.keys(sessionStorage).some((k) => k.startsWith('mcpi:tokens:'))`), true, 'tokens are in sessionStorage')
    assert.equal(await b.run(`localStorage.getItem('mcpi:oauth')`), null, 'the pending sign-in was used up')
  })

  await t.test('a registry link opens that server, and the share box offers the same link', async () => {
    await open('?r=io.test/local')
    await b.until(`$t.status() === 'Connected'`)
    assert.equal(await b.run(`document.querySelector('.mcpi-id h2').textContent`), 'Registry test server')
    assert.equal(await b.run('location.search'), '?r=io.test/local')
    assert.equal(await b.run(`document.querySelector('.mcpi-share-link').value`), origin + '/?r=io.test/local')
    const clients = await b.run(`[...document.querySelectorAll('.mcpi-install')].map((x) => x.dataset.client)`)
    assert.deepEqual(clients, ['claude-code', 'vscode', 'cursor', 'claude'])
    assert.equal(await b.run(`document.querySelector('[data-client=claude-code] pre').textContent`), 'claude mcp add --transport http local ' + mcp.base + '/from-registry')
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

  await t.test('&oauth shows the sign-in button and waits for a press', async () => {
    const calls = mcp.oauth.tokenCalls
    await b.run('sessionStorage.clear()')
    await open('?u=' + mcp.base + '/oauth-mcp&oauth')
    await b.until(`$t.status() === 'Failed'`)
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

  await t.test('every card has a button that copies the link opening that server, without opening it', async () => {
    await open()
    const share = `document.querySelector('.mcpi-server[data-key=local]').parentNode.querySelector('.mcpi-card-share')`
    assert.equal(await b.run(share + '.dataset.copy'), origin + '/?s=local')
    await b.run(share + '.click()')
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true, 'pressing it does not open the server')
    const kept = await b.run(`[...document.querySelectorAll('.mcpi-servers .mcpi-card-share')].map((x) => x.dataset.copy)`)
    assert.ok(kept.includes(origin + '/?r=io.test/local'), 'a server from the registry is linked by its name')
  })

  await t.test('no uncaught errors in the page', () => {
    assert.deepEqual(b.errors, [])
  })
})
