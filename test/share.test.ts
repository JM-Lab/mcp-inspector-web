/*
 * share.js: links into the page. Plain functions, no browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkOf, readLink, mergeQuery, registryEntry, handoffStore } from '../src/share.js'

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
  assert.deepEqual(read('?r=io.github.x/y&oauth'), { server: '', registry: 'io.github.x/y', url: '', auth: 'oauth', header: '', to: '' })
  assert.deepEqual(read('?u=a.example/mcp&h=X-Key'), { server: '', registry: '', url: 'https://a.example/mcp', auth: 'header', header: 'X-Key', to: '' })
  assert.equal(read('?u=localhost:3000/mcp').url, 'https://localhost:3000/mcp', 'host:port is not a scheme')
  assert.equal(read('?u=a.example/mcp&h=bad name').header, 'Authorization')
  assert.equal(read('?u=javascript:alert(1)').url, '')
  assert.equal(read('?u=ftp://a.example/mcp').url, '')
  assert.equal(read('?r=../../x').registry, '')
})

test('readLink: the long keys still work, since links with them are already out', () => {
  const read = (q) => readLink(new URLSearchParams(q))
  assert.deepEqual(read('?url=https://a.example/mcp&auth=header&header=X-Key'), { server: '', registry: '', url: 'https://a.example/mcp', auth: 'header', header: 'X-Key', to: '' })
  assert.equal(read('?url=https://a.example/mcp&auth=header').header, 'Authorization', 'header defaults to Authorization')
  assert.equal(read('?registry=io.github.x/y&auth=oauth').auth, 'oauth')
  assert.equal(read('?server=docs').server, 'docs')
  assert.equal(read('?auth=token').auth, '')
})

test('readLink: &to= names the AI client to hand the server on to', () => {
  const read = (q) => readLink(new URLSearchParams(q))
  assert.equal(read('?u=a.example/mcp&to=vscode').to, 'vscode')
  assert.equal(read('?r=io.x/y&to=claude-code').to, 'claude-code')
  assert.equal(read('?u=a.example/mcp&to=../evil').to, '', 'only a client id')
  assert.equal(read('?u=a.example/mcp').to, '')
  assert.equal(mergeQuery('?lang=ko&u=a.example/mcp&to=vscode', '?u=a.example/mcp'), '?lang=ko&u=a.example/mcp', 'to is dropped once read, so a reload does not hand on again')
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

test('handoffStore: &to= waits for its own server, once, and survives an OAuth return only when restored', () => {
  const mem = new Map()
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
  const a = handoffStore(storage, 'k')
  a.keep('https://a.example/mcp', 'lmstudio')
  assert.equal(a.take('https://b.example/mcp'), null, 'another server does not take it')
  assert.equal(a.take('https://a.example/mcp'), 'lmstudio')
  assert.equal(a.take('https://a.example/mcp'), null, 'only once')
  assert.equal(mem.size, 0)

  handoffStore(storage, 'k').keep('https://a.example/mcp', 'cursor')
  const later = handoffStore(storage, 'k')
  assert.equal(later.take('https://a.example/mcp'), null, 'a new page load starts clean')
  later.restore()
  assert.equal(later.take('https://a.example/mcp'), 'cursor', 'back from OAuth, it is read again')

  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  const b = handoffStore(broken, 'k')
  b.keep('https://a.example/mcp', 'vscode')
  b.restore()
  assert.equal(b.take('https://a.example/mcp'), null, 'blocked storage is not an error')
})
