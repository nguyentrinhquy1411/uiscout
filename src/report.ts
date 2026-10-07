import type { GraphDiff } from './baseline.ts'
import type { CrawlResult } from './crawl.ts'
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

export function renderText(result: CrawlResult, diff?: { diff: GraphDiff; against: string }): string {
  const errors = result.findings.filter((f) => f.severity === 'error')
  const warnings = result.findings.filter((f) => f.severity === 'warning')
  const { nodes, edges } = result.graph
  const lines: string[] = []

  lines.push(`flowcheck: ${distinct(errors)} errors, ${distinct(warnings)} warnings · ${nodes.length} nodes, ${edges.length} edges, ${result.steps} steps`)
  lines.push('')
  if (diff) lines.push(...renderDiff(diff.diff, diff.against))
  section(lines, 'Errors', errors)
  section(lines, 'Warnings', warnings)
  section(lines, 'Changes', result.findings.filter((f) => f.severity === 'info'))

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
  }
  if (byMessage.size > MAX_PER_SECTION) lines.push(`  … ${byMessage.size - MAX_PER_SECTION} more in findings.json`)
  lines.push('')
}

const distinct = (findings: Finding[]) => new Set(findings.map((f) => `${f.oracle}|${f.message}`)).size

/** Marks the comment so CI can find and update it instead of posting a new one each push. */
export const COMMENT_MARKER = '<!-- flowcheck-report -->'
const MAX_MD_ITEMS = 10

/**
 * The pull request comment (§10): a verdict line, the graph diff and the errors up
 * front, the full text report folded underneath. Short and true.
 */
export function renderMarkdown(result: CrawlResult, diff?: { diff: GraphDiff; against: string }): string {
  const errors = result.findings.filter((f) => f.severity === 'error')
  const warnings = result.findings.filter((f) => f.severity === 'warning')
  const e = distinct(errors)
  const w = distinct(warnings)
  const verdict = e ? `❌ ${e} error${e === 1 ? '' : 's'}` : '✅ no errors'
  const md: string[] = [
    COMMENT_MARKER,
    `### flowcheck: ${verdict}${w ? `, ${w} warning${w === 1 ? '' : 's'}` : ''}`,
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
  md.push('<details><summary>Full report</summary>', '', '```text', renderText(result, diff), '```', '', '</details>')
  return `${md.join('\n')}\n`
}

const escapeMd = (s: string) => s.replace(/([<>*_`|])/g, '\\$1')
