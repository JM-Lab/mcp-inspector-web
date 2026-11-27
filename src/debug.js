/*
 * The debugger: what a connection did, drawn from its trace (trace.js). A UI component of its own: it knows nothing about the
 * inspector, brings its own styles and strings, and works with any MCP client that records into a trace.
 *
 *   import { createTrace, debugView, debugNotice } from 'mcp-inspector-web/debug'
 *   const trace = createTrace({ url })
 *   const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: trace.fetch, authProvider })
 *   trace.tap(transport)
 *   const view = debugView(trace, { lang: 'en' })
 *   document.body.append(debugNotice(trace, { onShow: (seq) => view.show(seq) }).el, view.el)
 *
 *   debugView(trace, opts) → { el, show(seq), showFailure(), refresh(), destroy() }
 *     The OAuth flow as eight steps (when there was a sign-in), then every HTTP request with the JSON-RPC messages it carried,
 *     newest first. Filters (all, JSON-RPC, HTTP, errors only), a list or a plain log, and a copy button.
 *     show(seq) opens that row and scrolls to it; showFailure() does so for what failed last.
 *   debugNotice(trace, opts) → { el, refresh(), destroy() }
 *     One line saying what failed and where, with a button that calls opts.onShow(seq). Hidden while nothing failed.
 *     opts.active(): show only while this is true (the inspector: while the connection is failed).
 *     opts.fallback(): the sentence when the trace holds no failure (an error that was not an HTTP request).
 *   failureText(failure, opts) → { title, detail }   the same sentence as data
 *     opts   { lang: 'en' | 'ko', ui: { ...strings } }
 *
 * Everything shown and copied comes from the trace, where secrets were already replaced. Copy leaves out JSON-RPC content
 * (tool arguments and results) unless "include message content" is ticked.
 */
import { createTrace, judge, rowsOf, protocolOf, revisionLevel, toLog, masked, maskedUrl, kindOf, tripStore, HIDE, MODERN_REVISION, NEWEST_LEGACY_REVISION } from './trace.js'
import { STRINGS } from './debug-strings.js'
import { addStyle } from './debug-style.js'
import { lineIcon } from './icons.js'

export { createTrace, judge, rowsOf, protocolOf, revisionLevel, toLog, masked, maskedUrl, kindOf, tripStore, HIDE, MODERN_REVISION, NEWEST_LEGACY_REVISION, STRINGS }

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid)
  return e
}

const stringsOf = (opts = {}) => {
  const base = STRINGS.en
  const lang = STRINGS[opts.lang] || {}
  const ui = opts.ui || {}
  const out = Object.assign({}, base, lang, ui)
  for (const k of ['steps', 'short', 'status', 'how', 'hints']) out[k] = Object.assign({}, base[k], lang[k], ui[k])
  return out
}
const fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')).replace(/\s+$/, '').replace(/\.\s*\.$/, '.')
const STEP_KEYS = ['unauth', 'resource', 'server', 'register', 'redirect', 'return', 'token', 'ready']
const ICON = { ok: 'check', fail: 'cross', warn: 'warn', info: 'dot', busy: 'dot', skip: 'dot', none: 'ring' }
const mark = (level, size = 14) => el('span', { class: 'is-' + level, 'aria-hidden': 'true' }, lineIcon(ICON[level] || 'dot', size))
const hintText = (hint, t) => (hint ? fill(t.hints[hint.code] || hint.code, hint) : '')

export function failureText(failure, opts) {
  const t = opts && opts.hints ? opts : stringsOf(opts)
  if (!failure) return null
  if (failure.step) {
    const n = STEP_KEYS.indexOf(failure.step) + 1
    return { title: fill(t.stopped, { n, step: t.steps[failure.step] }), detail: hintText(failure.hint, t) }
  }
  return { title: t.failed, detail: hintText(failure.hint, t) }
}

/* Redraws at most once a frame: a connection records many events in a burst. */
function onChange(trace, fn) {
  let queued = 0
  const run = () => { queued = 0; fn() }
  const off = trace.subscribe(() => {
    if (queued) return
    queued = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)
  })
  return () => { off(); if (queued && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(queued) }
}

/* Host (left out when it is the MCP server's), path and query, cut from the text: URL would percent-encode the ••• of a hidden value. */
const hostPath = (url, mcpHost) => {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#]*)([^#]*)/i.exec(String(url))
  return m ? (m[1].toLowerCase() === mcpHost ? '' : m[1]) + (m[2] || '/') : String(url)
}
const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const headerText = (h) => Object.entries(h || {}).map(([k, v]) => k + ': ' + v).join('\n')
const clock = (at) => new Date(at).toLocaleTimeString()

export function debugView(trace, opts = {}) {
  addStyle()
  const t = stringsOf(opts)
  const state = { filter: 'all', mode: 'list', messages: false, open: new Set(), hit: null }
  const protoBox = el('p', { class: 'mcpi-dbg-proto', hidden: true })
  const flowBox = el('details', { class: 'mcpi-dbg-flow', hidden: true })
  const rows = el('div', { class: 'mcpi-dbg-rows' })
  const logPre = el('pre', { class: 'mcpi-dbg-log', hidden: true })
  const note = el('p', { class: 'mcpi-dbg-note', hidden: true, text: t.messagesNote })
  const pill = (group, value, label) => el('button', { type: 'button', class: 'mcpi-dbg-pill', ['data-' + group]: value, 'aria-pressed': String(state[group] === value), text: label,
    onclick: () => { state[group] = value; refresh() } })
  const filters = el('div', { class: 'mcpi-dbg-pills', role: 'group' }, pill('filter', 'all', t.all), pill('filter', 'rpc', t.rpc), pill('filter', 'http', t.http), pill('filter', 'errors', t.errors))
  const modes = el('div', { class: 'mcpi-dbg-pills', role: 'group' }, pill('mode', 'list', t.list), pill('mode', 'log', t.log))
  const withMsg = el('input', { type: 'checkbox', onchange: (e) => { state.messages = e.target.checked; refresh() } })
  const copy = el('button', { type: 'button', class: 'mcpi-dbg-copy', title: t.copy, 'aria-label': t.copy }, lineIcon('copy', 16))
  copy.addEventListener('click', async () => {
    const text = logText()
    try { await navigator.clipboard.writeText(text); copy.replaceChildren(lineIcon('check', 16)); copy.classList.add('is-done') } catch (e) { copy.textContent = '✕' }
    setTimeout(() => { copy.replaceChildren(lineIcon('copy', 16)); copy.classList.remove('is-done') }, 1500)
  })
  const bar = el('div', { class: 'mcpi-dbg-bar' }, filters, el('div', { class: 'mcpi-dbg-pills' }, modes, el('label', { class: 'mcpi-dbg-check' }, withMsg, t.withMessages), copy))
  const root = el('div', { class: 'mcpi-dbg' }, protoBox, flowBox, bar, note, rows, logPre)
  let flowOpen = null
  let flowSig = null
  /* Rows by event number, each with what it was drawn from: one that did not change is left in place, untouched. */
  const drawn = new Map()
  flowBox.addEventListener('toggle', () => { flowOpen = flowBox.open })

  let mcpHost = ''
  try { mcpHost = new URL(opts.url || '').host } catch (e) { mcpHost = '' }
  /* Drawn from the stored event once more through the scrubber: a value learned to be secret later is hidden in earlier rows too. */
  const safe = (v) => trace.scrub(v)

  const model = () => rowsOf(trace.events)
  const levelOf = (e, m) => m.level(e)
  const keep = (e, m) => m.keep(e, state.filter)

  function titleOf(e, m) {
    if (e.type === 'http') {
      const rpc = (m.carried.get(e.seq) || []).filter((x) => x.dir === 'out').map((x) => x.method + (x.id != null ? ' #' + x.id : ''))
      const named = rpc.length ? rpc : (e.rpc || []).map((r) => r.method + (r.id != null ? ' #' + r.id : ''))
      const kind = e.kind !== 'mcp' && e.kind !== 'other' ? t.steps[e.kind] : ''
      return e.method + ' ' + hostPath(safe(e.url), mcpHost) + (named.length ? ' · ' + named.join(', ') : kind ? ' · ' + kind : '')
    }
    if (e.type === 'note') {
      if (e.kind === 'start') return '● ' + t.start
      if (e.kind === 'register') return t.steps.register + ' · ' + (t.how[e.how] || e.how)
      if (e.kind === 'redirect' && e.held) return '✕ ' + t.steps.redirect + ' · ' + t.heldShort
      if (e.kind === 'redirect') return '↗ ' + t.steps.redirect + (e.params && e.params.code_challenge_method ? ' · ' + e.params.code_challenge_method : '')
      return '↙ ' + t.returned + (e.params && e.params.error ? ' · ' + e.params.error : e.ok ? ' · code' : '')
    }
    return (e.dir === 'in' ? '← ' : '→ ') + e.method + (e.id != null ? ' #' + e.id : '')
  }

  function sideOf(e) {
    if (e.type === 'http') return [e.status === null ? t.busy : e.redirected ? t.redirected : e.status === 0 ? t.noAnswer : String(e.status), e.ms != null ? e.ms + ' ms' : '']
    return ['', clock(e.at)]
  }

  function part(label, ...blocks) {
    const items = blocks.filter((b) => b && b[1] !== undefined && b[1] !== '' && !(typeof b[1] === 'object' && !Array.isArray(b[1]) && !Object.keys(b[1]).length))
    if (!items.length) return null
    return el('div', { class: 'mcpi-dbg-part' }, el('h4', { text: label }), items.map(([k, v]) => [k ? el('h4', { text: k }) : null, el('pre', { text: typeof v === 'string' ? v : pretty(v) })]))
  }

  function detailOf(e, m, level) {
    const out = []
    const hint = level === 'fail' || level === 'warn' || level === 'info' ? stepHint(e, m) : ''
    if (hint) out.push(el('p', { class: 'mcpi-dbg-hint is-' + level, text: hint }))
    if (e.type === 'http') {
      out.push(part(t.request, ['', e.method + ' ' + safe(e.url)], [t.headers, headerText(safe(e.reqHeaders))], [t.body, safe(e.request)]))
      for (const x of m.carried.get(e.seq) || []) out.push(part(x.dir === 'out' ? t.sent + ' · ' + x.method : t.received, ['', safe(x.message)]))
      if (e.redirected) out.push(part(t.response, ['', t.redirected]))
      else if (e.status === 0) out.push(part(t.response, ['', t.noAnswer + (e.error ? ' (' + safe(e.error) + ')' : '')]))
      else if (e.status != null) out.push(part(t.response, ['', String(e.status)], [t.headers, headerText(safe(e.resHeaders))], [t.body, safe(e.response)]))
    } else if (e.type === 'note') {
      if (e.url) out.push(part(t.request, ['', safe(e.url)]))
      if (e.params) out.push(part(t.body, ['', safe(e.params)]))
    } else out.push(part(e.dir === 'out' ? t.sent : t.received, ['', safe(e.message)]))
    return out
  }

  /* The sentence for a failed row: the step's own hint when the row is where a step failed, else the request's. */
  function stepHint(e, m) {
    const flow = m.judged.flow
    if (flow) for (const st of flow.steps) if (st.hint && (st.at === e.seq || (st.status === 'warn' && st.events.includes(e.seq)))) return hintText(st.hint, t)
    if (m.judged.failure && m.judged.failure.seq === e.seq) return hintText(m.judged.failure.hint, t)
    const p = protocolOf(m.events)
    if (p.fellBack && p.probe && p.probe.seq === e.seq) return fill(t.hints.probe, { asked: p.probe.asked || MODERN_REVISION })
    if (e.type === 'http' && e.kind === 'mcp' && e.method === 'GET' && !e.ok) return hintText({ code: 'noStream', status: e.status || '' }, t)
    if (e.type === 'http' && e.status === 0) return hintText({ code: e.reach === 'cors' ? 'cors' : e.reach === 'unreachable' ? 'unreachable' : e.reach === 'mixed' ? 'mixed' : 'noAnswer', host: hostPath(e.url, '').split('/')[0] }, t)
    const rpcErr = e.type === 'rpc' ? e.message && e.message.error : (m.carried.get(e.seq) || []).map((x) => x.message && x.message.error).find(Boolean)
    if (rpcErr) return 'JSON-RPC ' + rpcErr.code + ' ' + rpcErr.message
    return ''
  }

  /*
   * Which way the protocol is spoken on this connection, and how that was found: server/discover answered (2026-07-28),
   * or it was not and initialize was used. An earlier or older revision is said as what it is, never as a failure.
   */
  let protoSig = null
  function drawProtocol(m) {
    const p = protocolOf(m.events)
    const sig = JSON.stringify(p)
    if (sig === protoSig) return
    protoSig = sig
    protoBox.hidden = !p.era
    if (!p.era) return
    const how = p.era === 'modern' ? t.protoModern : p.fellBack ? fill(t.protoFellBack, { asked: p.probe.asked || MODERN_REVISION, why: [p.probe.status, p.probe.error].filter((x) => x != null && x !== '').join(' ').replace(/[.。]\s*$/, '') || t.noAnswer }) : t.protoLegacy
    const stands = p.level === 'info' ? t.protoInfo : p.level === 'warn' ? t.protoWarn : ''
    protoBox.className = 'mcpi-dbg-proto' + (p.level ? ' is-' + p.level : '')
    protoBox.dataset.era = p.era
    protoBox.dataset.level = p.level || ''
    protoBox.replaceChildren(
      el('b', { text: fill(t.protocol, { v: p.version || '?' }) }),
      el('span', { text: ' · ' + how + (stands ? ' ' + stands : '') }),
      ...(p.fellBack && p.probe.seq != null ? [' ', el('button', { type: 'button', text: t.protoShowProbe, onclick: () => show(p.probe.seq) })] : []))
  }

  function drawFlow(m) {
    const flow = m.judged.flow
    flowBox.hidden = !flow
    /* Drawn again only when a step changed, so what is open or selected in it stays while messages keep coming. */
    const sig = flow ? JSON.stringify(flow.steps) : ''
    if (sig === flowSig) return
    flowSig = sig
    if (!flow) return
    const failed = flow.failed
    const busy = flow.steps.some((s) => s.status === 'busy')
    const done = flow.steps[7].status === 'ok'
    const sum = failed ? fill(t.flowStopped, { n: STEP_KEYS.indexOf(failed.key) + 1 }) : done ? t.flowDone : busy ? t.flowBusy : ''
    flowBox.className = 'mcpi-dbg-flow' + (failed ? ' is-fail' : '')
    if (flowOpen === null && failed) flowBox.open = true
    const strip = el('span', { class: 'mcpi-dbg-strip' }, flow.steps.map((s, i) => [i ? el('i', { text: '›' }) : null,
      el('span', { class: 'is-' + s.status, title: t.steps[s.key] + ': ' + t.status[s.status], 'data-step': s.key, 'data-status': s.status }, lineIcon(ICON[s.status], 12), t.short[s.key])]))
    const list = el('ol', { class: 'mcpi-dbg-steps' }, flow.steps.map((s, i) => {
      const last = s.at != null ? s.at : s.events[s.events.length - 1]
      const name = (i + 1) + '. ' + t.steps[s.key]
      return el('li', { class: 'is-' + s.status, 'data-step': s.key },
        mark(s.status),
        el('span', null, last != null ? el('button', { type: 'button', text: name, onclick: () => show(last) }) : name, el('small', { class: 'is-' + s.status, text: ' · ' + (s.how ? t.how[s.how] : t.status[s.status]) })),
        s.hint ? el('p', { class: 'is-' + s.status, text: hintText(s.hint, t) }) : null)
    }))
    flowBox.replaceChildren(el('summary', null, el('span', { text: t.flow }), el('small', { class: failed ? 'is-fail' : done ? 'is-ok' : 'is-info', text: sum ? '· ' + sum : '' }), strip), list)
  }

  function logText() {
    const m = model()
    const evs = m.events.filter((e) => keep(e, m))
    return trace.scrub(toLog(evs, { messages: state.messages }))
  }

  function refresh() {
    const m = model()
    drawProtocol(m)
    drawFlow(m)
    for (const b of root.querySelectorAll('.mcpi-dbg-pill')) b.setAttribute('aria-pressed', String(state[b.dataset.filter ? 'filter' : 'mode'] === (b.dataset.filter || b.dataset.mode)))
    note.hidden = !state.messages
    logPre.hidden = state.mode !== 'log'
    rows.hidden = state.mode !== 'list'
    if (state.mode === 'log') { logPre.textContent = logText() || t.empty; return }
    const shown = m.list.filter((e) => keep(e, m)).reverse()
    if (!shown.length) { drawn.clear(); rows.replaceChildren(el('p', { class: 'mcpi-dbg-empty', text: m.events.length ? t.none : t.empty })); return }
    const want = shown.map((e) => {
      const level = levelOf(e, m)
      const [status, right] = sideOf(e)
      const title = titleOf(e, m)
      const hit = state.hit === e.seq
      const sig = JSON.stringify([level, status, right, title, hit, e.reach, e.error, (m.carried.get(e.seq) || []).map((x) => x.seq), stepHint(e, m)])
      const had = drawn.get(e.seq)
      if (had && had.sig === sig) return had
      /* A row drawn again (its answer came) stays as the person left it: the toggle event of a row just opened may not have fired yet. */
      if (had && had.el.open) state.open.add(e.seq)
      const d = el('details', { class: 'mcpi-dbg-row is-' + level + (hit ? ' is-hit' : ''), 'data-seq': String(e.seq), 'data-level': level, open: state.open.has(e.seq) },
        el('summary', null, mark(level), el('code', { text: title }), el('span', { class: 'is-' + (level === 'fail' ? 'fail' : 'info'), text: status }), el('span', { text: right })))
      /* Details are drawn when opened: a long session has many rows. */
      const fillIn = () => { if (d.childElementCount < 2) d.append(...detailOf(e, m, level).filter(Boolean)) }
      if (d.open) fillIn()
      d.addEventListener('toggle', () => { if (d.open) { state.open.add(e.seq); fillIn() } else state.open.delete(e.seq) })
      return { seq: e.seq, sig, el: d }
    })
    drawn.clear()
    for (const r of want) drawn.set(r.seq, r)
    /* Put in order with as few moves as it takes: rows already in place are not touched (focus, selection and scroll in them stay). */
    let at = rows.firstChild
    for (const r of want) {
      if (r.el === at) at = at.nextSibling
      else rows.insertBefore(r.el, at)
    }
    while (at) { const next = at.nextSibling; at.remove(); at = next }
  }

  function show(seq) {
    if (seq == null) return
    /* A message folded into its request is shown by opening that request. */
    const ev = trace.events.find((e) => e.seq === seq)
    if (ev && ev.type === 'rpc') {
      const out = ev.dir === 'in' && ev.to != null ? trace.events.find((e) => e.seq === ev.to) : ev
      if (out && out.http != null && trace.events.some((e) => e.seq === out.http)) seq = out.http
    }
    state.mode = 'list'
    state.open.add(seq)
    state.hit = seq
    refresh()
    const find = () => rows.querySelector('[data-seq="' + seq + '"]')
    /* Filtered out (a step that only warned, under Errors only): show everything, so the press always lands. */
    if (!find() && state.filter !== 'all') { state.filter = 'all'; refresh() }
    const row = find()
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' })
  }
  function showFailure() {
    const f = judge(trace.events).failure
    if (f) show(f.seq)
    else refresh()
  }

  const off = onChange(trace, refresh)
  refresh()
  return { el: root, show, showFailure, refresh, destroy: off }
}

export function debugNotice(trace, opts = {}) {
  addStyle()
  const t = stringsOf(opts)
  const title = el('b')
  const detail = el('span')
  const button = el('button', { type: 'button' }, lineIcon('bug', 15), el('span', { text: t.showDebug }))
  const box = el('div', { class: 'mcpi-dbg-notice', role: 'alert', hidden: true }, lineIcon('warn', 18), el('p', null, title, detail), button)
  let seq = null
  button.addEventListener('click', () => { if (opts.onShow) opts.onShow(seq) })
  function refresh() {
    const active = opts.active ? opts.active() : true
    const f = judge(trace.events).failure
    const text = f ? failureText(f, t) : null
    const fallback = opts.fallback ? opts.fallback() : ''
    seq = f ? f.seq : null
    if (!active || (!text && !fallback)) { box.hidden = true; return }
    title.textContent = text ? text.title : fallback
    detail.textContent = text ? (text.detail || (fallback && fallback !== text.title ? fallback : '')) : ''
    box.hidden = false
  }
  const off = onChange(trace, refresh)
  refresh()
  return { el: box, refresh, destroy: off }
}
