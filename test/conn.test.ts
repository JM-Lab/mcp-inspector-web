/*
 * Conn against a local MCP server (test/support/mcp-server.ts): no outside network.
 * The scenario against a public server is scenario.test.ts.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Conn, CLIENT_INFO } from '../src/conn.js'
import { startMcpServer } from './support/mcp-server.ts'

let base = ''
let oauth = { challenge: '', redirect: '', registered: 0, tokenCalls: 0 }
let stop = () => {}

/** An OAuth provider standing in for browser storage. Instead of navigating to the authorization URL it records it. */
function memoryProvider(redirectUrl: string) {
  const mem: Record<string, unknown> = {}
  return {
    went: '',
    get redirectUrl() { return redirectUrl },
    get clientMetadata() { return { client_name: 'test', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' } },
    clientInformation: () => mem.client, saveClientInformation: (v: unknown) => { mem.client = v },
    tokens: () => mem.tokens, saveTokens: (v: unknown) => { mem.tokens = v },
    saveCodeVerifier: (v: unknown) => { mem.verifier = v }, codeVerifier: () => (mem.verifier as string) || '',
    redirectToAuthorization(url: URL) { this.went = String(url) },
    mem,
  }
}

before(async () => {
  const s = await startMcpServer()
  base = s.base
  oauth = s.oauth
  stop = s.close
})
after(() => stop())

test('Conn: connecting gets instructions and lists, and every message lands in History', async () => {
  let logs = 0
  const c = new Conn({ key: 'k', name: 'local', url: base + '/mcp' }, { onLog: () => { logs++ } })
  assert.equal(c.state, 'idle')
  const live = await c.connect()
  assert.equal(c.state, 'connected')
  assert.equal(live.info.serverInfo.name, 'mcpi-test')
  assert.equal(live.info.instructions, 'test instructions')
  assert.ok(live.info.protocolVersion)
  assert.deepEqual(live.tools.map((t: { name: string }) => t.name).sort(), ['add_tool', 'ask_name', 'echo', 'slow'])
  assert.deepEqual(live.prompts.map((p: { name: string }) => p.name), ['greet'])
  assert.deepEqual(live.resources.map((r: { uri: string }) => r.uri), ['test://clock'])
  const init = c.log.find((e: { method: string }) => e.method === 'initialize')
  assert.ok(init && init.response && init.ms != null, 'initialize request and response share one entry')
  assert.ok(c.log.some((e: { method: string }) => e.method === 'tools/list'))
  assert.ok(logs > 0)
  c.close()
  assert.equal(c.state, 'idle')
})

test('Conn: sends tools, prompts, resources, completion, ping and log level', async () => {
  const c = new Conn({ key: 'k', name: 'local', url: base + '/mcp' })
  await c.connect()
  assert.equal((await c.send('tools/call', { name: 'echo', arguments: { text: 'hello' } })).content[0].text, 'hello')
  assert.equal(typeof c.lastMs, 'number')
  assert.match((await c.send('prompts/get', { name: 'greet', arguments: { lang: 'korean' } })).messages[0].content.text, /korean/)
  assert.equal((await c.send('resources/read', { uri: 'test://clock' })).contents[0].text, 'tick')
  const done = await c.send('completion/complete', { ref: { type: 'ref/prompt', name: 'greet' }, argument: { name: 'lang', value: 'ko' } })
  assert.deepEqual(done.completion.values, ['korean'])
  await c.send('ping')
  await c.send('logging/setLevel', { level: 'info' })
  c.close()
})

test('Conn: receives progress and can cancel a request', async () => {
  const c = new Conn({ key: 'k', name: 'local', url: base + '/mcp' })
  await c.connect()
  const seen: number[] = []
  const r = await c.send('tools/call', { name: 'slow', arguments: { steps: 3 } }, { onprogress: (p: { progress: number }) => seen.push(p.progress) })
  assert.equal(r.content[0].text, 'done')
  assert.deepEqual(seen, [1, 2, 3])
  const ac = new AbortController()
  const pending = c.send('tools/call', { name: 'slow', arguments: { steps: 50 } }, { signal: ac.signal })
  setTimeout(() => ac.abort(), 60)
  await assert.rejects(pending)
  assert.ok(c.log.some((e: { method: string }) => e.method === 'notifications/cancelled'), 'the cancel notification goes to the server')
  c.close()
})

test('Conn: when the server asks for input, the hooks.onElicit answer goes back', async () => {
  let asked: { message?: string } = {}
  const c = new Conn({ key: 'k', name: 'local', url: base + '/mcp' }, { onElicit: async (_c: unknown, params: { message?: string }) => { asked = params; return { action: 'accept', content: { name: 'Ada' } } } })
  await c.connect()
  const r = await c.send('tools/call', { name: 'ask_name', arguments: {} })
  assert.equal(asked.message, 'What is your name?')
  assert.deepEqual(JSON.parse(r.content[0].text), { action: 'accept', content: { name: 'Ada' } })
  c.close()
})

test('Conn: a list_changed notification calls hooks.onListsChanged and the new list is fetched', async () => {
  let changed = 0
  const c = new Conn({ key: 'k', name: 'local', url: base + '/mcp' }, { onListsChanged: () => { changed++ } })
  await c.connect()
  await c.send('tools/call', { name: 'add_tool', arguments: {} })
  for (let i = 0; i < 40 && !changed; i++) await new Promise((r) => setTimeout(r, 25))
  assert.ok(changed > 0)
  assert.ok((await c.lists()).tools.some((t: { name: string }) => t.name === 'added'))
  c.close()
})

test('Conn: a server that needs auth sets needAuth, and connects with a header token', async () => {
  const locked = new Conn({ key: 'k', name: 'locked', url: base + '/locked' }, { explain: () => 'This server needs authentication.' })
  await assert.rejects(locked.connect())
  assert.equal(locked.state, 'failed')
  assert.equal(locked.needAuth, true)
  assert.equal(locked.error, 'This server needs authentication.')

  const noKey = new Conn({ key: 'k', name: 'token', url: base + '/token' })
  await assert.rejects(noKey.connect())
  assert.equal(noKey.needAuth, true)
  const withKey = new Conn({ key: 'k', name: 'token', url: base + '/token', headers: { 'X-Test-Key': 'secret' } })
  const live = await withKey.connect()
  assert.equal(live.info.serverInfo.name, 'mcpi-test')
  withKey.close()
})

test('Conn: an unreachable address fails and is not read as needing auth', async () => {
  const c = new Conn({ key: 'k', name: 'dead', url: 'http://127.0.0.1:9/mcp' })
  await assert.rejects(c.connect())
  assert.equal(c.state, 'failed')
  assert.equal(c.needAuth, false)
})

test('Conn: OAuth with PKCE end to end: 401, authorization redirect, code for token, connect', async () => {
  const provider = memoryProvider('https://inspector.example/')
  const server = { key: 'k', name: 'oauth', url: base + '/oauth-mcp' }
  const hooks = { authProvider: () => provider, hasTokens: () => !!provider.mem.tokens }

  /* 1. Without a token the server asks for authentication. */
  const first = new Conn(server, { hasTokens: () => false })
  await assert.rejects(first.connect())
  assert.equal(first.needAuth, true)

  /* 2. The OAuth button: discover metadata, register a client, redirect with a PKCE challenge. */
  const second = new Conn(server, hooks)
  await assert.rejects(second.connect({ oauth: true }))
  const went = new URL(provider.went)
  assert.equal(went.origin + went.pathname, base + '/oauth-as/authorize')
  assert.equal(went.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(went.searchParams.get('code_challenge'))
  assert.equal(went.searchParams.get('redirect_uri'), 'https://inspector.example/')
  assert.equal(went.searchParams.get('client_id'), 'client-1')
  assert.equal(oauth.registered, 1)
  assert.ok(provider.mem.verifier, 'the verifier is saved')

  /* 3. The person approves and the authorization server sends a code back to the page. */
  const back = await fetch(provider.went, { redirect: 'manual' })
  const callback = new URL(back.headers.get('location')!).searchParams
  assert.equal(callback.get('code'), 'code-1')

  /* 4. Back on the page: exchange the code for a token and connect. */
  const third = new Conn(server, hooks)
  const live = await third.connect({ oauth: true, callback })
  assert.equal(third.state, 'connected')
  assert.equal(live.info.serverInfo.name, 'mcpi-test')
  assert.equal((provider.mem.tokens as { access_token: string }).access_token, 'good-token')
  assert.equal(oauth.tokenCalls, 1)
  third.close()

  /* 5. With a token, Reconnect does not go through OAuth again. */
  const fourth = new Conn(server, hooks)
  await fourth.connect()
  assert.equal(fourth.state, 'connected')
  assert.equal(oauth.tokenCalls, 1)
  fourth.close()
})

test('Conn: a server with no dynamic client registration says so in the error', async () => {
  const provider = memoryProvider('https://inspector.example/')
  const c = new Conn({ key: 'k', name: 'nodcr', url: base + '/nodcr-mcp' }, { authProvider: () => provider, explain: (e: Error) => e.message })
  await assert.rejects(c.connect({ oauth: true }))
  assert.match(c.error, /dynamic client registration/i)
  assert.equal(provider.went, '', 'no authorization redirect')
})

test('Conn: initialize carries clientInfo from the hooks, or the default', async () => {
  const mine = new Conn({ key: 'k', name: 'local', url: base + '/mcp' }, { clientInfo: { name: 'my-site', version: '9.9.9' } })
  await mine.connect()
  assert.deepEqual(mine.log.find((e: { method: string }) => e.method === 'initialize').request.params.clientInfo, { name: 'my-site', version: '9.9.9' })
  mine.close()
  const plain = new Conn({ key: 'k', name: 'local', url: base + '/mcp' })
  await plain.connect()
  assert.equal(plain.log.find((e: { method: string }) => e.method === 'initialize').request.params.clientInfo.name, CLIENT_INFO.name)
  plain.close()
})

test('an unknown method is refused, not sent as a ping', async () => {
  const c = new Conn({ key: 'k', name: 'local', url: 'http://localhost:1/mcp' }, {})
  c.client = {} as never
  await assert.rejects(c.send('tools/lsit', {}), /Unknown method: tools\/lsit/)
})
