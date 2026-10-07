import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Rule, rulesOf } from './rules.ts'

/*
 * Business intent files (design doc §9): plain sentences next to the module they
 * describe, each linked to a rule a developer wrote and approved.
 *
 *   # Checkout
 *   - A guest cannot reach the payment page.   <!-- rule: guestCannotCheckout -->
 *   - After payment the user lands on confirmation.   <!-- rule: pending -->
 *
 * A line is linked (its rule exists and passed), failing (its rule broke on some
 * path), pending (no rule yet), or stale (it names a rule that no longer exists).
 */

export interface IntentLine {
  file: string
  line: number
  text: string
  /** The linked rule's name, or null when the line is pending. */
  rule: string | null
}

export type IntentState = 'linked' | 'failing' | 'pending' | 'stale' | 'unchecked'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.uiscout', 'coverage'])

/** Files under `root` whose names match, skipping dependencies and build output. */
export async function findFiles(root: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (pattern.test(entry.name)) out.push(full)
    }
  }
  await walk(root)
  return out.sort()
}

/** Loads every *.rules.{ts,js,mjs} under root; each export that is a rule is one rule. */
export async function loadRules(root: string): Promise<Rule[]> {
  const rules: Rule[] = []
  for (const file of await findFiles(root, /\.rules\.(m?js|ts)$/)) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    rules.push(...rulesOf(module))
  }
  return rules
}

export function parseIntent(text: string, file: string): IntentLine[] {
  return text.split('\n').flatMap((raw, i) => {
    const m = /^\s*[-*]\s+(.*?)\s*(?:<!--\s*rule:\s*([\w$-]+)\s*-->)?\s*$/.exec(raw)
    if (!m || !m[1]) return []
    const rule = m[2] && m[2] !== 'pending' ? m[2] : null
    return [{ file, line: i + 1, text: m[1].trim(), rule }]
  })
}

export async function loadIntent(root: string): Promise<IntentLine[]> {
  const lines: IntentLine[] = []
  for (const file of await findFiles(root, /\.intent\.md$/)) lines.push(...parseIntent(await readFile(file, 'utf8'), path.relative(root, file)))
  return lines
}

export function intentState(line: IntentLine, results: Record<string, { paths: number; violations: number }>): IntentState {
  if (!line.rule) return 'pending'
  const r = results[line.rule]
  if (!r) return 'stale'
  if (r.violations) return 'failing'
  return r.paths ? 'linked' : 'unchecked'
}

export interface IntentSummary {
  total: number
  linked: number
  lines: Array<IntentLine & { state: IntentState }>
}

export function summarizeIntent(lines: IntentLine[], results: Record<string, { paths: number; violations: number }>): IntentSummary {
  const withState = lines.map((l) => ({ ...l, state: intentState(l, results) }))
  return { total: lines.length, linked: withState.filter((l) => l.state === 'linked').length, lines: withState }
}
