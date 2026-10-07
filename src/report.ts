import type { GraphDiff } from './baseline.ts'
import type { CrawlResult } from './crawl.ts'
import type { IntentSummary } from './intent.ts'
import type { UsageAnalysis } from './usage.ts'
import type { Finding } from './types.ts'

/*
 * The text report (design doc §10). Short and true: errors first, warnings
 * grouped, and everything that wasn't walked said out loud.
 */

const MAX_PER_SECTION = 25

const edgeLabel = (e: GraphDiff['addedEdges'][number]) =>
  `${e.from} -> ${e.to} : ${e.action.type === 'route' ? `route ${e.action.path}` : `${e.action.type} ${e.action.element}`}`

/** The structural difference from the committed graph, capped like everything else. */
export function renderDiff(diff: GraphDiff, against: string): string[] {
  const lines = [`Graph diff (vs ${against})`]
  const rows = [
    ...diff.addedNodes.map((n) => `  + node   ${n}`),
    ...diff.removedNodes.map((n) => `  - node   ${n}`),
    ...diff.retargeted.map(({ before, after }) => `  ~ edge   ${edgeLabel(before)}  now → ${after.to}`),
    ...diff.addedEdges.map((e) => `  + edge   ${edgeLabel(e)}`),
    ...diff.removedEdges.map((e) => `  - edge   ${edgeLabel(e)}`),
  ]
  if (!rows.length) return [...lines, '  (no change)', '']
  lines.push(...rows.slice(0, MAX_PER_SECTION))
  if (rows.length > MAX_PER_SECTION) lines.push(`  … ${rows.length - MAX_PER_SECTION} more`)
  return [...lines, '']
}

const ICON: Record<string, string> = { linked: '✓', failing: '✗', pending: '·', stale: '!', unchecked: '?' }

/** Intent coverage (§9): which plain-language lines are backed by a passing rule. */
export function renderIntent(summary: IntentSummary): string[] {
  if (!summary.total) return []
  const lines = [`Intent coverage ${summary.linked} of ${summary.total} lines`]
  for (const l of summary.lines) {
    const note = l.state === 'stale' ? `  (no rule "${l.rule}")` : l.state === 'unchecked' ? '  (rule never ran: no path reached it)' : l.rule ? `  (${l.rule})` : ''
    lines.push(`  ${ICON[l.state]} ${l.state.padEnd(9)} ${l.file}:${l.line}  ${l.text}${note}`)
  }
  return [...lines, '']
}

export function renderText(result: CrawlResult, diff?: { diff: GraphDiff; against: string }, intent?: IntentSummary, usage?: { analysis: UsageAnalysis; against: string }): string {
  const errors = result.findings.filter((f) => f.severity === 'error')
  const warnings = result.findings.filter((f) => f.severity === 'warning')
  const { nodes, edges } = result.graph
  const lines: string[] = []

  lines.push(`uiscout: ${distinct(errors)} errors, ${distinct(warnings)} warnings · ${nodes.length} nodes, ${edges.length} edges, ${result.steps} steps`)
  lines.push('')
  if (diff) lines.push(...renderDiff(diff.diff, diff.against))
  section(lines, 'Errors', errors)
  section(lines, 'Warnings', warnings)
  section(lines, 'Changes', result.findings.filter((f) => f.severity === 'info'))
  if (intent) lines.push(...renderIntent(intent))
  if (usage) lines.push(...renderUsage(usage.analysis, usage.against))

  if (result.healed.length) {
    lines.push(`Healed lookups (${result.healed.length}): found by similarity, not exact match`)
    for (const id of result.healed.slice(0, 10)) lines.push(`  ${id}`)
    lines.push('')
  }
  // Listed apart and never counted as errors (§6 Flake policy).
  lines.push(`Flaky (${result.flaky.length})${result.flaky.length ? ': failed, then passed from a fresh context' : ''}`)
  for (const f of result.flaky.slice(0, 10)) lines.push(`  ${f}`)
  lines.push('')
  if (result.restless.length) {
    lines.push(`Never settled (${result.restless.length}): DOM kept changing, judged after the timeout`)
    for (const at of result.restless.slice(0, 10)) lines.push(`  ${at}`)
    lines.push('')
  }

  const byReason = new Map<string, number>()
  for (const s of result.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
  if (byReason.size) {
    lines.push(`Not walked: ${[...byReason].sort(([a], [b]) => a.localeCompare(b)).map(([r, n]) => `${n} ${r}`).join(', ')}`)
    const destructive = result.skipped.filter((s) => s.reason === 'destructive').map((s) => s.element)
    if (destructive.length) lines.push(`  destructive: ${[...new Set(destructive)].slice(0, 8).join(', ')}${destructive.length > 8 ? ', …' : ''}`)
  }
  return lines.join('\n')
}

function section(lines: string[], title: string, findings: Finding[]): void {
  if (!findings.length) return
  // One entry per defect: the same message on seven screens is one bug seen seven times.
  const byMessage = new Map<string, Finding[]>()
  for (const f of findings) byMessage.set(`${f.oracle}|${f.message}`, [...(byMessage.get(`${f.oracle}|${f.message}`) ?? []), f])
  lines.push(`${title} (${byMessage.size})`)
  let shown = 0
  for (const list of byMessage.values()) {
    if (shown++ >= MAX_PER_SECTION) break
    const { oracle, message } = list[0]
    lines.push(`  ${oracle.padEnd(12)} ${message}`)
    const where = list.map((f) => f.at)
    lines.push(`  ${''.padEnd(12)} at ${where.slice(0, 3).join(' · ')}${where.length > 3 ? ` · +${where.length - 3} more` : ''}`)
    // A rule violation is only reproducible with the steps that led to it.
    const trace = list.find((f) => f.trace)?.trace
    if (trace) lines.push(`  ${''.padEnd(12)} via ${trace.join(' → ')}`)
  }
  if (byMessage.size > MAX_PER_SECTION) lines.push(`  … ${byMessage.size - MAX_PER_SECTION} more in findings.json`)
  lines.push('')
}

const distinct = (findings: Finding[]) => new Set(findings.map((f) => `${f.oracle}|${f.message}`)).size

/** Marks the comment so CI can find and update it instead of posting a new one each push. */
export const COMMENT_MARKER = '<!-- uiscout-report -->'
const MAX_MD_ITEMS = 10

/**
 * The pull request comment (§10): a verdict line, the graph diff and the errors up
 * front, the full text report folded underneath. Short and true.
 */
export function renderMarkdown(result: CrawlResult, diff?: { diff: GraphDiff; against: string }, intent?: IntentSummary, usage?: { analysis: UsageAnalysis; against: string }): string {
  const errors = result.findings.filter((f) => f.severity === 'error')
  const warnings = result.findings.filter((f) => f.severity === 'warning')
  const e = distinct(errors)
  const w = distinct(warnings)
  const verdict = e ? `❌ ${e} error${e === 1 ? '' : 's'}` : '✅ no errors'
  const md: string[] = [
    COMMENT_MARKER,
    `### uiscout: ${verdict}${w ? `, ${w} warning${w === 1 ? '' : 's'}` : ''}`,
    '',
    `${result.graph.nodes.length} screens, ${result.graph.edges.length} edges, ${result.steps} steps walked.${result.flaky.length ? ` ${result.flaky.length} flaky (not blocking).` : ''}`,
    '',
  ]
  if (diff) {
    const changed = renderDiff(diff.diff, diff.against).slice(1).filter((l) => l.trim() && l.trim() !== '(no change)')
    if (changed.length) md.push('**Graph changes**', '', '```diff', ...changed.map((l) => l.replace(/^ {2}/, '').replace(/^~/, '!')), '```', '')
  }
  const byMessage = new Map<string, Finding[]>()
  for (const f of errors) byMessage.set(`${f.oracle}|${f.message}`, [...(byMessage.get(`${f.oracle}|${f.message}`) ?? []), f])
  if (byMessage.size) {
    md.push('**Errors**', '')
    for (const list of [...byMessage.values()].slice(0, MAX_MD_ITEMS)) {
      const { oracle, message, at } = list[0]
      md.push(`- **${oracle}** — ${escapeMd(message)}  \n  <sub>at \`${at}\`${list.length > 1 ? ` and ${list.length - 1} more` : ''}</sub>`)
    }
    if (byMessage.size > MAX_MD_ITEMS) md.push(`- … ${byMessage.size - MAX_MD_ITEMS} more`)
    md.push('')
  }
  if (intent?.total) md.push(`**Intent coverage** ${intent.linked} of ${intent.total} lines backed by a passing rule.`, '')
  if (usage) md.push(...renderUsageMarkdown(usage.analysis))
  md.push('<details><summary>Full report</summary>', '', '```text', renderText(result, diff, intent, usage), '```', '', '</details>')
  return `${md.join('\n')}\n`
}

const escapeMd = (s: string) => s.replace(/([<>*_`|])/g, '\\$1')

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a')
const MAX_USAGE_ROWS = 15

/**
 * The usage overlay (§10 "After deploy"): coverage weighed by real traffic, the
 * most used controls tests don't reach, and walked controls nobody uses.
 */
export function renderUsage(u: UsageAnalysis, against: string): string[] {
  const lines = [`Usage (${against}: ${u.totalActions.toLocaleString('en-US')} actions on tracked controls)`]
  lines.push(`  Usage-weighted coverage ${pct(u.walkedActions, u.totalActions)} (${u.walkedActions.toLocaleString('en-US')} of ${u.totalActions.toLocaleString('en-US')} actions are on controls the run walked)`)
  if (u.untested.length) {
    lines.push('  Untested, by traffic')
    const width = String(u.untested[0].count.toLocaleString('en-US')).length
    for (const t of u.untested.slice(0, MAX_USAGE_ROWS)) lines.push(`    ${t.count.toLocaleString('en-US').padStart(width)}  ${t.route}  ${t.id}  — ${t.reason}`)
    if (u.untested.length > MAX_USAGE_ROWS) lines.push(`    … ${u.untested.length - MAX_USAGE_ROWS} more`)
  }
  if (u.unused.length) {
    lines.push('  Unused (no use in the period, on screens people visit)')
    for (const x of u.unused.slice(0, MAX_USAGE_ROWS)) lines.push(`    ${x.route}  ${x.id}  (${x.views.toLocaleString('en-US')} views)`)
    if (u.unused.length > MAX_USAGE_ROWS) lines.push(`    … ${u.unused.length - MAX_USAGE_ROWS} more`)
  }
  return [...lines, '']
}

export function renderUsageMarkdown(u: UsageAnalysis): string[] {
  const md = [`**Usage-weighted coverage** ${pct(u.walkedActions, u.totalActions)} of ${u.totalActions.toLocaleString('en-US')} real actions.`]
  if (u.untested.length) {
    md.push('', '| Uses | Screen | Control not walked | Why |', '| ---: | --- | --- | --- |')
    for (const t of u.untested.slice(0, 5)) md.push(`| ${t.count.toLocaleString('en-US')} | \`${t.route}\` | \`${t.id}\` | ${t.reason} |`)
  }
  return [...md, '']
}
