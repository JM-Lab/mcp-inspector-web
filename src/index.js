/*
 * MCP Inspector Web. Import this to mount the inspector on your own page:
 *
 *   import { mount } from 'mcp-inspector-web'
 *   import 'mcp-inspector-web/style.css'
 *   mount(document.getElementById('inspector'), { lang: 'en' })
 *
 * The headless parts (Conn, the helpers in lib.js) are exported too, for tests and other UIs.
 */
export { mount } from './app.js'
export { Conn, CLIENT_INFO } from './conn.js'
export { STRINGS } from './strings.js'
export * from './lib.js'
