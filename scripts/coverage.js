/*
 * Which lines of src/ the browser tests ran. The Node tests are measured by node itself; the page code (app.js, panes.js, …)
 * only runs inside Chrome, so this reads the V8 coverage scripts/chrome.js records there.
 *
 *   npm run coverage            Node's coverage report for the tests that run in Node, then the browser tests' coverage of src/
 *   node scripts/coverage.js <dir> [--uncovered]   just the report, from what MCPI_COVERAGE=<dir> recorded
 *
 * The test bundles are not minified, and esbuild marks each source file in them with a `// src/<file>.js` line, so a line of
 * the bundle maps back to its file. A line counts as run when any of its code ran in any page the tests opened.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const showUncovered = process.argv.includes('--uncovered')
if (!dir) { console.error('usage: node scripts/coverage.js <dir> [--uncovered]'); process.exit(2) }

/* One run array per script address: 1 where code ran in any page load. Inner ranges come after outer ones, so painting in order is right. */
const sources = {}
const ran = {}
for (const f of readdirSync(dir).filter((x) => /^chrome-.*\.json$/.test(x))) {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  Object.assign(sources, data.sources)
  for (const snap of data.covered) {
    const src = sources[snap.url] || data.sources[snap.url]
    if (!src) continue
    const paint = new Uint8Array(src.length)
    for (const fn of snap.functions) for (const r of fn.ranges) paint.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset)
    const all = (ran[snap.url] = ran[snap.url] || new Uint8Array(src.length))
    for (let i = 0; i < paint.length; i++) if (paint[i]) all[i] = 1
  }
}

/* Per source file: its code lines, and for each whether it ran. The same file in several bundles counts once, run if run in any. */
const files = {}
const isCode = (t) => t && !/^(\/\/|\/\*|\*|\*\/)/.test(t) && !/^[)\]}]+[,;]?$/.test(t)
for (const [url, src] of Object.entries(sources)) {
  const hit = ran[url]
  if (!hit) continue
  let file = null
  let offset = 0
  let index = 0
  for (const line of src.split('\n')) {
    const marker = /^\s*\/\/ ((?:src|node_modules)\/.+)$/.exec(line)
    if (marker) { file = marker[1].startsWith('src/') ? marker[1] : null; index = 0 }
    else if (file) {
      const t = line.trim()
      if (isCode(t)) {
        const start = offset + line.indexOf(t)
        let run = false
        for (let i = start; i < start + t.length && !run; i++) run = hit[i] === 1
        const rec = (files[file] = files[file] || new Map())
        const key = index + '|' + t
        rec.set(key, (rec.get(key) || false) || run)
      }
      index++
    }
    offset += line.length + 1
  }
}

const rows = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
const width = Math.max(...rows.map(([f]) => f.length))
console.log('browser tests, lines of src/ that ran:')
for (const [file, lines] of rows) {
  const total = lines.size
  const done = [...lines.values()].filter(Boolean).length
  console.log(`  ${file.padEnd(width)}  ${String(Math.round((done / total) * 1000) / 10).padStart(5)}%  ${done}/${total}`)
  if (showUncovered) for (const [key, run] of lines) if (!run) console.log('      ' + key.split('|').slice(1).join('|').slice(0, 140))
}
