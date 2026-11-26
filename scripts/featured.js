#!/usr/bin/env node
/*
 * Builds featured.json, the "Well known" and "No auth needed" lists of the registry panel.
 * The official MCP Registry has no popularity order, so each name below (a registry name) is looked up one by one
 * for its remote address, description and icon. Only official entries in namespaces the registry verified
 * (com.notion, app.linear, io.github.<org>) are listed.
 * Each server gets one initialize with no auth and a browser Origin; whether it opens is written to `open`.
 * Entries that left the registry or lost their remote are dropped with a warning. If none can be fetched the file is left alone.
 *
 *   node scripts/featured.js --out demo/featured.json --origin https://example.com
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { registryCard, REGISTRY, isActive } from '../src/lib.js'
import { CLIENT_INFO } from '../src/conn.js'

/** [registry name, display name, remote to use when there are several, favicon of the company site when the registry has no icon] */
export const FEATURED = [
  ['com.microsoft/microsoft-learn-mcp', 'Microsoft Learn'],
  ['co.huggingface/hf-mcp-server', 'Hugging Face', 'https://huggingface.co/mcp'],
  ['io.github.upstash/context7', 'Context7'],
  ['ai.exa/exa', 'Exa'],
  ['io.github.github/github-mcp-server', 'GitHub', '', 'https://github.com/favicon.ico'],
  ['com.notion/mcp', 'Notion', '', 'https://www.notion.so/images/favicon.ico'],
  ['app.linear/linear', 'Linear', 'https://mcp.linear.app/mcp'],
  ['io.github.getsentry/sentry-mcp', 'Sentry'],
  ['com.stripe/mcp', 'Stripe', '', 'https://stripe.com/favicon.ico'],
  ['com.atlassian/atlassian-mcp-server', 'Atlassian'],
  ['com.figma.mcp/mcp', 'Figma', '', 'https://www.figma.com/favicon.ico'],
  ['com.supabase/mcp', 'Supabase'],
  ['com.canva.mcp/mcp', 'Canva', '', 'https://www.canva.com/favicon.ico'],
  ['com.vercel/vercel-mcp', 'Vercel', '', 'https://vercel.com/favicon.ico'],
  ['com.paypal.mcp/mcp', 'PayPal', '', 'https://www.paypal.com/favicon.ico'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function lookup(name, registry = REGISTRY) {
  const json = await (await fetch(`${registry}?version=latest&limit=20&search=${encodeURIComponent(name)}`)).json()
  /* Only an active entry: a deprecated or deleted one is left out of the list. */
  const hit = (json.servers || []).filter(isActive).map((x) => x.server || x).find((s) => s.name === name)
  return hit || null
}

/** Whether initialize succeeds with no auth from a browser on this origin. */
export async function opens(url, origin) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: CLIENT_INFO } }),
      signal: AbortSignal.timeout(15000),
    })
    const cors = res.headers.get('access-control-allow-origin')
    const text = await res.text()
    return res.ok && (cors === '*' || cors === origin) && /"serverInfo"/.test(text)
  } catch (e) { return false }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'demo/featured.json' }, origin: { type: 'string', default: 'https://example.com' } } })
  const OUT = resolve(values.out)
  const servers = []
  for (const [name, title, want, icon] of FEATURED) {
    try {
      const sv = await lookup(name)
      if (!sv) { console.warn(`[featured] ${name}: not in the registry, dropped`); continue }
      if (want) sv.remotes = (sv.remotes || []).filter((r) => r.url === want)
      const card = registryCard(sv)
      if (!card) { console.warn(`[featured] ${name}: no usable remote, dropped`); continue }
      card.name = title || card.name
      card.desc = card.desc.replace(/\s*[\u2013\u2014]\s*/g, ', ') /* the demo site's text rules have no dashes */
      card.icon = card.icon || icon || ''
      card.open = await opens(card.url, values.origin)
      if (card.open) card.hint = ''
      servers.push(card)
      console.log(`[featured] ${name}: ${card.url}${card.open ? ' (opens with no auth)' : ''}`)
    } catch (e) { console.warn(`[featured] ${name}: fetch failed, dropped. ${e.message}`) }
    await sleep(300)
  }
  if (!servers.length) { console.error('[featured] nothing fetched, file left alone'); process.exit(2) }
  const asOf = new Date().toISOString().slice(0, 10)
  writeFileSync(OUT, JSON.stringify({ asOf, servers }, null, 1) + '\n')
  console.log(`[featured] ${servers.length} servers (${servers.filter((s) => s.open).length} open with no auth) -> ${OUT}`)
  process.exit(servers.length === FEATURED.length ? 0 : 1)
}
