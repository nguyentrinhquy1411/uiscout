import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { selectAffected } from '../src/affected.ts'
import { crawl } from '../src/crawl.ts'
import type { Graph, GraphEdge } from '../src/types.ts'
import { startZoo } from './zoo-server.ts'

const edge = (from: string, to: string): GraphEdge => ({
  id: `${from} -> ${to} : x`, from, to, action: { type: 'click', element: 'x' }, contexts: ['default'], safety: 'safe', trust: ['observed'], api: [],
})
const graph: Graph = {
  version: 1, entry: '/', elements: [],
  nodes: [
    { id: '/', url: '/', path: [], contexts: ['default'], sources: ['src/Home.tsx', 'src/Rail.tsx'] },
    { id: '/docs', url: '/docs', path: [], contexts: ['default'], sources: ['src/Docs.tsx', 'src/Rail.tsx'] },
    { id: '/cards', url: '/cards', path: [], contexts: ['default'], sources: ['src/Cards.tsx', 'src/Rail.tsx'] },
  ],
  edges: [edge('/', '/docs'), edge('/', '/cards'), edge('/cards', '/docs')],
}
const replays = { '/': [], '/docs': [{ kind: 'route' as const, path: '/docs' }], '/cards': [{ kind: 'route' as const, path: '/cards' }] }

describe('affected selection', () => {
  it('walks the changed screen and the screens that lead into it', () => {
    const s = selectAffected(graph, replays, ['src/Docs.tsx', 'README.md'])
    expect([...s.scope].sort()).toEqual(['/', '/cards', '/docs'])
    expect(s.reason).toBe('3 of 3 screens, from 1 changed file')
  })

  it('goes one step back, not further', () => {
    const chain = { ...graph, edges: [edge('/', '/cards'), edge('/cards', '/docs')] }
    expect([...selectAffected(chain, replays, ['src/Docs.tsx']).scope].sort()).toEqual(['/cards', '/docs'])
  })

  it('walks only what a leaf change touches', () => {
    const s = selectAffected(graph, replays, ['src/Home.tsx'])
    expect(Object.keys(s.only ?? {})).toEqual(['/'])
  })

  it('walks nothing when no source changed', () => {
    expect(selectAffected(graph, replays, ['docs/x.md']).only).toEqual({})
  })

  it('falls back to a full run for shared code or a baseline without witnesses, and says why', () => {
    expect(selectAffected(graph, replays, ['src/store.ts'])).toMatchObject({ only: null, reason: 'full run: src/store.ts not tied to any screen' })
    const bare = { ...graph, nodes: graph.nodes.map(({ sources: _, ...n }) => n) }
    expect(selectAffected(bare, replays, ['src/Docs.tsx']).only).toBeNull()
  })
})

describe('an affected-only run', () => {
  let zoo: Awaited<ReturnType<typeof startZoo>>
  beforeAll(async () => {
    zoo = await startZoo()
  })
  afterAll(() => zoo?.close())

  it('explores only the given nodes, by their paths, and stops there', async () => {
    const run = await crawl({ url: zoo.url, maxDepth: 2, settleMs: 150, a11y: false, only: { '/dialog.html': [{ kind: 'route', path: '/dialog.html' }] } })
    expect(run.graph.nodes.map((n) => n.id)).toEqual(['/dialog.html'])
    expect(run.graph.edges.every((e) => e.from === '/dialog.html')).toBe(true)
    expect(run.graph.edges.some((e) => e.to === '/dialog.html [Settings]')).toBe(true)
  }, 60_000)
})
