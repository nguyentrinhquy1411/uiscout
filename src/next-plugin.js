import { fileURLToPath } from 'node:url'

/*
 * Next.js: stamps data-scout-src / data-scout-id under webpack and Turbopack.
 * Add it to test builds only:
 *
 *   // next.config.mjs
 *   import { withUiscout } from 'uiscout/next'
 *   const config = { ... }
 *   export default process.env.UISCOUT ? withUiscout(config) : config
 *
 * then `UISCOUT=1 next dev` in uiscout.config.json's webServer.command.
 */

const loader = fileURLToPath(new URL('./webpack-loader.js', import.meta.url))

/**
 * @template {Record<string, any>} T
 * @param {T} [nextConfig]
 * @param {{ root?: string, sources?: boolean }} [options]
 * @returns {T}
 */
export function withUiscout(nextConfig = /** @type {T} */ ({}), options = {}) {
  const use = { loader, options }
  return {
    ...nextConfig,
    webpack(config, context) {
      config.module.rules.push({ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [use] })
      return typeof nextConfig.webpack === 'function' ? nextConfig.webpack(config, context) : config
    },
    turbopack: {
      ...nextConfig.turbopack,
      rules: {
        ...nextConfig.turbopack?.rules,
        '*.tsx': { loaders: [use], as: '*.tsx' },
        '*.jsx': { loaders: [use], as: '*.jsx' },
      },
    },
  }
}
