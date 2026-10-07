import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl, type CrawlResult } from '../src/crawl.ts'
import { loadIntent, loadRules, parseIntent, summarizeIntent } from '../src/intent.ts'
import { always, check, eventually, type ObservedState, state, when } from '../src/rules.ts'
import { startZoo } from './zoo-server.ts'

const s = (over: Partial<ObservedState>): ObservedState => ({ context: 'default', node: '/', url: '/', time: 0, step: 'x', elements: {}, reads: {}, ...over })
const named = <T extends { name: string }>(rule: T, name: string) => Object.assign(rule, { name })

describe('rule evaluation', () => {
  it('checks an implication on every state and keeps the steps to the failure', () => {
    const rule = named(always(when(() => state.read('n') === 0).then(() => state.element('order').disabled)), 'r')
    const trace = [s({ step: 'load', reads: { n: 1 } }), s({ step: 'click empty', reads: { n: 0 }, elements: { order: { role: 'button', name: 'Order', disabled: false } } })]
    expect(check(rule, trace)).toMatchObject({ rule: 'r', at: 1, trace: ['load', 'click empty'] })
  })

  it('passes eventually inside the window and fails once the window has passed', () => {
    const toast = { toast: { role: 'marked', name: 'x', disabled: false } }
    const rule = named(always(when(() => state.element('toast').visible).then(eventually(() => !state.element('toast').visible).within(5, 'seconds'))), 'r')
    expect(check(rule, [s({ time: 0, elements: toast }), s({ time: 4000 })])).toBeNull()
    expect(check(rule, [s({ time: 0, elements: toast }), s({ time: 6000, elements: toast })])?.message).toContain('never followed within 5000 ms')
    // Trace too short to tell: inconclusive, not a failure.
    expect(check(rule, [s({ time: 0, elements: toast }), s({ time: 1000, elements: toast })])).toBeNull()
  })

  it('reports a rule that throws instead of hiding it', () => {
    const rule = named(always(() => { throw new Error('boom') }), 'r')
    expect(check(rule, [s({})])?.message).toBe('threw: boom')
  })
})

describe('intent files', () => {
  it('parses linked, pending and unlinked lines', () => {
    const lines = parseIntent('# T\n- A <!-- rule: a -->\n- B <!-- rule: pending -->\n* C\nprose', 'x.intent.md')
    expect(lines.map((l) => [l.text, l.rule])).toEqual([['A', 'a'], ['B', null], ['C', null]])
  })
})

describe('rules on a real walk', () => {
  let zoo: Awaited<ReturnType<typeof startZoo>>
  let run: CrawlResult
  const root = path.join(import.meta.dirname, 'zoo-rules')

  beforeAll(async () => {
    zoo = await startZoo()
    run = await crawl({ url: `${zoo.url}cart.html`, maxDepth: 1, settleMs: 150, a11y: false, rules: await loadRules(root) })
  }, 60_000)
  afterAll(() => zoo?.close())

  const broken = () => run.findings.filter((f) => f.oracle === 'rule').map((f) => f.message.split(':')[0])

  it('catches the planted bugs and passes the rules that hold', () => {
    expect(new Set(broken())).toEqual(new Set(['emptyCartDisablesOrder', 'savedToastClears']))
    expect(run.ruleResults.errorToastClears).toMatchObject({ violations: 0 })
    expect(run.ruleResults.countNeverNegative.paths).toBeGreaterThan(0)
  })

  it('carries the steps that lead to a violation', () => {
    const f = run.findings.find((x) => x.message.startsWith('savedToastClears'))
    expect(f?.trace?.some((t) => t.includes('save-draft'))).toBe(true)
  })

  it('summarizes intent coverage, with pending and stale lines', async () => {
    const summary = summarizeIntent(await loadIntent(root), run.ruleResults)
    expect(summary.lines.map((l) => l.state)).toEqual(['failing', 'linked', 'failing', 'linked', 'pending', 'stale'])
    expect(summary).toMatchObject({ linked: 2, total: 6 })
  })
})

describe('fuzz', () => {
  let zoo: Awaited<ReturnType<typeof startZoo>>
  beforeAll(async () => {
    zoo = await startZoo()
  })
  afterAll(() => zoo?.close())

  it('finds a planted bug by random walk and shrinks it to the one step that matters', async () => {
    const { fuzz } = await import('../src/fuzz.ts')
    const rules = (await loadRules(path.join(import.meta.dirname, 'zoo-rules'))).filter((r) => r.name === 'savedToastClears')
    const failures = await fuzz({ url: `${zoo.url}cart.html`, seed: 7, runs: 2, length: 8, rules, settleMs: 100 })
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0].what).toBe('rule savedToastClears')
    expect(failures[0].steps).toEqual(['/cart.html.button:save-draft@main'])
  }, 120_000)

  it('walks the same way for the same seed', async () => {
    const { rng } = await import('../src/fuzz.ts')
    const a = rng(42)
    const b = rng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
