#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type FileConfig, loadConfig } from './config.ts'
import { crawl } from './crawl.ts'
import { renderText } from './report.ts'

/*
 * flowcheck check --url http://localhost:5173 — the five-minute path (design doc §12):
 * no plugin, no recordings, a live app, only safe edges. Settings come from
 * flowcheck.config.json when present; flags override them. Writes the graph and the
 * findings under --out and prints the report. Exits 1 when there are errors.
 */

const USAGE = `Usage: flowcheck check [--url <url>] [options]

  --config <file>       Settings file (default ./flowcheck.config.json when it exists)
  --url <url>           Entry URL of a running app
  --out <dir>           Where to write graph.json, findings.json, report.txt (default .flowcheck)
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
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const configPath = values.config ?? (existsSync('flowcheck.config.json') ? 'flowcheck.config.json' : undefined)
  const file: FileConfig = configPath ? await loadConfig(configPath) : {}
  const url = values.url ?? file.url
  if (values.help || positionals[0] !== 'check' || !url) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 2)
  }

  const started = Date.now()
  const now = values.now ?? file.now
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
    headed: values.headed,
    log: (line) => process.stderr.write(`  ${line}\n`),
  })

  const out = path.resolve(values.out)
  await mkdir(out, { recursive: true })
  const text = renderText(result)
  await writeFile(path.join(out, 'graph.json'), `${JSON.stringify(result.graph, null, 2)}\n`)
  await writeFile(path.join(out, 'findings.json'), `${JSON.stringify({ findings: result.findings, skipped: result.skipped, healed: result.healed, restless: result.restless, flaky: result.flaky }, null, 2)}\n`)
  await writeFile(path.join(out, 'report.txt'), `${text}\n`)
  process.stdout.write(`${text}\n\nWrote ${path.relative(process.cwd(), out) || '.'}/ in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  process.exit(result.findings.some((f) => f.severity === 'error') ? 1 : 0)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : err}\n`)
  process.exit(2)
})
