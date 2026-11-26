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
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { isAuthError, isNetError } from './lib.js'

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Wraps the transport's send and onmessage so every message lands in the History log. */
export function tap(transport, c) {
  const send = transport.send.bind(transport)
  transport.send = (msg, opts) => {
    for (const m of [].concat(msg)) {
      c.log.unshift({ method: m.method || 'response', dir: 'out', id: m.id, request: m, at: new Date(), t0: now(), ms: null, response: null, error: null })
    }
    c.hooks.onLog(c)
    return send(msg, opts)
  }
  let handler = null
  const wrapped = (msg, extra) => {
    const hit = msg.id != null && msg.method == null ? c.log.find((e) => e.dir === 'out' && e.id === msg.id && e.response == null) : null
    if (hit) { hit.response = msg; hit.ms = Math.round(now() - hit.t0) }
    else { c.log.unshift({ method: msg.method || 'message', dir: 'in', request: msg, at: new Date(), ms: null, response: null, error: null }); c.unseen++ }
    c.hooks.onLog(c)
    if (handler) handler(msg, extra)
  }
  Object.defineProperty(transport, 'onmessage', { configurable: true, get: () => (handler ? wrapped : undefined), set: (fn) => { handler = fn } })
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
    this.unseen = 0
  }
  transport(oauth) {
    const opts = { requestInit: { headers: this.server.headers || {} } }
    if (oauth && this.hooks.authProvider) opts.authProvider = this.hooks.authProvider(this.server)
    return new StreamableHTTPClientTransport(new URL(this.server.url), opts)
  }
  async listAll(fn, key) {
    const out = []
    let cursor
    for (let i = 0; i < 20; i++) {
      const r = await fn(cursor ? { cursor } : undefined)
      out.push(...(r[key] || []))
      cursor = r.nextCursor
      if (!cursor) break
    }
    return out
  }
  async lists(client = this.client) {
    const caps = client.getServerCapabilities() || {}
    const tools = caps.tools ? await this.listAll((p) => client.listTools(p), 'tools') : []
    const prompts = caps.prompts ? await this.listAll((p) => client.listPrompts(p), 'prompts') : []
    const resources = caps.resources ? await this.listAll((p) => client.listResources(p), 'resources') : []
    let templates = []
    if (caps.resources) { try { templates = await this.listAll((p) => client.listResourceTemplates(p), 'resourceTemplates') } catch (e) { templates = [] } }
    return { tools, prompts, resources, templates }
  }
  async connect(opts) {
    this.state = 'connecting'
    this.error = ''
    this.needAuth = false
    const oauth = !!(opts && opts.oauth)
    try {
      if (this.client) await this.client.close().catch(() => {})
      this.subs.clear()
      const client = new Client(Object.assign({}, CLIENT_INFO, this.hooks.clientInfo), { capabilities: { elicitation: { form: {} } } })
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
      const info = { serverInfo: client.getServerVersion() || {}, instructions: client.getInstructions() || '', capabilities: caps, protocolVersion: transport.protocolVersion }
      const lists = await this.lists(client)
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
    else if (method === 'resources/subscribe') { result = await c.subscribeResource(params, opts); this.subs.add(params.uri) }
    else if (method === 'resources/unsubscribe') { result = await c.unsubscribeResource(params, opts); this.subs.delete(params.uri) }
    else if (method === 'logging/setLevel') result = await c.setLoggingLevel(params.level, opts)
    else if (method === 'completion/complete') result = await c.complete(params, opts)
    else if (method === 'ping') result = await c.ping(opts)
    else throw new Error('Unknown method: ' + method)
    this.lastMs = Math.round(now() - t0)
    return result
  }
  close() {
    if (this.client) this.client.close().catch(() => {})
    this.client = null
    this.state = 'idle'
  }
}
