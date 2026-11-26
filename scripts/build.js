/*
 * Builds the script tag bundle and the stylesheet into dist/, and copies them next to the demo page.
 *   dist/mcp-inspector.js   IIFE, mounts on #mcpi with window.MCP_INSPECTOR (src/auto.js)
 *   dist/mcp-inspector.css  src/style.css, minified
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const common = { bundle: true, minify: true, legalComments: 'none', logLevel: 'info' }
await build({ ...common, entryPoints: [join(root, 'src/auto.js')], outfile: join(root, 'dist/mcp-inspector.js'), format: 'iife', platform: 'browser', target: ['es2020', 'safari16'] })
await build({ ...common, entryPoints: [join(root, 'src/style.css')], outfile: join(root, 'dist/mcp-inspector.css') })
mkdirSync(join(root, 'demo'), { recursive: true })
for (const f of ['mcp-inspector.js', 'mcp-inspector.css']) copyFileSync(join(root, 'dist', f), join(root, 'demo', f))
