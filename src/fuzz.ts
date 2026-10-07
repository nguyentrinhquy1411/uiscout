import { chromium, type Browser } from 'playwright'
import { clickAt, clickFailure, nodeIdOf, quiesce, skipReason, stepLabel } from './crawl.ts'
import { elementId, fingerprintOf, locate, safetyOf, safetyOfText } from './identity.ts'
import { installNetworkMode, type NetworkMode, type Recordings } from './network.ts'
import { StepMonitor, type MonitorOptions } from './oracles/monitor.ts'
import { collectElements, installMutationCounter, observePage } from './page-scripts.ts'
import { check, type ObservedState, type Rule } from './rules.ts'
import type { Finding, Step } from './types.ts'

/*
 * Fuzzing (design doc §7B, M3): seeded random walks over the app, checking the
 * invariants and the generic oracles after every step. A failure is shrunk to the
 * shortest sequence that still fails, and reported with its seed, so it replays
 * exactly. Nightly, not on pull requests.
 */

export interface FuzzOptions extends MonitorOptions {
  url: string
  seed: number
  /** Independent walks, each from a fresh browser context. */
  runs?: number
  /** Actions per walk. */
  length?: number
  rules?: Rule[]
  block?: string[]
  network?: NetworkMode
  recordings?: Recordings
  fillText?: string
  fastForwardMs?: number
  settleMs?: number
  log?: (line: string) => void
}

export interface FuzzFailure {
  seed: number
  run: number
  /** What broke: "rule <name>" or "<oracle>: <message>". */
  what: string
  /** The shortest sequence of actions that still breaks it, from the entry. */
  steps: string[]
  original: number
}

/** mulberry32: a tiny seeded PRNG, so a seed always means the same walk. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface WalkResult {
  steps: Step[]
  labels: string[]
  /** First failure, with the index of the step that caused it. */
  failure: { what: string; at: number } | null
}

export async function fuzz(options: FuzzOptions): Promise<FuzzFailure[]> {
  const origin = new URL(options.url).origin
  const settleMs = options.settleMs ?? 200
  const length = options.length ?? 25
  const network = options.network ?? 'live'
  const recordings = options.recordings ?? {}
  const rules = options.rules ?? []
  const log = options.log ?? (() => {})
  const browser: Browser = await chromium.launch()

  /**
   * One walk. With `script`, replays those steps exactly (shrinking); otherwise
   * picks each action with `random`. Stops at the first failure.
   */
  const walk = async (random: (() => number) | null, script: Step[] | null): Promise<WalkResult> => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    await context.addInitScript(installMutationCounter)
    await installNetworkMode(context, network, origin, recordings)
    for (const glob of options.block ?? []) await context.route(glob, (route) => route.abort('blockedbyclient'))
    const page = await context.newPage()
    await page.clock.install()
    const monitor = new StepMonitor(page, origin, options)
    const steps: Step[] = []
    const labels: string[] = []
    const trace: ObservedState[] = []

    const observe = async (step: string, node: string) => {
      if (!rules.length) return
      const seen = await page.evaluate(observePage).catch(() => null)
      if (!seen) return
      const elements: ObservedState['elements'] = {}
      for (const m of seen.marked) elements[m.id] = { role: 'marked', name: m.name, disabled: m.disabled }
      for (const el of await page.evaluate(collectElements).catch(() => [])) elements[elementId(node, fingerprintOf(el))] = { role: el.role, name: el.name, disabled: el.disabled }
      trace.push({ context: 'default', node, url: seen.url, time: seen.time, step, elements, reads: seen.reads })
    }
    const failureNow = (at: number): WalkResult['failure'] => {
      const error = monitor.findings.find((f: Finding) => f.severity === 'error')
      if (error) return { what: `${error.oracle}: ${error.message}`, at }
      for (const rule of rules) if (check(rule, trace)) return { what: `rule ${rule.name}`, at }
      return null
    }

    try {
      monitor.begin('load')
      await page.goto(options.url, { waitUntil: 'domcontentloaded' })
      await quiesce(page, monitor, settleMs, 4000)
      await observe('load', await nodeIdOf(page, origin))
      let failure = failureNow(-1)
      const total = script ? script.length : length
      for (let i = 0; i < total && !failure; i++) {
        const node = await nodeIdOf(page, origin, monitor)
        if (node.startsWith('external:')) break
        const candidates = (await page.evaluate(collectElements)).filter((el) => {
          const safety = safetyOf(fingerprintOf(el))
          return !skipReason(el, network === 'replay' && safety === 'destructive' ? 'mutating' : safety, origin)
        })
        let step: Step
        let index: number
        if (script) {
          step = script[i]
          // Only safe candidates are searched, so a replayed step can't heal onto a destructive control.
          const found = step.kind === 'route' ? null : locate(step.fp, candidates)
          if (!found) break
          index = found.el.i
        } else {
          if (!candidates.length) break
          const el = candidates[Math.floor(random!() * candidates.length)]
          const fp = fingerprintOf(el)
          const enter = network === 'replay' || !(el.submit && safetyOfText(el.submit) === 'destructive')
          step = el.role === 'textbox' ? { kind: 'fill', fp, text: options.fillText ?? 'uiscout', enter } : { kind: 'click', fp }
          index = el.i
        }
        const label = step.kind === 'route' ? stepLabel(step, '') : stepLabel(step, elementId(node, step.fp))
        monitor.begin(label)
        if (step.kind === 'fill') {
          const field = page.locator(`[data-scout-i="${index}"]`)
          await field.fill(step.text, { timeout: 3000 }).then(() => (step.kind === 'fill' && step.enter ? field.press('Enter') : undefined)).catch((e: Error) => clickFailure(e.message))
        } else {
          await clickAt(page, index)
        }
        steps.push(step)
        labels.push(label)
        await quiesce(page, monitor, settleMs, 4000)
        await observe(label, await nodeIdOf(page, origin, monitor))
        await page.clock.fastForward(options.fastForwardMs ?? 5000).catch(() => {})
        await quiesce(page, monitor, settleMs, 4000)
        await observe('(timers)', await nodeIdOf(page, origin, monitor))
        failure = failureNow(i)
      }
      return { steps, labels, failure }
    } finally {
      await context.close()
    }
  }

  const failures: FuzzFailure[] = []
  try {
    for (let run = 0; run < (options.runs ?? 5); run++) {
      const seed = options.seed + run
      const result = await walk(rng(seed), null)
      log(`run ${run} (seed ${seed}): ${result.steps.length} steps${result.failure ? `, broke: ${result.failure.what}` : ''}`)
      if (!result.failure) continue
      // Shrink: drop one step at a time while the same failure still happens.
      let steps = result.steps.slice(0, result.failure.at + 1)
      let labels = result.labels.slice(0, result.failure.at + 1)
      for (let changed = true; changed; ) {
        changed = false
        for (let i = steps.length - 1; i >= 0 && steps.length > 1; i--) {
          const candidate = [...steps.slice(0, i), ...steps.slice(i + 1)]
          const again = await walk(null, candidate)
          if (again.failure?.what === result.failure.what) {
            steps = again.steps.slice(0, again.failure.at + 1)
            labels = again.labels.slice(0, again.failure.at + 1)
            changed = true
            break
          }
        }
      }
      failures.push({ seed, run, what: result.failure.what, steps: labels, original: result.failure.at + 1 })
    }
  } finally {
    await browser.close()
  }
  return failures
}
