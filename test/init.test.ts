import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, init } from '../src/init.ts'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'uiscout-init-'))
  mkdirSync(path.join(root, '.git'))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  return root
}

describe('detect', () => {
  it('reads a Vite app: package manager, dev script, configured port, routes', () => {
    const root = project({
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '8' } }),
      'vite.config.ts': 'export default { server: { port: 5180 } }',
      'src/routeTree.gen.ts': "interface FileRoutesByTo {\n  '/': A\n  '/about': B\n}",
    })
    const d = detect(root)
    expect(d).toMatchObject({ pm: 'pnpm', script: 'dev', port: 5180, framework: { name: 'Vite' } })
    expect(d.routes?.routes).toEqual(['/', '/about'])
  })

  it('reads a port given in the dev script, and the lockfile of a monorepo root', () => {
    const root = project({ 'yarn.lock': '', 'apps/site/package.json': JSON.stringify({ scripts: { dev: 'next dev -p 4000' }, dependencies: { next: '16' } }) })
    expect(detect(path.join(root, 'apps/site'))).toMatchObject({ pm: 'yarn', port: 4000, framework: { name: 'Next.js' } })
  })
})

describe('init', () => {
  it('writes a config that starts the app, and keeps .uiscout out of git', async () => {
    const root = project({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '8' } }), '.gitignore': 'node_modules' })
    expect(await init(root, { log: () => {} })).toBe(0)
    expect(JSON.parse(readFileSync(path.join(root, 'uiscout.config.json'), 'utf8'))).toEqual({
      url: 'http://localhost:5173/',
      webServer: { command: 'npm run dev', url: 'http://localhost:5173/', timeout: 120 },
    })
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules\n.uiscout/\n')
    expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts).toMatchObject({ dev: 'vite', scout: 'uiscout check', 'scout:quick': 'uiscout check --quick' })
  })

  it('blocks paid and tracking services the code calls', async () => {
    const root = project({
      'package.json': '{}',
      'src/ai.ts': "fetch('https://api.openai.com/v1/chat/completions')",
      'src/chat.ts': "const url = `${API}/v1/ai/chat`; post('/v1/ai/chat')",
      'src/pay.tsx': "loadScript('https://js.stripe.com/v3')",
    })
    await init(root, { log: () => {} })
    expect(JSON.parse(readFileSync(path.join(root, 'uiscout.config.json'), 'utf8')).block).toEqual(['**/*.stripe.com/**', '**/ai/**', '**/api.openai.com/**'])
  })

  it('leaves an existing config alone unless forced', async () => {
    const root = project({ 'uiscout.config.json': '{"url":"x"}' })
    expect(await init(root, { log: () => {} })).toBe(1)
    expect(readFileSync(path.join(root, 'uiscout.config.json'), 'utf8')).toBe('{"url":"x"}')
  })
})
