/* Types for mcp-inspector-web/add-to-ai: the add-to-AI-client component. */

/** A server to add. Give `url`, or `id` alone to read the rest from the MCP Registry. */
export interface AddToAiServer {
  url?: string
  name?: string
  /** Its MCP Registry name, such as com.microsoft/microsoft-learn-mcp. */
  id?: string
  /** The name of the header token it needs. */
  header?: string
  /** The token itself, `{ name: value }`, for a server you set up. Put in unless `opts.secret` is false. */
  headers?: Record<string, string>
  /** It signs in with OAuth. */
  oauth?: boolean
}

export type ClientGroup = 'agent' | 'editor' | 'app'
export type ClientKind = 'link' | 'command' | 'file' | 'settings'

/** How one AI client adds the server. */
export interface AiClient {
  id: string
  label: string
  group: ClientGroup
  kind: ClientKind
  /** One-click install link (kind link). */
  link?: string
  /** The config file to edit (kind link or file). */
  file?: string
  /** What to run, put in the file, or paste. */
  code: string
  /** Key of the steps text (kind settings). */
  steps?: string
  /** The app's settings page (kind settings). */
  settings?: string
  /** Key of the note shown under it, or ''. */
  note: string
  /** Where to get the client. */
  get?: string
  /** The environment variable that holds the token (Codex). */
  env?: string
  /** Where, in the client, to see that the server is connected: a command (/mcp), or the key of a string that says. */
  check?: string
  /** The link carries the server's own token. */
  secretInLink?: boolean
}

/** A link the page using the component offers under a client. Without a label it is the connect link. */
export interface ShareLink { url: string; label?: string; hint?: string; icon?: 'plug' | 'flask' | 'copy' }

export interface AddToAiOptions {
  /** A link your page makes for this server and client, drawn as a copy button under it in place of the install link (the inspector's: open, test, and come back to this client). */
  shareLink?: (client: AiClient) => string | ShareLink | Array<string | ShareLink> | null | undefined
  lang?: 'en' | 'ko'
  /** Replaces any built-in string. */
  ui?: Record<string, string | string[]>
  /** Where the popup goes. Default document.body. */
  root?: Element
  /** The button text. */
  label?: string
  /** The button class (replaces mcpi-addto-trigger). */
  class?: string
  /** Another registry API. Default the official one. */
  registryApi?: string
  /** false leaves icons out; { clientId: url } replaces some. */
  icons?: false | Record<string, string>
  /** Overrides the phone or tablet check. */
  mobile?: boolean
  /** false keeps the server's own token out of what is shown. */
  secret?: boolean
  /** The client to open on. */
  client?: string
  /** Say the server was checked and answers. */
  verified?: boolean
  /** Try that client's one-click link at once. */
  autoOpen?: boolean
}

export interface RegistryServer { url: string; name: string; id: string; header: string }

export const REGISTRY_API: string
export const GROUPS: ClientGroup[]
export const ICONS: Record<string, { src: string; mono?: boolean }>
export const STRINGS: { en: Record<string, string | string[]>; ko: Record<string, string | string[]> }

export function addToAiButton(server: AddToAiServer, opts?: AddToAiOptions): HTMLButtonElement
/** The popup. A Promise when the server is given by registry name alone. */
export function openAddToAi(server: AddToAiServer & { url: string }, opts?: AddToAiOptions): HTMLDialogElement
export function openAddToAi(server: AddToAiServer, opts?: AddToAiOptions): HTMLDialogElement | Promise<HTMLDialogElement>
/** Rejects when the name is not there, has no usable remote, or is not active (`err.inactive`). */
export function fromRegistry(name: string, opts?: { registryApi?: string }): Promise<RegistryServer>
export function clientsFor(server: AddToAiServer & { url: string }, opts?: { secret?: boolean }): AiClient[]
export function defineAddToAi(tag?: string): void
export function slugOf(server: AddToAiServer): string
export function worksOnPhone(client: AiClient): boolean
export function isMobileDevice(nav?: Partial<Navigator> & { userAgentData?: { mobile?: boolean } }): boolean
export function initialsOf(label: string): string
export function hueOf(label: string): number
export function watchOpen(missed: () => void, ms?: number, win?: Window | null): void
