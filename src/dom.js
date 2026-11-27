/* Small DOM helpers shared by the UI modules. */
import { lineIcon } from './icons.js'

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

/**
 * A button that says what it does with an icon and a word, the one style for every action button.
 * setLabel changes the word (and the icon, if given) without losing the other.
 */
export function iconButton(icon, text, attrs = {}) {
  return h('button', Object.assign({ type: 'button' }, attrs), lineIcon(icon, 15), h('span', { text }))
}
export function setLabel(b, text, icon) {
  b.querySelector('span').textContent = text
  if (icon) b.querySelector('svg').replaceWith(lineIcon(icon, 15))
}

/**
 * Copies text when pressed and says so on the button for a moment (label, then copied, or ✕ when the browser refuses).
 * The text is also kept in data-copy, so it can be read where the clipboard is not available.
 */
export function copyButton(text, { label, copied, cls = 'mcpi-btn mcpi-copy', title } = {}) {
  const b = h('button', { type: 'button', class: cls, 'data-copy': text, title, 'aria-label': title })
  /* label and copied: text, or a function that draws an icon (the words then go in the tooltip). */
  const show = (v) => { const x = typeof v === 'function' ? v() : v; if (typeof x === 'string') b.textContent = x; else b.replaceChildren(x) }
  const idle = () => label
  show(idle())
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(text); show(copied); b.classList.add('is-done') } catch (err) { show('✕') }
    setTimeout(() => { show(idle()); b.classList.remove('is-done') }, 1500)
  })
  return b
}

/*
 * The last item on the same grid row as `item` (items laid out in a CSS grid, some maybe hidden), so that something
 * placed after it opens right under that row, across the whole width. Rows are known only once the grid is shown.
 */
export function rowEnd(item, skip) {
  let last = item
  for (const x of item.parentElement.children) if (x !== skip && !x.hidden && x.offsetTop === item.offsetTop) last = x
  return last
}

/*
 * A field for a secret (a header token): dots until the eye is pressed, and again when the field is left.
 * Returns the wrapper to put on the page; the input itself is still the one read and written.
 */
export function secretField(input, icon, { show, hide }) {
  input.type = 'password'
  /* Not a sign-in form: password managers should leave it alone. */
  for (const [k, v] of [['autocomplete', 'off'], ['data-1p-ignore', ''], ['data-lpignore', 'true'], ['data-bwignore', '']]) input.setAttribute(k, v)
  const eye = h('button', { type: 'button', class: 'mcpi-eye', title: show, 'aria-label': show, 'aria-pressed': 'false' }, icon('eye', 16))
  const set = (on) => {
    input.type = on ? 'text' : 'password'
    eye.replaceChildren(icon(on ? 'eyeOff' : 'eye', 16))
    eye.title = on ? hide : show
    eye.setAttribute('aria-label', eye.title)
    eye.setAttribute('aria-pressed', String(on))
  }
  eye.addEventListener('click', () => set(input.type === 'password'))
  input.addEventListener('blur', (e) => { if (e.relatedTarget !== eye) set(false) })
  return h('span', { class: 'mcpi-secret' }, input, eye)
}

/*
 * A small i after a label: what it says shows as a tooltip, and pressing it puts the same words on the page (a tooltip
 * does not show on a phone). Returns [button, note]; the note goes wherever the words should appear.
 */
export function infoNote(text, icon) {
  const note = h('p', { class: 'mcpi-hint is-shown mcpi-info-note', hidden: true, text })
  const b = h('button', { type: 'button', class: 'mcpi-i', title: text, 'aria-label': text, 'aria-expanded': 'false' }, icon('info', 14))
  b.addEventListener('click', () => { note.hidden = !note.hidden; b.setAttribute('aria-expanded', String(!note.hidden)) })
  return [b, note]
}

/* Labels sit above inputs. A placeholder alone disappears as soon as you type. */
export const labeled = (label, input) => h('label', { class: 'mcpi-lab' }, typeof label === 'string' ? h('span', { text: label }) : h('span', null, label), input)
