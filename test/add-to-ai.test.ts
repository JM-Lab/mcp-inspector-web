/*
 * add-to-ai.js, the add-to-AI-client component: what each client gets. Plain data, no browser
 * (the popup and <mcp-add-to-ai> are clicked through in test/browser.test.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientsFor, slugOf, fromRegistry, ICONS, isMobileDevice, worksOnPhone, initialsOf, hueOf } from '../src/add-to-ai.js'

const by = (server) => Object.fromEntries(clientsFor(server).map((x) => [x.id, x]))
const by2 = (server, opts) => Object.fromEntries(clientsFor(server, opts).map((x) => [x.id, x]))

test('slugOf: a name MCP clients accept', () => {
  assert.equal(slugOf({ id: 'com.microsoft/microsoft-learn-mcp', url: 'https://x' }), 'microsoft-learn-mcp')
  assert.equal(slugOf({ name: 'My Server!', url: 'https://x' }), 'my-server')
  assert.equal(slugOf({ url: 'https://api.example.com:8443/mcp' }), 'api-example-com-8443')
})

test('clientsFor: 35 clients in three groups, each added the most direct way it allows', () => {
  const list = clientsFor({ id: 'a/docs', url: 'https://d.example/mcp' })
  assert.equal(list.length, 35)
  assert.equal(new Set(list.map((c) => c.id)).size, 35, 'ids are unique')
  const of = (g) => list.filter((c) => c.group === g).map((c) => c.id)
  assert.deepEqual(of('agent'), ['claude-code', 'codex', 'gemini', 'copilot-cli', 'opencode', 'openclaw', 'hermes', 'goose', 'amp', 'qwen', 'droid', 'augment', 'crush', 'warp'])
  assert.deepEqual(of('editor'), ['vscode', 'cursor', 'windsurf', 'vscode-insiders', 'visual-studio', 'kiro', 'zed', 'jetbrains', 'junie', 'cline', 'kilo', 'continue', 'lmstudio', 'trae'])
  assert.deepEqual(of('app'), ['claude', 'chatgpt', 'gemini-app', 'lechat', 'perplexity', 'copilot-studio', 'manus'])
  assert.deepEqual(list.filter((c) => c.kind === 'link').map((c) => c.id), ['goose', 'vscode', 'cursor', 'vscode-insiders', 'visual-studio', 'kiro', 'lmstudio', 'trae'])
  for (const c of list) assert.ok(['link', 'command', 'file', 'settings'].includes(c.kind) && c.code && c.label, c.id + ' is complete')
  for (const c of list.filter((x) => x.kind === 'link')) assert.ok(c.link && c.file, c.id + ' has a link and a file to edit by hand')
  for (const c of list.filter((x) => x.kind === 'file')) assert.ok(c.file, c.id + ' names its file')
  for (const c of list.filter((x) => x.kind === 'settings')) assert.ok(c.steps, c.id + ' has steps')
  for (const c of list.filter((x) => x.group === 'app')) assert.match(c.settings, /^https:\/\//, c.id + ' links to its settings')
})

test('clientsFor: each client\'s own format, as its docs or source define it', () => {
  const o = by({ id: 'a/docs', name: 'Docs', url: 'https://d.example/mcp' })
  assert.equal(o['copilot-cli'].code, 'copilot mcp add --transport http docs https://d.example/mcp')
  assert.equal(o.opencode.code, 'opencode mcp add docs --url https://d.example/mcp --global')
  assert.equal(o.hermes.code, 'hermes mcp add docs --url https://d.example/mcp')
  assert.equal(o.amp.code, 'amp mcp add docs https://d.example/mcp')
  assert.equal(o.qwen.code, 'qwen mcp add --transport http --scope user docs https://d.example/mcp')
  assert.equal(o.droid.code, 'droid mcp add docs https://d.example/mcp --type http')
  assert.equal(o.augment.code, 'auggie mcp add docs --transport http --url https://d.example/mcp')
  assert.equal(o.crush.code, 'mcp add docs --type http --url "https://d.example/mcp"')
  assert.equal(o.cline.code, 'cline mcp add docs https://d.example/mcp --transport http --yes')
  assert.equal(o.goose.link, 'goose://extension?url=https%3A%2F%2Fd.example%2Fmcp&type=streamable_http&id=docs&name=Docs')
  assert.match(o.goose.code, /type: streamable_http\n {4}uri: https:\/\/d\.example\/mcp/)
  assert.deepEqual(JSON.parse(new URL(o.kiro.link).searchParams.get('config')!), { url: 'https://d.example/mcp' })
  assert.deepEqual(JSON.parse(decodeURIComponent(o['visual-studio'].link.split('?')[1])), { name: 'docs', type: 'http', url: 'https://d.example/mcp' })
  assert.deepEqual(JSON.parse(Buffer.from(decodeURIComponent(o.lmstudio.link.split('config=')[1]), 'base64').toString()), { url: 'https://d.example/mcp' })
  assert.match(o.trae.link, /^trae:\/\/trae\.ai-ide\/mcp-import\?type=http&name=docs&config=/)
  assert.deepEqual(JSON.parse(o.zed.code), { context_servers: { docs: { url: 'https://d.example/mcp' } } })
  assert.deepEqual(JSON.parse(o.kilo.code), { mcp: { docs: { type: 'remote', url: 'https://d.example/mcp', enabled: true } } })
  assert.match(o.continue.code, /^name: Docs\nversion: "0\.0\.1"\nschema: v1\nmcpServers:\n  - name: Docs\n    type: streamable-http\n    url: https:\/\/d\.example\/mcp$/)
  assert.equal(o.claude.settings, 'https://claude.ai/customize/connectors')
  assert.equal(o.chatgpt.settings, 'https://chatgpt.com/plugins')
  assert.equal(o['gemini-app'].note, 'geminiOauth')
})

test('clientsFor: a token goes where each client takes it', () => {
  const l = by({ url: 'https://k.example/mcp', header: 'X-Key' })
  assert.match(l.opencode.code, / --header 'X-Key=<token>'$/, 'opencode takes KEY=VALUE')
  assert.match(l['copilot-cli'].code, /--header "X-Key: <token>" k-example https:/)
  assert.match(l.droid.code, /--header "X-Key: <token>" --no-oauth$/, 'no OAuth with a header token')
  assert.match(l.augment.code, /--header "X-Key:<token>"$/)
  assert.match(l.crush.code, /--header X-Key "<token>"$/, 'Crush takes it as two words')
  assert.equal(l.hermes.kind, 'file', 'Hermes has no header option, so the config file')
  assert.match(l.hermes.code, /^mcp_servers:\n  k-example:\n    url: https:\/\/k\.example\/mcp\n    headers:\n      X-Key: "<token>"$/)
  assert.equal(l.amp.kind, 'file')
  assert.deepEqual(JSON.parse(l.amp.code), { 'amp.mcpServers': { 'k-example': { url: 'https://k.example/mcp', headers: { 'X-Key': '<token>' } } } })
  assert.match(l.goose.link, /&header=X-Key%3D%3Ctoken%3E$/)
  assert.equal(l['visual-studio'].note, 'headerUnsure')
  assert.equal(l.jetbrains.note, 'headerUnsure')
  assert.equal(l.claude.note, 'claudeHeader')
  for (const id of ['lechat', 'perplexity', 'copilot-studio', 'manus']) assert.equal(l[id].note, 'tokenField', id + ' asks for it when added')
  assert.equal(l.chatgpt.note, 'noHeader')
  assert.equal(l['gemini-app'].note, 'noHeader')
})

test('clientsFor: commands, install links and files for a server with no sign-in', () => {
  const o = by({ id: 'a/docs', url: 'https://d.example/mcp' })
  assert.equal(o['claude-code'].code, 'claude mcp add --transport http docs https://d.example/mcp')
  assert.equal(o.codex.code, 'codex mcp add docs --url https://d.example/mcp')
  assert.equal(o.gemini.code, 'gemini mcp add --transport http docs https://d.example/mcp')
  assert.equal(o.openclaw.code, 'openclaw mcp add docs --url https://d.example/mcp --transport streamable-http')
  assert.deepEqual(JSON.parse(decodeURIComponent(o.vscode.link.replace('vscode:mcp/install?', ''))), { name: 'docs', type: 'http', url: 'https://d.example/mcp' })
  assert.match(o['vscode-insiders'].link, /^vscode-insiders:mcp\/install\?/)
  const cursor = new URL(o.cursor.link)
  assert.equal(cursor.searchParams.get('name'), 'docs')
  assert.deepEqual(JSON.parse(Buffer.from(cursor.searchParams.get('config')!, 'base64').toString()), { url: 'https://d.example/mcp' })
  assert.deepEqual(JSON.parse(o.cursor.code), { mcpServers: { docs: { url: 'https://d.example/mcp' } } })
  assert.deepEqual(JSON.parse(o.windsurf.code), { mcpServers: { docs: { serverUrl: 'https://d.example/mcp' } } }, 'Windsurf names the address serverUrl')
  assert.equal(o.claude.code, 'https://d.example/mcp')
  for (const c of Object.values(o)) if (c.id !== 'gemini-app') assert.equal(c.note, '', c.id + ' needs no note')
})

test('clientsFor: a server that needs a token, and no token in anything', () => {
  for (const server of [{ url: 'https://k.example/mcp', headers: { Authorization: 'Bearer secret' } }, { url: 'https://k.example/mcp', header: 'Authorization' }]) {
    const l = by(server)
    assert.doesNotMatch(JSON.stringify(l), /secret/)
    assert.match(l['claude-code'].code, /--header "Authorization: Bearer <token>"$/)
    assert.match(l.gemini.code, /--header "Authorization: Bearer <token>"$/)
    assert.match(l.openclaw.code, /--header "Authorization=Bearer <token>"$/, 'OpenClaw takes KEY=VALUE')
    assert.equal(l.codex.code, 'codex mcp add k-example --url https://k.example/mcp --bearer-token-env-var K_EXAMPLE_TOKEN', 'Codex reads a bearer token from an environment variable')
    assert.equal(l.codex.note, 'codexToken')
    assert.equal(JSON.parse(l.windsurf.code).mcpServers['k-example'].headers.Authorization, 'Bearer <token>')
    const vs = JSON.parse(l.vscode.code)
    assert.equal(vs.servers['k-example'].headers.Authorization, 'Bearer ${input:token}', 'VS Code asks for it as a password input')
    assert.equal(vs.inputs[0].password, true)
    assert.equal(l.claude.note, 'claudeHeader')
    assert.equal(l.chatgpt.note, 'noHeader')
  }
  /* Codex sends only Authorization: Bearer, so another header gets the note instead of a wrong flag. */
  const other = by({ url: 'https://k.example/mcp', header: 'X-Key' })
  assert.equal(other.codex.code, 'codex mcp add k-example --url https://k.example/mcp')
  assert.equal(other.codex.note, 'noHeader')
  assert.match(other['claude-code'].code, /--header "X-Key: <token>"$/)
})

test('clientsFor: a server set up with its own token puts it in when asked, so what is copied works as it is', () => {
  const server = { url: 'https://k.example/mcp', headers: { Authorization: 'Bearer abc123' } }
  const mine = by2(server, { secret: true })
  assert.equal(mine['claude-code'].code, 'claude mcp add --transport http k-example https://k.example/mcp --header "Authorization: Bearer abc123"')
  assert.equal(mine.gemini.code, 'gemini mcp add --transport http k-example https://k.example/mcp --header "Authorization: Bearer abc123"')
  assert.equal(mine.codex.code, 'export K_EXAMPLE_TOKEN="abc123"\ncodex mcp add k-example --url https://k.example/mcp --bearer-token-env-var K_EXAMPLE_TOKEN', 'Codex adds Bearer itself')
  assert.equal(mine.codex.note, 'codexSecret')
  const vs = JSON.parse(mine.vscode.code)
  assert.equal(vs.servers['k-example'].headers.Authorization, 'Bearer abc123')
  assert.equal(vs.inputs, undefined, 'no password input when the token is there')
  assert.equal(JSON.parse(decodeURIComponent(mine.vscode.link.replace('vscode:mcp/install?', ''))).headers.Authorization, 'Bearer abc123')
  assert.equal(JSON.parse(Buffer.from(new URL(mine.cursor.link).searchParams.get('config')!, 'base64').toString()).headers.Authorization, 'Bearer abc123')
  assert.equal(JSON.parse(mine.windsurf.code).mcpServers['k-example'].headers.Authorization, 'Bearer abc123')
  assert.equal(mine['claude-code'].note, 'secretIn')
  assert.equal(mine.claude.note, 'claudeHeader')
  /* Not asked: the token stays out, and the note says to put yours in. */
  assert.doesNotMatch(JSON.stringify(clientsFor(server)), /abc123/)
  assert.equal(by(server)['claude-code'].note, 'token')
  /* Only the header name: nothing to put in, even when asked. */
  assert.match(by2({ url: 'https://k.example/mcp', header: 'X-Key' }, { secret: true })['claude-code'].code, /"X-Key: <token>"$/)
})

test('clientsFor: a server that signs in with OAuth says the client will ask', () => {
  const o = by({ url: 'https://o.example/mcp', oauth: true })
  for (const id of ['claude-code', 'cursor', 'claude', 'chatgpt']) assert.equal(o[id].note, 'oauth', id)
  assert.equal(o.openclaw.code, 'openclaw mcp add o-example --url https://o.example/mcp --transport streamable-http --auth oauth\nopenclaw mcp login o-example', 'OpenClaw signs in with its own login command')
})

test('fromRegistry: the address, title and needed header of a server, by its name alone', async () => {
  const asked: string[] = []
  const entries: Record<string, unknown> = {
    'io.x/docs': { server: { name: 'io.x/docs', title: 'Docs', remotes: [
      { type: 'sse', url: 'https://docs.example/sse' },
      { type: 'streamable-http', url: 'https://{tenant}.example/mcp' },
      { type: 'streamable-http', url: 'https://docs.example/mcp', headers: [{ name: 'X-Opt' }, { name: 'X-Key', isRequired: true }] },
    ] } },
    'io.x/local': { server: { name: 'io.x/local', remotes: [{ type: 'streamable-http', url: 'http://localhost:3000/mcp' }] } },
  }
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    asked.push(url)
    const name = decodeURIComponent(url.split('/servers/')[1].replace('/versions/latest', ''))
    const body = entries[name]
    return { ok: !!body, json: async () => body }
  }) as typeof fetch
  try {
    const api = { registryApi: 'https://reg.example/v0/servers/' }
    assert.deepEqual(await fromRegistry('io.x/docs', api), { url: 'https://docs.example/mcp', name: 'Docs', id: 'io.x/docs', header: 'X-Key' }, 'Streamable HTTP over https with no template, and the required header')
    assert.equal(asked[0], 'https://reg.example/v0/servers/io.x%2Fdocs/versions/latest')
    await fromRegistry('io.x/docs', api)
    assert.equal(asked.length, 1, 'each name is asked once')
    await assert.rejects(fromRegistry('io.x/local', api), /No remote address/, 'an http remote is not one these clients can be given')
    await assert.rejects(fromRegistry('io.x/none', api), /Not in the MCP Registry/)
    entries['io.x/none'] = entries['io.x/docs']
    await new Promise((r) => setTimeout(r, 0))
    assert.equal((await fromRegistry('io.x/none', api)).url, 'https://docs.example/mcp', 'a failed lookup is asked again later')
  } finally {
    globalThis.fetch = real
  }
})

test('ICONS: from public CDNs at fixed versions; a client with none gets initials on a color of its own', () => {
  const without = []
  for (const c of clientsFor({ url: 'https://d.example/mcp' })) {
    const icon = ICONS[c.id as keyof typeof ICONS]
    if (!icon) { without.push(c.id); continue }
    assert.match(icon.src, /^https:\/\/cdn\.jsdelivr\.net\/(npm\/@lobehub\/icons-static-svg@\d+\.\d+\.\d+|gh\/vscode-icons\/vscode-icons@v\d+\.\d+\.\d+|npm\/simple-icons@\d+\.\d+\.\d+)\/icons\/[\w-]+\.svg$/, c.id + ' is pinned')
  }
  assert.deepEqual(without, ['droid', 'augment', 'crush', 'continue'])
  assert.equal(initialsOf('Factory Droid'), 'FD')
  assert.equal(initialsOf('Augment (auggie)'), 'Au')
  assert.equal(initialsOf('Crush'), 'Cr')
  assert.equal(hueOf('Crush'), hueOf('Crush'), 'the same name keeps its color')
  assert.notEqual(hueOf('Crush'), hueOf('Continue'))
})

test('isMobileDevice: phones and tablets, from Client Hints or the user agent', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
  assert.equal(isMobileDevice({ userAgent: iphone }), true)
  assert.equal(isMobileDevice({ userAgent: android }), true)
  assert.equal(isMobileDevice({ userAgent: windows, userAgentData: { mobile: true } }), true, 'Client Hints say so')
  assert.equal(isMobileDevice({ userAgent: mac, maxTouchPoints: 5 }), true, 'an iPad reports itself as a Mac with touch')
  assert.equal(isMobileDevice({ userAgent: mac, maxTouchPoints: 0 }), false)
  assert.equal(isMobileDevice({ userAgent: windows, userAgentData: { mobile: false } }), false)
})

test('worksOnPhone: only the chat apps, set up on their websites; every computer client links to where to get it', () => {
  const list = clientsFor({ url: 'https://d.example/mcp' })
  assert.deepEqual(list.filter(worksOnPhone).map((c) => c.id), ['claude', 'chatgpt', 'gemini-app', 'lechat', 'perplexity', 'copilot-studio', 'manus'])
  for (const c of list.filter((x) => !worksOnPhone(x))) assert.match(c.get, /^https:\/\//, c.id + ' has a page to get it')
})

test('the component stands alone: it imports nothing from the inspector', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/add-to-ai.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /^\s*import\s/m)
})
