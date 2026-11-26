/*
 * Logic with no UI. The page and the tests use the same code.
 * Nothing here touches the DOM or localStorage directly: storage is passed in.
 */

/** Default key prefix for everything the inspector keeps in the browser. */
export const STORE_PREFIX = 'mcpi'
/** Storage keys for a prefix. v1 was a plain array of added servers. */
export const storeKeys = (prefix = STORE_PREFIX) => ({ v2: prefix + ':v2', v1: prefix + ':v1' })
/** How many added servers and recently viewed servers each are kept in the browser. */
export const CAP = 10
/** How many registry cards are shown before "Show more". */
export const REG_FIRST = 6
/** The official MCP Registry. */
export const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers'

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

/** Reads what was saved. v1 (an array) becomes the added servers. Broken values read as empty lists. */
export function loadStore(storage, prefix = STORE_PREFIX) {
  const keys = storeKeys(prefix)
  const read = (k) => { try { return JSON.parse(storage.getItem(k)) } catch (e) { return null } }
  const ok = (list) => (Array.isArray(list) ? list : []).filter((s) => s && cleanUrl(s.url)).map(slim).slice(0, CAP)
  const v2 = read(keys.v2)
  if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) return { mine: ok(v2.mine), recent: ok(v2.recent) }
  return { mine: ok(read(keys.v1)), recent: [] }
}

export function saveStore(storage, state, prefix = STORE_PREFIX) {
  try { storage.setItem(storeKeys(prefix).v2, JSON.stringify({ mine: (state.mine || []).map(slim).slice(0, CAP), recent: (state.recent || []).map(slim).slice(0, CAP) })) } catch (e) { /* storage blocked */ }
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
