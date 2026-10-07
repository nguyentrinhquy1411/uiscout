import { execFileSync } from 'node:child_process'
import type { Graph, Step } from './types.ts'

/*
 * Affected-edge selection (design doc §10): map the files a change touched to the
 * screens built from them, and walk only those plus the screens one step before
 * them. Anything it can't map safely — shared code no screen names as a source, a
 * baseline built without the identity plugin — falls back to a full run, and says why.
 */

const CODE = /\.(m?[jt]sx?|css|scss|less|vue|svelte)$/

export interface Selection {
  /** Nodes to walk and how to reach them, keyed like snapshots; null means walk everything. */
  only: Record<string, Step[]> | null
  /** Node IDs walked, for judging only that part of the baseline. */
  scope: Set<string>
  reason: string
}

const nodeOfKey = (key: string) => (key.startsWith('[') ? key.slice(key.indexOf('] ') + 2) : key)

export function selectAffected(graph: Graph, replays: Record<string, Step[]>, changedFiles: string[]): Selection {
  const full = (reason: string): Selection => ({ only: null, scope: new Set(), reason: `full run: ${reason}` })
  const code = changedFiles.filter((f) => CODE.test(f))
  if (!code.length) return { only: {}, scope: new Set(), reason: 'no source files changed: nothing to walk' }
  if (!graph.nodes.some((n) => n.sources?.length)) return full('the baseline has no source witnesses (build the app with the flowcheck identity plugin, then --update)')

  const hit = new Set(graph.nodes.filter((n) => n.sources?.some((s) => code.includes(s))).map((n) => n.id))
  const unmapped = code.filter((f) => !graph.nodes.some((n) => n.sources?.includes(f)))
  // A file no screen lists (a hook, a store, shared styles) may affect any screen.
  if (unmapped.length) return full(`${unmapped.slice(0, 3).join(', ')}${unmapped.length > 3 ? ` and ${unmapped.length - 3} more` : ''} not tied to any screen`)

  // One step away: the screens that lead into a changed screen walk those edges.
  const changed = new Set(hit)
  for (const e of graph.edges) if (changed.has(e.to) && !e.from.startsWith('external:')) hit.add(e.from)
  const only = Object.fromEntries(Object.entries(replays).filter(([key]) => hit.has(nodeOfKey(key))))
  const missing = [...hit].filter((n) => !Object.keys(only).some((k) => nodeOfKey(k) === n))
  if (missing.length) return full(`no recorded path to ${missing[0]}`)
  return { only, scope: hit, reason: `${hit.size} of ${graph.nodes.length} screens, from ${code.length} changed file${code.length === 1 ? '' : 's'}` }
}

/**
 * Files changed since `ref`, committed or not, relative to `cwd` — the app's root,
 * like the paths the identity plugin writes — even when the app sits in a monorepo.
 */
export function changedSince(ref: string, cwd = process.cwd()): string[] {
  const run = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)
  return [...new Set([...run(['diff', '--name-only', '--relative', ref]), ...run(['ls-files', '--others', '--exclude-standard'])])]
}
