/*
 * What the right side shows for one item: a tool, a prompt, a resource or template. (The Debug tab is debug.js.)
 *   panes(ctx) → { tools(tool), prompts(prompt), resources(resource) }
 * The first three return { pane }. ctx is the page's view of the open server:
 *   ctx.cfg, ctx.ui                 options and strings
 *   ctx.current()                   the open server
 *   ctx.conn(), ctx.snap()          its connection (conn.js) and the lists last read from it
 *   ctx.connect(server, quiet)      connects again when the connection dropped
 *   ctx.renderHead()                redraws the server heading (status, timings)
 *   ctx.explain(error)              the error sentence shown to a person
 */
import { h, iconButton, setLabel } from './dom.js'
import { form } from './form.js'
import { output } from './output.js'

export function panes(ctx) {
  const { cfg, ui } = ctx
  const capsOf = () => (ctx.snap() && ctx.snap().info && ctx.snap().info.capabilities) || {}

  /* While a request runs, Cancel stands next to the button. It makes the SDK send notifications/cancelled. */
  async function call(out, btn, method, params) {
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    out.busy()
    const c = ctx.conn()
    const ac = new AbortController()
    const stop = iconButton('stop', 'Cancel', { class: 'mcpi-btn', onclick: () => ac.abort() }, { compact: true })
    btn.after(stop)
    try {
      if (c.state !== 'connected') await ctx.connect(ctx.current(), true)
      const result = await c.send(method, params, { signal: ac.signal, onprogress: (p) => out.progress(p), resetTimeoutOnProgress: true })
      out.show({ result, ms: c.lastMs, reveal: true })
    } catch (e) {
      out.show({ error: ac.signal.aborted ? 'Cancelled' : c.state === 'failed' ? c.error : ctx.explain(e), reveal: true })
    }
    stop.remove()
    btn.disabled = false
    btn.removeAttribute('aria-busy')
    ctx.renderHead()
  }

  /* When the server declares completions, inputs get suggestions (prompt arguments, resource template variables). */
  function completer(f, ref) {
    const c = ctx.conn()
    if (!capsOf().completions || f.input.tagName !== 'INPUT') return
    const list = h('datalist', { id: f.input.id + '-list' })
    f.input.setAttribute('list', list.id)
    f.input.after(list)
    let timer = 0
    let seq = 0
    f.input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const mine = ++seq
        try {
          const r = await c.send('completion/complete', { ref, argument: { name: f.name, value: f.input.value } })
          if (mine === seq) list.replaceChildren(...((r.completion && r.completion.values) || []).map((v) => h('option', { value: v })))
        } catch (e) { /* no suggestions */ }
      }, 250)
    })
  }

  function intro(name, title, text) {
    const p = text ? h('p', { class: 'mcpi-desc is-clamped', text, title: ui.more }) : null
    if (p) p.addEventListener('click', () => p.classList.remove('is-clamped'))
    return [h('h3', null, h('code', { text: name }), title && title !== name ? h('span', { text: title }) : null), p]
  }

  function tools(tool) {
    const f = form(tool.inputSchema, ui)
    const out = output(ui)
    const run = iconButton('play', 'Run', { class: 'mcpi-run' })
    /* A tool its server marks destructive runs on the second press: the first one says what it may do. */
    const risky = !!(tool.annotations && tool.annotations.destructiveHint === true)
    let armed = 0
    const disarm = () => { clearTimeout(armed); armed = 0; setLabel(run, 'Run', 'play'); run.classList.remove('is-sure') }
    run.addEventListener('click', () => {
      const args = f.check()
      if (!args) return
      if (risky && !armed) { setLabel(run, ui.runSure, 'warn'); run.classList.add('is-sure'); armed = setTimeout(disarm, 6000); return }
      if (risky) disarm()
      call(out, run, 'tools/call', { name: tool.name, arguments: args })
    })
    /* Examples only fill in values. The answer comes from the server on Run (no stored answers are shown). */
    const chips = (cfg.servers.find((x) => x.key === ctx.current().key) || {}).examples || []
    const mine = chips.filter((x) => x.tool === tool.name).map((ex) => h('button', {
      type: 'button', class: 'mcpi-chip', text: typeof ex.label === 'string' ? ex.label : ex.label[cfg.lang] || ex.label.en, title: JSON.stringify(ex.args),
      onclick: (e) => {
        for (const c of e.currentTarget.parentNode.querySelectorAll('.mcpi-chip')) c.classList.toggle('is-on', c === e.currentTarget)
        f.set(ex.args)
      },
    }))
    const hints = tool.annotations || {}
    const tags = [hints.readOnlyHint && 'read-only', hints.destructiveHint && 'destructive', hints.openWorldHint && 'open-world'].filter(Boolean)
    return {
      pane: h('div', { class: 'mcpi-item' }, intro(tool.name, tool.title || hints.title, tool.description),
        tags.length ? h('p', { class: 'mcpi-tags' }, tags.map((t) => h('span', { text: t }))) : null,
        mine.length ? h('div', { class: 'mcpi-examples' }, h('span', { class: 'mcpi-examples-label', text: ui.examples }), mine) : null, f.el, h('div', { class: 'mcpi-actions' }, run), out.el),
    }
  }

  function prompts(p) {
    const schema = { properties: {}, required: [] }
    for (const a of p.arguments || []) {
      schema.properties[a.name] = { type: 'string', description: a.description }
      if (a.required) schema.required.push(a.name)
    }
    const f = form(schema, ui)
    for (const x of f.fields) completer(x, { type: 'ref/prompt', name: p.name })
    const out = output(ui)
    const run = iconButton('play', 'Get', { class: 'mcpi-run' })
    run.addEventListener('click', () => { const args = f.check(); if (args) call(out, run, 'prompts/get', { name: p.name, arguments: args }) })
    return { pane: h('div', { class: 'mcpi-item' }, intro(p.name, p.title, p.description), f.el, h('div', { class: 'mcpi-actions' }, run), out.el) }
  }

  function resources(r) {
    const out = output(ui)
    const run = iconButton('book', 'Read', { class: 'mcpi-run' })
    const c = ctx.conn()
    const caps = capsOf()
    let formEl = null
    let sub = null
    if (r.uriTemplate) {
      const vars = [...r.uriTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
      const simple = vars.length && vars.every((v) => /^[\w.-]+$/.test(v))
      if (simple) {
        const f = form({ properties: Object.fromEntries(vars.map((v) => [v, { type: 'string' }])), required: vars }, ui)
        for (const x of f.fields) completer(x, { type: 'ref/resource', uri: r.uriTemplate })
        formEl = f.el
        run.addEventListener('click', () => {
          const vals = f.check()
          if (!vals) return
          call(out, run, 'resources/read', { uri: r.uriTemplate.replace(/\{([^}]+)\}/g, (_, v) => encodeURIComponent(vals[v] == null ? '' : vals[v])) })
        })
      } else {
        const uri = h('input', { type: 'text', value: r.uriTemplate, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'URI' })
        formEl = h('div', { class: 'mcpi-form' }, h('div', { class: 'mcpi-field' }, h('label', { text: 'uri' }), h('div', null, uri)))
        run.addEventListener('click', () => call(out, run, 'resources/read', { uri: uri.value.trim() }))
      }
    } else {
      run.addEventListener('click', () => call(out, run, 'resources/read', { uri: r.uri }))
      if (caps.resources && caps.resources.subscribe) {
        sub = iconButton(c.subs.has(r.uri) ? 'bellOff' : 'bell', c.subs.has(r.uri) ? 'Unsubscribe' : 'Subscribe', { class: 'mcpi-btn', 'aria-pressed': c.subs.has(r.uri) ? 'true' : 'false' }, { compact: true })
        sub.addEventListener('click', async () => {
          sub.disabled = true
          sub.setAttribute('aria-busy', 'true')
          try {
            if (c.state !== 'connected') await ctx.connect(ctx.current(), true)
            await c.send(c.subs.has(r.uri) ? 'resources/unsubscribe' : 'resources/subscribe', { uri: r.uri })
          } catch (e) { out.show({ error: ctx.explain(e) }) }
          sub.disabled = false
          sub.removeAttribute('aria-busy')
          setLabel(sub, c.subs.has(r.uri) ? 'Unsubscribe' : 'Subscribe', c.subs.has(r.uri) ? 'bellOff' : 'bell')
          sub.setAttribute('aria-pressed', c.subs.has(r.uri) ? 'true' : 'false')
        })
      }
    }
    return {
      pane: h('div', { class: 'mcpi-item' }, intro(r.uri || r.uriTemplate, r.title || r.name, r.description),
        r.mimeType ? h('p', { class: 'mcpi-tags' }, h('span', { text: r.mimeType })) : null,
        formEl, h('div', { class: 'mcpi-actions' }, run, sub), out.el),
    }
  }

  return { tools, prompts, resources }
}
