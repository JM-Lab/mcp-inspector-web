/*
 * Scenario: one public MCP server that opens with no auth, in the order a person uses it.
 * The target is Microsoft Learn MCP (com.microsoft/microsoft-learn-mcp in the official MCP Registry), which allows CORS with no auth.
 * Order: find it in the registry, make a card, connect, list tools, run a tool, ping, read History, disconnect.
 * Needs the network. When the registry or the server cannot be reached at all the test is skipped (someone else's outage
 * should not block a release). When it is reached and a step breaks, it fails. `MCPI_SCENARIO=0` turns it off.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registryCards, featuredFor, isNetError } from '../src/lib.js'
import { Conn } from '../src/conn.js'
import { readFileSync } from 'node:fs'

const TARGET = 'com.microsoft/microsoft-learn-mcp'
const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers'
const off = process.env.MCPI_SCENARIO === '0'

test('scenario: find a public server in the registry, connect, run a tool and read History', { skip: off && 'MCPI_SCENARIO=0', timeout: 60000 }, async (t) => {
  /* 1. Find it in the registry (as if typed in the search box). */
  let found
  try {
    found = await (await fetch(`${REGISTRY}?version=latest&limit=20&search=${encodeURIComponent(TARGET)}`, { signal: AbortSignal.timeout(15000) })).json()
  } catch (e) { t.skip('registry not reachable: ' + (e as Error).message); return }
  const card = registryCards(found.servers).find((c) => c.id === TARGET)
  assert.ok(card, 'target not in the registry: ' + TARGET)
  assert.match(card.url, /^https:\/\/learn\.microsoft\.com\//)

  /* The prepared 'No auth needed' list has it under the same address (as if picked with the filter). */
  const featured = JSON.parse(readFileSync(new URL('../demo/featured.json', import.meta.url), 'utf8'))
  assert.ok(featuredFor('open', featured).some((s: { url: string }) => s.url === card.url), 'featured.json address differs from the registry')

  /* 2. Press the card: connect and fetch the lists. */
  const c = new Conn({ key: card.url, name: card.name, url: card.url })
  let live
  try { live = await c.connect() } catch (e) {
    if (isNetError(e)) { t.skip('target not reachable: ' + (e as Error).message); return }
    throw e
  }
  t.after(() => c.close())
  assert.equal(c.state, 'connected')
  assert.equal(c.needAuth, false)
  assert.ok(live.info.serverInfo.name, 'server name')
  assert.ok(live.info.protocolVersion, 'protocol version')
  assert.ok(live.tools.length > 0, 'at least one tool')

  /* 3. Pick the search tool, fill it in and Run. */
  const tool = live.tools.find((x: { name: string }) => /search/.test(x.name)) || live.tools[0]
  const props = (tool.inputSchema && tool.inputSchema.properties) || {}
  const arg = 'query' in props ? 'query' : Object.keys(props)[0]
  const result = await c.send('tools/call', { name: tool.name, arguments: arg ? { [arg]: 'Model Context Protocol' } : {} })
  assert.ok(!result.isError, 'the tool answers without error')
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'the answer has content')
  assert.equal(typeof c.lastMs, 'number')

  /* 4. Ping. */
  await c.send('ping')

  /* 5. History: every request has its response. */
  const methods = c.log.filter((e: { dir: string }) => e.dir === 'out').map((e: { method: string }) => e.method)
  for (const m of ['initialize', 'tools/list', 'tools/call', 'ping']) assert.ok(methods.includes(m), 'missing from History: ' + m)
  const call = c.log.find((e: { method: string }) => e.method === 'tools/call')
  assert.ok(call.response && call.ms != null, 'tools/call keeps its response and timing')

  /* 6. Disconnect. */
  c.close()
  assert.equal(c.state, 'idle')
})
