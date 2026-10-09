import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReportSite } from '../src/site.ts'

describe('buildReportSite', () => {
  it('publishes the graph page, screens and reports, and nothing else', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'uiscout-run-'))
    writeFileSync(path.join(out, 'graph.html'), '<html><head><title>g</title></head></html>')
    writeFileSync(path.join(out, 'report.md'), 'ok')
    writeFileSync(path.join(out, 'server.log'), 'DATABASE_URL=postgres://secret')
    mkdirSync(path.join(out, 'screens'))
    writeFileSync(path.join(out, 'screens', 'a.jpg'), '')
    const to = path.join(out, 'site')
    expect(await buildReportSite(out, to)).toEqual(['index.html', 'report.md', 'screens/'])
    expect(readFileSync(path.join(to, 'index.html'), 'utf8')).toContain('noindex')
    expect(existsSync(path.join(to, 'server.log'))).toBe(false)
  })
})
