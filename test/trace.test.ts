/*
 * The connection trace (src/trace.js): what each request is, that no secret is kept, how the OAuth flow is judged,
 * a request with no answer, and keeping a sign-in across the redirect. The flow tests run Conn against the local server.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTrace, judge, rowsOf, protocolOf, revisionLevel, toLog, masked, maskedUrl, kindOf, tripStore, HIDE } from '../src/trace.js'
import { failureText, STRINGS } from '../src/debug.js'
import { Conn } from '../src/conn.js'
import { startMcpServer } from './support/mcp-server.ts'

let base = ''
let stop = () => {}
before(async () => { const s = await startMcpServer(); base = s.base; stop = s.close })
after(() => stop())

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

test('maskedUrl and masked: secrets replaced by name, the rest kept as it was', () => {
  assert.equal(maskedUrl('https://a.example/cb?code=abc123&state=xyz&iss=https%3A%2F%2Fas'), 'https://a.example/cb?code=' + HIDE + '&state=' + HIDE + '&iss=https%3A%2F%2Fas')
  assert.equal(maskedUrl('https://a.example/authorize?client_id=c1&code_challenge=XYZ'), 'https://a.example/authorize?client_id=c1&code_challenge=XYZ', 'a PKCE challenge is public')
  assert.deepEqual(masked({ access_token: 'at', nested: { refresh_token: 'rt', ok: 1 }, list: [{ client_secret: 's' }], code_verifier: 'v', empty: '' }),
    { access_token: HIDE, nested: { refresh_token: HIDE, ok: 1 }, list: [{ client_secret: HIDE }], code_verifier: HIDE, empty: '' })
})

test('kindOf: the MCP server, metadata, registration, token', () => {
  const mcp = 'https://s.example/mcp'
  assert.equal(kindOf('POST', mcp, '{"jsonrpc":"2.0"}', mcp), 'mcp')
  assert.equal(kindOf('GET', 'https://s.example/.well-known/oauth-protected-resource/mcp', undefined, mcp), 'resource')
  assert.equal(kindOf('GET', 'https://as.example/.well-known/oauth-authorization-server', undefined, mcp), 'server')
  assert.equal(kindOf('GET', 'https://as.example/.well-known/openid-configuration', undefined, mcp), 'server')
  assert.equal(kindOf('POST', 'https://as.example/register', '{"redirect_uris":["x"]}', mcp), 'register')
  assert.equal(kindOf('POST', 'https://as.example/token', 'grant_type=authorization_code&code=x', mcp), 'token')
  assert.equal(kindOf('GET', 'https://other.example/', undefined, mcp), 'other')
})

test('the traced fetch records a request and its answer, hands the response back untouched, and keeps no secret', async () => {
  const fake = async () => json(200, { access_token: 'tok-SECRET-1', refresh_token: 'ref-SECRET-2', token_type: 'Bearer', note: 'echo tok-SECRET-1' })
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: fake })
  const res = await trace.fetch('https://as.example/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: 'code-SECRET-3', code_verifier: 'ver-SECRET-4', client_id: 'c1' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': 'key-SECRET-5' } })
  assert.equal((await res.json()).access_token, 'tok-SECRET-1', 'the caller still gets the real answer')
  const [e] = trace.events
  assert.equal(e.kind, 'token')
  assert.equal(e.status, 200)
  assert.equal(typeof e.ms, 'number')
  assert.equal(e.request.client_id, 'c1')
  assert.equal(e.reqHeaders['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(e.reqHeaders['x-api-key'], HIDE, 'a header value that is not known to be harmless is hidden')
  assert.equal(e.response.token_type, 'Bearer')
  assert.equal(e.response.note, 'echo ' + HIDE, 'a secret is scrubbed wherever else it turns up')
  /* A later request carrying the token (a header, say) does not show it either. */
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"initialize"}', headers: { authorization: 'Bearer tok-SECRET-1' } })
  const all = JSON.stringify(trace.events) + toLog(trace.events, { messages: true })
  for (const s of ['tok-SECRET-1', 'ref-SECRET-2', 'code-SECRET-3', 'ver-SECRET-4', 'key-SECRET-5']) assert.ok(!all.includes(s), s + ' is not kept')
})

test('the MCP event stream is never read: only a JSON answer that is not a stream is', async () => {
  let cloned = 0
  const stream = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-SECRET' }), clone() { cloned++; throw new Error('read') } }
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => stream as unknown as Response })
  const res = await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
  assert.equal(res, stream)
  assert.equal(cloned, 0)
  const [e] = trace.events
  assert.deepEqual(e.rpc, [{ method: 'tools/list', id: 1 }], 'which message it carried, not its content')
  assert.equal(e.request, undefined)
  assert.equal(e.resHeaders['mcp-session-id'], HIDE)
})

test('a request with no answer is a failure with its reason, and the probe tells CORS from an address that does not answer', async () => {
  for (const [probeOk, reach] of [[true, 'cors'], [false, 'unreachable']] as const) {
    const fake = async (_u: unknown, init?: RequestInit) => { if (init && init.mode === 'no-cors') { if (probeOk) return new Response(null); throw new TypeError('x') } throw new TypeError('Failed to fetch') }
    const trace = createTrace({ url: 'https://s.example/mcp', fetch: fake, probe: true })
    await assert.rejects(trace.fetch('https://as.example/token', { method: 'POST', body: 'grant_type=authorization_code&code=c' }), TypeError, 'the error still reaches the caller')
    const [e] = trace.events
    assert.equal(e.status, 0)
    assert.equal(e.ok, false)
    assert.equal(e.error, 'Failed to fetch')
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(e.reach, reach)
    assert.equal(judge(trace.events).failure!.hint.code, reach)
  }
})

test('JSON-RPC messages are tied to the HTTP request that carried them, and their answers to them', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null, { status: 202 }) })
  trace.begin()
  trace.sent({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}' })
  trace.received({ jsonrpc: '2.0', id: 0, result: { ok: true } })
  trace.received({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  const [out, http, reply, note] = trace.events
  assert.equal(out.http, http.seq)
  assert.equal(out.reply, reply.seq)
  assert.equal(reply.to, out.seq)
  assert.equal(note.to, undefined, 'a notification from the server stands on its own')
  /* A new connection starts its ids again: a reply is tied only within its own run. */
  trace.begin()
  trace.received({ jsonrpc: '2.0', id: 0, result: {} })
  assert.equal(trace.events[trace.events.length - 1].to, undefined)
  assert.doesNotMatch(toLog(trace.events), /"ok"/, 'the log leaves message content out unless asked')
  assert.match(toLog(trace.events, { messages: true }), /"ok":true/)
})

test('judge: a CORS block on the SDK header that worked on retry is a warning, missing resource metadata too', () => {
  const ev = (o: object, seq: number) => Object.assign({ type: 'http', seq, run: 1, at: 0, ms: 1, method: 'GET', reqHeaders: {}, resHeaders: {} }, o)
  const events = [
    { type: 'note', kind: 'start', seq: 1, run: 1, at: 0 },
    ev({ kind: 'mcp', method: 'POST', url: 'https://s.example/mcp', status: 401, ok: false, resHeaders: { 'www-authenticate': 'Bearer' } }, 2),
    ev({ kind: 'resource', url: 'https://s.example/.well-known/oauth-protected-resource/mcp', status: 404, ok: false }, 3),
    ev({ kind: 'resource', url: 'https://s.example/.well-known/oauth-protected-resource', status: 404, ok: false }, 4),
    ev({ kind: 'server', url: 'https://s.example/.well-known/oauth-authorization-server', status: 0, ok: false, error: 'Failed to fetch' }, 5),
    ev({ kind: 'server', url: 'https://s.example/.well-known/oauth-authorization-server', status: 200, ok: true, response: { registration_endpoint: 'x' } }, 6),
  ]
  const { flow, failure, level } = judge(events)
  const st = Object.fromEntries(flow!.steps.map((s) => [s.key, s]))
  assert.equal(st.unauth.status, 'ok')
  assert.equal(st.resource.status, 'warn')
  assert.equal(st.resource.hint!.code, 'noPrm')
  assert.equal(st.server.status, 'warn')
  assert.equal(st.server.hint!.code, 'corsHeader')
  assert.equal(st.register.status, 'none')
  assert.equal(failure, null)
  assert.equal(level(events[1]), 'info', 'the 401 that starts sign-in is expected')
  assert.equal(level(events[4]), 'info', 'a try that a later one made good is not marked failed')
})

test('judge: an event stream (GET) that does not open is a warning, not the failure', () => {
  const ev = (o: object, seq: number) => Object.assign({ type: 'http', seq, run: 1, at: 0, ms: 1, kind: 'mcp', url: 'https://s.example/mcp', reqHeaders: {}, resHeaders: {} }, o)
  const events = [ev({ method: 'POST', status: 200, ok: true }, 1), ev({ method: 'GET', status: 0, ok: false, error: 'Failed to fetch' }, 2)]
  const { failure, level } = judge(events)
  assert.equal(level(events[1]), 'warn')
  assert.equal(failure, null)
})

test('tripStore: kept per server until the page comes back, read once, gone when dropped', () => {
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } }
  const trip = tripStore(storage, 'p')
  trip.save('https://a/mcp', [{ type: 'note', kind: 'start' }])
  assert.equal(trip.take('https://b/mcp').length, 0, 'another server has none')
  assert.equal(trip.take('https://a/mcp').length, 1)
  assert.equal(trip.take('https://a/mcp').length, 0, 'read once')
  trip.save('https://a/mcp', [{ type: 'note', kind: 'start' }])
  trip.drop('https://a/mcp')
  assert.equal(mem.size, 0)
  trip.save('https://a/mcp', [{ type: 'note' }])
  assert.equal(trip.take('https://a/mcp', -1).length, 0, 'too old')
})

/* An OAuth provider standing in for browser storage, as in conn.test.ts. Instead of navigating it records the address. */
function memoryProvider() {
  const mem: Record<string, unknown> = {}
  return {
    mem, went: '',
    get redirectUrl() { return 'http://app.example/' },
    get clientMetadata() { return { client_name: 'test', redirect_uris: ['http://app.example/'], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' } },
    clientInformation: () => mem.client, saveClientInformation: (v: unknown) => { mem.client = v },
    tokens: () => mem.tokens, saveTokens: (v: unknown) => { mem.tokens = v },
    saveCodeVerifier: (v: unknown) => { mem.verifier = v }, codeVerifier: () => (mem.verifier as string) || '',
    saveDiscoveryState: (v: unknown) => { mem.discovery = v }, discoveryState: () => mem.discovery,
    redirectToAuthorization(url: URL) { this.went = String(url) },
  }
}

/* Sign in the way the page does: start, leave (exported), come back (restored into a new trace), finish. */
async function signIn(path: string, onTrip?: (p: ReturnType<typeof memoryProvider>) => void) {
  const p = memoryProvider()
  const server = { key: 'k', url: base + path }
  const first = new Conn(server, { authProvider: () => p, hasTokens: () => !!p.mem.tokens })
  await first.connect({ oauth: true }).catch(() => {})
  if (!p.went) return { trace: first.trace, p }
  first.trace.redirect(p.went)
  const kept = JSON.parse(JSON.stringify(first.trace.export()))
  first.close()
  if (onTrip) onTrip(p)
  const back = new URL((await fetch(p.went, { redirect: 'manual' })).headers.get('location')!).searchParams
  const second = new Conn(server, { authProvider: () => p, hasTokens: () => !!p.mem.tokens })
  second.trace.restore(kept)
  second.trace.returned(back)
  await second.connect({ oauth: true, callback: back }).catch(() => {})
  const state = second.state
  const error = second.error
  second.close()
  return { trace: second.trace, p, kept, code: back.get('code'), state, error }
}
const statuses = (trace: ReturnType<typeof createTrace>) => judge(trace.events).flow!.steps.map((s) => s.key + ':' + s.status)

test('a full PKCE round trip: eight steps done, across the redirect, with no secret in the trace or what is kept', async () => {
  const { trace, p, kept, code } = await signIn('/oauth-mcp')
  assert.deepEqual(statuses(trace), ['unauth:ok', 'resource:ok', 'server:ok', 'register:ok', 'redirect:ok', 'return:ok', 'token:ok', 'ready:ok'])
  assert.equal(judge(trace.events).failure, null)
  assert.ok(kept!.every((e: { type: string }) => e.type !== 'rpc'), 'no JSON-RPC content is kept for the trip')
  const all = JSON.stringify(trace.events) + JSON.stringify(kept) + toLog(trace.events, { messages: true })
  for (const s of ['good-token', code!, p.mem.verifier as string]) assert.ok(!all.includes(s), 'not kept: ' + s)
  assert.match(toLog(trace.events), /↗ authorization page .*code_challenge_method=S256/)
})

test('no dynamic registration: the flow stops at step 4 and says why', async () => {
  const { trace } = await signIn('/nodcr-mcp')
  assert.deepEqual(statuses(trace).slice(0, 5), ['unauth:ok', 'resource:ok', 'server:ok', 'register:fail', 'redirect:none'])
  const f = judge(trace.events).failure!
  assert.equal(f.step, 'register')
  assert.equal(f.hint.code, 'noDcr')
})

test('a code the token endpoint refuses: the flow stops at the token exchange with the server’s own error', async () => {
  const { trace } = await signIn('/badtoken-mcp')
  assert.deepEqual(statuses(trace).slice(4), ['redirect:ok', 'return:ok', 'token:fail', 'ready:none'])
  const f = judge(trace.events).failure!
  assert.equal(f.step, 'token')
  assert.equal(f.hint.code, 'oauthError')
  assert.equal(f.hint.error, 'invalid_grant')
})

test('a sign-in sent back with an error: the return step fails with it', () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null) })
  trace.begin({ signIn: true })
  trace.redirect('https://as.example/authorize?client_id=c1&code_challenge=X&code_challenge_method=S256&state=st-SECRET')
  trace.returned(new URLSearchParams({ error: 'access_denied', error_description: 'The user said no', state: 'st-SECRET' }))
  const f = judge(trace.events).failure!
  assert.equal(f.step, 'return')
  assert.equal(f.hint.code, 'returnError')
  assert.equal(f.hint.error, 'access_denied')
  assert.ok(!JSON.stringify(trace.events).includes('st-SECRET'))
  assert.equal(judge(trace.events).flow!.steps.find((s) => s.key === 'register')!.how, 'saved', 'no registration request: the client was registered before')
})

test('on return, the code goes only to the authorization server found before leaving (SEP-2352)', async () => {
  /* Kept across the trip, so on return metadata is not looked up again. */
  const { trace } = await signIn('/oauth-mcp')
  const back = trace.events.findIndex((e) => e.type === 'note' && e.kind === 'return')
  assert.ok(!trace.events.slice(back).some((e) => e.type === 'http' && (e.kind === 'resource' || e.kind === 'server')), 'no second metadata lookup')
  /* Another authorization server recorded than the one the client was registered with: refused before any token request. */
  const tampered = await signIn('/oauth-mcp', (p) => { (p.mem.discovery as { authorizationServerMetadata: { issuer: string } }).authorizationServerMetadata.issuer = 'https://other.example' })
  assert.equal(tampered.state, 'failed')
  assert.ok(!tampered.trace.events.some((e) => e.type === 'http' && e.kind === 'token'), 'the code was not sent')
})

/* ---- more of the logic, none of it needing a browser ---- */

const http = (o: object) => Object.assign({ type: 'http', kind: 'mcp', method: 'POST', url: 'https://s.example/mcp', status: 200, ok: true, ms: 1, at: 0, reqHeaders: {}, resHeaders: {} }, o)
const numbered = (list: object[]) => list.map((e, i) => Object.assign({ seq: i + 1, run: 1, at: 0 }, e)) as any[]

test('masked: under a secret name everything is hidden whole, but a JSON-RPC error code stays a number', () => {
  assert.deepEqual(masked({ error: { code: -32602, message: 'Invalid params' }, code: 'abc', token: null, secret: '', password: 12345678, cookie: ['sid=abcdefgh'], key: { value: 'abcdefgh' } }),
    { error: { code: -32602, message: 'Invalid params' }, code: HIDE, token: null, secret: '', password: HIDE, cookie: HIDE, key: HIDE })
})

test('an address: a password before the host, loosely named query keys and a stray % are all handled', async () => {
  assert.equal(maskedUrl('https://user:hunter2pass@s.example/mcp?x=1'), 'https://' + HIDE + '@s.example/mcp?x=1')
  assert.equal(maskedUrl('https://s.example/mcp?sessionId=abc123&X-Auth-Token=t&sig=zz&jwt=j&page=2&code_challenge=C&token_type=Bearer'),
    'https://s.example/mcp?sessionId=' + HIDE + '&X-Auth-Token=' + HIDE + '&sig=' + HIDE + '&jwt=' + HIDE + '&page=2&code_challenge=C&token_type=Bearer')
  assert.equal(maskedUrl('https://s.example/mcp?a%=1&token=50%off'), 'https://s.example/mcp?a%=1&token=' + HIDE)
  /* A malformed % must not stop the request, and the name and password are scrubbed from an error that quotes the address. */
  let calls = 0
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async (u: unknown) => { calls++; throw new TypeError('Failed to fetch ' + u) }, probe: false })
  await assert.rejects(trace.fetch('https://user:hunter2pass@s.example/mcp?a%=1&token=50%off', { method: 'POST', body: '{}' }), /Failed to fetch/)
  assert.equal(calls, 1)
  assert.ok(!JSON.stringify(trace.events).includes('hunter2pass'))
  assert.ok(!JSON.stringify(trace.events).includes('50%off'))
})

test('recording never stops a request: with a body it cannot read, the answer still comes back', async () => {
  const res = json(200, { ok: 1 })
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => res })
  const bad = { get headers(): never { throw new Error('boom') } }
  assert.equal(await trace.fetch('https://s.example/x', bad as never), res)
})

test('kindOf and the MCP address: compared as the browser requests it, and never taken for a token request', async () => {
  assert.equal(kindOf('POST', 'https://example.com/mcp', '{}', 'https://Example.com:443/mcp/'), 'mcp')
  assert.equal(kindOf('POST', 'https://s.example/mcp?x=1', 'a&grant_type=b', 'https://s.example/mcp'), 'mcp')
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => json(200, { result: 'the-result-1' }) })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: 'note=a&grant_type=b' })
  const [e] = trace.events
  assert.equal(e.kind, 'mcp')
  assert.equal(e.request, undefined, 'what is sent to the MCP server is not kept on the request')
  assert.equal(e.response, undefined)
})

test('received headers: one named like a credential is hidden and learned, and an address in Location is masked', async () => {
  const fake = async () => new Response('{"again":"tok_abcdefghijkl"}', { status: 400, headers: { 'content-type': 'application/json', 'x-auth-token': 'tok_abcdefghijkl', 'x-session-id': 'sess_12345678', location: 'https://app.example/cb?code=AUTHCODE123&ok=1', 'www-authenticate': 'Bearer realm="x"' } })
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: fake })
  await trace.fetch('https://as.example/x')
  const [e] = trace.events
  assert.equal(e.resHeaders['x-auth-token'], HIDE)
  assert.equal(e.resHeaders['x-session-id'], HIDE)
  assert.equal(e.resHeaders.location, 'https://app.example/cb?code=' + HIDE + '&ok=1')
  assert.equal(e.resHeaders['www-authenticate'], 'Bearer realm="x"')
  assert.equal(e.response.again, HIDE)
})

test('scrubbing: a secret inside another goes whole, and so does one written as it is in an address', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => json(200, {}) })
  await trace.fetch('https://as.example/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'x', code: 'abcdef', refresh_token: 'XXabcdefYY', client_secret: 'ab/cd+ef==' }) })
  assert.equal(trace.scrub('see XXabcdefYY and abcdef'), 'see ' + HIDE + ' and ' + HIDE)
  assert.equal(trace.scrub('https://x.example/?c=ab%2Fcd%2Bef%3D%3D'), 'https://x.example/?c=' + HIDE)
})

test('a redirect the SDK does not follow is said to be one, not "no answer"', async () => {
  const opaque = { ok: false, status: 0, type: 'opaqueredirect', headers: new Headers() }
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => opaque as unknown as Response })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  assert.equal(judge(trace.events).failure!.hint.code, 'redirected')
  assert.match(toLog(trace.events), /← redirect \(not followed\)/)
})

test('a sign-in the SDK asks for by itself is held: the flow stops at the authorization page, and says to press', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async (u: unknown) => (String(u).includes('well-known') ? json(200, { issuer: 'https://s.example' }) : json(401, {}, { 'www-authenticate': 'Bearer' })) })
  trace.begin()
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  await trace.fetch('https://s.example/.well-known/oauth-authorization-server')
  trace.redirect('https://s.example/authorize?client_id=https%3A%2F%2Fapp.example%2Fc.json&code_challenge=X&code_challenge_method=S256', { held: true })
  const j = judge(trace.events)
  assert.deepEqual(j.flow!.steps.map((s) => s.key + ':' + s.status).slice(3, 6), ['register:ok', 'redirect:fail', 'return:none'])
  assert.deepEqual([j.failure!.step, j.failure!.hint.code], ['redirect', 'held'], 'not taken for a server with no registration')
  assert.match(toLog(trace.events), /authorization page not opened/)
})

test('judge: no registration endpoint is not the failure when a token could be refreshed', async () => {
  const answers = [json(401, {}, { 'www-authenticate': 'Bearer' }), json(200, { issuer: 'https://s.example' }), json(200, { access_token: 'tok-mnopqr' }), json(200, {})]
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => answers.shift()! })
  trace.begin()
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  await trace.fetch('https://s.example/.well-known/oauth-authorization-server')
  await trace.fetch('https://s.example/token', { method: 'POST', body: 'grant_type=refresh_token&refresh_token=old-refresh-2' })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  const j = judge(trace.events)
  assert.equal(j.failure, null)
  assert.equal(j.flow!.failed, null)
})

test('headers: sent ones show their names and only harmless values, received ones everything but secrets', async () => {
  const fake = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json', pragma: 'no-cache', 'cache-control': 'no-cache, no-store', 'mcp-session-id': 'sess-SECRET-1', 'x-request-id': 'req-123456' } })
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: fake })
  await trace.fetch('https://as.example/x', { headers: { Accept: 'application/json', 'X-Custom': 'custom-SECRET-2', Authorization: 'Basic dXNlcjpwYXNz' } })
  const [e] = trace.events
  assert.deepEqual(e.reqHeaders, { accept: 'application/json', 'x-custom': HIDE, authorization: HIDE })
  assert.equal(e.resHeaders['mcp-session-id'], HIDE)
  assert.equal(e.resHeaders.pragma, 'no-cache')
  assert.equal(e.resHeaders['cache-control'], 'no-cache, no-store', 'a harmless received value is not taken for a secret')
  assert.equal(e.resHeaders['x-request-id'], 'req-123456')
  assert.ok(!JSON.stringify(trace.events).includes('dXNlcjpwYXNz'))
})

test('a secret in the address is hidden, in the query and wherever it is repeated', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response('{"echo":"key-SECRET-9"}', { status: 400, headers: { 'content-type': 'application/json' } }) })
  await trace.fetch('https://s.example/other?api_key=key-SECRET-9&page=2')
  const [e] = trace.events
  assert.equal(e.url, 'https://s.example/other?api_key=' + HIDE + '&page=2')
  assert.equal(e.response.echo, HIDE)
})

test('the trace keeps its newest events, tells its listeners, and clears', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null, { status: 204 }), max: 5 })
  let calls = 0
  const off = trace.subscribe(() => { calls++ })
  for (let i = 0; i < 8; i++) trace.sent({ jsonrpc: '2.0', method: 'notifications/n' + i })
  assert.equal(trace.events.length, 5)
  assert.equal(trace.events[0].method, 'notifications/n3')
  assert.ok(calls >= 8)
  trace.clear()
  assert.equal(trace.events.length, 0)
  off()
  const before = calls
  trace.sent({ jsonrpc: '2.0', method: 'x' })
  assert.equal(calls, before, 'no call after unsubscribing')
})

test('an aborted request is not a failure, and the side event stream is not probed', async () => {
  let probes = 0
  const fake = async (_u: unknown, init?: RequestInit) => { if (init && init.mode === 'no-cors') { probes++; return new Response(null) } const e = new Error('The operation was aborted'); e.name = init && init.method === 'GET' ? 'TypeError' : 'AbortError'; throw e }
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: fake, probe: true })
  await assert.rejects(trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' }))
  await assert.rejects(trace.fetch('https://s.example/mcp', { method: 'GET' }))
  await new Promise((r) => setTimeout(r, 0))
  const j = judge(trace.events)
  assert.equal(j.level(trace.events[0]), 'info')
  assert.equal(j.level(trace.events[1]), 'warn')
  assert.equal(j.failure, null)
  assert.equal(probes, 0)
})

test('an http address from an https page is named as the reason, with no probe', async () => {
  const g = globalThis as { location?: unknown }
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:' }, configurable: true })
  try {
    const trace = createTrace({ url: 'http://s.example/mcp', fetch: async () => { throw new TypeError('Failed to fetch') }, probe: true })
    await assert.rejects(trace.fetch('http://s.example/mcp', { method: 'POST', body: '{}' }))
    assert.equal(trace.events[0].reach, 'mixed')
    assert.equal(judge(trace.events).failure!.hint.code, 'mixed')
    const local = createTrace({ url: 'http://localhost:3000/mcp', fetch: async () => { throw new TypeError('Failed to fetch') }, probe: false })
    await assert.rejects(local.fetch('http://localhost:3000/mcp', { method: 'POST', body: '{}' }))
    assert.equal(local.events[0].reach, undefined, 'localhost over http is allowed from https')
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had); else delete g.location
  }
})

test('judge: outside a sign-in, the last request says what failed: refused, a status, or nothing', () => {
  assert.equal(judge(numbered([http({ status: 401, ok: false })])).failure!.hint.code, 'denied')
  assert.equal(judge(numbered([http({ status: 403, ok: false })])).failure!.hint.code, 'denied')
  const f = judge(numbered([http({ status: 500, ok: false })])).failure!
  assert.deepEqual([f.hint.code, f.hint.status, f.hint.host, f.seq], ['status', 500, 's.example', 1])
  assert.equal(judge(numbered([http({ status: 500, ok: false }), http({})])).failure, null, 'a later success clears it')
  assert.equal(judge(numbered([http({}), http({ method: 'GET', status: 405, ok: false }), http({ method: 'DELETE', status: 500, ok: false })])).failure, null, 'no event stream and a failed goodbye are not failures')
  assert.equal(judge([]).failure, null)
  assert.equal(judge([]).flow, null)
})

test('judge: a failed sign-in is the failure only until something else happens', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async (u: unknown) => (String(u).includes('token') ? json(400, { error: 'invalid_grant' }) : json(500, {})) })
  trace.begin({ signIn: true })
  trace.redirect('https://as.example/authorize?client_id=c1&code_challenge=X&code_challenge_method=S256')
  trace.begin({ resume: true })
  trace.returned(new URLSearchParams({ code: 'the-code-1' }))
  await trace.fetch('https://as.example/token', { method: 'POST', body: 'grant_type=authorization_code&code=the-code-1' })
  let j = judge(trace.events)
  assert.equal(j.failure!.step, 'token')
  assert.equal(j.flow!.current, true)
  /* A plain reconnect that fails its own way: the notice is about that, and the sign-in is still there to look at. */
  trace.begin()
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"initialize"}' })
  j = judge(trace.events)
  assert.equal(j.failure!.step, undefined)
  assert.equal(j.failure!.hint.code, 'status')
  assert.equal(j.flow!.current, false)
  assert.equal(j.flow!.failed!.key, 'token')
  assert.equal(j.flow!.steps[7].status, 'none', 'the later request is not counted as the sign-in’s first MCP request')
})

test('judge: a token the SDK refreshes by itself is a flow of its own: refused, token, then through', async () => {
  const answers = [json(401, {}, { 'www-authenticate': 'Bearer' }), json(200, { access_token: 'new-token-1' }), json(200, {})]
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => answers.shift()! })
  trace.begin()
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  await trace.fetch('https://as.example/token', { method: 'POST', body: 'grant_type=refresh_token&refresh_token=old-refresh-1' })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  const j = judge(trace.events)
  assert.deepEqual(j.flow!.steps.map((s) => s.status), ['ok', 'skip', 'skip', 'skip', 'skip', 'skip', 'ok', 'ok'])
  assert.equal(j.failure, null)
  assert.equal(j.level(trace.events[0]), 'info')
  assert.ok(!JSON.stringify(trace.events).includes('old-refresh-1') && !JSON.stringify(trace.events).includes('new-token-1'))
})

test('judge: the new token still refused, a 401 the browser cannot read the header of, and a metadata document as the client', async () => {
  const answers = [json(401, {}), json(200, { access_token: 'tok-abcdef' }), json(401, {})]
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => answers.shift()! })
  trace.begin({ signIn: true })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  trace.redirect('https://as.example/authorize?client_id=https%3A%2F%2Fapp.example%2Fclient.json&code_challenge=X&code_challenge_method=S256')
  trace.begin({ resume: true })
  trace.returned(new URLSearchParams({ code: 'the-code-2' }))
  await trace.fetch('https://as.example/token', { method: 'POST', body: 'grant_type=authorization_code&code=the-code-2' })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  const st = Object.fromEntries(judge(trace.events).flow!.steps.map((s) => [s.key, s]))
  assert.deepEqual([st.unauth.status, st.unauth.hint!.code], ['warn', 'noWww'])
  assert.deepEqual([st.register.status, st.register.how], ['ok', 'metadata'])
  assert.deepEqual([st.ready.status, st.ready.hint!.code], ['fail', 'stillDenied'])
  assert.equal(judge(trace.events).failure!.step, 'ready')
})

test('restore: the next run finishes the sign-in that was kept, also for a client that only taps', async () => {
  const first = createTrace({ url: 'https://s.example/mcp', fetch: async () => json(401, {}, { 'www-authenticate': 'Bearer' }) })
  first.begin({ signIn: true })
  await first.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  first.redirect('https://as.example/authorize?client_id=c1&code_challenge=X&code_challenge_method=S256')
  const answers = [json(200, { access_token: 'tok-ghijkl' }), json(200, {})]
  const second = createTrace({ url: 'https://s.example/mcp', fetch: async () => answers.shift()! })
  second.restore(JSON.parse(JSON.stringify(first.export())))
  second.returned(new URLSearchParams({ code: 'the-code-3' }))
  second.tap({ send: async () => {} })
  await second.fetch('https://as.example/token', { method: 'POST', body: 'grant_type=authorization_code&code=the-code-3' })
  await second.fetch('https://s.example/mcp', { method: 'POST', body: '{}' })
  assert.deepEqual(judge(second.events).flow!.steps.map((s) => s.status), ['ok', 'skip', 'skip', 'ok', 'ok', 'ok', 'ok', 'ok'])
  second.restore([])
  second.restore(null as never)
  second.restore([{ type: 'rpc', message: 'x' }, 'junk'] as never)
  assert.ok(!second.events.some((e) => e.type === 'rpc' && e.restored), 'only requests and notes come back from storage')
})

test('rowsOf: a request holds the messages it carried, a JSON-RPC error fails its row, and the filters pick rows', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async (u: unknown) => (String(u).includes('well-known') ? json(404, {}) : new Response(null, { status: 200 })) })
  trace.begin()
  trace.sent({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}' })
  trace.received({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } })
  trace.received({ jsonrpc: '2.0', method: 'notifications/message', params: {} })
  await trace.fetch('https://s.example/.well-known/x')
  const m = rowsOf(trace.events)
  assert.deepEqual(m.list.map((e) => e.type + ':' + (e.method || '')), ['http:POST', 'rpc:notifications/message', 'http:GET'])
  const [post, note, other] = m.list
  assert.deepEqual(m.carried.get(post.seq)!.map((e) => e.dir), ['out', 'in'])
  assert.equal(m.level(post), 'fail', 'HTTP 200, but the message was answered with an error')
  assert.equal(m.level(note), 'ok')
  assert.deepEqual(['all', 'rpc', 'http', 'errors'].map((f) => m.list.filter((e) => m.keep(e, f as 'all')).length), [3, 2, 2, 2])
  assert.equal(m.keep(other, 'rpc'), false)
  assert.equal(rowsOf([]).list.length, 0)
})

test('toLog: a line for the request and one for its answer, each kind of event in its own form', async () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async (u: unknown) => { if (String(u).includes('down')) throw new TypeError('Failed to fetch'); return json(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer realm="x"' }) }, probe: false })
  trace.begin({ signIn: true })
  trace.sent({ jsonrpc: '2.0', id: 0, method: 'initialize' })
  await trace.fetch('https://s.example/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"initialize"}' })
  await assert.rejects(trace.fetch('https://down.example/token', { method: 'POST', body: 'grant_type=authorization_code&code=the-code-4' }))
  trace.redirect('https://as.example/authorize?client_id=c1&code_challenge=X&code_challenge_method=S256')
  trace.returned(new URLSearchParams({ error: 'access_denied' }))
  trace.received({ jsonrpc: '2.0', id: 9, error: { code: -1, message: 'boom' } })
  const lines = toLog(trace.events).split('\n')
  const body = (l: string) => l.replace(/^\d\d:\d\d:\d\d\.\d{3} /, '')
  assert.ok(lines.every((l) => /^\d\d:\d\d:\d\d\.\d{3} /.test(l)), 'every line starts with the time')
  assert.deepEqual(lines.map(body), [
    '● sign-in started',
    '⇢ initialize #0',
    '→ POST   https://s.example/mcp  initialize #0',
    '← 401    ' + trace.events[2].ms + 'ms  www-authenticate: Bearer realm="x"  {"error":"invalid_token"}',
    '→ POST   https://down.example/token  {"grant_type":"authorization_code","code":"•••"}',
    '✕ no answer  ' + trace.events[3].ms + 'ms  Failed to fetch',
    '● client: saved registration c1',
    '↗ authorization page  https://as.example/authorize?client_id=c1&code_challenge=X&code_challenge_method=S256',
    '↙ returned  {"error":"access_denied"}',
    '⇠ error #9  error -1 boom',
  ])
  assert.equal(toLog([]), '')
})

test('failureText and the strings: a sentence for every hint, in both languages, with the same keys', () => {
  const keys = (o: Record<string, unknown>, at = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, at + k + '.') : [at + k]))
  assert.deepEqual(keys(STRINGS.ko).sort(), keys(STRINGS.en).sort())
  assert.deepEqual(failureText({ step: 'token', seq: 1, hint: { code: 'oauthError', status: 400, error: 'invalid_grant', description: '' } }, { lang: 'en' }),
    { title: 'OAuth stopped at step 7, Token exchange.', detail: 'The server answered 400: invalid_grant.' })
  assert.deepEqual(failureText({ seq: 1, hint: { code: 'cors', host: 'a.example' } }, { lang: 'ko' }),
    { title: '연결하지 못했습니다.', detail: 'a.example 서버는 응답하지만 이 페이지의 요청을 허용하지 않습니다 (CORS).' })
  assert.equal(failureText({ seq: 1, hint: { code: 'cors', host: 'a.example' } }, { ui: { failed: 'Nope', hints: { cors: 'blocked: {host}' } } })!.detail, 'blocked: a.example', 'any string can be replaced')
  assert.equal(failureText(null), null)
  /* Every hint code the judge can give has a sentence. */
  for (const code of ['cors', 'unreachable', 'mixed', 'noAnswer', 'oauthError', 'status', 'returnError', 'noWww', 'noPrm', 'corsHeader', 'noDcr', 'stillDenied', 'denied', 'noStream', 'held', 'redirected']) {
    for (const lang of ['en', 'ko'] as const) assert.ok((STRINGS[lang].hints as Record<string, string>)[code], lang + ' has ' + code)
  }
})

test('JSON-RPC messages: a credential in a tool argument or a result is hidden by name and scrubbed elsewhere, a plain "code" or "key" is not', () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null) })
  trace.begin()
  trace.sent({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'login', arguments: { user: 'kim', password: 'hunter2hunter2', code: 'print(1)', key: 'row-7', nested: { api_key: 'sk-ARG-123456' } } } })
  trace.received({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'your key is sk-ARG-123456' }], structuredContent: { access_token: 'tok-RESULT-9876', expires_in: 60 } } })
  trace.received({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'tok-RESULT-9876 expired' } })
  const [out, back, err] = trace.events
  const args = out.message.params.arguments
  assert.deepEqual(args, { user: 'kim', password: HIDE, code: 'print(1)', key: 'row-7', nested: { api_key: HIDE } })
  assert.equal(back.message.result.content[0].text, 'your key is ' + HIDE)
  assert.deepEqual(back.message.result.structuredContent, { access_token: HIDE, expires_in: 60 })
  assert.deepEqual(err.message.error, { code: -32000, message: HIDE + ' expired' })
  const all = JSON.stringify(trace.events) + toLog(trace.events, { messages: true })
  for (const s of ['hunter2hunter2', 'sk-ARG-123456', 'tok-RESULT-9876']) assert.ok(!all.includes(s), s)
})

test('an address: a token as a piece of the path is hidden, ordinary path words are not', async () => {
  assert.equal(maskedUrl('https://s.example/api/mcp/s/sk_live_9f8a7b6c5d4e3f2a1b0c/mcp?x=1'), 'https://s.example/api/mcp/s/' + HIDE + '/mcp?x=1')
  for (const u of ['https://s.example/.well-known/oauth-protected-resource/mcp', 'https://s.example/.well-known/oauth-authorization-server', 'https://s.example/v1/servers/microsoft-learn-mcp-server-2025/mcp', 'https://learn.microsoft.com/api/mcp']) assert.equal(maskedUrl(u), u)
  const trace = createTrace({ url: 'https://s.example/s/sk_live_9f8a7b6c5d4e3f2a1b0c/mcp', fetch: async () => { throw new TypeError('Failed to fetch https://s.example/s/sk_live_9f8a7b6c5d4e3f2a1b0c/mcp') }, probe: false })
  await assert.rejects(trace.fetch('https://s.example/s/sk_live_9f8a7b6c5d4e3f2a1b0c/mcp', { method: 'POST', body: '{}' }))
  assert.equal(trace.events[0].kind, 'mcp')
  assert.equal(trace.events[0].url, 'https://s.example/s/' + HIDE + '/mcp')
  assert.ok(!(JSON.stringify(trace.events) + toLog(trace.events)).includes('sk_live_9f8a7b6c5d4e3f2a1b0c'))
})

/* ---- which way the protocol is spoken ---- */

test('revisionLevel: current from 2026-07-28, info for 2025-11-25, warn for anything older, nothing for no revision', () => {
  assert.deepEqual(['2026-07-28', '2027-01-15', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].map(revisionLevel), ['current', 'current', 'info', 'warn', 'warn', 'warn'])
  assert.deepEqual([undefined, null, '', 'draft', '2025'].map((v) => revisionLevel(v as string)), [null, null, null, null, null])
})

const connected = async (path: string, hooks = {}) => { const c = new Conn({ key: 'k', url: base + path }, hooks); await c.connect(); c.close(); return c.trace.events }

test('protocolOf: a modern server answered the probe, and nothing in the trace is marked as failed', async () => {
  const events = await connected('/modern-mcp')
  const p = protocolOf(events)
  assert.deepEqual([p.era, p.version, p.level, p.fellBack, p.probe!.ok, p.probe!.asked], ['modern', '2026-07-28', 'current', false, true, '2026-07-28'])
  const m = rowsOf(events)
  assert.deepEqual(m.list.filter((e) => m.keep(e, 'errors')).map((e) => e.method + ' ' + e.status), [])
  assert.equal(judge(events).failure, null)
})

test('protocolOf: a 2025 server did not answer the probe, initialize was used, and the probe is a note, not an error', async () => {
  const events = await connected('/mcp')
  const p = protocolOf(events)
  assert.deepEqual([p.era, p.version, p.level, p.fellBack, p.probe!.ok, p.probe!.status], ['legacy', '2025-11-25', 'info', true, false, 400])
  assert.match(p.probe!.error!, /not initialized/i, 'what the server said to the probe')
  const m = rowsOf(events)
  const probeRow = m.list.find((e) => e.seq === p.probe!.seq)!
  assert.equal(probeRow.type, 'http')
  assert.equal(m.level(probeRow), 'info')
  assert.deepEqual(m.list.filter((e) => m.keep(e, 'errors') && m.level(e) === 'fail'), [], 'nothing failed')
  assert.equal(judge(events).failure, null)
})

test('protocolOf: older revisions are a warning level, and with negotiation off there is no probe', async () => {
  for (const [path, version] of [['/rev-2025-06-18-mcp', '2025-06-18'], ['/rev-2025-03-26-mcp', '2025-03-26']]) {
    const p = protocolOf(await connected(path))
    assert.deepEqual([p.era, p.version, p.level, p.fellBack], ['legacy', version, 'warn', true])
  }
  const off = protocolOf(await connected('/mcp', { negotiation: 'legacy' }))
  assert.deepEqual([off.era, off.version, off.probe, off.fellBack], ['legacy', '2025-11-25', null, false])
  assert.deepEqual(protocolOf([]), { era: null, version: null, level: null, probe: null, fellBack: false })
})

test('protocolOf: a server that answers the probe with a JSON-RPC error (method not found) is a fallback too', () => {
  const trace = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null) })
  trace.begin()
  trace.sent({ jsonrpc: '2.0', id: 'p1', method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } })
  trace.received({ jsonrpc: '2.0', id: 'p1', error: { code: -32601, message: 'Method not found' } })
  trace.sent({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
  trace.received({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'x', version: '1' } } })
  const p = protocolOf(trace.events)
  assert.deepEqual([p.era, p.version, p.level, p.fellBack, p.probe!.error], ['legacy', '2025-06-18', 'warn', true, 'Method not found'])
  const j = judge(trace.events)
  assert.deepEqual(trace.events.slice(0, 2).map((e) => j.level(e)), ['info', 'info'], 'the unanswered probe and its error are not failures')
  /* While still connecting (probe sent, nothing back yet) there is no verdict. */
  const early = createTrace({ url: 'https://s.example/mcp', fetch: async () => new Response(null) })
  early.begin()
  early.sent({ jsonrpc: '2.0', id: 'p1', method: 'server/discover', params: {} })
  assert.deepEqual([protocolOf(early.events).era, protocolOf(early.events).fellBack], [null, false])
})
