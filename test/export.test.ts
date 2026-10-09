import { describe, expect, it } from 'vitest'
import { locatorFor, playwrightSpec } from '../src/export.ts'
import type { Fingerprint } from '../src/types.ts'

const fp = (f: Partial<Fingerprint>): Fingerprint => ({ tag: 'button', role: 'button', name: '', testId: null, parents: '', cell: '0,0', ...f })

describe('playwrightSpec', () => {
  it('locates by test id, then role and name, then tag and text', () => {
    expect(locatorFor(fp({ testId: 'cart.Pay', name: 'Pay' }))).toBe(`page.locator("[data-testid=\\"cart.Pay\\"], [data-scout-id=\\"cart.Pay\\"]").first()`)
    expect(locatorFor(fp({ name: 'Pay' }))).toBe(`page.getByRole("button", { name: "Pay", exact: true }).first()`)
    expect(locatorFor(fp({ tag: 'div', role: 'generic', name: 'Row' }))).toBe(`page.locator("div").filter({ hasText: "Row" }).first()`)
  })

  it('walks the finding path and fails on the same kind of problem', () => {
    const spec = playwrightSpec({
      url: 'http://localhost:5173/',
      finding: {
        oracle: 'network', severity: 'error', at: '/checkout → click checkout.Pay', message: 'POST /api/orders returned 500',
        steps: [{ kind: 'route', path: '/checkout' }, { kind: 'fill', fp: fp({ tag: 'input', role: 'textbox', name: 'Email' }), text: 'uiscout@example.com', enter: false }, { kind: 'click', fp: fp({ name: 'Pay' }) }],
      },
    })
    expect(spec).toContain(`await page.goto("http://localhost:5173/")`)
    expect(spec).toContain(`}, "/checkout")`)
    expect(spec).toContain(`await page.getByRole("textbox", { name: "Email", exact: true }).first().fill("uiscout@example.com")`)
    expect(spec).toContain(`await page.getByRole("button", { name: "Pay", exact: true }).first().click()`)
    expect(spec).toContain('expect(problems).toEqual([])')
    expect(spec).not.toContain('TODO')
  })

  it('signs in with the configured steps, keeping secrets as environment variables', () => {
    const spec = playwrightSpec({
      url: 'http://localhost:5173/',
      auth: { steps: [{ fill: 'Password', text: '${APP_PASSWORD}' }], waitFor: '/' },
      finding: { oracle: 'layout', severity: 'warning', at: 'load /', message: 'clipped', steps: [] },
    })
    expect(spec).toContain('.fill(`${process.env.APP_PASSWORD}`)')
    expect(spec).toContain('// TODO: assert what "layout" checked')
  })

  it('keeps app text inside its comments, whatever line terminator it carries', () => {
    const evil = 'boom\u2028process.exit(1)\rrequire("child_process")'
    const spec = playwrightSpec({
      url: 'http://localhost:5173/',
      finding: { oracle: 'script', severity: 'error', at: `/x\u2029→ click y`, message: evil, steps: [{ kind: 'click', fp: fp({ name: 'Pay\u2028alert(1)' }) }] },
    })
    for (const line of spec.split(/\r\n|[\n\r\u2028\u2029]/)) if (/process\.exit|require\(|alert\(1\)/.test(line)) expect(line.trimStart()).toMatch(/^(\/\/|test\(|await page\.getByRole)/)
  })
})
