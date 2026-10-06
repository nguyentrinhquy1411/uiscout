import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CrawlResult, crawl } from '../src/crawl.ts'
import { renderText } from '../src/report.ts'
import { startZoo } from './zoo-server.ts'

/*
 * The oracles against pages whose defects are known: each must be caught where
 * it was planted, and nothing may be reported on the clean page.
 */

let zoo: Awaited<ReturnType<typeof startZoo>>
let result: CrawlResult

beforeAll(async () => {
  zoo = await startZoo()
  result = await crawl({ url: zoo.url, maxDepth: 2, settleMs: 150 })
}, 120_000)

afterAll(() => zoo?.close())

const on = (page: string) => result.findings.filter((f) => f.at.includes(page))
const messages = (page: string) => on(page).map((f) => `${f.oracle}: ${f.message}`)

describe('graph', () => {
  it('finds every page and the dialog as nodes', () => {
    const ids = result.graph.nodes.map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['/', '/clean.html', '/broken.html', '/dialog.html', '/dialog.html [Settings]']))
  })

  it('records an edge per click with where it led', () => {
    const edge = result.graph.edges.find((e) => e.from === '/' && e.to === '/clean.html')
    expect(edge?.action.element).toBe('/.link:clean-page@nav')
    expect(result.graph.edges.find((e) => e.from === '/dialog.html' && e.to === '/dialog.html [Settings]')).toBeTruthy()
  })

  it('attributes requests to the edge that made them', () => {
    const load = result.graph.edges.find((e) => e.action.element.includes('load-data'))
    expect(load?.api).toContain('GET /api/ok')
  })
})

describe('oracle A on the broken page', () => {
  it('catches an uncaught exception', () => {
    expect(messages('explode')).toContain('script: Uncaught Error: kaboom')
  })

  it('catches a 500 and names the request', () => {
    expect(messages('load-report')).toContain('network: GET /api/report returned 500')
  })

  it('catches console.error', () => {
    expect(messages('log-problem')).toContain('script: console.error: something broke')
  })

  it('catches a broken link', () => {
    expect(messages('missing-page')).toContain('network: GET /missing.html returned 404')
  })

  it('catches a covered control', () => {
    expect(on('load /broken.html').some((f) => f.oracle === 'dead-control' && f.message.includes('Covered button'))).toBe(true)
  })

  it('catches overlapping and clipped controls', () => {
    const layout = on('load /broken.html').filter((f) => f.oracle === 'layout').map((f) => f.message)
    expect(layout.some((m) => m.includes('"Left" overlaps "Right"'))).toBe(true)
    expect(layout.some((m) => m.includes('Clipped label text') && m.includes('clipped'))).toBe(true)
  })
})

describe('safety and noise', () => {
  it('never clicks a destructive control', () => {
    expect(zoo.hits).not.toContain('POST /api/delete')
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'destructive', node: '/broken.html' }))
  })

  it('does not follow external links', () => {
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'external' }))
    expect(result.graph.nodes.some((n) => n.id.startsWith('external:'))).toBe(false)
  })

  it('reports nothing on the clean page, the home page or the dialog', () => {
    expect(messages('/clean.html')).toEqual([])
    expect(result.findings.filter((f) => f.at === 'load /' || f.at.startsWith('/ →'))).toEqual([])
    expect(messages('dialog')).toEqual([])
  })

  it('renders a report that leads with the errors', () => {
    const text = renderText(result)
    expect(text.split('\n')[0]).toMatch(/^flowcheck: \d+ errors/)
    expect(text).toContain('Not walked:')
  })
})
