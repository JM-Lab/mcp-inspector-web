/*
 * The connection trace: every HTTP request a connection makes (the MCP server's own, and OAuth with PKCE) and every JSON-RPC
 * message it sends and receives, in one list a person can read. No DOM here: debug.js draws it, and node runs this as it is.
 * It stands alone. Any client built on the MCP SDK can use it:
 *
 *   const trace = createTrace({ url })
 *   const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: trace.fetch, authProvider })
 *   trace.tap(transport)
 *
 * Nothing secret is kept. Before a request is recorded, tokens, authorization codes, PKCE verifiers, client secrets, state,
 * session ids and header values are replaced with •••, by name, and every value learned to be secret is also scrubbed
 * from any text it turns up in, an address included (query, a password before the host, a token as a piece of the path).
 * JSON-RPC messages are what the person sends and gets (a tool's arguments, its result): in them a value under a name that
 * can only be a credential (password, access_token, api_key, …) is hidden too, and toLog leaves messages out unless asked.
 * The MCP server's event stream is never read here (the SDK reads it, and tap() hears the messages).
 *
 *   createTrace({ url, fetch?, probe?, max? })   url: the MCP server; fetch: the fetch to wrap (default globalThis.fetch);
 *                                                probe: on a request with no answer, ask once more in no-cors mode to tell
 *                                                CORS from an address that does not answer (default: in a browser);
 *     .fetch                     a fetch that records each request, then hands back the response untouched
 *     .tap(transport, opts)      records what the transport sends and receives (starts a new run, with begin's opts)
 *     .begin({ signIn, resume }) a new run (one connection attempt). signIn: an OAuth sign-in starts here;
 *                                resume: this run finishes one (the return from authorization)
 *     .sent(msg), .received(msg) the same as tap, for a client that taps the transport itself
 *     .redirect(url, { held })   the page leaves for the authorization page (PKCE challenge, client id); held: it did not
 *     .returned(params)          back from it: URLSearchParams with code or error
 *     .events                    the list, oldest first
 *     .export() / .restore(list) the sign-in so far, as plain data, to keep across the trip to the authorization page
 *     .subscribe(fn) → off       fn() after each change
 *     .clear()
 *   judge(events) → { level(ev), flow, failure }   what went right and wrong (see below)
 *   rowsOf(events) → { list, carried, level, keep } the rows a list shows: a request with the messages it carried
 *   toLog(events, { messages }) → text            one line per event; JSON-RPC content only with messages: true
 *   masked(value), maskedUrl(url)                 the same with secrets replaced
 *   tripStore(storage, prefix)                    keeps an exported sign-in per server: { save(url, list), take(url), drop(url) }
 */

export const HIDE = '•••'
/* Values that let someone act as the person, or finish or replay their sign-in. Matched on the name of a field in a body. */
const SECRET = /^(access_token|refresh_token|id_token|id_token_hint|client_secret|code|code_verifier|device_code|user_code|registration_access_token|assertion|client_assertion|subject_token|actor_token|password|passwd|state|authorization|proxy-authorization|cookie|set-cookie|mcp-session-id|session_id|sessionid|x-api-key|x-auth-token|api_key|apikey|access_key|key|token|secret|auth|jwt|sig|signature)$/i
/*
 * A query key or a received header is hidden on a wider match: anything that sounds like a credential, since their names are
 * anyone's choice (?sessionId=, X-Auth-Token). What OAuth itself puts in an address and is public stays.
 */
const LOOSE = /token|secret|passw|session|cookie|credential|jwt|signature|(^|[_-])sig($|[_-])|key|auth(?!enticate)|^code$/i
const PUBLIC = /^(code_challenge|code_challenge_method|token_type|token_type_hint|www-authenticate|proxy-authenticate|access-control-[a-z-]+)$/i
const hidden = (name) => SECRET.test(name) || (LOOSE.test(name) && !PUBLIC.test(name))
/*
 * Inside a JSON-RPC message (a tool's arguments, its result) only names that can hardly be anything but a credential are hidden:
 * a tool may well take a "code" to run or a "key" to look up, and hiding those would make the inspector useless for it.
 */
const SECRET_IN_MESSAGE = /^(access_token|refresh_token|id_token|client_secret|registration_access_token|client_assertion|password|passwd|passphrase|authorization|cookie|set-cookie|api_key|apikey|api-key|x-api-key|access_key|secret_key|private_key|secret|token|auth_token|bearer|jwt|session_token|code_verifier)$/i
/* A piece of a path that looks like a token (long, letters and digits mixed): https://host/s/sk_live_9f8a…/mcp */
const tokenLike = (seg) => seg.length >= 20 && /^[A-Za-z0-9._~-]+$/.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg) && !/^[a-z]+(-[a-z0-9]+)+$/.test(seg)
/* Sent headers whose values are shown. Every other one (a token in X-Api-Key, say) shows its name only. */
const SHOWN_HEADERS = /^(content-type|content-length|accept|mcp-protocol-version|mcp-method|mcp-name|cache-control|last-event-id|origin)$/i
/* decodeURIComponent throws on a stray %, and recording must never stop a request. */
const decoded = (t) => { try { return decodeURIComponent(t) } catch (e) { return t } }
const MAX_BODY = 20000
const STEPS = ['unauth', 'resource', 'server', 'register', 'redirect', 'return', 'token', 'ready']
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/* ---- masking ---- */

export function masked(v, names = SECRET) {
  if (Array.isArray(v)) return v.map((x) => masked(x, names))
  if (!v || typeof v !== 'object') return v
  const out = {}
  for (const [k, x] of Object.entries(v)) out[k] = names.test(k) && secretValue(k, x) ? HIDE : masked(x, names)
  return out
}
/* Under a secret's name, whatever is there is hidden, whole. Not the empty, and not a number called code (a JSON-RPC error code). */
const secretValue = (k, x) => !(x == null || x === '' || typeof x === 'boolean' || (typeof x === 'number' && /^code$/i.test(k)))

/* Done on the text, not with URL: URL would percent-encode ••• into %E2%80%A2… Hides secrets in the query and fragment, and a password before the host. */
export function maskedUrl(url) {
  return String(url)
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1' + HIDE + '@')
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)/i, (all, origin, path) => origin + path.split('/').map((seg) => (tokenLike(decoded(seg)) ? HIDE : seg)).join('/'))
    .replace(/([?&#])([^=&#]+)=([^&#]*)/g, (all, sep, k, v) => (hidden(decoded(k)) && v ? sep + k + '=' + HIDE : all))
}

/* Every value found under a secret name, so it can be scrubbed wherever else it appears. */
function secretsIn(v, out, names = SECRET) {
  if (Array.isArray(v)) { for (const x of v) secretsIn(x, out, names); return out }
  if (!v || typeof v !== 'object') return out
  for (const [k, x] of Object.entries(v)) {
    if (names.test(k) && secretValue(k, x)) strings(x, out)
    else secretsIn(x, out, names)
  }
  return out
}
function strings(v, out) {
  if (typeof v === 'string') out.push(v)
  else if (typeof v === 'number') out.push(String(v))
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
}

function scrubber() {
  const known = new Set()
  /* Longest first, so a secret that holds another one inside it goes whole. */
  let order = []
  const learn = (s) => {
    if (typeof s !== 'string') return
    const size = known.size
    const bare = s.replace(/^(Bearer|Basic|DPoP)\s+/i, '')
    /* Also as it looks inside an address. */
    for (const part of [s, bare, encodeURIComponent(bare)]) if (part.length >= 6 && part !== HIDE) known.add(part)
    if (known.size !== size) order = [...known].sort((a, b) => b.length - a.length)
  }
  const scrub = (v) => {
    if (typeof v === 'string') { let s = v; for (const k of order) if (s.includes(k)) s = s.split(k).join(HIDE); return s }
    if (Array.isArray(v)) return v.map(scrub)
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = scrub(x); return o }
    return v
  }
  return { learn, scrub }
}

/* ---- what a request is ---- */

const pathOf = (url) => { try { return new URL(url).pathname } catch (e) { return '' } }
/* Compared as the browser would request them (host in lower case, default port dropped), without query, fragment or a last slash. */
const endpoint = (url) => { try { const u = new URL(String(url)); return u.origin + u.pathname.replace(/\/$/, '') } catch (e) { return String(url).split(/[?#]/)[0].replace(/\/$/, '') } }
const sameUrl = (a, b) => endpoint(a) === endpoint(b)

/** Which part of connecting a request is, from its address and what it sends. */
export function kindOf(method, url, body, mcpUrl) {
  const path = pathOf(url)
  /* The MCP server's own address first: what a tool is sent must never be taken for a token request. */
  if (mcpUrl && sameUrl(url, mcpUrl)) return 'mcp'
  if (path.includes('/.well-known/oauth-protected-resource')) return 'resource'
  if (path.includes('/.well-known/oauth-authorization-server') || path.includes('/.well-known/openid-configuration')) return 'server'
  if (typeof body === 'string' && /(^|&)grant_type=/.test(body)) return 'token'
  if (method === 'POST' && typeof body === 'string' && /"redirect_uris"/.test(body)) return 'register'
  return 'other'
}

function headersOf(h) {
  const out = []
  if (!h) return out
  if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => out.push([String(k).toLowerCase(), String(v)]))
  else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) out.push([String(k).toLowerCase(), String(v)])
  return out
}

function bodyText(body) {
  if (typeof body === 'string') return body
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return String(body)
  return undefined
}

/* A body as data: JSON as itself, a form as its fields. */
function parsed(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_BODY) return undefined
  try { return JSON.parse(text) } catch (e) { /* not JSON */ }
  if (/^[^=\s{[]+=/.test(text)) return Object.fromEntries(new URLSearchParams(text))
  return undefined
}

/* ---- the trace ---- */

export function createTrace(opts = {}) {
  const base = opts.fetch || ((...a) => globalThis.fetch(...a))
  const max = opts.max || 500
  const probe = opts.probe != null ? opts.probe : typeof window !== 'undefined'
  const s = scrubber()
  let events = []
  let seq = 0
  let run = 0
  /* A sign-in is a flow: its events carry its number, from the button press to the end of the connection that came back. */
  let flow = 0
  let inFlow = false
  let resumeNext = false
  const subs = new Set()
  const changed = () => { for (const fn of subs) { try { fn() } catch (e) { /* a listener's problem */ } } }
  const push = (ev) => {
    ev.seq = ++seq
    if (ev.run == null) ev.run = run
    if (ev.flow == null && inFlow) ev.flow = flow
    if (ev.at == null) ev.at = Date.now()
    events.push(ev)
    if (events.length > max) events = events.slice(-max)
    changed()
    return ev
  }

  /*
   * What a header list shows. Sent headers: names always, values only for the harmless ones, since a token can be under any
   * name (X-Api-Key); every hidden value is learned as a secret. Received headers: everything but the ones named like a credential.
   */
  function shownHeaders(list, received) {
    const out = {}
    for (const [k, v] of list) {
      if (received ? !hidden(k) : SHOWN_HEADERS.test(k)) out[k] = s.scrub(/^(content-)?location$/.test(k) ? maskedUrl(v) : v)
      else { s.learn(v); out[k] = HIDE }
    }
    return out
  }
  /* A body as data, secrets learned first and then replaced. */
  function shownBody(data) {
    if (data === undefined) return undefined
    for (const x of secretsIn(data, [])) s.learn(x)
    return s.scrub(masked(data))
  }

  /* The event for a request about to be made, secrets learned and replaced. */
  function requested(input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    const text = bodyText(init && init.body)
    const kind = kindOf(method, url, text, opts.url)
    for (const m of String(url).matchAll(/[?&#]([^=&#]+)=([^&#]*)/g)) if (hidden(decoded(m[1]))) s.learn(decoded(m[2]))
    /* A name and password before the host (https://user:pass@host). */
    const user = /^[a-z][a-z0-9+.-]*:\/\/([^/?#@]*)@/i.exec(String(url))
    if (user) for (const part of user[1].split(':')) s.learn(decoded(part))
    /* A token as a piece of the path. */
    for (const seg of (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(String(url)) || ['', ''])[1].split('/')) if (tokenLike(decoded(seg))) s.learn(decoded(seg))
    const sentHeaders = (input && typeof input === 'object' && input.headers ? headersOf(input.headers) : []).concat(headersOf(init && init.headers))
    const data = parsed(text)
    const ev = { type: 'http', kind, method, url: '', reqHeaders: shownHeaders(sentHeaders), status: null, ok: false, ms: null }
    if (kind === 'mcp') {
      /* The JSON-RPC content is in the message events. Here only what it was, to tie the two together. */
      if (data) ev.rpc = [].concat(data).filter((m) => m && typeof m === 'object').map((m) => ({ method: m.method || (m.error ? 'error' : 'response'), id: m.id }))
    } else if (data !== undefined) ev.request = shownBody(data)
    ev.url = s.scrub(maskedUrl(url))
    push(ev)
    if (ev.rpc) link(ev)
    return { ev, url, method, kind }
  }

  /* Recording is beside the point of the request: whatever goes wrong in it, the request is made and its answer handed back as it is. */
  async function traced(input, init = {}) {
    let r = null
    try { r = requested(input, init) } catch (e) { r = null }
    const t0 = now()
    let res
    try {
      res = await base(input, init)
    } catch (e) {
      /* No answer at all. The browser does not say why: the server does not allow browser requests (CORS), or the address does not answer. */
      if (r) {
        try {
          r.ev.ms = Math.round(now() - t0)
          r.ev.status = 0
          r.ev.error = s.scrub(maskedUrl(String((e && e.message) || e)))
          if (e && e.name === 'AbortError') r.ev.aborted = true
          /* The side event stream failing is only a warning (see judge), not worth another request to find out why. */
          else if (!(r.kind === 'mcp' && r.method === 'GET')) reach(r.ev, r.url)
          changed()
        } catch (x) { /* the error below is what matters */ }
      }
      throw e
    }
    if (r) { try { await answered(r, res, t0) } catch (e) { /* the response below is what matters */ } }
    return res
  }

  async function answered({ ev, kind }, res, t0) {
    ev.ms = Math.round(now() - t0)
    ev.status = res.status
    ev.ok = res.ok
    /* The SDK does not follow redirects, so one comes back as an answer with no status that cannot be read. */
    if (res.type === 'opaqueredirect') ev.redirected = true
    ev.resHeaders = shownHeaders(headersOf(res.headers), true)
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || ''
    /* A small JSON answer is read from a copy (metadata, registration, token, an error). The event stream is never touched. */
    if ((kind !== 'mcp' || !res.ok) && !/event-stream/i.test(type) && /json|text\/plain/i.test(type)) {
      try {
        const t = await res.clone().text()
        if (t.length <= MAX_BODY) ev.response = shownBody(parsed(t) !== undefined ? parsed(t) : t)
      } catch (e) { /* not readable */ }
    }
    changed()
  }

  /* Asks the same address once more in no-cors mode: an opaque answer means the server is there and CORS is what failed. */
  function reach(ev, url) {
    let target
    try { target = new URL(url) } catch (e) { return }
    if (typeof location !== 'undefined' && location.protocol === 'https:' && target.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname)) { ev.reach = 'mixed'; return }
    if (!probe) return
    base(target.href, { method: 'GET', mode: 'no-cors', credentials: 'omit', cache: 'no-store' })
      /* Only whether it answers matters: its body (an event stream, on some servers) is let go at once. */
      .then((r) => { ev.reach = 'cors'; try { if (r && r.body) r.body.cancel().catch(() => {}) } catch (e) { /* nothing to let go */ } }, () => { ev.reach = 'unreachable' })
      .then(changed)
  }

  /* Ties an MCP request to the JSON-RPC messages it carries (same run, same id; a notification by its method). */
  function link(ev) {
    for (const r of ev.rpc) {
      for (let i = events.length - 1; i >= 0; i--) {
        const m = events[i]
        if (m.type === 'rpc' && m.dir === 'out' && m.run === ev.run && m.http == null && (r.id != null ? m.id === r.id : m.id == null && m.method === r.method)) { m.http = ev.seq; break }
      }
    }
  }

  /* A message as it is kept: credentials in it hidden by name and learned, then every known secret scrubbed. */
  function shownMessage(m) {
    for (const x of secretsIn(m, [], SECRET_IN_MESSAGE)) s.learn(x)
    return s.scrub(masked(m, SECRET_IN_MESSAGE))
  }

  function sent(msg) {
    for (const m of [].concat(msg)) push({ type: 'rpc', dir: 'out', method: m.method || (m.error ? 'error' : 'response'), id: m.id, message: shownMessage(m), t0: now() })
  }
  function received(msg) {
    const reply = msg.id != null && msg.method == null
    const out = reply ? [...events].reverse().find((e) => e.type === 'rpc' && e.dir === 'out' && e.run === run && e.id === msg.id && e.reply == null) : null
    const ev = push({ type: 'rpc', dir: 'in', method: msg.method || (msg.error ? 'error' : 'response'), id: msg.id, message: shownMessage(msg), to: out ? out.seq : undefined })
    if (out) { out.reply = ev.seq; out.ms = Math.round(now() - out.t0); changed() }
  }

  /* signIn: a sign-in starts with this run. resume: this run finishes one (the return from authorization), as does the run after restore(). */
  function begin(o = {}) {
    run++
    if (o.signIn) { flow++; inFlow = true; push({ type: 'note', kind: 'start' }) }
    else if (!o.resume && !resumeNext) inFlow = false
    resumeNext = false
    return run
  }

  function tap(transport, o) {
    begin(o)
    const send = transport.send.bind(transport)
    transport.send = (msg, o) => { sent(msg); return send(msg, o) }
    let handler = null
    const wrapped = (msg, extra) => { received(msg); if (handler) handler(msg, extra) }
    Object.defineProperty(transport, 'onmessage', { configurable: true, get: () => (handler ? wrapped : undefined), set: (fn) => { handler = fn } })
    return transport
  }

  /* held: the page did not leave (the SDK asked by itself, and sign-in starts only from a press). */
  function redirect(authUrl, o = {}) {
    let q = new URLSearchParams()
    try { q = new URL(String(authUrl)).searchParams } catch (e) { /* not an address */ }
    const pick = ['response_type', 'client_id', 'redirect_uri', 'scope', 'resource', 'code_challenge_method', 'code_challenge', 'state']
    const params = {}
    for (const k of pick) if (q.get(k) != null) params[k] = q.get(k)
    if (params.state) s.learn(params.state)
    /* Registration made no request when the client id is a metadata document (a URL) or was saved from before. Say which. */
    if (!flowEvents(events).some((e) => e.type === 'http' && e.kind === 'register')) {
      push({ type: 'note', kind: 'register', how: /^https:\/\//.test(params.client_id || '') ? 'metadata' : 'saved', clientId: params.client_id })
    }
    push({ type: 'note', kind: 'redirect', ok: !o.held, held: !!o.held || undefined, url: s.scrub(maskedUrl(authUrl)), params: s.scrub(masked(params)) })
  }

  function returned(q) {
    const get = (k) => (q && q.get ? q.get(k) : null)
    if (get('code')) s.learn(get('code'))
    if (get('state')) s.learn(get('state'))
    const params = {}
    for (const k of ['code', 'state', 'iss', 'error', 'error_description', 'error_uri']) if (get(k) != null) params[k] = get(k)
    push({ type: 'note', kind: 'return', ok: !!get('code') && !get('error'), params: s.scrub(masked(params)) })
  }

  /* The sign-in from its start, without JSON-RPC content, to keep in storage across the redirect. */
  function exportFlow() {
    return flowEvents(events).filter((e) => e.type !== 'rpc').map((e) => JSON.parse(JSON.stringify(s.scrub(e))))
  }
  function restore(list) {
    if (!Array.isArray(list) || !list.length) return
    flow++
    inFlow = true
    resumeNext = true
    for (const e of list) if (e && typeof e === 'object' && (e.type === 'http' || e.type === 'note')) push(Object.assign({}, e, { run: 0, flow, restored: true }))
  }

  return {
    fetch: traced, tap, begin, sent, received, redirect, returned,
    export: exportFlow, restore,
    get events() { return events },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    clear() { events = []; changed() },
    scrub: s.scrub,
  }
}

/* ---- reading the trace ---- */

const isOauth = (e) => (e.type === 'http' && ['resource', 'server', 'register', 'token'].includes(e.kind)) || (e.type === 'note' && e.kind !== 'start')
const denied = (e) => e.type === 'http' && e.kind === 'mcp' && (e.status === 401 || e.status === 403)

/*
 * The events of the sign-in to show. One the SDK started by itself during the last connection (a token refreshed, say) comes
 * first: those requests carry no flow number, and count from the refused MCP request before them. Else the last numbered one.
 */
function flowEvents(events) {
  if (!events.length) return []
  const lastRun = events[events.length - 1].run
  const own = events.filter((e) => e.run === lastRun && e.flow == null)
  const first = own.findIndex(isOauth)
  if (first >= 0) {
    for (let i = first; i >= 0; i--) if (denied(own[i])) return own.slice(i)
    return own.slice(first)
  }
  let last = 0
  for (const e of events) if (e.flow > last) last = e.flow
  return last ? events.filter((e) => e.flow === last) : []
}

/* Why one request failed, as a hint code and what goes into its sentence. */
function hintOf(e) {
  if (e.type === 'note' && e.kind === 'redirect') return { code: 'held' }
  if (e.redirected) return { code: 'redirected', host: hostOf(e.url) }
  if (e.type === 'note' && e.kind === 'return') return { code: 'returnError', error: e.params.error || '', description: e.params.error_description || '' }
  if (e.status === 0) return { code: e.reach === 'mixed' ? 'mixed' : e.reach === 'cors' ? 'cors' : e.reach === 'unreachable' ? 'unreachable' : 'noAnswer', host: hostOf(e.url) }
  const r = e.response && typeof e.response === 'object' ? e.response : null
  if (r && typeof r.error === 'string') return { code: 'oauthError', status: e.status, error: r.error, description: r.error_description || '' }
  return { code: 'status', status: e.status, host: hostOf(e.url) }
}
const hostOf = (url) => { try { return new URL(url).host } catch (e) { return String(url) } }

/*
 * The sign-in as eight steps, in order, each with a status:
 *   ok    done            warn  done, with something worth knowing    fail  it stopped here
 *   skip  not needed      none  not reached
 * The SDK tries several addresses for metadata and retries without its own header when CORS blocks it, so a step is judged
 * on all its requests: one that succeeded makes the step done.
 */
function flowOf(events) {
  const list = flowEvents(events)
  if (!list.some(isOauth)) return null
  const firstOauth = list.findIndex(isOauth)
  const lastToken = list.map((e) => e.type === 'http' && e.kind === 'token').lastIndexOf(true)
  const back = list.findIndex((e) => e.type === 'note' && e.kind === 'return')
  const after = Math.max(lastToken, back)
  const group = {
    unauth: list.slice(0, firstOauth).filter(denied),
    resource: list.filter((e) => e.type === 'http' && e.kind === 'resource'),
    server: list.filter((e) => e.type === 'http' && e.kind === 'server'),
    register: list.filter((e) => (e.type === 'http' && e.kind === 'register') || (e.type === 'note' && e.kind === 'register')),
    redirect: list.filter((e) => e.type === 'note' && e.kind === 'redirect'),
    return: list.filter((e) => e.type === 'note' && e.kind === 'return'),
    token: list.filter((e) => e.type === 'http' && e.kind === 'token'),
    ready: after >= 0 ? list.slice(after + 1).filter((e) => e.type === 'http' && e.kind === 'mcp' && e.status != null && !(e.method === 'GET' && e.status === 405) && e.method !== 'DELETE') : [],
  }
  const done = (e) => (e.type === 'note' ? e.ok !== false : e.ok)
  const steps = STEPS.map((key) => {
    const evs = group[key]
    const step = { key, events: evs.map((e) => e.seq), status: 'none' }
    if (!evs.length) return step
    if (evs.some((e) => e.status === null)) { step.status = 'busy'; return step }
    if (key === 'unauth') {
      const e = evs[evs.length - 1]
      const www = e.resHeaders && e.resHeaders['www-authenticate']
      step.status = www ? 'ok' : 'warn'
      if (!www) step.hint = { code: 'noWww' }
      return step
    }
    if (key === 'register' && evs.every((e) => e.type === 'note')) { step.status = 'ok'; step.how = evs[evs.length - 1].how; return step }
    if (key === 'ready') {
      const ok = evs.find((e) => e.ok)
      if (ok) { step.status = 'ok'; return step }
      const e = evs[evs.length - 1]
      step.status = 'fail'
      step.hint = denied(e) ? { code: 'stillDenied', status: e.status } : hintOf(e)
      step.at = e.seq
      return step
    }
    const good = evs.filter(done)
    if (good.length) {
      step.status = 'ok'
      /* It worked only on a second try without the SDK's MCP-Protocol-Version header: the CORS rules do not allow that header. */
      const firstGood = good[0]
      if (evs.some((e) => e.seq < firstGood.seq && e.status === 0 && sameUrl(e.url, firstGood.url))) { step.status = 'warn'; step.hint = { code: 'corsHeader', host: hostOf(firstGood.url) } }
      return step
    }
    const e = evs[evs.length - 1]
    step.status = 'fail'
    step.hint = hintOf(e)
    step.at = e.seq
    return step
  })
  const at = Object.fromEntries(steps.map((x) => [x.key, x]))
  /* No protected resource metadata is allowed (older servers): the SDK then asks the server's own origin, so it is a warning when that worked. */
  if (at.resource.status === 'fail' && ['ok', 'warn', 'busy'].includes(at.server.status)) { at.resource.status = 'warn'; at.resource.hint = Object.assign({}, at.resource.hint, { code: at.resource.hint.code === 'status' ? 'noPrm' : at.resource.hint.code }) }
  /* The SDK stops before any request when the authorization server offers no registration: say so on that step. */
  if (at.register.status === 'none' && at.server.status === 'ok' && at.redirect.status === 'none') {
    const meta = list.filter((e) => e.type === 'http' && e.kind === 'server' && e.ok).map((e) => e.response).find((r) => r && typeof r === 'object')
    /* Not when a token was asked for: a client that could do that was registered some time. */
    if (meta && !meta.registration_endpoint && !at.token.events.length) {
      at.register.status = 'fail'
      at.register.hint = { code: 'noDcr' }
      /* Its row is the metadata that has no registration_endpoint. */
      at.register.at = at.server.events[at.server.events.length - 1]
    }
  }
  /* Before the step that failed: a step with nothing was not needed. After it: not reached. */
  const failed = steps.findIndex((x) => x.status === 'fail')
  const lastSeen = steps.map((x) => x.status !== 'none').lastIndexOf(true)
  steps.forEach((x, i) => { if (x.status === 'none' && i < (failed >= 0 ? failed : lastSeen)) x.status = 'skip' })
  /* current: nothing happened after it, so what it says is where things stand now. */
  return { steps, failed: failed >= 0 ? steps[failed] : null, from: list[0].seq, current: list[list.length - 1] === events[events.length - 1] }
}

/**
 * judge(events) → { flow, failure, level(event) }
 *   flow      the OAuth sign-in as steps (null when there was none)
 *   failure   the last thing that failed, for a notice: { step?, hint, seq }; null when the last attempt went through
 *   level(e)  how a row is marked: 'ok', 'fail', 'warn', 'info' (expected along the way, such as the 401 that starts sign-in), 'busy'
 */
export function judge(events) {
  const flow = flowOf(events)
  const inFlow = new Set()
  if (flow) for (const st of flow.steps) for (const s of st.events) inFlow.add(s)
  const replies = new Map(events.filter((e) => e.type === 'rpc' && e.dir === 'in' && e.to != null).map((e) => [e.to, e]))
  const level = (e) => {
    if (e.type === 'note') return (e.kind === 'return' || e.kind === 'redirect') && e.ok === false ? 'fail' : 'info'
    if (e.type === 'rpc') {
      if (e.message && e.message.error) return 'fail'
      const r = e.reply != null ? replies.get(e.seq) : null
      return r && r.message && r.message.error ? 'fail' : 'ok'
    }
    if (e.status === null) return 'busy'
    if (e.aborted) return 'info'
    if (e.kind === 'mcp' && e.method === 'GET' && e.status === 405) return 'info'
    /* The event stream the SDK opens on the side. Without it requests still work; only messages the server sends on its own are lost. */
    if (e.kind === 'mcp' && e.method === 'GET' && !e.ok) return 'warn'
    if (denied(e) && flow && inFlow.has(e.seq) && flow.steps[0].events.includes(e.seq)) return 'info'
    if (!e.ok && inFlow.has(e.seq)) {
      const st = flow.steps.find((x) => x.events.includes(e.seq))
      if (st && (st.status === 'ok' || st.status === 'warn' || st.status === 'busy')) return 'info'
    }
    return e.ok ? 'ok' : 'fail'
  }
  let failure = null
  if (flow && flow.failed && flow.current) failure = { step: flow.failed.key, hint: flow.failed.hint, seq: flow.failed.at != null ? flow.failed.at : flow.failed.events[flow.failed.events.length - 1] }
  else {
    /* Outside a sign-in: the last HTTP request of the last run, when it failed. */
    const last = [...events].reverse().find((e) => e.type === 'http' && e.status !== null && !e.aborted && !(e.kind === 'mcp' && e.method === 'GET') && e.method !== 'DELETE')
    if (last && level(last) === 'fail') failure = { hint: denied(last) ? { code: 'denied', status: last.status } : hintOf(last), seq: last.seq }
  }
  return { flow, failure, level }
}

/**
 * rowsOf(events) → { events, judged, list, carried, level(event), keep(event, filter) }
 * What a list of the trace shows: each HTTP request with the JSON-RPC messages it carried (and their answers) folded into it,
 * and on their own the messages no request carried (what the server sent by itself).
 *   list            the rows, oldest first
 *   carried         Map of an HTTP event's seq → the messages folded into it
 *   level(e)        judge's level, and 'fail' for a request whose message was answered with a JSON-RPC error
 *   keep(e, filter) whether a row passes 'all', 'rpc', 'http' or 'errors'
 */
export function rowsOf(events) {
  const judged = judge(events)
  const bySeq = new Map(events.map((e) => [e.seq, e]))
  const folded = new Set()
  const carried = new Map()
  for (const e of events) {
    if (e.type === 'rpc' && e.dir === 'out' && e.http != null && bySeq.has(e.http)) {
      folded.add(e.seq)
      if (!carried.has(e.http)) carried.set(e.http, [])
      carried.get(e.http).push(e)
      if (e.reply != null && bySeq.has(e.reply)) { folded.add(e.reply); carried.get(e.http).push(bySeq.get(e.reply)) }
    }
  }
  const level = (e) => {
    const own = judged.level(e)
    if (own === 'fail' || e.type !== 'http') return own
    return (carried.get(e.seq) || []).some((x) => judged.level(x) === 'fail') ? 'fail' : own
  }
  const keep = (e, filter) => {
    if (!filter || filter === 'all') return true
    if (filter === 'errors') { const l = level(e); return l === 'fail' || l === 'warn' }
    if (filter === 'rpc') return e.type === 'rpc' || (e.type === 'http' && !!e.rpc)
    return e.type === 'http' || e.type === 'note'
  }
  return { events, judged, list: events.filter((e) => !folded.has(e.seq)), carried, level, keep }
}

/* ---- the log, as text ---- */

const time = (at) => { const d = new Date(at); const p = (n, w = 2) => String(n).padStart(w, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3) }
const oneLine = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/** One line per request and message, secrets already replaced. JSON-RPC content (tool arguments, results) only with messages: true. */
export function toLog(events, { messages = false } = {}) {
  const lines = []
  for (const e of events) {
    const t = time(e.at)
    if (e.type === 'http') {
      const what = e.rpc ? '  ' + e.rpc.map((r) => r.method + (r.id != null ? ' #' + r.id : '')).join(', ') : ''
      lines.push(t + ' → ' + e.method.padEnd(6) + ' ' + e.url + what + (e.request ? '  ' + oneLine(e.request) : ''))
      if (e.status === null) continue
      const head = e.resHeaders && e.resHeaders['www-authenticate'] ? '  www-authenticate: ' + e.resHeaders['www-authenticate'] : ''
      const t2 = time(e.at + (e.ms || 0))
      if (e.redirected) lines.push(t2 + ' ← redirect (not followed)  ' + e.ms + 'ms')
      else if (e.status === 0) lines.push(t2 + ' ✕ ' + (e.aborted ? 'aborted' : 'no answer' + (e.reach ? ' (' + e.reach + ')' : '')) + '  ' + e.ms + 'ms  ' + (e.error || ''))
      else lines.push(t2 + ' ← ' + String(e.status).padEnd(6) + ' ' + e.ms + 'ms' + head + (e.response !== undefined ? '  ' + oneLine(e.response) : ''))
    } else if (e.type === 'note') {
      if (e.kind === 'start') lines.push(t + ' ● sign-in started')
      else if (e.kind === 'register') lines.push(t + ' ● client: ' + (e.how === 'metadata' ? 'metadata document ' : 'saved registration ') + (e.clientId || ''))
      else if (e.kind === 'redirect') lines.push(t + (e.held ? ' ✕ authorization page not opened (needs a press)  ' : ' ↗ authorization page  ') + e.url)
      else lines.push(t + ' ↙ returned  ' + oneLine(e.params))
    } else {
      const arrow = e.dir === 'out' ? '⇢' : '⇠'
      const head = t + ' ' + arrow + ' ' + e.method + (e.id != null ? ' #' + e.id : '')
      const err = e.message && e.message.error ? '  error ' + e.message.error.code + ' ' + e.message.error.message : ''
      lines.push(head + err + (messages ? '  ' + oneLine(e.message) : ''))
    }
  }
  return lines.join('\n')
}

/* ---- keeping a sign-in across the redirect ---- */

/** The sign-in so far, per server address, until the page comes back. take() removes it, so it is read once. */
export function tripStore(storage, prefix) {
  const key = (url) => prefix + ':trip:' + url
  return {
    save(url, list) { try { storage.setItem(key(url), JSON.stringify({ at: Date.now(), list })) } catch (e) { /* storage blocked */ } },
    take(url, maxAge = 30 * 60000) {
      let v = null
      try { v = JSON.parse(storage.getItem(key(url))) } catch (e) { v = null }
      try { storage.removeItem(key(url)) } catch (e) { /* storage blocked */ }
      return v && Date.now() - (v.at || 0) < maxAge && Array.isArray(v.list) ? v.list : []
    },
    drop(url) { try { storage.removeItem(key(url)) } catch (e) { /* storage blocked */ } },
  }
}
