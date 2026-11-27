/*
 * The command line side: bin/mcp-inspector-web.js (npx mcp-inspector-web) and scripts/featured.js.
 * Both run against servers on 127.0.0.1 only; nothing here reaches the internet.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { FEATURED, lookup, opens } from '../scripts/featured.js'

const bin = new URL('../bin/mcp-inspector-web.js', import.meta.url).pathname
const built = existsSync(new URL('../dist/mcp-inspector.js', import.meta.url))

/* Starts the CLI and waits for the address it prints. */
function startCli(args) {
  const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/localhost:(\d+)/); if (m) resolve({ child, base: m[0] }) })
    child.on('exit', (code) => reject(new Error('exited ' + code + ': ' + out)))
    setTimeout(() => reject(new Error('no address printed: ' + out)), 10000)
  })
}

test('cli: --help says how to use it', async () => {
  const child = spawn(process.execPath, [bin, '--help'])
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  const code = await new Promise((r) => child.on('exit', r))
  assert.equal(code, 0)
  assert.match(out, /Usage: mcp-inspector-web \[--port <n>\] \[--no-open\]/)
})

test('cli: serves the page and the built files on localhost, nothing else', { skip: !built && 'run npm run build first' }, async () => {
  const { child, base } = await startCli(['--no-open', '--port', '0'])
  try {
    const page = await fetch(base + '/')
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<div id="mcpi">/)
    assert.match(html, /<script src="mcp-inspector\.js" defer>/)
    const js = await fetch(base + '/mcp-inspector.js')
    assert.equal(js.status, 200)
    assert.match(js.headers.get('content-type'), /javascript/)
    assert.equal((await fetch(base + '/mcp-inspector.css')).status, 200)
    for (const path of ['/package.json', '/../package.json', '/src/app.js', '/bin/mcp-inspector-web.js']) {
      assert.equal((await fetch(base + path)).status, 404, path + ' is not served')
    }
  } finally { child.kill() }
})

test('featured: every entry is a registry name, listed once', () => {
  const names = FEATURED.map((x) => x[0])
  assert.equal(new Set(names).size, names.length)
  for (const [name, title, want, icon] of FEATURED) {
    assert.match(name, /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/, name)
    assert.ok(title, name + ' has a display name')
    if (want) assert.match(want, /^https:\/\//, name + ' remote')
    if (icon) assert.match(icon, /^https:\/\//, name + ' icon')
  }
})

test('featured: lookup keeps the active entry of that exact name; opens checks a no-auth initialize from a browser origin', async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/v0/servers')) {
      res.setHeader('content-type', 'application/json')
      const entry = (name, status) => ({ server: { name, remotes: [] }, _meta: { 'io.modelcontextprotocol.registry/official': { status } } })
      return res.end(JSON.stringify({ servers: [entry('a/x-old', 'active'), entry('a/x', 'deprecated'), entry('a/x', 'active'), entry('a/gone', 'deleted')] }))
    }
    const origin = req.headers.origin
    if (req.url === '/open') {
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 't' } } }))
    }
    if (req.url === '/other-origin') { res.setHeader('access-control-allow-origin', 'https://elsewhere.example'); return res.end('{"result":{"serverInfo":{}}}') }
    res.statusCode = req.url === '/locked' ? 401 : 404
    res.setHeader('access-control-allow-origin', origin || '*')
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const hit = await lookup('a/x', base + '/v0/servers')
    assert.equal(hit.name, 'a/x')
    assert.equal(await lookup('a/gone', base + '/v0/servers'), null, 'a deleted entry is left out')
    assert.equal(await lookup('a/none', base + '/v0/servers'), null)
    assert.equal(await opens(base + '/open', 'https://example.com'), true)
    assert.equal(await opens(base + '/locked', 'https://example.com'), false)
    assert.equal(await opens(base + '/other-origin', 'https://example.com'), false, 'CORS must allow this origin')
    assert.equal(await opens('http://127.0.0.1:1/none', 'https://example.com'), false, 'no server is not an error')
  } finally { server.close() }
})

test('dist holds only what the build writes', async () => {
  const { readdirSync } = await import('node:fs')
  assert.deepEqual(readdirSync(new URL('../dist/', import.meta.url)).sort(), ['THIRD-PARTY-LICENSES.txt', 'mcp-add-to-ai.js', 'mcp-inspector.css', 'mcp-inspector.js'])
})

test('every bundle starts with the MIT notice, since a bundle is often copied on its own', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['dist/mcp-inspector.js', 'dist/mcp-add-to-ai.js', 'dist/mcp-inspector.css']) {
    const head = readFileSync(new URL('../' + f, import.meta.url), 'utf8').slice(0, 300)
    assert.match(head, /^\/\*! mcp-inspector-web \d+\.\d+\.\d+ \| MIT License \| Copyright \(c\) 2026 Jemin Huh/, f)
  }
})
