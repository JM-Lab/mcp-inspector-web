/*
 * Server cards. Pinned, added and recently viewed servers, and registry results, all use the same card body.
 *   cardBody(server, sub)                       icon, name, host (or sub) and description
 *   cardOf(server, { ui, onOpen, onRemove, link, onAdd })   a pressable card, with × for servers kept in this browser
 *   cardTools(link, onAdd, ui)                  the small buttons on a card, which never open it:
 *                                               copy the link that opens it here, and add it to an AI client (add-to-ai.js)
 *   shareBox(link, ui, onAdd)                   what the open server's Share box holds: the link to copy, and the AI client button
 */
import { h, copyButton } from './dom.js'
import { hostOf, iconCandidates, countsText } from './lib.js'
import { initialsOf, hueOf } from './initials.js'

/*
 * Icons: try the candidates in order. When none loads (no icon anywhere, or no network), the card shows one made
 * from the name: its initials on a color of its own, the same way the add-to-ai popup does for its clients.
 */
function iconOf(s) {
  const box = h('span', { class: 'mcpi-ico', 'aria-hidden': 'true' })
  const list = s.custom === false && s.icon ? [s.icon] : iconCandidates(s)
  let i = 0
  const next = () => {
    if (i >= list.length) {
      const name = String(s.name || hostOf(s.url) || '?').trim()
      box.classList.add('is-none')
      box.style.background = `hsl(${hueOf(name)} 62% 46%)`
      box.replaceChildren(initialsOf(name))
      return
    }
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

/* A chain-link icon, drawn so it follows the text color. */
function linkIcon() {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7']) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', 'currentColor')
    p.setAttribute('stroke-width', '2')
    p.setAttribute('stroke-linecap', 'round')
    svg.append(p)
  }
  return svg
}

export function cardTools(link, onAdd, ui) {
  if (!link && !onAdd) return null
  return h('span', { class: 'mcpi-card-tools' },
    onAdd ? h('button', { type: 'button', class: 'mcpi-card-ai', text: ui.addAiShort, title: ui.addAiBtn, 'aria-label': ui.addAiBtn, onclick: (e) => { e.stopPropagation(); onAdd() } }) : null,
    link ? copyButton(link, { label: linkIcon, copied: '✓', cls: 'mcpi-card-share', title: ui.copyLink }) : null)
}

export function cardOf(s, { ui, onOpen, onRemove, link, onAdd }) {
  const meta = countsText(s.counts)
  return h('div', { class: 'mcpi-card-wrap' },
    h('button', { type: 'button', class: 'mcpi-server mcpi-card', 'data-key': s.key, 'aria-pressed': 'false', onclick: () => onOpen(s) },
      cardBody(s), meta ? h('span', { class: 'mcpi-card-meta', text: meta }) : null),
    cardTools(link, onAdd && (() => onAdd(s)), ui),
    s.custom ? h('button', { type: 'button', class: 'mcpi-remove', 'aria-label': ui.remove, title: ui.remove, text: '×', onclick: () => onRemove(s) }) : null)
}

export function shareBox(link, ui, onAdd) {
  return [
    h('summary', { text: ui.share }),
    h('p', { class: 'mcpi-label', text: ui.shareLink }),
    h('div', { class: 'mcpi-share-row' },
      h('input', { type: 'text', readonly: true, value: link, class: 'mcpi-share-link', 'aria-label': ui.shareLink, onfocus: (e) => e.target.select() }),
      copyButton(link, { label: ui.copy, copied: ui.copied })),
    h('p', { class: 'mcpi-hint is-shown', text: ui.shareNote }),
    h('p', { class: 'mcpi-label', text: ui.addAi }),
    h('button', { type: 'button', class: 'mcpi-btn mcpi-add-ai', text: ui.addAiBtn, onclick: onAdd }),
  ]
}
