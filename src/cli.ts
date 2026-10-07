#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadAdapters, runAdapter } from './adapter.ts'
import { changedSince, type Selection, selectAffected } from './affected.ts'
import { compareToBaseline, diffGraphs, isEmptyDiff, loadBaseline, saveBaseline, snapshotFile, type Snapshots } from './baseline.ts'
import { type FileConfig, loadConfig } from './config.ts'
import { loadRecordings, type NetworkMode, saveRecordings } from './network.ts'
import { crawl } from './crawl.ts'
import { fuzz } from './fuzz.ts'
import { startMcp } from './mcp.ts'
import { analyzeUsage, emptyUsage, loadUsage, mergeUsage, parseUsage, saveUsage, type UsageAnalysis } from './usage.ts'
import { openFile, renderGraphHtml } from './graph-view.ts'
import { type IntentSummary, loadIntent, loadRules, summarizeIntent } from './intent.ts'
import { renderDiff, renderMarkdown, renderText, renderUsage } from './report.ts'
import type { Finding, Graph } from './types.ts'

/*
 * uiscout check --url http://localhost:5173 — the five-minute path (design doc §12):
 * no plugin, no recordings, a live app, only safe edges. Settings come from
 * uiscout.config.json when present; flags override them. Writes the graph and the
 * findings under --out and prints the report. Exits 1 when there are errors.
 */

const USAGE = `Usage: uiscout check [--url <url>] [options]
       uiscout diff <before.graph.json> <after.graph.json>
       uiscout graph [<graph.json>] [--open] [--out <dir>]
       uiscout fuzz [--url <url>] [--seed <n>] [--runs <n>] [--length <n>]
       uiscout mcp [--dir <project>]
       uiscout usage import <file>... [--reset]
       uiscout usage report [<graph.json>]
       uiscout adapters [--url <url>] [--dir <dir>] [--seed <n>] [--runs <n>] [--length <n>]

  --config <file>       Settings file (default ./uiscout.config.json when it exists)
  --url <url>           Entry URL of a running app
  --out <dir>           Where to write graph.json, findings.json, report.txt, report.md (default .uiscout)
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
  --baseline <dir>      Accepted graph and snapshots to compare against (default ./uiscout)
  --update              Accept this run as the new baseline instead of comparing
  --affected <ref>      Walk only the screens built from files changed since <ref> (and the
                        screens leading to them); falls back to a full run when it can't tell
  --no-rules            Skip *.rules.ts invariants and *.intent.md coverage
  --open                Open the graph page in the browser when the run ends
  --screenshots         Screenshot every screen for the graph page (default on, off when CI is set:
                        screenshots show whatever the app shows, personal data included)
  --no-screenshots      Don't screenshot screens
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
      out: { type: 'string', default: '.uiscout' },
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
      'no-rules': { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      baseline: { type: 'string' },
      mode: { type: 'string' },
      update: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      affected: { type: 'string' },
      seed: { type: 'string' },
      dir: { type: 'string' },
      runs: { type: 'string' },
      length: { type: 'string' },
      open: { type: 'boolean', default: false },
      screenshots: { type: 'boolean', default: false },
      'no-screenshots': { type: 'boolean', default: false },
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

  const configPath = values.config ?? (existsSync('uiscout.config.json') ? 'uiscout.config.json' : undefined)
  const file: FileConfig = configPath ? await loadConfig(configPath) : {}
  const url = values.url ?? file.url
  if (positionals[0] === 'usage') {
    // The usage overlay (§10 "After deploy"): import counts from uiscout/track or an export, then rank.
    const baselineDir = path.resolve(values.baseline ?? file.baseline ?? 'uiscout')
    const usageFile = path.join(baselineDir, 'usage.json')
    if (positionals[1] === 'import') {
      const inputs = positionals.slice(2)
      if (!inputs.length) throw new Error('usage import needs at least one file (JSON, NDJSON or CSV)')
      let usage = values.reset ? emptyUsage() : ((await loadUsage(usageFile)) ?? emptyUsage())
      for (const input of inputs) {
        const events = parseUsage(await readFile(input, 'utf8'))
        usage = mergeUsage(usage, events, path.basename(input))
        process.stdout.write(`  ${path.basename(input)}: ${events.length} events\n`)
      }
      await mkdir(baselineDir, { recursive: true })
      await saveUsage(usageFile, usage)
      const actions = usage.controls.reduce((n, c) => n + c.count, 0)
      process.stdout.write(`Wrote ${path.relative(process.cwd(), usageFile)}: ${usage.controls.length} controls, ${actions} actions, ${Object.keys(usage.views).length} routes\n`)
      process.exit(0)
    }
    if (positionals[1] === 'report') {
      const usage = await loadUsage(usageFile)
      if (!usage) throw new Error(`no ${path.relative(process.cwd(), usageFile)}: run uiscout usage import first`)
      const graphFile = positionals[2] ?? [path.join(values.out, 'graph.json'), path.join(baselineDir, 'app.graph.json')].find((f) => existsSync(f))
      if (!graphFile || !existsSync(graphFile)) throw new Error('no graph: run uiscout check first')
      const findingsFile = path.join(path.dirname(graphFile), 'findings.json')
      const skipped = existsSync(findingsFile) ? ((JSON.parse(await readFile(findingsFile, 'utf8')) as { skipped?: [] }).skipped ?? []) : []
      const analysis = analyzeUsage(JSON.parse(await readFile(graphFile, 'utf8')) as Graph, usage, skipped)
      process.stdout.write(`${renderUsage(analysis, path.relative(process.cwd(), usageFile)).join('\n')}\n`)
      process.exit(0)
    }
    throw new Error('usage: uiscout usage import <file>... | uiscout usage report [<graph.json>]')
  }

  if (positionals[0] === 'mcp') {
    // The MCP server for coding agents (§11): stdio, no model, runs until the client disconnects.
    await startMcp(path.resolve(values.dir ?? '.'))
    return
  }

  if (positionals[0] === 'graph') {
    // The graph page (no browser run): the last run's graph with its findings, or a baseline.
    const candidates = positionals[1] ? [positionals[1]] : [path.join(values.out, 'graph.json'), path.join(values.baseline ?? file.baseline ?? 'uiscout', 'app.graph.json')]
    const source = candidates.find((f) => existsSync(f))
    if (!source) throw new Error(`no graph found (looked for ${candidates.join(', ')}): run uiscout check first`)
    const dir = path.dirname(source)
    const findingsFile = path.join(dir, 'findings.json')
    const findings = existsSync(findingsFile) ? ((JSON.parse(await readFile(findingsFile, 'utf8')) as { findings: Finding[] }).findings) : null
    // Snapshots: a run directory has snapshots.json; a baseline has snapshots/*.txt.
    const snapshots: Snapshots = existsSync(path.join(dir, 'snapshots.json'))
      ? (JSON.parse(await readFile(path.join(dir, 'snapshots.json'), 'utf8')) as Snapshots)
      : (await loadBaseline(dir)).snapshots
    const target = path.resolve(values.out, 'graph.html')
    // Screenshots exist only for runs, next to their graph; paths are relative to the page.
    const screens: Record<string, string> = {}
    for (const key of Object.keys(snapshots)) {
      const shot = path.join(dir, 'screens', snapshotFile(key).replace(/\.txt$/, '.jpg'))
      if (existsSync(shot)) screens[key] = path.relative(path.dirname(target), shot).split(path.sep).join('/')
    }
    const html = await renderGraphHtml({
      graph: JSON.parse(await readFile(source, 'utf8')) as Graph,
      findings,
      label: findings ? 'last run' : `baseline ${path.relative(process.cwd(), source)}`,
      source: path.resolve(source),
      snapshots,
      screens,
    })
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, html)
    process.stdout.write(`Wrote ${path.relative(process.cwd(), target)}\n`)
    if (values.open) openFile(target)
    process.exit(0)
  }

  if (positionals[0] === 'adapters' && url) {
    // Widget adapters (§8): seeded action sequences, invariants after every action, shrunk failures.
    const seed = num(values.seed) ?? Math.floor(Math.random() * 1e9)
    const adapters = await loadAdapters(path.resolve(values.dir ?? '.'))
    if (!adapters.length) throw new Error('no *.adapter.ts files found')
    const now = values.now ?? file.now
    const lines: string[] = []
    let failed = 0
    for (const adapter of adapters) {
      const failures = await runAdapter(adapter, {
        url, seed, runs: num(values.runs), length: num(values.length),
        now: now ? new Date(now) : undefined,
        log: (line) => process.stderr.write(`  ${line}\n`),
      })
      failed += failures.length
      lines.push(`${adapter.id}: ${failures.length ? `${failures.length} failure${failures.length === 1 ? '' : 's'}` : 'ok'}`)
      for (const f of failures) {
        lines.push(`  ${f.violation}`, `  seed ${f.seed}, shrunk from ${f.original} to ${f.steps.length} action${f.steps.length === 1 ? '' : 's'}:`)
        lines.push(...f.steps.map((s, i) => `    ${i + 1}. ${s.action} ${JSON.stringify(s.args)}`))
      }
    }
    process.stdout.write(`uiscout adapters (seed ${seed})\n${lines.join('\n')}\n`)
    process.exit(failed ? 1 : 0)
  }

  if (positionals[0] === 'fuzz' && url) {
    // Seeded random walks against the invariants and the generic oracles (§7B); nightly.
    const seed = num(values.seed) ?? Math.floor(Math.random() * 1e9)
    const network = (values.mode ?? file.network ?? 'live') as NetworkMode
    const baselineDir = path.resolve(values.baseline ?? file.baseline ?? 'uiscout')
    const failures = await fuzz({
      url,
      seed,
      runs: num(values.runs),
      length: num(values.length),
      rules: values['no-rules'] ? [] : await loadRules(process.cwd()),
      block: list(values.block) ?? file.block,
      allow4xx: list(values['allow-4xx']) ?? file.allow4xx,
      ignoreConsole: file.ignoreConsole,
      network,
      recordings: network === 'replay' ? await loadRecordings(path.join(baselineDir, 'recordings.json')) : undefined,
      fillText: file.fillText,
      fastForwardMs: num(values['fast-forward']) ?? file.fastForwardMs,
      log: (line) => process.stderr.write(`  ${line}\n`),
    })
    const out = path.resolve(values.out)
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'fuzz.json'), `${JSON.stringify({ seed, failures }, null, 2)}\n`)
    const lines = [`uiscout fuzz (seed ${seed}): ${failures.length} failure${failures.length === 1 ? '' : 's'}`]
    for (const f of failures) {
      lines.push('', `  ${f.what}`, `  seed ${f.seed}, shrunk from ${f.original} to ${f.steps.length} step${f.steps.length === 1 ? '' : 's'}:`)
      lines.push(...(f.steps.length ? f.steps.map((s, i) => `    ${i + 1}. ${s}`) : ['    (on load)']))
    }
    process.stdout.write(`${lines.join('\n')}\n`)
    process.exit(failures.length ? 1 : 0)
  }

  if (values.help || positionals[0] !== 'check' || !url) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 2)
  }

  const started = Date.now()
  const now = values.now ?? file.now
  const baselineDir = path.resolve(values.baseline ?? file.baseline ?? 'uiscout')
  const network = (values.mode ?? file.network ?? 'live') as NetworkMode
  if (!['live', 'record', 'replay'].includes(network)) throw new Error(`--mode must be live, record or replay, not "${network}"`)
  const recordingsFile = path.join(baselineDir, 'recordings.json')
  const recordings = network === 'replay' ? await loadRecordings(recordingsFile) : {}
  // Invariants (§7B) and the intent lines that link to them (§9), from the project.
  const rules = values['no-rules'] ? [] : await loadRules(process.cwd())
  const intentLines = values['no-rules'] ? [] : await loadIntent(process.cwd())
  if (rules.length) process.stderr.write(`  rules: ${rules.map((r) => r.name).join(', ')}\n`)

  // Affected-only (§10): needs a baseline that knows each screen's sources and paths.
  const baseline = existsSync(baselineDir) ? await loadBaseline(baselineDir) : null
  let selection: Selection | null = null
  if (values.affected && !values.update) {
    selection = baseline?.graph
      ? selectAffected(baseline.graph, baseline.replays, changedSince(values.affected))
      : { only: null, scope: new Set(), reason: 'full run: no baseline to select from' }
    process.stderr.write(`  affected: ${selection.reason}\n`)
    if (selection.only && !Object.keys(selection.only).length) {
      process.stdout.write(`uiscout: nothing to walk (${selection.reason})\n`)
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
    rules,
    // Pixels can't be redacted: off in CI (artifacts get uploaded) unless asked for.
    screenshots: values.screenshots || (!values['no-screenshots'] && !process.env.CI),
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

  // The usage overlay, when real usage has been imported (§10 "After deploy").
  const usageData = await loadUsage(path.join(baselineDir, 'usage.json'))
  let usageInfo: { analysis: UsageAnalysis; against: string } | undefined
  if (usageData) usageInfo = { analysis: analyzeUsage(result.graph, usageData, result.skipped), against: path.relative(process.cwd(), path.join(baselineDir, 'usage.json')) }

  let intent: IntentSummary | undefined
  if (intentLines.length) {
    intent = summarizeIntent(intentLines, result.ruleResults)
    for (const l of intent.lines.filter((x) => x.state === 'stale')) {
      result.findings.push({ oracle: 'rule', severity: 'warning', at: `${l.file}:${l.line}`, message: `intent line links to rule "${l.rule}", which no rules file exports` })
    }
  }

  const out = path.resolve(values.out)
  await mkdir(out, { recursive: true })
  const text = renderText(result, diffInfo, intent, usageInfo)
  await writeFile(path.join(out, 'graph.json'), `${JSON.stringify(result.graph, null, 2)}\n`)
  await writeFile(path.join(out, 'findings.json'), `${JSON.stringify({ findings: result.findings, skipped: result.skipped, healed: result.healed, restless: result.restless, flaky: result.flaky, ruleResults: result.ruleResults }, null, 2)}\n`)
  await writeFile(path.join(out, 'report.txt'), `${text}\n`)
  // The graph page, so every run can be looked at: uiscout graph --open, or --open here.
  await writeFile(path.join(out, 'snapshots.json'), `${JSON.stringify(result.snapshots, null, 2)}\n`)
  const screensDir = path.join(out, 'screens')
  await rm(screensDir, { recursive: true, force: true })
  await mkdir(screensDir, { recursive: true })
  const screens: Record<string, string> = {}
  for (const [key, jpeg] of Object.entries(result.screens)) {
    const name = snapshotFile(key).replace(/\.txt$/, '.jpg')
    await writeFile(path.join(screensDir, name), jpeg)
    screens[key] = `screens/${name}`
  }
  const graphPage = path.join(out, 'graph.html')
  await writeFile(graphPage, await renderGraphHtml({ graph: result.graph, findings: result.findings, label: 'last run', source: path.join(out, 'graph.json'), snapshots: result.snapshots, screens, usage: usageInfo?.analysis.perControl }))
  if (values.open) openFile(graphPage)
  const markdown = renderMarkdown(result, diffInfo, intent, usageInfo)
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
