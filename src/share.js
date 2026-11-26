/*
 * Links into the page, and how to add the open server to MCP clients. No UI here (app.js draws it).
 *
 *   linkOf(server)        the query that opens this server again, kept short:
 *                           ?s=<key>                  a pinned server
 *                           ?r=<name>                 a server from the MCP Registry
 *                           ?u=<address>              any other server (https:// is left out)
 *                         followed by &oauth, or &h=<header name>, when it needs sign-in.
 *   readLink(params)      the same query read back: { server, registry, url, auth, header } (only what is valid).
 *                         The long keys (?server= ?registry= ?url= &auth= &header=) are read too, since links with them are already out.
 *   registryEntry(base, name)   the address the registry answers one server at
 *   installsFor(server)   per MCP client, how to add this server: [{ id, label, link?, file?, code, note? }]
 *                         note is a key of the UI strings (strings.js), so the page shows it in its language.
 *
 * A header value (a token) never goes into a link or an install snippet, only the header name.
 * Links are kept in browser history, server logs and chat previews, so a token there would leak.
 */
import { cleanUrl, hostOf } from './lib.js'

/* A header name as HTTP allows it (RFC 9110 token characters). Anything else in a link is ignored. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/
/* Registry names look like io.github.owner/server (reverse DNS, a slash, a name). */
const REGISTRY_NAME = /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/

/* '/' and ':' are allowed as they are in a query, and keep the link readable (?r=io.github.x/y, ?u=example.com/mcp). */
const enc = (v) => encodeURIComponent(v).replace(/%2F/gi, '/').replace(/%3A/gi, ':')

export function linkOf(server) {
  if (!server) return ''
  const parts = [!server.custom ? 's=' + enc(server.key) : server.id ? 'r=' + enc(server.id) : 'u=' + enc(server.url.replace(/^https:\/\//, ''))]
  /* A header token chosen by the person wins over OAuth: a server that answered 401 once is marked wantsAuth either way. */
  const header = server.headers ? Object.keys(server.headers)[0] : server.authHeader
  if (header && header !== server.hint) parts.push('h=' + enc(header))
  else if (server.wantsAuth && !header) parts.push('oauth')
  return '?' + parts.join('&')
}

/* The query keys this page owns, short and long. Others (a host page's own, like ?lang=) are left as they are. */
export const OWN_KEYS = ['s', 'r', 'u', 'h', 'oauth', 'server', 'registry', 'url', 'auth', 'header', 'code', 'state', 'error', 'error_description', 'error_uri', 'iss']

/** The page query with ours replaced by `ours` ('' clears ours). */
export function mergeQuery(search, ours) {
  const q = new URLSearchParams(search)
  for (const k of OWN_KEYS) q.delete(k)
  const rest = q.toString()
  const mine = String(ours || '').replace(/^\?/, '')
  const all = [rest, mine].filter(Boolean).join('&')
  return all ? '?' + all : ''
}

/*
 * An address from a link. With no scheme it is https (u=example.com/mcp). host:port counts as no scheme (u=localhost:3000/mcp),
 * while any other scheme must be http(s), so javascript: and the like never get through.
 */
function addressOf(raw) {
  if (!raw) return ''
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/:]+:\d/.test(raw)
  return cleanUrl(scheme ? raw : 'https://' + raw) || ''
}

export function readLink(params) {
  const get = (k) => (params.get(k) || '').trim()
  const one = (short, long) => get(short) || get(long)
  const named = get('h') || (get('auth') === 'header' ? get('header') || 'Authorization' : '')
  const header = named ? (HEADER_NAME.test(named) ? named : 'Authorization') : ''
  const auth = header ? 'header' : params.has('oauth') || get('auth') === 'oauth' ? 'oauth' : ''
  const registry = one('r', 'registry')
  return {
    server: one('s', 'server'),
    registry: REGISTRY_NAME.test(registry) ? registry : '',
    url: addressOf(one('u', 'url')),
    auth,
    header,
  }
}

export const registryEntry = (base, name) => base.replace(/\/+$/, '') + '/' + encodeURIComponent(name) + '/versions/latest'

/* A name MCP clients accept as a key: lower case letters, digits and dashes. */
export function slugOf(server) {
  const from = server.id ? server.id.split('/').pop() : server.name || hostOf(server.url)
  return String(from).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mcp-server'
}

/* Base64 of UTF-8 text, in the browser and in Node (the tests). */
const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const json = (v) => JSON.stringify(v, null, 2)

export function installsFor(server) {
  const name = slugOf(server)
  const url = server.url
  const header = server.headers ? Object.keys(server.headers)[0] : server.authHeader || server.hint || ''
  /* A placeholder in place of the token. Each client fills it in its own way. */
  const value = header.toLowerCase() === 'authorization' ? 'Bearer <token>' : '<token>'
  const headers = header ? { [header]: value } : undefined
  const tokenNote = header ? 'iToken' : ''

  const vscode = { name, type: 'http', url, headers: header ? { [header]: header.toLowerCase() === 'authorization' ? 'Bearer ${input:token}' : '${input:token}' } : undefined }
  const vscodeFile = { servers: { [name]: { type: 'http', url, headers: vscode.headers } } }
  if (header) vscodeFile.inputs = [{ type: 'promptString', id: 'token', description: header, password: true }]
  const cursor = { url, headers }

  return [
    {
      id: 'claude-code', label: 'Claude Code',
      code: 'claude mcp add --transport http ' + name + ' ' + url + (header ? ` --header "${header}: ${value}"` : ''),
      note: tokenNote,
    },
    {
      id: 'vscode', label: 'VS Code',
      link: 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify(vscode)),
      file: '.vscode/mcp.json', code: json(vscodeFile),
      note: header ? 'iVscode' : '',
    },
    {
      id: 'cursor', label: 'Cursor',
      link: 'cursor://anysphere.cursor-deeplink/mcp/install?name=' + encodeURIComponent(name) + '&config=' + encodeURIComponent(b64(JSON.stringify(cursor))),
      file: '~/.cursor/mcp.json', code: json({ mcpServers: { [name]: cursor } }),
      note: tokenNote,
    },
    {
      id: 'claude', label: 'Claude (custom connector)',
      code: url,
      note: header ? 'iClaudeHeader' : 'iClaude',
    },
  ]
}
