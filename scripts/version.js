/*
 * Runs on `npm version` (the "version" script): writes the new package.json version into CLIENT_INFO in src/conn.js,
 * so the version a server sees in initialize is the published one. A test checks the two agree.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const file = new URL('src/conn.js', root)
const src = readFileSync(file, 'utf8')
const out = src.replace(/(CLIENT_INFO = \{ name: 'mcp-inspector-web', version: ')[^']*(' \})/, '$1' + version + '$2')
if (out === src && !src.includes("version: '" + version + "'")) throw new Error('CLIENT_INFO not found in src/conn.js')
writeFileSync(file, out)
