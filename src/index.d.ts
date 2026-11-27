/* Types for mcp-inspector-web. */

export interface PinnedServer {
  key: string
  name: string
  url: string
  desc?: string
  icon?: string
  counts?: Record<string, number>
  examples?: { tool: string; args: Record<string, unknown>; label: string | { en?: string; ko?: string } }[]
}

export interface MountOptions {
  lang?: 'en' | 'ko'
  ui?: Record<string, string>
  servers?: PinnedServer[]
  /** URL of, or the object of, a featured.json. */
  featured?: string | object | null
  /** Registry API base, or false to hide the registry panel. */
  registry?: string | false | null
  storagePrefix?: string
  clientInfo?: { name: string; version: string } | null
  oauth?: { clientName?: string; clientMetadataUrl?: string | Record<string, string> | null }
  syncUrl?: boolean
  pageUrl?: string | null
  /** Replaces any string of the add-to-AI-client popup. */
  addToAiUi?: Record<string, string | string[]>
  /** Replaces any string of the debugger (the Debug tab and the failure notice). */
  debugUi?: Record<string, unknown>
  /** Keep one server open: the first well-known one on a visit with no link, the next one after removing the open one. Default true. */
  openFirst?: boolean
  /** A link (?u=, ?r=) to an address on this computer or a private network waits for a press before connecting. Default: on a public page, yes; on localhost, no. true or false sets it. */
  holdPrivate?: boolean
}

export interface Inspector {
  /** Closes every connection and empties the element. Servers kept in this browser stay. */
  destroy(): void
}

export function mount(root: HTMLElement, options?: MountOptions): Inspector
/** Registers the <mcp-inspector> element (or another tag name). Attributes: lang, page-url, registry, featured, storage-prefix, sync-url, open-first, hold-private; el.options takes any MountOptions. */
export function defineInspector(tag?: string): void

export const STRINGS: { en: Record<string, string>; ko: Record<string, string> }
export const CLIENT_INFO: { name: string; version: string }

export type ConnState = 'idle' | 'connecting' | 'connected' | 'failed'
/** One connection to an MCP server, through the official SDK. */
export class Conn {
  constructor(server: { url: string; name?: string; key?: string; headers?: Record<string, string> | null }, hooks?: Record<string, unknown>)
  server: { url: string; name?: string; key?: string; headers?: Record<string, string> | null }
  state: ConnState
  error: string
  needAuth: boolean
  log: unknown[]
  /** Every HTTP request and JSON-RPC message of this connection (see mcp-inspector-web/debug). */
  trace: import('./debug').Trace
  client: unknown
  lastMs?: number
  connect(opts?: { oauth?: boolean; callback?: URLSearchParams }): Promise<Record<string, unknown>>
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

export { addToAiButton, openAddToAi, clientsFor, fromRegistry, defineAddToAi } from './add-to-ai.js'
export { createTrace, debugView, debugNotice } from './debug.js'
export * from './lib.js'
