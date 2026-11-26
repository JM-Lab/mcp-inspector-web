/* Serves demo/ on http://localhost:8787 for trying the inspector locally. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const port = Number(process.env.PORT) || 8787
createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^(\.\.[/\\])+/, '')
  const file = join(dir, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch (e) { res.writeHead(404); res.end('not found') }
}).listen(port, () => console.log('MCP Inspector Web demo: http://localhost:' + port))
