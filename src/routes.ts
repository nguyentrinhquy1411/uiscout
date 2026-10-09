import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/*
 * Static routes read from the app's router, used as seeds: screens no link
 * reaches still get walked. Routes with parameters ("/docs/$docId",
 * "/posts/[id]") are left out: there is no value to put in them that is
 * guaranteed to exist.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.output', '.uiscout', 'coverage'])

export interface DiscoveredRoutes {
  /** Where they came from, for the log: "TanStack Router (src/routeTree.gen.ts)". */
  source: string
  routes: string[]
}

export function discoverRoutes(root: string): DiscoveredRoutes | null {
  for (const find of [tanstack, nextApp, nextPages]) {
    const found = find(root)
    if (found) return { source: found.source, routes: [...new Set(found.routes.map(normalize))].filter(Boolean).sort() }
  }
  return null
}

const normalize = (route: string) => (route.length > 1 ? route.replace(/\/+$/, '') : route)
const dynamic = (route: string) => /[$[\]*:]/.test(route)

/** The first file named `name` under `root`, breadth first, a few levels deep. */
function findFile(root: string, name: string, depth = 4): string | undefined {
  let level = [root]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isFile() && e.name === name) return path.join(dir, e.name)
        if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return undefined
}

/** TanStack Router's generated route tree: the keys of FileRoutesByTo (or ByFullPath). */
function tanstack(root: string) {
  const file = findFile(root, 'routeTree.gen.ts') ?? findFile(root, 'routeTree.gen.js')
  if (!file) return null
  const text = readFileSync(file, 'utf8')
  const block = /interface FileRoutesByTo\s*\{([^}]*)\}/.exec(text) ?? /interface FileRoutesByFullPath\s*\{([^}]*)\}/.exec(text)
  const routes = block ? [...block[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map((m) => m[1]) : [...text.matchAll(/fullPath:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  return { source: `TanStack Router (${path.relative(root, file)})`, routes: routes.filter((r) => !dynamic(r)) }
}

/** Every file below `dir`, relative to it. */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) out.push(...walk(path.join(dir, e.name), `${prefix}${e.name}/`))
    else if (e.isFile()) out.push(`${prefix}${e.name}`)
  }
  return out
}

/** Next.js app router: every page file; route groups "(x)" vanish, private "_x", slots "@x" and dynamic segments are skipped. */
function nextApp(root: string) {
  const dir = ['app', 'src/app'].map((d) => path.join(root, d)).find((d) => existsSync(d))
  if (!dir) return null
  const routes: string[] = []
  for (const f of walk(dir)) {
    const m = /^(.*?)\/?page\.(tsx|jsx|ts|js|mdx|md)$/.exec(f)
    if (!m) continue
    const segments = m[1].split('/').filter(Boolean)
    if (segments.some((s) => s.startsWith('_') || s.startsWith('@') || dynamic(s))) continue
    routes.push(`/${segments.filter((s) => !/^\(.*\)$/.test(s)).join('/')}`)
  }
  return routes.length ? { source: `Next.js app router (${path.relative(root, dir)}/)`, routes } : null
}

/** Next.js pages router: every page but api/, _app, _document and dynamic ones. */
function nextPages(root: string) {
  const dir = ['pages', 'src/pages'].map((d) => path.join(root, d)).find((d) => existsSync(d))
  if (!dir || !existsSync(path.join(root, 'package.json')) || !readFileSync(path.join(root, 'package.json'), 'utf8').includes('"next"')) return null
  const routes: string[] = []
  for (const f of walk(dir)) {
    const m = /^(.*)\.(tsx|jsx|ts|js|mdx|md)$/.exec(f)
    if (!m || m[1].startsWith('api/') || /(^|\/)_/.test(m[1]) || dynamic(m[1])) continue
    routes.push(`/${m[1].replace(/(^|\/)index$/, '')}`)
  }
  return routes.length ? { source: `Next.js pages router (${path.relative(root, dir)}/)`, routes } : null
}
