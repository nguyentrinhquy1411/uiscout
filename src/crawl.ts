import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { type Snapshots, snapshotOf } from './baseline.ts'
import { type ContextConfig, pushRoute, runSetup } from './config.ts'
import { elementId, fingerprintOf, locate, routeOf, safetyOf, safetyOfText } from './identity.ts'
import { installNetworkMode, type NetworkMode, type Recordings } from './network.ts'
import { checkA11y } from './oracles/a11y.ts'
import { checkLayout } from './oracles/layout.ts'
import { type MonitorOptions, StepMonitor } from './oracles/monitor.ts'
import { collectElements, hitPoint, installMutationCounter, mutationCount, observePage, openDialog } from './page-scripts.ts'
import { check, type ObservedState, type Rule } from './rules.ts'
import type { Finding, Fingerprint, Graph, GraphEdge, GraphElement, GraphNode, RawElement, Step } from './types.ts'

/*
 * The zero-spec runner (design doc §6): start at one URL, act on every safe
 * control on every screen it can reach, once per context, and judge each step.
 * Each screen is explored in a fresh browser context, so local data (IndexedDB)
 * starts clean.
 */

export interface CrawlOptions extends MonitorOptions {
  url: string
  /** How many actions deep from the entry to explore. */
  maxDepth?: number
  /** Total actions across the run. */
  maxSteps?: number
  /** The wall-clock time the app starts at, for deterministic dates. */
  now?: Date
  timezoneId?: string
  /** DOM must stay unchanged this long, with no requests in flight, to count as settled. */
  settleMs?: number
  /** Give up waiting for quiet after this long and judge the state anyway. */
  quiesceTimeoutMs?: number
  /** URL globs aborted before they leave the browser, e.g. a paid AI API. */
  block?: string[]
  /** Selector for controls that overlap by design, e.g. stacked calendar events. */
  allowOverlap?: string
  /** Personas to walk under (§5). Default: one context named "default" with no setup. */
  contexts?: ContextConfig[]
  /** Routes no link reaches, entered through the history API from the entry. */
  seeds?: string[]
  /** What the runner types into text fields before pressing Enter. */
  fillText?: string
  /** Timers fast-forwarded after each step, to catch delayed navigation (0 = off). */
  fastForwardMs?: number
  /** Run axe on every node. */
  a11y?: boolean
  /** live: the real backend. record: real backend, responses kept. replay: recordings only (§6). */
  network?: NetworkMode
  /** Read in replay, filled in record. */
  recordings?: Recordings
  headed?: boolean
  /** Nodes explored in parallel, each in its own browser context. */
  concurrency?: number
  /**
   * Explore only these nodes, reached by these paths (an affected-only run, §10).
   * Keys are like snapshot keys: "[context] node", or just "node" with one context.
   */
  only?: Record<string, Step[]>
  /** Invariants (oracle B) checked on every path walked. */
  rules?: Rule[]
  log?: (line: string) => void
}

export interface Skip {
  node: string
  element: string
  reason: 'destructive' | 'external' | 'disabled' | 'input' | 'new-tab' | 'budget' | 'not-found' | 'repeat'
}

export interface CrawlResult {
  graph: Graph
  findings: Finding[]
  skipped: Skip[]
  /** Lookups that matched a fingerprint only approximately. */
  healed: string[]
  steps: number
  /** Steps whose DOM never went quiet within the timeout. */
  restless: string[]
  /** Steps that failed, then passed when retried from a fresh context. */
  flaky: string[]
  /** Structural snapshot of every node, keyed like findings: "[context] node". */
  snapshots: Snapshots
  /** The steps that reach each node, keyed like snapshots. */
  replays: Record<string, Step[]>
  /** Rules checked, and how many paths broke each. */
  ruleResults: Record<string, { paths: number; violations: number }>
}

const VIEWPORT = { width: 1280, height: 800 }
const DEFAULT_CONTEXT: ContextConfig = { name: 'default' }

/** Node identity: the route plus whatever overlay is on top (state abstraction, §5). */
export async function nodeIdOf(page: Page, origin: string, monitor?: StepMonitor): Promise<string> {
  let url = new URL(page.url())
  // An unreachable external site leaves the browser on its own error page.
  if (url.protocol === 'chrome-error:' && monitor?.lastNavigation) url = new URL(monitor.lastNavigation)
  if (url.origin !== origin) return `external:${url.origin}`
  const overlay = await page.evaluate(openDialog).catch(() => '')
  const route = routeOf(url.pathname)
  return overlay ? `${route} [${overlay}]` : route
}

export async function quiesce(page: Page, monitor: StepMonitor, settleMs: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let last = -1
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    const count = await page.evaluate(mutationCount).catch(() => -2)
    if (count !== last || monitor.pending > 0) {
      last = count
      quietSince = Date.now()
    } else if (Date.now() - quietSince >= settleMs) {
      return true
    }
    await page.waitForTimeout(40)
  }
  return false
}

/** A readable label for a step, used in node paths and edge IDs. */
export function stepLabel(step: Step, elId: string): string {
  if (step.kind === 'route') return `route ${step.path}`
  if (step.kind === 'fill') return `fill ${elId}`
  return elId
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const entry = new URL(options.url)
  const origin = entry.origin
  const maxDepth = options.maxDepth ?? 2
  const maxSteps = options.maxSteps ?? 250
  const settleMs = options.settleMs ?? 250
  const quiesceTimeoutMs = options.quiesceTimeoutMs ?? 4000
  const fastForwardMs = options.fastForwardMs ?? 5000
  const fillText = options.fillText ?? 'flowcheck'
  const contexts = options.contexts?.length ? options.contexts : [DEFAULT_CONTEXT]
  const network = options.network ?? 'live'
  const recordings = options.recordings ?? {}
  const tagged = contexts.length > 1
  const log = options.log ?? (() => {})

  const nodes = new Map<string, GraphNode>()
  const elements = new Map<string, GraphElement>()
  const edges = new Map<string, GraphEdge>()
  const findings: Finding[] = []
  const skipped: Skip[] = []
  const healed: string[] = []
  const restless: string[] = []
  const flaky: string[] = []
  const snapshots: Snapshots = {}
  /** How each node was reached, per context: what an affected-only run replays. */
  const replays: Record<string, Step[]> = {}
  let steps = 0

  /** Records an observed edge, or adds this context to one already seen. */
  const addEdge = (e: Pick<GraphEdge, 'from' | 'to' | 'action' | 'safety' | 'api'> & { delayed?: boolean }, context: string) => {
    const label = e.action.type === 'route' ? `route ${e.action.path}` : e.action.type === 'fill' ? `fill ${e.action.element}` : e.action.element
    const id = `${e.from} -> ${e.to} : ${label}`
    const existing = edges.get(id)
    if (existing) {
      if (!existing.contexts.includes(context)) existing.contexts.push(context)
      return
    }
    edges.set(id, {
      id,
      from: e.from,
      to: e.to,
      action: e.action,
      contexts: [context],
      ...(e.delayed && { delayed: true }),
      safety: e.safety,
      trust: ['observed'],
      api: [...new Set(e.api)].sort(),
    })
  }

  const rules = options.rules ?? []
  const ruleResults: CrawlResult['ruleResults'] = Object.fromEntries(rules.map((r) => [r.name, { paths: 0, violations: 0 }]))

  /** A state for rules to read (oracle B); skipped entirely when there are no rules. */
  const observe = async (page: Page, context: string, step: string): Promise<ObservedState | null> => {
    if (!rules.length) return null
    const seen = await page.evaluate(observePage).catch(() => null)
    if (!seen) return null
    const node = await nodeIdOf(page, origin)
    const elements: ObservedState['elements'] = {}
    for (const m of seen.marked) elements[m.id] = { role: 'marked', name: m.name, disabled: m.disabled }
    for (const el of await page.evaluate(collectElements).catch(() => [])) {
      elements[elementId(node, fingerprintOf(el))] = { role: el.role, name: el.name, disabled: el.disabled }
    }
    return { context, node, url: seen.url, time: seen.time, step, elements, reads: seen.reads }
  }

  /** Checks every rule on one path; a violation is an error carrying the steps that led to it. */
  const judgeTrace = (trace: Array<ObservedState | null>, at: string, into: Finding[]) => {
    const states = trace.filter((s): s is ObservedState => s !== null)
    if (!states.length) return
    for (const rule of rules) {
      ruleResults[rule.name].paths++
      const v = check(rule, states)
      if (!v) continue
      ruleResults[rule.name].violations++
      into.push({ oracle: 'rule', severity: 'error', at, message: `${v.rule}: ${v.message}`, trace: v.trace })
    }
  }

  const browser: Browser = await chromium.launch({ headless: !options.headed })

  const newContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      locale: 'en-US',
      timezoneId: options.timezoneId ?? 'Asia/Ho_Chi_Minh',
      reducedMotion: 'reduce',
      // A real browser grants these on a click; headless denies them, which isn't the app's fault.
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    await context.addInitScript(installMutationCounter)
    await installNetworkMode(context, network, origin, recordings)
    // Registered last so it runs first: a blocked URL never reaches the recorder.
    for (const glob of options.block ?? []) await context.route(glob, (route) => route.abort('blockedbyclient'))
    // A control that opens a new tab gets that tab closed: the walk stays in one page.
    context.on('page', (p) => {
      void p.opener().then((opener) => opener && p.close())
    })
    return context
  }

  /** Performs one step. Returns why it failed, or null. */
  const perform = async (page: Page, step: Step): Promise<string | null> => {
    if (step.kind === 'route') {
      const before = await page.evaluate(mutationCount)
      await page.evaluate(pushRoute, step.path)
      await page.waitForTimeout(100)
      // A router that ignores popstate: fall back to a full load.
      if ((await page.evaluate(mutationCount)) === before) await page.goto(new URL(step.path, origin).href, { waitUntil: 'domcontentloaded' })
      return null
    }
    const found = locate(step.fp, await page.evaluate(collectElements))
    if (!found) return 'not found'
    // Judge what will actually be acted on, not what was asked for: a healed lookup
    // (or a tampered paths.json) must never land on a destructive control.
    if (network !== 'replay' && safetyOf(fingerprintOf(found.el)) === 'destructive') return `refused: matched destructive "${found.el.name}"`
    if (step.kind === 'fill') {
      const field = page.locator(`[data-fc-i="${found.el.i}"]`)
      return field
        .fill(step.text, { timeout: 3000 })
        .then(() => (step.enter ? field.press('Enter') : undefined))
        .then(() => null, (err: Error) => clickFailure(err.message))
    }
    return clickAt(page, found.el.i)
  }

  /** Lets timers run: delayed navigation (a redirect 3 s after "Order placed") shows up now. */
  const fastForward = async (page: Page, monitor: StepMonitor) => {
    if (fastForwardMs <= 0) return
    await page.clock.fastForward(fastForwardMs).catch(() => {})
    await quiesce(page, monitor, settleMs, quiesceTimeoutMs)
  }

  for (const ctx of contexts) {
    const prefix = tagged ? `[${ctx.name}] ` : ''
    const paths = new Map<string, Step[]>()
    /**
     * Controls already on the entry screen when it loads (the app rail, a search
     * button): walked there, skipped everywhere else. Fixed before any exploring
     * starts, so which controls are skipped never depends on which parallel worker
     * got where first: two runs of the same app walk the same edges.
     */
    const globals = new Set<string>()
    let entryNode = ''
    const queue: Array<{ node: string; depth: number }> = []

    /** Opens the app in this context and replays a path; the page sits on the target node. */
    const open = async (context: BrowserContext, path: Step[], label: string) => {
      const page = await context.newPage()
      if (fastForwardMs > 0) await page.clock.install(options.now ? { time: options.now } : undefined)
      else if (options.now) await page.clock.setFixedTime(options.now)
      const monitor = new StepMonitor(page, origin, options)
      monitor.begin(`${prefix}load ${label}`)
      await page.goto(entry.href, { waitUntil: 'domcontentloaded' })
      if (ctx.setup?.length) await runSetup(page, ctx.setup, origin)
      if (!(await quiesce(page, monitor, settleMs, quiesceTimeoutMs))) restless.push(`${prefix}load ${label}`)
      const states: Array<ObservedState | null> = [await observe(page, ctx.name, 'load')]
      for (const step of path) {
        if (await perform(page, step)) return { page, monitor, ok: false, states }
        await quiesce(page, monitor, settleMs, quiesceTimeoutMs)
        states.push(await observe(page, ctx.name, stepLabel(step, 'fp' in step ? elementId('', step.fp).replace(/^\./, '') : '')))
        await fastForward(page, monitor)
        states.push(await observe(page, ctx.name, '(timers)'))
      }
      return { page, monitor, ok: true, states }
    }

    const addNode = (id: string, url: string, path: Step[], labels: string[]) => {
      const existing = nodes.get(id)
      if (existing && !existing.contexts.includes(ctx.name)) existing.contexts.push(ctx.name)
      if (paths.has(id)) return false
      paths.set(id, path)
      if (!existing) nodes.set(id, { id, url, path: labels, contexts: [ctx.name] })
      return true
    }

    if (options.only) {
      // Affected-only: start at the selected nodes, by their recorded paths, and stop there.
      for (const [key, path] of Object.entries(options.only)) {
        const node = key.startsWith('[') ? key.slice(key.indexOf('] ') + 2) : key
        if (tagged ? !key.startsWith(`[${ctx.name}] `) : key.startsWith('[')) continue
        if (addNode(node, node, path, path.map((s) => stepLabel(s, 'fp' in s ? elementId('', s.fp) : '')))) queue.push({ node, depth: maxDepth })
      }
    }
    // The entry node, then every seed route, as starting points.
    for (const start of options.only ? [] : [null, ...(options.seeds ?? [])]) {
      const context = await newContext()
      try {
        const path: Step[] = start ? [{ kind: 'route', path: start }] : []
        const { page, monitor } = await open(context, path, start ?? entry.pathname)
        const id = await nodeIdOf(page, origin)
        if (!start) {
          entryNode = id
          for (const el of await page.evaluate(collectElements)) globals.add(globalKey(fingerprintOf(el)))
        }
        if (addNode(id, new URL(page.url()).pathname, path, path.map((s) => stepLabel(s, '')))) queue.push({ node: id, depth: 0 })
        // A seed that lands somewhere else is a redirect worth keeping: "/legacy" → "/pricing".
        if (start && routeOf(start) !== id) addEdge({ from: routeOf(start), to: id, action: { type: 'route', path: start }, safety: 'safe', api: monitor.api }, ctx.name)
        findings.push(...monitor.findings)
      } catch (err) {
        findings.push({ oracle: 'transition', severity: 'error', at: `${prefix}load ${start ?? entry.pathname}`, message: (err as Error).message })
      }
      await context.close()
    }

    /** Act on every control of one node, in its own browser context. */
    const explore = async (node: string, depth: number) => {
      const path = paths.get(node)!
      const labels = nodes.get(node)!.path
      log(`${prefix}node ${node} (depth ${depth})`)

      let context = await newContext()
      let { page, monitor, ok, states: pathStates } = await open(context, path, node)
      /**
       * Steps taken on this page that stayed on this node (typed text, a toggle).
       * A node found later may depend on them, so they become part of its path.
       */
      let dirt: Step[] = []
      if (!ok || (await nodeIdOf(page, origin)) !== node) {
        findings.push({ oracle: 'transition', severity: 'warning', at: `${prefix}load ${node}`, message: 'Could not reach this node again by replaying its path' })
        await context.close()
        return
      }

      // Judge the screen itself once, on arrival.
      const targets = await page.evaluate(collectElements)
      snapshots[`${prefix}${node}`] = snapshotOf(targets)
      const files = targets.flatMap((t) => (t.source ? [t.source.replace(/:\d+$/, '')] : []))
      if (files.length) {
        const n = nodes.get(node)!
        n.sources = [...new Set([...(n.sources ?? []), ...files])].sort()
      }
      replays[`${prefix}${node}`] = path
      for (const issue of await page.evaluate(checkLayout, options.allowOverlap ?? '')) {
        const severity = issue.kind === 'covered' ? 'error' : 'warning'
        findings.push({ oracle: issue.kind === 'covered' ? 'dead-control' : 'layout', severity, at: `${prefix}load ${node}`, message: issue.detail })
      }
      if (options.a11y !== false) findings.push(...(await checkA11y(page, `${prefix}load ${node}`)))

      // A fresh context, not just a reload: an earlier step may have saved state
      // (a collapsed sidebar in localStorage) that would hide what comes next.
      const reset = async () => {
        findings.push(...monitor.findings)
        await context.close()
        context = await newContext()
        ;({ page, monitor, states: pathStates } = await open(context, path, node))
        dirt = []
      }

      /** Back to this node the cheap way (Escape, then history) before reloading and replaying. */
      const returnHere = async () => {
        if ((await nodeIdOf(page, origin)) === node) return
        if (await page.evaluate(openDialog).catch(() => '')) {
          await page.keyboard.press('Escape')
          await quiesce(page, monitor, settleMs, quiesceTimeoutMs)
          if ((await nodeIdOf(page, origin)) === node) return
        }
        if (routeOf(new URL(page.url()).pathname) !== routeOf(nodes.get(node)!.url)) {
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null)
          await quiesce(page, monitor, settleMs, quiesceTimeoutMs)
          // Unknown how much of the node's own state survived the round trip: start clean.
          if ((await nodeIdOf(page, origin)) === node && dirt.length === 0) return
        }
        await reset()
      }

      for (const target of targets) {
        const fp = fingerprintOf(target)
        const elId = elementId(node, fp)
        if (!elements.has(elId)) elements.set(elId, { id: elId, node, role: fp.role, name: fp.name, fingerprint: fp })
        const safety = safetyOf(fp)
        // With every request served from recordings, nothing a destructive control sends
        // reaches a server, so replay walks it (§5 Safety labels).
        const skip = skipReason(target, network === 'replay' && safety === 'destructive' ? 'mutating' : safety, origin)
        if (skip) {
          skipped.push({ node: `${prefix}${node}`, element: elId, reason: skip })
          continue
        }
        // A control the entry screen already has is walked there only.
        const key = globalKey(fp)
        if (node !== entryNode && globals.has(key)) {
          skipped.push({ node: `${prefix}${node}`, element: elId, reason: 'repeat' })
          continue
        }
        if (steps >= maxSteps) {
          skipped.push({ node: `${prefix}${node}`, element: elId, reason: 'budget' })
          continue
        }

        // Enter submits the field's form through its default button; a destructive button
        // ("Delete account") must not be pressed that way when it would never be clicked.
        const enter = network === 'replay' || !(target.submit && safetyOfText(target.submit) === 'destructive')
        const step: Step = target.role === 'textbox' ? { kind: 'fill', fp, text: fillText, enter } : { kind: 'click', fp }

        // Find it again: an earlier step may have re-rendered the screen.
        await returnHere()
        let found = locate(fp, await page.evaluate(collectElements))
        if (!found) {
          await reset()
          found = locate(fp, await page.evaluate(collectElements))
        }
        if (!found) {
          skipped.push({ node: `${prefix}${node}`, element: elId, reason: 'not-found' })
          continue
        }
        if (!found.exact) healed.push(elId)

        steps++
        const label = `${prefix}${node} → ${step.kind} ${elId}`
        const before = await observe(page, ctx.name, '(before)')
        monitor.begin(label)
        const failure = await perform(page, step)
        if (failure) {
          // Flake policy (§6): retry once from a fresh context. A pass there means the
          // failure depended on what earlier steps left behind; listed, never blocking.
          await reset()
          monitor.begin(label)
          const retry = await perform(page, step)
          if (retry) {
            monitor.findings.push({ oracle: 'dead-control', severity: 'error', at: label, message: `${step.kind === 'fill' ? 'Typing' : 'Click'} failed: ${failure}` })
            continue
          }
          flaky.push(`${label}: ${failure}`)
        }
        if (!(await quiesce(page, monitor, settleMs, quiesceTimeoutMs))) restless.push(label)
        const settledAt = await nodeIdOf(page, origin, monitor)
        const after = await observe(page, ctx.name, `${step.kind} ${elId}`)
        await fastForward(page, monitor)
        if (rules.length) judgeTrace([...pathStates, before, after, await observe(page, ctx.name, '(timers)')], label, monitor.findings)

        const to = await nodeIdOf(page, origin, monitor)
        addEdge({
          from: node,
          to,
          action: step.kind === 'fill' ? { type: 'fill', element: elId, text: fillText } : { type: 'click', element: elId },
          delayed: settledAt !== to,
          safety,
          api: monitor.api,
        }, ctx.name)
        if (to !== node && !to.startsWith('external:') && depth + 1 <= maxDepth) {
          const via = [...dirt, step]
          if (addNode(to, new URL(page.url()).pathname, [...path, ...via], [...labels, ...via.map((s) => stepLabel(s, elementId(node, 'fp' in s ? s.fp : fp)))])) {
            queue.push({ node: to, depth: depth + 1 })
          }
        }
        if (to === node) dirt.push(step)
      }
      findings.push(...monitor.findings)
      await context.close()
    }

    // Nodes are independent (each has its own context), so several are explored at once.
    let active = 0
    const worker = async () => {
      for (;;) {
        const next = steps < maxSteps ? queue.shift() : undefined
        if (!next) {
          if (active === 0 || steps >= maxSteps) return
          await new Promise((r) => setTimeout(r, 50))
          continue
        }
        active++
        try {
          await explore(next.node, next.depth)
        } catch (err) {
          findings.push({ oracle: 'transition', severity: 'warning', at: `${prefix}load ${next.node}`, message: `Exploration stopped: ${(err as Error).message.split('\n')[0]}` })
        } finally {
          active--
        }
      }
    }
    await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker))
    for (const { node } of queue) skipped.push({ node: `${prefix}${node}`, element: '*', reason: 'budget' })
  }

  await browser.close()

  for (const n of nodes.values()) n.contexts.sort()
  for (const e of edges.values()) e.contexts.sort()
  return {
    graph: {
      version: 1,
      entry: entry.href,
      // Parallel exploration finishes in any order; sort so the same app gives the same file.
      nodes: [...nodes.values()].sort((x, y) => x.path.length - y.path.length || x.id.localeCompare(y.id)),
      elements: [...elements.values()].sort((x, y) => x.id.localeCompare(y.id)),
      edges: [...edges.values()].sort((x, y) => x.id.localeCompare(y.id)),
    },
    findings: dedupe(findings).sort((x, y) => x.at.localeCompare(y.at) || x.message.localeCompare(y.message)),
    skipped,
    healed,
    steps,
    restless,
    flaky,
    snapshots,
    replays,
    ruleResults,
  }
}

export function skipReason(el: RawElement, safety: string, origin: string): Skip['reason'] | null {
  if (safety === 'destructive') return 'destructive'
  if (el.disabled) return 'disabled'
  if (el.role === 'combobox' || el.role === 'slider') return 'input'
  if (el.target === '_blank') return 'new-tab'
  if (el.href && /^(https?:)?\/\//.test(el.href) && !el.href.startsWith(origin)) return 'external'
  if (el.href && /^(mailto|tel):/.test(el.href)) return 'external'
  return null
}

/** Clicks control `i` where a click lands on it; returns why it failed, or null. */
export async function clickAt(page: Page, i: number): Promise<string | null> {
  const position = (await page.evaluate(hitPoint, i)) ?? undefined
  return page.locator(`[data-fc-i="${i}"]`).click({ timeout: 3000, position }).then(() => null, (err: Error) => clickFailure(err.message))
}

const globalKey = (fp: Fingerprint) => `${fp.role}|${fp.name}|${fp.parents}|${fp.testId ?? ''}`

/** Playwright's own explanation from the call log: "<div> intercepts pointer events", "element is not visible"… */
export function clickFailure(message: string): string {
  // Playwright colours its call log for terminals.
  const log = message.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim().replace(/^- /, ''))
  const reason = [...log].reverse().find((l) => /intercepts pointer events|not visible|not stable|not enabled|not editable|detached|outside of the viewport/.test(l))
  return (reason ?? log.find(Boolean) ?? message).slice(0, 200)
}

/** Opening the same screen from two paths reports its findings twice; keep one. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.oracle}|${f.at}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
