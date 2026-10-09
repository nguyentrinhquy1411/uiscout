import { existsSync, readFileSync } from 'node:fs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE, type FileConfig } from './config.ts'
import { discoverRoutes } from './routes.ts'

/*
 * uiscout init: looks at the project in the current directory and writes a
 * uiscout.config.json that starts the app and walks it, so the first run is
 * one command. Nothing it guesses is hidden: the file and every guess are printed.
 */

interface Framework {
  name: string
  /** Port the dev server listens on unless told otherwise. */
  port: number
  /** The plugin that adds source locations, when there is one. */
  plugin?: string
}

const FRAMEWORKS: Array<[dep: string, Framework]> = [
  ['next', { name: 'Next.js', port: 3000, plugin: 'uiscout/next' }],
  ['nuxt', { name: 'Nuxt', port: 3000 }],
  ['@remix-run/dev', { name: 'Remix', port: 5173, plugin: 'uiscout/vite' }],
  ['@sveltejs/kit', { name: 'SvelteKit', port: 5173 }],
  ['astro', { name: 'Astro', port: 4321 }],
  ['@angular/core', { name: 'Angular', port: 4200 }],
  ['react-scripts', { name: 'Create React App', port: 3000, plugin: 'uiscout/webpack' }],
  ['vite', { name: 'Vite', port: 5173, plugin: 'uiscout/vite' }],
  ['webpack', { name: 'webpack', port: 8080, plugin: 'uiscout/webpack' }],
]

/** The package manager, from the nearest lockfile up to the repository root. */
export function packageManager(dir: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    if (existsSync(path.join(current, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(path.join(current, 'yarn.lock'))) return 'yarn'
    if (existsSync(path.join(current, 'bun.lock')) || existsSync(path.join(current, 'bun.lockb'))) return 'bun'
    if (existsSync(path.join(current, 'package-lock.json'))) return 'npm'
    if (existsSync(path.join(current, '.git')) || path.dirname(current) === current) return 'npm'
  }
}

export interface Detected {
  framework: Framework | null
  pm: ReturnType<typeof packageManager>
  /** The package.json script that starts the dev server. */
  script: string | null
  port: number
  routes: ReturnType<typeof discoverRoutes>
}

export function detect(dir: string): Detected {
  const pkgFile = path.join(dir, 'package.json')
  const pkg = existsSync(pkgFile) ? (JSON.parse(readFileSync(pkgFile, 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) : {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const framework = FRAMEWORKS.find(([dep]) => dep in deps)?.[1] ?? null
  const script = ['dev', 'start', 'serve'].find((s) => pkg.scripts?.[s]) ?? null
  // An explicit port wins: in the script ("vite --port 4000", "next dev -p 4000") or a Vite config.
  const command = script ? pkg.scripts![script] : ''
  let port = Number(/(?:--port[ =]|-p\s+)(\d{2,5})/.exec(command)?.[1]) || 0
  if (!port) {
    for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
      const file = path.join(dir, f)
      if (existsSync(file)) port = Number(/\bport\s*:\s*(\d{2,5})/.exec(readFileSync(file, 'utf8'))?.[1]) || 0
      if (port) break
    }
  }
  return { framework, pm: packageManager(dir), script, port: port || framework?.port || 3000, routes: discoverRoutes(dir) }
}

export async function init(dir: string, { force = false, log = (l: string): void => void process.stdout.write(`${l}\n`) }: { force?: boolean; log?: (line: string) => void } = {}): Promise<number> {
  const target = path.join(dir, CONFIG_FILE)
  if (existsSync(target) && !force) {
    log(`${CONFIG_FILE} already exists here: edit it, or run uiscout init --force to replace it`)
    return 1
  }
  const d = detect(dir)
  const url = `http://localhost:${d.port}/`
  const config: FileConfig = { url }
  if (d.script) config.webServer = { command: `${d.pm} run ${d.script}`, url, timeout: 120 }
  if (d.routes?.routes.length) config.seeds = ['auto']
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`)

  // The run directory holds screenshots and sign-in state: never committed.
  const ignore = path.join(dir, '.gitignore')
  const ignored = existsSync(ignore) ? await readFile(ignore, 'utf8') : ''
  if (!/^\/?\.uiscout\/?$/m.test(ignored)) await appendFile(ignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}.uiscout/\n`)

  log(`Wrote ${CONFIG_FILE}:`)
  log('')
  log(JSON.stringify(config, null, 2).replace(/^/gm, '  '))
  log('')
  log(`  framework   ${d.framework?.name ?? 'not recognised'}`)
  log(`  app         ${d.script ? `started with "${config.webServer!.command}", expected at ${url}` : `no dev script found: start it yourself, then run uiscout check (url ${url})`}`)
  log(`  routes      ${d.routes ? `${d.routes.routes.length} static routes from ${d.routes.source}, walked as seeds` : 'none read from a router: only what links reach'}`)
  log(`  .gitignore  .uiscout/ (screenshots and sign-in state stay out of git)`)
  log('')
  log('Next:')
  log(`  npx uiscout check --quick    a first look in seconds`)
  log(`  npx uiscout check --open     the full walk, then the graph page`)
  log('')
  log('Worth adding to the config when they apply:')
  log('  "auth": { "steps": [...], "waitFor": "/" }    sign in once; use "${ENV_VAR}" for the password')
  log('  "block": ["**/api/ai/**"]                      requests the walk must never send (paid APIs)')
  if (d.framework?.plugin) log(`  the ${d.framework.plugin} plugin                         screens linked to source files, affected-only runs`)
  return 0
}
