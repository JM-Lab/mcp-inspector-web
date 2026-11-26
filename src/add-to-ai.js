/*
 * Add an MCP server to an AI client: a UI component of its own. It knows nothing about the inspector and brings its own styles,
 * so any page that shows MCP servers can drop it in with one import.
 *
 *   import { addToAiButton } from 'mcp-inspector-web/add-to-ai'
 *   card.append(addToAiButton({ url: 'https://example.com/mcp', name: 'Example' }))
 *
 *   <script src="https://cdn.jsdelivr.net/npm/mcp-inspector-web@0/dist/mcp-add-to-ai.js"></script>
 *   <mcp-add-to-ai registry="com.microsoft/microsoft-learn-mcp"></mcp-add-to-ai>      everything read from the MCP Registry
 *   <mcp-add-to-ai url="https://example.com/mcp" name="Example"></mcp-add-to-ai>     or given directly
 *
 *   addToAiButton(server, opts)    a button that opens the popup
 *   openAddToAi(server, opts)      the popup itself: pick a client, then add it in one click or follow the steps
 *                                  (a Promise when the server is given by registry name alone)
 *   fromRegistry(name, opts)       a server read from the MCP Registry by its name: { url, name, id, header }
 *   clientsFor(server)             per AI client, how to add this server (plain data, no DOM)
 *   defineAddToAi(tag)             registers the <mcp-add-to-ai> element (the script tag bundle does this on load)
 *     server   { url, name?, id?, header?, headers?, oauth? }, or { id } alone to read the rest from the registry
 *              id is the MCP Registry name, header the name of a header token it needs, headers the token itself
 *              ({ name: value }, put in unless opts.secret is false), oauth that it signs in with OAuth
 *     opts     { lang: 'en' | 'ko', ui: { ...strings }, root: element to put the popup in (default document.body), label,
 *                registryApi: the registry API (default the official one), icons: false or { clientId: url },
 *                mobile: true or false to override the phone or tablet check }
 *
 * The popup groups the clients (terminal agents, editors and IDEs, chat apps) under a search box.
 * On a phone or tablet only the chat apps (their websites) can be set up. The popup says so at the top, lists them first,
 * and marks the others Computer only: their one-click button is off, and their setup is still there to copy and send to a computer.
 *
 * Each client is added the most direct way it allows:
 *   link       one click: the client's own install link (VS Code, Cursor, Goose, Kiro, Visual Studio, LM Studio, Trae)
 *   command    one command to run in a terminal (Claude Code, Codex, Gemini CLI, Copilot CLI, opencode, OpenClaw, Qwen Code, …)
 *   file       a config file to edit (Windsurf, Zed, Junie, Kilo Code, Continue, Crush, …)
 *   settings   steps in the app's settings, with what to paste (Claude, ChatGPT, Gemini, Le Chat, Perplexity, Warp, …)
 *
 * A token: a server set up with its own (headers: { name: value }, as in the inspector after you tested it) gets it put in,
 * so what you copy works as it is. A checkbox takes it out again, for passing the setup on to someone else.
 * A server given with only the header name gets <token> (or the client's own secret input) and a note to put yours in.
 * Styles are added to the page once, the first time the component is used. Colors follow --mcpi-* when the page sets them.
 */

const STRINGS = {
  en: {
    button: 'Add to an AI client', loading: 'Looking up…', notFound: 'Not in the MCP Registry', title: 'Add {v} to an AI client', close: 'Close', pick: 'Choose your AI client',
    link: 'One click', command: 'Command', file: 'Config file', settings: 'Settings',
    addIn: 'Add to {v}', linkHint: '{v} opens and asks you to confirm.', manual: 'Or add it by hand',
    run: 'Run this in a terminal:', openFile: 'Add this to', copy: 'Copy', copied: 'Copied',
    openSettings: 'Open {v} settings',
    token: 'This server needs a token in the {h} header. Put yours where <token> is.',
    vscodeToken: 'VS Code asks for the token the first time the server starts.',
    codexToken: 'Codex reads the token from the environment variable {env}. Set it before you start Codex.',
    codexSecret: 'The first line sets {env} to your token for this terminal. Set it where Codex starts (a shell profile, for example) to keep it.',
    secretIn: 'Your own token is in this, as you set it up here. It works as it is: keep it to yourself.',
    withSecret: 'Put in my token (as set up here)', withSecretHint: 'Off: <token> stands where it goes, for sharing with others.',
    oauth: 'This server signs in with OAuth. {v} asks you to sign in when it first connects.',
    computerOnly: 'Computer only', getIt: 'No {v} yet? Get it',
    notOpened: 'Nothing opened? {v} may not be installed, or the browser held the link back. Get {v}, or add it by hand below.',
    mobileBanner: 'You are on a phone or tablet. Only the chat apps can be set up from here, on their websites. Terminal agents and editors run on a computer: their setup is shown so you can copy it and send it to yourself.',
    mobileNo: '{v} runs on a computer, so it cannot be added from this phone or tablet. Copy this and use it on your computer, or send yourself the link to this page.',
    mobileWeb: 'On a phone or tablet, do this on the {v} website in your browser. The app may not have this setting.',
    noHeader: '{v} takes no header token (it connects with OAuth or no sign-in), so this server may not work there.',
    search: 'Search clients', noMatch: 'No client matches.',
    g_agent: 'Terminal agents', g_editor: 'Editors and IDEs', g_app: 'Chat apps (on their websites)',
    headerUnsure: "{v}'s docs do not show a header token. If it does not connect, add the token in its MCP settings.",
    claudeHeader: 'Claude takes header tokens only in some organizations (beta). Elsewhere it connects with OAuth or no sign-in, so this server may not work there.',
    geminiOauth: 'The Gemini app connects to servers that sign in with OAuth.',
    tokenField: '{v} asks for the token when you add it: choose the API key or Bearer option and give it the {h} value.',
    claude: ['Open Customize → Connectors.', 'Press Add, then Add custom connector.', 'Paste this address and add it:'],
    chatgpt: ['Open Plugins (Business, Enterprise and Edu workspaces; read-only tools on Pro).', 'Press +, then Add custom MCP server.', 'Paste this address, choose OAuth or No authentication, and add it:'],
    geminiApp: ['On the web, open Settings → Connected Apps (personal accounts in the US, in English).', 'Under Custom apps, press Add a custom app.', 'Paste this address and add it:'],
    lechat: ['Open Connectors (as the workspace admin; on Free, Pro and Student plans, that is you).', 'Press + Add Connector, then the Custom MCP Connector tab.', 'Paste this address and add it:'],
    perplexity: ['Open Plugins (Pro, Max or Enterprise).', 'Press Add custom, then Add MCP connector, and choose Remote.', 'Paste this address, and under Advanced choose OAuth, API key or none:'],
    copilotStudio: ['Open your agent, then Tools → Add a tool → New tool → Model Context Protocol.', 'Choose None, API key or OAuth 2.0 for authentication.', 'Paste this address as the server URL and create it:'],
    manus: ['Open Settings → Integrations → Custom MCP Servers (or Connectors → Create → Add MCP by URL).', 'Press Add Server.', 'Paste this address and add it:'],
    warp: ['Open Settings → Agents → MCP servers.', 'Press + Add and choose a URL server.', 'Paste this and press Start:'],
    jetbrains: ['Open Settings → Tools → AI Assistant → Model Context Protocol (MCP).', 'Press Add and choose an HTTP connection.', 'Paste this and save:'],
  },
  ko: {
    button: 'AI 클라이언트에 추가', loading: '찾는 중…', notFound: 'MCP 레지스트리에 없음', title: '{v} 를 AI 클라이언트에 추가', close: '닫기', pick: 'AI 클라이언트를 고르세요',
    link: '클릭 한 번', command: '명령어', file: '설정 파일', settings: '앱 설정',
    addIn: '{v} 에 추가', linkHint: '{v} 가 열리고 추가할지 묻습니다.', manual: '직접 넣으려면',
    run: '터미널에서 실행하세요:', openFile: '이 파일에 넣으세요:', copy: '복사', copied: '복사됨',
    openSettings: '{v} 설정 열기',
    token: '이 서버는 {h} 헤더에 토큰이 필요합니다. <token> 자리에 내 토큰을 넣으세요.',
    vscodeToken: '서버를 처음 켤 때 VS Code 가 토큰을 묻습니다.',
    codexToken: 'Codex 는 환경 변수 {env} 에서 토큰을 읽습니다. Codex 를 켜기 전에 넣어 두세요.',
    codexSecret: '첫 줄이 이 터미널에서 {env} 에 내 토큰을 넣습니다. 계속 쓰려면 Codex 를 켜는 곳(셸 설정 파일 등)에 넣어 두세요.',
    secretIn: '여기서 설정한 내 토큰이 들어 있습니다. 그대로 붙이면 됩니다. 다른 사람과 나누지 마세요.',
    withSecret: '내 토큰 넣기 (여기서 설정한 대로)', withSecretHint: '끄면 토큰 자리에 <token> 이 들어갑니다. 다른 사람에게 줄 때 쓰세요.',
    oauth: '이 서버는 OAuth 로 로그인합니다. {v} 가 처음 연결할 때 로그인을 묻습니다.',
    computerOnly: '컴퓨터에서만', getIt: '{v} 가 없다면 받기',
    notOpened: '아무것도 열리지 않았나요? {v} 가 설치되어 있지 않거나 브라우저가 링크를 막았을 수 있습니다. {v} 를 받거나, 아래에서 직접 넣으세요.',
    mobileBanner: '휴대폰이나 태블릿입니다. 여기서는 채팅 앱만 웹사이트에서 추가할 수 있습니다. 터미널 에이전트와 에디터는 컴퓨터에서 돌아가서, 설정을 복사해 컴퓨터로 보내 쓰도록 보여 줍니다.',
    mobileNo: '{v} 는 컴퓨터에서 돌아가서 이 휴대폰이나 태블릿에서는 추가할 수 없습니다. 아래를 복사해 컴퓨터에서 쓰거나, 이 페이지 링크를 자신에게 보내세요.',
    mobileWeb: '휴대폰이나 태블릿에서는 브라우저로 {v} 웹사이트에서 하세요. 앱에는 이 설정이 없을 수 있습니다.',
    noHeader: '{v} 는 헤더 토큰을 받지 않아 (OAuth 나 인증 없이만 연결), 이 서버는 안 될 수 있습니다.',
    search: '클라이언트 검색', noMatch: '맞는 클라이언트가 없습니다.',
    g_agent: '터미널 에이전트', g_editor: '에디터와 IDE', g_app: '채팅 앱 (웹사이트에서)',
    headerUnsure: '{v} 문서에는 헤더 토큰 넣는 방법이 없습니다. 연결이 안 되면 {v} 의 MCP 설정에서 토큰을 넣으세요.',
    claudeHeader: 'Claude 는 일부 조직에서만 헤더 토큰을 받습니다 (베타). 그 밖에서는 OAuth 나 인증 없이만 연결하므로 이 서버는 안 될 수 있습니다.',
    geminiOauth: 'Gemini 앱은 OAuth 로 로그인하는 서버에 연결합니다.',
    tokenField: '{v} 가 추가할 때 토큰을 묻습니다. API 키나 Bearer 를 골라 {h} 값을 넣으세요.',
    claude: ['맞춤 설정 → 커넥터를 엽니다.', '추가 → 맞춤 커넥터 추가를 누릅니다.', '이 주소를 붙여 넣고 추가합니다:'],
    chatgpt: ['플러그인을 엽니다 (Business · Enterprise · Edu 워크스페이스, Pro 는 읽기 도구만).', '+ → 맞춤 MCP 서버 추가를 누릅니다.', '이 주소를 붙여 넣고, OAuth 나 인증 없음을 골라 추가합니다:'],
    geminiApp: ['웹에서 설정 → 연결된 앱을 엽니다 (미국의 개인 계정, 영어).', '맞춤 앱에서 맞춤 앱 추가를 누릅니다.', '이 주소를 붙여 넣고 추가합니다:'],
    lechat: ['커넥터를 엽니다 (워크스페이스 관리자. Free · Pro · Student 는 본인).', '+ 커넥터 추가 → 맞춤 MCP 커넥터 탭을 누릅니다.', '이 주소를 붙여 넣고 추가합니다:'],
    perplexity: ['플러그인을 엽니다 (Pro · Max · Enterprise).', '맞춤 추가 → MCP 커넥터 추가 → 원격을 고릅니다.', '이 주소를 붙여 넣고, 고급에서 OAuth · API 키 · 없음 중에 고릅니다:'],
    copilotStudio: ['에이전트를 열고 도구 → 도구 추가 → 새 도구 → Model Context Protocol 을 고릅니다.', '인증은 없음 · API 키 · OAuth 2.0 중에 고릅니다.', '이 주소를 서버 URL 로 붙여 넣고 만듭니다:'],
    manus: ['설정 → 통합 → 맞춤 MCP 서버를 엽니다 (또는 커넥터 → 만들기 → URL 로 MCP 추가).', '서버 추가를 누릅니다.', '이 주소를 붙여 넣고 추가합니다:'],
    warp: ['설정 → Agents → MCP servers 를 엽니다.', '+ Add 를 누르고 URL 서버를 고릅니다.', '아래를 붙여 넣고 Start 를 누릅니다:'],
    jetbrains: ['설정 → 도구 → AI Assistant → Model Context Protocol (MCP) 을 엽니다.', 'Add 를 누르고 HTTP 연결을 고릅니다.', '아래를 붙여 넣고 저장합니다:'],
  },
}

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
const withAddress = (server, opts) => (server.url ? Promise.resolve(server) : fromRegistry(server.id || server.registry, opts).then((r) => Object.assign({}, r, server, { url: r.url })))

const hostOf = (url) => { try { return new URL(url).host } catch (e) { return String(url) } }

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
const headerOf = (s) => s.header || (s.headers && Object.keys(s.headers)[0]) || s.authHeader || s.hint || ''
/** The token itself, when the server came with one (a server set up and tested in the inspector). */
const secretOf = (s) => (s.headers && s.headers[headerOf(s)]) || ''

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
  const b64json = (v) => encodeURIComponent(b64(JSON.stringify(v)))

  return [
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
      link: `https://kiro.dev/launch/mcp/add?name=${encodeURIComponent(name)}&config=${encodeURIComponent(JSON.stringify(plain))}`,
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

/* ---- The popup. Plain DOM, no other module of this package. ---- */

/* The component's own styles. It stands alone, outside the inspector too, so it carries its own fallbacks. */
const CSS = `.mcpi-addto,.mcpi-addto-trigger{--a-ink:var(--mcpi-ink,#16181d);--a-mute:var(--mcpi-mute,#666c76);--a-rule:var(--mcpi-rule,#d3d6dc);--a-card:var(--mcpi-card,#fff);--a-tint:var(--mcpi-tint,#eceef2);--a-inv:var(--mcpi-inv,#fff);--a-accent:var(--mcpi-accent,#1f5fbf);--a-warn:var(--mcpi-accent2,#c8102e);--a-mono:var(--mcpi-mono,ui-monospace,'SF Mono',Consolas,monospace)}
@media (prefers-color-scheme:dark){
  .mcpi-addto,.mcpi-addto-trigger{--a-ink:var(--mcpi-ink,#eceef2);--a-mute:var(--mcpi-mute,#9a9fa8);--a-rule:var(--mcpi-rule,#3a3e46);--a-card:var(--mcpi-card,#1c1e22);--a-tint:var(--mcpi-tint,#2a2d33);--a-inv:var(--mcpi-inv,#141518);--a-accent:var(--mcpi-accent,#8ab8ee);--a-warn:var(--mcpi-accent2,#ff7a85)}
}
.mcpi-addto{width:min(42rem,calc(100vw - 2rem));overflow-x:hidden;max-height:calc(100vh - 3rem);box-sizing:border-box;padding:1rem 1.1rem 1.2rem;border:1px solid var(--a-rule);border-radius:12px;background:var(--a-card);color:var(--a-ink);font-family:var(--mcpi-sans,system-ui,-apple-system,'Segoe UI',sans-serif);font-size:.85rem;line-height:1.5}
.mcpi-addto::backdrop{background:rgba(0,0,0,.45)}
.mcpi-addto button,.mcpi-addto a{font:inherit}
.mcpi-addto-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.mcpi-addto-head h2{margin:0;font-size:1.05rem;font-weight:800;overflow-wrap:anywhere}
.mcpi-addto-head code{font-family:var(--a-mono);font-size:.74rem;color:var(--a-mute);overflow-wrap:anywhere}
.mcpi-addto-close,.mcpi-addto-copy{flex:none;min-height:36px;padding:0 .8rem;border:1px solid var(--a-rule);border-radius:6px;background:var(--a-card);color:var(--a-ink);font-size:.8rem!important;font-weight:700;cursor:pointer}
.mcpi-addto-label{margin:1rem 0 .4rem;font-weight:800;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--a-mute)}
.mcpi-addto-tiles{display:grid;gap:.4rem;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.mcpi-addto-search{display:block;width:100%;box-sizing:border-box;min-height:40px;margin:0 0 .6rem;padding:.35rem .7rem;border:1px solid var(--a-rule);border-radius:8px;background:var(--a-card);color:var(--a-ink);font:inherit;font-size:16px}
.mcpi-addto-groups{display:grid;gap:.7rem;max-height:min(46vh,24rem);overflow:auto;padding-right:.15rem}
.mcpi-addto-group[hidden],.mcpi-addto-tile[hidden],.mcpi-addto-hint[hidden]{display:none}
.mcpi-addto-group-name{margin:0 0 .3rem;font-size:.72rem;font-weight:700;color:var(--a-mute)}
.mcpi-addto-tile{display:grid;grid-template-columns:22px minmax(0,1fr);column-gap:.55rem;row-gap:.05rem;align-items:center;text-align:left;min-height:52px;padding:.45rem .7rem;border:1px solid var(--a-rule);border-radius:8px;background:var(--a-card);color:var(--a-ink);cursor:pointer}
.mcpi-addto-tile b{font-size:.85rem;grid-column:2}
.mcpi-addto-tile span:not(.mcpi-addto-ico){grid-column:2}
.mcpi-addto-ico{grid-row:1/3;width:22px;height:22px;display:grid;place-items:center}
.mcpi-addto-ico img{width:22px;height:22px;display:block}
.mcpi-addto-ico.is-mono{background:var(--a-ink)}
.mcpi-addto-ico.is-letter{border-radius:6px;font-size:.62rem!important;font-weight:800;letter-spacing:-.02em;color:#fff!important}
.mcpi-addto-tile span{font-size:.7rem;color:var(--a-mute)}
.mcpi-addto-tile.is-on{border-color:var(--a-ink);box-shadow:inset 0 0 0 1px var(--a-ink)}
.mcpi-addto-detail{margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--a-rule);display:grid;grid-template-columns:minmax(0,1fr);gap:.6rem}
.mcpi-addto-manual[open]{grid-template-columns:minmax(0,1fr)}
.mcpi-addto-detail>p{margin:0}
.mcpi-addto-detail code{font-family:var(--a-mono);font-size:.78rem}
.mcpi-addto-code{display:flex;gap:.4rem;align-items:flex-start}
.mcpi-addto-code pre{flex:1;min-width:0;margin:0;padding:.55rem .7rem;border:1px solid var(--a-rule);border-radius:6px;font-family:var(--a-mono);font-size:.74rem;line-height:1.5;max-height:14rem;overflow:auto;white-space:pre}
.mcpi-addto-go{justify-self:start;display:inline-flex;align-items:center;min-height:44px;padding:0 1.3rem;border-radius:6px;background:var(--a-ink);color:var(--a-inv)!important;font-weight:800;text-decoration:none}
.mcpi-addto-go.is-quiet{min-height:36px;padding:0 .9rem;background:none;border:1px solid var(--a-rule);color:var(--a-ink)!important;font-weight:700;font-size:.8rem}
.mcpi-addto-hint{margin:0;font-size:.76rem;color:var(--a-mute)}
.mcpi-addto-note{margin:0;font-size:.78rem;color:var(--a-warn)}
.mcpi-addto-secret{display:flex;gap:.5rem;align-items:flex-start;margin-top:.8rem;padding:.55rem .7rem;border:1px solid var(--a-rule);border-radius:8px;cursor:pointer}
.mcpi-addto-secret input{margin-top:.2rem}
.mcpi-addto-secret span{display:grid}
.mcpi-addto-secret small{color:var(--a-mute);font-size:.74rem}
.mcpi-addto-mobile{margin:.8rem 0 0;padding:.6rem .75rem;border-radius:8px;background:var(--a-tint);font-size:.8rem}
.mcpi-addto-away{margin:0;padding:.55rem .7rem;border:1px solid var(--a-warn);border-radius:8px;color:var(--a-warn);font-size:.8rem}
.mcpi-addto-tile.is-away{opacity:.62}
.mcpi-addto-tile.is-away span:not(.mcpi-addto-ico){color:var(--a-warn)}
.mcpi-addto-get{justify-self:start;font-size:.78rem;font-weight:700;color:var(--a-accent)}
.mcpi-addto-away[hidden]{display:none}
.mcpi-addto-go.is-off{opacity:.45;cursor:not-allowed}
.mcpi-addto-steps{margin:0;padding-left:1.3rem;display:grid;gap:.2rem}
.mcpi-addto-manual summary{cursor:pointer;color:var(--a-mute);font-weight:700;font-size:.78rem;min-height:32px;display:flex;align-items:center}
.mcpi-addto-manual[open]{display:grid;gap:.4rem}
.mcpi-addto-trigger{min-height:36px;padding:0 .9rem;border:1px solid var(--a-rule);border-radius:999px;background:var(--a-card);color:var(--a-ink);font:inherit;font-size:.8rem;font-weight:800;cursor:pointer}
.mcpi-addto-trigger:hover{background:var(--a-tint)}
.mcpi-addto-trigger:disabled{opacity:.6;cursor:default}`
function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('mcpi-addto-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'mcpi-addto-style', textContent: CSS }))
}

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid)
  return e
}

/*
 * An icon made from the name, for a client with none on the CDN (or one that cannot load): its initials
 * (two words give two letters) on a color that comes from the name, so each client keeps the same one.
 */
export function initialsOf(label) {
  const words = String(label || '?').replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase().replace(/^(.)(.)$/, (m, a, b) => (words.length > 1 ? a + b : a + b.toLowerCase()))
}
export function hueOf(label) {
  let h = 0
  for (const ch of String(label)) h = (h * 31 + ch.codePointAt(0)) % 360
  return h
}

/* A client's icon. With none on the CDN, or when it cannot load, the tile shows one made from its name. */
function iconOf(id, opts, label) {
  if (opts.icons === false) return null
  const own = opts.icons && opts.icons[id]
  const icon = own ? { src: own } : ICONS[id]
  const box = el('span', { class: 'mcpi-addto-ico', 'aria-hidden': 'true', 'data-icon': icon ? icon.src : '' })
  const letter = () => {
    box.className = 'mcpi-addto-ico is-letter'
    box.style.cssText = `background:hsl(${hueOf(label || id)} 62% 46%)`
    box.replaceChildren(initialsOf(label || id))
  }
  if (!icon) { letter(); return box }
  if (icon.mono) {
    /* Drawn in the text color through a mask. A mask that fails shows nothing, so load it once as an image to know. */
    box.classList.add('is-mono')
    box.style.cssText = `-webkit-mask:url("${icon.src}") center/contain no-repeat;mask:url("${icon.src}") center/contain no-repeat`
    const probe = new Image()
    probe.onerror = letter
    probe.src = icon.src
  } else {
    const img = el('img', { src: icon.src, alt: '', width: '22', height: '22', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
    img.addEventListener('error', letter)
    box.append(img)
  }
  return box
}

/*
 * Calls missed() when the page keeps focus for `ms` after an install link was pressed, which is what happens
 * when no app takes the link. Leaving the page (blur, or the tab hidden) means something opened.
 */
export function watchOpen(missed, ms = 2500, win = typeof window !== 'undefined' ? window : null) {
  if (!win) return
  let left = false
  const away = () => { left = true }
  const hidden = () => { if (win.document.visibilityState === 'hidden') left = true }
  win.addEventListener('blur', away)
  win.document.addEventListener('visibilitychange', hidden)
  win.setTimeout(() => {
    win.removeEventListener('blur', away)
    win.document.removeEventListener('visibilitychange', hidden)
    if (!left) missed()
  }, ms)
}

const LAST = 'mcpi:add-to-ai:last'
const remembered = () => { try { return localStorage.getItem(LAST) } catch (e) { return null } }
const remember = (id) => { try { localStorage.setItem(LAST, id) } catch (e) { /* storage blocked */ } }

const stringsOf = (opts) => Object.assign({}, STRINGS.en, STRINGS[opts.lang], opts.ui)

export function openAddToAi(server, opts = {}) {
  if (!server.url) return withAddress(server, opts).then((s) => openAddToAi(s, opts))
  addStyle()
  const t = stringsOf(opts)
  const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m))
  const mobile = opts.mobile != null ? !!opts.mobile : isMobileDevice()
  const hasSecret = !!secretOf(server)
  let withSecret = hasSecret && opts.secret !== false
  let clients = clientsFor(server, { secret: withSecret })
  const header = headerOf(server)
  const title = server.name || hostOf(server.url)

  const copyable = (text) => {
    const b = el('button', { type: 'button', class: 'mcpi-addto-copy', text: t.copy, 'data-copy': text })
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = t.copied } catch (e) { b.textContent = '✕' }
      setTimeout(() => { b.textContent = t.copy }, 1500)
    })
    return el('div', { class: 'mcpi-addto-code' }, el('pre', { text }), b)
  }

  function detail(c) {
    const out = []
    const away = mobile && !worksOnPhone(c)
    /* On a phone, say first that this one is for a computer; what to copy still follows. */
    if (away) out.push(el('p', { class: 'mcpi-addto-away', text: fill(t.mobileNo, { v: c.label }) }))
    if (mobile && worksOnPhone(c)) out.push(el('p', { class: 'mcpi-addto-hint', text: fill(t.mobileWeb, { v: c.label }) }))
    if (c.kind === 'link') {
      const manual = el('details', { class: 'mcpi-addto-manual', open: away }, el('summary', { text: t.manual }), el('p', { class: 'mcpi-addto-hint' }, el('code', { text: c.file })), copyable(c.code))
      const missed = el('p', { class: 'mcpi-addto-away', hidden: true, text: fill(t.notOpened, { v: c.label }) })
      const go = away
        ? el('span', { class: 'mcpi-addto-go is-off', 'aria-disabled': 'true', text: fill(t.addIn, { v: c.label }) })
        : el('a', { class: 'mcpi-addto-go', href: c.link, text: fill(t.addIn, { v: c.label }), target: /^https:/.test(c.link) ? '_blank' : null, rel: /^https:/.test(c.link) ? 'noopener' : null })
      /*
       * An install link opens the app, or a browser prompt asking to. Either takes focus from the page.
       * When nothing does within a few seconds, the app is likely missing: say so and open the by-hand setup.
       */
      /* A web page link (Kiro, Visual Studio) opens a tab that hands on to the app, so there is nothing to watch. */
      if (!away && !/^https:/.test(c.link)) go.addEventListener('click', () => watchOpen(() => { missed.hidden = false; manual.open = true }))
      out.push(go, away ? null : el('p', { class: 'mcpi-addto-hint', text: fill(t.linkHint, { v: c.label }) }), missed, manual)
    } else if (c.kind === 'command') {
      out.push(el('p', { text: t.run }), copyable(c.code))
    } else if (c.kind === 'file') {
      out.push(el('p', null, t.openFile + ' ', el('code', { text: c.file })), copyable(c.code))
    } else {
      const steps = t[c.steps] || []
      out.push(el('ol', { class: 'mcpi-addto-steps' }, steps.map((s) => el('li', { text: s }))), copyable(c.code),
        c.settings ? el('a', { class: 'mcpi-addto-go is-quiet', href: c.settings, target: '_blank', rel: 'noopener', text: fill(t.openSettings, { v: c.label }) }) : null)
    }
    if (c.note) out.push(el('p', { class: 'mcpi-addto-note', text: fill(t[c.note], { v: c.label, h: header, env: c.env }) }))
    if (c.get) out.push(el('a', { class: 'mcpi-addto-get', href: c.get, target: '_blank', rel: 'noopener', text: fill(t.getIt, { v: c.label }) }))
    return out
  }

  const pane = el('div', { class: 'mcpi-addto-detail', 'aria-live': 'polite' })
  /* Clients in groups (terminal agents, editors, chat apps), with a search box over them all. */
  const tiles = el('div', { class: 'mcpi-addto-groups', role: 'radiogroup', 'aria-label': t.pick })
  const tileEls = () => [...tiles.querySelectorAll('.mcpi-addto-tile')]
  /* A server with its own token: put it in, or not (to pass the setup on to someone else). */
  const secretBox = hasSecret ? el('label', { class: 'mcpi-addto-secret' },
    el('input', { type: 'checkbox', checked: withSecret, onchange: (e) => { withSecret = e.target.checked; clients = clientsFor(server, { secret: withSecret }); choose(pane.dataset.client) } }),
    el('span', null, el('b', { text: t.withSecret }), el('small', { text: t.withSecretHint }))) : null
  function choose(id) {
    const c = clients.find((x) => x.id === id) || clients[0]
    for (const b of tileEls()) { const on = b.dataset.client === c.id; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false') }
    pane.dataset.client = c.id
    pane.replaceChildren(...detail(c).filter(Boolean))
    remember(c.id)
  }
  /* On a phone, the chat apps it can set up come first; the others say they are for a computer. */
  const groups = mobile ? ['app'].concat(GROUPS.filter((g) => g !== 'app')) : GROUPS
  const order = groups.flatMap((g) => clients.filter((c) => c.group === g))
  tiles.append(...groups.map((g) => el('section', { class: 'mcpi-addto-group', 'data-group': g },
    el('p', { class: 'mcpi-addto-group-name', text: t['g_' + g] }),
    el('div', { class: 'mcpi-addto-tiles' }, clients.filter((c) => c.group === g).map((c) => {
      const away = mobile && !worksOnPhone(c)
      return el('button', { type: 'button', class: 'mcpi-addto-tile' + (away ? ' is-away' : ''), role: 'radio', 'aria-checked': 'false', 'data-client': c.id, 'data-find': (c.label + ' ' + c.id + ' ' + t['g_' + g]).toLowerCase(), onclick: () => choose(c.id) },
        iconOf(c.id, opts, c.label), el('b', { text: c.label }), el('span', { text: away ? t.computerOnly : t[c.kind] }))
    })))))
  const none = el('p', { class: 'mcpi-addto-hint', hidden: true, text: t.noMatch })
  /* Typing narrows the tiles (and empty groups hide); Enter picks the first one left. */
  const search = el('input', { type: 'search', class: 'mcpi-addto-search', placeholder: t.search, 'aria-label': t.search, autocomplete: 'off', spellcheck: 'false' })
  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
    for (const b of tileEls()) b.hidden = !words.every((w) => b.dataset.find.includes(w))
    for (const sec of tiles.children) sec.hidden = ![...sec.querySelectorAll('.mcpi-addto-tile')].some((b) => !b.hidden)
    none.hidden = tileEls().some((b) => !b.hidden)
  })
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = tileEls().find((b) => !b.hidden)
    if (first) choose(first.dataset.client)
  })

  const dialog = el('dialog', { class: 'mcpi-addto', 'aria-label': fill(t.title, { v: title }) },
    el('div', { class: 'mcpi-addto-head' },
      el('div', null, el('h2', { text: fill(t.title, { v: title }) }), el('code', { text: server.url })),
      el('button', { type: 'button', class: 'mcpi-addto-close', text: t.close, onclick: () => dialog.close() })),
    mobile ? el('p', { class: 'mcpi-addto-mobile', text: t.mobileBanner }) : null,
    el('p', { class: 'mcpi-addto-label', text: t.pick }), search, tiles, none, secretBox, pane)
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })
  dialog.addEventListener('close', () => dialog.remove())
  ;(opts.root || document.body).append(dialog)
  /* The client picked last, unless this is a phone and it needs a computer. */
  const last = clients.find((c) => c.id === remembered())
  choose(last && !(mobile && !worksOnPhone(last)) ? last.id : order[0].id)
  dialog.showModal()
  return dialog
}

/** A button that opens the popup for this server. */
export function addToAiButton(server, opts = {}) {
  addStyle()
  const t = stringsOf(opts)
  const b = el('button', { type: 'button', class: opts.class || 'mcpi-addto-trigger', text: opts.label || t.button, title: t.button })
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (server.url) { openAddToAi(server, opts); return }
    /* Given by registry name alone: look it up on the first press. */
    b.disabled = true
    b.textContent = t.loading
    try { server = await withAddress(server, opts); b.disabled = false; b.textContent = opts.label || t.button; openAddToAi(server, opts) } catch (err) { b.textContent = t.notFound }
  })
  return b
}

/*
 * <mcp-add-to-ai registry="io.github.x/y" lang="ko" label="…"></mcp-add-to-ai>
 * <mcp-add-to-ai url="…" name="…" header="X-API-Key"></mcp-add-to-ai>
 * Draws the same button in place (no shadow DOM, so the page can style it). Given a registry name alone, it reads the address,
 * title and needed header from the registry first (registry-api="…" points at another registry), and says so when it is not there.
 */
export function defineAddToAi(tag = 'mcp-add-to-ai') {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  customElements.define(tag, class extends HTMLElement {
    static get observedAttributes() { return ['url', 'name', 'registry', 'header', 'lang', 'label', 'registry-api'] }
    connectedCallback() { this.render() }
    attributeChangedCallback() { if (this.isConnected) this.render() }
    async render() {
      const a = (k) => this.getAttribute(k) || undefined
      const opts = { lang: a('lang'), label: a('label'), registryApi: a('registry-api') }
      const given = { url: a('url'), name: a('name'), id: a('registry'), header: a('header') }
      if (!given.url && !given.id) { this.replaceChildren(); return }
      if (given.url) { this.replaceChildren(addToAiButton(given, opts)); return }
      /* Registry name alone: a waiting button, then the real one (or why there is none). A newer render wins. */
      const mine = (this.seq = (this.seq || 0) + 1)
      const t = stringsOf(opts)
      addStyle()
      this.dataset.state = 'loading'
      this.replaceChildren(el('button', { type: 'button', class: 'mcpi-addto-trigger', disabled: true, text: t.loading }))
      try {
        const found = await fromRegistry(given.id, opts)
        if (mine !== this.seq) return
        this.dataset.state = 'ready'
        this.replaceChildren(addToAiButton(Object.assign({}, found, { name: given.name || found.name, header: given.header || found.header }), opts))
      } catch (e) {
        if (mine !== this.seq) return
        this.dataset.state = 'missing'
        this.replaceChildren(el('button', { type: 'button', class: 'mcpi-addto-trigger', disabled: true, text: t.notFound, title: String(e.message || e) }))
      }
    }
  })
}
