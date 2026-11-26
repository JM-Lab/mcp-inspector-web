/*
 * Input forms built from a JSON Schema: tool arguments, prompt arguments, resource template variables and elicitation.
 *   form(schema, ui) → { el, fields, check(), values(), set(args) }
 * Up to four fields show at first (required and enum fields first), the rest fold under "More parameters".
 */
import { h } from './dom.js'
import { kindOf, parseValue, missingRequired } from './lib.js'

const TYPE_LABEL = { list: 'array', num: 'number', bool: 'boolean', json: 'json', enum: 'enum', text: 'string' }

/* Required fields carry a 'required' tag. When one is empty, Run does not send and points at it. A required select starts empty too (no first value filled in silently). */
function field(name, prop, required, ui) {
  const kind = kindOf(prop)
  const id = 'mcpi-f-' + name
  let input
  const blank = h('option', { value: '', text: required ? ui.pick : '' })
  if (kind === 'enum') input = h('select', { id }, blank, prop.enum.map((v) => h('option', { value: String(v), text: String(v) })))
  else if (kind === 'bool') input = h('select', { id }, blank, h('option', { value: 'true', text: 'true' }), h('option', { value: 'false', text: 'false' }))
  else if (kind === 'json') input = h('textarea', { id, rows: 3, spellcheck: 'false', placeholder: 'JSON' })
  else input = h('input', { id, type: 'text', inputmode: kind === 'num' ? 'decimal' : null, autocomplete: 'off', spellcheck: 'false', placeholder: kind === 'list' ? 'a, b, c' : kind === 'num' ? '0' : null })
  if (required) input.setAttribute('aria-required', 'true')
  const msg = h('p', { class: 'mcpi-field-err', hidden: true })
  const set = (v) => {
    if (v == null) input.value = ''
    else if (kind === 'list') input.value = [].concat(v).join(', ')
    else if (kind === 'json') input.value = JSON.stringify(v, null, 2)
    else input.value = String(v)
    flag('')
  }
  const flag = (text) => { msg.textContent = text; msg.hidden = !text; el.classList.toggle('is-bad', !!text); input.setAttribute('aria-invalid', text ? 'true' : 'false') }
  const el = h('div', { class: 'mcpi-field' + (required ? ' is-req' : '') },
    h('label', { for: id }, h('span', { text: name }), required ? h('b', { class: 'mcpi-req', text: ui.required }) : null, h('small', { text: TYPE_LABEL[kind] })),
    h('div', null, input, msg, prop.description ? h('p', { class: 'mcpi-hint', text: prop.description }) : null))
  /* Defaults go in after el exists (set touches el; doing it earlier left tools with defaults unrendered). */
  if (prop.default !== undefined) set(prop.default)
  input.addEventListener('input', () => flag(''))
  input.addEventListener('change', () => flag(''))
  return { name, el, set, input, required, flag, main: required || kind === 'enum', read: () => parseValue(kind, input.value, prop) }
}

export function form(schema, ui) {
  const props = (schema && schema.properties) || {}
  const req = new Set((schema && schema.required) || [])
  const fields = Object.entries(props).map(([name, prop]) => field(name, prop || {}, req.has(name), ui))
  let shown = fields.filter((f) => f.main)
  for (const f of fields) if (shown.length < 4 && !shown.includes(f)) shown.push(f)
  shown = fields.filter((f) => shown.includes(f))
  const rest = fields.filter((f) => !shown.includes(f))
  const more = rest.length ? h('details', { class: 'mcpi-more' }, h('summary', { text: ui.moreParams.replace('{v}', rest.length) }), rest.map((f) => f.el)) : null
  return {
    fields,
    el: fields.length ? h('div', { class: 'mcpi-form' }, req.size ? h('p', { class: 'mcpi-req-note' }, h('b', { class: 'mcpi-req', text: ui.required }), ' ' + ui.requiredNote) : null, shown.map((f) => f.el), more) : null,
    /* Collects values. Empty or malformed fields are flagged and null is returned. */
    check() {
      const out = {}
      const bad = []
      for (const f of fields) {
        const r = f.read()
        if (r.error) { f.flag(r.error === 'num' ? ui.badNum : ui.badJson); bad.push(f) }
        else if (r.value !== undefined) out[f.name] = r.value
      }
      for (const name of missingRequired(schema, out)) { const f = fields.find((x) => x.name === name); if (f && !bad.includes(f)) { f.flag(ui.missing); bad.push(f) } }
      if (!bad.length) return out
      if (more && bad.some((f) => rest.includes(f))) more.open = true
      bad[0].input.focus()
      return null
    },
    values() { const v = this.check(); if (!v) throw new Error('invalid'); return v },
    set(args) {
      for (const f of fields) f.set(args ? args[f.name] : undefined)
      if (more) more.open = !!args && rest.some((f) => args[f.name] != null)
    },
  }
}
