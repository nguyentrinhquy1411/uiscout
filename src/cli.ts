#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { changedSince, type Selection, selectAffected } from './affected.ts'
import { compareToBaseline, diffGraphs, isEmptyDiff, loadBaseline, saveBaseline } from './baseline.ts'
import { type FileConfig, loadConfig } from './config.ts'
import { loadRecordings, type NetworkMode, saveRecordings } from './network.ts'
import { crawl } from './crawl.ts'
import { renderDiff, renderMarkdown, renderText } from './report.ts'
import type { Graph } from './types.ts'

/*
 * flowcheck check --url http://localhost:5173 — the five-minute path (design doc §12):
 * no plugin, no recordings, a live app, only safe edges. Settings come from
 * flowcheck.config.json when present; flags override them. Writes the graph and the
 * findings under --out and prints the report. Exits 1 when there are errors.
 */

const USAGE = `Usage: flowcheck check [--url <url>] [options]
       flowcheck diff <before.graph.json> <after.graph.json>

  --config <file>       Settings file (default ./flowcheck.config.json when it exists)
  --url <url>           Entry URL of a running app
  --out <dir>           Where to write graph.json, findings.json, report.txt, report.md (default .flowcheck)
  --depth <n>           Actions deep from the entry (default 2)
  --max-steps <n>       Total actions (default 250)
  --seeds <paths>       Comma-separated routes no link reaches, e.g. "/legacy,/404"
  --now <iso>           Time the app starts at (default: real time)
  --tz <zone>           Time zone (default Asia/Ho_Chi_Minh)
  --allow-4xx <list>    Comma-separated expected 4xx: "404" or "GET /api/me"
  --block <globs>       Comma-separated URL globs to abort, e.g. "**/api/ai/**"
  --allow-overlap <css> Controls that overlap by design, e.g. "[data-event-id]"
  --fast-forward <ms>   Timers run after each step to catch delayed navigation (default 5000, 0 = off)
  --no-a11y             Skip the axe checks
  --concurrency <n>     Nodes explored in parallel (default 4)
  --mode <mode>         live (real backend), record (real backend, keep responses) or
                        replay (recordings only; destructive controls are walked)
  --baseline <dir>      Accepted graph and snapshots to compare against (default ./flowcheck)
  --update              Accept this run as the new baseline instead of comparing
  --affected <ref>      Walk only the screens built from files changed since <ref> (and the
                        screens leading to them); falls back to a full run when it can't tell
  --headed              Show the browser

Contexts (personas with setup steps) are configured in the settings file only.
`

const list = (s: string | undefined) => s?.split(',').map((x) => x.trim()).filter(Boolean)
const num = (s: string | undefined) => (s === undefined ? undefined : Number(s))

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      url: { type: 'string' },
      out: { type: 'string', default: '.flowcheck' },
      depth: { type: 'string' },
      'max-steps': { type: 'string' },
      seeds: { type: 'string' },
      now: { type: 'string' },
      tz: { type: 'string' },
      'allow-4xx': { type: 'string' },
      'allow-overlap': { type: 'string' },
      block: { type: 'string' },
      'fast-forward': { type: 'string' },
      'no-a11y': { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      baseline: { type: 'string' },
      mode: { type: 'string' },
      update: { type: 'boolean', default: false },
      affected: { type: 'string' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (positionals[0] === 'diff') {
    const [a, b] = positionals.slice(1)
    if (!a || !b) {
      process.stdout.write(USAGE)
      process.exit(2)
    }
    const read = async (f: string) => JSON.parse(await readFile(f, 'utf8')) as Graph
    const diff = diffGraphs(await read(a), await read(b))
    process.stdout.write(`${renderDiff(diff, a).join('\n')}\n`)
    process.exit(isEmptyDiff(diff) ? 0 : 1)
  }

  const configPath = values.config ?? (existsSync('flowcheck.config.json') ? 'flowcheck.config.json' : undefined)
  const file: FileConfig = configPath ? await loadConfig(configPath) : {}
  const url = values.url ?? file.url
  if (values.help || positionals[0] !== 'check' || !url) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 2)
  }

  const started = Date.now()
  const now = values.now ?? file.now
  const baselineDir = path.resolve(values.baseline ?? file.baseline ?? 'flowcheck')
  const network = (values.mode ?? file.network ?? 'live') as NetworkMode
  if (!['live', 'record', 'replay'].includes(network)) throw new Error(`--mode must be live, record or replay, not "${network}"`)
  const recordingsFile = path.join(baselineDir, 'recordings.json')
  const recordings = network === 'replay' ? await loadRecordings(recordingsFile) : {}
  // Affected-only (§10): needs a baseline that knows each screen's sources and paths.
  const baseline = existsSync(baselineDir) ? await loadBaseline(baselineDir) : null
  let selection: Selection | null = null
  if (values.affected && !values.update) {
    selection = baseline?.graph
      ? selectAffected(baseline.graph, baseline.replays, changedSince(values.affected))
      : { only: null, scope: new Set(), reason: 'full run: no baseline to select from' }
    process.stderr.write(`  affected: ${selection.reason}\n`)
    if (selection.only && !Object.keys(selection.only).length) {
      process.stdout.write(`flowcheck: nothing to walk (${selection.reason})\n`)
      process.exit(0)
    }
  }
  if (network === 'replay' && !Object.keys(recordings).length) process.stderr.write(`  no recordings in ${recordingsFile}: every API call will be reported\n`)
  const result = await crawl({
    url,
    maxDepth: num(values.depth) ?? file.depth,
    maxSteps: num(values['max-steps']) ?? file.maxSteps,
    seeds: list(values.seeds) ?? file.seeds,
    contexts: file.contexts,
    now: now ? new Date(now) : undefined,
    timezoneId: values.tz ?? file.timezone,
    allow4xx: list(values['allow-4xx']) ?? file.allow4xx,
    ignoreConsole: file.ignoreConsole,
    allowOverlap: values['allow-overlap'] ?? file.allowOverlap,
    block: list(values.block) ?? file.block,
    fillText: file.fillText,
    fastForwardMs: num(values['fast-forward']) ?? file.fastForwardMs,
    a11y: values['no-a11y'] ? false : file.a11y,
    concurrency: num(values.concurrency) ?? file.concurrency,
    network,
    recordings,
    only: selection?.only ?? undefined,
    headed: values.headed,
    log: (line) => process.stderr.write(`  ${line}\n`),
  })

  // The baseline (§7C, §10): accept this run, or judge it against the last accepted one.
  if (network === 'record') {
    await mkdir(baselineDir, { recursive: true })
    await saveRecordings(recordingsFile, recordings)
    process.stderr.write(`  recorded ${Object.keys(recordings).length} calls to ${path.relative(process.cwd(), recordingsFile)}: emails, tokens and sensitive keys are redacted, but review the file before committing it\n`)
  }
  const against = path.relative(process.cwd(), path.join(baselineDir, 'app.graph.json'))
  let diffInfo: Parameters<typeof renderText>[1]
  if (values.update) {
    await saveBaseline(baselineDir, result.graph, result.snapshots, result.replays)
  } else if (baseline) {
    const scope = selection?.only ? selection.scope : undefined
    const { findings, diff } = compareToBaseline(baseline, result.graph, result.snapshots, scope)
    result.findings.push(...findings)
    if (diff) {
      diffInfo = { diff, against }
      const changed = diff.addedNodes.length + diff.removedNodes.length + diff.addedEdges.length + diff.removedEdges.length
      // Like a lockfile: a graph that moved must be reviewed and committed, not ignored.
      if (changed) result.findings.push({ oracle: 'structure', severity: 'error', at: 'graph', message: `${against} is out of date (${changed} nodes or edges changed): review the diff, then run with --update and commit` })
    }
  }

  const out = path.resolve(values.out)
  await mkdir(out, { recursive: true })
  const text = renderText(result, diffInfo)
  await writeFile(path.join(out, 'graph.json'), `${JSON.stringify(result.graph, null, 2)}\n`)
  await writeFile(path.join(out, 'findings.json'), `${JSON.stringify({ findings: result.findings, skipped: result.skipped, healed: result.healed, restless: result.restless, flaky: result.flaky }, null, 2)}\n`)
  await writeFile(path.join(out, 'report.txt'), `${text}\n`)
  const markdown = renderMarkdown(result, diffInfo)
  await writeFile(path.join(out, 'report.md'), markdown)
  // In GitHub Actions the run summary shows the same report without any token.
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  const accepted = values.update ? `, accepted as baseline in ${path.relative(process.cwd(), baselineDir) || '.'}/` : ''
  process.stdout.write(`${text}\n\nWrote ${path.relative(process.cwd(), out) || '.'}/${accepted} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  process.exit(result.findings.some((f) => f.severity === 'error') ? 1 : 0)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : err}\n`)
  process.exit(2)
})
