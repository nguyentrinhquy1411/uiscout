import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { Skip } from './crawl.ts'
import { routeOf } from './identity.ts'
import type { Graph } from './types.ts'

/*
 * The usage overlay (design doc §10 "After deploy", M6): what real users act on,
 * mapped onto the graph. It ranks the controls tests don't reach by how much they
 * are used, lists edges nobody uses, and weighs coverage by traffic.
 *
 * Data comes from uiscout/track (or any analytics export carrying the same IDs)
 * and is kept in uiscout/usage.json:
 *
 *   { "version": 1, "controls": [{ "route": "/docs", "id": "docs.Header.export", "action": "click", "count": 41 }],
 *     "views": { "/docs": 1200 }, "sources": ["usage-2026-10.ndjson"] }
 *
 * Only aggregated counts: no users, sessions, text or values.
 */

export type UsageAction = 'click' | 'fill' | 'submit'

export interface UsageControl {
  route: string
  id: string
  action: UsageAction
  count: number
}

export interface Usage {
  version: 1
  controls: UsageControl[]
  /** Page views per route. */
  views: Record<string, number>
  /** Files imported so far, for the record. */
  sources: string[]
}

export const emptyUsage = (): Usage => ({ version: 1, controls: [], views: {}, sources: [] })

interface RawEvent {
  route?: unknown
  path?: unknown
  id?: unknown
  element?: unknown
  action?: unknown
  count?: unknown
}

const ACTIONS = new Set(['click', 'fill', 'submit', 'view'])

/** One event, whatever shape the export gave it; null when it can't be used. */
function normalize(e: RawEvent): { route: string; id: string; action: UsageAction | 'view'; count: number } | null {
  const rawRoute = typeof e.route === 'string' ? e.route : typeof e.path === 'string' ? e.path : null
  if (!rawRoute) return null
  const action = typeof e.action === 'string' && ACTIONS.has(e.action) ? (e.action as UsageAction | 'view') : 'click'
  const id = typeof e.id === 'string' ? e.id : typeof e.element === 'string' ? e.element : ''
  if (action !== 'view' && !id) return null
  const count = typeof e.count === 'number' ? e.count : typeof e.count === 'string' ? Number(e.count) : 1
  if (!Number.isFinite(count) || count <= 0) return null
  // A full URL or a path with a query: keep the path, collapse data IDs like the graph does.
  const pathname = rawRoute.startsWith('http') ? new URL(rawRoute).pathname : rawRoute.split(/[?#]/)[0]
  return { route: routeOf(pathname), id, action, count: Math.round(count) }
}

function csvRows(text: string): RawEvent[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const header = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? []
  return lines.map((line) => {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(header.map((h, i) => [h, h === 'count' ? Number(cells[i]) : cells[i]])) as RawEvent
  })
}

/**
 * Events from an export: a JSON array of events, a tracker batch ({ events: […] }),
 * an array of batches, NDJSON (one event or batch per line), or CSV with a header
 * naming route (or path), id (or element), and optionally action and count.
 */
export function parseUsage(text: string): Array<NonNullable<ReturnType<typeof normalize>>> {
  const trimmed = text.trim()
  let raw: RawEvent[] = []
  const flatten = (v: unknown): RawEvent[] => {
    if (Array.isArray(v)) return v.flatMap(flatten)
    if (v && typeof v === 'object' && Array.isArray((v as { events?: unknown }).events)) return flatten((v as { events: unknown[] }).events)
    return v && typeof v === 'object' ? [v as RawEvent] : []
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      raw = flatten(JSON.parse(trimmed))
    } catch {
      raw = trimmed.split('\n').filter((l) => l.trim()).flatMap((l) => flatten(JSON.parse(l)))
    }
  } else {
    raw = csvRows(trimmed)
  }
  return raw.map(normalize).filter((e): e is NonNullable<ReturnType<typeof normalize>> => e !== null)
}

export function mergeUsage(usage: Usage, events: ReturnType<typeof parseUsage>, source: string): Usage {
  const controls = new Map(usage.controls.map((c) => [`${c.route}\u0000${c.id}\u0000${c.action}`, { ...c }]))
  const views = { ...usage.views }
  for (const e of events) {
    if (e.action === 'view') {
      views[e.route] = (views[e.route] ?? 0) + e.count
      continue
    }
    const key = `${e.route}\u0000${e.id}\u0000${e.action}`
    const c = controls.get(key) ?? controls.set(key, { route: e.route, id: e.id, action: e.action, count: 0 }).get(key)!
    c.count += e.count
  }
  return {
    version: 1,
    controls: [...controls.values()].sort((a, b) => b.count - a.count || a.route.localeCompare(b.route) || a.id.localeCompare(b.id)),
    views: Object.fromEntries(Object.entries(views).sort(([a], [b]) => a.localeCompare(b))),
    sources: [...usage.sources, source],
  }
}

export async function loadUsage(file: string): Promise<Usage | null> {
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Usage) : null
}

export async function saveUsage(file: string, usage: Usage): Promise<void> {
  await writeFile(file, `${JSON.stringify(usage, null, 2)}\n`)
}

export interface UsageAnalysis {
  /** Actions on controls with an ID (the tracked kind). */
  totalActions: number
  /** Of those, actions on controls the graph walked. */
  walkedActions: number
  /** Used controls the run didn't walk, most used first. */
  untested: Array<{ route: string; id: string; count: number; reason: string }>
  /** Walked controls with no use in the period, on screens people do visit. */
  unused: Array<{ route: string; id: string; views: number }>
  /** Uses per walked control, "route|id" → count, for the graph page. */
  perControl: Record<string, number>
}

/** The screen's route: "/products [Confirm purchase]" → "/products". */
const routeOfNode = (node: string) => node.split(' [')[0]

const REASON: Record<string, string> = {
  destructive: 'destructive: walk it with --mode replay',
  budget: 'out of budget: raise --max-steps',
  'not-found': 'not found again on its screen',
  input: 'input kind not supported yet',
  'new-tab': 'opens a new tab',
  external: 'leaves the site',
  disabled: 'was disabled during the run',
  repeat: 'walked from the entry screen only',
}

export function analyzeUsage(graph: Graph, usage: Usage, skipped: Skip[] = []): UsageAnalysis {
  // Walked controls: an edge from a screen on this route, acted on through this element ID.
  const walked = new Set<string>()
  for (const e of graph.edges) {
    if (e.action.type === 'route') continue
    walked.add(`${routeOfNode(e.from)}|${e.action.element}`)
  }
  const reached = new Set(graph.nodes.map((n) => routeOfNode(n.id)))
  const skippedBy = new Map<string, string>()
  for (const s of skipped) skippedBy.set(`${routeOfNode(s.node.replace(/^\[[^\]]+\] /, ''))}|${s.element}`, s.reason)

  // Per control across actions (a field counts its fills and submits together).
  const perControl = new Map<string, number>()
  for (const c of usage.controls) perControl.set(`${c.route}|${c.id}`, (perControl.get(`${c.route}|${c.id}`) ?? 0) + c.count)

  let total = 0
  let walkedActions = 0
  const untested: UsageAnalysis['untested'] = []
  for (const [key, count] of perControl) {
    total += count
    if (walked.has(key)) {
      walkedActions += count
      continue
    }
    const [route, id] = key.split('|')
    const skip = skippedBy.get(key)
    const reason = skip ? (REASON[skip] ?? skip) : reached.has(route) ? 'never seen on its screen (another state or context?)' : 'screen not reached by the walk'
    untested.push({ route, id, count, reason })
  }
  untested.sort((a, b) => b.count - a.count)

  const unused: UsageAnalysis['unused'] = []
  const seen = new Set<string>()
  for (const key of walked) {
    const [route, id] = key.split('|')
    // Only IDs the tracker can report (fingerprint IDs start with the screen's path),
    // on routes the usage data covers.
    if (id.startsWith('/') || seen.has(key)) continue
    seen.add(key)
    const views = usage.views[route] ?? 0
    if (views > 0 && !perControl.has(key)) unused.push({ route, id, views })
  }
  unused.sort((a, b) => b.views - a.views || a.route.localeCompare(b.route))

  return {
    totalActions: total,
    walkedActions,
    untested,
    unused,
    perControl: Object.fromEntries([...perControl].filter(([k]) => walked.has(k))),
  }
}
