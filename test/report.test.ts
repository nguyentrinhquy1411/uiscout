import { describe, expect, it } from 'vitest'
import type { CrawlResult } from '../src/crawl.ts'
import { COMMENT_MARKER, renderMarkdown, renderText, screenOf } from '../src/report.ts'

const result = (findings: CrawlResult['findings']): CrawlResult => ({
  graph: { version: 1, entry: '/', nodes: [{ id: '/', url: '/', path: [], contexts: ['default'] }], elements: [], edges: [] },
  findings, skipped: [], healed: [], steps: 3, restless: [], flaky: [], snapshots: {}, screens: {}, replays: {}, ruleResults: {},
})

describe('pull request comment', () => {
  it('leads with the verdict and groups an error seen on several screens', () => {
    const md = renderMarkdown(result([
      { oracle: 'script', severity: 'error', at: '/ → click a', message: 'Uncaught Error: <boom>' },
      { oracle: 'script', severity: 'error', at: '/x → click a', message: 'Uncaught Error: <boom>' },
      { oracle: 'a11y', severity: 'warning', at: 'load /', message: 'button-name' },
    ]))
    expect(md.startsWith(COMMENT_MARKER)).toBe(true)
    expect(md).toContain('### uiscout: ❌ 1 error, 1 warning')
    expect(md).toContain('1. **script** — Uncaught Error: \\<boom\\>  \n  <sub>at `/ → click a` and 1 more</sub>')
    expect(md).toContain('<details><summary>Full report</summary>')
  })

  it('shows graph changes as a diff block', () => {
    const md = renderMarkdown(result([]), {
      against: 'uiscout/app.graph.json',
      diff: { addedNodes: ['/new'], removedNodes: [], addedEdges: [], removedEdges: [], retargeted: [] },
    })
    expect(md).toContain('### uiscout: ✅ no errors')
    expect(md).toContain('```diff\n+ node   /new\n```')
  })

  it('keeps hostile text inside its code span and fence', () => {
    const evil = 'x` | [phish](https://evil.example) <img src=x>\n```\n# injected'
    const md = renderMarkdown(result([]), undefined, undefined, {
      against: 'uiscout/usage.json',
      analysis: { totalActions: 10, walkedActions: 0, untested: [{ route: '/a', id: evil, count: 10, reason: 'screen not reached by the walk' }], unused: [], perControl: {} },
    })
    const row = md.split('\n').find((l) => l.startsWith('| 10 |'))!
    expect(row.split('|').length).toBe(6)
    expect(row).not.toMatch(/<img|\]\(/)
    // The full report fence outgrows the backtick run, so "```" inside can't close it.
    const lines = md.split('\n')
    const start = lines.findIndex((l) => /^`{3,}text$/.test(l))
    const ticks = lines[start].slice(0, -'text'.length)
    expect(ticks.length).toBeGreaterThan(3)
    const end = lines.indexOf(ticks, start + 1)
    expect(lines.findIndex((l) => l.startsWith('# injected'))).toBeGreaterThan(start)
    expect(lines.findLastIndex((l) => l.startsWith('# injected'))).toBeLessThan(end)
  })
})

describe('text report', () => {
  const fp = { tag: 'button', role: 'button', name: 'Pay', testId: null, parents: 'main', cell: '1,1' }
  const errors: CrawlResult['findings'] = [
    {
      oracle: 'network', severity: 'error', at: '/checkout → click checkout.Pay', message: 'POST /api/orders returned 500',
      source: 'src/Checkout.tsx:48', repro: 'open / → go to /checkout → click "Pay"',
      steps: [{ kind: 'route', path: '/checkout' }, { kind: 'click', fp }],
    },
    { oracle: 'script', severity: 'error', at: 'load /checkout', message: 'Uncaught TypeError' },
    { oracle: 'script', severity: 'error', at: '[member] load /cart', message: 'Uncaught TypeError' },
  ]

  it('names the screens with errors, numbers errors, and says where and how', () => {
    const text = renderText(result(errors))
    expect(text).toContain('Screens with errors: /checkout (2) · [member] /cart (1)')
    expect(text).toContain('    1  network      POST /api/orders returned 500')
    expect(text).toContain('in src/Checkout.tsx:48')
    expect(text).toContain('repro open / → go to /checkout → click "Pay"')
  })

  it('reads the screen out of any finding location', () => {
    expect(screenOf('load /a')).toBe('/a')
    expect(screenOf('/a → click x.y')).toBe('/a')
    expect(screenOf('[guest] load /b')).toBe('[guest] /b')
  })
})
