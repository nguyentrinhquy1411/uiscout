/*
 * Invariants (design doc §7B): rules that must hold on every path, with two
 * temporal operators, evaluated over the sequence of states the runner observes.
 *
 *   import { always, eventually, when, state } from 'uiscout/rules'
 *
 *   export const emptyCartDisablesOrder = always(
 *     when(() => state.read('cart.count') === 0)
 *       .then(() => state.element('cart.CartSummary.submit').disabled),
 *   )
 *
 *   export const errorToastClears = always(
 *     when(() => state.element('app.Toast.error').visible)
 *       .then(eventually(() => !state.element('app.Toast.error').visible).within(5, 'seconds')),
 *   )
 *
 * A rule file is any module whose exports are rules; the export name is the rule's
 * name, which intent files link to (§9).
 */

/** One observed state: what the runner saw after a step settled. */
export interface ObservedState {
  context: string
  node: string
  url: string
  /** App time in ms (the clock the page sees, fast-forwards included). */
  time: number
  /** The step that led here, readable. */
  step: string
  elements: Record<string, { role: string; name: string; disabled: boolean }>
  /** Values the app exposes for tests through window.__uiscout.read(). */
  reads: Record<string, unknown>
}

export interface ElementView {
  /** On the screen and visible. */
  visible: boolean
  exists: boolean
  disabled: boolean
  name: string
}

/**
 * The state being judged lives on globalThis, not in this module: a rules file that
 * imports 'uiscout/rules' may get a different copy of this module than the
 * runner (the built package vs. the source), and both must see the same state.
 */
const slot = globalThis as unknown as { __uiscoutState?: ObservedState | null }

/** The state a rule's predicates read; bound by the evaluator while a predicate runs. */
export const state = {
  context: { is: (name: string) => now().context === name },
  node: {
    /** Exact node ID ("/checkout", "/products [Confirm purchase]") or a route prefix ending in "*". */
    is: (id: string) => (id.endsWith('*') ? now().node.startsWith(id.slice(0, -1)) : now().node === id),
    get id() {
      return now().node
    },
  },
  get url() {
    return now().url
  },
  element(id: string): ElementView {
    const el = now().elements[id]
    return { visible: Boolean(el), exists: Boolean(el), disabled: el?.disabled ?? false, name: el?.name ?? '' }
  },
  read(key: string): unknown {
    return now().reads[key]
  },
}

function now(): ObservedState {
  if (!slot.__uiscoutState) throw new Error('state is only readable inside a rule predicate')
  return slot.__uiscoutState
}

export function withState<T>(s: ObservedState, fn: () => T): T {
  const previous = slot.__uiscoutState ?? null
  slot.__uiscoutState = s
  try {
    return fn()
  } finally {
    slot.__uiscoutState = previous
  }
}

type Predicate = () => boolean

export class Eventually {
  readonly kind = 'eventually'
  ms = Number.POSITIVE_INFINITY
  readonly predicate: Predicate
  constructor(predicate: Predicate) {
    this.predicate = predicate
  }
  within(amount: number, unit: 'ms' | 'seconds' | 'minutes' = 'ms'): Eventually {
    this.ms = amount * (unit === 'seconds' ? 1000 : unit === 'minutes' ? 60_000 : 1)
    return this
  }
}

export class Implication {
  readonly kind = 'implication'
  consequent: Predicate | Eventually = () => true
  readonly condition: Predicate
  constructor(condition: Predicate) {
    this.condition = condition
  }
  then(consequent: Predicate | Eventually): Implication {
    this.consequent = consequent
    return this
  }
}

export class Rule {
  readonly kind = 'rule'
  name = ''
  readonly body: Predicate | Implication
  constructor(body: Predicate | Implication) {
    this.body = body
  }
}

export const always = (body: Predicate | Implication) => new Rule(body)
export const when = (condition: Predicate) => new Implication(condition)
export const eventually = (predicate: Predicate) => new Eventually(predicate)

export interface Violation {
  rule: string
  /** Index of the state where the rule broke, and the steps that led there. */
  at: number
  trace: string[]
  message: string
}

/**
 * Checks one rule on one trace. `complete` says the trace ended because the walk
 * did (not because a budget cut it): an `eventually` still open at the end of a
 * complete trace whose time ran past its window is a violation; otherwise it's
 * inconclusive and not reported.
 */
export function check(rule: Rule, trace: ObservedState[]): Violation | null {
  const fail = (at: number, message: string): Violation => ({ rule: rule.name, at, trace: trace.slice(0, at + 1).map((s) => s.step), message })
  const holds = (p: Predicate, s: ObservedState) => {
    try {
      return withState(s, p)
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err))
    }
  }
  for (let i = 0; i < trace.length; i++) {
    const s = trace[i]
    if (typeof rule.body === 'function') {
      const ok = holds(rule.body, s)
      if (ok instanceof Error) return fail(i, `threw: ${ok.message}`)
      if (!ok) return fail(i, `does not hold on ${s.node}`)
      continue
    }
    const cond = holds(rule.body.condition, s)
    if (cond instanceof Error) return fail(i, `condition threw: ${cond.message}`)
    if (!cond) continue
    const consequent = rule.body.consequent
    // Duck-typed like the rule itself: it may come from another copy of this module.
    if (typeof consequent === 'function') {
      const ok = holds(consequent, s)
      if (ok instanceof Error) return fail(i, `threw: ${ok.message}`)
      if (!ok) return fail(i, `condition held on ${s.node} but the consequence did not`)
      continue
    }
    // eventually: some state from here, within the window, satisfies it.
    let met = false
    for (let j = i; j < trace.length && trace[j].time - s.time <= consequent.ms; j++) {
      if (holds(consequent.predicate, trace[j]) === true) {
        met = true
        break
      }
    }
    const last = trace.at(-1)!
    if (!met && last.time - s.time > consequent.ms) {
      return fail(i, `condition held on ${s.node}, and the consequence never followed within ${consequent.ms} ms`)
    }
  }
  return null
}

/**
 * Rules exported by a loaded module, named after their exports. Recognised by
 * shape, not instanceof, for the same two-copies reason as the state slot.
 */
export function rulesOf(module: Record<string, unknown>): Rule[] {
  return Object.entries(module).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || (value as { kind?: unknown }).kind !== 'rule') return []
    const rule = value as Rule
    rule.name = name
    return [rule]
  })
}
