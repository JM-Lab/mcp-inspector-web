/*
 * The MCP Registry panel: search, and the "Well known", "No auth needed" and "Recently updated" filters.
 *   registryPanel({ cfg, ui, onPick, linkOf, onAdd, onRender }) → { el, search(), first() }
 *     first()        the first well-known server ({ card, wrap }, wrap when the list shows it), opened when nothing else is
 *     onPick(card, wrap)  a result was pressed; the page adds it to recently viewed and opens it under that card's row
 *     onRender()     the list was drawn again (the page puts back what it had placed in it)
 *     linkOf(card)   the link that opens it here (?r=<name>), copied by the card's link button
 *     onAdd(card)    the card's AI button was pressed; the page opens the add-to-AI-client popup
 *
 * The registry has no popularity order (its query parameters are only search, updated_since, cursor, limit and version).
 * So 'Well known' and 'No auth needed' come from a prepared list (options.featured, see scripts/featured.js),
 * while 'Recently updated' and search ask the registry live, when pressed.
 */
import { h } from './dom.js'
import { cardBody, cardTools } from './cards.js'
import { REG_FIRST, registryCards, featuredFor } from './lib.js'

export function registryPanel({ cfg, ui, onPick, linkOf, onAdd, onRender = () => {} }) {
  const input = h('input', { type: 'search', placeholder: ui.regSearch, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'MCP Registry' })
  const list = h('div', { class: 'mcpi-cards mcpi-reg-list' })
  const more = h('button', { type: 'button', class: 'mcpi-btn mcpi-reg-more', text: ui.regMore, hidden: true })
  more.addEventListener('click', () => { for (const r of list.querySelectorAll('[hidden]')) r.hidden = false; more.hidden = true })
  const note = h('span')
  let timer = 0
  let seq = 0
  let filter = cfg.featured ? 'known' : 'recent'
  let firstKnown = null

  let featured = null
  async function featuredList() {
    if (!featured) featured = typeof cfg.featured === 'string' ? await (await fetch(cfg.featured)).json() : cfg.featured
    return featured
  }
  let recent = null
  async function recentServers() {
    if (recent) return recent
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
    recent = registryCards(all.sort((a, b) => (when(a) < when(b) ? 1 : -1)))
    return recent
  }

  const chips = h('div', { class: 'mcpi-filters', role: 'group', 'aria-label': 'MCP Registry' }, [['known', ui.fKnown], ['open', ui.fOpen], ['recent', ui.fRecent]].filter(([k]) => cfg.featured || k === 'recent').map(([k, label]) =>
    h('button', { type: 'button', class: 'mcpi-chip', 'data-filter': k, 'aria-pressed': 'false', text: label, onclick: () => { filter = k; input.value = ''; search() } })))

  async function search() {
    const q = input.value.trim()
    const searching = q.length >= 2
    const mine = ++seq
    for (const b of chips.children) { const on = !searching && b.dataset.filter === filter; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false') }
    note.textContent = searching ? '' : filter === 'recent' ? ui.regRecent : ui.regKnown
    more.hidden = true
    list.replaceChildren(h('p', { class: 'mcpi-hint is-shown', text: ui.asking }))
    onRender()
    let cards = []
    try {
      if (searching) cards = registryCards((await (await fetch(cfg.registry + '?version=latest&limit=40&search=' + encodeURIComponent(q))).json()).servers)
      else if (filter === 'recent') cards = await recentServers()
      else cards = featuredFor(filter, await featuredList())
    } catch (e) {
      if (mine === seq) { list.replaceChildren(h('p', { class: 'mcpi-hint is-shown', text: ui.fail })); onRender() }
      return
    }
    if (mine !== seq) return
    if (!searching && filter === 'known' && cards.length) firstKnown = cards[0]
    /* A button cannot hold another button, so the card and its link button sit side by side in a wrapper. */
    const rows = cards.map((c, i) => h('div', { class: 'mcpi-card-wrap', hidden: i >= REG_FIRST, 'data-url': c.url },
      h('button', { type: 'button', class: 'mcpi-card mcpi-reg', onclick: (e) => onPick(c, e.currentTarget.parentElement) },
        cardBody(c, c.id), c.open ? h('span', { class: 'mcpi-card-tag', text: ui.openTag }) : null),
      cardTools(linkOf && linkOf(c), onAdd && (() => onAdd(c)), ui)))
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'mcpi-hint is-shown', text: ui.regEmpty })]))
    more.hidden = rows.length <= REG_FIRST
    onRender()
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 300) })

  const el = h('section', { class: 'mcpi-registry' },
    h('p', { class: 'mcpi-label' }, 'MCP Registry ', note), h('div', { class: 'mcpi-reg-bar' }, input, chips), list, more)
  function first() {
    if (!firstKnown) return null
    const i = [...list.children].findIndex((w) => w.dataset && w.dataset.url === firstKnown.url)
    return { card: firstKnown, wrap: i >= 0 ? list.children[i] : null }
  }
  return { el, search, first }
}
