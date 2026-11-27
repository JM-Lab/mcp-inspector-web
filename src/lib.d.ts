/* Types for mcp-inspector-web/lib: logic with no UI. */

export interface Card { url: string; name: string; desc: string; icon: string; id?: string; web?: string; hint?: string; hintValue?: string; open?: boolean }
export interface Storage2 { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

export const STORE_PREFIX: string
export const CAP: number
export const REG_FIRST: number
export const REGISTRY: string
export const FILTERS: string[]
export function storeKeys(prefix?: string): { v2: string; v1: string }
export function hostOf(url: string): string
/** An address on this computer or a private network (localhost, 10.x, 192.168.x, .local, …). */
export function isPrivateAddress(url: string): boolean
export function cleanUrl(text: string): string | null
export function pickRemote(sv: object, opts?: { http?: boolean }): { url: string; headers?: object[] } | null
export function isActive(entry: object): boolean
export function registryCard(sv: object, opts?: { http?: boolean }): (Card & { id: string; hint: string; web: string }) | null
export function registryCards(list: object[], max?: number): Card[]
export function iconCandidates(s: { url: string; icon?: string; web?: string }): string[]
export function pushFront<T extends { url: string }>(list: T[], item: T, cap?: number): T[]
export function filled<T extends object>(obj: T | null | undefined): Partial<T>
export function without<T extends { url: string }>(list: T[] | null | undefined, url: string): T[]
export function loadStore(storage: Storage2, prefix?: string): { mine: object[]; recent: object[] }
export function saveStore(storage: Storage2, state: { mine: object[]; recent: object[] }, prefix?: string): void
export function countsText(n: Record<string, number> | null | undefined): string
export function featuredFor(filter: string, featured: { servers?: Card[] } | null | undefined): Card[]
export function isAuthError(e: unknown): boolean
export function isNetError(e: unknown): boolean
export function kindOf(prop: object): string
export function parseValue(kind: string, raw: string, prop?: object): unknown
export function missingRequired(schema: object, values: Record<string, unknown>): string[]
export function clientMetadataFor(setting: string | Record<string, string> | null | undefined, origin: string): string | undefined
export function partsOf(result: object): object[] | null
export function explainError(e: unknown, oauth: boolean, ui: Record<string, string>): string
