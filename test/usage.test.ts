import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crawl } from '../src/crawl.ts'
import { analyzeUsage, emptyUsage, mergeUsage, parseUsage } from '../src/usage.ts'
import { stampIds } from '../src/vite-plugin.js'
import { startZoo } from './zoo-server.ts'

describe('reading usage exports', () => {
  it('reads tracker batches, JSON, NDJSON and CSV, and collapses data IDs in routes', () => {
    const batch = JSON.stringify({ events: [{ route: '/docs', id: 'docs.Header.export', action: 'click', count: 3 }, { route: '/docs', id: '', action: 'view', count: 9 }] })
    expect(parseUsage(batch)).toHaveLength(2)
    const ndjson = `${batch}\n{"path":"https://app.example.com/chat/3c940882-1c5c-41e1-841a-f23a584b1476?x=1","element":"chat.Composer.send"}`
    expect(parseUsage(ndjson).at(-1)).toEqual({ route: '/chat/:id', id: 'chat.Composer.send', action: 'click', count: 1 })
    const csv = 'route,id,action,count\n/docs,docs.Header.export,click,4\n/docs,,view,2\n/broken,,click,1'
    expect(parseUsage(csv)).toEqual([
      { route: '/docs', id: 'docs.Header.export', action: 'click', count: 4 },
      { route: '/docs', id: '', action: 'view', count: 2 },
    ])
  })

  it('drops forged routes and IDs that could inject markup into reports', () => {
    const forged = JSON.stringify([
      { route: '/docs', id: 'ok.Id' },
      { route: '/docs', id: 'x` [click](https://evil.example) `' },
      { route: '/a|b\n<img src=x>', id: 'y' },
      { route: '/docs', id: 'z'.repeat(300) },
    ])
    expect(parseUsage(forged).map((e) => e.id)).toEqual(['ok.Id'])
  })

  it('merges imports into counts per control and views per route', () => {
    let u = mergeUsage(emptyUsage(), parseUsage('route,id,count\n/a,x,2\n/a,x,3'), 'one.csv')
    u = mergeUsage(u, parseUsage('[{"route":"/a","id":"x"},{"route":"/a","action":"view","count":7}]'), 'two.json')
    expect(u.controls).toEqual([{ route: '/a', id: 'x', action: 'click', count: 6 }])
    expect(u.views).toEqual({ '/a': 7 })
    expect(u.sources).toEqual(['one.csv', 'two.json'])
  })
})

describe('the identity plugin for production', () => {
  it('keeps the semantic ID and drops the source path with sources: false', () => {
    const out = stampIds('function A() { return <button onClick={save}>Save</button> }', 'src/features/x/A.tsx', 'x', { sources: false })?.code ?? ''
    expect(out).toContain('data-scout-id="x.A.save"')
    expect(out).not.toContain('data-scout-src')
  })
})

let zoo: Awaited<ReturnType<typeof startZoo>>
beforeAll(async () => {
  zoo = await startZoo()
})
afterAll(() => zoo?.close())

describe('the usage tracker in a browser', () => {
  it('counts actions by control ID and route, collapses data IDs, and never sends what was typed', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`${zoo.url}shop.html`)
      await page.waitForFunction(() => 'stopTracking' in window)
      await page.getByRole('button', { name: 'Add to basket' }).click()
      await page.getByRole('button', { name: 'Add to basket' }).click()
      await page.getByRole('textbox', { name: 'Search products' }).fill('secret query ann@example.com')
      await page.getByRole('textbox', { name: 'Search products' }).blur()
      await page.getByRole('link', { name: 'Open item' }).click()
      const batches = await page.evaluate(() => {
        ;(window as unknown as { stopTracking: () => void }).stopTracking()
        return (window as unknown as { batches: unknown[] }).batches
      })
      const events = (batches as Array<{ events: Array<{ route: string; id: string; action: string; count: number }> }>).flatMap((b) => b.events)
      expect(events).toEqual(expect.arrayContaining([
        { route: '/shop.html', id: 'shop.Shop.addToBasket', action: 'click', count: 2 },
        { route: '/shop.html', id: 'shop.search', action: 'fill', count: 1 },
        { route: '/shop.html', id: 'shop.Shop.openItem', action: 'click', count: 1 },
        { route: '/items/:id', id: '', action: 'view', count: 1 },
      ]))
      expect(JSON.stringify(batches)).not.toContain('secret')
      expect(JSON.stringify(batches)).not.toContain('@')
    } finally {
      await browser.close()
    }
  }, 60_000)
})

describe('the usage overlay on a real walk', () => {
  it('weighs coverage by traffic, ranks untested controls, and lists unused ones', async () => {
    const run = await crawl({ url: `${zoo.url}shop.html`, maxDepth: 0, settleMs: 150, a11y: false })
    const usage = mergeUsage(emptyUsage(), parseUsage(JSON.stringify([
      { route: '/shop.html', id: 'shop.Shop.addToBasket', count: 100 },
      { route: '/shop.html', id: 'shop.Shop.deleteBasket', count: 50 },
      { route: '/checkout', id: 'shop.Checkout.pay', count: 5 },
      { route: '/shop.html', action: 'view', count: 400 },
    ])), 'synthetic.json')
    const u = analyzeUsage(run.graph, usage, run.skipped)
    expect(u.totalActions).toBe(155)
    expect(u.walkedActions).toBe(100)
    expect(u.untested.map((t) => [t.id, t.count])).toEqual([['shop.Shop.deleteBasket', 50], ['shop.Checkout.pay', 5]])
    expect(u.untested[0].reason).toContain('replay')
    expect(u.untested[1].reason).toBe('screen not reached by the walk')
    expect(u.unused.map((x) => x.id)).toEqual(expect.arrayContaining(['shop.Shop.compare', 'shop.search']))
    expect(u.unused.map((x) => x.id)).not.toContain('shop.Shop.addToBasket')
  }, 60_000)
})
