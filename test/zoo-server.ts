import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'

/** Serves the bug zoo and its fake API, and remembers which endpoints were hit. */
export async function startZoo(): Promise<{ url: string; hits: string[]; overrides: Map<string, string>; close: () => Promise<void> }> {
  const root = path.join(import.meta.dirname, 'zoo')
  const hits: string[] = []
  /** Path → HTML served instead of the file, to simulate a change between two runs. */
  const overrides = new Map<string, string>()
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://zoo')
    hits.push(`${req.method} ${url.pathname}`)
    if (url.pathname === '/api/ok') return json(res, 200, { message: 'fine' })
    if (url.pathname === '/api/report') return json(res, 500, { error: 'boom' })
    if (url.pathname === '/api/delete') return json(res, 200, { deleted: true })
    const override = overrides.get(url.pathname)
    if (override) return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(override)
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    try {
      const body = await readFile(path.join(root, path.normalize(file)))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return { url: `http://127.0.0.1:${port}/`, hits, overrides, close: () => new Promise((r) => server.close(() => r())) }
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
