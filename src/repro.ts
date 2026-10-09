import type { Fingerprint, Step } from './types.ts'

/*
 * A path written for people: the one line under a finding that says how to see
 * it again by hand, e.g.  open / → click "Checkout" → type "uiscout@example.com"
 * into "Email" and press Enter → click "Pay".
 */

const quote = (s: string) => `"${s.length > 40 ? `${s.slice(0, 39)}…` : s}"`

/** What a person would call the control: its name, else its test id, else its tag. */
export function controlName(fp: Fingerprint): string {
  return quote(fp.name || fp.testId || `<${fp.tag}>`)
}

export function describeStep(step: Step): string {
  if (step.kind === 'route') return `go to ${step.path}`
  if (step.kind === 'fill') return `type ${quote(step.text)} into ${controlName(step.fp)}${step.enter ? ' and press Enter' : ''}`
  return `click ${controlName(step.fp)}`
}

export function reproLine(entryPath: string, steps: Step[], context?: string): string {
  return [`open ${entryPath}${context ? ` as ${context}` : ''}`, ...steps.map(describeStep)].join(' → ')
}
