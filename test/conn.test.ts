/*
 * Conn against local servers started here with the official server SDK: no outside network.
 * The scenario against a public server is scenario.test.ts.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { McpServer, WebStandardStreamableHTTPServerTransport, completable } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'
import { Conn, CLIENT_INFO } from '../src/conn.js'


let server: http.Server
let base = ''
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

function makeServer() {
  const s = new McpServer({ name: 'mcpi-test', version: '0.0.1' }, { capabilities: { logging: {}, tools: { listChanged: true } }, instructions: 'test instructions' })
  s.registerTool('echo', { description: 'echo', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: 'text', text }] }))
  s.registerTool('ask_name', { description: 'elicitation', inputSchema: z.object({}) }, async (_a, ctx) => {
    const r = await ctx.mcpReq.elicitInput({ message: 'What is your name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } })
    return { content: [{ type: 'text', text: JSON.stringify(r) }] }
  })
  s.registerTool('slow', { description: 'progress', inputSchema: z.object({ steps: z.number().default(3) }) }, async ({ steps }, ctx) => {
    const token = ctx.mcpReq._meta?.progressToken
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 40))
      if (token != null) await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: i, total: steps } })
    }
    return { content: [{ type: 'text', text: 'done' }] }
  })
  s.registerTool('add_tool', { description: 'list_changed', inputSchema: z.object({}) }, async () => {
    s.registerTool('added', { description: 'new', inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'hi' }] }))
    return { content: [{ type: 'text', text: 'added' }] }
  })
  s.registerPrompt('greet', { description: 'completion', argsSchema: z.object({ lang: completable(z.string(), (v) => ['korean', 'english'].filter((x) => x.startsWith(v))) }) }, ({ lang }) => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hello in ' + lang } }] }))
  s.registerResource('clock', 'test://clock', { description: 'read' }, async (uri) => ({ contents: [{ uri: uri.href, text: 'tick' }] }))
  return s
}

/*
 * A small authorization server (metadata, dynamic registration, authorize, token; PKCE S256 is really checked).
 * `/oauth-mcp` answers 401 with the protected resource metadata address when there is no token. `/nodcr-mcp` has no dynamic registration.
 */
const oauth = { challenge: '', redirect: '', registered: 0, tokenCalls: 0 }
async function oauthRoutes(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, base)
  const json = (code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
  const body = async () => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks).toString() }
  const which = url.pathname.includes('nodcr') ? 'nodcr' : 'oauth'
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) { json(200, { resource: base + '/' + which + '-mcp', authorization_servers: [base + '/' + which + '-as'] }); return true }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.endsWith('/.well-known/openid-configuration') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    const as = base + '/' + which + '-as'
    json(200, { issuer: as, authorization_endpoint: as + '/authorize', token_endpoint: as + '/token', ...(which === 'oauth' ? { registration_endpoint: as + '/register' } : {}), response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] })
    return true
  }
  if (url.pathname === '/oauth-as/register') { oauth.registered++; json(201, { ...JSON.parse(await body()), client_id: 'client-1' }); return true }
  if (url.pathname === '/oauth-as/authorize') {
    oauth.challenge = url.searchParams.get('code_challenge') || ''
    oauth.redirect = url.searchParams.get('redirect_uri') || ''
    const back = new URL(oauth.redirect)
    back.searchParams.set('code', 'code-1')
    if (url.searchParams.get('state')) back.searchParams.set('state', url.searchParams.get('state')!)
    res.writeHead(302, { location: back.href }); res.end(); return true
  }
  if (url.pathname === '/oauth-as/token') {
    oauth.tokenCalls++
    const form = new URLSearchParams(await body())
    const { createHash } = await import('node:crypto')
    const ok = form.get('code') === 'code-1' && createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === oauth.challenge && form.get('redirect_uri') === oauth.redirect
    if (!ok) { json(400, { error: 'invalid_grant' }); return true }
    json(200, { access_token: 'good-token', token_type: 'Bearer', expires_in: 3600 }); return true
  }
  if ((url.pathname === '/oauth-mcp' || url.pathname === '/nodcr-mcp') && req.headers.authorization !== 'Bearer good-token') {
    json(401, {}, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/${which}-mcp"` }); return true
  }
  return false
}

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
  server = http.createServer(async (req, res) => {
    if (await oauthRoutes(req, res)) return
    if (req.url!.startsWith('/locked')) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('{}'); return }
    if (req.url!.startsWith('/token') && req.headers['x-test-key'] !== 'secret') { res.writeHead(401); res.end('{}'); return }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const request = new Request(base + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD', 'DELETE'].includes(req.method!) ? undefined : Buffer.concat(chunks) })
    let t = sessions.get(req.headers['mcp-session-id'] as string)
    if (!t) {
      const made = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => { sessions.set(id, made) } })
      t = made
      await makeServer().connect(t)
    }
    const r = await t.handleRequest(request)
    res.writeHead(r.status, Object.fromEntries(r.headers))
    if (!r.body) { res.end(); return }
    const reader = r.body.getReader()
    req.on('close', () => reader.cancel().catch(() => {}))
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value) }
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
})
after(() => { server.closeAllConnections(); server.close() })

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
