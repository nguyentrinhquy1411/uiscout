import { describe, expect, it } from 'vitest'
import type { CrawlResult } from '../src/crawl.ts'
import { COMMENT_MARKER, renderMarkdown } from '../src/report.ts'

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
    expect(md).toContain('- **script** — Uncaught Error: \\<boom\\>  \n  <sub>at `/ → click a` and 1 more</sub>')
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
