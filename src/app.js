/*
 * MCP Inspector Web: an MCP client that runs entirely in the browser.
 * It connects through the official SDK (@modelcontextprotocol/client). Pinned servers come from options.servers,
 * anything else is found in the official MCP Registry or added by address.
 * Covers: Streamable HTTP, Tools, Prompts, Resources, templates, completion, Ping, server notifications,
 * resource subscriptions, cancelling a request, elicitation, header tokens and OAuth with PKCE.
 * Not covered, since this is a web page: stdio servers, servers that do not allow CORS, and the older HTTP+SSE transport.
 * Sampling and roots are not declared, and URL-mode elicitation is declined. README.md lists these with what to use instead.
 *
 * This file holds the page state (servers, connections, the open server and tab) and lays the parts out:
 *   lib.js       logic with no UI          conn.js      one connection
 *   oauth.js     OAuth storage             form.js      inputs from a JSON Schema
 *   output.js    the answer box            panes.js     tool, prompt, resource and History panes
 *   cards.js     server cards              registry.js  the MCP Registry panel
 *
 *   mount(root, options)   see README.md for every option
 */
import { Conn } from './conn.js'
import { STRINGS } from './strings.js'
import { h, linkify, labeled } from './dom.js'
import { oauthStore } from './oauth.js'
import { form } from './form.js'
import { panes } from './panes.js'
import { cardOf } from './cards.js'
import { registryPanel } from './registry.js'
import { CAP, REGISTRY, STORE_PREFIX, hostOf, cleanUrl, pushFront, filled, loadStore, saveStore, explainError } from './lib.js'

const TABS = [['tools', 'Tools'], ['prompts', 'Prompts'], ['resources', 'Resources'], ['history', 'History']]
const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

export function mount(root, options) {
  const cfg = Object.assign({ lang: 'en', servers: [], featured: null, registry: REGISTRY, storagePrefix: STORE_PREFIX, clientInfo: null, oauth: {}, syncUrl: true }, options)
  const ui = Object.assign({}, STRINGS.en, STRINGS[cfg.lang], cfg.ui)
  const P = cfg.storagePrefix
  root.classList.add('mcpi')

  const explain = (e, oauth) => explainError(e, oauth, ui)
  const auth = oauthStore({ prefix: P, oauth: cfg.oauth, local: localStorage, session: sessionStorage, page: location })
  const setQuery = (q) => { try { history.replaceState(null, '', location.pathname + q) } catch (e) { /* ignore */ } }

  /* Servers: pinned (options.servers) + added by address (mine) + recently viewed (recent). The last two keep CAP each in this browser. */
  const stored = loadStore(localStorage, P)
  const fromStore = (kind) => (x) => Object.assign({}, x, { key: x.url, custom: true, kind })
  let servers = cfg.servers.map((s) => Object.assign({ custom: false }, s)).concat(stored.mine.map(fromStore('mine')), stored.recent.map(fromStore('recent')))
  const ofKind = (kind) => servers.filter((s) => s.kind === kind)
  const save = () => saveStore(localStorage, { mine: ofKind('mine'), recent: ofKind('recent') }, P)
  const hooks = {
    onLog: (c) => logChanged(c), onListsChanged: (c) => listsChanged(c), onElicit: (c, params) => elicit(c, params),
    authProvider: (server) => auth.provider(server), hasTokens: (server) => auth.hasTokens(server), explain, clientInfo: cfg.clientInfo,
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
    level: h('select', { class: 'mcpi-level', 'aria-label': 'Logging level', hidden: true }, LEVELS.map((v) => h('option', { value: v, text: 'log: ' + v, selected: v === 'info' }))),
  }
  const main = h('div', { class: 'mcpi-main', hidden: true })

  const conn = () => conns[current.key]
  const snap = () => data[current.key]
  const pane = panes({ cfg, ui, current: () => current, conn, snap, connect, renderHead, explain })

  function logChanged(c) {
    if (!current || conns[current.key] !== c) return
    if (tab === 'history') { c.unseen = 0; el.pane.replaceChildren(pane.history()) }
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
      const f = form(params.requestedSchema, ui)
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
    if (key === 'history') { conn().unseen = 0; renderTabs(); el.list.replaceChildren(); el.select.replaceChildren(); el.pane.replaceChildren(pane.history()); return }
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
      el.pane.replaceChildren(pane[key](all[i]).pane)
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
    if (cfg.syncUrl) setQuery(server.custom ? '?url=' + encodeURIComponent(server.url) : '?server=' + encodeURIComponent(server.key))
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

  /* Reconnects the open server, with options (OAuth, a callback), and redraws what it shows. */
  async function reopen(s, opts) {
    conn().close()
    try { await connect(s, true, opts) } catch (e) { /* shown in head */ }
    if (current === s) { renderHead(); selectTab(tab, el.pane.dataset.item) }
  }

  /* Servers are laid out as cards. Pressing one opens its inspector below. */
  function renderServers() {
    const card = (s) => cardOf(s, { ui, onOpen: open, onRemove: remove })
    const group = (label, list, extra) => [h('p', { class: 'mcpi-label' }, label, list.length && list[0].custom ? h('span', { text: ' ' + list.length + ' / ' + CAP }) : null), extra, list.length ? h('div', { class: 'mcpi-cards' }, list.map(card)) : null]
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

  function forget(s) {
    if (conns[s.key]) conns[s.key].close()
    delete conns[s.key]
    delete data[s.key]
  }

  function remove(s) {
    /* Close it first if it is open. Drawing after the connection was removed made renderHead read a missing connection. */
    if (current === s) {
      current = null
      main.hidden = true
      setQuery('')
    }
    forget(s)
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
    for (const x of same) if (!kept.includes(x)) forget(x)
    const by = (k) => (k === kind ? kept : others.filter((x) => x.kind === k))
    servers = others.filter((x) => !x.custom).concat(by('mine'), by('recent'))
    if (current && !servers.includes(current)) { current = null; main.hidden = true }
    save()
    renderServers()
    return obj
  }

  /* Adding a server by address. Authentication is chosen when adding: none, header token or OAuth (PKCE). With OAuth the authorization page opens right away (a server that needs no auth just connects). */
  const urlInput = h('input', { type: 'url', name: 'url', placeholder: 'https://example.com/mcp', required: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Server URL' })
  const hName = h('input', { type: 'text', value: 'Authorization', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header name' })
  const hValue = h('input', { type: 'text', placeholder: 'Bearer <token>', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Header value' })
  const authPick = h('select', { class: 'mcpi-add-auth', 'aria-label': 'Authentication' },
    h('option', { value: 'none', text: ui.authNone }), h('option', { value: 'header', text: ui.token }), h('option', { value: 'oauth', text: 'OAuth (PKCE)' }))
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

  /* Ping, Reconnect and the logging level, next to the server name. */
  const reconnect = h('button', { type: 'button', class: 'mcpi-btn', text: 'Reconnect' })
  reconnect.addEventListener('click', () => reopen(current))
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

  const registry = cfg.registry ? registryPanel({ cfg, ui, onPick: (c) => open(add(c.url, 'recent', { name: c.name, desc: c.desc, icon: c.icon, web: c.web, hint: c.hint })) }) : null

  main.append(
    h('div', { class: 'mcpi-top' },
      h('div', { class: 'mcpi-id' }, el.name, el.url),
      h('div', { class: 'mcpi-top-actions' }, el.status, el.level, ping, reconnect)),
    el.info, el.auth, el.instr, el.asks, el.tabs,
    h('div', { class: 'mcpi-body' }, el.list, el.select, el.pane))
  root.replaceChildren(el.servers, ...(registry ? [registry.el] : []), main)
  renderServers()
  const regReady = registry ? registry.search() : Promise.resolve()

  const q = new URLSearchParams(location.search)
  const returned = q.get('code') || q.get('error')
  const pending = returned ? auth.takePending() : null
  if (pending) {
    const s = add(pending.url, 'recent', { name: pending.name })
    current = s
    conns[s.key] = conns[s.key] || newConn(s)
    setQuery('?url=' + encodeURIComponent(s.url))
    s.wantsAuth = true
    renderHead()
    selectTab('tools')
    revealOnArrival(regReady)
    /* Pass back whatever returned, code or error. If the authorization server refused (error), the reason stays on screen. */
    connect(s, true, { oauth: true, callback: q }).catch(() => {}).then(() => {
      auth.clearVerifier(s)
      if (current === s) { renderHead(); selectTab('tools') }
    })
  } else if (returned) {
    /* Back from authorization with no record of starting (another browser, or over 30 minutes). Say so instead of doing nothing. */
    setQuery('')
    root.prepend(h('p', { class: 'mcpi-auth-note mcpi-notice', role: 'alert', text: ui.oauthLost }))
  } else {
    const fromUrl = q.get('url') ? add(q.get('url'), 'recent', {}) : null
    const first = fromUrl || servers.find((s) => s.key === q.get('server'))
    if (first) { const done = select(first); revealOnArrival(Promise.all([regReady, done])) }
  }
}
