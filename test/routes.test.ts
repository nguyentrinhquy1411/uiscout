import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverRoutes } from '../src/routes.ts'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'uiscout-routes-'))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  return root
}

describe('discoverRoutes', () => {
  it('reads TanStack Router route trees, leaving out routes with parameters', () => {
    const root = project({
      'src/routeTree.gen.ts': `export interface FileRoutesByTo {\n  '/': typeof A\n  '/login': typeof B\n  '/docs': typeof C\n  '/docs/$docId': typeof D\n}\n`,
    })
    expect(discoverRoutes(root)).toEqual({ source: 'TanStack Router (src/routeTree.gen.ts)', routes: ['/', '/docs', '/login'] })
  })

  it('reads the Next.js app router: groups vanish, private, slot and dynamic segments are skipped', () => {
    const root = project({
      'package.json': '{"dependencies":{"next":"16"}}',
      'app/page.tsx': '',
      'app/(marketing)/pricing/page.tsx': '',
      'app/dashboard/settings/page.tsx': '',
      'app/posts/[id]/page.tsx': '',
      'app/_components/page.tsx': '',
      'app/@modal/login/page.tsx': '',
      'app/dashboard/layout.tsx': '',
    })
    expect(discoverRoutes(root)?.routes).toEqual(['/', '/dashboard/settings', '/pricing'])
  })

  it('reads the Next.js pages router without api routes or special files', () => {
    const root = project({
      'package.json': '{"dependencies":{"next":"16"}}',
      'pages/index.tsx': '',
      'pages/about.tsx': '',
      'pages/blog/index.tsx': '',
      'pages/blog/[slug].tsx': '',
      'pages/api/hello.ts': '',
      'pages/_app.tsx': '',
    })
    expect(discoverRoutes(root)?.routes).toEqual(['/', '/about', '/blog'])
  })

  it('finds nothing in a project without a known router', () => {
    expect(discoverRoutes(project({ 'index.html': '' }))).toBeNull()
  })
})
