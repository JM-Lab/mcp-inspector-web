/*
 * Add an MCP server to an AI client: a UI component of its own. It knows nothing about the inspector and brings its own styles,
 * so any page that shows MCP servers can drop it in with one import.
 *
 *   import { addToAiButton } from 'mcp-inspector-web/add-to-ai'
 *   card.append(addToAiButton({ url: 'https://example.com/mcp', name: 'Example' }))
 *
 *   <script src="https://cdn.jsdelivr.net/npm/mcp-inspector-web@0/dist/mcp-add-to-ai.js"></script>
 *   <mcp-add-to-ai registry="com.microsoft/microsoft-learn-mcp"></mcp-add-to-ai>      everything read from the MCP Registry
 *   <mcp-add-to-ai url="https://example.com/mcp" name="Example"></mcp-add-to-ai>     or given directly
 *
 *   addToAiButton(server, opts)    a button that opens the popup
 *   openAddToAi(server, opts)      the popup itself: pick a client, then add it in one click or follow the steps
 *                                  (a Promise when the server is given by registry name alone)
 *   fromRegistry(name, opts)       a server read from the MCP Registry by its name: { url, name, id, header }
 *   clientsFor(server)             per AI client, how to add this server (plain data, no DOM)
 *   defineAddToAi(tag)             registers the <mcp-add-to-ai> element (the script tag bundle does this on load)
 *     server   { url, name?, id?, header?, headers?, oauth? }, or { id } alone to read the rest from the registry
 *              id is the MCP Registry name, header the name of a header token it needs, headers the token itself
 *              ({ name: value }, put in unless opts.secret is false), oauth that it signs in with OAuth
 *     opts     { lang: 'en' | 'ko', ui: { ...strings }, root: element to put the popup in (default document.body), label,
 *                registryApi: the registry API (default the official one), icons: false or { clientId: url },
 *                mobile: true or false to override the phone or tablet check,
 *                client: the client to open on, verified: say the server was checked and answers,
 *                autoOpen: try that client's one-click link at once (the browser may ask, or need the button pressed) }
 *
 * The popup groups the clients (terminal agents, editors and IDEs, chat apps) under a search box.
 * On a phone or tablet only the chat apps (their websites) can be set up. The popup says so at the top, lists them first,
 * and marks the others Computer only: their one-click button is off, and their setup is still there to copy and send to a computer.
 *
 * Each client is added the most direct way it allows:
 *   link       one click: the client's own install link (VS Code, Cursor, Goose, Kiro, Visual Studio, LM Studio, Trae)
 *   command    one command to run in a terminal (Claude Code, Codex, Gemini CLI, Copilot CLI, opencode, OpenClaw, Qwen Code, …)
 *   file       a config file to edit (Windsurf, Zed, Junie, Kilo Code, Continue, Crush, …)
 *   settings   steps in the app's settings, with what to paste (Claude, ChatGPT, Gemini, Le Chat, Perplexity, Warp, …)
 *
 * A token: a server set up with its own (headers: { name: value }, as in the inspector after you tested it) gets it put in,
 * so what you copy works as it is. A checkbox takes it out again, for passing the setup on to someone else.
 * A server given with only the header name gets <token> (or the client's own secret input) and a note to put yours in.
 * Styles are added to the page once, the first time the component is used. Colors follow --mcpi-* when the page sets them.
 */

import { STRINGS } from './add-to-ai-strings.js'
import { REGISTRY_API, fromRegistry, slugOf, ICONS, GROUPS, clientsFor, worksOnPhone, isMobileDevice, hostOf, withAddress, headerOf, secretOf } from './add-to-ai-clients.js'
import { addStyle } from './add-to-ai-style.js'
import { initialsOf, hueOf } from './initials.js'

export { STRINGS, REGISTRY_API, fromRegistry, slugOf, ICONS, GROUPS, clientsFor, worksOnPhone, isMobileDevice, initialsOf, hueOf }

/* ---- The popup. Plain DOM, no module of the inspector. ---- */

function el(tag, attrs, ...kids) {
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

/* A client's icon. With none on the CDN, or when it cannot load, the tile shows one made from its name. */
function iconOf(id, opts, label) {
  if (opts.icons === false) return null
  const own = opts.icons && opts.icons[id]
  const icon = own ? { src: own } : ICONS[id]
  const box = el('span', { class: 'mcpi-addto-ico', 'aria-hidden': 'true', 'data-icon': icon ? icon.src : '' })
  const letter = () => {
    box.className = 'mcpi-addto-ico is-letter'
    box.style.cssText = `background:hsl(${hueOf(label || id)} 62% 46%)`
    box.replaceChildren(initialsOf(label || id))
  }
  if (!icon) { letter(); return box }
  if (icon.mono) {
    /* Drawn in the text color through a mask. A mask that fails shows nothing, so load it once as an image to know. */
    box.classList.add('is-mono')
    box.style.cssText = `-webkit-mask:url("${icon.src}") center/contain no-repeat;mask:url("${icon.src}") center/contain no-repeat`
    const probe = new Image()
    probe.onerror = letter
    probe.src = icon.src
  } else {
    const img = el('img', { src: icon.src, alt: '', width: '22', height: '22', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
    img.addEventListener('error', letter)
    box.append(img)
  }
  return box
}

/*
 * Calls missed() when the page keeps focus for `ms` after an install link was pressed, which is what happens
 * when no app takes the link. Leaving the page (blur, or the tab hidden) means something opened.
 */
export function watchOpen(missed, ms = 2500, win = typeof window !== 'undefined' ? window : null) {
  if (!win) return
  let left = false
  const away = () => { left = true }
  const hidden = () => { if (win.document.visibilityState === 'hidden') left = true }
  win.addEventListener('blur', away)
  win.document.addEventListener('visibilitychange', hidden)
  win.setTimeout(() => {
    win.removeEventListener('blur', away)
    win.document.removeEventListener('visibilitychange', hidden)
    if (!left) missed()
  }, ms)
}

const LAST = 'mcpi:add-to-ai:last'
const remembered = () => { try { return localStorage.getItem(LAST) } catch (e) { return null } }
const remember = (id) => { try { localStorage.setItem(LAST, id) } catch (e) { /* storage blocked */ } }

const stringsOf = (opts) => Object.assign({}, STRINGS.en, STRINGS[opts.lang], opts.ui)

export function openAddToAi(server, opts = {}) {
  if (!server.url) return withAddress(server, opts).then((s) => openAddToAi(s, opts))
  addStyle()
  const t = stringsOf(opts)
  const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m))
  const mobile = opts.mobile != null ? !!opts.mobile : isMobileDevice()
  const hasSecret = !!secretOf(server)
  let withSecret = hasSecret && opts.secret !== false
  let clients = clientsFor(server, { secret: withSecret })
  const header = headerOf(server)
  const title = server.name || hostOf(server.url)
  const asked = opts.client ? clients.find((c) => c.id === opts.client) : null

  const copyable = (text) => {
    const b = el('button', { type: 'button', class: 'mcpi-addto-copy', text: t.copy, 'data-copy': text })
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = t.copied } catch (e) { b.textContent = '✕' }
      setTimeout(() => { b.textContent = t.copy }, 1500)
    })
    return el('div', { class: 'mcpi-addto-code' }, el('pre', { text }), b)
  }

  function detail(c) {
    const out = []
    const away = mobile && !worksOnPhone(c)
    /* On a phone, say first that this one is for a computer; what to copy still follows. */
    if (away) out.push(el('p', { class: 'mcpi-addto-away', text: fill(t.mobileNo, { v: c.label }) }))
    if (mobile && worksOnPhone(c)) out.push(el('p', { class: 'mcpi-addto-hint', text: fill(t.mobileWeb, { v: c.label }) }))
    if (c.kind === 'link') {
      const manual = el('details', { class: 'mcpi-addto-manual', open: away }, el('summary', { text: t.manual }), el('p', { class: 'mcpi-addto-hint' }, el('code', { text: c.file })), copyable(c.code))
      /* Nothing opened: say why it may be, with a button to try the link again (once the app is installed or let through). */
      const again = el('button', { type: 'button', class: 'mcpi-addto-copy mcpi-addto-again', text: t.tryAgain, onclick: () => { missed.hidden = true; go.click() } })
      const missed = el('div', { class: 'mcpi-addto-away', hidden: true, role: 'status' }, el('p', { text: fill(t.notOpened, { v: c.label }) }),
        el('div', { class: 'mcpi-addto-row' }, again, c.get ? el('a', { class: 'mcpi-addto-get', href: c.get, target: '_blank', rel: 'noopener', text: fill(t.getIt, { v: c.label }) }) : null))
      const go = away
        ? el('span', { class: 'mcpi-addto-go is-off', 'aria-disabled': 'true', text: fill(t.addIn, { v: c.label }) })
        : el('a', { class: 'mcpi-addto-go', href: c.link, text: fill(t.addIn, { v: c.label }), target: /^https:/.test(c.link) ? '_blank' : null, rel: /^https:/.test(c.link) ? 'noopener' : null })
      /*
       * An install link opens the app, or a browser prompt asking to. Either takes focus from the page.
       * When nothing does within a few seconds, the app is likely missing: say so and open the by-hand setup.
       */
      /* A web page link (Kiro, Visual Studio) opens a tab that hands on to the app, so there is nothing to watch. */
      if (!away && !/^https:/.test(c.link)) go.addEventListener('click', () => watchOpen(() => { missed.hidden = false; manual.open = true }))
      out.push(go, away ? null : el('p', { class: 'mcpi-addto-hint', text: fill(t.linkHint, { v: c.label }) }),
        c.secretInLink && !away ? el('p', { class: 'mcpi-addto-note', 'data-warn': 'link-secret', text: fill(t.linkSecret, { v: c.label }) }) : null, missed, manual)
    } else if (c.kind === 'command') {
      out.push(el('p', { text: t.run }), copyable(c.code))
    } else if (c.kind === 'file') {
      out.push(el('p', null, t.openFile + ' ', el('code', { text: c.file })), copyable(c.code))
    } else {
      const steps = t[c.steps] || []
      out.push(el('ol', { class: 'mcpi-addto-steps' }, steps.map((s) => el('li', { text: s }))), copyable(c.code),
        c.settings ? el('a', { class: 'mcpi-addto-go is-quiet', href: c.settings, target: '_blank', rel: 'noopener', text: fill(t.openSettings, { v: c.label }) }) : null)
    }
    if (c.note) out.push(el('p', { class: 'mcpi-addto-note', text: fill(t[c.note], { v: c.label, h: header, env: c.env }) }))
    if (c.get) out.push(el('a', { class: 'mcpi-addto-get', href: c.get, target: '_blank', rel: 'noopener', text: fill(t.getIt, { v: c.label }) }))
    return out
  }

  const pane = el('div', { class: 'mcpi-addto-detail', 'aria-live': 'polite' })
  /* Clients in groups (terminal agents, editors, chat apps), with a search box over them all. */
  const tiles = el('div', { class: 'mcpi-addto-groups', role: 'radiogroup', 'aria-label': t.pick })
  const tileEls = () => [...tiles.querySelectorAll('.mcpi-addto-tile')]
  /* A server with its own token: put it in, or not (to pass the setup on to someone else). */
  const secretBox = hasSecret ? el('label', { class: 'mcpi-addto-secret' },
    el('input', { type: 'checkbox', checked: withSecret, onchange: (e) => { withSecret = e.target.checked; clients = clientsFor(server, { secret: withSecret }); choose(pane.dataset.client) } }),
    el('span', null, el('b', { text: t.withSecret }), el('small', { text: t.withSecretHint }))) : null
  function choose(id) {
    const c = clients.find((x) => x.id === id) || clients[0]
    for (const b of tileEls()) { const on = b.dataset.client === c.id; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1 }
    pane.dataset.client = c.id
    pane.replaceChildren(...detail(c).filter(Boolean))
    remember(c.id)
  }
  /* On a phone, the chat apps it can set up come first; the others say they are for a computer. */
  const groups = mobile ? ['app'].concat(GROUPS.filter((g) => g !== 'app')) : GROUPS
  const order = groups.flatMap((g) => clients.filter((c) => c.group === g))
  tiles.append(...groups.map((g) => el('section', { class: 'mcpi-addto-group', 'data-group': g },
    el('p', { class: 'mcpi-addto-group-name', text: t['g_' + g] }),
    el('div', { class: 'mcpi-addto-tiles' }, clients.filter((c) => c.group === g).map((c) => {
      const away = mobile && !worksOnPhone(c)
      return el('button', { type: 'button', class: 'mcpi-addto-tile' + (away ? ' is-away' : ''), role: 'radio', 'aria-checked': 'false', 'data-client': c.id, 'data-find': (c.label + ' ' + c.id + ' ' + t['g_' + g]).toLowerCase(), onclick: () => choose(c.id) },
        iconOf(c.id, opts, c.label), el('b', { text: c.label }), el('span', { text: away ? t.computerOnly : t[c.kind] }))
    })))))
  /*
   * Keys, as in a radio group: Tab reaches the picked tile, arrows move through the tiles that show (in reading order),
   * Home and End go to the first and last. Moving picks.
   */
  tiles.addEventListener('keydown', (e) => {
    const shown = tileEls().filter((b) => !b.hidden && !b.closest('[hidden]'))
    const at = shown.indexOf(document.activeElement)
    if (at < 0) return
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[e.key]
    if (to == null) return
    e.preventDefault()
    const b = shown[(to + shown.length) % shown.length]
    choose(b.dataset.client)
    b.focus()
  })
  const none = el('p', { class: 'mcpi-addto-hint', hidden: true, text: t.noMatch })
  /* Typing narrows the tiles (and empty groups hide); Enter picks the first one left. */
  const search = el('input', { type: 'search', class: 'mcpi-addto-search', placeholder: t.search, 'aria-label': t.search, autocomplete: 'off', spellcheck: 'false' })
  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
    for (const b of tileEls()) b.hidden = !words.every((w) => b.dataset.find.includes(w))
    for (const sec of tiles.children) sec.hidden = ![...sec.querySelectorAll('.mcpi-addto-tile')].some((b) => !b.hidden)
    none.hidden = tileEls().some((b) => !b.hidden)
  })
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = tileEls().find((b) => !b.hidden)
    if (first) choose(first.dataset.client)
  })

  const dialog = el('dialog', { class: 'mcpi-addto', 'aria-label': fill(t.title, { v: title }) },
    el('div', { class: 'mcpi-addto-head' },
      el('div', null, el('h2', { text: fill(t.title, { v: title }) }), el('code', { text: server.url })),
      el('button', { type: 'button', class: 'mcpi-addto-close', text: t.close, onclick: () => dialog.close() })),
    mobile ? el('p', { class: 'mcpi-addto-mobile', text: t.mobileBanner }) : null,
    asked && opts.verified ? el('p', { class: 'mcpi-addto-ok', role: 'status', text: fill(t.verified, { s: title, v: asked.label }) }) : null,
    el('p', { class: 'mcpi-addto-label', text: t.pick }), search, tiles, none, secretBox, pane)
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })
  /* Focus goes back to what opened the popup (the button on a card), so the keyboard is where it was. */
  const opener = typeof document !== 'undefined' ? document.activeElement : null
  dialog.addEventListener('close', () => { dialog.remove(); if (opener && opener.isConnected && opener.focus) opener.focus() })
  ;(opts.root || document.body).append(dialog)
  /* The client asked for (a link's &to=), else the one picked last, unless this is a phone and it needs a computer. */
  const last = clients.find((c) => c.id === remembered())
  choose(asked ? asked.id : last && !(mobile && !worksOnPhone(last)) ? last.id : order[0].id)
  dialog.showModal()
  search.focus()
  /* The picked tile may sit further down the list: bring it into view. */
  const on = tiles.querySelector('.mcpi-addto-tile.is-on')
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' })
  /*
   * Handing on: try the one-click link at once. The browser may open the app, ask first, or do nothing without a press;
   * the button stays there, and when nothing opens the popup says so and shows the setup to add by hand.
   * A web page link (Kiro, Visual Studio) would be a blocked pop-up, so it waits for the press.
   */
  if (asked && opts.autoOpen && asked.kind === 'link' && !mobile && !/^https:/.test(asked.link)) {
    const go = pane.querySelector('a.mcpi-addto-go')
    if (go) go.click()
  }
  return dialog
}

/** A button that opens the popup for this server. */
export function addToAiButton(server, opts = {}) {
  addStyle()
  const t = stringsOf(opts)
  const b = el('button', { type: 'button', class: opts.class || 'mcpi-addto-trigger', text: opts.label || t.button, title: t.button })
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (server.url) { openAddToAi(server, opts); return }
    /* Given by registry name alone: look it up on the first press. */
    b.disabled = true
    b.textContent = t.loading
    try { server = await withAddress(server, opts); b.disabled = false; b.textContent = opts.label || t.button; openAddToAi(server, opts) } catch (err) { b.textContent = err.inactive ? t.inactive : t.notFound }
  })
  return b
}

/*
 * <mcp-add-to-ai registry="io.github.x/y" lang="ko" label="…"></mcp-add-to-ai>
 * <mcp-add-to-ai url="…" name="…" header="X-API-Key"></mcp-add-to-ai>
 * Draws the same button in place (no shadow DOM, so the page can style it). Given a registry name alone, it reads the address,
 * title and needed header from the registry first (registry-api="…" points at another registry), and says so when it is not there.
 */
export function defineAddToAi(tag = 'mcp-add-to-ai') {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  customElements.define(tag, class extends HTMLElement {
    static get observedAttributes() { return ['url', 'name', 'registry', 'header', 'lang', 'label', 'registry-api'] }
    connectedCallback() { this.render() }
    attributeChangedCallback() { if (this.isConnected) this.render() }
    async render() {
      const a = (k) => this.getAttribute(k) || undefined
      const opts = { lang: a('lang'), label: a('label'), registryApi: a('registry-api') }
      const given = { url: a('url'), name: a('name'), id: a('registry'), header: a('header') }
      if (!given.url && !given.id) { this.replaceChildren(); return }
      if (given.url) { this.replaceChildren(addToAiButton(given, opts)); return }
      /* Registry name alone: a waiting button, then the real one (or why there is none). A newer render wins. */
      const mine = (this.seq = (this.seq || 0) + 1)
      const t = stringsOf(opts)
      addStyle()
      this.dataset.state = 'loading'
      this.replaceChildren(el('button', { type: 'button', class: 'mcpi-addto-trigger', disabled: true, text: t.loading }))
      try {
        const found = await fromRegistry(given.id, opts)
        if (mine !== this.seq) return
        this.dataset.state = 'ready'
        this.replaceChildren(addToAiButton(Object.assign({}, found, { name: given.name || found.name, header: given.header || found.header }), opts))
      } catch (e) {
        if (mine !== this.seq) return
        this.dataset.state = 'missing'
        this.replaceChildren(el('button', { type: 'button', class: 'mcpi-addto-trigger', disabled: true, text: e.inactive ? t.inactive : t.notFound, title: String(e.message || e) }))
      }
    }
  })
}
