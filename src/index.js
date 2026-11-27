/*
 * MCP Inspector Web. Import this to mount the inspector on your own page:
 *
 *   import { mount } from 'mcp-inspector-web'
 *   import 'mcp-inspector-web/style.css'
 *   mount(document.getElementById('inspector'), { lang: 'en' })
 *
 * The headless parts (Conn, the helpers in lib.js) are exported too, for tests and other UIs,
 * and so is the add-to-AI-client component (add-to-ai.js, also on its own as 'mcp-inspector-web/add-to-ai').
 */
export { mount } from './app.js'
export { defineInspector } from './element.js'
export { Conn, CLIENT_INFO } from './conn.js'
export { STRINGS } from './strings.js'
export { addToAiButton, openAddToAi, clientsFor, fromRegistry, defineAddToAi } from './add-to-ai.js'
export * from './lib.js'
