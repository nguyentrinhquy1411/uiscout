import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl } from '../src/crawl.ts'
import type { Recordings } from '../src/network.ts'
import { startZoo } from './zoo-server.ts'

/* Record against the zoo's API once, then replay with no request reaching it. */

let zoo: Awaited<ReturnType<typeof startZoo>>
beforeAll(async () => {
  zoo = await startZoo()
})
afterAll(() => zoo?.close())

describe('record and replay', () => {
  const recordings: Recordings = {}

  it('records every API response, including failures', async () => {
    await crawl({ url: `${zoo.url}broken.html`, maxDepth: 0, settleMs: 150, a11y: false, network: 'record', recordings })
    expect(Object.keys(recordings)).toEqual(expect.arrayContaining(['GET /api/report']))
    expect(recordings['GET /api/report'][0].status).toBe(500)
    expect(zoo.hits).not.toContain('POST /api/delete')
  }, 60_000)

  it('replays without touching the server and walks destructive controls', async () => {
    zoo.hits.length = 0
    const run = await crawl({ url: `${zoo.url}broken.html`, maxDepth: 0, settleMs: 150, a11y: false, network: 'replay', recordings })
    expect(zoo.hits.filter((h) => h.includes('/api/'))).toEqual([])
    const messages = run.findings.map((f) => `${f.severity} ${f.message}`)
    expect(messages).toContain('error GET /api/report returned 500')
    expect(messages).toContain('warning POST /api/delete has no recording (re-record with --mode record)')
    expect(run.graph.edges.some((e) => 'element' in e.action && e.action.element.includes('delete-account') && e.safety === 'destructive')).toBe(true)
  }, 60_000)
})
