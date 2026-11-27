/*
 * Server cards. Pinned, added and recently viewed servers, and registry results, all use the same card body.
 *   cardBody(server, sub)                       icon, name, host (or sub) and description
 *   cardOf(server, { ui, onOpen, onRemove, link, onAdd })   a pressable card, with × for servers kept in this browser
 *   cardTools(link, onAdd, ui)                  the small buttons on a card, which never open it:
 *                                               copy the link that opens it here, and add it to an AI client (add-to-ai.js)
 *   shareBox(link, ui, onAdd)                   what the open server's Share box holds: the link to copy, and the AI client button
 */
import { h, copyButton, iconButton } from './dom.js'
import { hostOf, iconCandidates, countsText } from './lib.js'
import { initialsOf, hueOf } from './initials.js'
import { lineIcon } from './icons.js'

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

export function cardTools(link, onAdd, ui) {
  if (!link && !onAdd) return null
  return h('span', { class: 'mcpi-card-tools' },
    onAdd ? h('button', { type: 'button', class: 'mcpi-card-ai', title: ui.addAiTip, 'aria-label': ui.addAiTip, onclick: (e) => { e.stopPropagation(); onAdd() } }, lineIcon('ai', 15), h('span', { text: ui.addAiShort })) : null,
    /* The inspector link, named so on the button: an icon alone does not say that it copies a link to this inspector. */
    link ? copyButton(link, { label: () => h('span', { class: 'mcpi-card-share-in' }, lineIcon('flask', 14), h('span', { text: ui.testLink })), copied: () => h('span', { class: 'mcpi-card-share-in' }, lineIcon('check', 14), h('span', { text: ui.copied })), cls: 'mcpi-card-share', title: ui.copyLink }) : null)
}

export function cardOf(s, { ui, onOpen, onRemove, link, onAdd }) {
  const meta = countsText(s.counts)
  return h('div', { class: 'mcpi-card-wrap' },
    h('button', { type: 'button', class: 'mcpi-server mcpi-card', 'data-key': s.key, 'aria-pressed': 'false', onclick: () => onOpen(s) },
      cardBody(s), meta ? h('span', { class: 'mcpi-card-meta', text: meta }) : null),
    cardTools(link, onAdd && (() => onAdd(s)), ui),
    s.custom ? h('button', { type: 'button', class: 'mcpi-remove', 'aria-label': ui.remove, title: ui.remove, onclick: () => onRemove(s) }, lineIcon('close', 14)) : null)
}

export function shareBox(link, ui, onAdd) {
  return [
    h('summary', { text: ui.share }),
    /* Two links to pass on. The inspector link opens this server here, ready to try. */
    h('p', { class: 'mcpi-label mcpi-share-kind' }, lineIcon('flask', 14), h('span', { text: ui.shareLink })),
    h('div', { class: 'mcpi-share-row' },
      h('input', { type: 'text', readonly: true, value: link, class: 'mcpi-share-link', 'aria-label': ui.shareLink, onfocus: (e) => e.target.select() }),
      copyButton(link, { label: () => lineIcon('copy'), copied: () => lineIcon('check'), cls: 'mcpi-btn mcpi-copy mcpi-icon-btn', title: ui.copy })),
    h('p', { class: 'mcpi-hint is-shown', text: ui.shareNote }),
    /* The connect link goes on to an AI client, so it is copied under the client picked in the popup. */
    h('p', { class: 'mcpi-label mcpi-share-kind' }, lineIcon('plug', 14), h('span', { text: ui.addAi })),
    iconButton('ai', ui.addAiBtn, { class: 'mcpi-btn mcpi-add-ai', onclick: onAdd }),
    h('p', { class: 'mcpi-hint is-shown', text: ui.connectNote }),
  ]
}
