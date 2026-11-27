/* Types for mcp-inspector-web/debug: the connection trace (no DOM) and the debugger that draws it. */

export const HIDE: string

export type EventLevel = 'ok' | 'fail' | 'warn' | 'info' | 'busy'
export type StepKey = 'unauth' | 'resource' | 'server' | 'register' | 'redirect' | 'return' | 'token' | 'ready'
export type StepStatus = 'ok' | 'warn' | 'fail' | 'skip' | 'none' | 'busy'

/** One recorded thing, secrets already replaced. */
export interface TraceEvent {
  seq: number
  run: number
  at: number
  type: 'http' | 'rpc' | 'note'
  /** http: what the request is. note: start, register, redirect or return. */
  kind?: 'mcp' | 'resource' | 'server' | 'register' | 'token' | 'other' | 'start' | 'redirect' | 'return'
  method?: string
  url?: string
  /** null while waiting, 0 for no answer. */
  status?: number | null
  ok?: boolean
  ms?: number | null
  /** The sign-in this belongs to, when it happened during one. */
  flow?: number
  error?: string
  /** For a request with no answer: 'cors' (the server is there), 'unreachable', or 'mixed' (http from an https page). */
  reach?: 'cors' | 'unreachable' | 'mixed'
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
  request?: unknown
  response?: unknown
  /** http to the MCP server: the JSON-RPC messages it carried. */
  rpc?: { method: string; id?: string | number }[]
  /** rpc: which way, the message, the request that carried it, the answer. */
  dir?: 'out' | 'in'
  id?: string | number
  message?: unknown
  http?: number
  reply?: number
  to?: number
  params?: Record<string, string>
  how?: 'metadata' | 'saved'
}

export interface Trace {
  /** A fetch to give the SDK's transport ({ fetch: trace.fetch }). */
  fetch: typeof fetch
  /** Records what the transport sends and receives. Starts a new run. */
  tap<T extends { send: (...a: any[]) => any }>(transport: T, opts?: { signIn?: boolean; resume?: boolean }): T
  begin(opts?: { signIn?: boolean; resume?: boolean }): number
  sent(msg: unknown): void
  received(msg: unknown): void
  redirect(url: string | URL): void
  returned(params: URLSearchParams): void
  readonly events: TraceEvent[]
  export(): TraceEvent[]
  restore(list: TraceEvent[]): void
  subscribe(fn: () => void): () => void
  clear(): void
  scrub<T>(value: T): T
}

export interface Hint { code: string; [k: string]: unknown }
export interface Step { key: StepKey; status: StepStatus; events: number[]; hint?: Hint; how?: 'metadata' | 'saved'; at?: number }
export interface Failure { step?: StepKey; hint: Hint; seq: number }

export function createTrace(opts?: { url?: string; fetch?: typeof fetch; probe?: boolean; max?: number }): Trace
export function judge(events: TraceEvent[]): { flow: { steps: Step[]; failed: Step | null; from: number; current: boolean } | null; failure: Failure | null; level(e: TraceEvent): EventLevel }
export function rowsOf(events: TraceEvent[]): {
  events: TraceEvent[]
  judged: ReturnType<typeof judge>
  list: TraceEvent[]
  carried: Map<number, TraceEvent[]>
  level(e: TraceEvent): EventLevel
  keep(e: TraceEvent, filter?: 'all' | 'rpc' | 'http' | 'errors'): boolean
}
export const MODERN_REVISION: string
export const NEWEST_LEGACY_REVISION: string
export type RevisionLevel = 'current' | 'info' | 'warn'
/** 'current' (2026-07-28 or later), 'info' (2025-11-25), 'warn' (older), or null. */
export function revisionLevel(version: string | null | undefined): RevisionLevel | null
/** What the last connection settled on, read from its messages. */
export function protocolOf(events: TraceEvent[]): {
  era: 'modern' | 'legacy' | null
  version: string | null
  level: RevisionLevel | null
  /** The server/discover tried first, or null when the client did not probe. */
  probe: { seq: number; ok: boolean; asked: string | null; status?: number; error?: string } | null
  /** It probed, was not answered that way, and used initialize. */
  fellBack: boolean
}
export function toLog(events: TraceEvent[], opts?: { messages?: boolean }): string
export function masked<T>(value: T, names?: RegExp): T
export function maskedUrl(url: string | URL): string
export function kindOf(method: string, url: string, body?: string, mcpUrl?: string): string
export function tripStore(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }, prefix: string): {
  save(url: string, list: TraceEvent[]): void
  take(url: string, maxAge?: number): TraceEvent[]
  drop(url: string): void
}

export interface DebugOptions { lang?: 'en' | 'ko'; ui?: Record<string, unknown>; url?: string }
export const STRINGS: { en: Record<string, unknown>; ko: Record<string, unknown> }
export function debugView(trace: Trace, opts?: DebugOptions): { el: HTMLElement; show(seq: number): void; showFailure(): void; refresh(): void; destroy(): void }
export function debugNotice(trace: Trace, opts?: DebugOptions & { onShow?(seq: number | null): void; active?(): boolean; fallback?(): string }): { el: HTMLElement; refresh(): void; destroy(): void }
export function failureText(failure: Failure | null, opts?: DebugOptions): { title: string; detail: string } | null
