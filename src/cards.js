/*
 * Server cards. Pinned, added and recently viewed servers, and registry results, all use the same card body.
 *   cardBody(server, sub)                       icon, name, host (or sub) and description
 *   cardOf(server, { ui, onOpen, onRemove })    a pressable card, with × for servers kept in this browser
 */
import { h } from './dom.js'
import { hostOf, iconCandidates, countsText } from './lib.js'

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

export function cardBody(s, sub) {
  return [h('span', { class: 'mcpi-card-head' }, iconOf(s), h('span', { class: 'mcpi-card-name' }, h('b', { text: s.name }), h('span', { class: 'mcpi-card-host', text: sub || hostOf(s.url) }))),
    s.desc ? h('span', { class: 'mcpi-card-desc', text: s.desc }) : null]
}

export function cardOf(s, { ui, onOpen, onRemove }) {
  const meta = countsText(s.counts)
  return h('div', { class: 'mcpi-card-wrap' },
    h('button', { type: 'button', class: 'mcpi-server mcpi-card', 'data-key': s.key, 'aria-pressed': 'false', onclick: () => onOpen(s) },
      cardBody(s), meta ? h('span', { class: 'mcpi-card-meta', text: meta }) : null),
    s.custom ? h('button', { type: 'button', class: 'mcpi-remove', 'aria-label': ui.remove, title: ui.remove, text: '×', onclick: () => onRemove(s) }) : null)
}
