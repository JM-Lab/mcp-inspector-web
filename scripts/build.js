/*
 * Builds the script tag bundle and the stylesheet into dist/, and copies them next to the demo page.
 *   dist/mcp-inspector.js              IIFE, mounts on #mcpi with window.MCP_INSPECTOR (src/auto.js)
 *   dist/mcp-inspector.css             src/style.css, minified
 *   dist/mcp-add-to-ai.js                 IIFE, the add-to-AI-client component alone: <mcp-add-to-ai> (src/add-to-ai-auto.js)
 *   dist/THIRD-PARTY-LICENSES.txt      the license of every package bundled into mcp-inspector.js
 * The bundle carries the MCP SDK and what it depends on, so their license texts ship next to it.
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const common = { bundle: true, minify: true, legalComments: 'none', logLevel: 'info' }
const js = await build({ ...common, entryPoints: [join(root, 'src/auto.js')], outfile: join(root, 'dist/mcp-inspector.js'), format: 'iife', platform: 'browser', target: ['es2020', 'safari16'], metafile: true })
await build({ ...common, entryPoints: [join(root, 'src/style.css')], outfile: join(root, 'dist/mcp-inspector.css') })
await build({ ...common, entryPoints: [join(root, 'src/add-to-ai-auto.js')], outfile: join(root, 'dist/mcp-add-to-ai.js'), format: 'iife', platform: 'browser', target: ['es2020', 'safari16'] })

/* Every package that ended up in the bundle, with its license text. A package with no license file stops the build. */
const dirs = new Set()
for (const file of Object.keys(js.metafile.inputs)) {
  const at = file.lastIndexOf('node_modules/')
  if (at < 0) continue
  const rest = file.slice(at + 'node_modules/'.length).split('/')
  dirs.add(file.slice(0, at) + 'node_modules/' + rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/'))
}
const notices = [...dirs].map((dir) => {
  const abs = join(root, dir)
  const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8'))
  const file = readdirSync(abs).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f))
  if (!file) throw new Error('No license file in ' + dir)
  return { name: pkg.name, text: pkg.name + ' ' + pkg.version + ' (' + pkg.license + ')\n\n' + readFileSync(join(abs, file), 'utf8').trim() }
}).sort((a, b) => (a.name < b.name ? -1 : 1))
writeFileSync(join(root, 'dist/THIRD-PARTY-LICENSES.txt'),
  'mcp-inspector.js bundles the packages below. Each is shown with its license.\n\n' + notices.map((n) => '-'.repeat(80) + '\n' + n.text).join('\n\n') + '\n')
console.log('  dist/THIRD-PARTY-LICENSES.txt  ' + notices.map((n) => n.name).join(', '))

mkdirSync(join(root, 'demo'), { recursive: true })
for (const f of ['mcp-inspector.js', 'mcp-inspector.css', 'mcp-add-to-ai.js']) copyFileSync(join(root, 'dist', f), join(root, 'demo', f))
