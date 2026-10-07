import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { saveBaseline } from '../src/baseline.ts'
import { crawl } from '../src/crawl.ts'
import { createServer } from '../src/mcp.ts'
import { startZoo } from './zoo-server.ts'

/* A real project (a baseline and a last run of the bug zoo) served over MCP to a real client. */

let zoo: Awaited<ReturnType<typeof startZoo>>
let client: Client
let root: string

beforeAll(async () => {
  zoo = await startZoo()
  root = await mkdtemp(path.join(tmpdir(), 'uiscout-mcp-'))
  await writeFile(path.join(root, 'uiscout.config.json'), JSON.stringify({ url: zoo.url }))
  const run = await crawl({ url: zoo.url, maxDepth: 2, settleMs: 150, a11y: false })
  await saveBaseline(path.join(root, 'uiscout'), run.graph, run.snapshots, run.replays)
  await mkdir(path.join(root, '.uiscout'), { recursive: true })
  await writeFile(path.join(root, '.uiscout', 'graph.json'), JSON.stringify(run.graph))
  await writeFile(path.join(root, '.uiscout', 'findings.json'), JSON.stringify({ findings: run.findings, skipped: run.skipped, ruleResults: run.ruleResults }))
  await writeFile(path.join(root, '.uiscout', 'snapshots.json'), JSON.stringify(run.snapshots))

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer(root).connect(serverSide)
  client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
}, 120_000)

afterAll(async () => {
  await client?.close()
  await zoo?.close()
})

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean }
  const body = res.content[0].text
  return { error: res.isError ?? false, body, json: () => JSON.parse(body) }
}

describe('MCP server', () => {
  it('lists the read and proposal tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['get_failures', 'get_graph', 'get_intent', 'get_node', 'get_uncovered', 'list_proposals', 'plan_path', 'propose_edge', 'propose_rule', 'run_edge', 'verify_proposal'])
  })

  it('reads the graph, a screen, a path and the failures', async () => {
    const graph = (await call('get_graph')).json()
    expect(graph.screens.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['/', '/broken.html', '/dialog.html [Settings]']))
    expect(graph.screens.find((s: { id: string }) => s.id === '/broken.html').findings).toBeGreaterThan(0)

    const node = (await call('get_node', { id: '/dialog.html' })).json()
    expect(node.actions.some((a: { to: string }) => a.to === '/dialog.html [Settings]')).toBe(true)
    expect(node.controls[0].entries.length).toBeGreaterThan(0)

    const plan = (await call('plan_path', { to: '/dialog.html [Settings]' })).json()
    expect(plan.steps.map((s: { to: string }) => s.to)).toEqual(['/dialog.html', '/dialog.html [Settings]'])

    const errors = (await call('get_failures', { severity: 'error' })).json()
    expect(errors.some((f: { message: string }) => f.message.includes('kaboom'))).toBe(true)

    const uncovered = (await call('get_uncovered')).json()
    expect(uncovered.destructive.length).toBeGreaterThan(0)
  })

  it('verifies a true edge proposal and refutes a false one, in a real browser', async () => {
    const good = (await call('propose_edge', { from: '/', element: 'Clean page', expectTo: '/clean.html' })).json().proposal
    const bad = (await call('propose_edge', { from: '/', element: 'Clean page', expectTo: '/broken.html', note: 'a wrong guess' })).json().proposal
    expect(good.status).toBe('proposed')

    const v1 = (await call('verify_proposal', { id: good.id })).json()
    expect(v1).toMatchObject({ status: 'verified' })
    const v2 = (await call('verify_proposal', { id: bad.id })).json()
    expect(v2.status).toBe('refuted')
    expect(v2.evidence.reason).toContain('led to /clean.html')
  }, 60_000)

  it('keeps rule proposals for a developer, never activates them', async () => {
    const rule = (await call('propose_rule', { name: 'cleanHasNoErrors', code: 'always(() => true)' })).json().proposal
    const res = await call('verify_proposal', { id: rule.id })
    expect(res.error).toBe(true)
    expect(res.body).toContain('developer')
    const all = (await call('list_proposals')).json()
    expect(all.map((p: { status: string }) => p.status).sort()).toEqual(['proposed', 'refuted', 'verified'])
  })

  it('walks a destructive control only in replay, and says why it did not', async () => {
    const res = (await call('run_edge', { from: '/broken.html', element: 'Delete account' })).json()
    expect(res.observed).toEqual([])
    expect(res.skipped.join(' ')).toContain('destructive')
    expect(zoo.hits).not.toContain('POST /api/delete')
  }, 60_000)

  it('answers clearly when there is nothing to read', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'uiscout-empty-'))
    const [c, s] = InMemoryTransport.createLinkedPair()
    await createServer(empty).connect(s)
    const other = new Client({ name: 'test', version: '0' })
    await other.connect(c)
    const res = (await other.callTool({ name: 'get_graph', arguments: {} })) as { content: Array<{ text: string }>; isError?: boolean }
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('uiscout check')
    await other.close()
  })
})
