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
  /* The add-to-AI-client component alone, on a page with nothing else (no stylesheet either). */
  const addTo = (await build({ entryPoints: ['src/add-to-ai-auto.js'], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })).outputFiles[0].text
  const addToPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>component</title>
<mcp-add-to-ai id="open" url="https://docs.example/mcp" name="Docs" registry="io.example/docs"></mcp-add-to-ai>
<mcp-add-to-ai id="locked" url="https://k.example/mcp" name="Keyed" header="Authorization"></mcp-add-to-ai>
<mcp-add-to-ai id="ko" url="https://docs.example/mcp" lang="ko"></mcp-add-to-ai>
<mcp-add-to-ai id="byname" registry="io.test/docs" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<mcp-add-to-ai id="renamed" registry="io.test/docs" name="My docs" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<mcp-add-to-ai id="missing" registry="io.test/nothing" registry-api="/registry/v0/servers"></mcp-add-to-ai>
<div id="host"></div><script src="/mcp-add-to-ai.js"></script>`
  /* A stand-in for the MCP Registry: one server by name, and an empty list for the panel. */
  const entry = { server: { name: 'io.test/local', title: 'Registry test server', description: 'from the registry', remotes: [{ type: 'streamable-http', url: mcp.base + '/from-registry' }] } }
  const locked = { server: { name: 'io.test/locked', title: 'Locked', remotes: [{ type: 'streamable-http', url: mcp.base + '/token-registry', headers: [{ name: 'x-test-key', value: '\${KEY}', isRequired: true, isSecret: true }] }] } }
  /* For the AI component: an entry with an https remote (what it accepts) and the header it needs. */
  const docs = { server: { name: 'io.test/docs', title: 'Docs from the registry', remotes: [{ type: 'streamable-http', url: 'https://docs.example/mcp', headers: [{ name: 'X-Docs-Key', isSecret: true }] }] } }
  const registry = { 'io.test/local': entry, 'io.test/locked': locked, 'io.test/docs': docs }
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

  await t.test('a registry link opens that server, and the share box offers the same link and the AI button', async () => {
    await open('?r=io.test/local')
    await b.until(`$t.status() === 'Connected'`)
    assert.equal(await b.run(`document.querySelector('.mcpi-id h2').textContent`), 'Registry test server')
    assert.equal(await b.run('location.search'), '?r=io.test/local')
    assert.equal(await b.run(`document.querySelector('.mcpi-share-link').value`), origin + '/?r=io.test/local')
    await b.run(`document.querySelector('.mcpi-share .mcpi-add-ai').click()`)
    await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === 'claude-code').click()`)
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

  await t.test('every card has a link button that copies its link, and an AI button, and neither opens it', async () => {
    await open()
    const tool = (key: string, sel: string) => `[...document.querySelectorAll('.mcpi-card-wrap')].find((w) => w.querySelector('.mcpi-server')?.dataset.key === ${JSON.stringify(key)}).querySelector('${sel}')`
    assert.equal(await b.run(tool('local', '.mcpi-card-share') + '.dataset.copy'), origin + '/?s=local')
    await b.run(tool('local', '.mcpi-card-share') + '.click()')
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true, 'copying the link does not open the server')
    assert.equal(await b.run(tool(mcp.base + '/from-registry', '.mcpi-card-share') + '.dataset.copy'), origin + '/?r=io.test/local', 'a registry server is linked by its name')

    /* A server you added yourself, with a header token: the link names the header, and nothing anywhere holds the token. */
    assert.equal(await b.run(tool(mcp.base + '/token', '.mcpi-card-share') + '.dataset.copy'), origin + '/?u=' + mcp.base + '/token&h=x-test-key')
    await b.run(tool(mcp.base + '/token', '.mcpi-card-ai') + '.click()')
    assert.equal(await b.run(`document.querySelector('dialog.mcpi-addto').open`), true)
    assert.equal(await b.run(`document.querySelector('.mcpi-main').hidden`), true, 'the AI button does not open the server either')
    await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === 'gemini').click()`)
    /* As you set it up here: your token is in, so the command works as it is. */
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-secret input').checked`), true)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail pre').textContent`), /--header "x-test-key: secret"$/)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-note').textContent`), /Your own token is in this/)
    /* Taken out, to pass it on: <token> where it goes, and a note to put yours in. */
    await b.run(`document.querySelector('.mcpi-addto-secret input').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail pre').textContent`), /--header "x-test-key: <token>"$/)
    assert.doesNotMatch(await b.run(`document.querySelector('dialog.mcpi-addto').textContent`), /secret/)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-note').textContent`), /Put yours where <token> is/)
    await b.run(`$t.button('Close', document.querySelector('dialog.mcpi-addto')).click()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)
  })

  await t.test('the AI component on a page of its own: one click where the client allows, steps where it does not', async () => {
    await b.go(origin + '/add-to-ai.html')
    assert.equal(await b.run(`document.querySelector('#open button').textContent`), 'Add to an AI client')
    assert.equal(await b.run(`document.querySelector('#ko button').textContent`), 'AI 클라이언트에 추가', 'lang="ko"')
    await b.run(`document.querySelector('#open button').click()`)
    const pick = (id: string) => b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].find((x) => x.dataset.client === '${id}').click()`)
    const detail = `document.querySelector('.mcpi-addto-detail')`
    assert.equal(await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].length`), 35)

    await pick('vscode')
    const href = await b.run(detail + `.querySelector('a.mcpi-addto-go').getAttribute('href')`)
    assert.deepEqual(JSON.parse(decodeURIComponent(href.replace('vscode:mcp/install?', ''))), { name: 'docs', type: 'http', url: 'https://docs.example/mcp' })
    await pick('cursor')
    assert.match(await b.run(detail + `.querySelector('a.mcpi-addto-go').href`), /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=docs&config=/)
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
    /* And in JS, a registry name alone opens the popup once it is read. */
    await b.run(`MCPAddToAI.openAddToAi({ id: 'io.test/docs' }, { registryApi: '/registry/v0/servers' })`)
    await b.until(`document.querySelector('dialog.mcpi-addto')`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-head code').textContent`), 'https://docs.example/mcp')
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* Each client has its icon; one that cannot load shows a letter, and icons: false leaves them out. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { icons: { claude: '/no-such-icon.svg' } })`)
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile .mcpi-addto-ico').length`), 35)
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

    /* An install link that opens nothing (no such app here) says so after a moment, and opens the by-hand setup. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: false })`)
    await b.run(`document.querySelector('[data-client=vscode]').click()`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail .mcpi-addto-away').hidden`), true)
    await b.run(`document.querySelector('.mcpi-addto-detail a.mcpi-addto-go').click()`)
    await b.until(`!document.querySelector('.mcpi-addto-detail .mcpi-addto-away').hidden`, 6000)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-manual').open`), true)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-get').href`), /^https:\/\/code\.visualstudio\.com\//)
    await b.run(`document.querySelector('dialog.mcpi-addto').close()`)
    await b.until(`!document.querySelector('dialog.mcpi-addto')`, 2000)

    /* On a phone: said at the top, Claude and ChatGPT first, the rest marked Computer only with their one click off. */
    await b.run(`MCPAddToAI.openAddToAi({ url: 'https://x.example/mcp' }, { mobile: true })`)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-mobile')`), true)
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-addto-tile')].slice(0, 2).map((x) => x.dataset.client)`), ['claude', 'chatgpt'])
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-group').dataset.group`), 'app', 'chat apps come first')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-tile.is-away').length`), 28)
    assert.equal(await b.run(`document.querySelector('[data-client=cursor] span:last-child').textContent`), 'Computer only')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'claude', 'it opens on one that works here')
    await b.run(`document.querySelector('[data-client=cursor]').click()`)
    assert.match(await b.run(`document.querySelector('.mcpi-addto-detail .mcpi-addto-away').textContent`), /runs on a computer/)
    assert.equal(await b.run(`!!document.querySelector('.mcpi-addto-detail a.mcpi-addto-go')`), false, 'no one-click link on a phone')
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
    assert.deepEqual(await b.run(`[...document.querySelectorAll('.mcpi-addto-group')].map((g) => g.dataset.group)`), ['agent', 'editor', 'app'])
    const find = (text: string) => b.run(`(() => { const s = document.querySelector('.mcpi-addto-search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input')); return [...document.querySelectorAll('.mcpi-addto-tile')].filter((x) => !x.hidden).map((x) => x.dataset.client) })()`)
    assert.deepEqual(await find('zed'), ['zed'])
    assert.equal((await find('chat apps')).length, 7, 'a group name finds its clients')
    assert.equal(await b.run(`document.querySelectorAll('.mcpi-addto-group:not([hidden])').length`), 1, 'empty groups hide')
    await find('kiro')
    await b.run(`document.querySelector('.mcpi-addto-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`)
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail').dataset.client`), 'kiro')
    assert.equal(await b.run(`document.querySelector('.mcpi-addto-detail a.mcpi-addto-go').target`), '_blank', 'a web install link opens in a new tab')
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

  await t.test('no uncaught errors in the page', () => {
    assert.deepEqual(b.errors, [])
  })
})
