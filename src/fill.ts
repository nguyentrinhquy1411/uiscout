import type { FieldInfo } from './types.ts'

/*
 * What the runner types into a field. A form that rejects "uiscout" in an email
 * field never shows what comes after it, so the value follows what the field
 * says it accepts: its type, its name and autocomplete hints, its pattern and
 * limits. Values are fixed, not random: the same field gets the same text in
 * every run, so graphs and snapshots stay comparable.
 */

const BY_TYPE: Record<string, string> = {
  email: 'uiscout@example.com',
  tel: '+15555550123',
  url: 'https://example.com',
  password: 'Uiscout-test-1',
  date: '2026-01-15',
  time: '09:30',
  'datetime-local': '2026-01-15T09:30',
  month: '2026-01',
  week: '2026-W03',
  color: '#3366cc',
}

/** Hints in a plain text field's name, id, autocomplete or label. */
const BY_HINT: Array<[RegExp, string]> = [
  [/e-?mail/, BY_TYPE.email],
  [/phone|\btel\b|mobile/, BY_TYPE.tel],
  [/\burl\b|website|homepage/, BY_TYPE.url],
  [/postal|\bzip\b|postcode/, '10001'],
  [/cc-number|card.?number/, '4242424242424242'],
  [/\bcvc\b|\bcvv\b|cc-csc/, '123'],
  [/cc-exp|expir/, '12/30'],
  [/given-name|first.?name/, 'Ada'],
  [/family-name|last.?name|surname/, 'Lovelace'],
  [/\bname\b|full.?name/, 'Ada Lovelace'],
  [/\bage\b|quantity|\bqty\b|amount|count|numeric|decimal/, '42'],
]

/** Values tried against a pattern the defaults don't match. */
const PATTERN_TRIES = ['12345', '123456', '1234', '1', 'ABC', 'abc', 'abc123', 'ABC-123', '2026-01-15']

function number(field: FieldInfo): string {
  const min = field.min !== null && field.min !== '' ? Number(field.min) : null
  const max = field.max !== null && field.max !== '' ? Number(field.max) : null
  let n = 42
  if (max !== null && !Number.isNaN(max) && n > max) n = max
  if (min !== null && !Number.isNaN(min) && n < min) n = min
  return String(n)
}

function fits(value: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`, 'v').test(value)
  } catch {
    return true
  }
}

export function valueFor(field: FieldInfo | null | undefined, fallback: string): string {
  if (!field) return fallback
  let value =
    field.type === 'number' || field.type === 'range' ? number(field)
    : BY_TYPE[field.type] ?? (field.type === 'search' || field.type === 'textarea' ? undefined : BY_HINT.find(([re]) => re.test(field.hints))?.[1]) ?? fallback
  if (field.pattern && !fits(value, field.pattern)) value = PATTERN_TRIES.find((v) => fits(v, field.pattern!)) ?? value
  return field.maxLength ? value.slice(0, field.maxLength) : value
}
