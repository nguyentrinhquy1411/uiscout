import path from 'node:path'
import { stampIds } from './vite-plugin.js'

/*
 * The identity transform of the Vite plugin as a webpack loader, for webpack,
 * Create React App (through craco or an ejected config), Rspack and Next.js
 * (webpack or Turbopack, see uiscout/next):
 *
 *   // webpack.config.js, in test builds only
 *   module: { rules: [{ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', loader: 'uiscout/webpack' }] }
 *
 * Options: { root?: string, sources?: boolean } as for uiscoutIds().
 */

/**
 * @this {{ resourcePath: string, rootContext?: string, getOptions?: () => { root?: string, sources?: boolean }, callback: (err: Error | null, code?: string, map?: unknown) => void }}
 * @param {string} code
 * @param {unknown} [map]
 */
export default function uiscoutLoader(code, map) {
  const options = this.getOptions?.() ?? {}
  const file = this.resourcePath
  if (!/\.[jt]sx$/.test(file) || file.includes(`${path.sep}node_modules${path.sep}`) || !code.includes('<')) return this.callback(null, code, map)
  const root = options.root ?? this.rootContext ?? process.cwd()
  const out = stampIds(code, path.relative(root, file).split(path.sep).join('/'), file, { sources: options.sources ?? true })
  if (!out) return this.callback(null, code, map)
  this.callback(null, out.code, JSON.parse(out.map.toString()))
}
