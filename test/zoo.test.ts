import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { signIn } from '../src/auth.ts'
import { type CrawlResult, crawl } from '../src/crawl.ts'
import { renderText } from '../src/report.ts'
import type { GraphEdge } from '../src/types.ts'
import { startZoo } from './zoo-server.ts'

/*
 * The oracles against pages whose defects are known: each must be caught where
 * it was planted, and nothing may be reported on the clean page.
 */

let zoo: Awaited<ReturnType<typeof startZoo>>
let result: CrawlResult

beforeAll(async () => {
  zoo = await startZoo()
  result = await crawl({ url: zoo.url, maxDepth: 2, settleMs: 150, seeds: ['/hidden.html', '/redirect.html'] })
}, 120_000)

afterAll(() => zoo?.close())

const elOf = (e: GraphEdge) => ('element' in e.action ? e.action.element : '')
const on = (page: string) => result.findings.filter((f) => f.at.includes(page))
const messages = (page: string) => on(page).map((f) => `${f.oracle}: ${f.message}`)

describe('graph', () => {
  it('finds every page and the dialog as nodes', () => {
    const ids = result.graph.nodes.map((n) => n.id)
    expect(ids).toEqual(expect.arrayContaining(['/', '/clean.html', '/broken.html', '/dialog.html', '/dialog.html [Settings]']))
  })

  it('records an edge per click with where it led', () => {
    const edge = result.graph.edges.find((e) => e.from === '/' && e.to === '/clean.html')
    expect(edge && elOf(edge)).toBe('/.link:clean-page@nav')
    expect(result.graph.edges.find((e) => e.from === '/dialog.html' && e.to === '/dialog.html [Settings]')).toBeTruthy()
  })

  it('attributes requests to the edge that made them', () => {
    const load = result.graph.edges.find((e) => elOf(e).includes('load-data'))
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

describe('reaching more of the app', () => {
  it('walks a seeded route no link leads to', () => {
    expect(result.graph.nodes.map((n) => n.id)).toContain('/hidden.html')
    expect(messages('secret')).toContain('script: Uncaught Error: hidden bug')
  })

  it('keeps a seed that redirects as a route edge', () => {
    expect(result.graph.edges.find((e) => e.action.type === 'route')).toMatchObject({ from: '/redirect.html', to: '/clean.html' })
  })

  it('fast-forwards timers to see a delayed redirect', () => {
    const edge = result.graph.edges.find((e) => e.from === '/timer.html' && elOf(e).includes('place-order'))
    expect(edge).toMatchObject({ to: '/clean.html', delayed: true })
  })

  it('types into a field and presses Enter', () => {
    const edge = result.graph.edges.find((e) => e.from === '/form.html' && e.action.type === 'fill')
    expect(edge).toMatchObject({ to: '/dialog.html', action: { text: 'uiscout' } })
  })

  it('flags controls with no accessible name', () => {
    expect(on('load /broken.html').some((f) => f.oracle === 'a11y' && f.message.startsWith('button-name'))).toBe(true)
  })
})

describe('contexts', () => {
  it('walks the same route as a guest and as a member', async () => {
    const run = await crawl({
      url: `${zoo.url}members.html`,
      maxDepth: 1,
      settleMs: 150,
      a11y: false,
      contexts: [
        { name: 'guest' },
        { name: 'member', setup: [{ goto: '/login.html' }, { fill: 'Name', text: 'ann' }, { click: 'Log in' }] },
      ],
    })
    const edge = (name: string) => run.graph.edges.find((e) => elOf(e).includes(name))
    expect(edge('please-log-in')).toMatchObject({ from: '/members.html', to: '/login.html', contexts: ['guest'] })
    expect(edge('members-area')).toMatchObject({ from: '/members.html', to: '/clean.html', contexts: ['member'] })
    expect(run.graph.nodes.find((n) => n.id === '/members.html')?.contexts).toEqual(['guest', 'member'])
  }, 60_000)

  it('signs in once and starts every screen from the saved state', async () => {
    const file = path.join(tmpdir(), `uiscout-auth-${process.pid}.json`)
    await signIn(`${zoo.url}login.html`, { steps: [{ fill: 'Name', text: 'ann' }, { click: 'Log in' }], waitFor: '/members.html' }, file)
    const run = await crawl({ url: `${zoo.url}members.html`, maxDepth: 1, settleMs: 150, a11y: false, contexts: [{ name: 'member', storageState: file }] })
    expect(run.graph.edges.find((e) => elOf(e).includes('members-area'))).toMatchObject({ from: '/members.html', to: '/clean.html' })
    // No setup ran: the login page was never loaded during the walk.
    expect(run.graph.nodes.map((n) => n.id)).not.toContain('/login.html')
  }, 60_000)

  it('never repeats what a failed step typed: it may be a password', async () => {
    const run = await crawl({ url: zoo.url, maxDepth: 0, a11y: false, contexts: [{ name: 'x', setup: [{ fill: 'No such field', text: 'hunter2' }] }] })
    expect(run.findings[0].message).toContain('fill "No such field"')
    expect(JSON.stringify(run.findings)).not.toContain('hunter2')
  }, 60_000)

  it('says where a sign-in stopped when it does not get through', async () => {
    const file = path.join(tmpdir(), `uiscout-auth-fail-${process.pid}.json`)
    await expect(signIn(`${zoo.url}login.html`, { steps: [{ fill: 'Name', text: 'ann' }], waitFor: '/members' }, file)).rejects.toThrow(/stopped at \/login.html/)
  }, 60_000)

  it('reports a setup that cannot run instead of walking the wrong state', async () => {
    const run = await crawl({ url: zoo.url, maxDepth: 0, a11y: false, contexts: [{ name: 'broken', setup: [{ click: 'No such button' }] }] })
    expect(run.findings[0]).toMatchObject({ oracle: 'transition', severity: 'error' })
    expect(run.findings[0].message).toContain('setup step 1 (click "No such button")')
  }, 60_000)
})

describe('safety and noise', () => {
  it('never clicks a destructive control', () => {
    expect(zoo.hits).not.toContain('POST /api/delete')
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'destructive', node: '/broken.html' }))
  })

  it('types into a field of a destructive form but never submits it', () => {
    const fill = result.graph.edges.find((e) => e.action.type === 'fill' && elOf(e).includes('account-name'))
    expect(fill).toBeTruthy()
    expect(zoo.hits).not.toContain('POST /api/delete')
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
    expect(text.split('\n')[0]).toMatch(/^uiscout: \d+ errors/)
    expect(text).toContain('Not walked:')
  })
})
