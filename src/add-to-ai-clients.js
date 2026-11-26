/*
 * What each AI client needs to add an MCP server, as plain data (no DOM): the registry lookup, the client list and their formats,
 * and the phone check. The popup (add-to-ai.js) draws this; tests read it directly.
 */

/* ---- The MCP Registry: a server by its name alone. ---- */

export const REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0/servers'
const looked = new Map()

/*
 * Reads one server from the registry (GET {api}/{name}/versions/latest) and keeps the remote a browser and these clients can use:
 * Streamable HTTP over https, with no template variables in the address. The header it needs comes from the remote's
 * required or secret header, by name only. Each name is asked once per page.
 */
export function fromRegistry(name, opts = {}) {
  const api = (opts.registryApi || REGISTRY_API).replace(/\/+$/, '')
  const key = api + ' ' + name
  if (!looked.has(key)) {
    looked.set(key, fetch(api + '/' + encodeURIComponent(name) + '/versions/latest').then(async (res) => {
      if (!res.ok) throw new Error('Not in the MCP Registry: ' + name)
      const body = await res.json()
      /* The latest version can be a deprecated or deleted one; only an active server is offered to add. */
      const status = ((body._meta || {})['io.modelcontextprotocol.registry/official'] || {}).status
      if (status && status !== 'active') throw Object.assign(new Error('Not active in the MCP Registry: ' + name + ' (' + status + ')'), { inactive: true })
      const sv = body.server || body
      const remote = (sv.remotes || []).find((r) => r && r.type === 'streamable-http' && /^https:\/\//.test(r.url || '') && !/[{}]/.test(r.url))
      if (!remote) throw new Error('No remote address for ' + name)
      const need = (remote.headers || []).find((x) => x && x.name && (x.isRequired || x.isSecret))
      return { url: remote.url, name: sv.title || sv.name, id: sv.name, header: (need && need.name) || '' }
    }))
    /* A failed lookup is not kept, so a later try asks again. */
    looked.get(key).catch(() => looked.delete(key))
  }
  return looked.get(key)
}

/** The server with its address: as given, or read from the registry when only its name (id) is. */
export const withAddress = (server, opts) => (server.url ? Promise.resolve(server) : fromRegistry(server.id || server.registry, opts).then((r) => Object.assign({}, r, server, { url: r.url })))

export const hostOf = (url) => { try { return new URL(url).host } catch (e) { return String(url) } }

/* A name MCP clients accept as a key: lower case letters, digits and dashes. */
export function slugOf(server) {
  const from = server.id ? server.id.split('/').pop() : server.name || hostOf(server.url)
  return String(from).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mcp-server'
}

/* Base64 of UTF-8 text, in the browser and in Node (the tests). */
const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const json = (v) => JSON.stringify(v, null, 2)

/*
 * Client icons, from public packages on jsDelivr at fixed versions: LobeHub's AI brand icons (MIT), vscode-icons (MIT) for
 * VS Code and Visual Studio, and Simple Icons (CC0) for Zed, JetBrains and Warp. A client with none shows its first letter.
 * Mono icons are drawn as a mask in the text color, so they show in light and dark pages alike.
 * opts.icons: false leaves them out, or { id: url } replaces some.
 */
const LOBE = 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.106.0/icons/'
const VSCODE_ICONS = 'https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@v13.0.0/icons/'
const SIMPLE = 'https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/'
const color = (src) => ({ src })
const mono = (src) => ({ src, mono: true })
export const ICONS = {
  'claude-code': color(LOBE + 'claudecode-color.svg'),
  codex: color(LOBE + 'codex-color.svg'),
  gemini: color(LOBE + 'geminicli-color.svg'),
  'copilot-cli': mono(LOBE + 'githubcopilot.svg'),
  opencode: mono(LOBE + 'opencode.svg'),
  openclaw: color(LOBE + 'openclaw-color.svg'),
  hermes: mono(LOBE + 'nousresearch.svg'),
  goose: mono(LOBE + 'goose.svg'),
  amp: color(LOBE + 'amp-color.svg'),
  qwen: color(LOBE + 'qwen-color.svg'),
  warp: mono(SIMPLE + 'warp.svg'),
  vscode: color(VSCODE_ICONS + 'file_type_vscode.svg'),
  'vscode-insiders': color(VSCODE_ICONS + 'file_type_vscode-insiders.svg'),
  cursor: mono(LOBE + 'cursor.svg'),
  windsurf: mono(LOBE + 'windsurf.svg'),
  'visual-studio': color(VSCODE_ICONS + 'file_type_sln.svg'),
  kiro: color(LOBE + 'kiro-color.svg'),
  zed: mono(SIMPLE + 'zedindustries.svg'),
  jetbrains: mono(SIMPLE + 'jetbrains.svg'),
  junie: color(LOBE + 'junie-color.svg'),
  cline: mono(LOBE + 'cline.svg'),
  kilo: mono(LOBE + 'kilocode.svg'),
  lmstudio: mono(LOBE + 'lmstudio.svg'),
  trae: color(LOBE + 'trae-color.svg'),
  claude: color(LOBE + 'claude-color.svg'),
  chatgpt: mono(LOBE + 'openai.svg'),
  'gemini-app': color(LOBE + 'gemini-color.svg'),
  lechat: color(LOBE + 'mistral-color.svg'),
  perplexity: color(LOBE + 'perplexity-color.svg'),
  'copilot-studio': color(LOBE + 'copilot-color.svg'),
  manus: mono(LOBE + 'manus.svg'),
}

/** The header token a server needs, by name: given, or from the headers it is set up with, or from what the registry says. */
export const headerOf = (s) => s.header || (s.headers && Object.keys(s.headers)[0]) || s.authHeader || s.hint || ''
/** The token itself, when the server came with one (a server set up and tested in the inspector). */
export const secretOf = (s) => (s.headers && s.headers[headerOf(s)]) || ''

/* A small YAML writer for the few shapes below: maps, lists of maps, and strings (quoted when they need it). */
function yaml(v, indent = '') {
  const q = (x) => (/^[\w./:@-]+$/.test(String(x)) && !/^(true|false|null|yes|no|on|off|~|\d.*)$/i.test(String(x)) ? String(x) : JSON.stringify(String(x)))
  const out = []
  for (const [k, x] of Object.entries(v)) {
    if (x == null) continue
    if (Array.isArray(x)) {
      out.push(indent + k + ':')
      for (const item of x) {
        const lines = yaml(item, indent + '    ').split('\n')
        out.push(indent + '  - ' + lines[0].trimStart(), ...lines.slice(1))
      }
    } else if (typeof x === 'object') out.push(indent + k + ':', yaml(x, indent + '  '))
    else out.push(indent + q(k) + ': ' + (typeof x === 'boolean' ? String(x) : q(x)))
  }
  return out.join('\n')
}

/* The groups the popup shows, in order. On a phone, apps come first. */
export const GROUPS = ['agent', 'editor', 'app']

/*
 * Per AI client, how to add this server: [{ id, label, group, kind, link?, file?, code, steps?, settings?, note, get? }]
 *   group  agent (terminal agents), editor (editors and IDEs), app (chat apps, set up on their websites)
 *   kind   link (one click, with the file to edit by hand), command, file, or settings (steps, with what to paste)
 *   note   a key of the strings, said under it (a token to put in, OAuth, or why it may not work there)
 * Every format here was read from the client's own docs or source (see README for the list).
 *
 * opts.secret: put the server's own token in (only when it has one), so what is copied works as it is.
 * Without it, <token> (or the client's own secret input) stands where the token goes, and a note says to put yours in.
 * Links to share never call this with secret: they go to other people.
 */
export function clientsFor(server, opts = {}) {
  const name = slugOf(server)
  const title = server.name || name
  const url = server.url
  const header = headerOf(server)
  const secret = opts.secret ? secretOf(server) : ''
  const bearer = header.toLowerCase() === 'authorization'
  const value = secret || (bearer ? 'Bearer <token>' : '<token>')
  const headers = header ? { [header]: value } : undefined
  const env = name.toUpperCase().replace(/-/g, '_') + '_TOKEN'
  const tokenNote = !header ? (server.oauth ? 'oauth' : '') : secret ? 'secretIn' : 'token'
  /* Codex adds "Bearer " itself, so the variable holds the token alone. */
  const bare = secret.replace(/^Bearer\s+/i, '')
  const mcpServers = (entry) => json({ mcpServers: { [name]: entry } })
  const q = (v) => JSON.stringify(v)

  /* VS Code asks for the token itself (a password input), so without the token its config holds a reference, not a placeholder. */
  const vsHeaders = !header ? undefined : secret ? { [header]: secret } : { [header]: bearer ? 'Bearer ${input:token}' : '${input:token}' }
  const vsInputs = header && !secret ? [{ type: 'promptString', id: 'token', description: header, password: true }] : undefined
  const vscode = { name, type: 'http', url, headers: vsHeaders, inputs: vsInputs }
  const vscodeFile = json({ servers: { [name]: { type: 'http', url, headers: vsHeaders } }, inputs: vsInputs })
  const codex = `codex mcp add ${name} --url ${url}` + (header && bearer ? ' --bearer-token-env-var ' + env : '')
  const plain = { url, headers }
  /* A link to a web page (Kiro) passes through that site, so it never carries the token: <token> stands in its place. */
  const unsent = { url, headers: header ? { [header]: bearer ? 'Bearer <token>' : '<token>' } : undefined }
  const b64json = (v) => encodeURIComponent(b64(JSON.stringify(v)))

  const list = [
    /* ---- Terminal agents ---- */
    { id: 'claude-code', group: 'agent', get: 'https://code.claude.com', label: 'Claude Code', kind: 'command', code: `claude mcp add --transport http ${name} ${url}` + (header ? ` --header "${header}: ${value}"` : ''), note: tokenNote },
    /* Codex sends a token only as Authorization: Bearer, read from an environment variable it is given the name of. */
    {
      id: 'codex', group: 'agent', get: 'https://developers.openai.com/codex', label: 'Codex CLI', kind: 'command',
      code: secret && bearer ? `export ${env}="${bare}"\n${codex}` : codex,
      note: !header ? tokenNote : !bearer ? 'noHeader' : secret ? 'codexSecret' : 'codexToken', env,
    },
    { id: 'gemini', group: 'agent', get: 'https://github.com/google-gemini/gemini-cli', label: 'Gemini CLI', kind: 'command', code: `gemini mcp add --transport http ${name} ${url}` + (header ? ` --header "${header}: ${value}"` : ''), note: tokenNote },
    { id: 'copilot-cli', group: 'agent', get: 'https://github.com/features/copilot/cli', label: 'GitHub Copilot CLI', kind: 'command', code: `copilot mcp add --transport http` + (header ? ` --header "${header}: ${value}"` : '') + ` ${name} ${url}`, note: tokenNote },
    /* opencode takes a header as KEY=VALUE, and --global keeps it for every project. */
    { id: 'opencode', group: 'agent', get: 'https://opencode.ai', label: 'opencode', kind: 'command', code: `opencode mcp add ${name} --url ${url} --global` + (header ? ` --header '${header}=${value}'` : ''), note: tokenNote },
    /* OpenClaw takes a header as KEY=VALUE, and signs in with OAuth through its own login command. */
    {
      id: 'openclaw', group: 'agent', get: 'https://docs.openclaw.ai', label: 'OpenClaw', kind: 'command',
      code: `openclaw mcp add ${name} --url ${url} --transport streamable-http` + (header ? ` --header "${header}=${value}"` : '') + (server.oauth && !header ? ` --auth oauth\nopenclaw mcp login ${name}` : ''),
      note: tokenNote,
    },
    /* Hermes Agent's add command has no header option, so a server with a token goes in its config file. */
    header
      ? { id: 'hermes', group: 'agent', get: 'https://hermes-agent.nousresearch.com', label: 'Hermes Agent', kind: 'file', file: '~/.hermes/config.yaml', code: yaml({ mcp_servers: { [name]: { url, headers } } }), note: tokenNote }
      : { id: 'hermes', group: 'agent', get: 'https://hermes-agent.nousresearch.com', label: 'Hermes Agent', kind: 'command', code: `hermes mcp add ${name} --url ${url}` + (server.oauth ? ' --auth oauth' : ''), note: tokenNote },
    /* Goose: its desktop app takes a goose:// link (a header makes it open the form to check first). */
    {
      id: 'goose', group: 'agent', get: 'https://goose-docs.ai', label: 'Goose', kind: 'link',
      link: `goose://extension?url=${encodeURIComponent(url)}&type=streamable_http&id=${encodeURIComponent(name)}&name=${encodeURIComponent(title)}` + (header ? '&header=' + encodeURIComponent(header + '=' + value) : ''),
      file: '~/.config/goose/config.yaml', code: yaml({ extensions: { [name]: { name: title, type: 'streamable_http', uri: url, headers, enabled: true } } }), note: tokenNote,
    },
    /* Amp's add command has no header option either; with a token it goes in settings.json. */
    header
      ? { id: 'amp', group: 'agent', get: 'https://ampcode.com', label: 'Amp', kind: 'file', file: '~/.config/amp/settings.json', code: json({ 'amp.mcpServers': { [name]: plain } }), note: tokenNote }
      : { id: 'amp', group: 'agent', get: 'https://ampcode.com', label: 'Amp', kind: 'command', code: `amp mcp add ${name} ${url}`, note: tokenNote },
    { id: 'qwen', group: 'agent', get: 'https://github.com/QwenLM/qwen-code', label: 'Qwen Code', kind: 'command', code: `qwen mcp add --transport http --scope user ${name} ${url}` + (header ? ` --header "${header}: ${value}"` : ''), note: tokenNote },
    /* Factory Droid tries OAuth unless told not to; a header token means it is not needed. */
    { id: 'droid', group: 'agent', get: 'https://factory.ai', label: 'Factory Droid', kind: 'command', code: `droid mcp add ${name} ${url} --type http` + (header ? ` --header "${header}: ${value}" --no-oauth` : ''), note: tokenNote },
    { id: 'augment', group: 'agent', get: 'https://www.augmentcode.com', label: 'Augment (auggie)', kind: 'command', code: `auggie mcp add ${name} --transport http --url ${url}` + (header ? ` --header "${header}:${value}"` : ''), note: tokenNote },
    /* Crush is set up in crushrc, where mcp add takes a header as two words. */
    { id: 'crush', group: 'agent', get: 'https://github.com/charmbracelet/crush', label: 'Crush', kind: 'file', file: '~/.config/crush/crushrc', code: `mcp add ${name} --type http --url ${q(url)}` + (header ? ` --header ${header} ${q(value)}` : ''), note: tokenNote },
    { id: 'warp', group: 'agent', get: 'https://www.warp.dev', label: 'Warp', kind: 'settings', steps: 'warp', code: mcpServers(plain), note: tokenNote },

    /* ---- Editors and IDEs ---- */
    { id: 'vscode', group: 'editor', get: 'https://code.visualstudio.com/download', label: 'VS Code', kind: 'link', link: 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify(vscode)), file: '.vscode/mcp.json', code: vscodeFile, note: header && !secret ? 'vscodeToken' : tokenNote },
    {
      id: 'cursor', group: 'editor', get: 'https://cursor.com/downloads', label: 'Cursor', kind: 'link',
      link: 'cursor://anysphere.cursor-deeplink/mcp/install?name=' + encodeURIComponent(name) + '&config=' + b64json(plain),
      file: '~/.cursor/mcp.json', code: mcpServers(plain), note: tokenNote,
    },
    /* Windsurf names the address serverUrl. */
    { id: 'windsurf', group: 'editor', get: 'https://windsurf.com/download', label: 'Windsurf', kind: 'file', file: '~/.codeium/windsurf/mcp_config.json', code: mcpServers({ serverUrl: url, headers }), note: tokenNote },
    { id: 'vscode-insiders', group: 'editor', get: 'https://code.visualstudio.com/insiders', label: 'VS Code Insiders', kind: 'link', link: 'vscode-insiders:mcp/install?' + encodeURIComponent(JSON.stringify(vscode)), file: '.vscode/mcp.json', code: vscodeFile, note: header && !secret ? 'vscodeToken' : tokenNote },
    /* Visual Studio's install link is a web page that hands it on; its docs show no headers, so a token may need its settings. */
    {
      id: 'visual-studio', group: 'editor', get: 'https://visualstudio.microsoft.com/downloads/', label: 'Visual Studio', kind: 'link',
      link: 'https://vs-open.link/mcp-install?' + encodeURIComponent(JSON.stringify({ name, type: 'http', url })),
      file: '%USERPROFILE%\\.mcp.json', code: json({ servers: { [name]: { type: 'http', url, headers } } }), note: header ? 'headerUnsure' : tokenNote,
    },
    /* Kiro's install link is a web page too: name, and the server as URL-encoded JSON. */
    {
      id: 'kiro', group: 'editor', get: 'https://kiro.dev', label: 'Kiro', kind: 'link',
      link: `https://kiro.dev/launch/mcp/add?name=${encodeURIComponent(name)}&config=${encodeURIComponent(JSON.stringify(unsent))}`,
      file: '~/.kiro/settings/mcp.json', code: mcpServers(plain), note: tokenNote,
    },
    { id: 'zed', group: 'editor', get: 'https://zed.dev/download', label: 'Zed', kind: 'file', file: '~/.config/zed/settings.json', code: json({ context_servers: { [name]: plain } }), note: tokenNote },
    { id: 'jetbrains', group: 'editor', get: 'https://www.jetbrains.com/ai-assistant/', label: 'JetBrains AI Assistant', kind: 'settings', steps: 'jetbrains', code: mcpServers({ url }), note: header ? 'headerUnsure' : tokenNote },
    { id: 'junie', group: 'editor', get: 'https://www.jetbrains.com/junie/', label: 'Junie', kind: 'file', file: '~/.junie/mcp/mcp.json', code: mcpServers(plain), note: tokenNote },
    { id: 'cline', group: 'editor', get: 'https://cline.bot', label: 'Cline', kind: 'command', code: `cline mcp add ${name} ${url} --transport http` + (header ? ` --header "${header}: ${value}"` : '') + ' --yes', note: tokenNote },
    { id: 'kilo', group: 'editor', get: 'https://kilo.ai', label: 'Kilo Code', kind: 'file', file: '~/.config/kilo/kilo.jsonc', code: json({ mcp: { [name]: { type: 'remote', url, headers, enabled: true } } }), note: tokenNote },
    {
      id: 'continue', group: 'editor', get: 'https://continue.dev', label: 'Continue', kind: 'file', file: `.continue/mcpServers/${name}.yaml`,
      code: yaml({ name: title, version: '0.0.1', schema: 'v1', mcpServers: [{ name: title, type: 'streamable-http', url, requestOptions: headers ? { headers } : undefined }] }), note: tokenNote,
    },
    /* LM Studio and Trae take the server object as Base64 JSON in their links. */
    {
      id: 'lmstudio', group: 'editor', get: 'https://lmstudio.ai/download', label: 'LM Studio', kind: 'link',
      link: `lmstudio://add_mcp?name=${encodeURIComponent(name)}&config=${b64json(plain)}`, file: 'mcp.json', code: mcpServers(plain), note: tokenNote,
    },
    {
      id: 'trae', group: 'editor', get: 'https://www.trae.ai/download', label: 'Trae', kind: 'link',
      link: `trae://trae.ai-ide/mcp-import?type=http&name=${encodeURIComponent(name)}&config=${b64json(plain)}`, file: '.trae/mcp.json', code: mcpServers(plain), note: tokenNote,
    },

    /* ---- Chat apps, set up on their websites ---- */
    { id: 'claude', group: 'app', label: 'Claude', kind: 'settings', settings: 'https://claude.ai/customize/connectors', steps: 'claude', code: url, note: header ? 'claudeHeader' : server.oauth ? 'oauth' : '' },
    { id: 'chatgpt', group: 'app', label: 'ChatGPT', kind: 'settings', settings: 'https://chatgpt.com/plugins', steps: 'chatgpt', code: url, note: header ? 'noHeader' : server.oauth ? 'oauth' : '' },
    { id: 'gemini-app', group: 'app', label: 'Gemini app', kind: 'settings', settings: 'https://gemini.google.com/apps', steps: 'geminiApp', code: url, note: header ? 'noHeader' : 'geminiOauth' },
    { id: 'lechat', group: 'app', label: 'Mistral Le Chat', kind: 'settings', settings: 'https://chat.mistral.ai', steps: 'lechat', code: url, note: header ? 'tokenField' : server.oauth ? 'oauth' : '' },
    { id: 'perplexity', group: 'app', label: 'Perplexity', kind: 'settings', settings: 'https://www.perplexity.ai/computer/plugins', steps: 'perplexity', code: url, note: header ? 'tokenField' : server.oauth ? 'oauth' : '' },
    { id: 'copilot-studio', group: 'app', label: 'Copilot Studio', kind: 'settings', settings: 'https://copilotstudio.microsoft.com', steps: 'copilotStudio', code: url, note: header ? 'tokenField' : server.oauth ? 'oauth' : '' },
    { id: 'manus', group: 'app', label: 'Manus', kind: 'settings', settings: 'https://manus.im', steps: 'manus', code: url, note: header ? 'tokenField' : server.oauth ? 'oauth' : '' },
  ]
  /* A one-click link that holds the token opens an app on this computer; it is not one to send anyone. */
  /* App links (not web pages) are built from the server as set up, token included. */
  if (secret) for (const c of list) if (c.kind === 'link' && !/^https:/.test(c.link)) c.secretInLink = true
  return list
}

/* Clients set up in a website's settings work from any device. The rest (CLIs, editors) run on a computer. */
export const worksOnPhone = (c) => c.group === 'app'

/*
 * A phone or tablet, where a CLI or an editor cannot be set up. Client Hints when the browser has them, otherwise the user agent.
 * iPadOS reports itself as a Mac, so a Mac with touch counts as a tablet.
 */
export function isMobileDevice(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean' && nav.userAgentData.mobile) return true
  const ua = nav.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone|Silk|Kindle/i.test(ua)) return true
  return /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1
}
