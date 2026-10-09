import { describe, expect, it } from 'vitest'
import { withUiscout } from '../src/next-plugin.js'
import uiscoutLoader from '../src/webpack-loader.js'

function run(resourcePath: string, code: string, options = {}) {
  let result: { code?: string; map?: unknown } = {}
  uiscoutLoader.call({ resourcePath, rootContext: '/app', getOptions: () => options, callback: (_err: Error | null, code?: string, map?: unknown) => (result = { code, map }) }, code)
  return result
}

const BUTTON = 'export function Cart() {\n  return <button onClick={submitOrder}>Pay</button>\n}\n'

describe('webpack loader', () => {
  it('stamps the same attributes as the Vite plugin, paths relative to the project', () => {
    const out = run('/app/src/features/cart/Cart.tsx', BUTTON)
    expect(out.code).toContain('data-scout-src="src/features/cart/Cart.tsx:2"')
    expect(out.code).toContain('data-scout-id="cart.Cart.submitOrder"')
    expect(out.map).toMatchObject({ version: 3 })
  })

  it('leaves dependencies and non-JSX files untouched', () => {
    expect(run('/app/node_modules/lib/Button.jsx', BUTTON).code).toBe(BUTTON)
    expect(run('/app/src/util.ts', 'export const a = 1 < 2').code).toBe('export const a = 1 < 2')
  })

  it('can keep ids without source paths for production builds', () => {
    expect(run('/app/src/Cart.tsx', BUTTON, { sources: false }).code).not.toContain('data-scout-src')
  })
})

describe('withUiscout (Next.js)', () => {
  it('adds the loader for webpack and Turbopack, keeping the app config', () => {
    const own = (config: { marker?: boolean }) => ({ ...config, marker: true })
    const config = withUiscout({ reactStrictMode: true, webpack: own, turbopack: { rules: { '*.svg': { loaders: ['svgr'] } } } })
    expect(config.reactStrictMode).toBe(true)
    const webpack = (config.webpack as (c: unknown, ctx: unknown) => unknown)({ module: { rules: [] } }, {}) as { marker: boolean; module: { rules: Array<{ enforce: string }> } }
    expect(webpack.marker).toBe(true)
    expect(webpack.module.rules[0].enforce).toBe('pre')
    expect(Object.keys(config.turbopack.rules)).toEqual(['*.svg', '*.tsx', '*.jsx'])
  })
})
