#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { crawl } from './crawl.ts'
import { renderText } from './report.ts'

/*
 * flowcheck check --url http://localhost:5173 — the five-minute path (design doc §12):
 * no plugin, no recordings, a live app, only safe edges. Writes the graph and the
 * findings under --out and prints the report. Exits 1 when there are errors.
 */

const USAGE = `Usage: flowcheck check --url <url> [options]

  --url <url>          Entry URL of a running app
  --out <dir>          Where to write graph.json, findings.json, report.txt (default .flowcheck)
  --depth <n>          Clicks deep from the entry (default 2)
  --max-steps <n>      Total clicks (default 250)
  --now <iso>          Fixed time the app sees (default: real time)
  --tz <zone>          Time zone (default Asia/Ho_Chi_Minh)
  --allow-4xx <list>   Comma-separated expected 4xx: "404" or "GET /api/me"
  --block <globs>      Comma-separated URL globs to abort, e.g. "**/api/ai/**"
  --allow-overlap <css> Controls that overlap by design, e.g. "[data-event-id]"
  --concurrency <n>    Nodes explored in parallel (default 4)
  --headed             Show the browser
`

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      out: { type: 'string', default: '.flowcheck' },
      depth: { type: 'string', default: '2' },
      'max-steps': { type: 'string', default: '250' },
      now: { type: 'string' },
      tz: { type: 'string' },
      'allow-4xx': { type: 'string' },
      'allow-overlap': { type: 'string' },
      block: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help || positionals[0] !== 'check' || !values.url) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 2)
  }

  const started = Date.now()
  const result = await crawl({
    url: values.url,
    maxDepth: Number(values.depth),
    maxSteps: Number(values['max-steps']),
    now: values.now ? new Date(values.now) : undefined,
    timezoneId: values.tz,
    allow4xx: values['allow-4xx']?.split(',').map((s) => s.trim()).filter(Boolean),
    allowOverlap: values['allow-overlap'],
    block: values.block?.split(',').map((s) => s.trim()).filter(Boolean),
    concurrency: Number(values.concurrency),
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
