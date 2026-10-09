import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findConfig, interpolateEnv } from '../src/config.ts'

describe('findConfig', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'uiscout-config-'))
  mkdirSync(path.join(repo, '.git'))
  mkdirSync(path.join(repo, 'apps/web/src'), { recursive: true })

  it('finds nothing when no directory up to the repository root has one', () => {
    expect(findConfig(path.join(repo, 'apps/web/src'))).toBeUndefined()
  })

  it('finds the nearest one upwards, stopping at the repository root', () => {
    writeFileSync(path.join(repo, 'uiscout.config.json'), '{}')
    expect(findConfig(path.join(repo, 'apps/web/src'))).toBe(path.join(repo, 'uiscout.config.json'))
    writeFileSync(path.join(repo, 'apps/web/uiscout.config.json'), '{}')
    expect(findConfig(path.join(repo, 'apps/web/src'))).toBe(path.join(repo, 'apps/web/uiscout.config.json'))
  })
})

describe('interpolateEnv', () => {
  it('replaces ${NAME} in nested strings and leaves other values alone', () => {
    const config = { url: 'http://localhost:${PORT}', depth: 2, auth: { steps: [{ fill: '#email', text: '${EMAIL}' }] } }
    expect(interpolateEnv(config, { PORT: '5173', EMAIL: 'a@b.c' })).toEqual({ url: 'http://localhost:5173', depth: 2, auth: { steps: [{ fill: '#email', text: 'a@b.c' }] } })
  })

  it('fails on a variable that is not set instead of typing an empty string', () => {
    expect(() => interpolateEnv({ text: '${MISSING_SECRET}' }, {})).toThrow(/MISSING_SECRET/)
  })
})
