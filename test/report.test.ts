import { describe, expect, it } from 'vitest'
import type { CrawlResult } from '../src/crawl.ts'
import { COMMENT_MARKER, renderMarkdown } from '../src/report.ts'

const result = (findings: CrawlResult['findings']): CrawlResult => ({
  graph: { version: 1, entry: '/', nodes: [{ id: '/', url: '/', path: [], contexts: ['default'] }], elements: [], edges: [] },
  findings, skipped: [], healed: [], steps: 3, restless: [], flaky: [], snapshots: {}, replays: {}, ruleResults: {},
})

describe('pull request comment', () => {
  it('leads with the verdict and groups an error seen on several screens', () => {
    const md = renderMarkdown(result([
      { oracle: 'script', severity: 'error', at: '/ → click a', message: 'Uncaught Error: <boom>' },
      { oracle: 'script', severity: 'error', at: '/x → click a', message: 'Uncaught Error: <boom>' },
      { oracle: 'a11y', severity: 'warning', at: 'load /', message: 'button-name' },
    ]))
    expect(md.startsWith(COMMENT_MARKER)).toBe(true)
    expect(md).toContain('### flowcheck: ❌ 1 error, 1 warning')
    expect(md).toContain('- **script** — Uncaught Error: \\<boom\\>  \n  <sub>at `/ → click a` and 1 more</sub>')
    expect(md).toContain('<details><summary>Full report</summary>')
  })

  it('shows graph changes as a diff block', () => {
    const md = renderMarkdown(result([]), {
      against: 'flowcheck/app.graph.json',
      diff: { addedNodes: ['/new'], removedNodes: [], addedEdges: [], removedEdges: [], retargeted: [] },
    })
    expect(md).toContain('### flowcheck: ✅ no errors')
    expect(md).toContain('```diff\n+ node   /new\n```')
  })
})
