import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffGraphs, diffSnapshot, parseSnapshot, snapshotFile, snapshotText, type SnapshotEntry } from '../src/baseline.ts'
import { compareToBaseline } from '../src/baseline.ts'
import { crawl } from '../src/crawl.ts'
import type { Graph, GraphEdge } from '../src/types.ts'
import { startZoo } from './zoo-server.ts'

const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({ role: 'button', name: 'Save', testId: null, parents: 'main', x: 100, y: 40, w: 80, h: 32, ...over })

describe('snapshot text', () => {
  it('round-trips through its text form', () => {
    const entries = [entry(), entry({ role: 'link', name: 'Say "hi"', parents: '', testId: 'greet', y: 80 })]
    expect(parseSnapshot(snapshotText(entries))).toEqual(entries)
    expect(snapshotText([entry()])).toBe('button "Save" @main 100,40 80x32\n')
  })

  it('names files after the node and context', () => {
    expect(snapshotFile('[member] /products [Confirm purchase]')).toBe('member__products_Confirm_purchase.txt')
    expect(snapshotFile('/')).toBe('root.txt')
  })
})

describe('oracle C: structural diff', () => {
  const kinds = (before: SnapshotEntry[], after: SnapshotEntry[]) => diffSnapshot('/x', before, after).map((f) => `${f.severity}: ${f.message}`)

  it('is silent when nothing changed beyond jitter', () => {
    expect(kinds([entry()], [entry({ x: 108 })])).toEqual([])
  })

  it('classifies removed, renamed, moved and added controls', () => {
    const before = [entry(), entry({ name: 'Cancel', x: 200 }), entry({ name: 'Help', y: 400 })]
    const after = [entry({ role: 'link' }), entry({ name: 'Cancel', x: 260 }), entry({ name: 'Export', y: 600 })]
    expect(kinds(before, after)).toEqual([
      'warning: button "Cancel" moved or resized: 200,40 80x32 → 260,40 80x32',
      'error: button "Save" became link "Save"',
      'error: button "Help" is gone',
      'info: button "Export" is new',
    ])
  })
})

describe('graph diff', () => {
  const edge = (from: string, to: string, element: string): GraphEdge => ({
    id: `${from} -> ${to} : ${element}`, from, to, action: { type: 'click', element }, contexts: ['default'], safety: 'safe', trust: ['observed'], api: [],
  })
  const graph = (edges: GraphEdge[]): Graph => ({
    version: 1, entry: '/', elements: [],
    nodes: [...new Set(edges.flatMap((e) => [e.from, e.to]))].map((id) => ({ id, url: id, path: [], contexts: ['default'] })),
    edges,
  })

  it('reports a retargeted action apart from additions and removals', () => {
    const before = graph([edge('/', '/a', 'go-a'), edge('/', '/b', 'go-b')])
    const after = graph([edge('/', '/c', 'go-a'), edge('/', '/d', 'go-d')])
    const diff = diffGraphs(before, after)
    expect(diff.retargeted.map((r) => `${r.before.to} → ${r.after.to}`)).toEqual(['/a → /c'])
    expect(diff.removedEdges.map((e) => e.id)).toEqual(['/ -> /b : go-b'])
    expect(diff.addedEdges.map((e) => e.id)).toEqual(['/ -> /d : go-d'])
    expect(diff.addedNodes).toEqual(['/c', '/d'])
  })
})

describe('against a real change', () => {
  let zoo: Awaited<ReturnType<typeof startZoo>>
  beforeAll(async () => {
    zoo = await startZoo()
  })
  afterAll(() => zoo?.close())

  it('catches a removed button, a relabel and a retargeted link between two runs', async () => {
    const run = () => crawl({ url: `${zoo.url}clean.html`, maxDepth: 0, settleMs: 150, a11y: false })
    const first = await run()
    const original = await readFile(path.join(import.meta.dirname, 'zoo/clean.html'), 'utf8')
    zoo.overrides.set('/clean.html', original
      .replace('<button type="button" id="load">Load data</button>', '')
      .replace('Count 0', 'Counter 0')
      .replace('<a href="/">Home</a>', '<a href="/dialog.html">Home</a>'))
    const second = await run()
    zoo.overrides.clear()

    const { findings, diff } = compareToBaseline({ graph: first.graph, snapshots: first.snapshots }, second.graph, second.snapshots)
    const messages = findings.map((f) => `${f.oracle} ${f.severity}: ${f.message}`)
    expect(messages).toContain('structure error: button "Load data" is gone')
    expect(messages).toContain('structure error: button "Count 0" became button "Counter 0"')
    expect(messages).toContain('transition error: now leads to /dialog.html, was /')
    expect(diff?.retargeted).toHaveLength(1)
  }, 60_000)
})
