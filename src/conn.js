/*
 * One connection to one server, through the official SDK (@modelcontextprotocol/client).
 * It knows nothing of the UI: events go out through hooks, so the browser bundle and `node --test` run the same code.
 *   hooks.onLog(conn)            a message was sent or received
 *   hooks.onListsChanged(conn)   the server said a list changed
 *   hooks.onElicit(conn, params) the server asks for input; resolve to { action, content }
 *   hooks.authProvider(server)   an OAuth provider (none means no OAuth)
 *   hooks.hasTokens(server)      whether OAuth tokens are already stored
 *   hooks.explain(error, oauth)  the error sentence shown to a person
 *   hooks.clientInfo             { name, version } sent in initialize
 * Every HTTP request and JSON-RPC message also goes into conn.trace (trace.js), which the debugger draws.
 *
 * Two ways of speaking the protocol are handled, and the server decides which (conn.era, after connecting):
 *   'modern'   revision 2026-07-28 and later: the client asks server/discover, there is no initialize and no session,
 *              and notifications come on a subscriptions/listen stream it opens
 *   'legacy'   the 2025 revisions: initialize, a session id, notifications on the GET stream, resources/subscribe
 * The client probes with server/discover first and falls back to initialize when the server does not know it.
 * What differs between them is hidden behind send(): ping, and subscribing to a resource, work on both.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { isAuthError, isNetError } from './lib.js'
import { createTrace } from './trace.js'

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Wraps the transport's send and onmessage so every message lands in the History log. */
export function tap(transport, c) {
  const send = transport.send.bind(transport)
  transport.send = (msg, opts) => {
    for (const m of [].concat(msg)) {
      c.log.unshift({ method: m.method || 'response', dir: 'out', id: m.id, request: m, at: new Date(), t0: now(), ms: null, response: null, error: null })
    }
    c.trace.sent(msg)
    c.hooks.onLog(c)
    return send(msg, opts)
  }
  let handler = null
  const wrapped = (msg, extra) => {
    c.trace.received(msg)
    const hit = msg.id != null && msg.method == null ? c.log.find((e) => e.dir === 'out' && e.id === msg.id && e.response == null) : null
    if (hit) { hit.response = msg; hit.ms = Math.round(now() - hit.t0) }
    else { c.log.unshift({ method: msg.method || 'message', dir: 'in', request: msg, at: new Date(), ms: null, response: null, error: null }); c.unseen++ }
    c.hooks.onLog(c)
    if (handler) handler(msg, extra)
  }
  Object.defineProperty(transport, 'onmessage', { configurable: true, get: () => (handler ? wrapped : undefined), set: (fn) => { handler = fn } })
}

/*
 * A header token (server.headers) goes to the MCP server's own address and nowhere else. Given to the SDK as requestInit,
 * it would also go with the OAuth requests (metadata, registration, token), to an authorization server that may be another site.
 * A header the request already has (the SDK's own Authorization from OAuth, say) is kept.
 */
const endpoint = (url) => { try { const u = new URL(String(url)); return u.origin + u.pathname.replace(/\/$/, '') } catch (e) { return String(url) } }
function withHeaders(fetchFn, serverUrl, headersOf) {
  const target = endpoint(serverUrl)
  return (input, init = {}) => {
    const extra = Object.entries(headersOf() || {})
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
    if (!extra.length || endpoint(url) !== target) return fetchFn(input, init)
    const headers = new Headers(input && typeof input === 'object' && input.headers ? input.headers : undefined)
    new Headers(init && init.headers).forEach((v, k) => headers.set(k, v))
    for (const [k, v] of extra) if (!headers.has(k)) headers.set(k, v)
    return fetchFn(input, Object.assign({}, init, { headers }))
  }
}

/** Sent in initialize. `npm version` keeps the version in step with package.json (scripts/version.js). */
export const CLIENT_INFO = { name: 'mcp-inspector-web', version: '0.1.0' }

const NO_HOOKS = { clientInfo: CLIENT_INFO, onLog() {}, onListsChanged() {}, onElicit: async () => ({ action: 'decline' }), authProvider: null, hasTokens: () => false, explain: (e) => String((e && e.message) || e) }

export class Conn {
  constructor(server, hooks) {
    this.server = server
    this.hooks = Object.assign({}, NO_HOOKS, hooks)
    this.log = []
    this.client = null
    this.state = 'idle'
    this.error = ''
    this.needAuth = false
    this.subs = new Set()
    /* On a modern connection: the open subscriptions/listen streams, by resource address ('' for the list changes). */
    this.listens = new Map()
    this.era = null
    this.unseen = 0
    this.trace = createTrace({ url: server.url })
  }
  transport(oauth) {
    /* The traced fetch sees every request: the MCP server's own, and the OAuth ones (metadata, registration, token). */
    const opts = { fetch: withHeaders(this.trace.fetch, this.server.url, () => this.server.headers) }
    if (oauth && this.hooks.authProvider) opts.authProvider = this.hooks.authProvider(this.server)
    return new StreamableHTTPClientTransport(new URL(this.server.url), opts)
  }
  async listAll(fn, key) {
    const out = []
    let cursor
    for (let i = 0; i < 20; i++) {
      /* 'refresh': asked again each time, not served from the SDK's cache (a list is read again because it changed). */
      const r = await fn(cursor ? { cursor } : undefined, { cacheMode: 'refresh' })
      out.push(...(r[key] || []))
      cursor = r.nextCursor
      if (!cursor) break
    }
    return out
  }
  async lists(client = this.client) {
    const caps = client.getServerCapabilities() || {}
    const tools = caps.tools ? await this.listAll((p, o) => client.listTools(p, o), 'tools') : []
    const prompts = caps.prompts ? await this.listAll((p, o) => client.listPrompts(p, o), 'prompts') : []
    const resources = caps.resources ? await this.listAll((p, o) => client.listResources(p, o), 'resources') : []
    let templates = []
    if (caps.resources) { try { templates = await this.listAll((p, o) => client.listResourceTemplates(p, o), 'resourceTemplates') } catch (e) { templates = [] } }
    return { tools, prompts, resources, templates }
  }
  async connect(opts) {
    this.state = 'connecting'
    this.error = ''
    this.needAuth = false
    const oauth = !!(opts && opts.oauth)
    /* A new run of the trace. A sign-in started by the button (not the return from it) marks where its OAuth flow begins. */
    this.trace.begin({ signIn: oauth && !(opts && opts.callback), resume: !!(opts && opts.callback) })
    try {
      if (this.client) await this.client.close().catch(() => {})
      this.subs.clear()
      this.listens.clear()
      this.era = null
      /* 'auto': ask server/discover (2026-07-28), and use the 2025 initialize handshake when the server does not answer it. */
      const client = new Client(Object.assign({}, CLIENT_INFO, this.hooks.clientInfo), { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: this.hooks.negotiation || 'auto' } })
      const transport = this.transport(oauth || this.hooks.hasTokens(this.server))
      tap(transport, this)
      if (opts && opts.callback) await transport.finishAuth(opts.callback)
      client.fallbackNotificationHandler = async () => {}
      for (const kind of ['tools', 'prompts', 'resources']) {
        client.setNotificationHandler('notifications/' + kind + '/list_changed', () => { this.hooks.onListsChanged(this) })
      }
      client.setRequestHandler('elicitation/create', (request) => this.hooks.onElicit(this, request.params || {}))
      await client.connect(transport)
      this.client = client
      const caps = client.getServerCapabilities() || {}
      this.era = client.getProtocolEra() || 'legacy'
      const info = { serverInfo: client.getServerVersion() || {}, instructions: client.getInstructions() || '', capabilities: caps, protocolVersion: client.getNegotiatedProtocolVersion() || transport.protocolVersion, era: this.era }
      const lists = await this.lists(client)
      /* A modern server sends list changes only on a stream the client opens for them. Without it the lists just do not refresh. */
      if (this.era === 'modern') {
        const want = {}
        for (const kind of ['tools', 'prompts', 'resources']) if (caps[kind] && caps[kind].listChanged) want[kind + 'ListChanged'] = true
        if (Object.keys(want).length) client.listen(want).then((sub) => { if (this.client === client) this.listens.set('', sub); else sub.close().catch(() => {}) }, () => {})
      }
      this.state = 'connected'
      return Object.assign({ info }, lists)
    } catch (e) {
      this.state = 'failed'
      this.needAuth = isAuthError(e) && !isNetError(e)
      this.error = this.hooks.explain(e, oauth)
      throw e
    }
  }
  async send(method, params, opts) {
    const c = this.client
    const t0 = now()
    let result
    if (method === 'tools/call') result = await c.callTool(params, opts)
    else if (method === 'prompts/get') result = await c.getPrompt(params, opts)
    else if (method === 'resources/read') result = await c.readResource(params, opts)
    else if (method === 'resources/subscribe') {
      /* Modern: a subscriptions/listen stream for this one resource, kept to close on unsubscribe. */
      if (this.era === 'modern') { this.listens.set(params.uri, await c.listen({ resourceSubscriptions: [params.uri] }, opts)); result = {} }
      else result = await c.subscribeResource(params, opts)
      this.subs.add(params.uri)
    } else if (method === 'resources/unsubscribe') {
      if (this.era === 'modern') { const sub = this.listens.get(params.uri); this.listens.delete(params.uri); if (sub) await sub.close(); result = {} }
      else result = await c.unsubscribeResource(params, opts)
      this.subs.delete(params.uri)
    } else if (method === 'logging/setLevel') result = await c.setLoggingLevel(params.level, opts)
    else if (method === 'completion/complete') result = await c.complete(params, opts)
    /* Modern has no ping: server/discover is its request that only asks whether the server answers. */
    else if (method === 'ping') result = this.era === 'modern' ? await c.discover(opts) : await c.ping(opts)
    else throw new Error('Unknown method: ' + method)
    this.lastMs = Math.round(now() - t0)
    return result
  }
  close() {
    for (const sub of this.listens.values()) sub.close().catch(() => {})
    this.listens.clear()
    if (this.client) this.client.close().catch(() => {})
    this.client = null
    this.state = 'idle'
  }
}
