import { describe, expect, it } from 'vitest'
import { elementId, fingerprintOf, locate, routeOf, safetyOf, similarity } from '../src/identity.ts'
import type { RawElement } from '../src/types.ts'

const raw = (over: Partial<RawElement> = {}): RawElement => ({
  i: 0, tag: 'button', role: 'button', name: 'Save', testId: null, parents: 'main',
  href: null, target: null, disabled: false, submit: null, source: null, box: { x: 100, y: 100, w: 80, h: 32 }, ...over,
})

describe('identity', () => {
  it('builds readable, position-free IDs and prefers a test ID', () => {
    expect(elementId('/docs', fingerprintOf(raw({ name: 'Lưu trang' })))).toBe('/docs.button:luu-trang@main')
    expect(elementId('/docs', fingerprintOf(raw({ testId: 'docs.save' })))).toBe('docs.save')
  })

  it('finds a moved element again, exactly when nothing else changed', () => {
    const target = fingerprintOf(raw())
    expect(locate(target, [raw({ i: 3, name: 'Cancel' }), raw({ i: 7 })])).toEqual({ el: raw({ i: 7 }), exact: true })
    const moved = locate(target, [raw({ i: 2, box: { x: 900, y: 600, w: 80, h: 32 } })])
    expect(moved?.exact).toBe(false)
    expect(moved?.el.i).toBe(2)
  })

  it('refuses a match that is only vaguely alike', () => {
    expect(locate(fingerprintOf(raw()), [raw({ name: 'Delete', role: 'link', tag: 'a', parents: 'nav' })])).toBeNull()
    expect(similarity(fingerprintOf(raw()), fingerprintOf(raw()))).toBe(1)
  })

  it('labels controls by what they do', () => {
    expect(safetyOf(fingerprintOf(raw({ name: 'Delete all data' })))).toBe('destructive')
    expect(safetyOf(fingerprintOf(raw({ name: 'Xoá trang' })))).toBe('destructive')
    expect(safetyOf(fingerprintOf(raw({ name: 'Save version' })))).toBe('mutating')
    expect(safetyOf(fingerprintOf(raw({ name: 'Week' })))).toBe('safe')
  })
})

describe('console summary', async () => {
  const { consoleSummary } = await import('../src/oracles/monitor.ts')
  it('keeps the line that names the error from a React format string', () => {
    const text = '%o\n\n%s\n\n%s\n Error: Base UI: MenuGroupContext is missing.\n    at useMenuGroupRootContext (x.js:1:1)'
    expect(consoleSummary(text)).toBe('Error: Base UI: MenuGroupContext is missing.')
    expect(consoleSummary('something broke')).toBe('something broke')
  })
})

describe('routeOf', () => {
  it('collapses data IDs so one screen is one node', () => {
    expect(routeOf('/chat/3c940882-1c5c-41e1-841a-f23a584b1476')).toBe('/chat/:id')
    expect(routeOf('/docs/01J9ZK3M8Q2X7V5T4R6N0P1B2C')).toBe('/docs/:id')
    expect(routeOf('/cards/42/study')).toBe('/cards/:id/study')
    expect(routeOf('/docs/mnf8x2k9a1b2c3d4e5f6')).toBe('/docs/:id')
  })

  it('keeps words', () => {
    expect(routeOf('/settings')).toBe('/settings')
    expect(routeOf('/cards/stats')).toBe('/cards/stats')
    expect(routeOf('/keyboard-shortcuts-and-more')).toBe('/keyboard-shortcuts-and-more')
    expect(routeOf('/internationalization')).toBe('/internationalization')
  })
})
