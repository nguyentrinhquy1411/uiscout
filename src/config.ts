import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

/*
 * uiscout.config.json (design doc §12) and contexts (§5): the personas a graph is
 * walked under. A context is a name plus the steps that put the app in that state,
 * run after every page load, so it works for apps that keep their session only in
 * memory as well as in cookies or localStorage.
 */

export type SetupStep =
  /** Full page load of a path or URL. */
  | { goto: string }
  /** In-app navigation through the history API (no reload, in-memory state survives). */
  | { route: string }
  /** Click the control with this accessible name (a button or link), or this exact text. */
  | { click: string }
  /** Type into the field with this label or placeholder. */
  | { fill: string; text: string }
  | { press: string }
  /** Run arbitrary JavaScript in the page, e.g. to set a token in localStorage. */
  | { eval: string }

export interface ContextConfig {
  name: string
  /** Run after every page load: for state kept in memory (a store, a route). */
  setup?: SetupStep[]
  /**
   * Run once, in a fresh browser, before the walk; the cookies and storage it
   * leaves are where every screen starts. For sign-in with a session cookie.
   */
  auth?: AuthConfig
  /** Saved storage state every page of this context starts from (set by the CLI after auth). */
  storageState?: string
}

export interface AuthConfig {
  steps: SetupStep[]
  /** After the steps, wait until the URL path is this or below it ("/dashboard"; "/" means the root only). */
  waitFor?: string
}

/** The app to test, started by uiscout when it isn't already running (like Playwright's webServer). */
export interface WebServerConfig {
  /** Shell command, run from the config's directory, e.g. "pnpm dev". */
  command: string
  /** Polled until it answers; default: the config's url. */
  url?: string
  /** Seconds to wait for it. Default 60. */
  timeout?: number
  /** Use a server already answering at url instead of starting one. Default true. */
  reuseExisting?: boolean
}

export interface FileConfig {
  url?: string
  depth?: number
  maxSteps?: number
  concurrency?: number
  now?: string
  timezone?: string
  /**
   * Routes no link reaches, walked from the entry through the history API.
   * "auto" stands for every static route the app's router declares
   * (TanStack Router, Next.js app or pages router).
   */
  seeds?: string[]
  contexts?: ContextConfig[]
  block?: string[]
  allow4xx?: string[]
  allowOverlap?: string
  ignoreConsole?: string[]
  /** What the runner types into text fields. */
  fillText?: string
  /** Timers fast-forwarded after each step, to catch delayed navigation. 0 turns it off. */
  fastForwardMs?: number
  a11y?: boolean
  /** live (default), record or replay; recordings live in the baseline directory. */
  network?: 'live' | 'record' | 'replay'
  /** Where the accepted graph and snapshots live (default "uiscout"). */
  baseline?: string
  /** Sign-in for the default context, run once (see ContextConfig.auth). */
  auth?: AuthConfig
  webServer?: WebServerConfig
  /** Where *.rules.ts, *.intent.md and *.adapter.ts are looked for, relative to the config. Default: its directory. */
  root?: string
}

export const CONFIG_FILE = 'uiscout.config.json'

/**
 * The nearest uiscout.config.json from `dir` upwards, stopping at a repository
 * root (a .git entry), so a run from anywhere inside a monorepo package finds it.
 */
export function findConfig(dir: string): string | undefined {
  for (let current = path.resolve(dir); ; ) {
    const candidate = path.join(current, CONFIG_FILE)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (existsSync(path.join(current, '.git')) || parent === current) return undefined
    current = parent
  }
}

/**
 * "${NAME}" in any string value is replaced by that environment variable, so
 * credentials for sign-in steps stay out of the file. A missing one is an error.
 */
export function interpolateEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
      const v = env[name]
      if (v === undefined) throw new Error(`${CONFIG_FILE} uses \${${name}}, which is not set in the environment`)
      return v
    }) as T
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnv(v, env)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, env)])) as T
  return value
}

export async function loadConfig(file: string): Promise<FileConfig> {
  const text = await readFile(file, 'utf8')
  let parsed: FileConfig
  try {
    parsed = JSON.parse(text) as FileConfig
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`)
  }
  return interpolateEnv(parsed)
}

/** Runs one context's setup on a freshly loaded page. Throws with the step that failed. */
export async function runSetup(page: Page, steps: SetupStep[], origin: string): Promise<void> {
  for (const [i, step] of steps.entries()) {
    try {
      if ('goto' in step) await page.goto(new URL(step.goto, origin).href, { waitUntil: 'domcontentloaded' })
      else if ('route' in step) await page.evaluate(pushRoute, step.route)
      else if ('click' in step) {
        // Role first: a heading that reads "Log in" must not win over the "Log in" button.
        const byRole = page.getByRole('button', { name: step.click, exact: true }).or(page.getByRole('link', { name: step.click, exact: true }))
        const target = (await byRole.count()) > 0 ? byRole : page.getByText(step.click, { exact: true })
        await target.first().click({ timeout: 5000 })
      } else if ('fill' in step) {
        await page.getByLabel(step.fill).or(page.getByPlaceholder(step.fill)).first().fill(step.text, { timeout: 5000 })
      } else if ('press' in step) await page.keyboard.press(step.press)
      else if ('eval' in step) await page.evaluate(step.eval)
      await page.waitForLoadState('domcontentloaded')
    } catch (err) {
      throw new Error(`setup step ${i + 1} (${describeStep(step)}) failed: ${(err as Error).message.split('\n')[0]}`)
    }
  }
}

/**
 * A step as it may appear in a report: what is typed or evaluated is left out,
 * since it may be a password from ${ENV_VAR} and reports get uploaded.
 */
function describeStep(step: SetupStep): string {
  if ('goto' in step) return `goto ${step.goto}`
  if ('route' in step) return `route ${step.route}`
  if ('click' in step) return `click "${step.click}"`
  if ('fill' in step) return `fill "${step.fill}"`
  if ('press' in step) return `press ${step.press}`
  return 'eval'
}

/**
 * Navigates inside the app without a reload: push the URL, then tell the router.
 * react-router, TanStack Router and vue-router all listen for popstate.
 */
export function pushRoute(path: string): void {
  history.pushState({}, '', path)
  dispatchEvent(new PopStateEvent('popstate', { state: {} }))
}
