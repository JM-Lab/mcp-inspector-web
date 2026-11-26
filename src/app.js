/*
 * MCP Inspector Web: an MCP client that runs entirely in the browser.
 * It connects through the official SDK (@modelcontextprotocol/client). Pinned servers come from options.servers,
 * anything else is found in the official MCP Registry or added by address.
 * Covers: Streamable HTTP, Tools, Prompts, Resources, templates, completion, Ping, server notifications,
 * resource subscriptions, cancelling a request, elicitation, header tokens and OAuth with PKCE.
 * Sampling and roots are not declared. stdio servers and servers that do not allow CORS cannot be reached from a web page.
 * Logic with no UI is in lib.js and the connection in conn.js, so the tests run the same code as the page.
 *
 *   mount(root, options)   see README.md for every option
 */
import { Conn } from './conn.js'
import { STRINGS } from './strings.js'
import { CAP, REG_FIRST, REGISTRY, STORE_PREFIX, clientMetadataFor, kindOf, parseValue, missingRequired, hostOf, cleanUrl, registryCards, iconCandidates, pushFront, filled, loadStore, saveStore, countsText, featuredFor, isAuthError, isNetError } from './lib.js'

export function mount(root, options) {
  const cfg = Object.assign({ lang: 'en', servers: [], featured: null, registry: REGISTRY, storagePrefix: STORE_PREFIX, clientInfo: null, oauth: {}, syncUrl: true }, options)
  const ui = Object.assign({}, STRINGS.en, STRINGS[cfg.lang], cfg.ui)
  const oauthCfg = Object.assign({ clientName: 'MCP Inspector Web', clientMetadataUrl: null }, cfg.oauth)
  const P = cfg.storagePrefix
  root.classList.add('mcpi')
  const TABS = [['tools', 'Tools'], ['prompts', 'Prompts'], ['resources', 'Resources'], ['history', 'History']]

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class') e.className = v
      else if (k === 'text') e.textContent = v
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
      else e.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid)
    return e
  }

  function explain(e, oauth) {
    if (e && e.name === 'AbortError') return 'Cancelled'
    if (oauth && isNetError(e)) return ui.failOauth
    if (/dynamic client registration/i.test(String((e && e.message) || e))) return ui.failDcr
    if (isNetError(e)) return ui.failCors
    if (isAuthError(e)) return ui.failAuth
    return String((e && e.message) || e)
  }

  /*
   * OAuth sign-in. The redirect target is this page itself, so there is no separate callback page.
   * Tokens live in sessionStorage and go when the tab closes. The dynamically registered client and the values that
   * only matter during the round trip (which server, the PKCE verifier) live in localStorage: when sign-in ends in a new
   * tab or window (a mail link, an SSO popup) the returning tab must still find them. They are removed on return.
   * The server's OAuth endpoints (metadata, registration, token) must allow browser requests (CORS).
   */
  const PENDING = P + ':oauth'
  const redirectUrl = location.origin + location.pathname
  const jget = (store, k) => { try { return JSON.parse(store.getItem(k)) || undefined } catch (e) { return undefined } }
  const jset = (store, k, v) => { try { store.setItem(k, JSON.stringify(v)) } catch (e) { /* ignore */ } }
  function oauthProvider(server) {
    const k = (name) => P + ':' + name + ':' + server.url
    return {
      get redirectUrl() { return redirectUrl },
      /* A client metadata document offered as client_id (options.oauth.clientMetadataUrl). Servers that accept it skip dynamic registration. Its redirect_uris must match this page, so it is set per origin. */
      get clientMetadataUrl() { return clientMetadataFor(oauthCfg.clientMetadataUrl, location.origin) },
      get clientMetadata() {
        return { client_name: oauthCfg.clientName, client_uri: location.origin, redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }
      },
      clientInformation: () => jget(localStorage, k('client')),
      saveClientInformation: (v) => jset(localStorage, k('client'), v),
      tokens: () => jget(sessionStorage, k('tokens')),
      saveTokens: (v) => jset(sessionStorage, k('tokens'), v),
      saveCodeVerifier: (v) => jset(localStorage, k('verifier'), v),
      codeVerifier: () => jget(localStorage, k('verifier')) || jget(sessionStorage, k('verifier')) || '',
      redirectToAuthorization(url) {
        jset(localStorage, PENDING, { url: server.url, name: server.name, key: server.key, at: Date.now() })
        location.assign(String(url))
      },
    }
  }
  const hasTokens = (server) => !!jget(sessionStorage, P + ':tokens:' + server.url)

  function partsOf(result) {
    if (result && Array.isArray(result.content)) return result.content
    if (result && Array.isArray(result.contents)) return result.contents
    if (result && Array.isArray(result.messages)) return result.messages.map((m) => Object.assign({ role: m.role }, m.content))
    return null
  }

  function linkify(pre, text) {
    let last = 0
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      const url = m[0].replace(/[.,;:]+$/, '')
      pre.append(text.slice(last, m.index), h('a', { href: url, rel: 'noopener', target: '_blank', text: url }))
      last = m.index + url.length
    }
    pre.append(text.slice(last))
  }

  function renderParts(box, result) {
    box.replaceChildren()
    const parts = partsOf(result)
    if (!parts) { box.append(h('pre', { text: JSON.stringify(result, null, 2) })); return }
    for (const p of parts) {
      const text = p.text != null ? p.text : p.resource && p.resource.text != null ? p.resource.text : null
      if (p.role) box.append(h('p', { class: 'mcpi-role', text: p.role }))
      if (p.type === 'image' && p.data) box.append(h('img', { src: 'data:' + (p.mimeType || 'image/png') + ';base64,' + p.data, alt: '' }))
      else if (text != null) {
        const pre = h('pre')
        let shown = text
        try { shown = JSON.stringify(JSON.parse(text), null, 2) } catch (e) { /* plain text */ }
        linkify(pre, shown)
        box.append(pre)
      } else box.append(h('pre', { text: JSON.stringify(p, null, 2) }))
    }
    if (result && result.structuredContent && !parts.length) box.append(h('pre', { text: JSON.stringify(result.structuredContent, null, 2) }))
  }

  /* Required fields carry a 'required' tag. When one is empty, Run does not send and points at it. A required select starts empty too (no first value filled in silently). */
  function field(name, prop, required) {
    const kind = kindOf(prop)
    const id = 'mcpi-f-' + name
    let input
    const blank = h('option', { value: '', text: required ? ui.pick : '' })
    if (kind === 'enum') input = h('select', { id }, blank, prop.enum.map((v) => h('option', { value: String(v), text: String(v) })))
    else if (kind === 'bool') input = h('select', { id }, blank, h('option', { value: 'true', text: 'true' }), h('option', { value: 'false', text: 'false' }))
    else if (kind === 'json') input = h('textarea', { id, rows: 3, spellcheck: 'false', placeholder: 'JSON' })
    else input = h('input', { id, type: 'text', inputmode: kind === 'num' ? 'decimal' : null, autocomplete: 'off', spellcheck: 'false', placeholder: kind === 'list' ? 'a, b, c' : kind === 'num' ? '0' : null })
    if (required) input.setAttribute('aria-required', 'true')
    const msg = h('p', { class: 'mcpi-field-err', hidden: true })
    const set = (v) => {
      if (v == null) input.value = ''
      else if (kind === 'list') input.value = [].concat(v).join(', ')
      else if (kind === 'json') input.value = JSON.stringify(v, null, 2)
      else input.value = String(v)
      flag('')
    }
    const flag = (text) => { msg.textContent = text; msg.hidden = !text; el.classList.toggle('is-bad', !!text); input.setAttribute('aria-invalid', text ? 'true' : 'false') }
    const el = h('div', { class: 'mcpi-field' + (required ? ' is-req' : '') },
      h('label', { for: id }, h('span', { text: name }), required ? h('b', { class: 'mcpi-req', text: ui.required }) : null, h('small', { text: kind === 'list' ? 'array' : kind === 'num' ? 'number' : kind === 'bool' ? 'boolean' : kind === 'json' ? 'json' : kind === 'enum' ? 'enum' : 'string' })),
      h('div', null, input, msg, prop.description ? h('p', { class: 'mcpi-hint', text: prop.description }) : null))
    /* Defaults go in after el exists (set touches el; doing it earlier left tools with defaults unrendered). */
    if (prop.default !== undefined) set(prop.default)
    input.addEventListener('input', () => flag(''))
    input.addEventListener('change', () => flag(''))
    return { name, el, set, input, required, flag, main: required || kind === 'enum', read: () => parseValue(kind, input.value, prop) }
  }

  function form(schema) {
    const props = (schema && schema.properties) || {}
    const req = new Set((schema && schema.required) || [])
    const fields = Object.entries(props).map(([name, prop]) => field(name, prop || {}, req.has(name)))
    let shown = fields.filter((f) => f.main)
    for (const f of fields) if (shown.length < 4 && !shown.includes(f)) shown.push(f)
    shown = fields.filter((f) => shown.includes(f))
    const rest = fields.filter((f) => !shown.includes(f))
    const more = rest.length ? h('details', { class: 'mcpi-more' }, h('summary', { text: ui.moreParams.replace('{v}', rest.length) }), rest.map((f) => f.el)) : null
    return {
      fields,
      el: fields.length ? h('div', { class: 'mcpi-form' }, req.size ? h('p', { class: 'mcpi-req-note' }, h('b', { class: 'mcpi-req', text: ui.required }), ' ' + ui.requiredNote) : null, shown.map((f) => f.el), more) : null,
      /* Collects values. Empty or malformed fields are flagged and null is returned. */
      check() {
        const out = {}
        const bad = []
        for (const f of fields) {
          const r = f.read()
          if (r.error) { f.flag(r.error === 'num' ? ui.badNum : ui.badJson); bad.push(f) }
          else if (r.value !== undefined) out[f.name] = r.value
        }
        for (const name of missingRequired(schema, out)) { const f = fields.find((x) => x.name === name); if (f && !bad.includes(f)) { f.flag(ui.missing); bad.push(f) } }
        if (!bad.length) return out
        if (more && bad.some((f) => rest.includes(f))) more.open = true
        bad[0].input.focus()
        return null
      },
      values() { const v = this.check(); if (!v) throw new Error('invalid'); return v },
      set(args) {
        for (const f of fields) f.set(args ? args[f.name] : undefined)
        if (more) more.open = !!args && rest.some((f) => args[f.name] != null)
      },
    }
  }

  function output() {
    const body = h('div', { class: 'mcpi-res', tabindex: '0' })
    const note = h('span')
    const toggle = h('button', { type: 'button', class: 'mcpi-json', text: 'JSON', 'aria-pressed': 'false' })
    const el = h('div', { class: 'mcpi-out', hidden: true }, h('div', { class: 'mcpi-out-bar' }, note, toggle), body)
    let cur = null
    const paint = () => {
      const json = toggle.getAttribute('aria-pressed') === 'true'
      if (cur.error) body.replaceChildren(h('pre', { text: json && cur.rpc ? JSON.stringify(cur.rpc, null, 2) : cur.error }))
      else if (json) body.replaceChildren(h('pre', { text: JSON.stringify(cur.result, null, 2) }))
      else renderParts(body, cur.result)
      body.classList.toggle('is-err', !!(cur.error || (cur.result && cur.result.isError)))
    }
    toggle.addEventListener('click', () => { toggle.setAttribute('aria-pressed', toggle.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); if (cur) paint() })
    return {
      el,
      show(o) { cur = o; el.hidden = false; note.textContent = o.ms != null ? o.ms + ' ms' : ''; paint(); body.scrollTop = 0; if (o.reveal) el.scrollIntoView({ block: 'nearest' }) },
      busy() { el.hidden = false; note.textContent = ui.asking },
      progress(p) { note.textContent = ui.asking + ' ' + (p.total ? p.progress + ' / ' + p.total : p.progress) + (p.message ? ' · ' + p.message : '') },
    }
  }

  /* Servers: pinned (options.servers) + added by address (mine) + recently viewed (recent). The last two keep CAP each in this browser. */
  const stored = loadStore(localStorage, P)
  const fromStore = (kind) => (x) => Object.assign({}, x, { key: x.url, custom: true, kind })
  let servers = cfg.servers.map((s) => Object.assign({ custom: false }, s)).concat(stored.mine.map(fromStore('mine')), stored.recent.map(fromStore('recent')))
  const ofKind = (kind) => servers.filter((s) => s.kind === kind)
  const save = () => saveStore(localStorage, { mine: ofKind('mine'), recent: ofKind('recent') }, P)
  const hooks = {
    onLog: (c) => logChanged(c), onListsChanged: (c) => listsChanged(c), onElicit: (c, params) => elicit(c, params),
    authProvider: (server) => oauthProvider(server), hasTokens: (server) => hasTokens(server), explain, clientInfo: cfg.clientInfo,
  }
  const newConn = (server) => new Conn(server, hooks)
  const conns = {}
  const data = {}
  let current = null
  let tab = 'tools'
  let token = 0

  const el = {
    servers: h('div', { class: 'mcpi-servers' }),
    name: h('h2'),
    url: h('code'),
    status: h('span', { class: 'mcpi-status' }),
    info: h('p', { class: 'mcpi-info' }),
    instr: h('details', { class: 'mcpi-instr', hidden: true }, h('summary', { text: 'Instructions' }), h('pre')),
    tabs: h('div', { class: 'mcpi-tabs', role: 'tablist' }),
    list: h('nav', { class: 'mcpi-list' }),
    select: h('select', { class: 'mcpi-select', 'aria-label': 'Items' }),
    pane: h('section', { class: 'mcpi-pane' }),
    asks: h('div', { class: 'mcpi-asks' }),
    auth: h('div', { class: 'mcpi-auth', hidden: true }),
    level: h('select', { class: 'mcpi-level', 'aria-label': 'Logging level', hidden: true }, ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'].map((v) => h('option', { value: v, text: 'log: ' + v, selected: v === 'info' }))),
  }

  const conn = () => conns[current.key]
  const snap = () => data[current.key]

  /* While a request runs, Cancel stands next to the button. It makes the SDK send notifications/cancelled. */
  async function call(out, btn, method, params) {
    btn.disabled = true
    out.busy()
    const c = conn()
    const ac = new AbortController()
    const stop = h('button', { type: 'button', class: 'mcpi-btn', text: 'Cancel', onclick: () => ac.abort() })
    btn.after(stop)
    try {
      if (c.state !== 'connected') await connect(current, true)
      const result = await c.send(method, params, { signal: ac.signal, onprogress: (p) => out.progress(p), resetTimeoutOnProgress: true })
      out.show({ result, ms: c.lastMs, reveal: true })
    } catch (e) {
      out.show({ error: ac.signal.aborted ? 'Cancelled' : c.state === 'failed' ? c.error : explain(e), reveal: true })
    }
    stop.remove()
    btn.disabled = false
    renderHead()
  }

  /* When the server declares completions, inputs get suggestions (prompt arguments, resource template variables). */
  function completer(f, ref) {
    const c = conn()
    const caps = (snap() && snap().info && snap().info.capabilities) || {}
    if (!caps.completions || f.input.tagName !== 'INPUT') return
    const list = h('datalist', { id: f.input.id + '-list' })
    f.input.setAttribute('list', list.id)
    f.input.after(list)
    let timer = 0
    let seq = 0
    f.input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const mine = ++seq
        try {
          const r = await c.send('completion/complete', { ref, argument: { name: f.name, value: f.input.value } })
          if (mine === seq) list.replaceChildren(...((r.completion && r.completion.values) || []).map((v) => h('option', { value: v })))
        } catch (e) { /* no suggestions */ }
      }, 250)
    })
  }

  function intro(name, title, text) {
    const p = text ? h('p', { class: 'mcpi-desc is-clamped', text, title: ui.more }) : null
    if (p) p.addEventListener('click', () => p.classList.remove('is-clamped'))
    return [h('h3', null, h('code', { text: name }), title && title !== name ? h('span', { text: title }) : null), p]
  }

  function toolPane(tool) {
    const f = form(tool.inputSchema)
    const out = output()
    const run = h('button', { type: 'button', class: 'mcpi-run', text: 'Run' })
    run.addEventListener('click', () => {
      const args = f.check()
      if (!args) return
      call(out, run, 'tools/call', { name: tool.name, arguments: args })
    })
    /* Examples only fill in values. The answer comes from the server on Run (no stored answers are shown). */
    const chips = (cfg.servers.find((x) => x.key === current.key) || {}).examples || []
    const mine = chips.filter((x) => x.tool === tool.name).map((ex) => h('button', {
      type: 'button', class: 'mcpi-chip', text: typeof ex.label === 'string' ? ex.label : ex.label[cfg.lang] || ex.label.en, title: JSON.stringify(ex.args),
      onclick: (e) => {
        for (const c of e.currentTarget.parentNode.querySelectorAll('.mcpi-chip')) c.classList.toggle('is-on', c === e.currentTarget)
        f.set(ex.args)
      },
    }))
    const hints = tool.annotations || {}
    const tags = [hints.readOnlyHint && 'read-only', hints.destructiveHint && 'destructive', hints.openWorldHint && 'open-world'].filter(Boolean)
    return {
      pane: h('div', { class: 'mcpi-item' }, intro(tool.name, tool.title || hints.title, tool.description),
        tags.length ? h('p', { class: 'mcpi-tags' }, tags.map((t) => h('span', { text: t }))) : null,
        mine.length ? h('div', { class: 'mcpi-examples' }, h('span', { class: 'mcpi-examples-label', text: ui.examples }), mine) : null, f.el, h('div', { class: 'mcpi-actions' }, run), out.el),
    }
  }

  function promptPane(p) {
    const schema = { properties: {}, required: [] }
    for (const a of p.arguments || []) {
      schema.properties[a.name] = { type: 'string', description: a.description }
      if (a.required) schema.required.push(a.name)
    }
    const f = form(schema)
    for (const x of f.fields) completer(x, { type: 'ref/prompt', name: p.name })
    const out = output()
    const run = h('button', { type: 'button', class: 'mcpi-run', text: 'Get' })
    run.addEventListener('click', () => { const args = f.check(); if (args) call(out, run, 'prompts/get', { name: p.name, arguments: args }) })
    return { pane: h('div', { class: 'mcpi-item' }, intro(p.name, p.title, p.description), f.el, h('div', { class: 'mcpi-actions' }, run), out.el) }
  }

  function resourcePane(r) {
    const out = output()
    const run = h('button', { type: 'button', class: 'mcpi-run', text: 'Read' })
    const c = conn()
    const caps = (snap() && snap().info && snap().info.capabilities) || {}
    let formEl = null
    let sub = null
    if (r.uriTemplate) {
      const vars = [...r.uriTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
      const simple = vars.length && vars.every((v) => /^[\w.-]+$/.test(v))
      if (simple) {
        const f = form({ properties: Object.fromEntries(vars.map((v) => [v, { type: 'string' }])), required: vars })
        for (const x of f.fields) completer(x, { type: 'ref/resource', uri: r.uriTemplate })
        formEl = f.el
        run.addEventListener('click', () => {
          const vals = f.check()
          if (!vals) return
          call(out, run, 'resources/read', { uri: r.uriTemplate.replace(/\{([^}]+)\}/g, (_, v) => encodeURIComponent(vals[v] == null ? '' : vals[v])) })
        })
      } else {
        const uri = h('input', { type: 'text', value: r.uriTemplate, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'URI' })
        formEl = h('div', { class: 'mcpi-form' }, h('div', { class: 'mcpi-field' }, h('label', { text: 'uri' }), h('div', null, uri)))
        run.addEventListener('click', () => call(out, run, 'resources/read', { uri: uri.value.trim() }))
      }
    } else {
      run.addEventListener('click', () => call(out, run, 'resources/read', { uri: r.uri }))
      if (caps.resources && caps.resources.subscribe) {
        sub = h('button', { type: 'button', class: 'mcpi-btn', text: c.subs.has(r.uri) ? 'Unsubscribe' : 'Subscribe', 'aria-pressed': c.subs.has(r.uri) ? 'true' : 'false' })
        sub.addEventListener('click', async () => {
          sub.disabled = true
          try {
            if (c.state !== 'connected') await connect(current, true)
            await c.send(c.subs.has(r.uri) ? 'resources/unsubscribe' : 'resources/subscribe', { uri: r.uri })
          } catch (e) { out.show({ error: explain(e) }) }
          sub.disabled = false
          sub.textContent = c.subs.has(r.uri) ? 'Unsubscribe' : 'Subscribe'
          sub.setAttribute('aria-pressed', c.subs.has(r.uri) ? 'true' : 'false')
        })
      }
    }
    return {
      pane: h('div', { class: 'mcpi-item' }, intro(r.uri || r.uriTemplate, r.title || r.name, r.description),
        r.mimeType ? h('p', { class: 'mcpi-tags' }, h('span', { text: r.mimeType })) : null,
        formEl, h('div', { class: 'mcpi-actions' }, run, sub), out.el),
    }
  }

  function historyPane() {
    const c = conn()
    if (!c.log.length) return h('p', { class: 'mcpi-empty', text: ui.historyEmpty })
    return h('div', { class: 'mcpi-history' }, c.log.map((e) => {
      const bad = e.error || (e.response && e.response.error)
      return h('details', { class: bad ? 'is-err' : null },
        h('summary', null, h('i', { text: e.dir === 'in' ? '←' : '→' }), h('code', { text: e.method }), h('span', { text: e.at.toLocaleTimeString() }), h('span', { text: e.ms != null ? e.ms + ' ms' : '' })),
        h('pre', { text: JSON.stringify(e.request, null, 2) }),
        e.response ? h('pre', { text: JSON.stringify(e.response, null, 2) }) : null)
    }))
  }

  function logChanged(c) {
    if (!current || conns[current.key] !== c) return
    if (tab === 'history') { c.unseen = 0; el.pane.replaceChildren(historyPane()) }
    else if (el.tabs.firstChild) renderTabs()
  }

  /* When the server says a list changed, fetch it again and keep the item that was open. */
  async function listsChanged(c) {
    if (!c.client) return
    try {
      const lists = await c.lists(c.client)
      data[c.server.key] = Object.assign({}, data[c.server.key], lists)
      if (current && conns[current.key] === c && tab !== 'history') selectTab(tab, el.pane.dataset.item)
    } catch (e) { /* keep the old lists */ }
  }

  /* When the server asks for input (elicitation/create), a form appears near the top and a person answers. */
  function elicit(c, params) {
    return new Promise((resolve) => {
      if (params.mode === 'url') { resolve({ action: 'decline' }); return }
      const f = form(params.requestedSchema)
      const done = (result) => { box.remove(); resolve(result) }
      const box = h('div', { class: 'mcpi-ask', role: 'group', 'aria-label': 'Elicitation' },
        h('p', { class: 'mcpi-label', text: 'Elicitation · ' + c.server.name }),
        h('p', { class: 'mcpi-ask-msg', text: params.message || ui.elicit }),
        f.el,
        h('div', { class: 'mcpi-actions' },
          h('button', { type: 'button', class: 'mcpi-run', text: 'Accept', onclick: () => { let content; try { content = f.values() } catch (e) { return } done({ action: 'accept', content }) } }),
          h('button', { type: 'button', class: 'mcpi-btn', text: 'Decline', onclick: () => done({ action: 'decline' }) }),
          h('button', { type: 'button', class: 'mcpi-btn', text: 'Cancel', onclick: () => done({ action: 'cancel' }) })))
      el.asks.append(box)
      box.scrollIntoView({ block: 'nearest' })
    })
  }

  const MAKE = { tools: toolPane, prompts: promptPane, resources: resourcePane }
  const itemsOf = (key) => {
    const s = snap()
    if (!s) return []
    return key === 'resources' ? (s.resources || []).concat(s.templates || []) : s[key] || []
  }
  const nameOf = (x) => x.name || x.uri || x.uriTemplate

  function renderTabs() {
    el.tabs.replaceChildren(...TABS.map(([k, label]) => h('button', {
      type: 'button', class: 'mcpi-tab' + (k === tab ? ' is-on' : ''), role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => selectTab(k),
    }, label, k === 'history' ? (conn() && conn().unseen ? h('i', { class: 'is-new', text: conn().unseen }) : null) : h('i', { text: itemsOf(k).length }))))
  }

  function selectTab(key, keep) {
    tab = key
    renderTabs()
    const body = el.pane.parentNode
    body.classList.toggle('is-wide', key === 'history')
    if (key === 'history') { conn().unseen = 0; renderTabs(); el.list.replaceChildren(); el.select.replaceChildren(); el.pane.replaceChildren(historyPane()); return }
    const all = itemsOf(key)
    if (!all.length) {
      body.classList.add('is-wide')
      el.list.replaceChildren()
      el.select.replaceChildren()
      const c = conn()
      el.pane.replaceChildren(h('p', { class: 'mcpi-empty' + (c.state === 'failed' ? ' is-err' : ''), text: c.state === 'failed' ? c.error : c.state === 'connecting' ? ui.connecting : ui.empty }))
      return
    }
    const wanted = keep != null ? all.findIndex((x) => nameOf(x) === keep) : -1
    const pick = (i) => {
      ;[...el.list.children].forEach((b, n) => b.classList.toggle('is-on', n === i))
      el.select.selectedIndex = i
      el.pane.dataset.item = nameOf(all[i])
      const made = MAKE[key](all[i])
      el.pane.replaceChildren(made.pane)
      el.pane.scrollTop = 0
    }
    el.list.replaceChildren(...all.map((item, i) => h('button', { type: 'button', class: 'mcpi-pick', text: nameOf(item), onclick: () => pick(i) })))
    el.select.replaceChildren(...all.map((item) => h('option', { text: nameOf(item) })))
    el.select.onchange = () => pick(el.select.selectedIndex)
    pick(wanted >= 0 ? wanted : 0)
  }

  function renderHead() {
    if (!current) return
    main.hidden = false
    const c = conn()
    const s = snap()
    el.name.textContent = current.name
    el.url.textContent = current.url
    el.status.textContent = c.state === 'connected' ? 'Connected' : c.state === 'connecting' ? ui.connecting : c.state === 'failed' ? 'Failed' : 'Not connected'
    el.status.dataset.state = c.state
    const info = s && s.info
    const sv = (info && info.serverInfo) || {}
    el.info.textContent = info ? [[sv.name, sv.version].filter(Boolean).join(' '), info.protocolVersion && 'protocol ' + info.protocolVersion, Object.keys(info.capabilities || {}).join(', ')].filter(Boolean).join(' · ') : ''
    el.instr.hidden = !(info && info.instructions)
    if (info && info.instructions) { const pre = el.instr.querySelector('pre'); pre.replaceChildren(); linkify(pre, info.instructions) }
    for (const b of el.servers.querySelectorAll('.mcpi-server')) {
      b.classList.toggle('is-on', b.dataset.key === current.key)
      b.setAttribute('aria-pressed', b.dataset.key === current.key ? 'true' : 'false')
      b.dataset.state = conns[b.dataset.key] ? conns[b.dataset.key].state : 'idle'
    }
    el.level.hidden = !(c.state === 'connected' && info && info.capabilities && info.capabilities.logging)
    /* A server that once asked for authentication keeps its OAuth button (if it vanished after a failed OAuth, nobody would know what happened). */
    if (c.needAuth) current.wantsAuth = true
    const wants = c.needAuth || current.wantsAuth
    el.auth.hidden = !(current.custom && (wants || c.state === 'failed' || current.headers))
    signIn.hidden = !wants
    authNote.textContent = c.state !== 'failed' ? '' : c.needAuth ? ui.failAuth : wants ? c.error : ''
    if (document.activeElement !== tName && document.activeElement !== tValue) {
      const hd = Object.entries(current.headers || {})[0]
      tName.value = hd ? hd[0] : current.hint || 'Authorization'
      tValue.value = hd ? hd[1] : ''
    }
  }

  const main = h('div', { class: 'mcpi-main', hidden: true })

  async function connect(server, quiet, opts) {
    const c = conns[server.key]
    const mine = ++token
    c.state = 'connecting'
    if (current === server) renderHead()
    try {
      const live = await c.connect(opts)
      const old = data[server.key] || {}
      data[server.key] = Object.assign({}, old, live)
    } catch (e) {
      if (current === server) { renderHead(); if (!quiet && !itemsOf(tab).length) selectTab(tab) }
      throw e
    }
    if (current === server) {
      renderHead()
      if (!quiet || mine !== token) return
    }
  }

  async function select(server) {
    current = server
    if (!conns[server.key]) conns[server.key] = newConn(server)
    const q = server.custom ? '?url=' + encodeURIComponent(server.url) : '?server=' + encodeURIComponent(server.key)
    if (cfg.syncUrl) { try { history.replaceState(null, '', location.pathname + q) } catch (e) { /* ignore */ } }
    renderHead()
    if (current !== server) return
    renderHead()
    selectTab('tools')
    if (conns[server.key].state === 'idle' || conns[server.key].state === 'failed') {
      const had = itemsOf('tools').length
      try {
        await connect(server, true)
        if (current === server) { renderHead(); if (!had) selectTab('tools'); else renderTabs() }
      } catch (e) {
        if (current === server && !had) selectTab(tab)
      }
    }
  }

  /* Servers are laid out as cards. Pressing one opens its inspector below. */
  /* Icons: try the candidates in order, and fall back to the first letter of the name. */
  function iconOf(s) {
    const box = h('span', { class: 'mcpi-ico', 'aria-hidden': 'true' })
    const list = s.custom === false && s.icon ? [s.icon] : iconCandidates(s)
    let i = 0
    const next = () => {
      if (i >= list.length) { box.classList.add('is-none'); box.replaceChildren(String(s.name || '?').trim().charAt(0).toUpperCase()); return }
      const img = h('img', { src: list[i++], alt: '', width: '28', height: '28', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
      img.addEventListener('error', next)
      img.addEventListener('load', () => { if (img.naturalWidth < 8) next() })
      box.replaceChildren(img)
    }
    next()
    return box
  }
  function cardBody(s, sub) {
    return [h('span', { class: 'mcpi-card-head' }, iconOf(s), h('span', { class: 'mcpi-card-name' }, h('b', { text: s.name }), h('span', { class: 'mcpi-card-host', text: sub || hostOf(s.url) }))),
      s.desc ? h('span', { class: 'mcpi-card-desc', text: s.desc }) : null]
  }
  function cardOf(s) {
    const meta = countsText(s.counts)
    return h('div', { class: 'mcpi-card-wrap' },
      h('button', { type: 'button', class: 'mcpi-server mcpi-card', 'data-key': s.key, 'aria-pressed': 'false', onclick: () => open(s) },
        cardBody(s), meta ? h('span', { class: 'mcpi-card-meta', text: meta }) : null),
      s.custom ? h('button', { type: 'button', class: 'mcpi-remove', 'aria-label': ui.remove, title: ui.remove, text: '×', onclick: () => remove(s) }) : null)
  }
  function renderServers() {
    const group = (label, list, extra) => [h('p', { class: 'mcpi-label' }, label, list.length && list[0].custom ? h('span', { text: ' ' + list.length + ' / ' + CAP }) : null), extra, list.length ? h('div', { class: 'mcpi-cards' }, list.map(cardOf)) : null]
    const recent = ofKind('recent')
    el.servers.replaceChildren(...[
      ...(servers.some((s) => !s.custom) ? group(ui.ours, servers.filter((s) => !s.custom)) : []),
      ...group(ui.mine, ofKind('mine'), addForm),
      ...(recent.length ? group(ui.recent, recent) : [])].filter(Boolean))
    if (current) renderHead()
  }
  function reveal(always, instant) {
    const top = main.getBoundingClientRect().top
    if (!always && top < window.innerHeight * 0.55) return
    main.scrollIntoView({ block: 'start', behavior: instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  /*
   * Arriving with ?server= or ?url= scrolls to the inspector. When the cards above (the registry list) fill in late, the inspector is
   * pushed down and the view stops halfway (seen in iPhone Safari). If the person has not scrolled meanwhile, align once more after they fill in.
   */
  function revealOnArrival(ready) {
    let moved = false
    const stop = () => { moved = true }
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.addEventListener(ev, stop, { once: true, passive: true })
    reveal(true, true)
    Promise.resolve(ready).catch(() => {}).then(() => requestAnimationFrame(() => { if (!moved && current) reveal(true, true) }))
  }
  function open(s) { select(s); reveal(true) }

  function remove(s) {
    /* Close it first if it is open. Drawing after the connection was removed made renderHead read a missing connection. */
    if (current === s) {
      current = null
      main.hidden = true
      try { history.replaceState(null, '', location.pathname) } catch (e) { /* ignore */ }
    }
    if (conns[s.key]) conns[s.key].close()
    delete conns[s.key]
    delete data[s.key]
    servers = servers.filter((x) => x !== s)
    save()
    renderServers()
  }

  /*
   * Adds a server to the list and saves it. kind is 'mine' (added by address) or 'recent' (opened from the registry).
   * An existing address returns that server (pinned and added servers never move down to recent). Past CAP the oldest drop off.
   */
  function add(url, kind, meta) {
    const clean = cleanUrl(url)
    if (!clean) return null
    const had = servers.find((x) => x.url === clean)
    if (had && (!had.custom || (had.kind === 'mine' && kind === 'recent'))) return had
    const obj = Object.assign(had || { key: clean, custom: true }, filled(meta), { url: clean, kind })
    if (!obj.name) obj.name = hostOf(clean)
    const others = servers.filter((x) => x !== obj)
    const same = others.filter((x) => x.kind === kind)
    const kept = pushFront(same, obj, CAP)
    for (const x of same) if (!kept.includes(x)) { if (conns[x.key]) conns[x.key].close(); delete conns[x.key]; delete data[x.key] }
    const by = (k) => (k === kind ? kept : others.filter((x) => x.kind === k))
    servers = others.filter((x) => !x.custom).concat(by('mine'), by('recent'))
    if (current && !servers.includes(current)) { current = null; main.hidden = true }
    save()
    renderServers()
    return obj
  }

  const urlInput = h('input', { type: 'url', name: 'url', placeholder: 'https://example.com/mcp', required: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Server URL' })
  const hName = h('input', { type: 'text', value: 'Authorization', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header name' })
  const hValue = h('input', { type: 'text', placeholder: 'Bearer <token>', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header value' })
  /* Authentication is chosen when adding: none, header token or OAuth (PKCE). With OAuth the authorization page opens right away (a server that needs no auth just connects). */
  const authPick = h('select', { class: 'mcpi-add-auth', 'aria-label': 'Authentication' },
    h('option', { value: 'none', text: ui.authNone }), h('option', { value: 'header', text: ui.token }), h('option', { value: 'oauth', text: 'OAuth (PKCE)' }))
  /* Labels sit above inputs. A placeholder alone disappears as soon as you type. */
  const labeled = (label, input) => h('label', { class: 'mcpi-lab' }, h('span', { text: label }), input)
  const headerRow = h('div', { class: 'mcpi-add-header', hidden: true }, labeled(ui.hName, hName), labeled(ui.hValue, hValue))
  const addHint = h('p', { class: 'mcpi-hint is-shown', hidden: true, text: ui.addHint })
  authPick.addEventListener('change', () => { headerRow.hidden = authPick.value !== 'header'; addHint.hidden = authPick.value !== 'oauth' })
  const addForm = h('form', { class: 'mcpi-add' },
    urlInput,
    h('button', { type: 'submit', class: 'mcpi-run', text: 'Add' }),
    h('details', null, h('summary', { text: ui.authLabel }), h('div', { class: 'mcpi-add-row' }, authPick, headerRow), addHint))
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const mode = authPick.value
    const headers = mode === 'header' && hName.value.trim() && hValue.value.trim() ? { [hName.value.trim()]: hValue.value.trim() } : null
    const s = add(urlInput.value, 'mine', { headers })
    if (!s) { urlInput.focus(); return }
    urlInput.value = ''
    hName.value = 'Authorization'
    hValue.value = ''
    authPick.value = 'none'
    headerRow.hidden = true
    addHint.hidden = true
    if (conns[s.key]) { conns[s.key].close(); conns[s.key].server = s }
    if (mode === 'oauth') s.wantsAuth = true
    const done = select(s)
    reveal(true)
    await done
    if (mode === 'oauth' && current === s && conns[s.key] && conns[s.key].needAuth) reopen(s, { oauth: true })
  })

  const regInput = h('input', { type: 'search', placeholder: ui.regSearch, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'MCP Registry' })
  const regList = h('div', { class: 'mcpi-cards mcpi-reg-list' })
  const regMore = h('button', { type: 'button', class: 'mcpi-btn mcpi-reg-more', text: ui.regMore, hidden: true })
  regMore.addEventListener('click', () => { for (const r of regList.querySelectorAll('[hidden]')) r.hidden = false; regMore.hidden = true })
  const regNote = h('span')
  let regTimer = 0
  let regSeq = 0
  let filter = cfg.featured ? 'known' : 'recent'
  /*
   * The registry has no popularity order (its query parameters are only search, updated_since, cursor, limit and version).
   * So 'Well known' and 'No auth needed' come from a prepared list (options.featured, see scripts/featured.js),
   * while 'Recently updated' and search ask the registry live, when pressed.
   */
  let featured = null
  async function featuredList() {
    if (!featured) featured = typeof cfg.featured === 'string' ? await (await fetch(cfg.featured)).json() : cfg.featured
    return featured
  }
  let recentReg = null
  async function recentServers() {
    if (recentReg) return recentReg
    const since = new Date(Date.now() - 2 * 86400000).toISOString()
    const all = []
    let cursor = ''
    for (let i = 0; i < 3; i++) {
      const json = await (await fetch(cfg.registry + '?version=latest&limit=100&updated_since=' + encodeURIComponent(since) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))).json()
      all.push(...(json.servers || []))
      cursor = json.metadata && json.metadata.nextCursor
      if (!cursor) break
    }
    const when = (x) => ((x._meta || {})['io.modelcontextprotocol.registry/official'] || {}).updatedAt || ''
    recentReg = registryCards(all.sort((a, b) => (when(a) < when(b) ? 1 : -1)))
    return recentReg
  }
  const chips = h('div', { class: 'mcpi-filters', role: 'group', 'aria-label': 'MCP Registry' }, [['known', ui.fKnown], ['open', ui.fOpen], ['recent', ui.fRecent]].filter(([k]) => cfg.featured || k === 'recent').map(([k, label]) =>
    h('button', { type: 'button', class: 'mcpi-chip', 'data-filter': k, 'aria-pressed': 'false', text: label, onclick: () => { filter = k; regInput.value = ''; searchRegistry() } })))

  async function searchRegistry() {
    const q = regInput.value.trim()
    const searching = q.length >= 2
    const mine = ++regSeq
    for (const b of chips.children) { const on = !searching && b.dataset.filter === filter; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false') }
    regNote.textContent = searching ? '' : filter === 'recent' ? ui.regRecent : ui.regKnown
    regMore.hidden = true
    regList.replaceChildren(h('p', { class: 'mcpi-hint is-shown', text: ui.asking }))
    let cards = []
    try {
      if (searching) cards = registryCards((await (await fetch(cfg.registry + '?version=latest&limit=40&search=' + encodeURIComponent(q))).json()).servers)
      else if (filter === 'recent') cards = await recentServers()
      else cards = featuredFor(filter, await featuredList())
    } catch (e) {
      if (mine === regSeq) regList.replaceChildren(h('p', { class: 'mcpi-hint is-shown', text: ui.fail }))
      return
    }
    if (mine !== regSeq) return
    const rows = cards.map((c, i) => h('button', { type: 'button', class: 'mcpi-card mcpi-reg', hidden: i >= REG_FIRST,
      onclick: () => open(add(c.url, 'recent', { name: c.name, desc: c.desc, icon: c.icon, web: c.web, hint: c.hint })) },
      cardBody(c, c.id), c.open ? h('span', { class: 'mcpi-card-tag', text: ui.openTag }) : null))
    regList.replaceChildren(...(rows.length ? rows : [h('p', { class: 'mcpi-hint is-shown', text: ui.regEmpty })]))
    regMore.hidden = rows.length <= REG_FIRST
  }
  regInput.addEventListener('input', () => { clearTimeout(regTimer); regTimer = setTimeout(searchRegistry, 300) })

  const reconnect = h('button', { type: 'button', class: 'mcpi-btn', text: 'Reconnect' })
  reconnect.addEventListener('click', async () => {
    const s = current
    conn().close()
    try { await connect(s, true) } catch (e) { /* shown in head */ }
    if (current === s) { renderHead(); selectTab(tab === 'history' ? 'history' : tab, el.pane.dataset.item) }
  })
  const ping = h('button', { type: 'button', class: 'mcpi-btn', text: 'Ping' })
  ping.addEventListener('click', async () => {
    const c = conn()
    ping.disabled = true
    try {
      if (c.state !== 'connected') await connect(current, true)
      await c.send('ping')
      ping.textContent = 'Ping ' + c.lastMs + ' ms'
    } catch (e) { ping.textContent = 'Ping failed' }
    ping.disabled = false
    renderHead()
  })
  el.level.addEventListener('change', async () => {
    try { await conn().send('logging/setLevel', { level: el.level.value }) } catch (e) { /* shown in History */ }
  })

  /* A server that needs sign-in: put a token in a header (default), or sign in with OAuth. */
  const tName = h('input', { type: 'text', value: 'Authorization', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header name' })
  const tValue = h('input', { type: 'text', placeholder: 'Bearer <token>', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header value' })
  const authNote = h('p', { class: 'mcpi-auth-note' })
  const signIn = h('button', { type: 'button', class: 'mcpi-btn', text: ui.oauthBtn })
  const tSave = h('button', { type: 'submit', class: 'mcpi-btn', text: 'Save & reconnect' })
  const tForm = h('form', { class: 'mcpi-token' }, labeled(ui.hName, tName), labeled(ui.hValue, tValue), tSave)
  async function reopen(s, opts) {
    conn().close()
    try { await connect(s, true, opts) } catch (e) { /* shown in head */ }
    if (current === s) { renderHead(); selectTab(tab, el.pane.dataset.item) }
  }
  tForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const s = current
    s.headers = tName.value.trim() && tValue.value.trim() ? { [tName.value.trim()]: tValue.value.trim() } : null
    save()
    tValue.blur()
    reopen(s)
  })
  signIn.addEventListener('click', () => reopen(current, { oauth: true }))
  el.auth.append(authNote, h('p', { class: 'mcpi-label', text: 'OAuth' }), signIn, h('p', { class: 'mcpi-label', text: ui.token }), tForm)


  main.append(
    h('div', { class: 'mcpi-top' },
      h('div', { class: 'mcpi-id' }, el.name, el.url),
      h('div', { class: 'mcpi-top-actions' }, el.status, el.level, ping, reconnect)),
    el.info, el.auth, el.instr, el.asks, el.tabs,
    h('div', { class: 'mcpi-body' }, el.list, el.select, el.pane))
  root.replaceChildren(
    el.servers,
    ...(cfg.registry ? [h('section', { class: 'mcpi-registry' },
      h('p', { class: 'mcpi-label' }, 'MCP Registry ', regNote), h('div', { class: 'mcpi-reg-bar' }, regInput, chips), regList, regMore)] : []),
    main)
  renderServers()
  const regReady = cfg.registry ? searchRegistry() : Promise.resolve()

  const q = new URLSearchParams(location.search)
  const stale = jget(localStorage, PENDING)
  const pending = stale && Date.now() - (stale.at || 0) < 30 * 60000 ? stale : null
  if (pending && (q.get('code') || q.get('error'))) {
    try { localStorage.removeItem(PENDING) } catch (e) { /* ignore */ }
    const s = add(pending.url, 'recent', { name: pending.name })
    current = s
    conns[s.key] = conns[s.key] || newConn(s)
    try { history.replaceState(null, '', location.pathname + '?url=' + encodeURIComponent(s.url)) } catch (e) { /* ignore */ }
    s.wantsAuth = true
    renderHead()
    selectTab('tools')
    revealOnArrival(regReady)
    /* Pass back whatever returned, code or error. If the authorization server refused (error), the reason stays on screen. */
    connect(s, true, { oauth: true, callback: q }).catch(() => {}).then(() => {
      try { localStorage.removeItem(P + ':verifier:' + s.url) } catch (e) { /* ignore */ }
      if (current === s) { renderHead(); selectTab('tools') }
    })
  } else if (q.get('code') || q.get('error')) {
    /* Back from authorization with no record of starting (another browser, or over 30 minutes). Say so instead of doing nothing. */
    try { history.replaceState(null, '', location.pathname) } catch (e) { /* ignore */ }
    root.prepend(h('p', { class: 'mcpi-auth-note mcpi-notice', role: 'alert', text: ui.oauthLost }))
  } else {
    const fromUrl = q.get('url') ? add(q.get('url'), 'recent', {}) : null
    const first = fromUrl || servers.find((s) => s.key === q.get('server'))
    if (first) { const done = select(first); revealOnArrival(Promise.all([regReady, done])) }
  }
}
