import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'

/*
 * flowcheck.config.json (design doc §12) and contexts (§5): the personas a graph is
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
  setup?: SetupStep[]
}

export interface FileConfig {
  url?: string
  depth?: number
  maxSteps?: number
  concurrency?: number
  now?: string
  timezone?: string
  /** Routes no link reaches, walked from the entry through the history API. */
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
  /** Where the accepted graph and snapshots live (default "flowcheck"). */
  baseline?: string
}

export async function loadConfig(path: string): Promise<FileConfig> {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text) as FileConfig
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`)
  }
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
      throw new Error(`setup step ${i + 1} ${JSON.stringify(step)} failed: ${(err as Error).message.split('\n')[0]}`)
    }
  }
}

/**
 * Navigates inside the app without a reload: push the URL, then tell the router.
 * react-router, TanStack Router and vue-router all listen for popstate.
 */
export function pushRoute(path: string): void {
  history.pushState({}, '', path)
  dispatchEvent(new PopStateEvent('popstate', { state: {} }))
}
