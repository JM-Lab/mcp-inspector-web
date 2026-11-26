/* Small DOM helpers shared by the UI modules. */

/** Makes an element. attrs: class, text, on<event> handlers, anything else as an attribute (true is an empty attribute, null and false are left out). */
export function h(tag, attrs, ...kids) {
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

/** Appends text to pre, with every http(s) address as a link. */
export function linkify(pre, text) {
  let last = 0
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const url = m[0].replace(/[.,;:]+$/, '')
    pre.append(text.slice(last, m.index), h('a', { href: url, rel: 'noopener', target: '_blank', text: url }))
    last = m.index + url.length
  }
  pre.append(text.slice(last))
}

/* Labels sit above inputs. A placeholder alone disappears as soon as you type. */
export const labeled = (label, input) => h('label', { class: 'mcpi-lab' }, h('span', { text: label }), input)
