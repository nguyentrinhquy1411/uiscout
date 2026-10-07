import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl, type CrawlResult } from '../src/crawl.ts'
import { renderGraphHtml } from '../src/graph-view.ts'
import { startZoo } from './zoo-server.ts'

let zoo: Awaited<ReturnType<typeof startZoo>>
let run: CrawlResult
beforeAll(async () => {
  zoo = await startZoo()
  run = await crawl({ url: zoo.url, maxDepth: 2, settleMs: 150, a11y: false })
}, 120_000)
afterAll(() => zoo?.close())

describe('graph page', () => {
  it('embeds the data so no element name can end the script block', async () => {
    const graph = { ...run.graph, elements: [...run.graph.elements, { id: 'x', node: '/', role: 'button', name: '</script><b>', fingerprint: run.graph.elements[0].fingerprint }] }
    const html = await renderGraphHtml({ graph, findings: [], label: 'test', source: 'x' })
    expect(html).not.toContain('</script><b>')
    expect(html).toContain('\\u003c/script>')
  })

  it('keeps replacement patterns in names literal', async () => {
    const graph = { ...run.graph, elements: [...run.graph.elements, { id: 'y', node: '/', role: 'button', name: "$'<img src=x onerror=alert(1)>$`$&", fingerprint: run.graph.elements[0].fingerprint }] }
    const html = await renderGraphHtml({ graph, findings: [], label: 'test', source: 'x' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain("$'\\u003cimg src=x onerror=alert(1)>$`$&")
    expect(html.split('</script>').length).toBe(2)
  })

  it('renders every screen, marks the ones with errors, and inspects a screen on click', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fc-graph-'))
    const file = path.join(dir, 'graph.html')
    await writeFile(file, await renderGraphHtml({ graph: run.graph, findings: run.findings, label: 'last run', source: 'x' }))
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`file://${file}`)
      expect(errors).toEqual([])
      expect(await page.locator('.node').count()).toBe(run.graph.nodes.length)
      expect(await page.locator('.node.bad').count()).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Screen /broken.html', exact: true }).click()
      await expect.poll(() => page.locator('#panel').innerText()).toContain('kaboom')
    } finally {
      await browser.close()
    }
  }, 60_000)
})
