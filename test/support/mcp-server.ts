/*
 * A local MCP server for the tests, made with the official server SDK: tools, a prompt with completion, a resource,
 * elicitation, progress and list_changed, plus a small OAuth authorization server. No outside network.
 *   startMcpServer({ cors }) → { base, oauth, close() }
 * cors: true answers browsers from any origin (and exposes Mcp-Session-Id), for the page test in a real browser.
 */
import http from 'node:http'
import { McpServer, WebStandardStreamableHTTPServerTransport, completable } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'


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
function oauthRoutes(base: () => string, oauth: { challenge: string, redirect: string, registered: number, tokenCalls: number }) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const base_ = base()
  const url = new URL(req.url!, base_)
  const json = (code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
  const body = async () => { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); return Buffer.concat(chunks).toString() }
  const which = url.pathname.includes('nodcr') ? 'nodcr' : 'oauth'
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) { json(200, { resource: base_ + '/' + which + '-mcp', authorization_servers: [base_ + '/' + which + '-as'] }); return true }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.endsWith('/.well-known/openid-configuration') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    const as = base_ + '/' + which + '-as'
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
  return { base, oauth, close: () => { server.closeAllConnections(); server.close() } }
}
