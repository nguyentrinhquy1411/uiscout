import { describe, expect, it } from 'vitest'
import { stampIds } from '../src/vite-plugin.js'

const stamp = (code: string, file = 'src/features/cart/CartSummary.tsx') => stampIds(code, file)?.code ?? code

describe('identity plugin', () => {
  it('stamps interactive elements with a source witness and a semantic ID', () => {
    const out = stamp(`export function CartSummary() {
  return <div>
    <button onClick={submitOrder}>Place order</button>
    <p>Total</p>
  </div>
}`)
    expect(out).toContain('<button data-fc-src="src/features/cart/CartSummary.tsx:3" data-fc-id="cart.CartSummary.submitOrder" onClick={submitOrder}>')
    expect(out).toContain('<p>Total</p>')
    expect(out).toContain('<div>')
  })

  it('derives the hint from an inline call, a label or the text, and never from position', () => {
    const out = stamp(`const Toolbar = () => (
  <>
    <button onClick={() => go(1)}>Next</button>
    <button aria-label="Zoom in" onClick={() => setZoom(z + 1)} />
    <a href="/help">Get help</a>
  </>
)`, 'src/components/shell/toolbar.tsx')
    expect(out).toContain('data-fc-id="shell.Toolbar.go"')
    expect(stamp('function A() { return <button onClick={() => navigate(\'/checkout\')}>Go</button> }')).toContain('data-fc-id="cart.A.navigateCheckout"')
    expect(out).toContain('data-fc-id="shell.Toolbar.zoomIn"')
    expect(out).toContain('data-fc-id="shell.Toolbar.getHelp"')
  })

  it('leaves a developer test ID alone and stamps components that look interactive', () => {
    const out = stamp(`function Rail() {
  return <nav>
    <Link to="/docs">Docs</Link>
    <button data-testid="rail.toggle" onClick={toggle} />
    <Card title="x" />
  </nav>
}`, 'src/components/shell/rail.tsx')
    expect(out).toContain('<Link data-fc-src="src/components/shell/rail.tsx:3" data-fc-id="shell.Rail.docs" to="/docs">')
    expect(out).toContain('<button data-fc-src="src/components/shell/rail.tsx:4" data-testid="rail.toggle"')
    expect(out).not.toContain('<Card data-fc')
  })

  it('returns null for files with nothing to stamp or that do not parse', () => {
    expect(stampIds('export const x = 1', 'src/a.ts')).toBeNull()
    expect(stampIds('<button onClick={', 'src/a.tsx')).toBeNull()
  })
})
