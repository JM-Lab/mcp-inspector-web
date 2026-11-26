/*
 * The answer box under Run. It shows the content parts (text, images, links), or the raw JSON with the JSON toggle.
 *   output(ui) → { el, show({ result | error, ms, reveal }), busy(), progress(p) }
 */
import { h, linkify } from './dom.js'
import { partsOf } from './lib.js'

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

export function output(ui) {
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
