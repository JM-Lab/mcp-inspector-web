#!/usr/bin/env node
/*
 * Runs the inspector page on your own computer: npx mcp-inspector-web [--port 8787] [--no-open]
 *
 * For people who would rather not use a hosted copy. It is the same page: it serves the built
 * files on 127.0.0.1 and nothing else, so the browser still talks to each MCP server directly,
 * and the same CORS rules apply (the page's origin is http://localhost:<port> here).
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: mcp-inspector-web [--port <n>] [--no-open]\n\nServes MCP Inspector Web on http://localhost and opens it in your browser.')
  process.exit(0)
}
const portArg = args.indexOf('--port')
const asked = portArg >= 0 ? args[portArg + 1] : process.env.PORT
/* --port 0 takes any free port (the tests use it). */
let port = asked != null && asked !== '' && Number.isInteger(Number(asked)) && Number(asked) >= 0 ? Number(asked) : 8787
const open = !args.includes('--no-open')

const files = {
  '/mcp-inspector.js': [join(root, 'dist/mcp-inspector.js'), 'text/javascript; charset=utf-8'],
  '/mcp-inspector.css': [join(root, 'dist/mcp-inspector.css'), 'text/css; charset=utf-8'],
  '/featured.json': [join(root, 'demo/featured.json'), 'application/json'],
}
if (!existsSync(files['/mcp-inspector.js'][0])) {
  console.error('dist/ is missing. Run `npm run build` first.')
  process.exit(1)
}
const hasFeatured = existsSync(files['/featured.json'][0])

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Inspector Web</title>
<link rel="stylesheet" href="mcp-inspector.css">
<style>
  :root{color-scheme:light dark}
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:Canvas;color:CanvasText}
  main{max-width:72rem;margin:0 auto;padding:1.5rem 1rem 3rem}
</style>
</head>
<body>
<main><div id="mcpi"><noscript>This page needs JavaScript.</noscript></div></main>
<script>window.MCP_INSPECTOR = { lang: navigator.language.startsWith('ko') ? 'ko' : 'en'${hasFeatured ? ", featured: 'featured.json'" : ''} }</script>
<script src="mcp-inspector.js" defer></script>
</body>
</html>
`

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  try {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    const f = files[path]
    if (!f) throw new Error('not found')
    const body = await readFile(f[0])
    res.writeHead(200, { 'content-type': f[1] })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && portArg < 0) { port++; server.listen(port, '127.0.0.1') }
  else { console.error(e.message); process.exit(1) }
})
server.on('listening', () => {
  const url = 'http://localhost:' + server.address().port
  console.log('MCP Inspector Web: ' + url + '\nThe browser connects to each MCP server directly, so a server must allow this origin (CORS). Ctrl+C to stop.')
  if (!open) return
  const [cmd, ...rest] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open']
  spawn(cmd, [...rest, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
})
server.listen(port, '127.0.0.1')
