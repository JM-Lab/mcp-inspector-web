/*
 * Logic with no UI (src/lib.js), and the storage rules of OAuth sign-in (src/oauth.js).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as lib from '../src/lib.js'
import { oauthStore, PENDING_MAX_MS } from '../src/oauth.js'
import { CLIENT_INFO } from '../src/conn.js'
import { STRINGS } from '../src/strings.js'


test('cleanUrl: accepts and normalizes http(s) only', () => {
  assert.equal(lib.cleanUrl('  https://example.com/mcp '), 'https://example.com/mcp')
  assert.equal(lib.cleanUrl('http://localhost:4396/mcp'), 'http://localhost:4396/mcp')
  assert.equal(lib.cleanUrl('example.com/mcp'), null)
  assert.equal(lib.cleanUrl('javascript:alert(1)'), null)
  assert.equal(lib.cleanUrl(''), null)
})

test('pickRemote: streamable-http, https and no template variables only', () => {
  const sv = { remotes: [
    { type: 'sse', url: 'https://a.example/sse' },
    { type: 'streamable-http', url: 'http://a.example/mcp' },
    { type: 'streamable-http', url: 'https://{tenant}.example/mcp' },
    { type: 'streamable-http', url: 'https://a.example/mcp' },
  ] }
  assert.equal(lib.pickRemote(sv).url, 'https://a.example/mcp')
  assert.equal(lib.pickRemote({ remotes: [{ type: 'sse', url: 'https://a.example/sse' }] }), null)
  assert.equal(lib.pickRemote({}), null)
  assert.equal(lib.pickRemote(null), null)
})

test('registryCard: carries name, description, required header and icon', () => {
  const card = lib.registryCard({
    name: 'com.example/mcp', title: 'Example', description: 'desc', websiteUrl: 'https://example.com',
    icons: [{ src: 'http://insecure/x.png' }, { src: 'https://example.com/icon.png' }],
    remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'X-Opt' }, { name: 'X-Key', isSecret: true, value: 'Bearer ${API_KEY}' }] }],
  })
  assert.deepEqual(card, { id: 'com.example/mcp', name: 'Example', desc: 'desc', url: 'https://mcp.example.com/mcp', hint: 'X-Key', hintValue: 'Bearer <API_KEY>', icon: 'https://example.com/icon.png', web: 'https://example.com' })
  assert.equal(lib.registryCard({ name: 'x', remotes: [] }), null)
  assert.equal(lib.registryCard({ name: 'n', remotes: [{ type: 'streamable-http', url: 'https://a.example/mcp' }] }).name, 'n')
  const local = { name: 'l', remotes: [{ type: 'streamable-http', url: 'http://localhost:3000/mcp' }] }
  assert.equal(lib.registryCard(local), null, 'http only when asked (a page on http)')
  assert.equal(lib.registryCard(local, { http: true }).url, 'http://localhost:3000/mcp')
})

test('isActive: deprecated and deleted registry entries are left out of every list', () => {
  const meta = (status) => ({ _meta: { 'io.modelcontextprotocol.registry/official': { status } } })
  assert.equal(lib.isActive(meta('active')), true)
  assert.equal(lib.isActive(meta('deprecated')), false)
  assert.equal(lib.isActive(meta('deleted')), false)
  assert.equal(lib.isActive({ server: {} }), true, 'no status is taken as active')
  const mk = (n, status) => ({ server: { name: n, remotes: [{ type: 'streamable-http', url: 'https://' + n + '.example/mcp' }] }, ...meta(status) })
  assert.deepEqual(lib.registryCards([mk('a', 'active'), mk('b', 'deprecated'), mk('c', 'deleted'), mk('d', 'active')]).map((c) => c.id), ['a', 'd'])
})

test('registryCards: drops entries with no remote and repeated addresses, up to max', () => {
  const mk = (n, url) => ({ server: { name: n, remotes: url ? [{ type: 'streamable-http', url }] : [] } })
  const cards = lib.registryCards([mk('a', 'https://a.example/mcp'), mk('b'), mk('a2', 'https://a.example/mcp'), mk('c', 'https://c.example/mcp'), mk('d', 'https://d.example/mcp')], 2)
  assert.deepEqual(cards.map((c) => c.id), ['a', 'c'])
  assert.deepEqual(lib.registryCards(undefined), [])
})

test('iconCandidates: registry icon, website, server host, parent domain, no repeats', () => {
  assert.deepEqual(lib.iconCandidates({ icon: 'https://cdn.example/i.png', web: 'https://example.com/docs', url: 'https://mcp.example.com/mcp' }),
    ['https://cdn.example/i.png', 'https://example.com/favicon.ico', 'https://mcp.example.com/favicon.ico'])
  assert.deepEqual(lib.iconCandidates({ url: 'https://example.com/mcp' }), ['https://example.com/favicon.ico'])
  assert.deepEqual(lib.iconCandidates({ web: 'https://github.com/MicrosoftDocs/mcp', url: 'https://learn.microsoft.com/api/mcp' }), ['https://learn.microsoft.com/favicon.ico', 'https://microsoft.com/favicon.ico'], 'a code host favicon is not used')
  assert.deepEqual(lib.iconCandidates({ url: 'http://localhost:4396/mcp' }), [])
  assert.deepEqual(lib.iconCandidates({ url: 'https://10.0.0.1/mcp' }), ['https://10.0.0.1/favicon.ico'])
})

test('pushFront: puts first, keeps an address once, drops the oldest past ten', () => {
  let list: { url: string }[] = []
  for (let i = 1; i <= 12; i++) list = lib.pushFront(list, { url: 'https://s' + i + '.example/mcp' })
  assert.equal(list.length, lib.CAP)
  assert.equal(lib.CAP, 10)
  assert.equal(list[0].url, 'https://s12.example/mcp')
  assert.equal(list[9].url, 'https://s3.example/mcp')
  const again = lib.pushFront(list, { url: 'https://s5.example/mcp' })
  assert.equal(again.length, 10)
  assert.equal(again[0].url, 'https://s5.example/mcp')
  assert.equal(again.filter((x) => x.url === 'https://s5.example/mcp').length, 1)
})

test('filled: empty values never overwrite real ones', () => {
  assert.deepEqual(lib.filled({ a: 1, b: null, c: '', d: undefined, e: 0, f: false }), { a: 1, e: 0, f: false })
  assert.deepEqual(Object.assign({ headers: { A: 'b' } }, lib.filled({ headers: null })), { headers: { A: 'b' } })
})

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, v) }, dump: () => Object.fromEntries(m) }
}

test('storage: added and recent servers are kept apart and read back', () => {
  const store = memory()
  const mine = [{ url: 'https://a.example/mcp', name: 'A', headers: { Authorization: 'Bearer x' }, key: 'k', custom: true, kind: 'mine' }]
  const recent = [{ url: 'https://b.example/mcp', name: 'B', desc: 'd', icon: 'https://b.example/i.png' }]
  const session = memory()
  lib.saveStore(store, { mine, recent }, undefined, session)
  const back = lib.loadStore(store, undefined, session)
  assert.deepEqual(back.mine, [{ url: 'https://a.example/mcp', id: '', authHeader: 'Authorization', name: 'A', desc: '', icon: '', web: '', hint: '', hintValue: '', headers: { Authorization: 'Bearer x' } }])
  assert.equal(back.recent[0].name, 'B')
  assert.equal(back.recent[0].icon, 'https://b.example/i.png')
  assert.ok(!('key' in back.mine[0]), 'UI-only fields are not saved')
})

test('storage: a header token value is kept for the tab only, and the list keeps just the header name', () => {
  const local = memory()
  const session = memory()
  const mine = [{ url: 'https://a.example/mcp', name: 'A', headers: { 'X-Api-Key': 'key-SECRET-1' } }]
  const recent = [{ url: 'https://b.example/mcp', name: 'B', headers: { Authorization: 'Bearer tok-SECRET-2' } }, { url: 'https://c.example/mcp', name: 'C' }]
  lib.saveStore(local, { mine, recent }, 'p', session)
  const inLocal = local.dump()['p:v2']
  assert.ok(!inLocal.includes('key-SECRET-1') && !inLocal.includes('tok-SECRET-2'), 'no token value in localStorage')
  assert.match(inLocal, /"authHeader":"X-Api-Key"/, 'the header name is remembered')
  assert.deepEqual(Object.keys(session.dump()), ['p:header-tokens'])
  /* The same tab: the token is there. */
  const same = lib.loadStore(local, 'p', session)
  assert.deepEqual(same.mine[0].headers, { 'X-Api-Key': 'key-SECRET-1' })
  assert.deepEqual(same.recent.map((s) => s.headers), [{ Authorization: 'Bearer tok-SECRET-2' }, null])
  assert.equal(same.moved, undefined)
  /* A new tab (an empty sessionStorage): the server and the header name are there, the value is not. */
  const fresh = lib.loadStore(local, 'p', memory())
  assert.deepEqual([fresh.mine[0].headers, fresh.mine[0].authHeader], [null, 'X-Api-Key'])
  assert.deepEqual([fresh.recent[0].headers, fresh.recent[0].authHeader], [null, 'Authorization'])
  /* With no session storage at all, a token is not kept anywhere. */
  const only = memory()
  lib.saveStore(only, { mine, recent: [] }, 'p')
  assert.ok(!JSON.stringify(only.dump()).includes('key-SECRET-1'))
  /* Taking the token off a server takes it out of the session too. */
  const removable = Object.assign(memory(), { removeItem(k: string) { delete (this as unknown as { gone: string }).gone; (this as unknown as { removed: string }).removed = k } })
  lib.saveStore(local, { mine: [{ url: 'https://a.example/mcp', name: 'A' }], recent: [] }, 'p', removable)
  assert.equal((removable as unknown as { removed: string }).removed, 'p:header-tokens')
})

test('storage: a token an earlier version left in localStorage is used once, reported, and gone after the next save', () => {
  const old = { mine: [{ url: 'https://a.example/mcp', name: 'A', headers: { Authorization: 'Bearer old-SECRET-3' } }], recent: [] }
  const local = memory({ 'p:v2': JSON.stringify(old) })
  const session = memory()
  const back = lib.loadStore(local, 'p', session)
  assert.equal(back.moved, true)
  assert.deepEqual(back.mine[0].headers, { Authorization: 'Bearer old-SECRET-3' }, 'still works in this tab')
  assert.equal(back.mine[0].authHeader, 'Authorization')
  lib.saveStore(local, back, 'p', session)
  assert.ok(!JSON.stringify(local.dump()).includes('old-SECRET-3'), 'taken out of localStorage')
  assert.match(JSON.stringify(session.dump()), /old-SECRET-3/)
  assert.equal(lib.loadStore(local, 'p', session).moved, undefined)
})

test('storage: keeps ten of each', () => {
  const store = memory()
  const many = Array.from({ length: 15 }, (_, i) => ({ url: 'https://s' + i + '.example/mcp' }))
  lib.saveStore(store, { mine: many, recent: many })
  const back = lib.loadStore(store)
  assert.equal(back.mine.length, 10)
  assert.equal(back.recent.length, 10)
})

test('storage: v1 (an array) reads as added servers, broken values as empty lists', () => {
  const v1 = lib.loadStore(memory({ [lib.storeKeys().v1]: JSON.stringify([{ url: 'https://old.example/mcp', name: 'Old' }, { url: 'nope' }, null]) }))
  assert.deepEqual(v1.mine.map((s) => s.url), ['https://old.example/mcp'])
  assert.deepEqual(v1.recent, [])
  assert.deepEqual(lib.loadStore(memory({ [lib.storeKeys().v2]: '{broken' })), { mine: [], recent: [] })
  assert.deepEqual(lib.loadStore(memory({ [lib.storeKeys().v2]: JSON.stringify({ mine: 'x', recent: [{ url: 'ftp://x' }] }) })), { mine: [], recent: [] })
  assert.doesNotThrow(() => lib.saveStore({ getItem: () => null, setItem: () => { throw new Error('quota') } }, { mine: [], recent: [] }))
})

test('kindOf: which input a schema property becomes', () => {
  assert.equal(lib.kindOf({ enum: ['a'] }), 'enum')
  assert.equal(lib.kindOf({ type: 'boolean' }), 'bool')
  assert.equal(lib.kindOf({ type: 'integer' }), 'num')
  assert.equal(lib.kindOf({ type: ['number', 'null'] }), 'num')
  assert.equal(lib.kindOf({ anyOf: [{ type: 'string' }, { type: 'number' }] }), 'num')
  assert.equal(lib.kindOf({ type: 'array', items: { type: 'string' } }), 'list')
  assert.equal(lib.kindOf({ type: 'array', items: { type: 'object' } }), 'json')
  assert.equal(lib.kindOf({ type: 'object' }), 'json')
  assert.equal(lib.kindOf({ type: 'string' }), 'text')
  assert.equal(lib.kindOf(undefined), 'text')
})

test('parseValue: empty is not sent, bad numbers and JSON are stopped before sending', () => {
  assert.deepEqual(lib.parseValue('text', '  '), { value: undefined })
  assert.deepEqual(lib.parseValue('text', ' Seoul '), { value: 'Seoul' })
  assert.deepEqual(lib.parseValue('num', '12'), { value: 12 })
  assert.deepEqual(lib.parseValue('num', '-1.5'), { value: -1.5 })
  assert.deepEqual(lib.parseValue('num', 'ten'), { error: 'num' })
  assert.deepEqual(lib.parseValue('bool', 'false'), { value: false })
  assert.deepEqual(lib.parseValue('enum', '3', { enum: [1, 3] }), { value: 3 })
  assert.deepEqual(lib.parseValue('list', 'a, b,,c '), { value: ['a', 'b', 'c'] })
  assert.deepEqual(lib.parseValue('json', '{"a":1}'), { value: { a: 1 } })
  assert.deepEqual(lib.parseValue('json', '{a:1}'), { error: 'json' })
})

test('missingRequired: returns only the empty required fields', () => {
  const schema = { required: ['query', 'ids'], properties: {} }
  assert.deepEqual(lib.missingRequired(schema, {}), ['query', 'ids'])
  assert.deepEqual(lib.missingRequired(schema, { query: 'medicine', ids: [] }), ['ids'])
  assert.deepEqual(lib.missingRequired(schema, { query: 'medicine', ids: ['a'] }), [])
  assert.deepEqual(lib.missingRequired({}, {}), [])
  assert.deepEqual(lib.missingRequired({ required: ['flag'] }, { flag: false }), [], 'false is a value')
})
test('countsText: zero counts are left out', () => {
  assert.equal(lib.countsText({ tools: 7, prompts: 3, resources: 3 }), '7 tools · 3 prompts · 3 resources')
  assert.equal(lib.countsText({ tools: 4, prompts: 0, resources: 2 }), '4 tools · 2 resources')
  assert.equal(lib.countsText(undefined), '')
})

test('featuredFor: open filters to servers with no auth', () => {
  const f = { servers: [{ id: 'a', open: true }, { id: 'b', open: false }, { id: 'c' }] }
  assert.deepEqual(lib.featuredFor('known', f).map((s) => s.id), ['a', 'b', 'c'])
  assert.deepEqual(lib.featuredFor('open', f).map((s) => s.id), ['a'])
  assert.deepEqual(lib.featuredFor('open', null), [])
})

test('errors: tells needing auth from not reaching', () => {
  assert.ok(lib.isAuthError(Object.assign(new Error('x'), { name: 'UnauthorizedError' })))
  assert.ok(lib.isAuthError({ status: 401 }))
  assert.ok(lib.isAuthError(new Error('HTTP 401 Unauthorized')))
  assert.ok(!lib.isAuthError(new Error('HTTP 500')))
  assert.ok(lib.isNetError(new TypeError('Failed to fetch')))
  assert.ok(lib.isNetError(new Error('fetch failed')))
  assert.ok(!lib.isNetError(new Error('Method not found')))
})
test('storage: the prefix keeps two inspectors on one origin apart', () => {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, v) } }
  lib.saveStore(store, { mine: [{ url: 'https://a.example/mcp' }], recent: [] }, 'site')
  assert.deepEqual([...m.keys()], ['site:v2'])
  assert.equal(lib.loadStore(store, 'site').mine.length, 1)
  assert.equal(lib.loadStore(store).mine.length, 0)
})

test('clientMetadataFor: a URL, or a map of page origin to URL', () => {
  assert.equal(lib.clientMetadataFor(null, 'https://a.example'), undefined)
  assert.equal(lib.clientMetadataFor('https://a.example/client.json', 'https://b.example'), 'https://a.example/client.json')
  const map = { 'https://a.example': 'https://a.example/client.json' }
  assert.equal(lib.clientMetadataFor(map, 'https://a.example'), 'https://a.example/client.json')
  assert.equal(lib.clientMetadataFor(map, 'http://localhost:8787'), undefined)
})

test('OAuth round trip values live in localStorage, so another tab can finish it', () => {
  const store = () => { const m = new Map(); return { m, getItem: (k: string) => (m.has(k) ? m.get(k) : null), setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) } }
  const local = store()
  const session = store()
  let went = ''
  const page = { origin: 'https://a.example', pathname: '/inspector', assign: (u: string) => { went = u } }
  const auth = oauthStore({ prefix: 'p', oauth: {}, local, session, page })
  const server = { key: 'k', name: 'S', url: 'https://s.example/mcp' }
  const pv = auth.provider(server)
  assert.equal(pv.redirectUrl, 'https://a.example/inspector')
  pv.saveCodeVerifier('v1')
  pv.saveTokens({ access_token: 't' })
  pv.redirectToAuthorization('https://s.example/authorize')
  assert.equal(went, 'https://s.example/authorize')
  assert.ok(local.m.has('p:verifier:' + server.url), 'PKCE verifier')
  assert.ok(local.m.has('p:oauth'), 'which server')
  assert.ok(session.m.has('p:tokens:' + server.url) && !local.m.has('p:tokens:' + server.url), 'tokens go when the tab closes')
  assert.ok(auth.hasTokens(server))
  assert.equal(auth.takePending().url, server.url)
  assert.equal(auth.takePending(), null, 'used once')
  pv.redirectToAuthorization('https://s.example/authorize')
  assert.equal(auth.takePending(Date.now() + PENDING_MAX_MS + 1), null, 'too old')
  /* The authorization server found before leaving is there on return (another tab too), and goes with the verifier. */
  pv.saveDiscoveryState({ authorizationServerUrl: 'https://as.example' })
  assert.equal(auth.provider(server).discoveryState().authorizationServerUrl, 'https://as.example')
  auth.startSignIn(server)
  assert.equal(pv.discoveryState(), undefined, 'a new sign-in looks it up again')
  pv.saveDiscoveryState({ authorizationServerUrl: 'https://as.example' })
  auth.clearVerifier(server)
  assert.equal(pv.codeVerifier(), '')
  assert.equal(pv.discoveryState(), undefined)
})

test('OAuth leaves the page only when the page allows it (a button press), and says where it goes first', () => {
  const store = () => { const m = new Map(); return { m, getItem: (k: string) => (m.has(k) ? m.get(k) : null), setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) } }
  const local = store()
  let went = ''
  let allowed = false
  const told: string[] = []
  const page = { origin: 'https://a.example', pathname: '/', assign: (u: string) => { went = u } }
  const auth = oauthStore({ prefix: 'p', oauth: {}, local, session: store(), page, allowRedirect: () => allowed, onRedirect: (_s: unknown, u: string, leaving: boolean) => { told.push(leaving + ' ' + u) } })
  const pv = auth.provider({ key: 'k', name: 'S', url: 'https://s.example/mcp' })
  /* The SDK asking by itself (a refused code, an expired token): nothing happens. */
  pv.redirectToAuthorization('https://s.example/authorize')
  assert.equal(went, '')
  assert.equal(local.m.has('p:oauth'), false)
  assert.deepEqual(told, ['false https://s.example/authorize'], 'told that it was held')
  allowed = true
  pv.redirectToAuthorization('https://s.example/authorize')
  assert.equal(went, 'https://s.example/authorize')
  assert.deepEqual(told, ['false https://s.example/authorize', 'true https://s.example/authorize'])
})

test('partsOf: tool content, resource contents, prompt messages', () => {
  assert.deepEqual(lib.partsOf({ content: [{ type: 'text', text: 'a' }] }), [{ type: 'text', text: 'a' }])
  assert.deepEqual(lib.partsOf({ contents: [{ uri: 'x', text: 'b' }] }), [{ uri: 'x', text: 'b' }])
  assert.deepEqual(lib.partsOf({ messages: [{ role: 'user', content: { type: 'text', text: 'c' } }] }), [{ role: 'user', type: 'text', text: 'c' }])
  assert.equal(lib.partsOf({}), null)
})

test('explainError: the sentence a person sees', () => {
  const ui = { failOauth: 'oauth', failDcr: 'dcr', failCors: 'cors', failAuth: 'auth' }
  assert.equal(lib.explainError(Object.assign(new Error('x'), { name: 'AbortError' }), false, ui), 'Cancelled')
  assert.equal(lib.explainError(new TypeError('Failed to fetch'), true, ui), 'oauth')
  assert.equal(lib.explainError(new TypeError('Failed to fetch'), false, ui), 'cors')
  assert.equal(lib.explainError(new Error('does not support dynamic client registration'), true, ui), 'dcr')
  assert.equal(lib.explainError({ status: 401, message: 'no' }, false, ui), 'auth')
  assert.equal(lib.explainError(new Error('other'), false, ui), 'other')
})

test('the version sent in initialize is the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(CLIENT_INFO.version, pkg.version)
})

test('the page carries nothing site specific', () => {
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
    assert.ok(!/aljal/i.test(src), f + ' mentions a site')
  }
})

test('isPrivateAddress: this computer and private networks, which a link must not make the page call by itself', () => {
  for (const u of ['http://localhost:3000/mcp', 'http://app.localhost/mcp', 'http://127.0.0.1:8080/mcp', 'https://10.1.2.3/mcp', 'http://172.16.0.1/mcp', 'http://172.31.255.1/mcp', 'http://192.168.0.10/mcp', 'http://169.254.1.1/mcp', 'http://printer.local/mcp', 'http://[::1]:9000/mcp', 'http://[fd00::1]/mcp', 'http://0.0.0.0/mcp']) assert.equal(lib.isPrivateAddress(u), true, u)
  for (const u of ['https://example.com/mcp', 'https://172.32.0.1/mcp', 'https://11.0.0.1/mcp', 'https://localhost.example.com/mcp', 'not a url']) assert.equal(lib.isPrivateAddress(u), false, u)
})

test('revisionNote: what to say about a revision, and what this inspector uses that an older one lacks', () => {
  assert.deepEqual(lib.revisionNote('2026-07-28'), { level: 'current', missing: [] })
  assert.deepEqual(lib.revisionNote('2025-11-25'), { level: 'info', missing: [] })
  assert.deepEqual(lib.revisionNote('2025-06-18'), { level: 'warn', missing: [] }, 'older, but with everything used here')
  assert.deepEqual(lib.revisionNote('2025-03-26'), { level: 'warn', missing: ['elicitation', 'titles'] })
  assert.deepEqual(lib.revisionNote('2024-11-05'), { level: 'warn', missing: ['elicitation', 'titles', 'annotations', 'completions'] })
  assert.deepEqual(lib.revisionNote(undefined), { level: null, missing: [] })
  /* Each thing named has its words in both languages. */
  for (const lang of ['en', 'ko'] as const) for (const k of ['featElicitation', 'featTitles', 'featAnnotations', 'featCompletions', 'protoCurrent', 'protoEarlier', 'protoOld', 'protoInfo', 'protoWarn', 'protoWarnNone', 'pingModern']) assert.ok(STRINGS[lang][k], lang + ' ' + k)
})

test('Korean text says 인증 for signing in to a server, never 로그인, in the inspector, the debugger and the Add to AI popup', () => {
  /* The site's wording: 인증. Every Korean string of the three parts is checked, nested ones too. */
  const all = (v: unknown): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(all) : []
  for (const f of ['strings.js', 'debug-strings.js', 'add-to-ai-strings.js']) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /로그인/, f)
  }
  assert.equal(STRINGS.ko.needSignIn, '인증 필요')
  assert.ok(all(STRINGS.ko).length > 50)
})
