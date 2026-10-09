import { describe, expect, it } from 'vitest'
import { valueFor } from '../src/fill.ts'
import type { FieldInfo } from '../src/types.ts'

const field = (f: Partial<FieldInfo>): FieldInfo => ({ type: 'text', hints: '', pattern: null, min: null, max: null, maxLength: null, ...f })

describe('valueFor', () => {
  it('types what the input type accepts', () => {
    expect(valueFor(field({ type: 'email' }), 'uiscout')).toBe('uiscout@example.com')
    expect(valueFor(field({ type: 'date' }), 'uiscout')).toBe('2026-01-15')
    expect(valueFor(field({ type: 'number', min: '1', max: '10' }), 'uiscout')).toBe('10')
    expect(valueFor(field({ type: 'number', min: '100' }), 'uiscout')).toBe('100')
  })

  it('reads hints from name, autocomplete and label on plain text fields', () => {
    expect(valueFor(field({ hints: 'billing postal-code' }), 'uiscout')).toBe('10001')
    expect(valueFor(field({ hints: 'work email' }), 'uiscout')).toBe('uiscout@example.com')
    expect(valueFor(field({ hints: 'given-name first name' }), 'uiscout')).toBe('Ada')
  })

  it('keeps the configured text for search boxes, text areas and unknown fields', () => {
    expect(valueFor(field({ type: 'search', hints: 'search email' }), 'hello')).toBe('hello')
    expect(valueFor(field({ type: 'textarea', hints: 'name' }), 'hello')).toBe('hello')
    expect(valueFor(field({ hints: 'title' }), 'hello')).toBe('hello')
    expect(valueFor(null, 'hello')).toBe('hello')
  })

  it('finds a value that fits the pattern, within the length limit', () => {
    expect(valueFor(field({ pattern: '\\d{6}' }), 'uiscout')).toBe('123456')
    expect(valueFor(field({ pattern: '[A-Z]{3}-\\d+' }), 'uiscout')).toBe('ABC-123')
    expect(valueFor(field({ maxLength: 4 }), 'uiscout')).toBe('uisc')
  })
})
