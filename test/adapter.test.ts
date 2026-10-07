import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadAdapters, runAdapter } from '../src/adapter.ts'
import { startZoo } from './zoo-server.ts'

let zoo: Awaited<ReturnType<typeof startZoo>>
beforeAll(async () => {
  zoo = await startZoo()
})
afterAll(() => zoo?.close())

describe('widget adapters', () => {
  it('finds the planted drag bug and shrinks it to the move that triggers it', async () => {
    const [adapter] = await loadAdapters(path.join(import.meta.dirname, 'zoo-adapter'))
    expect(adapter.id).toBe('zoo.Bars')
    const failures = await runAdapter(adapter, { url: zoo.url, seed: 3, runs: 3, length: 8 })
    expect(failures.length).toBeGreaterThan(0)
    const f = failures[0]
    expect(f.violation).toMatch(/changed the duration of/)
    expect(f.steps).toHaveLength(1)
    expect(f.original).toBeGreaterThanOrEqual(1)
  }, 180_000)
})
