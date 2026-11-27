/*
 * The inspector as an HTML element, for pages that would rather write a tag than call mount():
 *
 *   <link rel="stylesheet" href="…/mcp-inspector.css">
 *   <mcp-inspector lang="ko" page-url="https://example.com/inspector"></mcp-inspector>
 *   <script src="…/mcp-inspector.js" defer></script>          the script tag bundle defines it on load
 *
 *   import { defineInspector } from 'mcp-inspector-web'      or from npm, then
 *   defineInspector()                                         registers <mcp-inspector> (or another tag name)
 *
 * Attributes are the simple options; el.options = { … } takes any option of mount() (servers, ui, oauth, …) and wins over them.
 * It mounts when it is put on the page, and is taken down (connections closed) when it is removed.
 * A changed attribute or options mounts it again. No shadow DOM: the stylesheet and --mcpi-* variables style it as they do mount().
 */
import { mount } from './app.js'

/* attribute → option, and how its text becomes the value */
const bool = (v) => v !== 'false' && v !== '0'
export const ATTRIBUTES = {
  lang: ['lang', String],
  'page-url': ['pageUrl', String],
  registry: ['registry', (v) => (v === 'false' ? false : v)],
  featured: ['featured', String],
  'storage-prefix': ['storagePrefix', String],
  'sync-url': ['syncUrl', bool],
  'open-first': ['openFirst', bool],
  'hold-private': ['holdPrivate', bool],
}

/** The options an element's attributes give, with el.options over them. */
export function optionsOf(el) {
  const out = {}
  for (const [attr, [key, read]] of Object.entries(ATTRIBUTES)) {
    const v = el.getAttribute(attr)
    if (v != null) out[key] = read(v)
  }
  return Object.assign(out, el._options)
}

export function defineInspector(tag = 'mcp-inspector') {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  customElements.define(tag, class extends HTMLElement {
    static get observedAttributes() { return Object.keys(ATTRIBUTES) }
    get options() { return this._options || {} }
    set options(v) { this._options = v || {}; this.remount() }
    /* Mounted a moment after it is attached, so options set right after creating it are there for the first mount. */
    connectedCallback() { if (!this._inst) queueMicrotask(() => { if (this.isConnected && !this._inst) this.remount() }) }
    disconnectedCallback() { if (this._inst) { this._inst.destroy(); this._inst = null } }
    attributeChangedCallback() { if (this._inst) this.remount() }
    remount() {
      if (!this.isConnected) return
      if (this._inst) this._inst.destroy()
      this._inst = mount(this, optionsOf(this))
    }
    /** The mounted inspector ({ destroy() }), once it is on the page. */
    get inspector() { return this._inst || null }
  })
}
