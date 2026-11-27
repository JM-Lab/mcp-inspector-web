/*
 * A local MCP server for the tests, made with the official server SDK: tools, a prompt with completion, a resource,
 * elicitation, progress and list_changed, plus a small OAuth authorization server. No outside network.
 *   startMcpServer({ cors }) → { base, oauth, close() }
 * cors: true answers browsers from any origin (and exposes Mcp-Session-Id), for the page test in a real browser.
 *
 * The same tools are served the ways a server can speak the protocol:
 *   /mcp (and any other path)   the 2025 way only: initialize, a session, 2025-11-25
 *   /modern-mcp                 2026-07-28 only: server/discover, no initialize, no session
 *   /both-mcp                   both: 2026-07-28 to a client that asks, the 2025 way (stateless) to one that does not
 *   /rev-2025-06-18-mcp, /rev-2025-03-26-mcp   the 2025 way, at that older revision only
 *   /rich-mcp                   the 2025 way, plus a resource template and resource subscriptions
 */
import http from 'node:http'
import { McpServer, ResourceTemplate, WebStandardStreamableHTTPServerTransport, completable, createMcpHandler, inputRequired } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'


/*
 * versions: the revisions it answers initialize with (an older server). shared: what outlives one request where every
 * request gets a server of its own (the 2026-07-28 way): whether add_tool was run, and how to tell the listeners.
 */
function makeServer({ versions, shared, rich }: { versions?: string[], shared?: { added: boolean, changed: () => void }, rich?: boolean } = {}) {
  const s = new McpServer({ name: 'mcpi-test', version: '0.0.1' }, { capabilities: { logging: {}, tools: { listChanged: true }, ...(rich ? { resources: { subscribe: true } } : {}) }, instructions: 'test instructions', ...(versions ? { supportedProtocolVersions: versions } : {}) })
  const added = () => s.registerTool('added', { description: 'new', inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'hi' }] }))
  if (shared && shared.added) added()
  s.registerTool('echo', { description: 'echo', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: 'text', text }] }))
  s.registerTool('wipe', { description: 'destructive', inputSchema: z.object({}), annotations: { destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'wiped' }] }))
  /* Written once for both ways: asks by answering "input required", which the SDK turns into an elicitation request on the 2025 way. */
  s.registerTool('ask_name', { description: 'elicitation', inputSchema: z.object({}) }, async (_a, ctx) => {
    const r = ctx.mcpReq.inputResponses && ctx.mcpReq.inputResponses.name
    if (!r) return inputRequired({ inputRequests: { name: inputRequired.elicit({ message: 'What is your name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }) } })
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
    if (shared) { if (!shared.added) { shared.added = true; shared.changed() } } else added()
    return { content: [{ type: 'text', text: 'added' }] }
  })
  s.registerPrompt('greet', { description: 'completion', argsSchema: z.object({ lang: completable(z.string(), (v) => ['korean', 'english'].filter((x) => x.startsWith(v))) }) }, ({ lang }) => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hello in ' + lang } }] }))
  s.registerResource('clock', 'test://clock', { description: 'read' }, async (uri) => ({ contents: [{ uri: uri.href, text: 'tick' }] }))
  if (rich) {
    /* A template to fill in (test://item/{id}), and subscriptions the server takes and lets go of. */
    s.registerResource('item', new ResourceTemplate('test://item/{id}', { list: undefined }), { description: 'one item' }, async (uri, { id }) => ({ contents: [{ uri: uri.href, text: 'item ' + id }] }))
    s.server.setRequestHandler('resources/subscribe', async () => ({}))
    s.server.setRequestHandler('resources/unsubscribe', async () => ({}))
  }
  return s
}

/*
 * A small authorization server (metadata, dynamic registration, authorize, token; PKCE S256 is really checked).
 * `/oauth-mcp` answers 401 with the protected resource metadata address when there is no token. `/nodcr-mcp` has no dynamic registration.
 * Two more that fail on purpose, for the debugger: `/badtoken-mcp` hands back a code its token endpoint refuses (invalid_grant),
 * and `/nocors-mcp` has a token endpoint that does not allow browser requests (no CORS headers).
 */
function oauthRoutes(base: () => string, oauth: { challenge: string, redirect: string, registered: number, tokenCalls: number }) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const base_ = base()
  const url = new URL(req.url!, base_)
  const json = (code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
  const body = async () => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks).toString() }
  const which = (['nodcr', 'badtoken', 'nocors'].find((w) => url.pathname.includes(w + '-')) || 'oauth')
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) { json(200, { resource: base_ + '/' + which + '-mcp', authorization_servers: [base_ + '/' + which + '-as'] }); return true }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.endsWith('/.well-known/openid-configuration') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    const as = base_ + '/' + which + '-as'
    json(200, { issuer: as, authorization_endpoint: as + '/authorize', token_endpoint: as + '/token', ...(which !== 'nodcr' ? { registration_endpoint: as + '/register' } : {}), response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] })
    return true
  }
  if (url.pathname === '/' + which + '-as/register' && which !== 'nodcr') { oauth.registered++; json(201, { ...JSON.parse(await body()), client_id: 'client-1' }); return true }
  if (url.pathname === '/' + which + '-as/authorize') {
    oauth.challenge = url.searchParams.get('code_challenge') || ''
    oauth.redirect = url.searchParams.get('redirect_uri') || ''
    const back = new URL(oauth.redirect)
    back.searchParams.set('code', which === 'badtoken' ? 'code-bad' : 'code-1')
    if (url.searchParams.get('state')) back.searchParams.set('state', url.searchParams.get('state')!)
    res.writeHead(302, { location: back.href }); res.end(); return true
  }
  if (url.pathname === '/' + which + '-as/token') {
    oauth.tokenCalls++
    if (which === 'nocors') for (const k of Object.keys(CORS)) res.removeHeader(k)
    const form = new URLSearchParams(await body())
    const { createHash } = await import('node:crypto')
    const ok = form.get('code') === 'code-1' && createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === oauth.challenge && form.get('redirect_uri') === oauth.redirect
    if (!ok) { json(400, { error: 'invalid_grant' }); return true }
    json(200, { access_token: 'good-token', token_type: 'Bearer', expires_in: 3600 }); return true
  }
  if (/^\/(oauth|nodcr|badtoken|nocors)-mcp$/.test(url.pathname) && req.headers.authorization !== 'Bearer good-token') {
    json(401, {}, { 'www-authenticate': `Bearer resource_metadata="${base_}/.well-known/oauth-protected-resource/${which}-mcp"` }); return true
  }
  return false
  }
}


const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version, www-authenticate',
}

export async function startMcpServer({ cors = false } = {}) {
  let base = ''
  const oauth = { challenge: '', redirect: '', registered: 0, tokenCalls: 0 }
  const routes = oauthRoutes(() => base, oauth)
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  /* The 2026-07-28 way: a server per request. Each handler has its own "was a tool added", told to whoever listens. */
  const handlerFor = (legacy: 'stateless' | 'reject') => {
    const shared = { added: false, changed: () => { h.notify.toolsChanged() } }
    const h = createMcpHandler(() => makeServer({ shared }), { legacy, keepAliveMs: 0 })
    return h
  }
  const modern = { '/modern-mcp': handlerFor('reject'), '/both-mcp': handlerFor('stateless') }
  const pipe = async (req: http.IncomingMessage, res: http.ServerResponse, r: Response) => {
    res.writeHead(r.status, Object.fromEntries(r.headers))
    if (!r.body) { res.end(); return }
    const reader = r.body.getReader()
    req.on('close', () => reader.cancel().catch(() => {}))
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value) }
    res.end()
  }
  const server = http.createServer(async (req, res) => {
    if (cors) {
      for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    }
    if (await routes(req, res)) return
    if (req.url!.startsWith('/locked')) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('{}'); return }
    if (req.url!.startsWith('/token') && req.headers['x-test-key'] !== 'secret') { res.writeHead(401); res.end('{}'); return }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const request = new Request(base + req.url, { method: req.method, headers: req.headers as Record<string, string>, body: ['GET', 'HEAD', 'DELETE'].includes(req.method!) ? undefined : Buffer.concat(chunks) })
    const path = new URL(req.url!, base).pathname
    const handler = modern[path as keyof typeof modern]
    if (handler) { await pipe(req, res, await handler.fetch(request)); return }
    let t = sessions.get(req.headers['mcp-session-id'] as string)
    if (!t) {
      const made = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => { sessions.set(id, made) } })
      t = made
      const rev = /^\/rev-(\d{4}-\d\d-\d\d)-mcp$/.exec(path)
      await makeServer(rev ? { versions: [rev[1]] } : { rich: path === '/rich-mcp' }).connect(t)
    }
    await pipe(req, res, await t.handleRequest(request))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  return { base, oauth, close: () => { for (const h of Object.values(modern)) h.close().catch(() => {}); server.closeAllConnections(); server.close() } }
}
