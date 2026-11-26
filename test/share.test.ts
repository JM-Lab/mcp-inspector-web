/*
 * share.js: links into the page and the install snippets for MCP clients. Plain functions, no browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkOf, readLink, mergeQuery, registryEntry, slugOf, installsFor } from '../src/share.js'

const custom = (x) => ({ custom: true, kind: 'recent', ...x })

test('linkOf: pinned by key, registry by name, anything else by address, kept short', () => {
  assert.equal(linkOf({ custom: false, key: 'docs', url: 'https://d.example/mcp' }), '?s=docs')
  assert.equal(linkOf(custom({ id: 'io.github.x/y', url: 'https://y.example/mcp' })), '?r=io.github.x/y')
  assert.equal(linkOf(custom({ url: 'https://learn.microsoft.com/api/mcp' })), '?u=learn.microsoft.com/api/mcp', 'https:// is left out')
  assert.equal(linkOf(custom({ url: 'http://localhost:3000/mcp' })), '?u=http://localhost:3000/mcp', 'http:// stays')
  assert.equal(linkOf(custom({ url: 'https://a.example/mcp?k=1&j=2' })), '?u=a.example/mcp%3Fk%3D1%26j%3D2')
  assert.equal(linkOf(null), '')
})

test('linkOf: sign-in goes in as &oauth, and a header token only by its name', () => {
  assert.equal(linkOf(custom({ url: 'https://a.example/mcp', wantsAuth: true })), '?u=a.example/mcp&oauth')
  const withToken = linkOf(custom({ url: 'https://a.example/mcp', wantsAuth: true, headers: { 'X-Key': 'secret' } }))
  assert.equal(withToken, '?u=a.example/mcp&h=X-Key')
  assert.doesNotMatch(withToken, /secret/)
  /* A header the registry already names is not repeated in the link. */
  assert.equal(linkOf(custom({ id: 'a/b', url: 'https://a.example/mcp', hint: 'X-Key', headers: { 'X-Key': 's' } })), '?r=a/b')
})

test('readLink: reads back what linkOf writes, and drops what is not valid', () => {
  const read = (q) => readLink(new URLSearchParams(q))
  const back = (server) => read(linkOf(server))
  assert.equal(back(custom({ url: 'https://a.example/mcp?k=1&j=2' })).url, 'https://a.example/mcp?k=1&j=2')
  assert.deepEqual(read('?r=io.github.x/y&oauth'), { server: '', registry: 'io.github.x/y', url: '', auth: 'oauth', header: '' })
  assert.deepEqual(read('?u=a.example/mcp&h=X-Key'), { server: '', registry: '', url: 'https://a.example/mcp', auth: 'header', header: 'X-Key' })
  assert.equal(read('?u=localhost:3000/mcp').url, 'https://localhost:3000/mcp', 'host:port is not a scheme')
  assert.equal(read('?u=a.example/mcp&h=bad name').header, 'Authorization')
  assert.equal(read('?u=javascript:alert(1)').url, '')
  assert.equal(read('?u=ftp://a.example/mcp').url, '')
  assert.equal(read('?r=../../x').registry, '')
})

test('readLink: the long keys still work, since links with them are already out', () => {
  const read = (q) => readLink(new URLSearchParams(q))
  assert.deepEqual(read('?url=https://a.example/mcp&auth=header&header=X-Key'), { server: '', registry: '', url: 'https://a.example/mcp', auth: 'header', header: 'X-Key' })
  assert.equal(read('?url=https://a.example/mcp&auth=header').header, 'Authorization', 'header defaults to Authorization')
  assert.equal(read('?registry=io.github.x/y&auth=oauth').auth, 'oauth')
  assert.equal(read('?server=docs').server, 'docs')
  assert.equal(read('?auth=token').auth, '')
})

test('mergeQuery: replaces only the keys this page owns', () => {
  assert.equal(mergeQuery('?lang=ko&url=https://old&u=old', '?r=a/b'), '?lang=ko&r=a/b')
  assert.equal(mergeQuery('?lang=ko&r=a/b&oauth', '?u=c.example/mcp'), '?lang=ko&u=c.example/mcp')
  assert.equal(mergeQuery('?code=c&state=s&lang=ko', ''), '?lang=ko')
  assert.equal(mergeQuery('', ''), '')
})

test('registryEntry: one server by name', () => {
  assert.equal(registryEntry('https://registry.modelcontextprotocol.io/v0/servers', 'io.github.x/y'), 'https://registry.modelcontextprotocol.io/v0/servers/io.github.x%2Fy/versions/latest')
})

test('slugOf: a name MCP clients accept', () => {
  assert.equal(slugOf({ id: 'com.microsoft/microsoft-learn-mcp', url: 'https://x' }), 'microsoft-learn-mcp')
  assert.equal(slugOf({ name: 'My Server!', url: 'https://x' }), 'my-server')
  assert.equal(slugOf({ url: 'https://api.example.com:8443/mcp' }), 'api-example-com-8443')
})

test('installsFor: Claude Code, VS Code, Cursor and Claude, with no token in any of them', () => {
  const open = installsFor(custom({ id: 'a/docs', url: 'https://d.example/mcp' }))
  assert.deepEqual(open.map((x) => x.id), ['claude-code', 'vscode', 'cursor', 'claude'])
  assert.equal(open[0].code, 'claude mcp add --transport http docs https://d.example/mcp')
  assert.deepEqual(JSON.parse(decodeURIComponent(open[1].link.replace('vscode:mcp/install?', ''))), { name: 'docs', type: 'http', url: 'https://d.example/mcp' })
  const cursor = new URL(open[2].link)
  assert.equal(cursor.searchParams.get('name'), 'docs')
  assert.deepEqual(JSON.parse(Buffer.from(cursor.searchParams.get('config'), 'base64').toString()), { url: 'https://d.example/mcp' })
  assert.deepEqual(JSON.parse(open[2].code), { mcpServers: { docs: { url: 'https://d.example/mcp' } } })
  assert.equal(open[3].note, 'iClaude')

  const locked = installsFor(custom({ url: 'https://k.example/mcp', headers: { Authorization: 'Bearer secret' } }))
  assert.doesNotMatch(JSON.stringify(locked), /secret/)
  assert.match(locked[0].code, /--header "Authorization: Bearer <token>"$/)
  const vs = JSON.parse(locked[1].code)
  assert.equal(vs.servers['k-example'].headers.Authorization, 'Bearer ${input:token}')
  assert.equal(vs.inputs[0].password, true)
  assert.equal(locked[3].note, 'iClaudeHeader')
})
