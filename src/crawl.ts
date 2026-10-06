import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { elementId, fingerprintOf, locate, routeOf, safetyOf } from './identity.ts'
import { checkLayout } from './oracles/layout.ts'
import { type MonitorOptions, StepMonitor } from './oracles/monitor.ts'
import { collectElements, hitPoint, installMutationCounter, mutationCount, openDialog } from './page-scripts.ts'
import type { Finding, Fingerprint, Graph, GraphEdge, GraphElement, GraphNode, RawElement } from './types.ts'

/*
 * The zero-spec runner (design doc §6, M1): start at one URL, click every safe
 * control on every screen it can reach, and judge each step. Each screen is
 * explored in a fresh browser context, so local data (IndexedDB) starts clean.
 */

export interface CrawlOptions extends MonitorOptions {
  url: string
  /** How many clicks deep from the entry to explore. */
  maxDepth?: number
  /** Total clicks across the run. */
  maxSteps?: number
  /** The fixed wall-clock time the app sees, for deterministic dates. */
  now?: Date
  timezoneId?: string
  /** DOM must stay unchanged this long, with no requests in flight, to count as settled. */
  settleMs?: number
  /** Give up waiting for quiet after this long and judge the state anyway. */
  quiesceTimeoutMs?: number
  /**
   * URL globs never sent (aborted before they leave the browser), e.g. a paid AI
   * API the walk must not spend quota on.
   */
  block?: string[]
  /** Selector for controls that overlap by design, e.g. stacked calendar events. */
  allowOverlap?: string
  headed?: boolean
  /** Nodes explored in parallel, each in its own browser context. */
  concurrency?: number
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
}

const VIEWPORT = { width: 1280, height: 800 }

/** Node identity: the route plus whatever overlay is on top (state abstraction, §5). */
async function nodeIdOf(page: Page, origin: string): Promise<string> {
  const url = new URL(page.url())
  if (url.origin !== origin) return `external:${url.origin}`
  const overlay = await page.evaluate(openDialog).catch(() => '')
  const route = routeOf(url.pathname)
  return overlay ? `${route} [${overlay}]` : route
}

async function quiesce(page: Page, monitor: StepMonitor, settleMs: number, timeoutMs: number): Promise<boolean> {
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

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const entry = new URL(options.url)
  const origin = entry.origin
  const maxDepth = options.maxDepth ?? 2
  const maxSteps = options.maxSteps ?? 250
  const settleMs = options.settleMs ?? 250
  const quiesceTimeoutMs = options.quiesceTimeoutMs ?? 4000
  const log = options.log ?? (() => {})

  const nodes = new Map<string, GraphNode>()
  const routes = new Map<string, Fingerprint[]>()
  const elements = new Map<string, GraphElement>()
  const edges = new Map<string, GraphEdge>()
  const findings: Finding[] = []
  const skipped: Skip[] = []
  const healed: string[] = []
  const restless: string[] = []
  const flaky: string[] = []
  let steps = 0
  /** Route reached by each control fingerprint, ignoring which screen it was on. */
  const globalEdges = new Map<string, string>()

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
    for (const glob of options.block ?? []) await context.route(glob, (route) => route.abort('blockedbyclient'))
    // A control that opens a new tab gets that tab closed: the walk stays in one page.
    context.on('page', (p) => {
      void p.opener().then((opener) => opener && p.close())
    })
    return context
  }

  /** Opens the app and replays a path; returns the page sitting on the target node. */
  const open = async (context: BrowserContext, path: Fingerprint[], label: string) => {
    const page = await context.newPage()
    if (options.now) await page.clock.setFixedTime(options.now)
    const monitor = new StepMonitor(page, origin, options)
    monitor.begin(`load ${label}`)
    await page.goto(entry.href, { waitUntil: 'domcontentloaded' })
    if (!(await quiesce(page, monitor, settleMs, quiesceTimeoutMs))) restless.push(`load ${label}`)
    for (const fp of path) {
      const found = locate(fp, await page.evaluate(collectElements))
      if (!found) return { page, monitor, ok: false }
      await page.locator(`[data-fc-i="${found.el.i}"]`).click({ timeout: 3000 }).catch(() => {})
      await quiesce(page, monitor, settleMs, quiesceTimeoutMs)
    }
    return { page, monitor, ok: true }
  }

  const addNode = (id: string, url: string, path: Fingerprint[], pathIds: string[]) => {
    if (nodes.has(id)) return false
    nodes.set(id, { id, url, path: pathIds })
    routes.set(id, path)
    return true
  }

  const queue: Array<{ node: string; depth: number }> = []

  // The entry node.
  {
    const context = await newContext()
    const { page, monitor } = await open(context, [], entry.pathname)
    const id = await nodeIdOf(page, origin)
    addNode(id, new URL(page.url()).pathname, [], [])
    queue.push({ node: id, depth: 0 })
    findings.push(...monitor.findings)
    await context.close()
  }

  /** Click every control on one node, in its own browser context. */
  const explore = async (node: string, depth: number) => {
    const path = routes.get(node)!
    const pathIds = nodes.get(node)!.path
    log(`node ${node} (depth ${depth})`)

    let context = await newContext()
    let { page, monitor, ok } = await open(context, path, node)
    if (!ok || (await nodeIdOf(page, origin)) !== node) {
      findings.push({ oracle: 'transition', severity: 'warning', at: `load ${node}`, message: 'Could not reach this node again by replaying its path' })
      await context.close()
      return
    }

    // Judge the screen itself once, on arrival.
    const targets = await page.evaluate(collectElements)
    for (const issue of await page.evaluate(checkLayout, options.allowOverlap ?? '')) {
      const severity = issue.kind === 'covered' ? 'error' : 'warning'
      findings.push({ oracle: issue.kind === 'covered' ? 'dead-control' : 'layout', severity, at: `load ${node}`, message: issue.detail })
    }

    // A fresh context, not just a reload: an earlier click may have saved state
    // (a collapsed sidebar in localStorage) that would hide what comes next.
    const reset = async () => {
      findings.push(...monitor.findings)
      await context.close()
      context = await newContext()
      ;({ page, monitor } = await open(context, path, node))
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
        if ((await nodeIdOf(page, origin)) === node) return
      }
      await reset()
    }

    for (const target of targets) {
      const fp = fingerprintOf(target)
      const elId = elementId(node, fp)
      if (!elements.has(elId)) elements.set(elId, { id: elId, node, role: fp.role, name: fp.name, fingerprint: fp })
      const safety = safetyOf(fp)
      const skip = skipReason(target, safety, origin)
      if (skip) {
        skipped.push({ node, element: elId, reason: skip })
        continue
      }
      // A control on every screen (the app rail) that already led to a route elsewhere
      // would lead there again: walking it from each screen only costs time.
      const key = globalKey(fp)
      const seenTo = globalEdges.get(key)
      if (seenTo && seenTo !== node) {
        skipped.push({ node, element: elId, reason: 'repeat' })
        continue
      }
      if (steps >= maxSteps) {
        skipped.push({ node, element: elId, reason: 'budget' })
        continue
      }

      // Find it again: an earlier click may have re-rendered the screen.
      await returnHere()
      let found = locate(fp, await page.evaluate(collectElements))
      if (!found) {
        await reset()
        found = locate(fp, await page.evaluate(collectElements))
      }
      if (!found) {
        skipped.push({ node, element: elId, reason: 'not-found' })
        continue
      }
      if (!found.exact) healed.push(elId)

      steps++
      const label = `${node} → click ${elId}`
      monitor.begin(label)
      const failure = await clickAt(page, found.el.i)
      if (failure) {
        // Flake policy (§6): retry once from a fresh context. A pass there means the
        // failure depended on what earlier steps left behind; listed, never blocking.
        await reset()
        const again = locate(fp, await page.evaluate(collectElements))
        monitor.begin(label)
        const retry = again ? await clickAt(page, again.el.i) : 'not found on retry'
        if (retry) {
          monitor.findings.push({ oracle: 'dead-control', severity: 'error', at: label, message: `Click failed: ${failure}` })
          continue
        }
        flaky.push(`${label}: ${failure}`)
      }
      if (!(await quiesce(page, monitor, settleMs, quiesceTimeoutMs))) restless.push(label)

      const to = await nodeIdOf(page, origin)
      if (to !== node && !to.includes(' [') && !to.startsWith('external:')) globalEdges.set(key, to)
      const edgeId = `${node} -> ${to} : ${elId}`
      edges.set(edgeId, {
        id: edgeId,
        from: node,
        to,
        action: { type: 'click', element: elId },
        safety,
        trust: ['observed'],
        api: [...new Set(monitor.api)],
      })
      if (to !== node && !to.startsWith('external:') && depth + 1 <= maxDepth) {
        if (addNode(to, new URL(page.url()).pathname, [...path, fp], [...pathIds, elId])) queue.push({ node: to, depth: depth + 1 })
      }
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
      } finally {
        active--
      }
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker))

  for (const { node } of queue) skipped.push({ node, element: '*', reason: 'budget' })
  await browser.close()

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
  }
}

function skipReason(el: RawElement, safety: string, origin: string): Skip['reason'] | null {
  if (safety === 'destructive') return 'destructive'
  if (el.disabled) return 'disabled'
  if (el.role === 'textbox' || el.role === 'combobox' || el.role === 'slider') return 'input'
  if (el.target === '_blank') return 'new-tab'
  if (el.href && /^(https?:)?\/\//.test(el.href) && !el.href.startsWith(origin)) return 'external'
  if (el.href && /^(mailto|tel):/.test(el.href)) return 'external'
  return null
}

/** Clicks control `i` where a click lands on it; returns why it failed, or null. */
async function clickAt(page: Page, i: number): Promise<string | null> {
  const position = (await page.evaluate(hitPoint, i)) ?? undefined
  return page.locator(`[data-fc-i="${i}"]`).click({ timeout: 3000, position }).then(() => null, (err: Error) => clickFailure(err.message))
}

const globalKey = (fp: Fingerprint) => `${fp.role}|${fp.name}|${fp.parents}|${fp.testId ?? ''}`

/** Playwright's own explanation from the call log: "<div> intercepts pointer events", "element is not visible"… */
function clickFailure(message: string): string {
  // Playwright colours its call log for terminals.
  const log = message.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim().replace(/^- /, ''))
  const reason = [...log].reverse().find((l) => /intercepts pointer events|not visible|not stable|not enabled|detached|outside of the viewport/.test(l))
  return (reason ?? log.find(Boolean) ?? message).slice(0, 200)
}

/** Opening the same screen from two paths reports its layout issues twice; keep one. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.oracle}|${f.at}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
