/*
 * Links into the page. No UI here (app.js draws it). Adding a server to an AI client is add-to-ai.js.
 *
 *   linkOf(server)        the query that opens this server again, kept short:
 *                           ?s=<key>                  a pinned server
 *                           ?r=<name>                 a server from the MCP Registry
 *                           ?u=<address>              any other server (https:// is left out)
 *                         followed by &oauth, or &h=<header name>, when it needs sign-in.
 *                         &to=<client> (an add-to-ai.js client id) hands the server on to that AI client once it connects.
 *   readLink(params)      the same query read back: { server, registry, url, auth, header } (only what is valid).
 *                         The long keys (?server= ?registry= ?url= &auth= &header=) are read too, since links with them are already out.
 *   registryEntry(base, name)   the address the registry answers one server at
 *
 * A header value (a token) never goes into a link, only the header name.
 * Links are kept in browser history, server logs and chat previews, so a token there would leak.
 */
import { cleanUrl } from './lib.js'

/* A header name as HTTP allows it (RFC 9110 token characters). Anything else in a link is ignored. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/
/* An AI client id from add-to-ai.js (claude-code, vscode, …), for &to=. */
const CLIENT_ID = /^[a-z0-9-]{1,40}$/
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
export const OWN_KEYS = ['s', 'r', 'u', 'h', 'oauth', 'to', 'server', 'registry', 'url', 'auth', 'header', 'code', 'state', 'error', 'error_description', 'error_uri', 'iss']

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
    to: CLIENT_ID.test(get('to')) ? get('to') : '',
  }
}

export const registryEntry = (base, name) => base.replace(/\/+$/, '') + '/' + encodeURIComponent(name) + '/versions/latest'
