import type { AuthConfig, SetupStep } from './config.ts'
import { describeStep } from './repro.ts'
import type { Finding, Fingerprint, Step } from './types.ts'

/*
 * uiscout export: one finding as a Playwright test, to keep as a regression test
 * once it's fixed. The test walks the same path the run took, then fails on the
 * same kind of problem: an uncaught exception, console.error or a 5xx; for a
 * finding of another kind (layout, a11y, a rule) it says what to assert.
 */

const js = (s: string) => JSON.stringify(s)

/** A config string as code: "${PASSWORD}" becomes process.env.PASSWORD, so no secret is written out. */
function value(s: string): string {
  if (!/\$\{[A-Z0-9_]+\}/.test(s)) return js(s)
  const escaped = s.replace(/[`\\$]/g, '\\$&')
  return `\`${escaped.replace(/\\\$\{([A-Z0-9_]+)\}/g, '${process.env.$1}')}\``
}

/**
 * The locator for a control: its test id, else its role and name, else its tag
 * and text. data-scout-id (from the identity plugin) only exists in builds with
 * the plugin, which is what the test runs against.
 */
export function locatorFor(fp: Fingerprint): string {
  if (fp.testId) return `page.locator(${js(`[data-testid="${fp.testId}"], [data-scout-id="${fp.testId}"]`)}).first()`
  if (fp.role && fp.role !== 'generic' && fp.name) return `page.getByRole(${js(fp.role)}, { name: ${js(fp.name)}, exact: true }).first()`
  if (fp.name) return `page.locator(${js(fp.tag)}).filter({ hasText: ${js(fp.name)} }).first()`
  return `page.locator(${js(fp.tag)}).first()`
}

const ROUTE = `await page.evaluate((path) => {
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate', { state: {} }))
  }, `

function stepCode(step: Step): string[] {
  const comment = `  // ${describeStep(step).replace(/\n/g, ' ')}`
  if (step.kind === 'route') return [comment, `  ${ROUTE}${js(step.path)})`]
  if (step.kind === 'click') return [comment, `  await ${locatorFor(step.fp)}.click()`]
  return [comment, `  await ${locatorFor(step.fp)}.fill(${js(step.text)})`, ...(step.enter ? [`  await ${locatorFor(step.fp)}.press('Enter')`] : [])]
}

function setupCode(steps: SetupStep[]): string[] {
  return steps.map((step) => {
    if ('goto' in step) return `  await page.goto(${value(step.goto)})`
    if ('route' in step) return `  ${ROUTE}${value(step.route)})`
    if ('click' in step) return `  await page.getByRole('button', { name: ${value(step.click)}, exact: true }).or(page.getByRole('link', { name: ${value(step.click)}, exact: true })).or(page.getByText(${value(step.click)}, { exact: true })).first().click()`
    if ('fill' in step) return `  await page.getByLabel(${value(step.fill)}).or(page.getByPlaceholder(${value(step.fill)})).first().fill(${value(step.text)})`
    if ('press' in step) return `  await page.keyboard.press(${value(step.press)})`
    return `  await page.evaluate(${value(step.eval)})`
  })
}

export interface ExportInput {
  finding: Finding
  /** The run's entry URL. */
  url: string
  /** The finding's context, from the raw config (so ${VAR} survive as process.env). */
  setup?: SetupStep[]
  auth?: AuthConfig
}

export function playwrightSpec({ finding, url, setup, auth }: ExportInput): string {
  const steps = finding.steps ?? []
  const network = finding.oracle === 'network' || finding.oracle === 'script'
  const lines = [
    `import { expect, test } from '@playwright/test'`,
    '',
    `// Exported by uiscout from ${finding.severity === 'error' ? 'an error' : 'a warning'} it found:`,
    `//   ${finding.oracle}: ${finding.message.replace(/\n/g, ' ')}`,
    `//   at ${finding.at}${finding.source ? ` (${finding.source})` : ''}`,
    ...(network ? [] : [`// This test walks the path; add the assertion for "${finding.oracle}" where marked.`]),
    `test(${js(`${finding.oracle}: ${finding.message.slice(0, 80)}`)}, async ({ page }) => {`,
    '  const problems: string[] = []',
    "  page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}`))",
    "  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console.error: ${msg.text()}`))",
    `  page.on('response', (res) => res.status() >= ${/returned 4\d\d/.test(finding.message) ? 400 : 500} && problems.push(\`\${res.request().method()} \${new URL(res.url()).pathname} returned \${res.status()}\`))`,
    '',
  ]
  if (auth) {
    lines.push('  // Sign in (the auth steps from uiscout.config.json)', `  await page.goto(${js(url)})`, ...setupCode(auth.steps))
    if (auth.waitFor) lines.push(`  await page.waitForURL((u) => u.pathname.startsWith(${js(auth.waitFor)}))`)
    lines.push('')
  }
  lines.push(`  await page.goto(${js(url)})`)
  if (setup?.length) lines.push('  // Context setup from uiscout.config.json', ...setupCode(setup))
  for (const step of steps) lines.push(...stepCode(step))
  lines.push("  await page.waitForLoadState('networkidle')", '')
  if (!network) lines.push(`  // TODO: assert what "${finding.oracle}" checked: ${finding.message.replace(/\n/g, ' ').slice(0, 120)}`)
  lines.push('  expect(problems).toEqual([])', '})', '')
  return lines.join('\n')
}
