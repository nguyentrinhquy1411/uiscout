import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { similarity } from './identity.ts'
import { redactText } from './redact.ts'
import type { Finding, Fingerprint, Graph, GraphEdge, RawElement, Step } from './types.ts'

/*
 * Baselines (design doc §7C and §10): what the app looked like when someone last
 * accepted it, committed to the repo and reviewed like code.
 *
 *   uiscout/app.graph.json        the graph, a lockfile: a run that differs fails
 *   uiscout/snapshots/<node>.txt  one structural snapshot per node and context
 *
 * A snapshot is text on purpose: its git diff is the review.
 */

export interface SnapshotEntry {
  role: string
  name: string
  testId: string | null
  parents: string
  /** Position and size, rounded to 4 px so subpixel jitter isn't a change. */
  x: number
  y: number
  w: number
  h: number
}

export type Snapshots = Record<string, SnapshotEntry[]>

const round = (n: number) => Math.round(n / 4) * 4

export function snapshotOf(elements: RawElement[]): SnapshotEntry[] {
  return elements
    .map((el) => ({ role: el.role, name: redactText(el.name), testId: el.testId, parents: el.parents, x: round(el.box.x), y: round(el.box.y), w: round(el.box.w), h: round(el.box.h) }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name))
}

/** One line per element: `button "Save" @main 640,96 80x32 #save`. */
export function snapshotText(entries: SnapshotEntry[]): string {
  return `${entries.map((e) => `${e.role} ${JSON.stringify(e.name)}${e.parents ? ` @${e.parents}` : ''} ${e.x},${e.y} ${e.w}x${e.h}${e.testId ? ` #${e.testId}` : ''}`).join('\n')}\n`
}

const LINE = /^(\S+) ("(?:[^"\\]|\\.)*")(?: @(\S+))? (-?\d+),(-?\d+) (\d+)x(\d+)(?: #(\S+))?$/

export function parseSnapshot(text: string): SnapshotEntry[] {
  return text.split('\n').filter(Boolean).flatMap((line) => {
    const m = LINE.exec(line)
    if (!m) return []
    return [{ role: m[1], name: JSON.parse(m[2]) as string, parents: m[3] ?? '', x: +m[4], y: +m[5], w: +m[6], h: +m[7], testId: m[8] ?? null }]
  })
}

/** A file name for a snapshot key like "[member] /products [Confirm purchase]". */
export function snapshotFile(key: string): string {
  const slug = key.replace(/^\[([^\]]+)\] \/?/, '$1__').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${slug || 'root'}.txt`
}

const MOVE_PX = 16

/**
 * Oracle C, structural part: what changed on a node since its baseline.
 * Removed or renamed controls are errors, moves past 16 px warnings, additions info.
 */
export function diffSnapshot(key: string, before: SnapshotEntry[], after: SnapshotEntry[]): Finding[] {
  const at = `load ${key}`
  const findings: Finding[] = []
  const id = (e: SnapshotEntry) => `${e.role}|${e.name}|${e.parents}|${e.testId ?? ''}`
  const fp = (e: SnapshotEntry): Fingerprint => ({ tag: '', role: e.role, name: e.name, testId: e.testId, parents: e.parents, cell: '' })
  const label = (e: SnapshotEntry) => `${e.role} "${e.name}"`

  const remaining = [...after]
  const unmatched: SnapshotEntry[] = []
  for (const b of before) {
    const i = remaining.findIndex((a) => id(a) === id(b))
    if (i < 0) {
      unmatched.push(b)
      continue
    }
    const [a] = remaining.splice(i, 1)
    if (Math.abs(a.x - b.x) > MOVE_PX || Math.abs(a.y - b.y) > MOVE_PX || Math.abs(a.w - b.w) > MOVE_PX || Math.abs(a.h - b.h) > MOVE_PX) {
      findings.push({ oracle: 'structure', severity: 'warning', at, message: `${label(b)} moved or resized: ${b.x},${b.y} ${b.w}x${b.h} → ${a.x},${a.y} ${a.w}x${a.h}` })
    }
  }
  for (const b of unmatched) {
    // Same control with a new role or name (a button that became a link, a relabel).
    let best = -1
    let bestScore = 0
    remaining.forEach((a, i) => {
      const near = Math.abs(a.x - b.x) <= MOVE_PX * 2 && Math.abs(a.y - b.y) <= MOVE_PX * 2
      const score = similarity(fp(a), fp(b))
      if (near && score >= 0.5 && score > bestScore) {
        best = i
        bestScore = score
      }
    })
    if (best >= 0) {
      const [a] = remaining.splice(best, 1)
      findings.push({ oracle: 'structure', severity: 'error', at, message: `${label(b)} became ${label(a)}` })
    } else {
      findings.push({ oracle: 'structure', severity: 'error', at, message: `${label(b)} is gone` })
    }
  }
  for (const a of remaining) findings.push({ oracle: 'structure', severity: 'info', at, message: `${label(a)} is new` })
  return findings
}

export interface GraphDiff {
  addedNodes: string[]
  removedNodes: string[]
  addedEdges: GraphEdge[]
  removedEdges: GraphEdge[]
  /** Same start and action, different destination. */
  retargeted: Array<{ before: GraphEdge; after: GraphEdge }>
}

const actionKey = (e: GraphEdge) => `${e.from} : ${e.action.type === 'route' ? `route ${e.action.path}` : `${e.action.type} ${e.action.element}`}`

export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const beforeNodes = new Set(before.nodes.map((n) => n.id))
  const afterNodes = new Set(after.nodes.map((n) => n.id))
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]))
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]))
  const added = after.edges.filter((e) => !beforeEdges.has(e.id))
  const removed = before.edges.filter((e) => !afterEdges.has(e.id))
  const retargeted: GraphDiff['retargeted'] = []
  for (const b of [...removed]) {
    const a = added.find((x) => actionKey(x) === actionKey(b))
    if (!a) continue
    retargeted.push({ before: b, after: a })
    removed.splice(removed.indexOf(b), 1)
    added.splice(added.indexOf(a), 1)
  }
  return {
    addedNodes: [...afterNodes].filter((n) => !beforeNodes.has(n)).sort(),
    removedNodes: [...beforeNodes].filter((n) => !afterNodes.has(n)).sort(),
    addedEdges: added,
    removedEdges: removed,
    retargeted,
  }
}

export const isEmptyDiff = (d: GraphDiff) =>
  !d.addedNodes.length && !d.removedNodes.length && !d.addedEdges.length && !d.removedEdges.length && !d.retargeted.length

/**
 * Oracle A, transition: an action that used to lead somewhere now leads elsewhere.
 * Additions and removals aren't failures by themselves; they make the graph out of
 * date, which the lockfile check reports.
 */
export function transitionFindings(diff: GraphDiff): Finding[] {
  return diff.retargeted.map(({ before, after }) => ({
    oracle: 'transition' as const,
    severity: 'error' as const,
    at: `${before.from} → ${before.action.type === 'route' ? `route ${before.action.path}` : before.action.element}`,
    message: `now leads to ${after.to}, was ${before.to}`,
  }))
}

export interface Baseline {
  graph: Graph | null
  snapshots: Snapshots
  /** How each node was reached, keyed like snapshots: lets a run replay only some nodes. */
  replays: Record<string, Step[]>
}

export async function loadBaseline(dir: string): Promise<Baseline> {
  const graphPath = path.join(dir, 'app.graph.json')
  const graph = existsSync(graphPath) ? (JSON.parse(await readFile(graphPath, 'utf8')) as Graph) : null
  const snapshots: Snapshots = {}
  const snapDir = path.join(dir, 'snapshots')
  if (existsSync(snapDir)) {
    for (const file of await readdir(snapDir)) {
      if (!file.endsWith('.txt')) continue
      const text = await readFile(path.join(snapDir, file), 'utf8')
      const [header, ...rest] = text.split('\n')
      const key = header.replace(/^# /, '')
      snapshots[key] = parseSnapshot(rest.join('\n'))
    }
  }
  const replaysPath = path.join(dir, 'paths.json')
  const replays = existsSync(replaysPath) ? (JSON.parse(await readFile(replaysPath, 'utf8')) as Record<string, Step[]>) : {}
  return { graph, snapshots, replays }
}

/** Accept the current run as the baseline (`uiscout check --update`). */
export async function saveBaseline(dir: string, graph: Graph, snapshots: Snapshots, replays: Record<string, Step[]> = {}): Promise<void> {
  const snapDir = path.join(dir, 'snapshots')
  await rm(snapDir, { recursive: true, force: true })
  await mkdir(snapDir, { recursive: true })
  await writeFile(path.join(dir, 'app.graph.json'), `${JSON.stringify(graph, null, 2)}\n`)
  const sortedReplays = Object.fromEntries(Object.entries(replays).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(path.join(dir, 'paths.json'), `${JSON.stringify(sortedReplays, null, 2)}\n`)
  for (const [key, entries] of Object.entries(snapshots).sort(([a], [b]) => a.localeCompare(b))) {
    await writeFile(path.join(snapDir, snapshotFile(key)), `# ${key}\n${snapshotText(entries)}`)
  }
}

/** Every oracle C and transition finding of a run against its baseline. */
export function compareToBaseline(
  baseline: Pick<Baseline, 'graph' | 'snapshots'>,
  graph: Graph,
  snapshots: Snapshots,
  /** For an affected-only run: the nodes explored. The rest of the baseline isn't judged. */
  scope?: Set<string>,
): { findings: Finding[]; diff: GraphDiff | null } {
  const findings: Finding[] = []
  for (const [key, entries] of Object.entries(snapshots)) {
    const before = baseline.snapshots[key]
    if (before) findings.push(...diffSnapshot(key, before, entries))
  }
  if (!baseline.graph) return { findings, diff: null }
  let before = baseline.graph
  if (scope) {
    // Only what was walked: the scoped nodes and the edges leaving them. Their
    // destinations weren't explored, so their absence from the run means nothing.
    before = { ...before, edges: before.edges.filter((e) => scope.has(e.from)), nodes: before.nodes.filter((n) => scope.has(n.id)) }
  }
  const diff = diffGraphs(before, graph)
  findings.push(...transitionFindings(diff))
  return { findings, diff }
}
