import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { type AuthConfig, runSetup } from './config.ts'

/**
 * Signs in once, in a fresh browser, and saves the cookies and storage it leaves
 * (Playwright's storage state). Every screen of the walk then starts signed in,
 * which works for session cookies; setup steps, run after every page load,
 * suit sessions kept in memory instead.
 *
 * The file holds a live session: it is written under the run's output directory,
 * which belongs in .gitignore.
 */
export async function signIn(
  url: string,
  auth: AuthConfig,
  file: string,
  { timezoneId, headed }: { timezoneId?: string; headed?: boolean } = {},
): Promise<string> {
  const origin = new URL(url).origin
  const browser = await chromium.launch({ headless: !headed })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: timezoneId ?? 'Asia/Ho_Chi_Minh' })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await runSetup(page, auth.steps, origin)
    if (auth.waitFor) {
      const prefix = auth.waitFor
      await page.waitForURL((u) => u.pathname.startsWith(prefix), { timeout: 20_000 }).catch(() => {
        throw new Error(`sign-in didn't reach ${prefix} (stopped at ${new URL(page.url()).pathname}): check the auth steps and the account`)
      })
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await mkdir(path.dirname(file), { recursive: true })
    await context.storageState({ path: file })
    return file
  } finally {
    await browser.close()
  }
}
