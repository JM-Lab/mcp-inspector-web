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
 *                autoOpen: try that client's one-click link at once (the browser may ask, or need the button pressed),
 *                shareLink(client): a link of the page using this component, drawn as a copy button under each client
 *                (the inspector gives two: its own link to the server, and one that tests it and comes back to that client);
 *                a string, or a list of { url, label?, hint?, icon? } }
 *
 * The popup groups the clients (terminal agents, editors and IDEs, chat apps) under a search box.
 * On a phone or tablet only the chat apps (their websites) can be set up. The popup says so at the top, lists them first,
 * and marks the others Computer only: their one-click button is off, and their setup is still there to copy and send to a computer.
 *
 * Each client is added the most direct way it allows:
 *   link       one click: the client's own install link (VS Code, Cursor, Goose, Kiro, Visual Studio, LM Studio, Trae, Replit);
 *              these lead the list, and pressing the tile opens the link at once
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
import { REGISTRY_API, fromRegistry, slugOf, ICONS, GROUPS, clientsFor, worksOnPhone, isMobileDevice, hasShareSheet, passOn, hostOf, withAddress, headerOf, secretOf } from './add-to-ai-clients.js'
import { addStyle } from './add-to-ai-style.js'
import { initialsOf, hueOf } from './initials.js'

export { STRINGS, REGISTRY_API, fromRegistry, slugOf, ICONS, GROUPS, clientsFor, worksOnPhone, isMobileDevice, hasShareSheet, passOn, initialsOf, hueOf }

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

/* Line icons in the text color, drawn the same way as the inspector's own (close, copy, and the check after copying). */
const LINES = {
  /* Add to AI: a spark (the usual sign for AI) with a small plus, the same as the inspector's. */
  ai: ['M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z', 'M19 15v5', 'M16.5 17.5h5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z', 'M16 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2'],
  retry: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  /* A plug with a spark in it: the connect link. A flask: a link to a page where the server can be tried (the inspector's own). */
  plug: ['M9 2v5', 'M15 2v5', 'M6 7h12v4a6 6 0 0 1-12 0V7z', 'M12 17v5', 'M12.8 8.6l-2.2 2.9h2.8l-2.2 2.9'],
  flask: ['M9 3h6', 'M10 3v6l-5.2 9a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9V3', 'M7.5 15h9'],
}
const closeIcon = () => lineIcon('close', 18)
function lineIcon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(size), height: String(size), 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  for (const d of LINES[name]) {
    const p = document.createElementNS(ns, 'path')
    for (const [k, v] of Object.entries({ d, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' })) p.setAttribute(k, v)
    svg.append(p)
  }
  return svg
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
  /* On a phone the links made here open the share sheet, to send them in a chat app; elsewhere they are copied. */
  const sheet = hasShareSheet(typeof navigator !== 'undefined' ? navigator : {}, mobile)
  const hasSecret = !!secretOf(server)
  let withSecret = hasSecret && opts.secret !== false
  let clients = clientsFor(server, { secret: withSecret })
  const header = headerOf(server)
  const title = server.name || hostOf(server.url)
  const asked = opts.client ? clients.find((c) => c.id === opts.client) : null

  const copyable = (text) => {
    /* An icon; the word is its tooltip and its name for screen readers, and turns to "Copied" with a check for a moment. */
    const b = el('button', { type: 'button', class: 'mcpi-addto-copy is-icon', 'data-copy': text })
    const show = (icon, word) => { b.replaceChildren(lineIcon(icon)); b.title = word; b.setAttribute('aria-label', word); b.classList.toggle('is-done', icon === 'check') }
    show('copy', t.copy)
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); show('check', t.copied) } catch (e) { show('close', t.copy) }
      setTimeout(() => show('copy', t.copy), 1500)
    })
    return el('div', { class: 'mcpi-addto-code' }, el('pre', { text }), b)
  }

  /* The buttons under a client's way to add it: an icon and a word, all the same quiet size. */
  const act = (tag, icon, text, attrs = {}) => el(tag, Object.assign({}, attrs, { class: ('mcpi-addto-go is-quiet ' + (attrs.class || '')).trim() }), lineIcon(icon), el('span', { text }))
  const newTab = (href, cls) => ({ href, target: '_blank', rel: 'noopener', class: cls })
  /*
   * A button that passes a link on and explains in its tooltip what the link is: copied, saying Copied with a check for a moment,
   * or on a phone sent through the share sheet (sheetHint is then its tooltip).
   */
  const copyAct = (icon, text, value, hint, cls, sheetHint) => {
    const b = act('button', icon, text, { type: 'button', class: cls, 'data-copy': value, 'data-share': sheet ? '' : null, title: sheet ? sheetHint || hint : hint })
    b.addEventListener('click', async () => {
      const word = b.querySelector('span')
      let r
      try { r = await passOn(value, sheet) } catch (e) { return }
      if (r !== 'copied') return
      b.replaceChildren(lineIcon('check'), el('span', { text: t.copied })); b.classList.add('is-done')
      setTimeout(() => { b.replaceChildren(lineIcon(icon), word); b.classList.remove('is-done') }, 1500)
    })
    return b
  }
  /* The client's own website (where to get it). */
  const getBtn = (c) => (c.get ? act('a', 'external', fill(t.getIt, { v: c.label }), newTab(c.get, 'mcpi-addto-get')) : null)
  /*
   * A link the page using this component makes (opts.shareLink(client)): for the inspector, the page that opens this server,
   * tests it, and comes back to this client. The component draws the button only; what the link is belongs to that page.
   */
  const shared = (c) => {
    const got = typeof opts.shareLink === 'function' ? opts.shareLink(c) : null
    /* One link (the connect link), or several, each { url, label?, hint?, icon? } with icon one of plug, flask, copy, and sheetHint, its tooltip where it opens the share sheet. */
    return [].concat(got || []).map((x) => (typeof x === 'string' ? { url: x } : x)).filter((x) => x && x.url).map((x) =>
      copyAct(LINES[x.icon] ? x.icon : 'plug', x.label || fill(t.shareThis, { v: c.label }), x.url, x.hint || fill(t.shareThisHint, { v: c.label }), 'mcpi-addto-share is-' + (LINES[x.icon] ? x.icon : 'plug'), x.sheetHint || fill(t.shareThisSheet, { v: c.label })))
  }

  function detail(c) {
    const out = []
    let openLink = null
    const away = mobile && !worksOnPhone(c)
    /* On a phone, say first that this one is for a computer; what to copy still follows. */
    if (away) out.push(el('p', { class: 'mcpi-addto-away', text: fill(t.mobileNo, { v: c.label }) }))
    if (mobile && worksOnPhone(c)) out.push(el('p', { class: 'mcpi-addto-hint', text: fill(t.mobileWeb, { v: c.label }) }))
    if (c.kind === 'link') {
      /*
       * Pressing the tile already opened the link, so there is no second add button: what shows is what it did,
       * what to do when nothing opened, and the file to edit by hand.
       */
      const manual = el('details', { class: 'mcpi-addto-manual', open: away }, el('summary', { text: t.manual }), el('p', { class: 'mcpi-addto-hint' }, el('code', { text: c.file })), copyable(c.code))
      const missed = el('p', { class: 'mcpi-addto-away', hidden: true, role: 'status', text: fill(t.notOpened, { v: c.label }) })
      const web = /^https:/.test(c.link)
      if (!away) {
        openLink = act('a', 'retry', t.tryAgain, Object.assign(web ? newTab(c.link) : { href: c.link }, { class: 'mcpi-addto-open' }))
        /*
         * An install link opens the app, or a browser prompt asking to. Either takes focus from the page.
         * When nothing does within a few seconds, the app is likely missing: say so and open the by-hand setup.
         * A web page link (Kiro, Visual Studio, Replit) opens a tab that hands on to the app, so there is nothing to watch.
         */
        /* Only the latest press may say that nothing opened: an earlier press's wait must not bring the notice back over a new try. */
        let tries = 0
        openLink.addEventListener('click', () => { const mine = ++tries; missed.hidden = true; if (!web) watchOpen(() => { if (mine === tries) { missed.hidden = false; manual.open = true } }) })
      }
      out.push(away ? null : el('p', { class: 'mcpi-addto-hint', text: fill(t.linkHint, { v: c.label }) }),
        c.secretInLink && !away ? el('p', { class: 'mcpi-addto-note', 'data-warn': 'link-secret', text: fill(t.linkSecret, { v: c.label }) }) : null, missed, manual)
    } else if (c.kind === 'command') {
      out.push(el('p', { text: t.run }), copyable(c.code))
    } else if (c.kind === 'file') {
      out.push(el('p', null, t.openFile + ' ', el('code', { text: c.file })), copyable(c.code))
    } else {
      const steps = t[c.steps] || []
      out.push(el('ol', { class: 'mcpi-addto-steps' }, steps.map((s) => el('li', { text: s }))), copyable(c.code))
    }
    if (c.note) out.push(el('p', { class: 'mcpi-addto-note', text: fill(t[c.note], { v: c.label, h: header, env: c.env }) }))
    /* Where to look, in the client, to see that the server is connected: a command to type, or a place in its settings. */
    if (c.check) out.push(el('p', { class: 'mcpi-addto-hint mcpi-addto-check' }, t.checkIt + ' ', t[c.check] ? t[c.check] : el('code', { text: c.check })))
    /*
     * One row of buttons for every client: open the install link again, copy it to send (never when it holds your token),
     * open the client's settings or website, and the link the page using this component offers (the inspector's: this whole view).
     */
    const settings = c.kind === 'settings' && c.settings ? act('a', 'external', fill(t.openSettings, { v: c.label }), newTab(c.settings)) : null
    /*
     * One link to pass on, never two: the page's own (shareLink, which opens the server, tests it and comes back here),
     * or else, with none given, the client's install link itself (never when it holds your token).
     */
    const share = shared(c)
    const install = !share.length && c.kind === 'link' && !c.secretInLink && !(mobile && !worksOnPhone(c)) ? copyAct('copy', t.copyInstall, c.link, fill(t.copyInstallHint, { v: c.label }), 'mcpi-addto-install', fill(t.shareInstallHint, { v: c.label })) : null
    const row = [openLink, settings, getBtn(c), ...share, install].filter(Boolean)
    if (row.length) out.push(el('div', { class: 'mcpi-addto-row mcpi-addto-acts' }, row))
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
  /*
   * The picked client's way to add it opens right under the row its tile is in, across the whole row.
   * Rows depend on the popup's width, so it is placed again when the window resizes or a search hides tiles.
   */
  function place() {
    const on = tiles.querySelector('.mcpi-addto-tile.is-on')
    if (!on || on.hidden || on.closest('[hidden]')) { none.after(pane); return }
    let last = on
    for (const b of on.parentElement.querySelectorAll('.mcpi-addto-tile')) if (!b.hidden && b.offsetTop === on.offsetTop) last = b
    if (last.nextElementSibling !== pane) last.after(pane)
  }
  /*
   * A one-click client is added by the press on its tile itself: its link opens at once, and what shows under it is for when nothing opens.
   * Pressing the same tile again only tries the link again: what is under it stays as it is, so nothing jumps.
   */
  function start() {
    const go = pane.querySelector('a.mcpi-addto-open')
    if (go) go.click()
  }
  function choose(id) {
    const c = clients.find((x) => x.id === id) || clients[0]
    for (const b of tileEls()) { const on = b.dataset.client === c.id; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1 }
    pane.dataset.client = c.id
    pane.replaceChildren(...detail(c).filter(Boolean))
    place()
    remember(c.id)
  }
  /* On a phone, the chat apps it can set up come first; the others say they are for a computer. */
  /*
   * The clients with a one-click link come first, in a group of their own (editors before agents); the rest follow in their groups.
   * On a phone the chat apps lead, since only they can be set up there.
   */
  const LINK_ORDER = ['editor', 'app', 'agent']
  const groupOf = (c) => (c.kind === 'link' ? 'link' : c.group)
  const all = ['link'].concat(GROUPS)
  const groups = mobile ? ['app'].concat(all.filter((g) => g !== 'app')) : all
  const inGroup = (g) => clients.filter((c) => groupOf(c) === g).sort((a, b) => (g === 'link' ? LINK_ORDER.indexOf(a.group) - LINK_ORDER.indexOf(b.group) : 0))
  const order = groups.flatMap(inGroup)
  tiles.append(...groups.map((g) => el('section', { class: 'mcpi-addto-group', 'data-group': g },
    el('p', { class: 'mcpi-addto-group-name', text: t['g_' + g] }),
    el('div', { class: 'mcpi-addto-tiles' }, inGroup(g).map((c) => {
      const away = mobile && !worksOnPhone(c)
      return el('button', { type: 'button', class: 'mcpi-addto-tile' + (away ? ' is-away' : ''), role: 'radio', 'aria-checked': 'false', 'data-client': c.id, 'data-find': (c.label + ' ' + c.id + ' ' + t['g_' + g] + ' ' + t['g_' + c.group]).toLowerCase(), onclick: () => { if (pane.dataset.client !== c.id) choose(c.id); if (c.kind === 'link' && !away) start() } },
        iconOf(c.id, opts, c.label), el('b', { text: c.label }), el('span', { text: away ? t.computerOnly : c.kind === 'link' ? t.tapAdds : t[c.kind] }))
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
    place()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = tileEls().find((b) => !b.hidden)
    if (first) choose(first.dataset.client)
  })

  /* What any client needs to connect by hand: always shown, under the picked client's own way. */
  const authLine = header ? fill(t.anyHeader, { h: header }) : server.oauth ? t.anyOauth : ''
  const anyBox = el('section', { class: 'mcpi-addto-any' },
    el('p', { class: 'mcpi-addto-group-name', text: t.anyTitle }), copyable(server.url),
    el('p', { class: 'mcpi-addto-hint', text: [t.anyHint, authLine].filter(Boolean).join(' ') }))

  const dialog = el('dialog', { class: 'mcpi-addto', 'aria-label': fill(t.title, { v: title }) },
    el('div', { class: 'mcpi-addto-head' },
      el('div', null, el('h2', { text: fill(t.title, { v: title }) }), el('code', { text: server.url })),
      el('button', { type: 'button', class: 'mcpi-addto-close', 'aria-label': t.close, title: t.close, onclick: () => dialog.close() }, closeIcon())),
    mobile ? el('p', { class: 'mcpi-addto-mobile', text: t.mobileBanner }) : null,
    asked && opts.verified ? el('p', { class: 'mcpi-addto-ok', role: 'status', text: fill(t.verified, { s: title, v: asked.label }) }) : null,
    el('p', { class: 'mcpi-addto-label', text: t.pick }), search, tiles, none, secretBox, anyBox)
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })
  /* Focus goes back to what opened the popup (the button on a card), so the keyboard is where it was. */
  const opener = typeof document !== 'undefined' ? document.activeElement : null
  const onResize = () => place()
  window.addEventListener('resize', onResize)
  dialog.addEventListener('close', () => { window.removeEventListener('resize', onResize); dialog.remove(); if (opener && opener.isConnected && opener.focus) opener.focus() })
  ;(opts.root || document.body).append(dialog)
  /* The client asked for (a link's &to=), else the one picked last, unless this is a phone and it needs a computer. */
  const last = clients.find((c) => c.id === remembered())
  choose(asked ? asked.id : last && !(mobile && !worksOnPhone(last)) ? last.id : order[0].id)
  dialog.showModal()
  search.focus()
  /* Rows are known only once it shows: place the way to add it under the picked tile's row, and bring the tile into view. */
  place()
  const on = tiles.querySelector('.mcpi-addto-tile.is-on')
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' })
  /*
   * Handing on: try the one-click link at once. The browser may open the app, ask first, or do nothing without a press;
   * the button stays there, and when nothing opens the popup says so and shows the setup to add by hand.
   * A web page link (Kiro, Visual Studio) would be a blocked pop-up, so it waits for the press.
   */
  if (asked && opts.autoOpen && asked.kind === 'link' && !mobile && !/^https:/.test(asked.link)) {
    const go = pane.querySelector('a.mcpi-addto-open')
    if (go) go.click()
  }
  return dialog
}

/** The trigger's look: the spark icon and its words, like every action button. */
const trigger = (text, attrs) => el('button', Object.assign({ type: 'button' }, attrs), lineIcon('ai', 15), el('span', { text }))

/** A button that opens the popup for this server. */
export function addToAiButton(server, opts = {}) {
  addStyle()
  const t = stringsOf(opts)
  const b = trigger(opts.label || t.button, { class: opts.class || 'mcpi-addto-trigger', title: t.button })
  const say = (text) => { b.querySelector('span').textContent = text }
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (server.url) { openAddToAi(server, opts); return }
    /* Given by registry name alone: look it up on the first press. */
    b.disabled = true
    b.setAttribute('aria-busy', 'true')
    say(t.loading)
    try { server = await withAddress(server, opts); b.disabled = false; say(opts.label || t.button); openAddToAi(server, opts) } catch (err) { say(err.inactive ? t.inactive : t.notFound) }
    b.removeAttribute('aria-busy')
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
      this.replaceChildren(trigger(t.loading, { class: 'mcpi-addto-trigger', disabled: true, 'aria-busy': 'true' }))
      try {
        const found = await fromRegistry(given.id, opts)
        if (mine !== this.seq) return
        this.dataset.state = 'ready'
        this.replaceChildren(addToAiButton(Object.assign({}, found, { name: given.name || found.name, header: given.header || found.header }), opts))
      } catch (e) {
        if (mine !== this.seq) return
        this.dataset.state = 'missing'
        this.replaceChildren(trigger(e.inactive ? t.inactive : t.notFound, { class: 'mcpi-addto-trigger', disabled: true, title: String(e.message || e) }))
      }
    }
  })
}
