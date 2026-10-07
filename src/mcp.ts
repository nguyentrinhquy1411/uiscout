import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadBaseline, type Snapshots } from './baseline.ts'
import { type FileConfig, loadConfig } from './config.ts'
import { crawl, type Skip } from './crawl.ts'
import { loadIntent, summarizeIntent } from './intent.ts'
import { loadRecordings, type NetworkMode } from './network.ts'
import type { Finding, Graph, GraphEdge, Step } from './types.ts'

/*
 * The MCP server (design doc §11): no model, no API key. A coding agent (Claude
 * Code, Cursor, Copilot) connects over stdio and reads the graph, the findings
 * and the intent coverage, and can propose edges and rules.
 *
 * Proposals are quarantined in uiscout/proposals.json: they change nothing — no
 * test, no coverage, no baseline — until the runner proves them. An edge proposal
 * becomes "verified" only when verify_proposal walks it in a real browser and
 * sees the transition; a wrong proposal costs one browser run. Rule proposals are
 * accepted by a developer in a pull request, never by the server.
 */

export interface Proposal {
  id: string
  kind: 'edge' | 'rule'
  status: 'proposed' | 'verified' | 'refuted'
  createdAt: string
  note?: string
  // edge
  from?: string
  element?: string
  expectTo?: string
  // rule
  name?: string
  intentLine?: string
  code?: string
  /** What the runner saw when it walked an edge proposal. */
  evidence?: { at: string; observed: Array<{ to: string; action: string; api: string[] }>; findings: string[]; reason?: string }
}

interface Workspace {
  root: string
  config: FileConfig
  baselineDir: string
  runDir: string
}

async function workspace(root: string): Promise<Workspace> {
  const configFile = path.join(root, 'uiscout.config.json')
  const config = existsSync(configFile) ? await loadConfig(configFile) : {}
  return { root, config, baselineDir: path.join(root, config.baseline ?? 'uiscout'), runDir: path.join(root, '.uiscout') }
}

const readJson = async <T>(file: string): Promise<T | null> => (existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as T) : null)

interface RunFindings {
  findings: Finding[]
  skipped: Skip[]
  ruleResults?: Record<string, { paths: number; violations: number }>
}

/** The graph to answer from: the last run's when there is one, else the baseline. */
async function loadGraph(ws: Workspace, source?: 'run' | 'baseline'): Promise<{ graph: Graph; source: string } | null> {
  const run = path.join(ws.runDir, 'graph.json')
  const base = path.join(ws.baselineDir, 'app.graph.json')
  const order = source === 'baseline' ? [base] : source === 'run' ? [run] : [run, base]
  for (const file of order) {
    const graph = await readJson<Graph>(file)
    if (graph) return { graph, source: path.relative(ws.root, file) }
  }
  return null
}

const actionLabel = (e: GraphEdge) => (e.action.type === 'route' ? `route ${e.action.path}` : `${e.action.type} ${e.action.element}`)

/** Shortest sequence of actions between two screens, over observed edges. */
export function planPath(graph: Graph, from: string, to: string): GraphEdge[] | null {
  if (from === to) return []
  const prev = new Map<string, GraphEdge>()
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of graph.edges) {
      if (e.from !== id || seen.has(e.to)) continue
      seen.add(e.to)
      prev.set(e.to, e)
      if (e.to === to) {
        const out: GraphEdge[] = []
        for (let cur = to; cur !== from; cur = prev.get(cur)!.from) out.unshift(prev.get(cur)!)
        return out
      }
      queue.push(e.to)
    }
  }
  return null
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

async function loadProposals(ws: Workspace): Promise<Proposal[]> {
  return (await readJson<Proposal[]>(path.join(ws.baselineDir, 'proposals.json'))) ?? []
}

async function saveProposals(ws: Workspace, proposals: Proposal[]): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(ws.baselineDir, { recursive: true })
  await writeFile(path.join(ws.baselineDir, 'proposals.json'), `${JSON.stringify(proposals, null, 2)}\n`)
}

/**
 * Walks one control on one screen in a real browser: replays the baseline's path
 * to the screen, acts on the matching control only, and reports where it led.
 * The control is matched by element ID, test ID or exact visible name.
 *
 * The URL comes only from uiscout.config.json, never from the agent: a context's
 * setup steps type its credentials into the page, so an agent-chosen URL (say, a
 * prompt-injected one) would send them to another site, or point the browser at
 * internal hosts.
 */
export async function walkEdge(ws: Workspace, from: string, element: string) {
  const entry = ws.config.url
  if (!entry) throw new Error('no app URL: set "url" in uiscout.config.json (the MCP server only walks the configured app)')
  const replays = (await loadBaseline(ws.baselineDir)).replays
  const keys = Object.keys(replays).filter((k) => (k.startsWith('[') ? k.slice(k.indexOf('] ') + 2) : k) === from)
  if (!keys.length) throw new Error(`no recorded path to ${from} in ${path.relative(ws.root, ws.baselineDir)}/paths.json: run uiscout check --update first`)
  const only: Record<string, Step[]> = { [keys[0]]: replays[keys[0]] }
  const wanted = element.toLowerCase()
  const network = (ws.config.network ?? 'live') as NetworkMode
  const result = await crawl({
    url: entry,
    only,
    maxDepth: 0,
    a11y: false,
    screenshots: false,
    contexts: ws.config.contexts?.filter((c) => keys[0].startsWith(`[${c.name}] `)) ?? undefined,
    block: ws.config.block,
    allow4xx: ws.config.allow4xx,
    ignoreConsole: ws.config.ignoreConsole,
    allowOverlap: ws.config.allowOverlap,
    fillText: ws.config.fillText,
    now: ws.config.now ? new Date(ws.config.now) : undefined,
    network,
    recordings: network === 'replay' ? await loadRecordings(path.join(ws.baselineDir, 'recordings.json')) : undefined,
    elementFilter: (fp, id) => id === element || fp.testId === element || fp.name.toLowerCase() === wanted,
  })
  return {
    at: from,
    observed: result.graph.edges.map((e) => ({ to: e.to, action: actionLabel(e), api: e.api })),
    findings: result.findings.filter((f) => f.severity !== 'info').map((f) => `${f.severity} ${f.oracle}: ${f.message}`),
    skipped: result.skipped.map((s) => `${s.element} (${s.reason})`),
  }
}

export function createServer(root: string): McpServer {
  const server = new McpServer({ name: 'uiscout', version: '0.1.0' })
  const source = z.enum(['run', 'baseline']).optional().describe('Read the last run (default when present) or the committed baseline')

  server.registerTool('get_graph', {
    title: 'Get the app graph',
    description: 'Every screen of the app uiscout walked, with how many actions leave each, stay on it, and how many findings it has. Start here.',
    inputSchema: { source },
  }, async ({ source: from }) => {
    const ws = await workspace(root)
    const loaded = await loadGraph(ws, from)
    if (!loaded) return fail('No graph yet: run `uiscout check` (or `uiscout check --update`) in this project first.')
    const run = await readJson<RunFindings>(path.join(ws.runDir, 'findings.json'))
    const count = (id: string) => (run?.findings ?? []).filter((f) => f.at.replace(/^\[[^\]]+\] /, '').startsWith(`load ${id}`) || f.at.replace(/^\[[^\]]+\] /, '').startsWith(`${id} → `)).length
    const { graph } = loaded
    return text({
      source: loaded.source,
      entry: graph.entry,
      screens: graph.nodes.map((n) => {
        const out = graph.edges.filter((e) => e.from === n.id)
        return { id: n.id, contexts: n.contexts, actionsOut: out.filter((e) => e.to !== n.id).length, actionsInPlace: out.filter((e) => e.to === n.id).length, findings: count(n.id) }
      }),
      edges: graph.edges.length,
    })
  })

  server.registerTool('get_node', {
    title: 'Inspect one screen',
    description: 'One screen: how to reach it, every action from it (where it leads, API calls made), the ways in, its findings and its controls (structural snapshot).',
    inputSchema: { id: z.string().describe('Screen ID, e.g. "/checkout" or "/products [Confirm purchase]"'), source },
  }, async ({ id, source: from }) => {
    const ws = await workspace(root)
    const loaded = await loadGraph(ws, from)
    if (!loaded) return fail('No graph yet: run `uiscout check` first.')
    const node = loaded.graph.nodes.find((n) => n.id === id)
    if (!node) return fail(`No screen "${id}". Screens: ${loaded.graph.nodes.map((n) => n.id).join(', ')}`)
    const run = await readJson<RunFindings>(path.join(ws.runDir, 'findings.json'))
    const snapshots = (await readJson<Snapshots>(path.join(ws.runDir, 'snapshots.json'))) ?? (await loadBaseline(ws.baselineDir)).snapshots
    const stripCtx = (s: string) => s.replace(/^\[[^\]]+\] /, '')
    return text({
      id,
      contexts: node.contexts,
      howToGetHere: node.path,
      actions: loaded.graph.edges.filter((e) => e.from === id).map((e) => ({ to: e.to, action: actionLabel(e), api: e.api, delayed: e.delayed ?? false, safety: e.safety })),
      waysIn: loaded.graph.edges.filter((e) => e.to === id && e.from !== id).map((e) => ({ from: e.from, action: actionLabel(e) })),
      findings: (run?.findings ?? []).filter((f) => { const at = stripCtx(f.at); return at === `load ${id}` || at.startsWith(`${id} → `) }),
      controls: Object.entries(snapshots).filter(([k]) => stripCtx(k) === id).map(([k, entries]) => ({ key: k, entries })),
    })
  })

  server.registerTool('plan_path', {
    title: 'Plan a path between screens',
    description: 'The shortest sequence of observed actions from one screen to another (from the entry when "from" is omitted).',
    inputSchema: { to: z.string(), from: z.string().optional(), source },
  }, async ({ to, from, source: src }) => {
    const ws = await workspace(root)
    const loaded = await loadGraph(ws, src)
    if (!loaded) return fail('No graph yet: run `uiscout check` first.')
    const start = from ?? loaded.graph.nodes.find((n) => n.path.length === 0)?.id ?? loaded.graph.nodes[0]?.id
    const steps = planPath(loaded.graph, start, to)
    if (!steps) return fail(`No observed path from ${start} to ${to}.`)
    return text({ from: start, to, steps: steps.map((e) => ({ from: e.from, action: actionLabel(e), to: e.to })) })
  })

  server.registerTool('get_failures', {
    title: 'Get the findings of the last run',
    description: 'Findings from the last `uiscout check`, one entry per distinct message with every place it happened. Errors fail the run; warnings and info don\'t.',
    inputSchema: { severity: z.enum(['error', 'warning', 'info']).optional() },
  }, async ({ severity }) => {
    const ws = await workspace(root)
    const run = await readJson<RunFindings>(path.join(ws.runDir, 'findings.json'))
    if (!run) return fail('No run yet: run `uiscout check` first.')
    const grouped = new Map<string, { oracle: string; severity: string; message: string; at: string[]; trace?: string[] }>()
    for (const f of run.findings.filter((x) => !severity || x.severity === severity)) {
      const key = `${f.oracle}|${f.message}`
      const g = grouped.get(key) ?? grouped.set(key, { oracle: f.oracle, severity: f.severity, message: f.message, at: [], trace: f.trace }).get(key)!
      g.at.push(f.at)
    }
    return text([...grouped.values()])
  })

  server.registerTool('get_uncovered', {
    title: 'What the last run did not walk',
    description: 'Controls the runner saw but did not act on, grouped by reason (destructive, input, disabled, budget, not-found, new-tab, external, repeat). Candidates for proposals, replay mode, or more budget.',
    inputSchema: {},
  }, async () => {
    const ws = await workspace(root)
    const run = await readJson<RunFindings>(path.join(ws.runDir, 'findings.json'))
    if (!run) return fail('No run yet: run `uiscout check` first.')
    const byReason: Record<string, Array<{ screen: string; element: string }>> = {}
    for (const s of run.skipped) (byReason[s.reason] ??= []).push({ screen: s.node, element: s.element })
    return text(byReason)
  })

  server.registerTool('get_intent', {
    title: 'Get intent coverage',
    description: 'The plain-language intent lines (*.intent.md) and whether each is linked to a passing rule, failing, pending (no rule yet), stale or unchecked.',
    inputSchema: {},
  }, async () => {
    const ws = await workspace(root)
    const run = await readJson<RunFindings>(path.join(ws.runDir, 'findings.json'))
    const lines = await loadIntent(root)
    if (!lines.length) return text('No *.intent.md files in this project.')
    return text(summarizeIntent(lines, run?.ruleResults ?? {}))
  })

  server.registerTool('propose_edge', {
    title: 'Propose an edge',
    description: 'Record a hypothesis that a control on a screen leads somewhere (e.g. one the static or runtime walk missed). It is quarantined: nothing uses it until verify_proposal walks it in a real browser and sees the transition.',
    inputSchema: {
      from: z.string().describe('Screen ID the control is on'),
      element: z.string().describe('Element ID from the graph, a data-testid, or the control\'s exact visible name'),
      expectTo: z.string().optional().describe('Screen ID it should lead to'),
      note: z.string().optional(),
    },
  }, async ({ from, element, expectTo, note }) => {
    const ws = await workspace(root)
    const proposals = await loadProposals(ws)
    const p: Proposal = { id: randomUUID().slice(0, 8), kind: 'edge', status: 'proposed', createdAt: new Date().toISOString(), from, element, expectTo, note }
    proposals.push(p)
    await saveProposals(ws, proposals)
    return text({ proposal: p, next: `verify_proposal with id ${p.id} to walk it` })
  })

  server.registerTool('propose_rule', {
    title: 'Propose a rule',
    description: 'Record a draft invariant (TypeScript using uiscout/rules) for an intent line. Quarantined: a developer reviews it and adds it to a *.rules.ts file in a pull request; the server never activates rules.',
    inputSchema: {
      name: z.string().regex(/^[A-Za-z_$][\w$]*$/).describe('Rule name: a valid export identifier, matching the intent line\'s <!-- rule: name -->'),
      code: z.string().describe('The rule, e.g. always(when(() => …).then(() => …))'),
      intentLine: z.string().optional().describe('The intent sentence this rule backs'),
      note: z.string().optional(),
    },
  }, async ({ name, code, intentLine, note }) => {
    const ws = await workspace(root)
    const proposals = await loadProposals(ws)
    const p: Proposal = { id: randomUUID().slice(0, 8), kind: 'rule', status: 'proposed', createdAt: new Date().toISOString(), name, code, intentLine, note }
    proposals.push(p)
    await saveProposals(ws, proposals)
    return text({ proposal: p, next: `a developer adds \`export const ${name} = ${code.split('\n')[0]}…\` to a *.rules.ts file` })
  })

  server.registerTool('list_proposals', {
    title: 'List proposals',
    description: 'Every proposal with its status: proposed (unproven), verified (the runner saw it), refuted (the runner saw something else).',
    inputSchema: { status: z.enum(['proposed', 'verified', 'refuted']).optional() },
  }, async ({ status }) => {
    const ws = await workspace(root)
    return text((await loadProposals(ws)).filter((p) => !status || p.status === status))
  })

  server.registerTool('run_edge', {
    title: 'Walk one control',
    description: 'Replay the path to a screen in a real browser (the app at the URL in uiscout.config.json), act on one control, and report where it led, the API calls it made and any findings. Destructive controls are skipped unless the project runs in replay mode.',
    inputSchema: { from: z.string(), element: z.string() },
  }, async ({ from, element }) => {
    try {
      return text(await walkEdge(await workspace(root), from, element))
    } catch (err) {
      return fail((err as Error).message)
    }
  })

  server.registerTool('verify_proposal', {
    title: 'Verify an edge proposal',
    description: 'Walk a proposed edge in a real browser. It becomes "verified" only if the runner observes the transition (to expectTo, when given); otherwise "refuted", with the evidence.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const ws = await workspace(root)
    const proposals = await loadProposals(ws)
    const p = proposals.find((x) => x.id === id)
    if (!p) return fail(`No proposal ${id}.`)
    if (p.kind !== 'edge') return fail('Rule proposals are accepted by a developer in a pull request, not by the runner.')
    try {
      const walked = await walkEdge(ws, p.from!, p.element!)
      const moved = walked.observed.filter((o) => o.to !== p.from)
      const ok = p.expectTo ? walked.observed.some((o) => o.to === p.expectTo) : moved.length > 0
      p.status = ok ? 'verified' : 'refuted'
      p.evidence = {
        at: walked.at,
        observed: walked.observed,
        findings: walked.findings,
        reason: ok ? undefined : walked.observed.length ? `led to ${walked.observed.map((o) => o.to).join(', ')}` : walked.skipped.length ? `not walked: ${walked.skipped.join(', ')}` : 'no matching control on the screen',
      }
      await saveProposals(ws, proposals)
      return text(p)
    } catch (err) {
      return fail((err as Error).message)
    }
  })

  return server
}

/** `uiscout mcp`: serve the project in `root` over stdio. Logs go to stderr; stdout is the protocol. */
export async function startMcp(root: string): Promise<void> {
  const server = createServer(root)
  await server.connect(new StdioServerTransport())
  process.stderr.write(`uiscout MCP server ready for ${root}\n`)
}
