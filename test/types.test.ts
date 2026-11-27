/*
 * The type declarations (src/*.d.ts) name exactly what each module exports, so a TypeScript user sees no missing or stale name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const declared = (file: string) => {
  const src = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  const names = new Set<string>()
  for (const m of src.matchAll(/^export (?:function|const|class) (\w+)/gm)) names.add(m[1])
  for (const m of src.matchAll(/^export \{([^}]+)\} from/gm)) for (const n of m[1].split(',')) names.add(n.trim())
  return names
}

for (const [dts, js, extra] of [['lib.d.ts', 'lib.js', []], ['add-to-ai.d.ts', 'add-to-ai.js', []], ['debug.d.ts', 'debug.js', []], ['index.d.ts', 'index.js', ['lib.js']]] as const) {
  test(`${dts} declares every export of ${js}, and nothing else`, async () => {
    const mod = await import('../src/' + js)
    const want = new Set(Object.keys(mod))
    const have = declared(dts)
    for (const more of extra) for (const n of declared(more.replace('.js', '.d.ts'))) have.add(n)
    assert.deepEqual([...want].filter((n) => !have.has(n)).sort(), [], 'exported but not declared')
    assert.deepEqual([...have].filter((n) => !want.has(n)).sort(), [], 'declared but not exported')
  })
}
