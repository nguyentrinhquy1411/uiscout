import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureWebServer } from '../src/web-server.ts'

const serve = (port: number) => `node -e "require('node:http').createServer((q, s) => s.end('ok')).listen(${port})"`
const out = mkdtempSync(path.join(tmpdir(), 'uiscout-server-'))
const opts = { cwd: process.cwd(), out, log: () => {} }

describe('ensureWebServer', () => {
  it('starts the command, waits until it answers, and stops it', async () => {
    const url = 'http://127.0.0.1:47811/'
    const stop = await ensureWebServer({ command: serve(47811), timeout: 10 }, url, opts)
    expect((await fetch(url)).status).toBe(200)
    await stop()
    await expect(fetch(url)).rejects.toThrow()
  })

  it('reuses a server already answering, and leaves it running', async () => {
    const url = 'http://127.0.0.1:47812/'
    const stopFirst = await ensureWebServer({ command: serve(47812) }, url, opts)
    const stopSecond = await ensureWebServer({ command: 'exit 1' }, url, opts)
    await stopSecond()
    expect((await fetch(url)).status).toBe(200)
    await stopFirst()
  })

  it('reports a command that exits before answering', async () => {
    await expect(ensureWebServer({ command: 'exit 3', timeout: 5 }, 'http://127.0.0.1:47813/', opts)).rejects.toThrow(/exited with code 3/)
  })
})
