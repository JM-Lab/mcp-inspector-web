/*
 * Script tag entry. Mounts on the element whose id is options.root (default "mcpi"),
 * reading options from window.MCP_INSPECTOR when the page sets it before this script runs.
 *
 *   <div id="mcpi"></div>
 *   <script>window.MCP_INSPECTOR = { lang: 'en' }</script>
 *   <script src="mcp-inspector.js" defer></script>
 *
 * It also defines <mcp-inspector> (element.js), for pages that would rather write the tag.
 */
import { mount } from './app.js'
import { defineInspector } from './element.js'

/* <mcp-inspector> works with this bundle too. */
defineInspector()
const options = (typeof window !== 'undefined' && window.MCP_INSPECTOR) || {}
const root = typeof document !== 'undefined' && document.getElementById(options.root || 'mcpi')
if (root) mount(root, options)
