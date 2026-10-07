import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { rng } from './fuzz.ts'
import { installMutationCounter, mutationCount } from './page-scripts.ts'

/*
 * Complex widgets (design doc §8): a gantt, a calendar grid, a canvas editor is one
 * node with an adapter. The adapter exposes semantic actions (implemented with
 * whatever gestures the widget needs) and readable state, so the runner never
 * guesses at pixels; invariants are checked after every action of seeded random
 * sequences, and a failing sequence is shrunk to the shortest that still fails.
 *
 *   // planning/gantt.adapter.ts
 *   import type { WidgetAdapter } from 'flowcheck/adapter'
 *   export default { id: 'planning.Gantt', harness: '/planning', read, actions, generate, invariants } satisfies WidgetAdapter<…>
 */

export interface AdapterStep {
  action: string
  args: unknown
}

export interface WidgetAdapter<State, Actions extends Record<string, unknown> = Record<string, unknown>> {
  /** Semantic ID of the widget, e.g. "calendar.TimeGrid". */
  id: string
  /** Path of the page that mounts the widget with fixture data (the harness). */
  harness: string
  /** Runs once after the harness loads, e.g. to wait for data or pick a view. */
  setup?(page: Page): Promise<void>
  /** The widget's semantic state, read from the page (DOM, or a debug hook). */
  read(page: Page): Promise<State>
  /** Semantic actions, implemented with real gestures. */
  actions: { [K in keyof Actions]: (page: Page, args: Actions[K], state: State) => Promise<void> }
  /** Valid next actions for a state; the runner picks one with the seeded generator. */
  generate(state: State, random: () => number): AdapterStep[]
  /** Each returns true, or a message describing the violation. */
  invariants: Array<(prev: State, next: State, step: AdapterStep) => true | string>
}

export interface AdapterFailure {
  adapter: string
  seed: number
  violation: string
  /** The shortest action sequence that still breaks the same invariant. */
  steps: AdapterStep[]
  original: number
}

export interface AdapterRunOptions {
  url: string
  seed: number
  runs?: number
  length?: number
  now?: Date
  log?: (line: string) => void
}

/** Waits until the DOM has been still for a moment: actions end with renders and transitions. */
async function settle(page: Page, quietMs = 200, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = -1
  let since = Date.now()
  while (Date.now() < deadline) {
    const n = await page.evaluate(mutationCount).catch(() => -2)
    if (n !== last) {
      last = n
      since = Date.now()
    } else if (Date.now() - since >= quietMs) return
    await page.waitForTimeout(30)
  }
}

export async function runAdapter<S>(adapter: WidgetAdapter<S>, options: AdapterRunOptions): Promise<AdapterFailure[]> {
  const browser: Browser = await chromium.launch()
  const harness = new URL(adapter.harness, options.url).href
  const log = options.log ?? (() => {})

  /** One sequence: random when `script` is null, else exactly `script`. Stops at the first violation. */
  const sequence = async (random: (() => number) | null, script: AdapterStep[] | null, length: number) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' })
    await context.addInitScript(installMutationCounter)
    // Apps publish debug hooks only when the runner is there to read them.
    await context.addInitScript(() => {
      const w = window as unknown as { __flowcheck?: Record<string, unknown> }
      w.__flowcheck ??= {}
    })
    const page = await context.newPage()
    if (options.now) await page.clock.setFixedTime(options.now)
    const steps: AdapterStep[] = []
    try {
      await page.goto(harness, { waitUntil: 'domcontentloaded' })
      await settle(page, 300, 6000)
      await adapter.setup?.(page)
      await settle(page)
      let state = await adapter.read(page)
      const total = script ? script.length : length
      for (let i = 0; i < total; i++) {
        let step: AdapterStep
        if (script) step = script[i]
        else {
          const options = adapter.generate(state, random!)
          if (!options.length) break
          step = options[Math.floor(random!() * options.length)]
        }
        const act = adapter.actions[step.action]
        if (!act) throw new Error(`${adapter.id}: generate() proposed unknown action "${step.action}"`)
        try {
          await act(page, step.args, state)
        } catch (err) {
          // An action that can't be performed is reported like a violation (a broken gesture or
          // a generate() that offered something impossible), not a crash of the whole run.
          steps.push(step)
          return { steps, violation: { index: -1, message: `${step.action} failed: ${(err as Error).message.split('\n')[0]}` } }
        }
        await settle(page)
        steps.push(step)
        const next = await adapter.read(page)
        for (const [n, invariant] of adapter.invariants.entries()) {
          let verdict: true | string
          try {
            verdict = invariant(state, next, step)
          } catch (err) {
            verdict = `threw: ${(err as Error).message}`
          }
          if (verdict !== true) return { steps, violation: { index: n, message: verdict } }
        }
        state = next
      }
      return { steps, violation: null }
    } finally {
      await context.close()
    }
  }

  const failures: AdapterFailure[] = []
  try {
    for (let run = 0; run < (options.runs ?? 5); run++) {
      const seed = options.seed + run
      const result = await sequence(rng(seed), null, options.length ?? 20)
      log(`${adapter.id} run ${run} (seed ${seed}): ${result.steps.length} actions${result.violation ? `, broke: ${result.violation.message}` : ''}`)
      if (!result.violation) continue
      // Shrink: drop one action at a time while the same invariant still breaks.
      let steps = result.steps
      for (let changed = true; changed; ) {
        changed = false
        for (let i = steps.length - 1; i >= 0 && steps.length > 1; i--) {
          const candidate = [...steps.slice(0, i), ...steps.slice(i + 1)]
          const again = await sequence(null, candidate, candidate.length)
          if (again.violation?.index === result.violation.index) {
            steps = again.steps
            changed = true
            break
          }
        }
      }
      failures.push({ adapter: adapter.id, seed, violation: result.violation.message, steps, original: result.steps.length })
    }
  } finally {
    await browser.close()
  }
  return failures
}

/** Every *.adapter.{ts,js,mjs} under root; the default export is the adapter. */
export async function loadAdapters(root: string): Promise<WidgetAdapter<unknown>[]> {
  const found: WidgetAdapter<unknown>[] = []
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.flowcheck'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (/\.adapter\.(m?js|ts)$/.test(entry.name)) {
        const module = (await import(pathToFileURL(full).href)) as { default?: WidgetAdapter<unknown> }
        if (module.default) found.push(module.default)
      }
    }
  }
  await walk(root)
  return found.sort((a, b) => a.id.localeCompare(b.id))
}
