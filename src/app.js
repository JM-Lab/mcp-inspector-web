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
 *   share.js     links into the page        add-to-ai.js     add a server to an AI client (stands alone)
 *   trace.js     what a connection did      debug.js     draws it: the Debug tab and the failure notice (stands alone)
 *
 *   mount(root, options)   see README.md for every option; returns { destroy() }
 */
import { Conn } from './conn.js'
import { STRINGS } from './strings.js'
import { rowEnd, h, linkify, labeled, secretField, infoNote } from './dom.js'
import { lineIcon } from './icons.js'
import { oauthStore } from './oauth.js'
import { form } from './form.js'
import { panes } from './panes.js'
import { cardOf, shareBox } from './cards.js'
import { registryPanel } from './registry.js'
import { linkOf, readLink, registryEntry, mergeQuery, handoffStore } from './share.js'
import { openAddToAi } from './add-to-ai.js'
import { debugView, debugNotice, tripStore, judge } from './debug.js'
import { CAP, REGISTRY, STORE_PREFIX, hostOf, cleanUrl, isPrivateAddress, pushFront, filled, loadStore, saveStore, explainError, registryCard, isActive, revisionNote } from './lib.js'

/* The last tab is the debugger: every HTTP request and JSON-RPC message, and the OAuth flow. Its key stays 'history'. */
const TABS = [['tools', 'Tools'], ['prompts', 'Prompts'], ['resources', 'Resources'], ['history', 'Debug']]
const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

export function mount(root, options) {
  const cfg = Object.assign({ lang: 'en', servers: [], featured: null, registry: REGISTRY, storagePrefix: STORE_PREFIX, clientInfo: null, oauth: {}, syncUrl: true, pageUrl: null }, options)
  const ui = Object.assign({}, STRINGS.en, STRINGS[cfg.lang], cfg.ui)
  const P = cfg.storagePrefix
  root.classList.add('mcpi')

  const explain = (e, oauth) => explainError(e, oauth, ui)
  /* The sign-in recorded so far goes into storage as the page leaves for the authorization page, and is read back on return (secrets already hidden). */
  const trip = tripStore(localStorage, P)
  const onRedirect = (server, url, leaving) => {
    const c = conns[server.key]
    if (!c) return
    c.trace.redirect(url, { held: !leaving })
    if (leaving) trip.save(server.url, c.trace.export())
  }
  /* Servers whose sign-in button was just pressed: only their connect may leave for the authorization page. */
  const pressedSignIn = new Set()
  const auth = oauthStore({ prefix: P, oauth: cfg.oauth, local: localStorage, session: sessionStorage, page: location, onRedirect, allowRedirect: (server) => pressedSignIn.has(server.key) && current === server })
  const setQuery = (q) => { try { history.replaceState(null, '', location.pathname + mergeQuery(location.search, q)) } catch (e) { /* ignore */ } }

  /* Servers: pinned (options.servers) + added by address (mine) + recently viewed (recent). The last two keep CAP each in this browser. */
  /* Header token values live in sessionStorage and go when the tab closes; the list of servers in localStorage has none. */
  const stored = loadStore(localStorage, P, sessionStorage)
  const fromStore = (kind) => (x) => Object.assign({}, x, { key: x.url, custom: true, kind })
  let servers = cfg.servers.map((s) => Object.assign({ custom: false }, s)).concat(stored.mine.map(fromStore('mine')), stored.recent.map(fromStore('recent')))
  const ofKind = (kind) => servers.filter((s) => s.kind === kind)
  const save = () => saveStore(localStorage, { mine: ofKind('mine'), recent: ofKind('recent') }, P, sessionStorage)
  /* A token an earlier version left in localStorage: saving again takes it out of there. */
  if (stored.moved) save()
  const hooks = {
    onLog: (c) => logChanged(c), onListsChanged: (c) => listsChanged(c), onElicit: (c, params) => elicit(c, params),
    authProvider: (server) => auth.provider(server), hasTokens: (server) => auth.hasTokens(server), explain, clientInfo: cfg.clientInfo,
  }
  const newConn = (server) => new Conn(server, hooks)
  const conns = {}
  /* Per connection: its debugger view (the Debug tab) and its failure notice (under the server's name). Made when first shown. */
  const views = {}
  const notices = {}
  const viewOf = (c) => views[c.server.key] || (views[c.server.key] = debugView(c.trace, { lang: cfg.lang, ui: cfg.debugUi, url: c.server.url }))
  const noticeOf = (c) => notices[c.server.key] || (notices[c.server.key] = debugNotice(c.trace, {
    lang: cfg.lang, ui: cfg.debugUi, active: () => c.state === 'failed', fallback: () => c.error,
    onShow: (seq) => { if (!current || conns[current.key] !== c) return; selectTab('history'); viewOf(c).show(seq) },
  }))
  const data = {}
  let current = null
  let tab = 'tools'
  let token = 0
  /* A link with &to=<client>: once that server connects here, it goes on to that AI client (the add-to-ai popup, its one-click link tried at once). */
  const handoff = handoffStore(sessionStorage, P + ':handoff')

  const el = {
    servers: h('div', { class: 'mcpi-servers' }),
    name: h('h2'),
    url: h('code'),
    status: h('span', { class: 'mcpi-status' }),
    info: h('p', { class: 'mcpi-info' }),
    proto: h('p', { class: 'mcpi-proto-note', hidden: true }),
    instr: h('details', { class: 'mcpi-instr', hidden: true }, h('summary', { text: 'Instructions' }), h('pre')),
    tabs: h('div', { class: 'mcpi-tabs', role: 'tablist' }),
    list: h('nav', { class: 'mcpi-list' }),
    select: h('select', { class: 'mcpi-select', 'aria-label': 'Items' }),
    pane: h('section', { class: 'mcpi-pane' }),
    asks: h('div', { class: 'mcpi-asks' }),
    alert: h('div', { class: 'mcpi-alert' }),
    auth: h('div', { class: 'mcpi-auth', hidden: true }),
    share: h('details', { class: 'mcpi-share' }),
    level: h('select', { class: 'mcpi-level', 'aria-label': 'Logging level', hidden: true }, LEVELS.map((v) => h('option', { value: v, text: 'log: ' + v, selected: v === 'info' }))),
  }
  const main = h('div', { class: 'mcpi-main', hidden: true })

  const conn = () => conns[current.key]
  const snap = () => data[current.key]
  const pane = panes({ cfg, ui, current: () => current, conn, snap, connect, renderHead, explain })

  function logChanged(c) {
    if (!current || conns[current.key] !== c) return
    if (tab === 'history') { c.unseen = 0; showDebug(c) }
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

  /* The Debug tab says when the connection failed (a red !), else how many messages came in unasked. */
  function debugMark() {
    const c = conn()
    if (!c) return null
    if (c.state === 'failed') return h('i', { class: 'is-bad', text: '!', title: c.error })
    return c.unseen ? h('i', { class: 'is-new', text: c.unseen }) : null
  }
  function renderTabs() {
    el.tabs.replaceChildren(...TABS.map(([k, label]) => h('button', {
      type: 'button', class: 'mcpi-tab' + (k === tab ? ' is-on' : ''), role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', onclick: () => selectTab(k),
    }, label, k === 'history' ? debugMark() : h('i', { text: itemsOf(k).length }))))
  }

  /* The view keeps itself current, so it is only put in place, not drawn again on each message. */
  function showDebug(c) {
    const v = viewOf(c)
    if (el.pane.firstChild !== v.el || el.pane.childNodes.length !== 1) el.pane.replaceChildren(v.el)
  }

  function selectTab(key, keep) {
    tab = key
    renderTabs()
    const body = el.pane.parentNode
    body.classList.toggle('is-wide', key === 'history')
    if (key === 'history') { conn().unseen = 0; renderTabs(); el.list.replaceChildren(); el.select.replaceChildren(); showDebug(conn()); return }
    const all = itemsOf(key)
    if (!all.length) {
      body.classList.add('is-wide')
      el.list.replaceChildren()
      el.select.replaceChildren()
      const c = conn()
      /* A failure is said once, in the notice under the server's name. */
      el.pane.replaceChildren(h('p', { class: 'mcpi-empty', text: c.state === 'connecting' ? ui.connecting : ui.empty }))
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
    /* A server that only wants sign-in has not failed: it waits for the OAuth button or a token. */
    el.status.textContent = c.state === 'connected' ? 'Connected' : c.state === 'connecting' ? ui.connecting : c.state === 'failed' ? (c.needAuth ? ui.needSignIn : 'Failed') : 'Not connected'
    el.status.dataset.state = c.state === 'failed' && c.needAuth ? 'auth' : c.state
    const info = s && s.info
    const sv = (info && info.serverInfo) || {}
    /*
     * Which revision of the protocol the server speaks, with how it stands: the current one plainly, the newest earlier one
     * with a note (it is fine), an older one with what this inspector uses that it may not have. Never as an error.
     */
    const rev = info && info.protocolVersion ? revisionNote(info.protocolVersion) : { level: null, missing: [] }
    const protoText = !info || !info.protocolVersion ? '' : rev.level === 'current' ? ui.protoCurrent : rev.level === 'info' ? ui.protoEarlier : rev.level === 'warn' ? ui.protoOld : '{v}'
    const featName = { elicitation: ui.featElicitation, titles: ui.featTitles, annotations: ui.featAnnotations, completions: ui.featCompletions }
    const protoNote = rev.level === 'info' ? ui.protoInfo : rev.level === 'warn' ? (rev.missing.length ? ui.protoWarn.replace('{list}', rev.missing.map((k) => featName[k]).join(', ')) : ui.protoWarnNone) : ''
    const dot = () => document.createTextNode(' · ')
    const parts = info ? [
      [sv.name, sv.version].filter(Boolean).join(' ') || null,
      info.protocolVersion ? h('span', { class: 'mcpi-proto' + (rev.level ? ' is-' + rev.level : ''), 'data-level': rev.level || '', 'data-era': info.era || '', title: protoNote.replace('{v}', info.protocolVersion) || null }, 'protocol ' + protoText.replace('{v}', info.protocolVersion)) : null,
      Object.keys(info.capabilities || {}).join(', ') || null].filter(Boolean) : []
    el.info.replaceChildren(...parts.flatMap((x, i) => (i ? [dot(), x] : [x])))
    el.proto.hidden = !protoNote
    el.proto.className = 'mcpi-proto-note' + (rev.level ? ' is-' + rev.level : '')
    el.proto.textContent = protoNote.replace('{v}', (info && info.protocolVersion) || '')
    el.instr.hidden = !(info && info.instructions)
    if (info && info.instructions) { const pre = el.instr.querySelector('pre'); pre.replaceChildren(); linkify(pre, info.instructions) }
    renderShare()
    for (const b of el.servers.querySelectorAll('.mcpi-server')) {
      b.classList.toggle('is-on', b.dataset.key === current.key)
      b.setAttribute('aria-pressed', b.dataset.key === current.key ? 'true' : 'false')
      b.dataset.state = conns[b.dataset.key] ? conns[b.dataset.key].state : 'idle'
    }
    /* logging/setLevel is of the 2025 revisions only; the modern one has no such request. */
    el.level.hidden = !(c.state === 'connected' && info && info.capabilities && info.capabilities.logging && info.era !== 'modern')
    ping.title = c.state === 'connected' && info && info.era === 'modern' ? ui.pingModern : ''
    /* A server that once asked for authentication keeps its OAuth button (if it vanished after a failed OAuth, nobody would know what happened). */
    if (c.needAuth) current.wantsAuth = true
    const wants = c.needAuth || current.wantsAuth
    /* A header named by a link (&h=) or by the registry shows its field right away, before any 401. */
    const named = current.authHeader || current.hint
    el.auth.hidden = !(current.custom && (wants || c.state === 'failed' || current.headers || named))
    signIn.hidden = !wants
    /* What to do next stays by the sign-in controls. What failed and where is the notice above, with its way into Debug. */
    authNote.textContent = c.state === 'failed' && c.needAuth ? ui.failAuth : ''
    const notice = noticeOf(c)
    notice.refresh()
    if (el.alert.firstChild !== notice.el) el.alert.replaceChildren(notice.el)
    if (el.tabs.firstChild) renderTabs()
    if (document.activeElement !== tName && document.activeElement !== tValue) {
      const hd = Object.entries(current.headers || {})[0]
      tName.value = hd ? hd[0] : named || 'Authorization'
      tValue.value = hd ? hd[1] : ''
      tValue.placeholder = current.hintValue || (tName.value.toLowerCase() === 'authorization' ? 'Bearer <token>' : '<token>')
    }
  }

  /*
   * Sharing: the link that opens a server here (share.js), and adding it to an AI client (add-to-ai.js, a popup of its own).
   * Cards carry both as small buttons; the open server shows them in its Share box.
   */
  const pageUrl = () => cfg.pageUrl || location.origin + location.pathname
  const shareLink = (s) => pageUrl() + linkOf(s)
  /*
   * The server as you set it up here, token included: the popup puts it in what you copy (and can take it out).
   * Under each client it offers both links to pass on: the inspector link, and the connect link (the same with &to=<client>:
   * open it, test it, and come back to that client). No token in either.
   */
  const addTo = (s, extra) => openAddToAi({ url: s.url, name: s.name, id: s.id, headers: s.headers, authHeader: s.authHeader, hint: s.hint, oauth: !!s.wantsAuth && !s.headers }, Object.assign({ shareLink: (c) => { const link = shareLink(s.key ? s : { custom: true, id: s.id, url: s.url, hint: s.hint }); return [{ url: link, label: ui.testLink, hint: ui.copyLink, icon: 'flask' }, link + '&to=' + c.id] }, lang: cfg.lang, ui: cfg.addToAiUi, root }, extra))
  /* Redrawn only when the link changes, so an open box stays open. */
  function renderShare() {
    const link = shareLink(current)
    if (el.share.dataset.link === link) return
    el.share.dataset.link = link
    const s = current
    el.share.replaceChildren(...shareBox(link, ui, () => addTo(s)))
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
      /* Connected, so the server is known to answer: now it can go on to the AI client the link named. */
      const to = c.state === 'connected' && handoff.take(server.url)
      if (to) setTimeout(() => addTo(server, { client: to, verified: true, autoOpen: true }), 0)
    } catch (e) {
      if (current === server) { renderHead(); if (!quiet && !itemsOf(tab).length) selectTab(tab) }
      throw e
    }
    if (current === server) {
      renderHead()
      if (!quiet || mine !== token) return
    }
  }

  /* wrap: the card pressed, when it was pressed in the registry list (the inspector opens under it there). */
  async function select(server, wrap, quiet, hold) {
    current = server
    pressed = wrap || null
    if (!conns[server.key]) conns[server.key] = newConn(server)
    if (cfg.syncUrl && !quiet) setQuery(linkOf(server))
    renderHead()
    placeMain()
    selectTab('tools')
    if (hold) return
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
    const press = !!(opts && opts.oauth && !opts.callback)
    /* A sign-in starts afresh: nothing kept from one that never came back. */
    if (press) { pressedSignIn.add(s.key); auth.startSignIn(s); trip.drop(s.url) }
    try { await connect(s, true, opts) } catch (e) { /* shown in head */ } finally { if (press) pressedSignIn.delete(s.key) }
    if (current === s) { renderHead(); selectTab(tab, el.pane.dataset.item) }
  }

  /*
   * Servers are laid out as cards. Pressing one opens its inspector right under that card's row, across the whole row:
   * in the person's own cards, or in the registry list when it was pressed there.
   * Rows depend on the width and lists are drawn again, so it is placed again after each of those.
   */
  let pressed = null
  function placeMain() {
    const ownCard = current && [...el.servers.querySelectorAll('.mcpi-server')].find((b) => b.dataset.key === current.key)
    const wrap = pressed && pressed.isConnected && !pressed.hidden ? pressed : ownCard ? ownCard.closest('.mcpi-card-wrap') : null
    /* A registry card it opened under is marked as the open one, like the person's own cards. */
    for (const r of root.querySelectorAll('.mcpi-reg')) r.classList.toggle('is-on', !main.hidden && r.parentElement === wrap)
    if (!wrap) { if (main.previousElementSibling !== el.servers) el.servers.after(main); return }
    const last = rowEnd(wrap, main)
    if (last.nextElementSibling !== main) last.after(main)
  }
  let placing = 0
  const onResize = () => { cancelAnimationFrame(placing); placing = requestAnimationFrame(placeMain) }
  window.addEventListener('resize', onResize)

  function renderServers() {
    const card = (s) => cardOf(s, { ui, onOpen: open, onRemove: remove, link: shareLink(s), onAdd: addTo })
    const group = (label, list, extra) => [h('p', { class: 'mcpi-label' }, label, list.length && list[0].custom ? h('span', { text: ' ' + list.length + ' / ' + CAP }) : null), extra, list.length ? h('div', { class: 'mcpi-cards' }, list.map(card)) : null]
    const recent = ofKind('recent')
    el.servers.replaceChildren(...[
      ...(servers.some((s) => !s.custom) ? group(ui.ours, servers.filter((s) => !s.custom)) : []),
      ...group(ui.mine, ofKind('mine'), addForm),
      ...(recent.length ? group(ui.recent, recent) : [])].filter(Boolean))
    if (current) renderHead()
    placeMain()
  }
  function reveal(always, instant) {
    const top = main.getBoundingClientRect().top
    if (!always && top < window.innerHeight * 0.55) return
    main.scrollIntoView({ block: 'start', behavior: instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  /*
   * Arriving by a link (?s=, ?r=, ?u=) scrolls to the inspector. When the cards above (the registry list) fill in late, the inspector is
   * pushed down and the view stops halfway (seen in iPhone Safari). If the person has not scrolled meanwhile, align once more after they fill in.
   */
  function revealOnArrival(ready) {
    let moved = false
    const stop = () => { moved = true }
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.addEventListener(ev, stop, { once: true, passive: true })
    reveal(true, true)
    Promise.resolve(ready).catch(() => {}).then(() => requestAnimationFrame(() => { if (!moved && current) reveal(true, true) }))
  }
  function open(s, wrap) { select(s, wrap); reveal(true) }

  /*
   * One server is always open. With nothing else to open (no link, or the open one was removed), open the next saved server,
   * else the first well-known one, quietly: no scrolling, and the address stays as it is. options.openFirst: false turns it off.
   */
  function openDefault(not) {
    if (current || cfg.openFirst === false) return
    const next = servers.find((x) => x.url !== not)
    const f = registry && registry.first()
    /* Arriving with nothing to open: the first well-known server. After removing the open one: the next saved one. */
    if (f && f.card.url !== not && (!not || !next)) {
      const s = add(f.card.url, 'recent', cardMeta(f.card))
      if (s) select(s, f.wrap && f.wrap.isConnected ? f.wrap : null, true)
    } else if (next) select(next, null, true)
  }

  function forget(s) {
    if (conns[s.key]) conns[s.key].close()
    for (const x of [views[s.key], notices[s.key]]) if (x) x.destroy()
    delete conns[s.key]
    delete data[s.key]
    delete views[s.key]
    delete notices[s.key]
  }

  function remove(s) {
    /* Close it first if it is open. Drawing after the connection was removed made renderHead read a missing connection. */
    if (current === s) {
      current = null
      main.hidden = true
      setQuery('')
    }
    const none = !current
    forget(s)
    trip.drop(s.url)
    auth.clearVerifier(s)
    servers = servers.filter((x) => x !== s)
    save()
    renderServers()
    if (none) openDefault(s.url)
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
    for (const x of same) if (!kept.includes(x)) { forget(x); trip.drop(x.url); auth.clearVerifier(x) }
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
  const secretWords = { show: ui.tokenShow, hide: ui.tokenHide }
  const [addInfo, addInfoNote] = infoNote(ui.tokenNote, lineIcon)
  const headerRow = h('div', { class: 'mcpi-add-header', hidden: true }, labeled(ui.hName, hName), labeled([ui.hValue, addInfo], secretField(hValue, lineIcon, secretWords)), addInfoNote)
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
  const tForm = h('form', { class: 'mcpi-token' }, labeled(ui.hName, tName), labeled(ui.hValue, secretField(tValue, lineIcon, secretWords)), tSave)
  const [tokenInfo, tokenInfoNote] = infoNote(ui.tokenNote, lineIcon)
  tForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const s = current
    s.headers = tName.value.trim() && tValue.value.trim() ? { [tName.value.trim()]: tValue.value.trim() } : null
    save()
    if (cfg.syncUrl && current === s) setQuery(linkOf(s))
    tValue.blur()
    reopen(s)
  })
  signIn.addEventListener('click', () => reopen(current, { oauth: true }))
  el.auth.append(authNote, h('p', { class: 'mcpi-label', text: 'OAuth' }), signIn, h('p', { class: 'mcpi-label mcpi-label-info' }, h('span', { class: 'mcpi-label-text', text: ui.token }), tokenInfo), tokenInfoNote, tForm)

  const cardMeta = (c) => ({ id: c.id, name: c.name, desc: c.desc, icon: c.icon, web: c.web, hint: c.hint, hintValue: c.hintValue })
  const registry = cfg.registry ? registryPanel({ cfg, ui, linkOf: (c) => shareLink({ custom: true, id: c.id, url: c.url }), onAdd: (c) => addTo(Object.assign({}, cardMeta(c), { url: c.url })), onPick: (c, wrap) => open(add(c.url, 'recent', cardMeta(c)), wrap), onRender: () => placeMain() }) : null

  main.append(
    h('div', { class: 'mcpi-top' },
      h('div', { class: 'mcpi-id' }, el.name, el.url),
      h('div', { class: 'mcpi-top-actions' }, el.status, el.level, ping, reconnect)),
    el.alert, el.info, el.proto, el.auth, el.share, el.instr, el.asks, el.tabs,
    h('div', { class: 'mcpi-body' }, el.list, el.select, el.pane))
  root.replaceChildren(el.servers, main, ...(registry ? [registry.el] : []))
  renderServers()
  const regReady = registry ? registry.search() : Promise.resolve()

  const q = new URLSearchParams(location.search)
  const returned = q.get('code') || q.get('error')
  const pending = returned ? auth.takePending() : null
  if (pending) {
    const s = add(pending.url, 'recent', { name: pending.name })
    handoff.restore()
    current = s
    conns[s.key] = conns[s.key] || newConn(s)
    /* The sign-in recorded before leaving, then what came back (a code or an error, both hidden). */
    conns[s.key].trace.restore(trip.take(s.url))
    conns[s.key].trace.returned(q)
    s.wantsAuth = true
    setQuery(linkOf(s))
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
    regReady.then(() => openDefault())
  } else {
    arrive(readLink(q))
  }

  /*
   * Arriving by a link (share.js): ?s=, ?r= or ?u=, with &oauth or &h= when it needs sign-in.
   * &oauth only shows the sign-in button. The redirect starts when the person presses it, never from a link alone.
   */
  async function arrive(link) {
    let s = null
    const known = (url) => servers.some((x) => x.url === cleanUrl(url))
    let isNew = false
    if (link.registry && cfg.registry) {
      let card = null
      let gone = false
      try {
        const res = await fetch(registryEntry(cfg.registry, link.registry))
        if (res.ok) {
          const json = await res.json()
          /* A deprecated or deleted entry is not opened: say so rather than connect to what its author retired. */
          gone = !isActive(json)
          if (!gone) card = registryCard(json.server || json, { http: location.protocol === 'http:' })
        }
      } catch (e) { /* not found below */ }
      if (!card) { root.prepend(h('p', { class: 'mcpi-auth-note mcpi-notice', role: 'alert', text: gone ? ui.regInactive : ui.regMissing })); setQuery(''); regReady.then(() => openDefault()); return }
      isNew = !known(card.url)
      s = add(card.url, 'recent', cardMeta(card))
    } else if (link.url) {
      isNew = !known(link.url)
      s = add(link.url, 'recent', {})
    } else if (link.server) {
      s = servers.find((x) => x.key === link.server) || null
    }
    if (!s) { regReady.then(() => openDefault()); return }
    if (s.custom && link.auth === 'oauth') s.wantsAuth = true
    if (s.custom && link.auth === 'header' && !s.headers) { s.authHeader = link.header; save() }
    if (link.to) handoff.keep(s.url, link.to)
    /*
     * A link to an address on this computer or a private network, not one of the person's own servers: someone else may have made it,
     * so a page on the public web does not call that address by itself (a page on localhost is the person's own setup, and connects). It opens, says so, and connects when the person presses the button.
     */
    if (isNew && isPrivateAddress(s.url) && (cfg.holdPrivate === true || (cfg.holdPrivate !== false && !isPrivateAddress(location.href)))) {
      const note = h('p', { class: 'mcpi-auth-note mcpi-notice mcpi-hold', role: 'alert' }, h('span', { text: ui.holdLocal.replace('{v}', s.url) + ' ' }),
        h('button', { type: 'button', class: 'mcpi-btn', text: ui.holdConnect, onclick: () => { note.remove(); if (current === s) reopen(s) } }))
      root.prepend(note)
      select(s, null, false, true)
      return
    }
    const done = select(s)
    revealOnArrival(Promise.all([regReady, done]))
  }

  /* Takes the inspector off the page: closes every connection and empties root (servers kept in this browser stay). */
  return {
    destroy() {
      pressedSignIn.clear()
      for (const key of Object.keys(conns)) forget({ key })
      current = null
      window.removeEventListener('resize', onResize)
      root.replaceChildren()
      root.classList.remove('mcpi')
    },
  }
}
