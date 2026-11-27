/*
 * Logic with no UI. The page and the tests use the same code.
 * Nothing here touches the DOM or localStorage directly: storage is passed in.
 */

import { revisionLevel } from './trace.js'

/*
 * What this inspector uses that came with a later revision of the protocol, by the revision that brought it.
 * Each is something the code here does: the elicitation form (conn.js), display titles and tool hints with the
 * two-press guard for destructive tools (panes.js), argument suggestions (panes.js). Nothing else is listed.
 */
const SINCE = {
  '2025-03-26': ['annotations', 'completions'],
  '2025-06-18': ['elicitation', 'titles'],
}

/**
 * What to say about the revision a connection settled on: { level, missing }.
 *   level     'current' (2026-07-28 or later), 'info' (2025-11-25, the earlier way, still allowed by the specification),
 *             'warn' (older), or null when the revision is not known
 *   missing   for 'warn': what this inspector uses that the revision does not have yet (may be empty)
 */
export function revisionNote(version) {
  const level = revisionLevel(version)
  const missing = level === 'warn' ? Object.keys(SINCE).filter((since) => version < since).sort().reverse().flatMap((since) => SINCE[since]) : []
  return { level, missing }
}

/** Default key prefix for everything the inspector keeps in the browser. */
export const STORE_PREFIX = 'mcpi'
/** Storage keys for a prefix. v1 was a plain array of added servers. */
export const storeKeys = (prefix = STORE_PREFIX) => ({ v2: prefix + ':v2', v1: prefix + ':v1', tokens: prefix + ':header-tokens' })
/** How many added servers and recently viewed servers each are kept in the browser. */
export const CAP = 10
/** How many registry cards are shown before "Show more". */
export const REG_FIRST = 6
/** The official MCP Registry. */
export const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers'

/*
 * An address on this computer or a private network (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, .local, IPv6 loopback and local ranges).
 * A link from someone else must not make the browser call such an address by itself.
 */
export function isPrivateAddress(url) {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '') } catch (e) { return false }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0') return true
  if (/^(127|10)\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^169\.254\.\d+\.\d+$/.test(host)) return true
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(host)
  if (m && +m[1] >= 16 && +m[1] <= 31) return true
  return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)
}

export const hostOf = (url) => { try { return new URL(url).host } catch (e) { return String(url) } }

/** Normalizes an address. Returns null unless it is http(s). */
export function cleanUrl(text) {
  try {
    const u = new URL(String(text).trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch (e) { return null }
}

/**
 * The one remote of a registry entry a browser can use: streamable-http, https, no template variables.
 * opts.http also takes http:// remotes, for a page that is itself on http (a local run), where the browser allows them.
 */
export function pickRemote(sv, opts) {
  const scheme = opts && opts.http ? /^https?:\/\// : /^https:\/\//
  return ((sv && sv.remotes) || []).find((r) => r && r.type === 'streamable-http' && scheme.test(r.url || '') && !/[{}]/.test(r.url)) || null
}

/*
 * Whether a registry entry is still active. /versions/latest and version=latest can return a deprecated (or deleted) server,
 * so the official API docs say to check status for a list of active servers. An entry with no status is taken as active.
 */
export function isActive(entry) {
  const meta = (entry && entry._meta && entry._meta['io.modelcontextprotocol.registry/official']) || {}
  return !meta.status || meta.status === 'active'
}

/** A registry entry as one card. null when it has no usable remote. */
export function registryCard(sv, opts) {
  const remote = pickRemote(sv, opts)
  if (!remote) return null
  const need = (remote.headers || []).find((x) => x && (x.isRequired || x.isSecret))
  const icon = ((sv.icons || []).find((i) => i && /^https:\/\//.test(i.src || '')) || {}).src || ''
  /* The registry may say what goes in the header, like "Bearer ${API_KEY}". It becomes the placeholder of the value field. */
  const hintValue = need && need.value ? String(need.value).replace(/\$\{([^}]+)\}/g, '<$1>') : ''
  return { id: sv.name, name: sv.title || sv.name, desc: sv.description || '', url: remote.url, hint: (need && need.name) || '', hintValue, icon, web: sv.websiteUrl || '' }
}

/** Many cards. Each address once, at most max cards. */
export function registryCards(list, max = 30) {
  const out = []
  const seen = new Set()
  for (const sv of list || []) {
    if (!isActive(sv)) continue
    const c = registryCard(sv && sv.server ? sv.server : sv)
    if (!c || seen.has(c.url)) continue
    seen.add(c.url)
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

/*
 * Icon candidates in order. When one fails to load the next is tried (when all fail the UI draws a letter).
 * Registry icon, then the website favicon, then the server host favicon, then the parent domain favicon.
 * Many servers put their source repository in the website field. That favicon belongs to the code host, not the server, so it is skipped.
 */
const CODE_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|npmjs\.com|pypi\.org)$/
export function iconCandidates(s) {
  const out = []
  const add = (u) => { if (u && /^https:\/\//.test(u) && !out.includes(u)) out.push(u) }
  add(s.icon)
  const fav = (url) => { try { return new URL(url).origin + '/favicon.ico' } catch (e) { return '' } }
  if (!CODE_HOSTS.test(hostOf(s.web || ''))) add(fav(s.web))
  add(fav(s.url))
  const host = hostOf(s.url).split(':')[0]
  const parts = host.split('.')
  if (parts.length > 2 && !/^\d+$/.test(parts[parts.length - 1])) add('https://' + parts.slice(1).join('.') + '/favicon.ico')
  return out
}

const slim = (s) => ({ url: s.url, id: s.id || '', authHeader: s.authHeader || '', name: s.name || hostOf(s.url), desc: s.desc || '', icon: s.icon || '', web: s.web || '', hint: s.hint || '', hintValue: s.hintValue || '', headers: s.headers || null })

/** Puts an item first. An item with the same address is replaced, and past cap the oldest (last) drop off. */
export function pushFront(list, item, cap = CAP) {
  return [item].concat((list || []).filter((x) => x.url !== item.url)).slice(0, cap)
}

/** A copy without empty values (null, undefined, ''), so an empty value never overwrites a real one. */
export function filled(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) if (v != null && v !== '') out[k] = v
  return out
}

export const without = (list, url) => (list || []).filter((x) => x.url !== url)

/*
 * A header token is a secret, so its value is kept apart from the list of servers: in `session` (sessionStorage), which goes
 * when the tab closes, like the OAuth tokens. The list in `storage` (localStorage) keeps only the header's name (authHeader),
 * so the field is there, empty, the next time. With no `session` given, a token is not kept at all.
 */
const headerName = (s) => Object.keys(s.headers || {})[0] || s.authHeader || ''
const kept = (s) => Object.assign(slim(s), { authHeader: headerName(s), headers: null })

/**
 * Reads what was saved. v1 (an array) becomes the added servers. Broken values read as empty lists.
 * A token found in `storage` (saved there by an earlier version) is used this once and reported as `moved`, for the page to save again and so take it out.
 */
export function loadStore(storage, prefix = STORE_PREFIX, session) {
  const keys = storeKeys(prefix)
  const read = (from, k) => { try { return JSON.parse(from.getItem(k)) } catch (e) { return null } }
  const tokens = (session && read(session, keys.tokens)) || {}
  let moved = false
  const ok = (list) => (Array.isArray(list) ? list : []).filter((s) => s && cleanUrl(s.url)).map((s) => {
    const out = slim(s)
    if (out.headers) moved = true
    const mine = tokens[out.url]
    if (mine && typeof mine === 'object' && Object.keys(mine).length) out.headers = mine
    if (out.headers && !out.authHeader) out.authHeader = headerName(out)
    return out
  }).slice(0, CAP)
  const v2 = read(storage, keys.v2)
  const lists = v2 && typeof v2 === 'object' && !Array.isArray(v2) ? { mine: ok(v2.mine), recent: ok(v2.recent) } : { mine: ok(read(storage, keys.v1)), recent: [] }
  return moved ? Object.assign(lists, { moved }) : lists
}

export function saveStore(storage, state, prefix = STORE_PREFIX, session) {
  const keys = storeKeys(prefix)
  const lists = { mine: (state.mine || []).slice(0, CAP), recent: (state.recent || []).slice(0, CAP) }
  try { storage.setItem(keys.v2, JSON.stringify({ mine: lists.mine.map(kept), recent: lists.recent.map(kept) })) } catch (e) { /* storage blocked */ }
  if (!session) return
  const tokens = {}
  for (const s of lists.mine.concat(lists.recent)) if (s.headers && Object.keys(s.headers).length) tokens[s.url] = s.headers
  try {
    if (Object.keys(tokens).length) session.setItem(keys.tokens, JSON.stringify(tokens))
    else if (session.removeItem) session.removeItem(keys.tokens)
  } catch (e) { /* storage blocked */ }
}

export function countsText(n) {
  if (!n) return ''
  return [n.tools + ' tools', n.prompts ? n.prompts + ' prompts' : '', n.resources ? n.resources + ' resources' : ''].filter(Boolean).join(' · ')
}

/** Registry filters. known and open come from a prepared list (featured.json), recent asks the registry live. */
export const FILTERS = ['known', 'open', 'recent']
export function featuredFor(filter, featured) {
  const list = (featured && featured.servers) || []
  return filter === 'open' ? list.filter((s) => s.open) : list
}

export const isAuthError = (e) => (e && (e.name === 'UnauthorizedError' || e.status === 401)) || /\b401\b|unauthorized/i.test(String((e && e.message) || e))
export const isNetError = (e) => e instanceof TypeError || /failed to fetch|fetch failed|networkerror|load failed/i.test(String((e && e.message) || e))

/** Which input a schema property becomes: enum, bool, num, list, json or text. */
export function kindOf(p) {
  p = p || {}
  if (p.enum) return 'enum'
  const types = [].concat(p.type || []).concat((p.anyOf || p.oneOf || []).map((x) => x && x.type)).filter(Boolean)
  if (types.includes('array')) return (p.items && (p.items.type === 'object' || p.items.type === 'array')) ? 'json' : 'list'
  if (types.includes('boolean')) return 'bool'
  if (types.includes('integer') || types.includes('number')) return 'num'
  if (types.includes('object')) return 'json'
  return 'text'
}

/**
 * Turns the text of an input into the value to send. An empty input is undefined (not sent).
 * Text in a number input or broken JSON returns { error }, so it is stopped before it reaches the server.
 */
export function parseValue(kind, raw, prop) {
  const v = String(raw == null ? '' : raw).trim()
  if (v === '') return { value: undefined }
  if (kind === 'bool') return { value: v === 'true' }
  if (kind === 'num') return /^-?\d+(\.\d+)?$/.test(v) ? { value: Number(v) } : { error: 'num' }
  if (kind === 'enum') { const hit = ((prop && prop.enum) || []).find((x) => String(x) === v); return { value: hit === undefined ? v : hit } }
  if (kind === 'list') return { value: v.split(',').map((x) => x.trim()).filter(Boolean) }
  if (kind === 'json') { try { return { value: JSON.parse(v) } } catch (e) { return { error: 'json' } } }
  return { value: v }
}

/** Names of required properties that have no value. */
export function missingRequired(schema, values) {
  return [].concat((schema && schema.required) || []).filter((k) => values[k] === undefined || (Array.isArray(values[k]) && !values[k].length))
}

/** The client metadata document to offer as client_id on this origin, if any. A string, or a map of origin to URL. */
export function clientMetadataFor(setting, origin) {
  if (!setting) return undefined
  if (typeof setting === 'string') return setting
  return setting[origin] || undefined
}

/** The content parts of a result: tool content, resource contents, or prompt messages (each with its role). null when there are none to show as parts. */
export function partsOf(result) {
  if (result && Array.isArray(result.content)) return result.content
  if (result && Array.isArray(result.contents)) return result.contents
  if (result && Array.isArray(result.messages)) return result.messages.map((m) => Object.assign({ role: m.role }, m.content))
  return null
}

/** The sentence shown to a person for an error. ui holds the strings (strings.js); oauth says whether an OAuth sign-in was under way. */
export function explainError(e, oauth, ui) {
  if (e && e.name === 'AbortError') return 'Cancelled'
  if (oauth && isNetError(e)) return ui.failOauth
  if (/dynamic client registration/i.test(String((e && e.message) || e))) return ui.failDcr
  if (isNetError(e)) return ui.failCors
  if (isAuthError(e)) return ui.failAuth
  return String((e && e.message) || e)
}
